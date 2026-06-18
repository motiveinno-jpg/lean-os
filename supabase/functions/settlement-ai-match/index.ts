import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// 거래처 채권·채무 대사 — AI 매칭 (TASK B).
//   규칙 엔진(generate_settlement_suggestions)으로 안 풀린 미정산 입금/출금만 Claude 로 처리:
//   거래처 해소(입금자명→거래처) + 송장 매칭(정확/합산/부분/원천징수)을 한 번에.
//   결과는 invoice_settlements 에 status='suggested'|'needs_review' 로 INSERT (자동 confirmed 안 함).
//   비용절감: 규칙 통과분·이미 제안된 입금은 제외. 후보 거래처만 추려 프롬프트 캐싱.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const MODEL = "claude-sonnet-4-6";

// SQL normalize_party_name 과 동일 규칙(전각/법인격/기호 제거).
function normalize(s: string): string {
  if (!s) return "";
  return s
    .toLowerCase()
    .replace(/（/g, "(").replace(/）/g, ")").replace(/　/g, " ")
    .replace(/주식회사|유한회사|유한책임회사|합자회사|합명회사|농업회사법인|사회적협동조합|협동조합|㈜|\(주\)|주\)|\(유\)|\(재\)|\(사\)/g, "")
    .replace(/[\s+().,·\-_/]/g, "");
}

const SYSTEM_PROMPT = `당신은 한국 중소기업 회계의 거래처 채권/채무 대사 전문가입니다.
통장 입출금 1건이 어느 거래처의 어느 세금계산서(들)를 정산한 것인지 매칭합니다.
규칙:
- 거래처 해소: 약칭/법인격 생략("(주)에이비씨"="에이비씨"), 대표자 개인명 입금 흔함(representative 와도 비교). 후보에는 이름이 안 맞아도 금액이 일치하는 거래처가 포함될 수 있으니 금액·일자·정황으로 판단한다. 정말 무관하면 partner_id=null.
- 금액: one_to_one(정확, 수수료 ±1000원 허용) / aggregate(여러 송장 합=입금액) / partial(부분입금, 잔액 이월) / withholding(원천징수 3.3% 공제 = 입금액≈공급가×0.967).
- 날짜: 송장 issue_date ≤ 입금일, 통상 같은 달~익월.
- 불확실하면 needs_review=true, 신뢰도(confidence) 정직하게.
출력은 JSON only (설명 금지):
{"partner_id":string|null,"matched":[{"tax_invoice_id":string,"amount":number}],"match_type":"one_to_one|aggregate|partial|withholding|manual","confidence":0~1,"reason":"한줄","needs_review":boolean}`;

