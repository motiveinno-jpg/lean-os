import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// 프로젝트 AI 브리핑 (2026-08-03 사장님 지시) — 상세 상단의 짧은 상태 한 줄을
//   "지금 어떤 상태인가 · 잘되는 점 · 문제 · 다음에 할 일"로 승격한다.
//
//   ① 서버가 직접 수집(service role): 계약·발행·입금·미수·비용·목표·업무·최근 기록.
//      클라이언트가 준 숫자를 믿지 않는다(정확성).
//   ② Sonnet + 구조화 출력(tool use) — headline/goods/issues/nexts.
//      경영 브리핑(Opus)보다 가벼운 작업이라 Sonnet 으로 충분하다(비용).
//   ⚠️ 이 파일은 _shared/claude.ts 를 쓰지 않고 최소 클라이언트를 직접 담는다 —
//      MCP 배포가 ../_shared 를 번들하지 못해서다. 모델·월 상한·ai_usage_log 스키마는 공용과 동일.
//   ③ 비용 통제: **프로젝트당 하루 1회 캐시**(project_briefs). force=true 로 재생성.
//      회사 월 상한(ai_cost_used_this_month)도 호출 전에 확인한다.
//   ④ fail-open: 어느 단계든 실패하면 { content: null } → 클라이언트가 기존 규칙 한 줄로 폴백.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const MODEL = "claude-sonnet-4-6";
const PRICE = { in: 3.0, out: 15.0 };
const CAP_USD = Number(Deno.env.get("AI_MONTHLY_COST_CAP_USD") || "10");

const won = (n: number): string => {
  const abs = Math.abs(Math.round(n));
  const eok = Math.floor(abs / 1e8);
  const man = Math.floor((abs % 1e8) / 1e4);
  const sign = n < 0 ? "-" : "";
  if (eok > 0 && man > 0) return `${sign}${eok}억 ${man.toLocaleString()}만원`;
  if (eok > 0) return `${sign}${eok}억원`;
  if (man > 0) return `${sign}${man.toLocaleString()}만원`;
  return `${sign}${abs.toLocaleString()}원`;
};

const BRIEF_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string", description: "이 프로젝트의 현재 상태 한 문장(40자 이내)" },
    goods: { type: "array", items: { type: "string" }, description: "잘 되고 있는 점 0~2개(각 30자 이내). 없으면 빈 배열" },
    issues: { type: "array", items: { type: "string" }, description: "문제·위험 0~3개(각 30자 이내). 실제 데이터에 근거한 것만" },
    nexts: { type: "array", items: { type: "string" }, description: "다음에 하면 좋은 일 1~3개(각 30자 이내). 구체적 행동으로" },
  },
  required: ["headline", "goods", "issues", "nexts"],
  additionalProperties: false,
};

