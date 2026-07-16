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

// ── Korean Social Insurance Rates (2026) ──
const RATES = {
  nationalPension: 0.045,
  healthInsurance: 0.03545,
  longTermCare: 0.1295,
  employmentInsurance: 0.009,
};

function estimateIncomeTax(monthlySalary: number): number {
  if (monthlySalary <= 1060000) return 0;
  if (monthlySalary <= 1500000) return Math.round(monthlySalary * 0.02);
  if (monthlySalary <= 3000000) return Math.round(monthlySalary * 0.04);
  if (monthlySalary <= 5000000) return Math.round(monthlySalary * 0.06);
  if (monthlySalary <= 8000000) return Math.round(monthlySalary * 0.1);
  return Math.round(monthlySalary * 0.15);
}

function calculatePayroll(baseSalary: number) {
  const np = Math.round(baseSalary * RATES.nationalPension);
  const hi = Math.round(baseSalary * RATES.healthInsurance);
  const ltc = Math.round(hi * RATES.longTermCare);
  const ei = Math.round(baseSalary * RATES.employmentInsurance);
  const it = estimateIncomeTax(baseSalary);
  const lit = Math.round(it * 0.1);
  const deductions = np + hi + ltc + ei + it + lit;
  return { nationalPension: np, healthInsurance: hi + ltc, employmentInsurance: ei, incomeTax: it, localIncomeTax: lit, deductionsTotal: deductions, netPay: baseSalary - deductions };
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
    // Auth
    const apiKey = req.headers.get("x-api-key");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "x-api-key header required" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const companyId = apiKey;

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

    const body = await req.json().catch(() => ({}));
    const source = body.source || "manual";
    const now = new Date();
    const monthLabel = body.monthLabel || `${now.getFullYear()}년 ${now.getMonth() + 1}월`;

    // Create automation_run
    const { data: run } = await supabase
      .from("automation_runs")
      .insert({
        company_id: companyId,
        run_type: "monthly_batch",
        status: "running",
        triggered_by: source === "n8n" ? "n8n" : (source === "schedule" ? "schedule" : "manual"),
      })
      .select("id")
      .single();

    runId = run?.id || null;

    const result: any = {
      payroll: null,
      fixedCost: null,
      automation: null,
      matching: null,
      vat: null,
      errors: [],
    };

    // ── 1. Payroll Batch ──
    try {
      const { data: employees } = await supabase
        .from("employees")
        .select("id, name, salary, bank_account, bank_name, is_4_insurance, status")
        .eq("company_id", companyId)
        .eq("status", "active");

      if (employees && employees.length > 0) {
        const payrollItems = employees
          .filter((emp: any) => Number(emp.salary || 0) > 0)
          .map((emp: any) => {
            const salary = Number(emp.salary);
            const calc = calculatePayroll(salary);
            return { employeeId: emp.id, employeeName: emp.name, baseSalary: salary, bankAccount: emp.bank_account, bankName: emp.bank_name, ...calc };
          });

        if (payrollItems.length > 0) {
          const totalAmount = payrollItems.reduce((s: number, i: any) => s + i.netPay, 0);

          const { data: batch } = await supabase
            .from("payment_batches")
            .insert({
              company_id: companyId,
              name: `${monthLabel} 급여`,
              batch_type: "payroll",
              total_amount: totalAmount,
              item_count: payrollItems.length,
              status: "draft",
            })
            .select("id")
            .single();

          if (batch) {
            // Create payment_queue entries for each employee
            for (const item of payrollItems) {
              const { data: entry } = await supabase
                .from("payment_queue")
                .insert({
                  company_id: companyId,
                  amount: item.netPay,
                  description: `${monthLabel} 급여 - ${item.employeeName}`,
                  status: "pending",
                  batch_id: batch.id,
                  payment_type: "payroll",
                  category: "salary",
                  recipient_name: item.employeeName,
                  recipient_account: item.bankAccount || null,
                  recipient_bank: item.bankName || null,
                })
                .select("id")
                .single();
            }

            result.payroll = {
              batchId: batch.id,
              employeeCount: payrollItems.length,
              totalAmount,
              items: payrollItems.map((i: any) => ({ name: i.employeeName, baseSalary: i.baseSalary, netPay: i.netPay })),
            };
          }
        }
      }
    } catch (e: any) {
      result.errors.push(`payroll: ${e.message}`);
    }

    // ── 2. Fixed Cost Batch ──
    try {
      const { data: recurring } = await supabase
        .from("recurring_payments")
        .select("*")
        .eq("company_id", companyId)
        .eq("is_active", true);

      if (recurring && recurring.length > 0) {
        const totalAmount = recurring.reduce((s: number, r: any) => s + Number(r.amount || 0), 0);

        const { data: batch } = await supabase
          .from("payment_batches")
          .insert({
            company_id: companyId,
            name: `${monthLabel} 고정비`,
            batch_type: "fixed_cost",
            total_amount: totalAmount,
            item_count: recurring.length,
            status: "draft",
          })
          .select("id")
          .single();

        if (batch) {
          for (const r of recurring) {
            await supabase
              .from("payment_queue")
              .insert({
                company_id: companyId,
                amount: Number(r.amount || 0),
                description: `${r.name} (${r.category})`,
                status: "pending",
                batch_id: batch.id,
                payment_type: "fixed_cost",
                category: r.category,
                is_recurring: true,
                recurring_rule_id: r.id,
                recipient_name: r.recipient_name || null,
                recipient_account: r.recipient_account || null,
                recipient_bank: r.recipient_bank || null,
              });
          }

          // Update last_generated_at
          const ids = recurring.map((r: any) => r.id);
          await supabase
            .from("recurring_payments")
            .update({ last_generated_at: new Date().toISOString() })
            .in("id", ids);

          result.fixedCost = {
            batchId: batch.id,
            count: recurring.length,
            totalAmount,
          };
        }
      }
    } catch (e: any) {
      result.errors.push(`fixedCost: ${e.message}`);
    }

    // ── 3. Auto Bank Classification ──
    try {
      const { data: unmapped } = await supabase
        .from("bank_transactions")
        .select("id, counterparty, description, amount, type")
        .eq("company_id", companyId)
        .eq("mapping_status", "unmapped");

      if (unmapped && unmapped.length > 0) {
        const { data: rules } = await supabase
          .from("bank_classification_rules")
          .select("*")
          .eq("company_id", companyId)
          .order("priority", { ascending: false });

        let matched = 0;
        if (rules && rules.length > 0) {
          for (const tx of unmapped) {
            for (const rule of rules) {
              const field = rule.match_field === "counterparty" ? (tx as any).counterparty : (tx as any).description;
              if (!field) continue;

              let isMatch = false;
              const val = String(rule.match_value || "");
              const target = String(field);

              if (rule.match_type === "exact") isMatch = target === val;
              else if (rule.match_type === "contains") isMatch = target.toLowerCase().includes(val.toLowerCase());
              else if (rule.match_type === "startsWith") isMatch = target.startsWith(val);

              if (isMatch) {
                await supabase.from("bank_transactions").update({
                  mapping_status: "auto_mapped",
                  category: rule.assign_category || null,
                  classification: rule.assign_classification || null,
                  deal_id: rule.assign_deal_id || null,
                  is_fixed_cost: rule.is_fixed_cost || false,
                }).eq("id", (tx as any).id);
                matched++;
                break;
              }
            }
          }
        }
        result.automation = { unmapped: unmapped.length, autoClassified: matched };
      }
    } catch (e: any) {
      result.errors.push(`automation: ${e.message}`);
    }

    // ── 4. 3-Way Match ──
    try {
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

        let autoMatched = 0;
        for (const inv of salesInvoices as any[]) {
          if (!inv.deal_id) continue;
          const contractAmount = Number(inv.deals?.contract_total || 0);
          const invoiceAmount = Number(inv.total_amount || 0);
          const receivedAmount = receivedByDeal.get(inv.deal_id) || 0;
          const tolerance = 0.01;
          const amountMatch = contractAmount > 0 && Math.abs(contractAmount - invoiceAmount) / contractAmount <= tolerance;
          const paymentMatch = invoiceAmount > 0 && Math.abs(invoiceAmount - receivedAmount) / invoiceAmount <= tolerance;

          if (amountMatch && paymentMatch) {
            await supabase.from("tax_invoices").update({ status: "matched" }).eq("id", inv.id);
            autoMatched++;
          }
        }
        result.matching = { total: salesInvoices.length, autoMatched };
      }
    } catch (e: any) {
      result.errors.push(`matching: ${e.message}`);
    }

    // ── 5. VAT Preview ──
    try {
      const year = now.getFullYear();
      const { data: invoices } = await supabase
        .from("tax_invoices")
        .select("type, tax_amount, issue_date")
        .eq("company_id", companyId)
        .neq("status", "void")
        .gte("issue_date", `${year}-01-01`)
        .lte("issue_date", `${year}-12-31`);

      if (invoices && invoices.length > 0) {
        const quarters: Record<string, { salesTax: number; purchaseTax: number }> = {};
        for (const inv of invoices as any[]) {
          const m = new Date(inv.issue_date).getMonth() + 1;
          const q = `Q${Math.ceil(m / 3)}`;
          if (!quarters[q]) quarters[q] = { salesTax: 0, purchaseTax: 0 };
          const tax = Number(inv.tax_amount || 0);
          if (inv.type === "sales") quarters[q].salesTax += tax;
          else quarters[q].purchaseTax += tax;
        }

        result.vat = Object.entries(quarters).map(([q, v]) => ({
          quarter: `${year}-${q}`,
          salesTax: v.salesTax,
          purchaseTax: v.purchaseTax,
          netVAT: v.salesTax - v.purchaseTax,
        }));
      }
    } catch (e: any) {
      result.errors.push(`vat: ${e.message}`);
    }

    // ── Finalize automation_run ──
    if (runId) {
      await supabase
        .from("automation_runs")
        .update({
          status: result.errors.length > 0 ? "failed" : "completed",
          completed_at: new Date().toISOString(),
          result_summary: result,
          error_message: result.errors.length > 0 ? result.errors.join("; ") : null,
        })
        .eq("id", runId);
    }

    return new Response(
      JSON.stringify({ success: true, run_id: runId, ...result }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
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
