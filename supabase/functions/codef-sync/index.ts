// supabase/functions/codef-sync/index.ts
// CODEF API integration — 은행 거래내역 + 카드 사용내역 자동 수집
// Deno runtime (Supabase Edge Function)

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── CODEF API Constants ───

const CODEF_API_URL = Deno.env.get("CODEF_API_URL") || "https://api.codef.io";
const CODEF_TOKEN_URL = "https://oauth.codef.io/oauth/token";
const CODEF_CLIENT_ID = Deno.env.get("CODEF_CLIENT_ID") || "";
const CODEF_CLIENT_SECRET = Deno.env.get("CODEF_CLIENT_SECRET") || "";

// CODEF API endpoints
const ENDPOINTS = {
  // Connected ID 관리
  CREATE_CONNECTED: "/v1/account/create",
  ADD_CONNECTED: "/v1/account/add",
  UPDATE_CONNECTED: "/v1/account/update",
  DELETE_CONNECTED: "/v1/account/delete",
  // 법인 은행
  BANK_ACCOUNT_LIST: "/v1/kr/bank/b/account/account-list",
  BANK_TRANSACTION_LIST: "/v1/kr/bank/b/account/transaction-list",
  // 법인 카드
  CARD_LIST: "/v1/kr/card/b/account/card-list",
  CARD_TRANSACTION_LIST: "/v1/kr/card/b/account/billing-list",
  // 개인 은행 (소규모 사업자)
  BANK_P_ACCOUNT_LIST: "/v1/kr/bank/p/account/account-list",
  BANK_P_TRANSACTION_LIST: "/v1/kr/bank/p/account/transaction-list",
  // 개인 카드
  CARD_P_TRANSACTION_LIST: "/v1/kr/card/p/account/billing-list",
};

// 은행 코드 매핑
const BANK_CODES: Record<string, string> = {
  "KB국민은행": "0004", "kb국민": "0004", "국민": "0004",
  "신한은행": "0088", "신한": "0088",
  "우리은행": "0020", "우리": "0020",
  "하나은행": "0081", "하나": "0081",
  "IBK기업은행": "0003", "기업은행": "0003", "기업": "0003", "ibk": "0003",
  "NH농협은행": "0011", "농협": "0011", "nh": "0011",
  "카카오뱅크": "0090", "카카오": "0090",
  "토스뱅크": "0092", "토스": "0092",
  "케이뱅크": "0089",
  "SC제일은행": "0023", "sc": "0023",
  "씨티은행": "0027", "citi": "0027",
  "대구은행": "0031", "부산은행": "0032", "광주은행": "0034",
  "경남은행": "0039", "전북은행": "0037", "제주은행": "0035",
  "수협은행": "0007", "수협": "0007",
  "산업은행": "0002", "kdb": "0002",
  "새마을금고": "0045", "신협": "0048", "우체국": "0071",
};

// 카드사 코드 매핑
const CARD_CODES: Record<string, string> = {
  "삼성카드": "0301", "samsung": "0301", "삼성": "0301",
  "현대카드": "0302", "hyundai": "0302", "현대": "0302",
  "롯데카드": "0303", "lotte": "0303", "롯데": "0303",
  "BC카드": "0304", "bc": "0304",
  "신한카드": "0306", "shinhan": "0306",
  "KB국민카드": "0301", "kb": "0301", "국민카드": "0301",
  "하나카드": "0308", "hana": "0308",
  "우리카드": "0309", "woori": "0309",
  "NH농협카드": "0312", "농협카드": "0312",
  "씨티카드": "0311", "citi": "0311",
};

// ─── Types ───

interface CodefSyncRequest {
  companyId: string;
  syncType: "bank" | "card" | "all";
  startDate?: string; // YYYYMMDD
  endDate?: string;
}

interface CodefTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

// ─── CODEF OAuth Token ───

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getCodefToken(): Promise<string> {
  // Use cached token if still valid
  if (cachedToken && Date.now() < cachedToken.expiresAt - 30000) {
    return cachedToken.token;
  }

  if (!CODEF_CLIENT_ID || !CODEF_CLIENT_SECRET) {
    throw new Error("CODEF API 키가 설정되지 않았습니다. (CODEF_CLIENT_ID, CODEF_CLIENT_SECRET)");
  }

  const basicAuth = btoa(`${CODEF_CLIENT_ID}:${CODEF_CLIENT_SECRET}`);

  const res = await fetch(CODEF_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basicAuth}`,
    },
    body: "grant_type=client_credentials&scope=read",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`CODEF 토큰 발급 실패 (${res.status}): ${text}`);
  }

  const data: CodefTokenResponse = await res.json();
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return data.access_token;
}

// ─── CODEF API Call Helper ───

async function codefRequest(endpoint: string, body: Record<string, unknown>): Promise<any> {
  const token = await getCodefToken();

  const res = await fetch(`${CODEF_API_URL}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`CODEF API 오류 (${res.status}): ${text}`);
  }

  const result = await res.json();

  // CODEF returns URL-encoded JSON in result.data
  if (result.data && typeof result.data === "string") {
    try {
      return { ...result, data: JSON.parse(decodeURIComponent(result.data)) };
    } catch {
      return result;
    }
  }

  return result;
}

