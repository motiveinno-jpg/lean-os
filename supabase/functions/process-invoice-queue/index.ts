import { withSentry } from "../_shared/sentry.ts";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-api-key, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(withSentry("process-invoice-queue", async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    // 1. pending 상태의 자동발행 건 처리
    const { data: pendingItems } = await supabase
      .from("tax_invoice_queue")
      .select("*")
      .eq("status", "pending")
      .eq("action", "issue")
      .order("created_at")
      .limit(50);

    let issued = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const item of (pendingItems || [])) {
      try {
        await supabase
          .from("tax_invoice_queue")
          .update({ status: "processing" })
          .eq("id", item.id);

        const p = item.payload;

        // 이미 발행된 건 중복 방지
        if (item.revenue_schedule_id) {
          const { data: existing } = await supabase
            .from("tax_invoices")
            .select("id")
            .eq("revenue_schedule_id", item.revenue_schedule_id)
            .limit(1);

          if (existing && existing.length > 0) {
            await supabase
              .from("tax_invoice_queue")
              .update({ status: "completed", processed_at: new Date().toISOString(), error_message: "already_exists" })
              .eq("id", item.id);
            continue;
          }
        }

        // 거래처 희망일자 체크: preferred_date가 있으면 그 날짜까지 대기
        // partners 테이블에 preferred_invoice_day가 있으면 해당일에 발행
        let issueDate = p.issue_date;
        if (item.deal_id) {
          const { data: deal } = await supabase
            .from("deals")
            .select("partner_id")
            .eq("id", item.deal_id)
            .single();

          if (deal?.partner_id) {
            const { data: partner } = await supabase
              .from("partners")
              .select("metadata")
              .eq("id", deal.partner_id)
              .single();

            const preferredDay = partner?.metadata?.preferred_invoice_day;
            if (preferredDay) {
              const today = new Date();
              const preferDate = new Date(today.getFullYear(), today.getMonth(), preferredDay);
              // 희망일이 아직 안 됐으면 needs_approval로 대기
              if (preferDate > today) {
                await supabase
                  .from("tax_invoice_queue")
                  .update({
                    status: "needs_approval",
                    error_message: `거래처 희망일: 매월 ${preferredDay}일`,
                  })
                  .eq("id", item.id);
                continue;
              }
              issueDate = preferDate.toISOString().split("T")[0];
            }
          }
        }

        // 세금계산서 생성
        const { error: insertErr } = await supabase
          .from("tax_invoices")
          .insert({
            company_id: item.company_id,
            deal_id: item.deal_id,
            revenue_schedule_id: item.revenue_schedule_id,
            type: p.type || "sales",
            counterparty_name: p.counterparty_name,
            counterparty_bizno: p.counterparty_bizno || null,
            supply_amount: Number(p.supply_amount),
            tax_amount: Number(p.tax_amount),
            total_amount: Number(p.total_amount),
            issue_date: issueDate,
            status: "issued",
            source: p.source || "auto_deal",
            auto_issued: true,
            label: p.deal_number || null,
          });

        if (insertErr) throw new Error(insertErr.message);

        await supabase
          .from("tax_invoice_queue")
          .update({ status: "completed", processed_at: new Date().toISOString() })
          .eq("id", item.id);

        issued++;
      } catch (err: any) {
        await supabase
          .from("tax_invoice_queue")
          .update({ status: "failed", error_message: err.message, processed_at: new Date().toISOString() })
          .eq("id", item.id);
        failed++;
        errors.push(`${item.id}: ${err.message}`);
      }
    }

    // 2. 3-Way 자동매칭 (매칭 안 된 건들 재검사)
    let autoMatched = 0;
    const { data: unmatchedInvoices } = await supabase
      .from("tax_invoices")
      .select("id, deal_id, total_amount, deals(contract_total)")
      .eq("type", "sales")
      .not("deal_id", "is", null)
      .not("status", "in", '("matched","void")')
      .limit(200);

    if (unmatchedInvoices && unmatchedInvoices.length > 0) {
      const dealIds = [...new Set(unmatchedInvoices.map((i: any) => i.deal_id).filter(Boolean))];

      const { data: revenues } = await supabase
        .from("deal_revenue_schedule")
        .select("deal_id, amount")
        .eq("status", "received")
        .in("deal_id", dealIds);

      const receivedByDeal = new Map<string, number>();
      (revenues || []).forEach((r: any) => {
        receivedByDeal.set(r.deal_id, (receivedByDeal.get(r.deal_id) || 0) + Number(r.amount));
      });

      for (const inv of unmatchedInvoices as any[]) {
        const contractAmt = Number(inv.deals?.contract_total || 0);
        const invoiceAmt = Number(inv.total_amount || 0);
        const receivedAmt = receivedByDeal.get(inv.deal_id) || 0;

        if (contractAmt <= 0 || invoiceAmt <= 0) continue;

        const tolerance = 0.01;
        const amtMatch = Math.abs(contractAmt - invoiceAmt) / contractAmt <= tolerance;
        const payMatch = Math.abs(invoiceAmt - receivedAmt) / invoiceAmt <= tolerance;

        if (amtMatch && payMatch) {
          await supabase.from("tax_invoices").update({ status: "matched" }).eq("id", inv.id);
          autoMatched++;
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        queue: { issued, failed, errors },
        matching: { auto_matched: autoMatched },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}));
