import { withSentry } from "../_shared/sentry.ts";
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

interface BankTxInput {
  transaction_date: string;
  amount: number;
  balance_after?: number;
  type: "income" | "expense";
  counterparty?: string;
  description?: string;
  memo?: string;
  raw_data?: Record<string, unknown>;
}

Deno.serve(withSentry("receive-bank-transactions", async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // 공유 시크릿 필수 — company_id(UUID)만으로는 인증 불가
    if (!checkIngestSecret(req)) {
      return new Response(JSON.stringify({ error: "Unauthorized (invalid or missing ingest secret)" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Auth: API key header (n8n에서 설정)
    const apiKey = req.headers.get("x-api-key");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "x-api-key header required" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    // API key = company_id (simple auth for n8n)
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
    const transactions: BankTxInput[] = Array.isArray(body) ? body : body.transactions || [body];
    const bankAccountId = body.bank_account_id || null;
    const source = body.source || "n8n";

    if (transactions.length === 0) {
      return new Response(JSON.stringify({ error: "No transactions provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch classification rules
    const { data: rules } = await supabase
      .from("bank_classification_rules")
      .select("*")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .order("priority", { ascending: false });

    // Auto-classify each transaction
    const rows = transactions.map((tx) => {
      let category: string | null = null;
      let classification: string | null = null;
      let dealId: string | null = null;
      let isFixedCost = false;
      let mappingStatus = "unmapped";

      if (rules && rules.length > 0) {
        for (const rule of rules) {
          const field = tx[rule.match_field as keyof BankTxInput] as string || "";
          let matched = false;

          if (rule.match_type === "exact") {
            matched = field === rule.match_value;
          } else if (rule.match_type === "contains") {
            matched = field.toLowerCase().includes(rule.match_value.toLowerCase());
          } else if (rule.match_type === "regex") {
            try {
              matched = new RegExp(rule.match_value, "i").test(field);
            } catch { matched = false; }
          }

          if (matched) {
            category = rule.assign_category || category;
            classification = rule.assign_classification || classification;
            dealId = rule.assign_deal_id || dealId;
            isFixedCost = rule.is_fixed_cost || false;
            mappingStatus = "auto_mapped";
            break;
          }
        }
      }

      return {
        company_id: companyId,
        bank_account_id: bankAccountId,
        transaction_date: tx.transaction_date,
        amount: Math.abs(tx.amount),
        balance_after: tx.balance_after ?? null,
        type: tx.type || (tx.amount >= 0 ? "income" : "expense"),
        counterparty: tx.counterparty || null,
        description: tx.description || null,
        memo: tx.memo || null,
        deal_id: dealId,
        classification,
        category,
        is_fixed_cost: isFixedCost,
        mapping_status: mappingStatus,
        source,
        raw_data: tx.raw_data || null,
      };
    });

    // Deduplicate: skip if same date+amount+counterparty exists
    const { data: inserted, error } = await supabase
      .from("bank_transactions")
      .upsert(rows, { onConflict: "id" })
      .select("id, mapping_status");

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const autoMapped = inserted?.filter((r) => r.mapping_status === "auto_mapped").length || 0;
    const unmapped = inserted?.filter((r) => r.mapping_status === "unmapped").length || 0;

    return new Response(
      JSON.stringify({
        success: true,
        total: inserted?.length || 0,
        auto_mapped: autoMapped,
        unmapped,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}));