// ─── Connected ID Management ───

async function createConnectedId(
  db: any,
  companyId: string,
  serviceType: "bank" | "card",
  organization: string,
  loginId: string,
  loginPw: string,
): Promise<string> {
  const orgCode = serviceType === "bank"
    ? resolveCode(BANK_CODES, organization)
    : resolveCode(CARD_CODES, organization);

  if (!orgCode) {
    throw new Error(`지원하지 않는 ${serviceType === "bank" ? "은행" : "카드사"}: ${organization}`);
  }

  const countryCode = "KR";
  const businessType = serviceType === "bank" ? "BK" : "CD";

  // Check if we already have a connectedId for this company
  const { data: existing } = await db
    .from("automation_credentials")
    .select("metadata")
    .eq("company_id", companyId)
    .eq("service", `codef_connected_${serviceType}`)
    .maybeSingle();

  const connectedId = existing?.metadata?.connectedId;

  if (connectedId) {
    // Add account to existing connectedId
    try {
      await codefRequest(ENDPOINTS.ADD_CONNECTED, {
        connectedId,
        accountList: [{
          countryCode,
          businessType,
          organization: orgCode,
          loginType: "1", // ID/PW
          id: loginId,
          password: encodeURIComponent(loginPw),
        }],
      });
      return connectedId;
    } catch {
      // If add fails, try creating new
    }
  }

  // Create new connectedId
  const result = await codefRequest(ENDPOINTS.CREATE_CONNECTED, {
    accountList: [{
      countryCode,
      businessType,
      organization: orgCode,
      loginType: "1",
      id: loginId,
      password: encodeURIComponent(loginPw),
    }],
  });

  const newConnectedId = result?.data?.connectedId;
  if (!newConnectedId) {
    throw new Error("CODEF Connected ID 생성 실패: " + JSON.stringify(result));
  }

  // Save connectedId
  await db
    .from("automation_credentials")
    .upsert({
      company_id: companyId,
      service: `codef_connected_${serviceType}`,
      credentials: "{}",
      metadata: { connectedId: newConnectedId },
      updated_at: new Date().toISOString(),
    }, { onConflict: "company_id,service" });

  return newConnectedId;
}

function resolveCode(codeMap: Record<string, string>, name: string): string | null {
  const lower = name.toLowerCase().trim();
  // Direct match
  if (codeMap[name]) return codeMap[name];
  // Case-insensitive search
  for (const [key, val] of Object.entries(codeMap)) {
    if (key.toLowerCase() === lower || lower.includes(key.toLowerCase())) {
      return val;
    }
  }
  // If it's already a code (4 digits)
  if (/^\d{4}$/.test(name)) return name;
  return null;
}

// ─── Bank Transaction Sync ───