async function callClaude(userContent: string): Promise<any | null> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userContent }],
    }),
  });
  if (!res.ok) {
    console.error(`[anthropic] HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return null;
  }
  const data = await res.json();
  const text = (data?.content || []).map((b: any) => b.text || "").join("").trim();
  try {
    const jsonStr = text.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
    return JSON.parse(jsonStr);
  } catch {
    console.error("[anthropic] JSON parse fail:", text.slice(0, 200));
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    if (!ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY 미설정" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const authHeader = req.headers.get("authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const isServiceRole = authHeader.includes(SERVICE_ROLE);

    const { companyId, limit = 15 } = await req.json();
    if (!companyId) return new Response(JSON.stringify({ error: "companyId required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // user JWT 면 회사 소속 검증
    if (!isServiceRole) {
      const ures = await createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "",
        { global: { headers: { Authorization: authHeader } } }).auth.getUser();
      const uid = ures.data?.user?.id;
      if (!uid) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { data: urow } = await admin.from("users").select("company_id").eq("auth_id", uid).maybeSingle();
      if (!urow || urow.company_id !== companyId) {
        return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // 1) 미정산 + 아직 제안 없는 입출금 (규칙 미해소분)
    const { data: existing } = await admin.from("invoice_settlements").select("bank_transaction_id").eq("company_id", companyId);
    const skip = new Set((existing || []).map((r: any) => r.bank_transaction_id));
    const { data: allTx } = await admin.from("bank_transactions")
      .select("id, amount, transaction_date, counterparty, type")
      .eq("company_id", companyId).eq("settlement_status", "open").in("type", ["income", "expense"])
      .gt("amount", 0).order("transaction_date", { ascending: false }).limit(400);
    const txs = (allTx || []).filter((t: any) => !skip.has(t.id)).slice(0, limit);
    if (txs.length === 0) {
      return new Response(JSON.stringify({ processed: 0, resolved: 0, suggested: 0, note: "처리할 미해소 입금이 없습니다." }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 2) 거래처 + 미정산 송장 prefetch
    const { data: partners } = await admin.from("partners").select("id, name, representative, business_number").eq("company_id", companyId);
    const { data: invoices } = await admin.from("tax_invoices")
      .select("id, partner_id, type, issue_date, supply_amount, total_amount, settled_amount")
      .eq("company_id", companyId).neq("settlement_status", "settled").not("partner_id", "is", null);
    const invByPartner = new Map<string, any[]>();
    for (const inv of (invoices || [])) {
      const arr = invByPartner.get(inv.partner_id) || [];
      arr.push(inv); invByPartner.set(inv.partner_id, arr);
    }
    const normPartners = (partners || []).map((p: any) => ({ ...p, nn: normalize(p.name || ""), nr: normalize(p.representative || "") }));

    let resolved = 0, suggested = 0;
    for (const tx of txs) {
      const wantType = tx.type === "income" ? "sales" : "purchase";
      const nc = normalize(tx.counterparty || "");
      if (!nc) continue;

      // 후보 거래처: (1) 입금자명 부분일치 + (2) 금액 일치(±2%) 미정산 송장 보유 거래처
      //   → 입금자명이 거래처와 안 맞아도(자사명·개인명 등) AI 가 금액으로 판단해 추천할 수 있게 함.
      const txAmt = Number(tx.amount) || 0;
      const nameMatched = normPartners.filter((p: any) => p.nn && (p.nn.includes(nc) || nc.includes(p.nn) || (p.nr && (p.nr === nc || nc.includes(p.nr)))));
      const amtPartnerIds = new Set<string>();
      if (txAmt > 0) {
        for (const inv of (invoices || [])) {
          if (inv.type !== wantType || !inv.partner_id) continue;
          const rem = Number(inv.total_amount || 0) - Number(inv.settled_amount || 0);
          if (rem > 0 && Math.abs(rem - txAmt) <= txAmt * 0.02) amtPartnerIds.add(inv.partner_id);
        }
      }
      const nameIds = new Set(nameMatched.map((p: any) => p.id));
      const amountMatched = normPartners.filter((p: any) => amtPartnerIds.has(p.id) && !nameIds.has(p.id));
      const cands = [...nameMatched, ...amountMatched]
        .slice(0, 10)
        .map((p: any) => ({
          id: p.id, name: p.name, representative: p.representative, business_number: p.business_number,
          unsettled_invoices: (invByPartner.get(p.id) || []).filter((i: any) => i.type === wantType).map((i: any) => ({
            tax_invoice_id: i.id, issue_date: i.issue_date, supply_amount: Number(i.supply_amount || 0),
            total_amount: Number(i.total_amount || 0), remaining: Number(i.total_amount || 0) - Number(i.settled_amount || 0),
          })),
        }))
        .filter((p: any) => p.unsettled_invoices.length > 0);

      if (cands.length === 0) continue; // 후보 없음 → 수동 대상

      const userContent = JSON.stringify({
        payment: { amount: Number(tx.amount), transaction_date: tx.transaction_date, counterparty: tx.counterparty, direction: tx.type === "income" ? "입금(매출수금)" : "출금(매입지급)" },
        partner_candidates: cands,
      });
      const ai = await callClaude(userContent);
      if (!ai || !ai.partner_id || !Array.isArray(ai.matched) || ai.matched.length === 0) continue;

      // 검증: partner_id 가 후보 중 하나, matched 가 그 거래처 송장, amount 합 ≤ 입금액*1.01
      const cand = cands.find((c: any) => c.id === ai.partner_id);
      if (!cand) continue;
      const validIds = new Set(cand.unsettled_invoices.map((i: any) => i.tax_invoice_id));
      const rows = ai.matched.filter((m: any) => validIds.has(m.tax_invoice_id) && Number(m.amount) > 0);
      if (rows.length === 0) continue;
      const sumAmt = rows.reduce((s: number, m: any) => s + Number(m.amount), 0);
      if (sumAmt > Number(tx.amount) * 1.01 + 1000) continue; // 과배분 방지

      resolved++;
      const conf = Math.max(0, Math.min(1, Number(ai.confidence) || 0.5));
      const status = (ai.needs_review || conf < 0.9) ? "needs_review" : "suggested";
      // bank_transactions.partner_id 기록
      await admin.from("bank_transactions").update({ partner_id: ai.partner_id }).eq("id", tx.id).is("partner_id", null);
      for (const m of rows) {
        const { error } = await admin.from("invoice_settlements").insert({
          company_id: companyId, bank_transaction_id: tx.id, tax_invoice_id: m.tax_invoice_id,
          amount: Number(m.amount), match_type: ai.match_type || "manual", match_source: "ai",
          status, confidence: conf, reason: `AI: ${ai.reason || ""}`.slice(0, 200),
        });
        if (!error) suggested++;
      }
      // 별칭 학습 (입금자명 → 거래처). uq_partner_alias=(company_id, lower(alias)) 표현식 인덱스라
      //   onConflict 컬럼 지정 불가 → plain insert, 중복 시 에러는 무시(best-effort).
      if (conf >= 0.85 && tx.counterparty) {
        await admin.from("partner_aliases").insert({
          company_id: companyId, partner_id: ai.partner_id, alias: tx.counterparty, source: "ai", confidence: conf,
        });
      }
    }

    return new Response(JSON.stringify({ processed: txs.length, resolved, suggested }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message || "AI 매칭 오류" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
