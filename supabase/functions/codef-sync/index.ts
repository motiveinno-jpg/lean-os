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
    return "CODEF 서비스 상품이 등록되지 않았습니다. CODEF 대시보드에서 해당 상품(은행/카드 계정등록)이 활성화되어 있는지 확인하세요. sandbox 환경에서는 실제 인증서를 사용할 수 없습니다.";
  }
  if (code === "CF-00401") {
    return "해당 API 상품의 조회 권한이 없습니다. CODEF 대시보드 → 상품 관리에서 '은행 > 기업 > 수시입출 거래내역' 또는 '카드 > 법인 > 청구내역' 등 필요한 상품을 운영(Production) 환경에서 활성화하세요. 운영 신청은 1~3영업일 심사가 필요합니다.";
  }
  if (code === "CF-00007") {
    return "요청 파라미터가 CODEF 기준과 맞지 않습니다. 홈택스 등록 시: ① 인증서가 홈택스에 등록된 인증서인지 확인 (은행 전용 인증서는 홈택스 등록 불가) ② 사업자 형태(법인/개인) 일치 ③ CODEF 대시보드에서 '국세청 회원 등록부(계정등록전용상품)' 활성화 여부 확인.";
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
  return "CODEF 오류가 발생했습니다. 코드와 메시지를 CODEF 대시보드에서 검색해 대응하세요.";
}

type SyncError = { accountNo: string; organization: string; code: string; message: string; hint: string };