async function syncBankTransactions(
  db: any,
  companyId: string,
  startDate: string,
  endDate: string,
): Promise<{ count: number; accounts: number; message: string }> {
  // Get stored bank credentials
  const { data: creds } = await db
    .from("automation_credentials")
    .select("service, credentials, metadata")
    .eq("company_id", companyId)
    .like("service", "bank_%");

  if (!creds || creds.length === 0) {
    return { count: 0, accounts: 0, message: "등록된 은행 계정 없음" };
  }

  // Get or create connected ID
  const { data: connectedData } = await db
    .from("automation_credentials")
    .select("metadata")
    .eq("company_id", companyId)
    .eq("service", "codef_connected_bank")
    .maybeSingle();

  let connectedId = connectedData?.metadata?.connectedId;

  // Decrypt and register credentials if no connectedId
  if (!connectedId) {
    for (const cred of creds) {
      try {
        // Decrypt credentials from DB
        const { data: decrypted } = await db.rpc("decrypt_credential", {
          company_id_param: companyId,
          service_param: cred.service,
        });

        if (!decrypted) continue;
        const parsed = typeof decrypted === "string" ? JSON.parse(decrypted) : decrypted;
        const bankName = cred.service.replace("bank_", "").replace(/_\d+$/, "");

        connectedId = await createConnectedId(
          db, companyId, "bank", bankName,
          parsed.loginId || parsed.id || parsed.username,
          parsed.loginPw || parsed.password || parsed.pw,
        );
        break; // Use first successful registration
      } catch (err) {
        console.error(`Bank credential registration failed for ${cred.service}:`, err);
      }
    }
  }

  if (!connectedId) {
    return { count: 0, accounts: 0, message: "은행 계정 연결 실패 — CODEF Connected ID를 생성할 수 없습니다" };
  }

  // Step 1: Fetch account list
  let accountList: any[] = [];
  try {
    const accountResult = await codefRequest(ENDPOINTS.BANK_ACCOUNT_LIST, {
      connectedId,
      organization: "",
    });
    accountList = accountResult?.data?.resAccountList || accountResult?.data || [];
  } catch (err) {
    // Try personal bank API
    try {
      const accountResult = await codefRequest(ENDPOINTS.BANK_P_ACCOUNT_LIST, {
        connectedId,
        organization: "",
      });
      accountList = accountResult?.data?.resAccountList || accountResult?.data || [];
    } catch (err2) {
      return { count: 0, accounts: 0, message: `계좌 목록 조회 실패: ${(err2 as Error).message}` };
    }
  }

  if (!Array.isArray(accountList) || accountList.length === 0) {
    return { count: 0, accounts: 0, message: "연결된 계좌가 없습니다" };
  }

  // Step 2: Upsert bank accounts
  let totalTxCount = 0;

  for (const account of accountList) {
    const accountNum = account.resAccount || account.resAccountNum || "";
    const bankCode = account.resAccountBankCode || account.organization || "";
    const bankName = account.resAccountBankName || getBankName(bankCode) || bankCode;
    const balance = parseFloat(account.resAccountBalance || account.resBalance || "0");
    const accountName = account.resAccountName || account.resAccountAlias || `${bankName} ${accountNum.slice(-4)}`;

    // Upsert bank_accounts
    const { data: upsertedAccount } = await db
      .from("bank_accounts")
      .upsert({
        company_id: companyId,
        bank_name: bankName,
        account_number: accountNum,
        alias: accountName,
        balance,
        currency: "KRW",
        is_active: true,
        codef_connected_id: connectedId,
        codef_organization: bankCode,
        updated_at: new Date().toISOString(),
      }, { onConflict: "company_id,account_number" })
      .select("id")
      .single();

    const accountId = upsertedAccount?.id;

    // Step 3: Fetch transactions for each account
    try {
      const txEndpoint = ENDPOINTS.BANK_TRANSACTION_LIST;
      const txResult = await codefRequest(txEndpoint, {
        connectedId,
        organization: bankCode,
        account: accountNum,
        startDate,
        endDate,
        orderBy: "0", // desc
        inquiryType: "1", // 전체
      });

      const txList = txResult?.data?.resTrHistoryList || txResult?.data || [];

      if (Array.isArray(txList)) {
        for (const tx of txList) {
          const amount = Math.abs(parseFloat(tx.resAccountTrAmount || tx.resAmount || "0"));
          const balanceAfter = parseFloat(tx.resAccountBalance || tx.resAfterBalance || "0");
          const isIncome = (tx.resAccountIn || tx.resType || "") === "1" || amount > 0 && (tx.resAccountOut || "") === "";
          const counterparty = tx.resAccountDesc1 || tx.resAccountMemo || tx.resRemark || "";
          const txDate = tx.resAccountTrDate || tx.resDate || startDate;
          const txTime = tx.resAccountTrTime || tx.resTime || "000000";

          const transactionDate = `${txDate.slice(0, 4)}-${txDate.slice(4, 6)}-${txDate.slice(6, 8)}T${txTime.slice(0, 2)}:${txTime.slice(2, 4)}:${txTime.slice(4, 6)}+09:00`;

          // Upsert into transactions table
          await db
            .from("transactions")
            .upsert({
              company_id: companyId,
              bank_account_id: accountId,
              type: isIncome ? "income" : "expense",
              amount,
              description: counterparty,
              counterparty,
              transaction_date: transactionDate,
              balance_after: balanceAfter,
              source: "codef",
              external_id: `${accountNum}_${txDate}_${txTime}_${amount}`,
              created_at: new Date().toISOString(),
            }, { onConflict: "company_id,external_id" });

          totalTxCount++;
        }
      }
    } catch (txErr) {
      console.error(`Transaction fetch failed for ${accountNum}:`, txErr);
    }
  }

  return {
    count: totalTxCount,
    accounts: accountList.length,
    message: `${accountList.length}개 계좌에서 ${totalTxCount}건 거래내역 동기화 완료`,
  };
}

