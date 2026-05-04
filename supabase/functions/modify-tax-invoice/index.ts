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
const MODIFICATION_REASON_CODES: Record<string, string> = {
  "기재사항 착오정정": "01",
  "공급가액 변동": "02",
  "환입": "03",
  "계약의 해제": "04",
  "내국신용장 사후개설": "05",
  "착오에 의한 이중발급": "06",
};

serve(async (req) => {
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

    const reasonCode = MODIFICATION_REASON_CODES[reason] || "01";
    const modDate = modification_date || new Date().toISOString().slice(0, 10);
    const supplyAmount = new_supply_amount ?? original.supply_amount;
    const taxAmount = Math.round(supplyAmount * 0.1);

    // Create modification record
    const { data: modified, error: insertErr } = await supabase
      .from("tax_invoices")
      .insert({
        company_id: original.company_id,
        invoice_number: `M-${original.invoice_number}`,
        issue_date: modDate,
        supplier_brn: original.supplier_brn,
        supplier_name: original.supplier_name,
        buyer_brn: original.buyer_brn,
        buyer_name: original.buyer_name,
        supply_amount: supplyAmount,
        tax_amount: taxAmount,
        total_amount: supplyAmount + taxAmount,
        invoice_type: "04", // 수정세금계산서
        direction: original.direction,
        modification_reason: reason,
        modification_code: reasonCode,
        original_invoice_id: original.id,
      })
      .select()
      .maybeSingle();

    if (insertErr) {
      return new Response(JSON.stringify({ error: `수정세금계산서 생성 실패: ${insertErr.message}` }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Mark original as modified
    await supabase
      .from("tax_invoices")
      .update({ status: "modified", modified_by_invoice_id: modified.id })
      .eq("id", invoice_id);

    return new Response(JSON.stringify({
      success: true,
      message: "수정세금계산서가 생성되었습니다.",
      data: modified,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
