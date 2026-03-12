import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// CODEF API endpoints
const CODEF_BASE = "https://development.codef.io";
const CODEF_TOKEN_URL = "https://oauth.codef.io/oauth/token";

// Korean bank codes
const BANK_CODES: Record<string, string> = {
  "0003": "기업은행", "0004": "국민은행", "0011": "농협은행",
  "0020": "우리은행", "0023": "SC제일은행", "0027": "한국씨티은행",
  "0031": "대구은행", "0032": "부산은행", "0034": "광주은행",
  "0035": "제주은행", "0037": "전북은행", "0039": "경남은행",
  "0045": "새마을금고", "0048": "신협", "0071": "우체국",
  "0081": "하나은행", "0088": "신한은행", "0089": "케이뱅크",
  "0090": "카카오뱅크", "0092": "토스뱅크",
};

const CARD_CODES: Record<string, string> = {
  "0301": "KB국민카드", "0302": "현대카드", "0303": "삼성카드",
  "0304": "NH농협카드", "0305": "BC카드", "0306": "신한카드",
  "0307": "씨티카드", "0309": "하나카드", "0311": "롯데카드",
  "0313": "우리카드",
};

// Token cache
let tokenCache: { token: string; expiresAt: number } | null = null;

async function getCodefToken(clientId: string, clientSecret: string): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now()) {
    return tokenCache.token;
  }

  const res = await fetch(CODEF_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=client_credentials&client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}`,
  });

  if (!res.ok) throw new Error(`CODEF token error: ${res.status}`);
  const data = await res.json();
  tokenCache = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return data.access_token;
}

async function codefRequest(token: string, path: string, body: Record<string, any>): Promise<any> {
  const res = await fetch(`${CODEF_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`CODEF API error: ${res.status}`);
  const text = await res.text();
  try {
    const decoded = decodeURIComponent(text);
    return JSON.parse(decoded);
  } catch {
    return JSON.parse(text);
  }
}

async function syncBankTransactions(
  supabase: any, token: string, companyId: string, connectedId: string,
  startDate: string, endDate: string
) {
  const result = await codefRequest(token, "/v1/kr/bank/p/account/transaction-list", {
    connectedId, organization: "0004", startDate, endDate, orderBy: "0", inquiryType: "1",
  });

  if (result.result?.code !== "CF-00000" || !result.data) return { synced: 0 };

  const transactions = Array.isArray(result.data) ? result.data : [result.data];
  let synced = 0;

  for (const tx of transactions) {
    if (!tx.resTrDate) continue;
    const externalId = `codef_bank_${tx.resAccountTrDate || tx.resTrDate}_${tx.resAccountTrTime || ""}_${tx.resAccountOut || tx.resAccountIn || "0"}`;

    const { error } = await supabase.from("transactions").upsert({
      company_id: companyId,
      external_id: externalId,
      amount: Number(tx.resAccountIn || 0) - Number(tx.resAccountOut || 0),
      type: Number(tx.resAccountIn || 0) > 0 ? "income" : "expense",
      description: tx.resAccountDesc || tx.resAccountMemo || "",
      transaction_date: `${tx.resTrDate.slice(0,4)}-${tx.resTrDate.slice(4,6)}-${tx.resTrDate.slice(6,8)}`,
      source: "codef_bank",
      balance_after: Number(tx.resAfterTranBalance || 0),
    }, { onConflict: "external_id" });

    if (!error) synced++;
  }

  return { synced };
}

async function syncCardBilling(
  supabase: any, token: string, companyId: string, connectedId: string,
  startDate: string, endDate: string
) {
  const result = await codefRequest(token, "/v1/kr/card/p/account/billing-list", {
    connectedId, organization: "0301", startDate, endDate, orderBy: "0", inquiryType: "1",
  });

  if (result.result?.code !== "CF-00000" || !result.data) return { synced: 0 };

  const billings = Array.isArray(result.data) ? result.data : [result.data];
  let synced = 0;

  for (const bill of billings) {
    const externalId = `codef_card_${bill.resUsedDate || ""}_${bill.resUsedTime || ""}_${bill.resCardApprovalNo || synced}`;

    const { error } = await supabase.from("card_transactions").upsert({
      company_id: companyId,
      external_id: externalId,
      amount: Number(bill.resUsedAmount || 0),
      merchant_name: bill.resStoreName || bill.resMemberStoreName || "",
      transaction_date: bill.resUsedDate ? `${bill.resUsedDate.slice(0,4)}-${bill.resUsedDate.slice(4,6)}-${bill.resUsedDate.slice(6,8)}` : null,
      approval_number: bill.resCardApprovalNo || null,
      card_name: bill.resCardName || null,
      source: "codef_card",
    }, { onConflict: "external_id" });

    if (!error) synced++;
  }

  return { synced };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: { user } } = await createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    ).auth.getUser();

    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const body = await req.json();
    const { companyId, syncType = "all", startDate, endDate, connectedId } = body;

    if (!companyId) return new Response(JSON.stringify({ error: "companyId required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // Get CODEF credentials from company settings
    const { data: settings } = await supabase.from("company_settings").select("codef_client_id, codef_client_secret, codef_connected_id").eq("company_id", companyId).single();

    const clientId = settings?.codef_client_id || Deno.env.get("CODEF_CLIENT_ID");
    const clientSecret = settings?.codef_client_secret || Deno.env.get("CODEF_CLIENT_SECRET");
    const cid = connectedId || settings?.codef_connected_id;

    if (!clientId || !clientSecret) {
      return new Response(JSON.stringify({ error: "CODEF API 인증정보가 설정되지 않았습니다. 설정 > API 연동에서 설정해주세요." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const token = await getCodefToken(clientId, clientSecret);

    const end = endDate || new Date().toISOString().split("T")[0].replace(/-/g, "");
    const start = startDate || (() => { const d = new Date(); d.setMonth(d.getMonth() - 3); return d.toISOString().split("T")[0].replace(/-/g, ""); })();

    const results: Record<string, any> = {};

    if (cid && (syncType === "bank" || syncType === "all")) {
      results.bank = await syncBankTransactions(supabase, token, companyId, cid, start, end);
    }

    if (cid && (syncType === "card" || syncType === "all")) {
      results.card = await syncCardBilling(supabase, token, companyId, cid, start, end);
    }

    // Log sync
    await supabase.from("sync_logs").insert({
      company_id: companyId,
      sync_type: `codef_${syncType}`,
      status: "success",
      details: results,
      synced_by: user.id,
    });

    return new Response(JSON.stringify({ success: true, results }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || "Internal error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