// ─── Card Transaction Sync ───

async function syncCardTransactions(
  db: any,
  companyId: string,
  startDate: string,
  endDate: string,
): Promise<{ count: number; cards: number; message: string }> {
  // Get stored card credentials
  const { data: creds } = await db
    .from("automation_credentials")
    .select("service, credentials, metadata")
    .eq("company_id", companyId)
    .like("service", "card_%");

  if (!creds || creds.length === 0) {
    return { count: 0, cards: 0, message: "등록된 카드 계정 없음" };
  }

  // Get or create connected ID
  const { data: connectedData } = await db
    .from("automation_credentials")
    .select("metadata")
    .eq("company_id", companyId)
    .eq("service", "codef_connected_card")
    .maybeSingle();

  let connectedId = connectedData?.metadata?.connectedId;

  if (!connectedId) {
    for (const cred of creds) {
      try {
        const { data: decrypted } = await db.rpc("decrypt_credential", {
          company_id_param: companyId,
          service_param: cred.service,
        });

        if (!decrypted) continue;
        const parsed = typeof decrypted === "string" ? JSON.parse(decrypted) : decrypted;
        const cardCompany = cred.service.replace("card_", "").replace(/_\d+$/, "");

        connectedId = await createConnectedId(
          db, companyId, "card", cardCompany,
          parsed.loginId || parsed.id || parsed.username,
          parsed.loginPw || parsed.password || parsed.pw,
        );
        break;
      } catch (err) {
        console.error(`Card credential registration failed for ${cred.service}:`, err);
      }
    }
  }

  if (!connectedId) {
    return { count: 0, cards: 0, message: "카드사 연결 실패 — CODEF Connected ID를 생성할 수 없습니다" };
  }

  // Fetch card transaction list
  let totalTxCount = 0;
  let cardCount = 0;

  // Try to get card list first
  let cardList: any[] = [];
  try {
    const cardResult = await codefRequest(ENDPOINTS.CARD_LIST, {
      connectedId,
      organization: "",
    });
    cardList = cardResult?.data?.resCardList || cardResult?.data || [];
  } catch {
    // Proceed with direct transaction fetch if card list fails
    cardList = [{ resCardNo: "", organization: "" }];
  }

  for (const card of cardList) {
    const cardNumber = card.resCardNo || card.resCardNumber || "";
    const cardOrg = card.organization || card.resCardCompanyCode || "";
    const cardName = card.resCardName || card.resCardAlias || getCardCompanyName(cardOrg) || "";

    // Upsert corporate card record
    if (cardNumber) {
      await db
        .from("corporate_cards")
        .upsert({
          company_id: companyId,
          card_company: cardName || getCardCompanyName(cardOrg) || cardOrg,
          card_number: cardNumber,
          card_alias: cardName || `카드 ${cardNumber.slice(-4)}`,
          is_active: true,
          codef_connected_id: connectedId,
          updated_at: new Date().toISOString(),
        }, { onConflict: "company_id,card_number" })
        .select("id")
        .single();
    }

    cardCount++;

    // Fetch transactions (billing list)
    try {
      const txResult = await codefRequest(ENDPOINTS.CARD_TRANSACTION_LIST, {
        connectedId,
        organization: cardOrg,
        startDate,
        endDate,
        orderBy: "0",
        cardNo: cardNumber,
        inquiryType: "0", // 승인내역
      });

      const txList = txResult?.data?.resBillingList || txResult?.data?.resApprovalList || txResult?.data || [];

      if (Array.isArray(txList)) {
        for (const tx of txList) {
          const amount = Math.abs(parseFloat(tx.resUsedAmount || tx.resAmount || tx.resBillingAmount || "0"));
          const merchantName = tx.resStoreName || tx.resMerchantName || tx.resUsedStore || "";
          const txDate = tx.resUsedDate || tx.resDate || tx.resBillingDate || startDate;
          const txTime = tx.resUsedTime || tx.resTime || "000000";
          const approvalNum = tx.resApprovalNo || tx.resApprovalNumber || "";
          const category = tx.resCategory || "";
          const installment = parseInt(tx.resInstallmentCount || tx.resInstallment || "0", 10);

          const transactionDate = `${txDate.slice(0, 4)}-${txDate.slice(4, 6)}-${txDate.slice(6, 8)}`;

          await db
            .from("card_transactions")
            .upsert({
              company_id: companyId,
              card_number: cardNumber,
              card_company: cardName || getCardCompanyName(cardOrg),
              merchant_name: merchantName,
              amount,
              transaction_date: transactionDate,
              approval_number: approvalNum,
              category: category || null,
              installment_months: installment || null,
              status: "approved",
              source: "codef",
              external_id: `${cardNumber}_${txDate}_${approvalNum}_${amount}`,
              created_at: new Date().toISOString(),
            }, { onConflict: "company_id,external_id" });

          totalTxCount++;
        }
      }
    } catch (txErr) {
      console.error(`Card transaction fetch failed for ${cardNumber}:`, txErr);
    }
  }

  return {
    count: totalTxCount,
    cards: cardCount,
    message: `${cardCount}개 카드에서 ${totalTxCount}건 카드내역 동기화 완료`,
  };
}

