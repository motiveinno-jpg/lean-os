import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-api-key, x-ingest-secret, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// 공유 시크릿 게이트 — x-api-key(=company_id)는 비밀이 아니므로 시크릿 헤더가 없으면 크로스테넌트 주입 가능.
// n8n 은 x-ingest-secret 헤더에 N8N_INGEST_SECRET 값을 실어 보내야 함. 미설정/불일치 시 거부(fail-closed).
function checkIngestSecret(req: Request): boolean {
  const expected = Deno.env.get("N8N_INGEST_SECRET");
  if (!expected) return false;
  const provided = req.headers.get("x-ingest-secret");
  return !!provided && provided === expected;
}

interface TaxInvoiceInput {
  approval_no?: string;
  type: "sales" | "purchase";
  counterparty_name: string;
  counterparty_bizno?: string;
  supply_amount: number;
  tax_amount?: number;
  total_amount?: number;
  issue_date: string;
  label?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  let runId: string | null = null;

  try {
    // 공유 시크릿 필수 — company_id(UUID)만으로는 인증 불가
    if (!checkIngestSecret(req)) {
      return new Response(JSON.stringify({ error: "Unauthorized (invalid or missing ingest secret)" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Auth: x-api-key = company_id (same pattern as receive-bank-transactions)
    const apiKey = req.headers.get("x-api-key");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "x-api-key header required" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const companyId = apiKey;

    // Verify company exists
    const { data: company } = await supabase
      .from("companies")
      .select("id")
      .eq("id", companyId)
      .single();

    if (!company) {
      return new Response(JSON.stringify({ error: "Invalid API key (company not found)" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const invoices: TaxInvoiceInput[] = body.invoices || [];
    const source = body.source || "hometax_excel";

    if (invoices.length === 0) {
      return new Response(JSON.stringify({ error: "No invoices provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create automation_run record
    const { data: run } = await supabase
      .from("automation_runs")
      .insert({
        company_id: companyId,
        run_type: "hometax_import",
        status: "running",
        triggered_by: source === "n8n" ? "n8n" : "manual",
      })
      .select("id")
      .single();

    runId = run?.id || null;

    // Dedup: fetch existing approval_no values for this company
    const approvalNos = invoices
      .map((inv) => inv.approval_no)
      .filter(Boolean) as string[];

    const existingApprovalNos = new Set<string>();
    if (approvalNos.length > 0) {
      const { data: existing } = await supabase
        .from("tax_invoices")
        .select("label")
        .eq("company_id", companyId)
        .in("label", approvalNos);

      (existing || []).forEach((e: any) => {
        if (e.label) existingApprovalNos.add(e.label);
      });
    }

    // Filter out duplicates and build insert rows
    const newInvoices = invoices.filter(
      (inv) => !inv.approval_no || !existingApprovalNos.has(inv.approval_no)
    );

    let imported = 0;
    let skipped = invoices.length - newInvoices.length;
    const errors: string[] = [];

    if (newInvoices.length > 0) {
      const rows = newInvoices.map((inv) => {
        const supplyAmount = Math.abs(inv.supply_amount);
        const taxAmount = inv.tax_amount ?? Math.round(supplyAmount * 0.1);
        const totalAmount = inv.total_amount ?? supplyAmount + taxAmount;

        return {
          company_id: companyId,
          type: inv.type,
          counterparty_name: inv.counterparty_name,
          counterparty_bizno: inv.counterparty_bizno || null,
          supply_amount: supplyAmount,
          tax_amount: taxAmount,
          total_amount: totalAmount,
          issue_date: inv.issue_date,
          status: inv.type === "sales" ? "issued" : "received",
          label: inv.approval_no || inv.label || null,
        };
      });

      const { data: inserted, error: insertError } = await supabase
        .from("tax_invoices")
        .insert(rows)
        .select("id");

      if (insertError) {
        errors.push(insertError.message);
      } else {
        imported = inserted?.length || 0;
      }
    }

    // Auto 3-way match after import
    let matchResults = { total: 0, autoMatched: 0 };
    try {
      // Fetch sales invoices for matching
      const { data: salesInvoices } = await supabase
        .from("tax_invoices")
        .select("id, deal_id, total_amount, status, deals(contract_total)")
        .eq("company_id", companyId)
        .eq("type", "sales")
        .neq("status", "void")
        .neq("status", "matched");

      if (salesInvoices && salesInvoices.length > 0) {
        const { data: revenues } = await supabase
          .from("deal_revenue_schedule")
          .select("deal_id, amount")
          .eq("status", "received");

        const receivedByDeal = new Map<string, number>();
        (revenues || []).forEach((r: any) => {
          receivedByDeal.set(r.deal_id, (receivedByDeal.get(r.deal_id) || 0) + Number(r.amount || 0));
        });

        matchResults.total = salesInvoices.length;

        for (const inv of salesInvoices as any[]) {
          if (!inv.deal_id) continue;
          const contractAmount = Number(inv.deals?.contract_total || 0);
          const invoiceAmount = Number(inv.total_amount || 0);
          const receivedAmount = receivedByDeal.get(inv.deal_id) || 0;

          const tolerance = 0.01;
          const amountMatch = contractAmount > 0 && Math.abs(contractAmount - invoiceAmount) / contractAmount <= tolerance;
          const paymentMatch = invoiceAmount > 0 && Math.abs(invoiceAmount - receivedAmount) / invoiceAmount <= tolerance;

          if (amountMatch && paymentMatch) {
            await supabase
              .from("tax_invoices")
              .update({ status: "matched" })
              .eq("id", inv.id);
            matchResults.autoMatched++;
          }
        }
      }
    } catch (matchErr: any) {
      errors.push(`matching: ${matchErr.message}`);
    }

    // Update automation_run
    const resultSummary = {
      imported,
      skipped,
      matched: matchResults.autoMatched,
      matchTotal: matchResults.total,
      errors,
    };

    if (runId) {
      await supabase
        .from("automation_runs")
        .update({
          status: errors.length > 0 && imported === 0 ? "failed" : "completed",
          completed_at: new Date().toISOString(),
          result_summary: resultSummary,
          error_message: errors.length > 0 ? errors.join("; ") : null,
        })
        .eq("id", runId);
    }

    return new Response(
      JSON.stringify({
        success: true,
        run_id: runId,
        ...resultSummary,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    // Mark run as failed
    if (runId) {
      await supabase
        .from("automation_runs")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
          error_message: err.message,
        })
        .eq("id", runId);
    }

    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