async function syncBankTransactions(
  supabase: any, token: string, companyId: string, connectedId: string,
  startDate: string, endDate: string
) {
  const errors: SyncError[] = [];
  let totalSynced = 0;

  // 1. 등록된 은행 기관 코드 추출
  const registeredAccounts = await getAccountList(token, connectedId);
  const bankOrgs = new Set<string>();
  for (const acct of registeredAccounts) {
    const org = acct.organization;
    if (!org) continue;
    if (CARD_CODES[org]) continue;
    if (acct.businessType === "BK" || BANK_CODES[org]) {
      bankOrgs.add(org);
    }
  }

  if (bankOrgs.size === 0) {
    errors.push({ accountNo: "", organization: "", code: "NO_BANK_ACCOUNTS", message: "등록된 은행 계정이 없습니다.", hint: "설정 → API 연동에서 은행을 먼저 연결하세요." });
    return { synced: 0, errors };
  }

  // 2. 각 은행에서 보유계좌 목록 조회 → 실제 계좌번호 확보
  for (const org of bankOrgs) {
    const acctListResult = await codefRequest(token, "/v1/kr/bank/b/account/account-list", {
      connectedId, organization: org,
    });

    if (acctListResult.result?.code !== "CF-00000") {
      errors.push({ accountNo: "", organization: org, code: acctListResult.result?.code || "UNKNOWN", message: acctListResult.result?.message || "보유계좌 조회 실패", hint: codefErrorHint(acctListResult.result?.code) });
      continue;
    }

    // PDF 명세: data 가 카테고리별 배열을 가진 객체.
    //   resDepositTrust(예금/신탁 - 수시입출 포함), resForeignCurrency(외화),
    //   resFund(펀드), resLoan(대출), resInsurance(보험)
    // 거래내역은 수시입출/예적금/외화 위주로 조회. 펀드/보험은 transaction-list 의미 없음.
    const rawData = acctListResult.data;
    const realAccounts: any[] = [];
    if (Array.isArray(rawData)) {
      realAccounts.push(...rawData);
    } else if (rawData && typeof rawData === "object") {
      // 거래내역 가능한 카테고리만: 예금/신탁 + 외화
      for (const key of ["resDepositTrust", "resForeignCurrency"]) {
        if (Array.isArray(rawData[key])) realAccounts.push(...rawData[key]);
      }
      // fallback: 예전 응답 구조 (resAccountList 또는 평탄화된 배열)
      if (realAccounts.length === 0 && Array.isArray(rawData.resAccountList)) {
        realAccounts.push(...rawData.resAccountList);
      }
    }
    console.log(`[CODEF] Bank ${org} account-list: ${realAccounts.length} accounts`);

    if (realAccounts.length === 0) continue;

    // 3. 각 계좌의 거래내역 조회
    for (const bankAcct of realAccounts) {
      const accountNo = bankAcct.resAccount || bankAcct.resAccountNo || bankAcct.resAccountDisplay || "";
      if (!accountNo) continue;

      const result = await codefRequest(token, "/v1/kr/bank/b/account/transaction-list", {
        connectedId, organization: org, account: accountNo,
        startDate, endDate, orderBy: "0", inquiryType: "1",
      });

      if (result.result?.code !== "CF-00000") {
        errors.push({ accountNo, organization: org, code: result.result?.code || "UNKNOWN", message: result.result?.message || "거래내역 조회 실패", hint: codefErrorHint(result.result?.code) });
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

  return { synced: totalSynced, errors };
}

async function syncCardBilling(
  supabase: any, token: string, companyId: string, connectedId: string,
  startDate: string, endDate: string
) {
  const errors: SyncError[] = [];

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
    return { synced: 0, errors };
  }

  let totalSynced = 0;

  // PDF 명세: startDate 는 YYYYMM (한 청구년월만 조회). 여러 청구월 받으려면 매월별로 호출.
  // 카드사별 조회 가능 기간: 24개월(국민) / 12개월(현대,삼성,NH,신한,씨티,우리,롯데,하나,전북,광주) / 4개월(비씨,수협)
  // 안전하게 최근 6개월 (대부분 카드사 OK) 반복 호출.
  // 시작/종료 청구월 계산
  const startYear = parseInt(startDate.slice(0, 4));
  const startMonth = parseInt(startDate.slice(4, 6));
  const endYear = parseInt(endDate.slice(0, 4));
  const endMonth = parseInt(endDate.slice(4, 6));
  const startKey = startYear * 12 + (startMonth - 1);
  const endKey = endYear * 12 + (endMonth - 1);
  // 최소 6개월 (사용자가 짧은 기간 보내면 6개월로 확장), 최대 12개월
  const requestedMonths = endKey - startKey + 1;
  const monthsToFetch = Math.min(12, Math.max(6, requestedMonths));
  const fetchEndKey = endKey;
  const fetchStartKey = endKey - monthsToFetch + 1;
  const billingMonths: string[] = [];
  for (let k = fetchStartKey; k <= fetchEndKey; k++) {
    const y = Math.floor(k / 12);
    const m = (k % 12) + 1;
    billingMonths.push(`${y}${String(m).padStart(2, "0")}`);
  }
  console.log(`[CODEF] Card billing months to fetch: ${billingMonths.join(", ")}`);

  for (const org of cardOrgs) {
    // 카드사별 매월 청구 호출 (병렬 — 빠르고, 일부 실패해도 다른 월 계속).
    const monthResults = await Promise.all(billingMonths.map(month =>
      codefRequest(token, "/v1/kr/card/b/account/billing-list", {
        connectedId,
        organization: org,
        startDate: month,
        orderBy: "0",
        inquiryType: "1",
        memberStoreInfoYN: "1",
      }).then(result => ({ month, result }))
        .catch(err => ({ month, result: { result: { code: "FETCH_ERROR", message: err.message } } }))
    ));

    let orgErrorCount = 0;
    for (const { month, result } of monthResults) {
      if (result.result?.code !== "CF-00000") {
        orgErrorCount++;
        // 첫 실패만 기록 (같은 카드 같은 사유로 여러 번 기록 방지)
        if (orgErrorCount === 1) {
          errors.push({
            accountNo: month, organization: org,
            code: result.result?.code || "UNKNOWN",
            message: result.result?.message || "응답 없음",
            hint: codefErrorHint(result.result?.code),
          });
        }
        continue;
      }
      if (!result.data) continue;

      const billings = Array.isArray(result.data) ? result.data : [result.data];
      console.log(`[CODEF] Card ${org} ${month}: ${billings.length} bills`);

      for (const bill of billings) {
      // 청구서 안의 실제 이용내역 (resChargeHistoryList) 평탄화
      const charges = Array.isArray(bill.resChargeHistoryList)
        ? bill.resChargeHistoryList
        : bill.resChargeHistoryList ? [bill.resChargeHistoryList] : [];

      const issuer = CARD_CODES[org] || "카드";
      const billCardNo = bill.resCardNo || "";  // 청구서 단위 카드번호 (마스킹)

      console.log(`[CODEF] Card ${org} bill ${bill.resPaymentDueDate || ""}: ${charges.length} charges, cardNo=${billCardNo}`);

      for (const ch of charges) {
        // PDF 명세 필드명: resApprovalNo (승인번호), resMemberStoreName (가맹점명),
        //   resUsedAmount (이용금액), resUsedDate (사용일자), resUsedCard (이용카드)
        const usedDate = ch.resUsedDate || "";
        const externalId = `codef_card_${org}_${usedDate}_${ch.resApprovalNo || ""}_${ch.resMemberStoreName?.slice(0, 10) || ""}_${ch.resUsedAmount || 0}`;

        // 카드 식별: ch.resUsedCard (4자리 형태) > bill.resCardNo > 카드사명만
        // card_name 통일 형식: "{카드사} {카드 식별자}" — 사용자가 어느 카드 사용했는지 명확.
        const cardId = ch.resUsedCard || billCardNo || "";
        const last4 = cardId ? cardId.replace(/[^0-9]/g, "").slice(-4) : "";
        const cardName = last4 ? `${issuer} ${last4}` : issuer;

        const { error } = await supabase.from("card_transactions").upsert({
          company_id: companyId,
          external_id: externalId,
          amount: Number(ch.resUsedAmount || 0),
          merchant_name: ch.resMemberStoreName || "",
          merchant_category: ch.resMemberStoreType || null,
          transaction_date: usedDate.length === 8
            ? `${usedDate.slice(0,4)}-${usedDate.slice(4,6)}-${usedDate.slice(6,8)}`
            : null,
          approval_number: ch.resApprovalNo || null,
          card_name: cardName,
          installments: ch.resInstallmentMonth ? Number(ch.resInstallmentMonth) : 0,
          raw_data: {
            org,
            issuer,
            cardNo: billCardNo,
            cardIdentifier: ch.resUsedCard || null,
            merchantBusinessNo: ch.resMemberStoreCorpNo || null,
            merchantTelNo: ch.resMemberStoreTelNo || null,
            merchantAddr: ch.resMemberStoreAddr || null,
            paymentType: ch.resPaymentType || null,
            cancelAmount: ch.resCancelAmount || null,
            billPaymentDueDate: bill.resPaymentDueDate || null,
          },
          source: "codef_card",
          mapping_status: "unmapped",
        }, { onConflict: "external_id" });

        if (!error) totalSynced++;
      }
    }
    }  // monthResults loop
  }

  return { synced: totalSynced, errors };
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
  token: string, accountType: "bank" | "card" | "hometax",
  organization: string,
  loginOpts: {
    loginType: "0" | "1";
    loginId?: string; loginPw?: string;
    derFile?: string; keyFile?: string; certPassword?: string;
    pfxFile?: string;
    clientType?: "P" | "B";
    extraCompanyInfo?: { businessNumber?: string; userName?: string; representative?: string; phone?: string };
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

    // 홈택스 등 일부 product 는 인증서 + 식별자(사업자번호) 모두 요구.
    // loginId 가 전달되면 인증서 모드에서도 id 필드로 함께 전송.
    if (loginOpts.loginId) {
      accountEntry.id = loginOpts.loginId;
    }

    if (loginOpts.pfxFile) {
      accountEntry.certType = "0";
      accountEntry.certFile = loginOpts.pfxFile;
    } else {
      accountEntry.certType = "1";
      accountEntry.derFile = loginOpts.derFile || "";
      accountEntry.keyFile = loginOpts.keyFile || "";
    }
  }

  // 홈택스 (공공) 등록 시 추가 회사 식별 필드들 — CODEF 가 어느 필드를 받는지
  // 명세 미공개라 가능성 있는 필드를 모두 함께 전송. 불필요한 필드는 보통 무시됨.
  if (accountType === "hometax" && loginOpts.extraCompanyInfo) {
    const info = loginOpts.extraCompanyInfo;
    if (info.businessNumber) {
      accountEntry.identity = info.businessNumber;
      accountEntry.identityNumber = info.businessNumber;
      accountEntry.businessNumber = info.businessNumber;
    }
    if (info.userName) accountEntry.userName = info.userName;
    if (info.representative) accountEntry.representative = info.representative;
    if (info.phone) accountEntry.phoneNo = info.phone;
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
      accountType,
      loginType: loginOpts.loginType,
      hasLoginId: !!loginOpts.loginId,
      loginIdLen: loginOpts.loginId?.length || 0,
      loginIdPreview: loginOpts.loginId ? `${loginOpts.loginId.slice(0, 4)}***` : "(none)",
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
// 명세: /v1/kr/public/nt/tax-invoice/integrated-check-list (전자세금계산서 통합 API)
// organization=0002, register/connectedId 흐름 사용 안 함 — 매번 인증서 + 비밀번호 직접 전송.
async function syncHometaxInvoices(
  supabase: any, token: string, companyId: string, _connectedId: string,
  startDate: string, endDate: string
) {
  const errors: SyncError[] = [];
  let totalSynced = 0;
  const HOMETAX_ORG = "0002";

  // 인증서 파일 + 비밀번호 로드
  const certPath = `${companyId}/signCert.der`;
  const keyPath = `${companyId}/signPri.key`;

  const [{ data: derFile }, { data: keyDataFile }] = await Promise.all([
    supabase.storage.from("certificates").download(certPath),
    supabase.storage.from("certificates").download(keyPath),
  ]);

  if (!derFile || !keyDataFile) {
    errors.push({
      accountNo: "", organization: HOMETAX_ORG,
      code: "NO_CERT", message: "공동인증서 파일이 없습니다",
      hint: "설정 → 인증서에서 공동인증서 파일(signCert.der + signPri.key)을 업로드하세요.",
    });
    return { synced: 0, errors };
  }

  const derB64 = btoa(String.fromCharCode(...new Uint8Array(await derFile.arrayBuffer())));
  const keyB64 = btoa(String.fromCharCode(...new Uint8Array(await keyDataFile.arrayBuffer())));

  // 인증서 비밀번호 — automation_credentials.hometax.cert_password (encrypted)
  const { data: credRow } = await supabase
    .from("automation_credentials")
    .select("credentials")
    .eq("company_id", companyId).eq("service", "hometax")
    .maybeSingle();

  let certPasswordPlain = credRow?.credentials?.cert_password || "";
  if (certPasswordPlain && certPasswordPlain.length > 100) {
    // PGP 암호화된 형태 → decrypt RPC 호출
    const { data: dec } = await supabase.rpc("decrypt_credential", { p_ciphertext: certPasswordPlain });
    if (dec) certPasswordPlain = dec;
  }

  if (!certPasswordPlain) {
    errors.push({
      accountNo: "", organization: HOMETAX_ORG,
      code: "NO_CERT_PW", message: "공동인증서 비밀번호가 설정되지 않았습니다",
      hint: "설정 → 인증서 또는 세무자동화 탭에서 인증서 비밀번호를 등록하세요.",
    });
    return { synced: 0, errors };
  }

  const publicKey = Deno.env.get("CODEF_PUBLIC_KEY") || "";
  const encryptedCertPw = publicKey ? rsaEncrypt(certPasswordPlain, publicKey) : certPasswordPlain;

  // endDate 가 미래일 경우 오늘로 cap (CODEF CF-13001 회피).
  // startDate 도 endDate 이후면 동일 cap.
  const today = new Date();
  const todayStr = `${today.getFullYear()}${String(today.getMonth()+1).padStart(2,"0")}${String(today.getDate()).padStart(2,"0")}`;
  const cappedEndDate = endDate > todayStr ? todayStr : endDate;
  const cappedStartDate = startDate > cappedEndDate ? cappedEndDate : startDate;
  if (cappedEndDate !== endDate || cappedStartDate !== startDate) {
    console.log(`[hometax] date capped: ${startDate}~${endDate} → ${cappedStartDate}~${cappedEndDate}`);
  }

  // 매출(transeType=01) + 매입(transeType=02) 병렬 호출 (Edge Function 150s timeout 회피).
  const baseReqBody = {
    organization: HOMETAX_ORG,
    loginType: "0",
    certType: "1",
    certFile: derB64,
    keyFile: keyB64,
    certPassword: encryptedCertPw,
    inquiryType: "01",  // 01=전자세금계산서
    searchType: "01",   // 01=작성일자
    startDate: cappedStartDate,
    endDate: cappedEndDate,
    sortby: "1",
    orderBy: "0",
    type: "0",
  };

  const [salesResult, purchaseResult] = await Promise.all([
    codefRequest(token, "/v1/kr/public/nt/tax-invoice/integrated-check-list", { ...baseReqBody, transeType: "01" }),
    codefRequest(token, "/v1/kr/public/nt/tax-invoice/integrated-check-list", { ...baseReqBody, transeType: "02" }),
  ]);

  for (const [direction, result] of [["매출", salesResult], ["매입", purchaseResult]] as const) {
    if (result.result?.code !== "CF-00000") {
      const code = result.result?.code || "UNKNOWN";
      errors.push({
        accountNo: "", organization: HOMETAX_ORG,
        code,
        message: result.result?.message || "응답 없음",
        hint: code === "CF-03002"
          ? "추가 인증(보안카드/간편인증/전자서명) 필요. 현재 미지원."
          : code === "CF-13001"
            ? "조회 기간이 잘못됨 (미래 날짜 등). 이번 달 또는 과거 데이터로 시도하세요."
            : codefErrorHint(code),
      });
      continue;
    }

    const invoices = Array.isArray(result.data) ? result.data : result.data ? [result.data] : [];

    for (const inv of invoices) {
      const invoiceNumber = inv.resApprovalNo || "";
      if (!invoiceNumber) continue;

      const issueDate = inv.resIssueDate || inv.resReportingDate || "";
      const formattedDate = issueDate.length === 8
        ? `${issueDate.slice(0,4)}-${issueDate.slice(4,6)}-${issueDate.slice(6,8)}`
        : issueDate;

      const { error } = await supabase.from("tax_invoices").upsert({
        company_id: companyId,
        invoice_number: invoiceNumber,
        issue_date: formattedDate || null,
        supplier_name: inv.resSupplierCompanyName || inv.resSupplierName || "",
        supplier_brn: inv.resSupplierRegNumber || "",
        buyer_name: inv.resContractorCompanyName || inv.resContractorName || "",
        buyer_brn: inv.resContractorRegNumber || "",
        supply_amount: Number(inv.resSupplyValue || 0),
        tax_amount: Number(inv.resTaxAmt || 0),
        total_amount: Number(inv.resTotalAmount || 0),
        item_name: inv.resRepItems || null,
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

      // 홈택스는 register/connectedId 흐름 사용 안 함 (PDF 명세 확인됨).
      // 매 sync 마다 인증서 + 비밀번호 직접 전송하는 방식. 별도 hometax-verify 액션 사용.
      if (accountType === "hometax") {
        return new Response(JSON.stringify({
          error: "홈택스는 register 흐름이 아닙니다. action='hometax-verify' 를 사용하세요.",
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

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

      const extraId: string | undefined = undefined;
      const extraCompanyInfo: undefined = undefined;

      let result;
      let regError: any = null;
      try {
        result = await registerAccount(token, accountType, organization, { loginType, loginId: loginId || extraId, loginPw, derFile, keyFile, certPassword, pfxFile, clientType, extraCompanyInfo }, cid);
      } catch (regErr: any) {
        // CF-04019/CF-04000 with stale connectedId — retry with fresh /v1/account/create
        if (cid && (regErr.message?.includes("CF-04019") || regErr.message?.includes("CF-04000"))) {
          try {
            result = await registerAccount(token, accountType, organization, { loginType, loginId: loginId || extraId, loginPw, derFile, keyFile, certPassword, pfxFile, clientType, extraCompanyInfo });
          } catch (retryErr: any) {
            regError = retryErr;
          }
        } else {
          regError = regErr;
        }
      }

      // 등록 시도 결과를 sync_logs 에 기록 (디버깅용)
      try {
        await supabase.from("sync_logs").insert({
          company_id: companyId,
          sync_type: `codef_register_${accountType}`,
          status: regError ? "error" : "success",
          details: {
            organization,
            accountType,
            loginType,
            errorCount: regError ? 1 : 0,
            error: regError?.message || null,
            codefResponse: regError?.codefResponse || null,
            diagnostics: regError?.diagnostics || null,
            connectedId: result?.connectedId ? `${result.connectedId.slice(0, 8)}***` : null,
          },
          synced_by: user.id,
        });
      } catch { /* non-critical */ }

      if (regError) {
        return new Response(JSON.stringify({
          error: regError.message || "계정 등록 실패",
          codefResponse: regError.codefResponse || null,
          diagnostics: regError.diagnostics || null,
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
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

    // --- Action: hometax-verify (홈택스 검증) ---
    // 활성화된 '전자세금계산서 통합 API' 직접 호출해서 검증 — registration-status 우회.
    // (registration-status 는 별도 product 인 듯하고 운영 권한 따로 신청 필요할 수 있음.)
    // 짧은 기간(어제~오늘) 1건 시도 — 응답이 정상이면 권한 + 인증 OK.
    if (action === "hometax-verify") {
      const { loginType: ht_loginType = "0", certPassword: ht_certPassword, identity: ht_identity, id: ht_id, userPassword: ht_userPassword } = body;

      // 인증서 파일 로드 (storage에 미리 업로드된 NPKI)
      let certB64 = "", keyB64Str = "";
      if (ht_loginType === "0") {
        const { data: derFileData } = await supabase.storage.from("certificates").download(`${companyId}/signCert.der`);
        const { data: keyFileData } = await supabase.storage.from("certificates").download(`${companyId}/signPri.key`);
        if (!derFileData || !keyFileData) {
          return new Response(JSON.stringify({
            error: "공동인증서 파일이 storage에 없습니다. 설정 → 인증서 탭에서 signCert.der + signPri.key 를 먼저 업로드하세요.",
          }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        certB64 = btoa(String.fromCharCode(...new Uint8Array(await derFileData.arrayBuffer())));
        keyB64Str = btoa(String.fromCharCode(...new Uint8Array(await keyFileData.arrayBuffer())));

        if (!ht_certPassword) {
          return new Response(JSON.stringify({ error: "certPassword 필수" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      } else if (ht_loginType === "1") {
        if (!ht_id || !ht_userPassword) {
          return new Response(JSON.stringify({ error: "id, userPassword 필수" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      }

      // 검증 기간: 최근 7일 (실제 데이터 있을 가능성 높임)
      const today = new Date();
      const yesterday = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
      const fmtDate = (d: Date) => `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}`;

      const publicKey = Deno.env.get("CODEF_PUBLIC_KEY") || "";
      const reqBody: Record<string, any> = {
        organization: "0002",
        loginType: ht_loginType,
        inquiryType: "01",     // 01=전자세금계산서
        searchType: "01",      // 01=작성일자
        startDate: fmtDate(yesterday),
        endDate: fmtDate(today),
        sortby: "1",
        orderBy: "0",
        transeType: "01",      // 01=매출 (검증용 1건만)
        type: "0",
      };
      if (ht_loginType === "0") {
        reqBody.certType = "1";
        reqBody.certFile = certB64;
        reqBody.keyFile = keyB64Str;
        reqBody.certPassword = publicKey ? rsaEncrypt(ht_certPassword, publicKey) : ht_certPassword;
        if (ht_identity) reqBody.identity = ht_identity;
      } else {
        reqBody.id = ht_id;
        reqBody.userPassword = publicKey ? rsaEncrypt(ht_userPassword, publicKey) : ht_userPassword;
        if (ht_identity) reqBody.identity = ht_identity;
      }

      const verifyResult = await codefRequest(token, "/v1/kr/public/nt/tax-invoice/integrated-check-list", reqBody);

      // 결과 저장 — 응답이 CF-00000 이면 권한 + 인증 OK (조회된 건수 무관).
      // CF-03002 (continue2Way) 도 인증은 통과한 것 (추가인증만 필요).
      const code = verifyResult.result?.code;
      const status = (code === "CF-00000" || code === "CF-03002") ? "success" : "error";
      const isRegistered = code === "CF-00000" || code === "CF-03002";
      try {
        await supabase.from("sync_logs").insert({
          company_id: companyId,
          sync_type: "codef_hometax_verify",
          status,
          details: {
            organization: "0002",
            loginType: ht_loginType,
            isRegistered,
            codefCode: verifyResult.result?.code,
            codefMessage: verifyResult.result?.message,
            resultDesc: verifyResult.data?.resResultDesc,
            transactionId: verifyResult.result?.transactionId,
            errorCount: status === "error" ? 1 : 0,
          },
          synced_by: user.id,
        });
      } catch { /* non-critical */ }

      if (status === "error") {
        const txId = verifyResult.result?.transactionId || "(없음)";
        let hint = codefErrorHint(code);
        if (code === "CF-00401") {
          hint = `CODEF 운영팀에 다음 정보로 문의 필요 (https://codef.io/#/cs/inquiry):\n` +
                 `- 운영(Production) 환경에서 카드 상품은 정상이지만 홈택스(공공) API 만 CF-00401 발생\n` +
                 `- 활성화된 product: '국세청 회원 등록여부' + '전자세금계산서 통합'\n` +
                 `- 호출 endpoint: /v1/kr/public/nt/tax-invoice/integrated-check-list\n` +
                 `- transactionId: ${txId}\n` +
                 `→ 활성화는 됐지만 실제 권한 부여 안 된 상태로 보입니다. 운영팀 확인 요청.`;
        } else if (code === "CF-12826") {
          hint = "홈택스 비밀번호 길이 제한 초과 (15자 초과). 비밀번호를 9~15자로 변경 후 재시도하세요.";
        }
        return new Response(JSON.stringify({
          success: false,
          error: `홈택스 검증 실패: ${verifyResult.result?.message || "알 수 없는 오류"} (${code})`,
          hint,
          transactionId: txId,
          codefResponse: verifyResult,
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      return new Response(JSON.stringify({
        success: true,
        registered: isRegistered,
        message: isRegistered ? "홈택스 회원 등록 확인 완료" : "홈택스에 등록되지 않은 사용자",
        resultDesc: verifyResult.data?.resResultDesc || "",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
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

    // syncType="all" 은 bank + card 만 (빠름). holetax 는 매 호출 60~80초+ 라
    // 합치면 Edge Function 150 초 timeout 에 걸려서 504 발생. holetax 는 명시적
    // syncType="hometax" 로만 호출.
    if (syncType === "bank" || syncType === "all") {
      results.bank = await syncBankTransactions(supabase, token, companyId, cid, start, end);
    }

    if (syncType === "card" || syncType === "all") {
      results.card = await syncCardBilling(supabase, token, companyId, cid, start, end);
    }

    if (syncType === "hometax") {
      results.hometax = await syncHometaxInvoices(supabase, token, companyId, cid, start, end);
    }

    const allErrors: SyncError[] = [
      ...(results.bank?.errors ?? []),
      ...(results.card?.errors ?? []),
      ...(results.hometax?.errors ?? []),
    ];
    // 홈택스 CF-00003은 상품 미설정이므로 "skipped"로 분류 (은행/카드 성공 시 전체 실패 방지)
    const criticalErrors = allErrors.filter(e => !(e.code === "CF-00003" && e.organization === "0001"));
    const skippedErrors = allErrors.filter(e => e.code === "CF-00003" && e.organization === "0001");
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
