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
    return "해당 API 상품의 조회 권한이 없습니다. CODEF 대시보드 → 상품 관리에서 '법인 은행 거래내역 조회' 또는 '법인 카드 매출/매입 내역 조회' 상품을 활성화하세요.";
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

    const rawData = acctListResult.data?.resAccountList ?? acctListResult.data;
    const realAccounts = Array.isArray(rawData) ? rawData : rawData ? [rawData] : [];
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
    if (!result.data) continue;

    // CODEF 카드 청구 응답: data 자체가 배열이거나, data.resBillingList 안에 있을 수 있음
    const rawBillings = result.data?.resBillingList ?? result.data;
    const billings = Array.isArray(rawBillings) ? rawBillings : rawBillings ? [rawBillings] : [];
    console.log(`[CODEF] Card ${org} billing: ${billings.length} items, raw keys: ${Object.keys(result.data || {}).join(",")}`);

    for (const bill of billings) {
      const externalId = `codef_card_${org}_${bill.resUsedDate || ""}_${bill.resUsedTime || ""}_${bill.resCardApprovalNo || totalSynced}`;

      const { error } = await supabase.from("card_transactions").upsert({
        company_id: companyId,
        external_id: externalId,
        amount: Number(bill.resUsedAmount || 0),
        merchant_name: bill.resStoreName || bill.resMemberStoreName || "",
        transaction_date: bill.resUsedDate ? `${bill.resUsedDate.slice(0,4)}-${bill.resUsedDate.slice(4,6)}-${bill.resUsedDate.slice(6,8)}` : null,
        approval_number: bill.resCardApprovalNo || null,
        card_name: bill.resCardName || CARD_CODES[org] || null,
        source: "codef_card",
        mapping_status: "unmapped",
      }, { onConflict: "external_id" });

      if (!error) totalSynced++;
    }
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

  // 매출(transeType=01) + 매입(transeType=02) 모두 조회
  for (const direction of ["매출", "매입"] as const) {
    const result = await codefRequest(token, "/v1/kr/public/nt/tax-invoice/integrated-check-list", {
      organization: HOMETAX_ORG,
      loginType: "0",
      certType: "1",
      certFile: derB64,
      keyFile: keyB64,
      certPassword: encryptedCertPw,
      inquiryType: "01",  // 01=전자세금계산서
      searchType: "01",   // 01=작성일자
      transeType: direction === "매출" ? "01" : "02",
      startDate,
      endDate,
      sortby: "1",
      orderBy: "0",
      type: "0",
    });

    if (result.result?.code !== "CF-00000") {
      // CF-03002 = continue2Way (추가 인증 필요)
      const code = result.result?.code || "UNKNOWN";
      errors.push({
        accountNo: "", organization: HOMETAX_ORG,
        code,
        message: result.result?.message || "응답 없음",
        hint: code === "CF-03002"
          ? "추가 인증(보안카드/간편인증/전자서명)이 필요합니다. 현재 미지원 — 향후 구현 예정."
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

    // --- Action: hometax-verify (홈택스 회원 등록여부 확인) ---
    // PDF 명세: /v1/kr/public/nt/tax-invoice/registration-status
    // organization=0002, 인증서 + 비밀번호 + identity(대표자 주민번호 앞 7자리, 법인) 또는 ID/PW.
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

      const publicKey = Deno.env.get("CODEF_PUBLIC_KEY") || "";
      const reqBody: Record<string, any> = {
        organization: "0002",
        loginType: ht_loginType,
      };
      if (ht_loginType === "0") {
        reqBody.certType = "1";
        reqBody.certFile = certB64;
        reqBody.keyFile = keyB64Str;
        reqBody.certPassword = publicKey ? rsaEncrypt(ht_certPassword, publicKey) : ht_certPassword;
        if (ht_identity) reqBody.identity = ht_identity; // 법인은 대표자 주민번호 앞7자리
      } else {
        reqBody.id = ht_id;
        reqBody.userPassword = publicKey ? rsaEncrypt(ht_userPassword, publicKey) : ht_userPassword;
        if (ht_identity) reqBody.identity = ht_identity;
      }

      const verifyResult = await codefRequest(token, "/v1/kr/public/nt/tax-invoice/registration-status", reqBody);

      // 결과 저장
      const status = verifyResult.result?.code === "CF-00000" ? "success" : "error";
      const isRegistered = verifyResult.data?.resRegistrationStatus === "1";
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
            errorCount: status === "error" ? 1 : 0,
          },
          synced_by: user.id,
        });
      } catch { /* non-critical */ }

      if (status === "error") {
        return new Response(JSON.stringify({
          success: false,
          error: `홈택스 검증 실패: ${verifyResult.result?.message || "알 수 없는 오류"} (${verifyResult.result?.code})`,
          hint: codefErrorHint(verifyResult.result?.code),
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

    if (syncType === "bank" || syncType === "all") {
      results.bank = await syncBankTransactions(supabase, token, companyId, cid, start, end);
    }

    if (syncType === "card" || syncType === "all") {
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