async function collect(admin: ReturnType<typeof createClient>, dealId: string) {
  const kstToday = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const lines: string[] = [];
  let companyId: string | null = null;
  let dealName = "";

  const { data: deal } = await admin.from("deals")
    .select("id, company_id, name, stage, start_date, end_date, contract_total, partner_id, internal_manager_id, created_at")
    .eq("id", dealId).maybeSingle();
  if (!deal) return { companyId: null, dealName: "", snapshot: "" };
  companyId = deal.company_id as string;
  dealName = String(deal.name || "");

  const netContract = Number(deal.contract_total || 0);
  lines.push(`프로젝트: ${dealName}`);
  lines.push(`진행 단계: ${deal.stage || "미지정"}`);
  lines.push(`기간: ${deal.start_date || "미정"} ~ ${deal.end_date || "미정"} (오늘 ${kstToday})`);
  if (netContract > 0) lines.push(`계약금액: ${won(Math.round(netContract * 1.1))} (VAT 포함)`);
  else lines.push("계약금액: 아직 없음");

  // 거래처·담당
  try {
    if (deal.partner_id) {
      const { data: p } = await admin.from("partners").select("name").eq("id", deal.partner_id).maybeSingle();
      if (p?.name) lines.push(`거래처: ${p.name}`);
    }
    if (deal.internal_manager_id) {
      const { data: u } = await admin.from("users").select("name").eq("id", deal.internal_manager_id).maybeSingle();
      if (u?.name) lines.push(`담당자: ${u.name}`);
    }
  } catch { /* 개별 실패는 그 줄만 생략 */ }

  // 매출 계산서 — 발행·입금·미수·경과일
  try {
    const { data: inv } = await admin.from("tax_invoices")
      .select("total_amount, settled_amount, issue_date, status")
      .eq("deal_id", dealId).eq("type", "sales").neq("status", "void");
    const rows = (inv || []) as any[];
    const billed = rows.filter((r) => r.status !== "draft").reduce((n, r) => n + Number(r.total_amount || 0), 0);
    const paid = rows.reduce((n, r) => n + Number(r.settled_amount || 0), 0);
    const out = Math.max(0, billed - paid);
    lines.push(`세금계산서 발행: ${rows.length}건 ${won(billed)} · 입금 ${won(paid)} · 미수금 ${won(out)}`);
    const unpaid = rows.filter((r) => Number(r.total_amount || 0) - Number(r.settled_amount || 0) > 1 && r.issue_date)
      .map((r) => Math.floor((new Date(kstToday).getTime() - new Date(String(r.issue_date).slice(0, 10)).getTime()) / 86400000));
    if (unpaid.length) lines.push(`가장 오래된 미수 경과: ${Math.max(...unpaid)}일`);
  } catch { /* 생략 */ }

  // 비용(매입)
  try {
    const { data: buy } = await admin.from("tax_invoices")
      .select("supply_amount, total_amount").eq("deal_id", dealId).eq("type", "purchase").neq("status", "void");
    const cost = ((buy || []) as any[]).reduce((n, r) => n + Number(r.supply_amount || Math.round(Number(r.total_amount || 0) / 1.1)), 0);
    if (cost > 0) {
      lines.push(`비용(매입 공급가): ${won(cost)}`);
      if (netContract > 0) lines.push(`마진(공급가 기준): ${won(netContract - cost)} · 마진율 ${Math.round(((netContract - cost) / netContract) * 100)}%`);
    } else lines.push("비용: 아직 등록된 매입이 없음");
  } catch { /* 생략 */ }

  // 목표(KPI)
  try {
    const { data: kpis } = await admin.from("project_kpis").select("id, label, unit, target_value, source").eq("deal_id", dealId);
    for (const k of ((kpis || []) as any[])) {
      const { data: ent } = await admin.from("project_kpi_entries").select("value").eq("kpi_id", k.id);
      const actual = ((ent || []) as any[]).reduce((n, e) => n + Number(e.value || 0), 0);
      lines.push(`목표 '${k.label}': ${Number(k.target_value).toLocaleString()}${k.unit || ""} 중 입력 실적 ${actual.toLocaleString()}${k.unit || ""}${k.source === "revenue_auto" ? " (회계 자동 집계 지표)" : ""}`);
    }
  } catch { /* 생략 */ }

  // 업무
  try {
    const { data: tk } = await admin.from("project_tasks")
      .select("title, status, due_date, updated_at").eq("deal_id", dealId).is("archived_at", null);
    const rows = (tk || []) as any[];
    const done = rows.filter((t) => t.status === "done").length;
    const overdue = rows.filter((t) => t.status !== "done" && t.due_date && String(t.due_date).slice(0, 10) < kstToday);
    lines.push(`업무: ${rows.length}건 중 완료 ${done}건 · 기한 지난 것 ${overdue.length}건`);
    if (overdue.length) lines.push(`기한 지난 업무: ${overdue.slice(0, 3).map((t) => `${t.title}(${String(t.due_date).slice(0, 10)})`).join(", ")}`);
    const last = rows.map((t) => t.updated_at).filter(Boolean).sort().pop();
    const lastAct = last || deal.created_at;
    if (lastAct) lines.push(`마지막 변동: ${Math.floor((Date.now() - new Date(lastAct).getTime()) / 86400000)}일 전`);
  } catch { /* 생략 */ }

  // 최근 기록(주간 한 줄)
  try {
    const { data: up } = await admin.from("project_updates")
      .select("update_date, did").eq("deal_id", dealId).order("update_date", { ascending: false }).limit(3);
    const rows = ((up || []) as any[]).filter((u) => u.did);
    if (rows.length) lines.push(`최근 기록: ${rows.map((u) => `${u.update_date} ${String(u.did).slice(0, 60)}`).join(" / ")}`);
  } catch { /* 생략 */ }

  return { companyId, dealName, snapshot: lines.join("\n") };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const fail = () => new Response(JSON.stringify({ content: null }), { headers: { ...CORS, "content-type": "application/json" } });
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return fail();

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: { user } } = await createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    }).auth.getUser();
    if (!user) return fail();

    const { data: urow } = await admin.from("users").select("id, company_id").eq("auth_id", user.id).maybeSingle();
    const companyId = urow?.company_id;
    if (!companyId) return fail();

    const body = await req.json();
    const dealId = String(body?.dealId || "");
    if (!dealId) return fail();
    const force = body?.force === true;

    // 남의 회사 프로젝트 차단
    const snap = await collect(admin, dealId);
    if (!snap.companyId || snap.companyId !== companyId) return fail();

    const briefDate = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
    if (!force) {
      const { data: cached } = await admin.from("project_briefs")
        .select("content").eq("deal_id", dealId).eq("brief_date", briefDate).maybeSingle();
      if (cached?.content) {
        return new Response(JSON.stringify({ content: cached.content, cached: true }), { headers: { ...CORS, "content-type": "application/json" } });
      }
    }

    // 회사 월 AI 비용 상한 — 초과면 호출하지 않는다(조회 실패 시엔 차단하지 않음)
    try {
      const { data: spent } = await (admin as any).rpc("ai_cost_used_this_month", { p_company_id: companyId });
      if (Number(spent || 0) >= CAP_USD) return fail();
    } catch { /* 차단 안 함 */ }

    const t0 = Date.now();
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1200,
        tools: [{ name: "respond", description: "브리핑을 구조화해서 반환", input_schema: BRIEF_SCHEMA }],
        tool_choice: { type: "tool", name: "respond" },
        messages: [{
          role: "user",
          content: `너는 중소기업 대표의 프로젝트 참모다. 아래 한 프로젝트의 데이터를 보고 대표가 3초 안에 읽을 브리핑을 한국어 존댓말로 만들어라.

원칙:
1) 제공된 숫자·이름만 쓴다. 없는 금액·건수·날짜를 지어내지 마라.
2) 추상적인 훈수("관리가 필요합니다") 금지. 데이터를 인용한 구체 문장으로 쓴다.
3) headline 은 지금 상태를 한 문장으로(40자 이내). 과장·불안 조성 금지.
4) goods 는 정말 잘된 것만(없으면 빈 배열). issues 는 데이터로 확인되는 문제만.
5) nexts 는 대표나 담당자가 이번 주에 할 수 있는 행동으로 쓴다.
6) 각 항목은 30자 이내의 짧은 문장. 마침표 없이 명료하게.

[프로젝트 데이터]
${snap.snapshot}`,
        }],
      }),
    });
    if (!res.ok) return fail();
    const json = await res.json();
    const blocks: any[] = Array.isArray(json?.content) ? json.content : [];
    const tool = blocks.find((c) => c.type === "tool_use" && c.name === "respond");
    const content = tool?.input;
    if (!content || typeof content !== "object" || !content.headline) return fail();

    const inTok = Number(json?.usage?.input_tokens || 0);
    const outTok = Number(json?.usage?.output_tokens || 0);
    try {
      await admin.from("ai_usage_log").insert({
        company_id: companyId, user_id: urow?.id ?? null, feature: "project_brief", model: MODEL,
        input_tokens: inTok, output_tokens: outTok,
        cost_usd_estimate: (inTok / 1e6) * PRICE.in + (outTok / 1e6) * PRICE.out,
        latency_ms: Date.now() - t0, status: "ok", prompt_version: "project-brief-v1",
        request_id: json?.id ?? null,
      });
    } catch { /* 로깅 실패는 비치명 */ }

    await admin.from("project_briefs").upsert(
      { company_id: companyId, deal_id: dealId, brief_date: briefDate, content },
      { onConflict: "deal_id,brief_date" },
    );
    return new Response(JSON.stringify({ content, cached: false }), { headers: { ...CORS, "content-type": "application/json" } });
  } catch (_e) {
    return fail(); // fail-open → 클라이언트가 규칙 한 줄로 폴백
  }
});