// ─── Helper: Bank/Card name lookup ───

function getBankName(code: string): string {
  const reverse: Record<string, string> = {};
  for (const [name, c] of Object.entries(BANK_CODES)) {
    if (!reverse[c]) reverse[c] = name;
  }
  return reverse[code] || code;
}

function getCardCompanyName(code: string): string {
  const reverse: Record<string, string> = {};
  for (const [name, c] of Object.entries(CARD_CODES)) {
    if (!reverse[c]) reverse[c] = name;
  }
  return reverse[code] || code;
}

// ─── Date Helpers ───

function formatCodefDate(dateStr?: string): string {
  if (dateStr && /^\d{8}$/.test(dateStr)) return dateStr;
  if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr.replace(/-/g, "");
  // Default: 3 months ago
  const d = new Date();
  d.setMonth(d.getMonth() - 3);
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

function formatCodefEndDate(dateStr?: string): string {
  if (dateStr && /^\d{8}$/.test(dateStr)) return dateStr;
  if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr.replace(/-/g, "");
  return new Date().toISOString().slice(0, 10).replace(/-/g, "");
}

// ─── Main Handler ───

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ success: false, message: "인증 필요" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(supabaseUrl, supabaseKey);

    // Verify user
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ success: false, message: "인증 실패" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body: CodefSyncRequest = await req.json();
    const { companyId, syncType, startDate, endDate } = body;

    if (!companyId) {
      return new Response(JSON.stringify({ success: false, message: "companyId 필수" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const start = formatCodefDate(startDate);
    const end = formatCodefEndDate(endDate);

    const results: Record<string, any> = {};
    const errors: string[] = [];

    // Log sync start
    const logId = await logSyncStart(db, companyId, syncType, user.id);

    // Bank sync
    if (syncType === "bank" || syncType === "all") {
      try {
        results.bank = await syncBankTransactions(db, companyId, start, end);
      } catch (err) {
        const msg = `은행 동기화 실패: ${(err as Error).message}`;
        errors.push(msg);
        results.bank = { count: 0, accounts: 0, message: msg };
      }
    }

    // Card sync
    if (syncType === "card" || syncType === "all") {
      try {
        results.card = await syncCardTransactions(db, companyId, start, end);
      } catch (err) {
        const msg = `카드 동기화 실패: ${(err as Error).message}`;
        errors.push(msg);
        results.card = { count: 0, cards: 0, message: msg };
      }
    }

    // Log sync complete
    await logSyncComplete(db, logId, results, errors);

    const totalCount = (results.bank?.count || 0) + (results.card?.count || 0);

    return new Response(
      JSON.stringify({
        success: errors.length === 0,
        message: errors.length > 0
          ? `일부 동기화 실패 (${errors.length}건 오류)`
          : `${totalCount}건 데이터 동기화 완료`,
        data: results,
        errors: errors.length > 0 ? errors : undefined,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("CODEF sync error:", err);
    return new Response(
      JSON.stringify({ success: false, message: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

// ─── Logging ───

async function logSyncStart(db: any, companyId: string, syncType: string, userId: string): Promise<string | null> {
  try {
    const { data } = await db
      .from("automation_logs")
      .insert({
        company_id: companyId,
        service: `codef_${syncType}`,
        action: "sync",
        status: "running",
        details: { syncType, startedAt: new Date().toISOString(), triggeredBy: userId },
      })
      .select("id")
      .single();
    return data?.id || null;
  } catch { return null; }
}

async function logSyncComplete(db: any, logId: string | null, results: any, errors: string[]): Promise<void> {
  if (!logId) return;
  try {
    await db
      .from("automation_logs")
      .update({
        status: errors.length > 0 ? "failed" : "completed",
        details: { results, errors, completedAt: new Date().toISOString() },
      })
      .eq("id", logId);
  } catch { /* ignore */ }
}
