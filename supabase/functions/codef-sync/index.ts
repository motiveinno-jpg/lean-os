import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { publicEncrypt, constants } from "node:crypto";
import { Buffer } from "node:buffer";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// CODEF API endpoints — sandbox for testing, development for demo, api for production
const CODEF_ENV = Deno.env.get("CODEF_ENV") || "sandbox";
const CODEF_BASE = CODEF_ENV === "production"
  ? "https://api.codef.io"
  : CODEF_ENV === "development"
    ? "https://development.codef.io"
    : "https://sandbox.codef.io";
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

  const basicAuth = btoa(`${clientId}:${clientSecret}`);
  const res = await fetch(CODEF_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basicAuth}`,
    },
    body: "grant_type=client_credentials&scope=read",
  });

  if (!res.ok) throw new Error(`CODEF token error: ${res.status}`);
  const data = await res.json();
  tokenCache = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return data.access_token;
}

async function codefRequest(token: string, path: string, body: Record<string, any>): Promise<any> {
  const sanitizedBody = { ...body };
  if (sanitizedBody.accountList) {
    sanitizedBody.accountList = (sanitizedBody.accountList as any[]).map((a: any) => ({
      ...a,
      password: a.password ? "[ENCRYPTED]" : undefined,
      derFile: a.derFile ? `[${a.derFile.length} chars]` : undefined,
      keyFile: a.keyFile ? `[${a.keyFile.length} chars]` : undefined,
    }));
  }
  console.log(`[CODEF] ${path}`, JSON.stringify(sanitizedBody));

  const res = await fetch(`${CODEF_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Bearer ${token}`,
    },
    body: encodeURIComponent(JSON.stringify(body)),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error(`[CODEF] HTTP ${res.status}: ${errText}`);
    throw new Error(`CODEF API error: ${res.status}`);
  }
  const text = await res.text();
  let parsed: any;
  try {
    const decoded = decodeURIComponent(text);
    parsed = JSON.parse(decoded);
  } catch {
    parsed = JSON.parse(text);
  }
  console.log(`[CODEF] Response:`, JSON.stringify({ code: parsed.result?.code, message: parsed.result?.message, extraMessage: parsed.result?.extraMessage }));
  return parsed;
}

// Known CODEF error codes → actionable hints (한글).
// Keep in sync with https://developer.codef.io/products/errorCodes
function codefErrorHint(code?: string): string {
  if (!code) return "응답을 받지 못했습니다. 네트워크 상태를 확인하세요.";
  if (code === "CF-00000") return "";
  if (code.startsWith("CF-09")) {
    return "CODEF 서버 일시장애. 잠시 후 다시 시도하세요. 지속 발생 시 CODEF 대시보드의 '오류 로그'를 확인해주세요.";
  }
  if (code === "CF-00003") {
    return "CODEF 대시보드에서 해당 상품이 활성화되지 않았습니다. CODEF 관리자 페이지 → 상품 관리에서 활성화하세요.";
  }
  if (code === "CF-00401") {
    return "해당 API 상품의 조회 권한이 없습니다. CODEF 대시보드 → 상품 관리에서 '법인 은행 거래내역 조회' 상품을 활성화하세요.";
  }
  if (code === "CF-04015" || code.startsWith("CF-0401")) {
    return "Connected ID/인증 정보가 만료되었습니다. 설정 → API 연동에서 은행/카드 계정을 다시 등록하세요.";
  }
  if (code.startsWith("CF-03") || code.startsWith("CF-04")) {
    return "인증 실패. 아이디/비밀번호 또는 공동인증서 상태를 확인하세요.";
  }
  if (code.startsWith("CF-12")) {
    return "기관 응답 지연/오류. 해당 은행 또는 카드사 점검 시간을 피해 재시도하세요.";
  }
  if (code === "CF-13021") {
    return "보유계좌 형식 불일치. CODEF에 등록된 계좌 종류(입출금/펀드/대출 등)를 확인하세요. 거래내역은 입출금 계좌만 조회 가능합니다.";
  }
  if (code === "NO_DEMAND_DEPOSIT") {
    return "거래내역 조회 가능한 입출금 계좌가 등록되어 있지 않습니다. CODEF 대시보드에서 보통예금/당좌예금 계좌를 추가 등록하세요.";
  }
  return "CODEF 오류가 발생했습니다. 코드와 메시지를 CODEF 대시보드에서 검색해 대응하세요.";
}

type SyncError = { accountNo: string; organization: string; code: string; message: string; hint: string };

async function syncBankTransactions(
  supabase: any, token: string, companyId: string, connectedId: string,
  startDate: string, endDate: string
) {
  const errors: SyncError[] = [];
  let totalSynced = 0;
  const debug: string[] = [];

  // 1. 등록된 은행 기관 코드 추출
  const registeredAccounts = await getAccountList(token, connectedId);
  debug.push(`registeredAccounts: ${registeredAccounts.length}개, orgs: ${registeredAccounts.map((a: any) => `${a.organization}(${a.businessType})`).join(",")}`);

  const bankOrgs = new Set<string>();
  for (const acct of registeredAccounts) {
    const org = acct.organization;
    if (!org) continue;
    if (CARD_CODES[org]) continue;
    if (acct.businessType === "BK" || BANK_CODES[org]) {
      bankOrgs.add(org);
    }
  }

  debug.push(`bankOrgs: ${[...bankOrgs].join(",") || "없음"}`);

  if (bankOrgs.size === 0) {
    errors.push({ accountNo: "", organization: "", code: "NO_BANK_ACCOUNTS", message: "등록된 은행 계정이 없습니다.", hint: "설정 → API 연동에서 은행을 먼저 연결하세요." });
    return { synced: 0, errors, debug };
  }

  // 2. 각 은행에서 보유계좌 목록 조회 → 실제 계좌번호 확보
  for (const org of bankOrgs) {
    const acctListResult = await codefRequest(token, "/v1/kr/bank/b/account/account-list", {
      connectedId, organization: org,
    });

    if (acctListResult.result?.code !== "CF-00000") {
      debug.push(`bank ${org} account-list FAILED: ${acctListResult.result?.code} ${acctListResult.result?.message}`);
      errors.push({ accountNo: "", organization: org, code: acctListResult.result?.code || "UNKNOWN", message: acctListResult.result?.message || "보유계좌 조회 실패", hint: codefErrorHint(acctListResult.result?.code) });
      continue;
    }

    const dataKeys = Object.keys(acctListResult.data || {});
    debug.push(`bank ${org} account-list OK, data keys: [${dataKeys.join(",")}]`);

    // CODEF bank account-list returns categorized arrays.
    // 일반 거래내역 조회(/transaction-list)는 입출금 계좌(resAccountList)만 지원.
    // 펀드/외화/대출/예신탁은 별도 API 필요 — 여기서 호출하면 CF-13021 발생.
    const acctData = acctListResult.data || {};
    const demandDeposits = acctData.resAccountList || [];
    const otherCounts = {
      depositTrust: (acctData.resDepositTrust || []).length,
      foreignCurrency: (acctData.resForeignCurrency || []).length,
      fund: (acctData.resFund || []).length,
      loan: (acctData.resLoan || []).length,
    };
    const otherTotal = otherCounts.depositTrust + otherCounts.foreignCurrency + otherCounts.fund + otherCounts.loan;
    debug.push(`bank ${org} demandDeposits: ${demandDeposits.length}개, others: 예신탁${otherCounts.depositTrust}/외화${otherCounts.foreignCurrency}/펀드${otherCounts.fund}/대출${otherCounts.loan}`);

    if (demandDeposits.length > 0) {
      const firstAcct = demandDeposits[0];
      debug.push(`bank ${org} firstAccount keys: [${Object.keys(firstAcct).join(",")}]`);
      debug.push(`bank ${org} firstAccount sample: resAccount=${firstAcct.resAccount}, resAccountNo=${firstAcct.resAccountNo}, resAccountDisplay=${firstAcct.resAccountDisplay}`);
    } else if (otherTotal > 0) {
      // 입출금 계좌가 없고 다른 종류만 있을 때 — 명확한 메시지 한 번만
      const otherDesc = [
        otherCounts.depositTrust ? `예신탁 ${otherCounts.depositTrust}개` : "",
        otherCounts.foreignCurrency ? `외화 ${otherCounts.foreignCurrency}개` : "",
        otherCounts.fund ? `펀드 ${otherCounts.fund}개` : "",
        otherCounts.loan ? `대출 ${otherCounts.loan}개` : "",
      ].filter(Boolean).join(", ");
      errors.push({
        accountNo: "",
        organization: org,
        code: "NO_DEMAND_DEPOSIT",
        message: `${BANK_CODES[org] || org}에 거래내역 조회 가능한 입출금 계좌가 없습니다 (${otherDesc}만 등록됨).`,
        hint: "CODEF 대시보드에서 보통예금/당좌예금 등 입출금 계좌도 추가 등록하세요. 펀드/대출/외화/예신탁은 거래내역 조회 미지원입니다.",
      });
      continue;
    }

    if (demandDeposits.length === 0) continue;

    // 3. 각 계좌의 거래내역 조회
    let orgPermissionDenied = false;
    let orgAccountMismatchReported = false;
    for (const bankAcct of demandDeposits) {
      const accountNo = bankAcct.resAccount || bankAcct.resAccountNo || bankAcct.resAccountDisplay || "";
      if (!accountNo) continue;

      const result = await codefRequest(token, "/v1/kr/bank/b/account/transaction-list", {
        connectedId, organization: org, account: accountNo,
        startDate, endDate, orderBy: "0", inquiryType: "1",
      });

      if (result.result?.code !== "CF-00000") {
        const code = result.result?.code || "UNKNOWN";
        if (code === "CF-00401" && !orgPermissionDenied) {
          orgPermissionDenied = true;
          errors.push({ accountNo: "", organization: org, code: "CF-00401", message: `${BANK_CODES[org] || org} 거래내역 조회 권한 없음 (${demandDeposits.length}개 계좌)`, hint: codefErrorHint("CF-00401") });
        } else if (code === "CF-13021" && !orgAccountMismatchReported) {
          // 같은 organization 안의 다중 CF-13021은 한 번만 push (계좌 형식 불일치 노이즈)
          orgAccountMismatchReported = true;
          errors.push({ accountNo: "", organization: org, code: "CF-13021", message: `${BANK_CODES[org] || org}: 일부 계좌(${demandDeposits.length}개 중)가 거래내역 조회 형식과 일치하지 않습니다.`, hint: "CODEF 대시보드에서 등록 계좌 종류를 확인하거나 입출금 계좌만 다시 등록하세요." });
        } else if (code !== "CF-00401" && code !== "CF-13021") {
          errors.push({ accountNo, organization: org, code, message: result.result?.message || "거래내역 조회 실패", hint: codefErrorHint(code) });
        }
        if (orgPermissionDenied) continue;
        continue;
      }

      const txData = result.data?.resTrHistoryList ?? result.data;
      const transactions = Array.isArray(txData) ? txData : txData ? [txData] : [];

      for (const tx of transactions) {
        if (!tx.resAccountTrDate && !tx.resTrDate) continue;
        const trDate = tx.resAccountTrDate || tx.resTrDate;
        const formattedDate = `${trDate.slice(0,4)}-${trDate.slice(4,6)}-${trDate.slice(6,8)}`;
        const inAmt = Number(tx.resAccountIn || 0);
        const outAmt = Number(tx.resAccountOut || 0);

        const { error } = await supabase.from("bank_transactions").insert({
          company_id: companyId,
          transaction_date: formattedDate,
          amount: inAmt > 0 ? inAmt : -outAmt,
          balance_after: Number(tx.resAfterTranBalance || 0),
          type: inAmt > 0 ? "입금" : "출금",
          counterparty: tx.resAccountDesc || "",
          description: tx.resAccountMemo || "",
          source: "codef_bank",
          mapping_status: "unmapped",
          raw_data: { accountNo, organization: org, trDate, trTime: tx.resAccountTrTime || "" },
        });

        if (!error) totalSynced++;
      }
    }
  }

  return { synced: totalSynced, errors, debug };
}

async function syncCardBilling(
  supabase: any, token: string, companyId: string, connectedId: string,
  startDate: string, endDate: string
) {
  const errors: SyncError[] = [];
  const debug: string[] = [];

  const accounts = await getAccountList(token, connectedId, "card");
  const cardOrgs = new Set<string>();
  for (const acct of accounts) {
    const org = acct.organization;
    if (!org) continue;
    if (acct.businessType === "CD" || CARD_CODES[org]) {
      cardOrgs.add(org);
    }
  }
  if (cardOrgs.size === 0) {
    errors.push({
      accountNo: "",
      organization: "",
      code: "NO_CARD_ACCOUNTS",
      message: "등록된 카드 계정이 없습니다. 설정에서 카드를 먼저 연결하세요.",
      hint: "설정 → API 연동에서 카드 계정을 등록하세요.",
    });
    return { synced: 0, errors, debug };
  }

  debug.push(`cardOrgs: ${[...cardOrgs].join(",")}`);
  let totalSynced = 0;
  let debuggedChargeKeys = false;
  let debuggedInsertErr = false;

  // 카드 청구 내역은 YYYYMM 6자리 날짜
  const billingStart = startDate.slice(0, 6);
  const billingEnd = endDate.slice(0, 6);

  for (const org of cardOrgs) {
    const result = await codefRequest(token, "/v1/kr/card/b/account/billing-list", {
      connectedId, organization: org, startDate: billingStart, endDate: billingEnd, orderBy: "0", inquiryType: "1",
    });

    if (result.result?.code !== "CF-00000") {
      errors.push({
        accountNo: "",
        organization: org,
        code: result.result?.code || "UNKNOWN",
        message: result.result?.message || "응답 없음",
        hint: codefErrorHint(result.result?.code),
      });
      continue;
    }
    if (!result.data) { debug.push(`card ${org} billing: data is null/undefined`); continue; }

    const dataKeys = Object.keys(result.data || {});
    debug.push(`card ${org} billing OK, data keys: [${dataKeys.join(",")}], isArray: ${Array.isArray(result.data)}`);

    // CODEF 카드 청구 응답: data 자체가 배열이거나, data.resBillingList 안에 있을 수 있음
    const rawBillings = result.data?.resBillingList ?? result.data;
    const billings = Array.isArray(rawBillings) ? rawBillings : rawBillings ? [rawBillings] : [];
    debug.push(`card ${org} billings count: ${billings.length}`);
    if (billings.length > 0) {
      debug.push(`card ${org} firstBilling keys: [${Object.keys(billings[0]).join(",")}]`);
    }

    for (const bill of billings) {
      // Each billing period contains resChargeHistoryList with actual transactions
      const charges = bill.resChargeHistoryList || [];
      const cardNo = bill.resCardNo || "";
      debug.push(`card ${org} billing ${bill.resPaymentDueDate || "?"}: ${charges.length} charges`);

      if (charges.length > 0 && !debuggedChargeKeys) {
        debug.push(`card ${org} firstCharge keys: [${Object.keys(charges[0]).join(",")}]`);
        debug.push(`card ${org} firstCharge sample: resUsedDate=${charges[0].resUsedDate}, resUsedAmount=${charges[0].resUsedAmount}, resStoreName=${charges[0].resStoreName}`);
        debuggedChargeKeys = true;
      }

      for (const charge of charges) {
        const usedDate = charge.resUsedDate || charge.resDate || "";
        const usedAmount = charge.resUsedAmount || charge.resAmount || charge.resMemberStoreAmt || 0;
        const storeName = charge.resStoreName || charge.resMemberStoreName || charge.resUsedStore || "";
        const approvalNo = charge.resCardApprovalNo || charge.resApprovalNo || "";
        const externalId = `codef_card_${org}_${usedDate}_${charge.resUsedTime || ""}_${approvalNo || totalSynced}`;
        const formattedDate = usedDate.length >= 8
          ? `${usedDate.slice(0,4)}-${usedDate.slice(4,6)}-${usedDate.slice(6,8)}`
          : new Date().toISOString().split("T")[0];

        const { error } = await supabase.from("card_transactions").upsert({
          company_id: companyId,
          external_id: externalId,
          amount: Number(usedAmount),
          merchant_name: storeName,
          transaction_date: formattedDate,
          approval_number: approvalNo || null,
          card_name: charge.resCardName || CARD_CODES[org] || null,
          source: "codef_card",
          mapping_status: "unmapped",
          raw_data: { cardNo, organization: org, usedDate, usedTime: charge.resUsedTime || "", charge },
        }, { onConflict: "external_id" });

        if (error) {
          if (!debuggedInsertErr) {
            debug.push(`card ${org} insert error: ${error.message} | code: ${error.code}`);
            debuggedInsertErr = true;
          }
        } else {
          totalSynced++;
        }
      }
    }
  }

  return { synced: totalSynced, errors, debug };
}

// RSA encrypt password with CODEF public key (PKCS1v1.5 padding required by CODEF)
function rsaEncrypt(plainText: string, publicKeyRaw: string): string {
  const base64Body = publicKeyRaw
    .replace(/-----BEGIN PUBLIC KEY-----/, "")
    .replace(/-----END PUBLIC KEY-----/, "")
    .replace(/\s/g, "");
  const lines = base64Body.match(/.{1,64}/g)?.join("\n") || base64Body;
  const pem = `-----BEGIN PUBLIC KEY-----\n${lines}\n-----END PUBLIC KEY-----`;
  const encrypted = publicEncrypt(
    { key: pem, padding: constants.RSA_PKCS1_PADDING },
    Buffer.from(plainText, "utf8"),
  );
  return encrypted.toString("base64");
}

// Register account and get connectedId (ID/PW or certificate)
async function registerAccount(
  token: string, accountType: "bank" | "card",
  organization: string,
  loginOpts: {
    loginType: "0" | "1";
    loginId?: string; loginPw?: string;
    derFile?: string; keyFile?: string; certPassword?: string;
    pfxFile?: string;
    clientType?: "P" | "B";
  },
  existingConnectedId?: string,
): Promise<{ connectedId: string; accountList?: any[] }> {
  const publicKey = Deno.env.get("CODEF_PUBLIC_KEY") || "";
  console.log(`[CODEF] registerAccount: env=${CODEF_ENV}, hasPublicKey=${!!publicKey}, publicKeyLen=${publicKey.length}, org=${organization}, loginType=${loginOpts.loginType}, hasDer=${!!loginOpts.derFile}, hasKey=${!!loginOpts.keyFile}, hasCertPw=${!!loginOpts.certPassword}, existingCid=${!!existingConnectedId}`);

  const path = existingConnectedId ? "/v1/account/add" : "/v1/account/create";

  const accountEntry: Record<string, any> = {
    countryCode: "KR",
    businessType: accountType === "card" ? "CD" : accountType === "hometax" ? "PB" : "BK",
    clientType: loginOpts.clientType || "B",
    organization,
    loginType: loginOpts.loginType,
  };

  if (loginOpts.loginType === "1") {
    // ID/PW 로그인
    const encryptedPw = publicKey ? rsaEncrypt(loginOpts.loginPw || "", publicKey) : (loginOpts.loginPw || "");
    accountEntry.id = loginOpts.loginId || "";
    accountEntry.password = encryptedPw;
  } else {
    // 공동인증서 로그인
    const encryptedCertPw = publicKey ? rsaEncrypt(loginOpts.certPassword || "", publicKey) : (loginOpts.certPassword || "");
    accountEntry.password = encryptedCertPw;

    if (loginOpts.pfxFile) {
      accountEntry.certType = "0";
      accountEntry.certFile = loginOpts.pfxFile;
    } else {
      accountEntry.certType = "1";
      accountEntry.derFile = loginOpts.derFile || "";
      accountEntry.keyFile = loginOpts.keyFile || "";
    }
  }

  const body: Record<string, any> = { accountList: [accountEntry] };

  if (existingConnectedId) {
    body.connectedId = existingConnectedId;
  }

  const result = await codefRequest(token, path, body);

  if (result.result?.code !== "CF-00000") {
    const hint = codefErrorHint(result.result?.code);
    const extraMessage = result.result?.extraMessage || result.data?.errorMessage || "";
    console.error(`[CODEF] Registration failed — full response:`, JSON.stringify(result));
    const err: any = new Error(`계정 등록 실패: ${result.result?.message || "알 수 없는 오류"} (${result.result?.code})${extraMessage ? " [" + extraMessage + "]" : ""}${hint ? " — " + hint : ""}`);
    err.codefResponse = result;
    err.diagnostics = {
      env: CODEF_ENV,
      baseUrl: CODEF_BASE,
      publicKeyLen: publicKey.length,
      publicKeyHash: publicKey.length > 0 ? "set" : "missing",
      organization,
      loginType: loginOpts.loginType,
      hasDerFile: !!loginOpts.derFile,
      derFileLen: loginOpts.derFile?.length || 0,
      hasKeyFile: !!loginOpts.keyFile,
      keyFileLen: loginOpts.keyFile?.length || 0,
      hasPfxFile: !!loginOpts.pfxFile,
      hasCertPassword: !!loginOpts.certPassword,
      certPasswordLen: loginOpts.certPassword?.length || 0,
      usedPath: path,
      hadExistingCid: !!existingConnectedId,
    };
    throw err;
  }

  return {
    connectedId: result.data?.connectedId || existingConnectedId || "",
    accountList: result.data?.accountList,
  };
}

// Get account list (registered accounts under connectedId)
async function getAccountList(
  token: string, connectedId: string, _accountType?: "bank" | "card",
): Promise<any[]> {
  const result = await codefRequest(token, "/v1/account/list", {
    connectedId,
  });

  if (result.result?.code !== "CF-00000") return [];
  // CODEF returns { data: { connectedId, accountList: [...] } }
  const accounts = result.data?.accountList ?? result.data;
  console.log(`[CODEF] accountList raw:`, JSON.stringify(accounts));
  return Array.isArray(accounts) ? accounts : accounts ? [accounts] : [];
}

// HomeTax tax invoice sync via CODEF API
async function syncHometaxInvoices(
  supabase: any, token: string, companyId: string, connectedId: string,
  startDate: string, endDate: string
) {
  const errors: SyncError[] = [];
  let totalSynced = 0;

  // 국세청(홈택스) organization code
  const HOMETAX_ORG = "0004";

  // 한 organization에서 같은 에러는 한 번만 보고 (매출/매입 중복 제거)
  const reportedCodes = new Set<string>();
  // 환경(상품 미활성화/연결 만료/통신 실패)면 매출 단계에서 잡고 매입은 skip
  const fatalCodes = new Set(["CF-00003", "CF-00007", "CF-00401", "CF-04015", "CF-12200"]);
  let hometaxBlocked = false;

  for (const direction of ["매출", "매입"] as const) {
    if (hometaxBlocked) break;

    const result = await codefRequest(token, "/v1/kr/public/nt/taxinvoice/list", {
      connectedId,
      organization: HOMETAX_ORG,
      inquiryType: direction === "매출" ? "0" : "1",
      startDate,
      endDate,
    });

    if (result.result?.code !== "CF-00000") {
      const code = result.result?.code || "UNKNOWN";
      if (!reportedCodes.has(code)) {
        reportedCodes.add(code);
        errors.push({
          accountNo: "",
          organization: HOMETAX_ORG,
          code,
          message: result.result?.message || "응답 없음",
          hint: codefErrorHint(code),
        });
      }
      if (fatalCodes.has(code)) hometaxBlocked = true;
      continue;
    }

    const invoices = Array.isArray(result.data) ? result.data : result.data ? [result.data] : [];

    for (const inv of invoices) {
      const invoiceNumber = inv.resApprovalNo || inv.resInvoiceNumber || "";
      if (!invoiceNumber) continue;

      const issueDate = inv.resIssueDate || inv.resWriteDate || "";
      const formattedDate = issueDate.length === 8
        ? `${issueDate.slice(0,4)}-${issueDate.slice(4,6)}-${issueDate.slice(6,8)}`
        : issueDate;

      const { error } = await supabase.from("tax_invoices").upsert({
        company_id: companyId,
        invoice_number: invoiceNumber,
        issue_date: formattedDate || null,
        supplier_name: inv.resSupplierName || inv.resCompanyNm || "",
        supplier_brn: inv.resSupplierRegNumber || inv.resCompanyBizNo || "",
        buyer_name: inv.resBuyerName || inv.resReceiverNm || "",
        buyer_brn: inv.resBuyerRegNumber || inv.resReceiverBizNo || "",
        supply_amount: Number(inv.resSupplyValue || inv.resSupplyAmt || 0),
        tax_amount: Number(inv.resTaxAmount || inv.resTaxAmt || 0),
        total_amount: Number(inv.resTotalAmount || inv.resTotalAmt || 0),
        item_name: inv.resItemName || inv.resItemNm || null,
        direction: direction === "매출" ? "issued" : "received",
        source: "codef_hometax",
      }, { onConflict: "invoice_number" });

      if (!error) totalSynced++;
    }
  }

  return { synced: totalSynced, errors };
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
    const { companyId, action = "sync", syncType = "all", startDate, endDate, connectedId } = body;

    if (!companyId) return new Response(JSON.stringify({ error: "companyId required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // Get CODEF credentials from company settings
    const { data: settings } = await supabase.from("company_settings").select("codef_client_id, codef_client_secret, codef_connected_id").eq("company_id", companyId).maybeSingle();

    const clientId = settings?.codef_client_id || Deno.env.get("CODEF_CLIENT_ID");
    const clientSecret = settings?.codef_client_secret || Deno.env.get("CODEF_CLIENT_SECRET");
    const cid = connectedId || settings?.codef_connected_id;

    if (!clientId || !clientSecret) {
      return new Response(JSON.stringify({ error: "CODEF API 인증정보가 설정되지 않았습니다. 설정 > API 연동에서 설정해주세요." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const token = await getCodefToken(clientId, clientSecret);

    // --- Action: register (계정 등록 → connectedId 발급) ---
    if (action === "register") {
      const { accountType = "bank", organization, loginId, loginPw, loginType = "1", derFile, keyFile, certPassword, pfxFile, clientType = "B" } = body;

      if (loginType === "0") {
        // 공동인증서 로그인 — PFX 또는 DER+KEY 둘 중 하나 필수
        if (!organization || !certPassword) {
          return new Response(JSON.stringify({ error: "organization, certPassword 필수" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        if (!pfxFile && (!derFile || !keyFile)) {
          return new Response(JSON.stringify({ error: "pfxFile 또는 derFile+keyFile 필수" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      } else {
        // ID/PW 로그인
        if (!organization || !loginId || !loginPw) {
          return new Response(JSON.stringify({ error: "organization, loginId, loginPw 필수" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      }

      let result;
      try {
        result = await registerAccount(token, accountType, organization, { loginType, loginId, loginPw, derFile, keyFile, certPassword, pfxFile, clientType }, cid);
      } catch (regErr: any) {
        // CF-04019/CF-04000 with stale connectedId — retry with fresh /v1/account/create
        if (cid && (regErr.message?.includes("CF-04019") || regErr.message?.includes("CF-04000"))) {
          try {
            result = await registerAccount(token, accountType, organization, { loginType, loginId, loginPw, derFile, keyFile, certPassword, pfxFile, clientType });
          } catch (retryErr: any) {
            return new Response(JSON.stringify({
              error: retryErr.message || "계정 등록 실패",
              codefResponse: retryErr.codefResponse || null,
              diagnostics: retryErr.diagnostics || null,
            }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }
        } else {
          return new Response(JSON.stringify({
            error: regErr.message || "계정 등록 실패",
            codefResponse: regErr.codefResponse || null,
            diagnostics: regErr.diagnostics || null,
          }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      }

      // Save connectedId to company_settings
      if (result.connectedId) {
        await supabase.from("company_settings").upsert({
          company_id: companyId,
          codef_connected_id: result.connectedId,
          codef_connected_at: new Date().toISOString(),
        }, { onConflict: "company_id" });
      }

      return new Response(JSON.stringify({ success: true, connectedId: result.connectedId, accountList: result.accountList }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // --- Action: sandbox-connect (샌드박스 데모 데이터 즉시 연결) ---
    if (action === "sandbox-connect") {
      if (CODEF_ENV === "production") {
        return new Response(JSON.stringify({ error: "프로덕션 환경에서는 샌드박스 연결을 사용할 수 없습니다." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const sandboxConnectedId = "sandbox_connectedId_01";

      // Verify sandbox connection by fetching account list
      const bankAccounts = await getAccountList(token, sandboxConnectedId, "bank");
      const cardAccounts = await getAccountList(token, sandboxConnectedId, "card");

      // Save connectedId to company_settings
      await supabase.from("company_settings").upsert({
        company_id: companyId,
        codef_connected_id: sandboxConnectedId,
        codef_connected_at: new Date().toISOString(),
      }, { onConflict: "company_id" });

      return new Response(JSON.stringify({
        success: true,
        connectedId: sandboxConnectedId,
        bankAccounts: bankAccounts.length,
        cardAccounts: cardAccounts.length,
        accounts: { bank: bankAccounts, card: cardAccounts },
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // --- Action: list-accounts (등록된 계좌/카드 목록) ---
    if (action === "list-accounts") {
      if (!cid) {
        return new Response(JSON.stringify({ error: "Connected ID가 없습니다. 먼저 계정을 등록하세요." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const { accountType = "bank" } = body;
      const allAccounts = await getAccountList(token, cid);

      // 은행/카드 필터링 + 이름 매핑
      const accounts = allAccounts
        .filter((a: any) => {
          const org = a.organization;
          if (!org) return false;
          if (accountType === "bank") return !CARD_CODES[org] && (a.businessType === "BK" || BANK_CODES[org]);
          if (accountType === "card") return CARD_CODES[org] || a.businessType === "CD";
          return true;
        })
        .map((a: any) => ({
          ...a,
          displayName: BANK_CODES[a.organization] || CARD_CODES[a.organization] || a.organization,
        }));

      return new Response(JSON.stringify({ success: true, accounts }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // --- Action: sync (기존 동기화) ---
    if (!cid) {
      return new Response(JSON.stringify({ error: "Connected ID가 없습니다. 설정에서 은행/카드를 먼저 연결하세요." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const end = endDate || new Date().toISOString().split("T")[0].replace(/-/g, "");
    const start = startDate || (() => { const d = new Date(); d.setMonth(d.getMonth() - 3); return d.toISOString().split("T")[0].replace(/-/g, ""); })();

    const results: Record<string, any> = {};

    // syncType="bank_card": 은행+카드만 (홈택스 timeout 분리용 — settings handleSync 1단계에서 사용)
    if (syncType === "bank" || syncType === "all" || syncType === "bank_card") {
      results.bank = await syncBankTransactions(supabase, token, companyId, cid, start, end);
    }

    if (syncType === "card" || syncType === "all" || syncType === "bank_card") {
      results.card = await syncCardBilling(supabase, token, companyId, cid, start, end);
    }

    if (syncType === "hometax" || syncType === "all") {
      results.hometax = await syncHometaxInvoices(supabase, token, companyId, cid, start, end);
    }

    const allErrors: SyncError[] = [
      ...(results.bank?.errors ?? []),
      ...(results.card?.errors ?? []),
      ...(results.hometax?.errors ?? []),
    ];
    // 환경/설정성 에러는 "skipped" 처리 — 다른 sync 성공 시 전체 실패로 보지 않음
    // CF-00003: 상품 미활성화 / CF-00401: 권한 없음 / CF-13021: 계좌 형식 불일치 / NO_DEMAND_DEPOSIT: 입출금 계좌 미등록
    const skippableCodes = new Set(["CF-00003", "CF-00401", "CF-13021", "NO_DEMAND_DEPOSIT"]);
    const criticalErrors = allErrors.filter(e => !skippableCodes.has(e.code));
    const skippedErrors = allErrors.filter(e => skippableCodes.has(e.code));
    const totalSynced =
      (results.bank?.synced ?? 0) + (results.card?.synced ?? 0) + (results.hometax?.synced ?? 0);
    const logStatus =
      criticalErrors.length === 0 ? (skippedErrors.length > 0 ? "partial" : "success") : totalSynced > 0 ? "partial" : "error";

    await supabase.from("sync_logs").insert({
      company_id: companyId,
      sync_type: `codef_${syncType}`,
      status: logStatus,
      details: { ...results, errorCount: allErrors.length, errors: allErrors },
      synced_by: user.id,
    });

    return new Response(
      JSON.stringify({
        success: logStatus !== "error",
        status: logStatus,
        results,
        errors: allErrors,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || "Internal error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
