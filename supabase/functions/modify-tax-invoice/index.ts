import { withSentry } from "../_shared/sentry.ts";
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = [
  "https://www.owner-view.com",
  "https://owner-view.com",
  "http://localhost:3000",
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "";
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
}

// 수정세금계산서 사유 코드 (국세청 기준)
// 국세청 수정사유 코드. 키는 UI(tax-invoices/page.tsx MODIFICATION_REASONS)가 보내는 값과 동일하게 맞춘다.
//   2026-07-27: 기존 맵은 한글 라벨을 키로 써서 UI 값("duplicate" 등)과 절대 매칭되지 않는
//   죽은 코드였다. 실제 전송(hometax-issue NTS_MODIFY_CODES)과 같은 기준으로 통일.
const MODIFICATION_REASON_CODES: Record<string, string> = {
  error_correction: "1", // 기재사항 착오정정
  price_change: "2",     // 공급가액 변동
  return: "3",           // 환입
  contract_cancel: "4",  // 계약의 해제
  inland_lc: "5",        // 내국신용장 사후개설
  duplicate: "6",        // 착오에 의한 이중발급
};

serve(withSentry("modify-tax-invoice", async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // Verify user via anon client
    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await anonClient.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { invoice_id, reason, new_supply_amount, modification_date } = await req.json();

    if (!invoice_id || !reason) {
      return new Response(JSON.stringify({ error: "invoice_id and reason are required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Fetch original invoice
    const { data: original, error: fetchErr } = await supabase
      .from("tax_invoices")
      .select("*")
      .eq("id", invoice_id)
      .maybeSingle();

    if (fetchErr || !original) {
      return new Response(JSON.stringify({ error: "세금계산서를 찾을 수 없습니다." }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Verify user belongs to the same company
    const { data: userRecord } = await supabase
      .from("users")
      .select("company_id")
      .eq("auth_id", user.id)
      .maybeSingle();

    if (!userRecord || userRecord.company_id !== original.company_id) {
      return new Response(JSON.stringify({ error: "권한이 없습니다." }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 사유 검증 — 국세청 코드로 변환 불가한 값이 저장되면 나중에 발행 단계에서야 막힌다.
    //   실제 코드값 전송은 hometax-issue 가 담당하고, 여기선 저장 전에 형식을 보장한다.
    if (!MODIFICATION_REASON_CODES[String(reason)]) {
      return new Response(JSON.stringify({
        error: `수정사유가 올바르지 않습니다: ${reason}`,
        hint: `허용값: ${Object.keys(MODIFICATION_REASON_CODES).join(", ")}`,
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const modDate = modification_date || new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
    // 취소(전액 반대) = new_supply_amount 미지정 → 원본 음수. 부분 수정(공급가액 변동) = 지정값.
    const hasNewAmount = new_supply_amount !== undefined && new_supply_amount !== null;
    //   세액은 과세(taxable)일 때만 10% — 면세·영세 계산서에 세액이 붙어 홈택스가 거부하거나 면세에 부가세가 생기던 것
    const taxRate = String(original.tax_kind || "taxable") === "taxable" ? 0.1 : 0;
    const supplyAmount = hasNewAmount ? Number(new_supply_amount) : -Number(original.supply_amount);
    const taxAmount = hasNewAmount ? Math.round(Number(new_supply_amount) * taxRate) : -Number(original.tax_amount);
    //   착오정정(코드 1)은 국세청 규칙상 취소분(−)과 수정분(+) 두 장이다. 금액이 있으면 취소분을 먼저 만든다.
    const needsCancelPair = String(reason) === "error_correction" && hasNewAmount;
    const baseRow = {
        company_id: original.company_id,
        type: original.type,
        counterparty_name: original.counterparty_name,
        counterparty_bizno: original.counterparty_bizno,
        counterparty_business_type: original.counterparty_business_type,
        counterparty_business_item: original.counterparty_business_item,
        counterparty_representative: original.counterparty_representative,
        counterparty_email: original.counterparty_email,
        counterparty_address: original.counterparty_address ?? null,
        issue_date: modDate,
        tax_kind: original.tax_kind,
        doc_kind: original.doc_kind ?? "tax",
        item_name: original.item_name,
        //   영수/청구 구분은 label 의 낱말로 판정하므로 원본을 그대로 잇는다(덮어쓰면 늘 '영수' 가 됐다)
        label: original.label ?? null,
        partner_id: original.partner_id,
        deal_id: original.deal_id,
        source: original.source ?? "manual",
        original_invoice_id: original.id,
        modification_reason: reason,
        modification_date: modDate,
        nts_issue_status: "draft",
        settled_amount: 0,
        settlement_status: original.settlement_status,
        status: "draft",
    };
    if (needsCancelPair) {
      const { error: cancelErr } = await supabase.from("tax_invoices").insert({
        ...baseRow,
        supply_amount: -Number(original.supply_amount), tax_amount: -Number(original.tax_amount),
        total_amount: -Number(original.supply_amount) - Number(original.tax_amount),
      });
      if (cancelErr) {
        return new Response(JSON.stringify({ error: `수정세금계산서(취소분) 생성 실패: ${cancelErr.message}` }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // 수정세금계산서 레코드 생성 — 실제 tax_invoices 스키마(counterparty_*/type/tax_kind/settlement_status) 기준.
    //   2026-07-22: 기존 코드가 존재하지 않는 컬럼(invoice_number/supplier_brn/buyer_brn/invoice_type/direction 등)에
    //   insert + NOT NULL 컬럼(type/counterparty_name/tax_kind/nts_issue_status/settled_amount/settlement_status) 누락으로
    //   무조건 실패("수정세금계산서 발행 실패")하던 것 수정.
    const { data: modified, error: insertErr } = await supabase
      .from("tax_invoices")
      .insert({
        ...baseRow,
        supply_amount: supplyAmount,
        tax_amount: taxAmount,
        total_amount: supplyAmount + taxAmount,
      })
      .select()
      .maybeSingle();

    if (insertErr) {
      return new Response(JSON.stringify({ error: `수정세금계산서 생성 실패: ${insertErr.message}` }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 원본을 '수정됨'으로 표시 (modified_by_invoice_id 컬럼은 스키마에 없어 제거)
    await supabase
      .from("tax_invoices")
      .update({ status: "modified" })
      .eq("id", invoice_id);

    return new Response(JSON.stringify({
      success: true,
      message: "수정세금계산서가 생성되었습니다.",
      data: modified,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
}));
