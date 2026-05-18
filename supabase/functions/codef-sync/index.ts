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

// CODEF 게이트웨이 응답이 멈출 때 Edge Function 150초 timeout (HTTP 546) 회째.
// 각 호출 70초 cap (매출+매입 sequential = max 140초, Edge Function 150초 안에 안전).
// 일부 월(예: 1월처럼 거래량 많거나 CODEF 부하시)은 60초 부족, 70초로 늘림.
const CODEF_REQUEST_TIMEOUT_MS = 70_000;

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

  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), CODEF_REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${CODEF_BASE}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Bearer ${token}`,
      },
      body: encodeURIComponent(JSON.stringify(body)),
      signal: controller.signal,
    });
  } catch (err: any) {
    clearTimeout(tid);
    if (err?.name === "AbortError") {
      // 60초 cap 초과 — CODEF 게이트웨이 응답 없음. 우리 측 가짜 응답으로 매핑해서
      // 호출자가 정상 흐름으로 처리 (errors 배열에 push, status='error').
      console.error(`[CODEF] AbortError: ${path} > ${CODEF_REQUEST_TIMEOUT_MS}ms`);
      return { result: { code: "CF-TIMEOUT", message: `CODEF 게이트웨이 응답 시간 초과 (${CODEF_REQUEST_TIMEOUT_MS / 1000}초). 잠시 후 다시 시도하세요.` } };
    }
    throw err;
  }
  clearTimeout(tid);

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
  if (code === "CF-12201") {
    return "홈택스에 다른 기기/브라우저에서 동시 로그인 중입니다. 모두 로그아웃 후 다시 시도하세요.";
  }
  if (code === "CF-00016") {
    return "동일 요청이 처리 중입니다. 잠시(1~2분) 기다린 후 재시도하세요. 세금계산서 sync 와 동시 실행 시 발생합니다.";
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
  if (code === "CF-TIMEOUT") {
    return "CODEF 게이트웨이 응답 지연 (60초 초과). 일시적 외부 시스템 부하 가능성. 잠시 후 다시 시도하세요.";
  }
  return "CODEF 오류가 발생했습니다. 코드와 메시지를 CODEF 대시보드에서 검색해 대응하세요.";
}

type SyncError = { accountNo: string; organization: string; code: string; message: string; hint: string };

// 잔고 전용 경량 sync — account-list만 호출하고 bank_accounts.balance 만 upsert.
// 거래내역(transaction-list) 호출 없음 → 3~10초. 대시보드 마운트 시 자동 호출용.
async function syncBankBalanceOnly(
  supabase: any, token: string, companyId: string, connectedId: string
) {
  const errors: SyncError[] = [];
  let updated = 0;
  const debug: string[] = [];

  const registeredAccounts = await getAccountList(token, connectedId);
  const bankOrgs = new Set<string>();
  for (const acct of registeredAccounts) {
    const org = acct.organization;
    if (!org || CARD_CODES[org]) continue;
    if (acct.businessType === "BK" || BANK_CODES[org]) bankOrgs.add(org);
  }

  if (bankOrgs.size === 0) {
    return { synced: 0, errors, debug: ["no bank orgs"] };
  }

  for (const org of bankOrgs) {
    const acctListResult = await codefRequest(token, "/v1/kr/bank/b/account/account-list", {
      connectedId, organization: org,
    });

    if (acctListResult.result?.code !== "CF-00000") {
      const code = acctListResult.result?.code || "UNKNOWN";
      // balance-only 모드는 권한/형식 노이즈 조용히 (사용자 빨간 알림 안 띄움)
      if (code !== "CF-00401" && code !== "CF-13021") {
        errors.push({ accountNo: "", organization: org, code, message: acctListResult.result?.message || "잔액 조회 실패", hint: codefErrorHint(code) });
      }
      continue;
    }

    const acctData = acctListResult.data || {};
    const demandDeposits = (acctData.resAccountList?.length ? acctData.resAccountList : acctData.resDepositTrust) || [];

    for (const bankAcct of demandDeposits) {
      const accountNo = bankAcct.resAccount || bankAcct.resAccountNo || "";
      if (!accountNo) continue;
      const balance = Number(bankAcct.resAccountBalance || 0);

      const existing = await supabase
        .from("bank_accounts")
        .select("id")
        .eq("company_id", companyId)
        .eq("account_number", accountNo)
        .maybeSingle();

      if (existing.data?.id) {
        await supabase.from("bank_accounts").update({
          balance,
          bank_name: BANK_CODES[org] || org,
        }).eq("id", existing.data.id);
        updated++;
      } else {
        const aliasGuess = bankAcct.resAccountNickName || bankAcct.resAccountName ||
          `${BANK_CODES[org] || org} ${(bankAcct.resAccountDisplay || accountNo).slice(-4)}`;
        await supabase.from("bank_accounts").insert({
          company_id: companyId,
          bank_name: BANK_CODES[org] || org,
          account_number: accountNo,
          alias: aliasGuess,
          balance,
        });
        updated++;
      }
    }
    debug.push(`bank ${org}: ${demandDeposits.length} accts balance updated`);
  }

  return { synced: updated, errors, debug };
}

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
    // 진단 — IBK 보통예금이 다른 키로 오는지 확인용 (raw response capture)
    console.log(`[BANK-ACCOUNT-LIST-RAW] org=${org}`, JSON.stringify(acctListResult.data || {}).slice(0, 3000));

    // CODEF bank account-list returns categorized arrays.
    // 입출금 = resAccountList 가 표준이지만, IBK 는 기업자유예금/보통예금을 resDepositTrust 로 보냄 (검증).
    // 그래서 resAccountList 비어있으면 resDepositTrust 도 시도. 진짜 예적금이면 transaction-list 가
    // CF-13021 반환 → 기존 dedup 처리로 한 번만 노이즈.
    const acctData = acctListResult.data || {};
    const demandRaw = acctData.resAccountList || [];
    const trustRaw = acctData.resDepositTrust || [];
    const demandDeposits = demandRaw.length > 0 ? demandRaw : trustRaw;
    const usedFallback = demandRaw.length === 0 && trustRaw.length > 0;
    const otherCounts = {
      depositTrust: trustRaw.length,
      foreignCurrency: (acctData.resForeignCurrency || []).length,
      fund: (acctData.resFund || []).length,
      loan: (acctData.resLoan || []).length,
    };
    const otherTotal = otherCounts.depositTrust + otherCounts.foreignCurrency + otherCounts.fund + otherCounts.loan;
    debug.push(`bank ${org} demandDeposits: ${demandDeposits.length}개${usedFallback ? '(resDepositTrust fallback)' : ''}, others: 예신탁${otherCounts.depositTrust}/외화${otherCounts.foreignCurrency}/펀드${otherCounts.fund}/대출${otherCounts.loan}`);

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

    // 2.5. bank_accounts upsert — 대시보드 / 통장관리 잔액 카드용
    // CODEF account-list 응답의 resAccountBalance 가 현재 잔액. alias 는 이미 있으면 보존.
    for (const bankAcct of demandDeposits) {
      const accountNo = bankAcct.resAccount || bankAcct.resAccountNo || "";
      if (!accountNo) continue;
      const balance = Number(bankAcct.resAccountBalance || 0);
      const aliasGuess = bankAcct.resAccountNickName || bankAcct.resAccountName ||
        `${BANK_CODES[org] || org} ${(bankAcct.resAccountDisplay || accountNo).slice(-4)}`;
      const existing = await supabase
        .from("bank_accounts")
        .select("id, alias")
        .eq("company_id", companyId)
        .eq("account_number", accountNo)
        .maybeSingle();
      if (existing.data?.id) {
        await supabase.from("bank_accounts").update({
          balance,
          bank_name: BANK_CODES[org] || org,
        }).eq("id", existing.data.id);
      } else {
        await supabase.from("bank_accounts").insert({
          company_id: companyId,
          bank_name: BANK_CODES[org] || org,
          account_number: accountNo,
          alias: aliasGuess,
          balance,
        });
      }
    }

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

      // 진단 — 계좌별 응답 구조 (0건 vs parsing 누락 구분)
      const _data = result.data || {};
      const _topKeys = typeof _data === "object" && !Array.isArray(_data) ? Object.keys(_data) : [];
      const _listLen = Array.isArray(_data?.resTrHistoryList) ? _data.resTrHistoryList.length :
                      Array.isArray(_data) ? _data.length : null;
      debug.push(`bank ${org} acct=${accountNo} code=${result.result?.code} extraMsg='${result.result?.extraMessage || ""}' topKeys=[${_topKeys.slice(0,8).join(",")}] listLen=${_listLen}`);

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

      let acctSkipNoDate = 0;
      let acctInsertErrors = 0;
      let firstInsertErr = "";

      for (const tx of transactions) {
        const trDate = tx.resAccountTrDate || tx.resTrDate || "";
        if (!trDate || String(trDate).length < 8) { acctSkipNoDate++; continue; }
        const tStr = String(trDate);
        const formattedDate = `${tStr.slice(0,4)}-${tStr.slice(4,6)}-${tStr.slice(6,8)}`;
        const inAmt = Number(tx.resAccountIn || 0);
        const outAmt = Number(tx.resAccountOut || 0);
        // 잔액/금액 모두 0인 의미 없는 row (예: 신규 개설 표시) 는 skip
        if (inAmt === 0 && outAmt === 0) { acctSkipNoDate++; continue; }
        // CODEF descriptions: resAccountDesc1~4. 거래처/메모로 분리.
        const counterparty = tx.resAccountDesc1 || tx.resAccountDesc3 || tx.resAccountDesc || "";
        const memo = [tx.resAccountDesc2, tx.resAccountDesc4].filter(Boolean).join(" / ");

        const _amt = inAmt > 0 ? inAmt : outAmt;
        const _type = inAmt > 0 ? "income" : "expense";
        const _bal = Number(tx.resAfterTranBalance || 0);
        const _trTime = tx.resAccountTrTime || "";
        // 결정적 dedup 키 — 같은 거래 재동기화 시 중복 삽입 방지 (DB UPDATE 백필과 동일 규칙)
        const externalId = [
          companyId, accountNo, tStr, _trTime, String(_amt), _type, String(_bal), counterparty,
        ].join("|");

        const { error } = await supabase.from("bank_transactions").upsert({
          company_id: companyId,
          transaction_date: formattedDate,
          amount: _amt,
          balance_after: _bal,
          type: _type,
          counterparty,
          description: memo,
          source: "codef_bank",
          mapping_status: "unmapped",
          external_id: externalId,
          raw_data: { accountNo, organization: org, trDate: tStr, trTime: _trTime, counterAccount: tx.resCounterAccount || "" },
        }, { onConflict: "external_id", ignoreDuplicates: true });

        if (!error) totalSynced++;
        else {
          acctInsertErrors++;
          if (!firstInsertErr) firstInsertErr = error.message;
        }
      }

      if (acctSkipNoDate > 0 || acctInsertErrors > 0) {
        debug.push(`bank ${org} acct=${accountNo} skipNoDate=${acctSkipNoDate} insertErrors=${acctInsertErrors} firstErr='${firstInsertErr.slice(0,200)}'`);
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
// '전자세금계산서 통합 API' (/integrated-check-list) 는 connectedId 가 아닌 매번 cert 로 인증.
// 1) Storage 의 NPKI 인증서(signCert.der/signPri.key) + automation_credentials.hometax.cert_password 로딩
// 2) RSA 암호화 (CODEF_PUBLIC_KEY) 후 reqBody 에 포함
// 3) verify 함수와 동일한 endpoint/필드 사용
async function syncHometaxInvoices(
  supabase: any, token: string, companyId: string, _connectedId: string,
  startDate: string, endDate: string
) {
  const errors: SyncError[] = [];
  const debug: string[] = [];   // 응답 구조 진단용 — totalSynced=0 인데 진짜 0건인지 parsing 누락인지 구분
  let totalSynced = 0;
  let totalResponseCount = 0;   // CODEF 가 응답에 준 row 수 (매출+매입 합계). 누락 진단용.

  // 국세청(홈택스) organization code — '전자세금계산서 통합' product 는 0002 사용 (3a91f86 확인).
  const HOMETAX_ORG = "0002";

  // ─── cert 로딩 + 비밀번호 ───
  let certB64 = "", keyB64 = "", certPassword = "";
  try {
    const certPath = `${companyId}/signCert.der`;
    const keyPath = `${companyId}/signPri.key`;
    const [certDl, keyDl, credRow] = await Promise.all([
      supabase.storage.from("certificates").download(certPath),
      supabase.storage.from("certificates").download(keyPath),
      supabase.from("automation_credentials").select("credentials").eq("company_id", companyId).eq("service", "hometax").maybeSingle(),
    ]);
    if (certDl.error || !certDl.data || keyDl.error || !keyDl.data) {
      errors.push({
        accountNo: "", organization: HOMETAX_ORG,
        code: "HOMETAX_CERT_MISSING",
        message: "홈택스 공동인증서 파일(signCert.der/signPri.key)이 storage에 없습니다.",
        hint: "설정 → 은행연동 → 홈택스에서 인증서를 다시 업로드하세요.",
      });
      return { synced: 0, errors };
    }
    const encryptedPw = credRow.data?.credentials?.cert_password;
    if (!encryptedPw) {
      errors.push({
        accountNo: "", organization: HOMETAX_ORG,
        code: "HOMETAX_CERT_PASSWORD_MISSING",
        message: "홈택스 공동인증서 비밀번호가 등록되어 있지 않습니다.",
        hint: "설정 → 은행연동 → 홈택스에서 인증서 비밀번호를 입력하세요.",
      });
      return { synced: 0, errors };
    }
    // automation_credentials 의 cert_password 는 pgcrypto AES-256 으로 암호화 저장됨.
    // CODEF 로 보내기 전에 평문 복원 필요.
    const { data: plainPw, error: decErr } = await supabase.rpc("decrypt_credential", { p_ciphertext: encryptedPw });
    if (decErr || !plainPw) {
      errors.push({
        accountNo: "", organization: HOMETAX_ORG,
        code: "HOMETAX_CERT_DECRYPT_FAILED",
        message: `인증서 비밀번호 복호화 실패: ${decErr?.message || "응답 없음"}`,
        hint: "설정에서 인증서 비밀번호를 다시 저장하세요.",
      });
      return { synced: 0, errors };
    }
    const certBytes = new Uint8Array(await certDl.data.arrayBuffer());
    const keyBytes = new Uint8Array(await keyDl.data.arrayBuffer());
    certB64 = Buffer.from(certBytes).toString("base64");
    keyB64 = Buffer.from(keyBytes).toString("base64");
    certPassword = plainPw;
  } catch (err: any) {
    errors.push({
      accountNo: "", organization: HOMETAX_ORG,
      code: "HOMETAX_CERT_LOAD_FAILED",
      message: `인증서 로드 실패: ${err.message || err}`,
      hint: "설정에서 인증서를 재업로드하세요.",
    });
    return { synced: 0, errors };
  }

  const publicKey = Deno.env.get("CODEF_PUBLIC_KEY") || "";
  const encryptedCertPw = publicKey ? rsaEncrypt(certPassword, publicKey) : certPassword;

  // CF-13001 방지: 미래 날짜는 today 로 cap. CODEF 통합 API 는 endDate > today 면 거부.
  const todayYmd = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const cappedEnd = endDate > todayYmd ? todayYmd : endDate;
  const cappedStart = startDate > cappedEnd ? cappedEnd : startDate;

  // ─── 매출/매입 병렬 호출 (단일 기간) ───
  // CODEF 가 동일 인증 정보로 같은 product 의 동시 호출 거부 (CF-00016 — 중복 요청 거부).
  // chunk 별 병렬은 불가. 한 호출에 받은 startDate~endDate 그대로 처리.
  // 1년치 sync 가 필요하면 frontend 가 월별 12번 sequential 호출.
  const callDirection = (direction: "매출" | "매입") =>
    codefRequest(token, "/v1/kr/public/nt/tax-invoice/integrated-check-list", {
      organization: HOMETAX_ORG,
      loginType: "0",
      certType: "1",
      certFile: certB64,
      keyFile: keyB64,
      certPassword: encryptedCertPw,
      inquiryType: "01",
      searchType: "01",
      startDate: cappedStart,
      endDate: cappedEnd,
      sortby: "1",
      orderBy: "0",
      transeType: direction === "매출" ? "01" : "02",
      type: "0",
    }).then((result) => ({ direction, result, chunkStart: cappedStart, chunkEnd: cappedEnd }));

  const reportedCodes = new Set<string>();
  const fatalCodes = new Set(["CF-00003", "CF-00007", "CF-00401", "CF-04015", "CF-12200"]);

  // 매출/매입도 sequential — CODEF 가 동시 호출 시 한 쪽 timeout 발생 (검증됨).
  const salesRes = await callDirection("매출");
  const purchaseRes = await callDirection("매입");
  const settled = [salesRes, purchaseRes];
  debug.push(`single-period sync ${cappedStart}~${cappedEnd} done (sequential)`);

  for (const { direction, result, chunkStart, chunkEnd } of settled) {
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
      // fatalCodes 는 이미 dedup 처리됨. 병렬 모드라 break/skip 의미 없음.
      void fatalCodes;
      continue;
    }

    // ─── 응답 구조 진단 (debug) ───
    const dataType = Array.isArray(result.data) ? "array" : typeof result.data;
    const topKeys = result.data && typeof result.data === "object" && !Array.isArray(result.data)
      ? Object.keys(result.data) : [];
    debug.push(`${direction} resp dataType=${dataType}, topKeys=[${topKeys.join(",")}], dataLen=${Array.isArray(result.data) ? result.data.length : "n/a"}`);

    // 통합 API 는 보통 { data: { resTaxInvoiceList: [...] } } 또는 평탄 배열로 반환.
    // nested 후보들을 순서대로 시도.
    let raw: any = result.data;
    const arrayLikeKeys = ["resTaxInvoiceList", "resInvoiceList", "list", "resList"];
    if (raw && !Array.isArray(raw) && typeof raw === "object") {
      for (const key of arrayLikeKeys) {
        if (Array.isArray(raw[key])) { raw = raw[key]; debug.push(`${direction} unwrapped via key=${key}`); break; }
      }
    }
    const invoices = Array.isArray(raw) ? raw : raw ? [raw] : [];
    totalResponseCount += invoices.length;
    debug.push(`${direction} invoices.length=${invoices.length}`);
    if (invoices.length > 0) {
      const f = invoices[0];
      debug.push(`${direction} sample resApprovalNo='${f.resApprovalNo}' resIssueDate='${f.resIssueDate}' resReportingDate='${f.resReportingDate}' resSendDate='${f.resSendDate}'`);
    }

    const isSales = direction === "매출";
    let upsertErrors = 0;
    let firstUpsertError: any = null;
    const rowsToUpsert: any[] = [];   // batch upsert 용 — N row × DB round trip 1번

    for (const inv of invoices) {
      // CODEF 통합 API 응답: resApprovalNo = 국세청 승인번호 (= nts_confirm_no 에 저장)
      const ntsConfirmNo = String(inv.resApprovalNo || "").trim();
      if (!ntsConfirmNo) continue;

      // ⚠️ 작성일자(공급일자) vs 발행일자 구분:
      //   resReportingDate = 작성일자/공급일자 (예: 20260228) — 한국 세무 관행상 거래 월 기준
      //   resIssueDate     = 발행일 (예: 20260309) — 다음달 10일까지 발행 가능
      // 화면 월별 그룹핑은 issue_date 컬럼(=작성일자) 기준.
      const reportingDate = String(inv.resReportingDate || "").trim();
      // CODEF 매입 응답이 검색 기간 외(특히 그 이후) 작성일자도 섞어 보내는 케이스 방어.
      // 작성일자가 이 chunk 기간 밖이면 skip — 다른 chunk 호출에서 정확히 잡힘.
      if (reportingDate.length !== 8 || reportingDate < chunkStart || reportingDate > chunkEnd) {
        continue;
      }
      const formattedDate = `${reportingDate.slice(0,4)}-${reportingDate.slice(4,6)}-${reportingDate.slice(6,8)}`;

      // 매출(우리가 발행) → 거래처는 받는자(Contractor). 매입(상대가 발행) → 거래처는 발급자(Supplier).
      const counterpartyName = isSales
        ? (inv.resContractorCompanyName || inv.resContractorName || "")
        : (inv.resSupplierCompanyName || inv.resSupplierName || "");
      const counterpartyBizno = isSales
        ? (inv.resContractorRegNumber || "")
        : (inv.resSupplierRegNumber || "");
      const counterpartyBizType = isSales
        ? (inv.resContractorBusinessTypes || "")
        : (inv.resSupplierBusinessTypes || "");
      const counterpartyBizItem = isSales
        ? (inv.resContractorBusinessItems || "")
        : (inv.resSupplierBusinessItems || "");

      rowsToUpsert.push({
        company_id: companyId,
        nts_confirm_no: ntsConfirmNo,
        issue_date: formattedDate,
        type: isSales ? "sales" : "purchase",
        status: "issued",
        source: "codef_hometax",
        counterparty_name: counterpartyName,
        counterparty_bizno: counterpartyBizno,
        counterparty_business_type: counterpartyBizType,
        counterparty_business_item: counterpartyBizItem,
        supply_amount: Number(inv.resSupplyValue || 0),
        tax_amount: Number(inv.resTaxAmt || 0),
        total_amount: Number(inv.resTotalAmount || 0),
        item_name: inv.resRepItems || null,
        hometax_synced_at: new Date().toISOString(),
      });
    }

    // Batch upsert — row 마다 1 round trip → 한 번에 처리. 큰 응답일수록 큰 효과 (100건이면 ~100배 빠름).
    if (rowsToUpsert.length > 0) {
      const { error } = await supabase.from("tax_invoices").upsert(rowsToUpsert, { onConflict: "company_id,nts_confirm_no" });
      if (error) {
        upsertErrors = rowsToUpsert.length;
        firstUpsertError = { message: error.message, code: (error as any).code };
        debug.push(`${direction} batch upsert error: ${error.message}`);
      } else {
        totalSynced += rowsToUpsert.length;
      }
    }
    if (upsertErrors > 0) {
      debug.push(`${direction} upsertErrors=${upsertErrors}, first=${JSON.stringify(firstUpsertError)}`);
    }
  }

  return { synced: totalSynced, responseCount: totalResponseCount, errors, debug };
}

// ─── 현금영수증 매출 sync ───
// CODEF '현금영수증 매출내역' (organization=0003)
// endpoint: /v1/kr/public/nt/cash-receipt/sales-details
// timeout: 300s (CODEF 측 — Edge function 150s 제한이 먼저 걸림)
// 응답: 단건이면 객체, 다건이면 리스트 → 항상 정규화.
// identity: 사업자번호('-' 제거). 가이드는 "사업장 2개 이상 시 필수" 라지만 1개여도 일부 케이스에서
//           default 사업장이 잘못 잡혀 0건 응답하는 경우가 있어 항상 전송.
async function syncHometaxCashReceipts(
  supabase: any, token: string, companyId: string,
  startDate: string, endDate: string,
) {
  const errors: SyncError[] = [];
  const debug: string[] = [];
  let totalSynced = 0;
  let totalResponseCount = 0;

  const HOMETAX_ORG = "0003";

  // ─── cert 로딩 (syncHometaxInvoices 와 동일 패턴) ───
  let certB64 = "", keyB64 = "", certPassword = "";
  try {
    const certPath = `${companyId}/signCert.der`;
    const keyPath = `${companyId}/signPri.key`;
    const [certDl, keyDl, credRow] = await Promise.all([
      supabase.storage.from("certificates").download(certPath),
      supabase.storage.from("certificates").download(keyPath),
      supabase.from("automation_credentials").select("credentials").eq("company_id", companyId).eq("service", "hometax").maybeSingle(),
    ]);
    if (certDl.error || !certDl.data || keyDl.error || !keyDl.data) {
      errors.push({
        accountNo: "", organization: HOMETAX_ORG,
        code: "HOMETAX_CERT_MISSING",
        message: "홈택스 공동인증서 파일이 storage에 없습니다.",
        hint: "설정 → 은행연동 → 홈택스에서 인증서를 다시 업로드하세요.",
      });
      return { synced: 0, responseCount: 0, errors, debug };
    }
    const encryptedPw = credRow.data?.credentials?.cert_password;
    if (!encryptedPw) {
      errors.push({
        accountNo: "", organization: HOMETAX_ORG,
        code: "HOMETAX_CERT_PASSWORD_MISSING",
        message: "홈택스 공동인증서 비밀번호가 등록되어 있지 않습니다.",
        hint: "설정 → 은행연동 → 홈택스에서 인증서 비밀번호를 입력하세요.",
      });
      return { synced: 0, responseCount: 0, errors, debug };
    }
    const { data: plainPw, error: decErr } = await supabase.rpc("decrypt_credential", { p_ciphertext: encryptedPw });
    if (decErr || !plainPw) {
      errors.push({
        accountNo: "", organization: HOMETAX_ORG,
        code: "HOMETAX_CERT_DECRYPT_FAILED",
        message: `인증서 비밀번호 복호화 실패: ${decErr?.message || "응답 없음"}`,
        hint: "설정에서 인증서 비밀번호를 다시 저장하세요.",
      });
      return { synced: 0, responseCount: 0, errors, debug };
    }
    const certBytes = new Uint8Array(await certDl.data.arrayBuffer());
    const keyBytes = new Uint8Array(await keyDl.data.arrayBuffer());
    certB64 = Buffer.from(certBytes).toString("base64");
    keyB64 = Buffer.from(keyBytes).toString("base64");
    certPassword = plainPw;
  } catch (err: any) {
    errors.push({
      accountNo: "", organization: HOMETAX_ORG,
      code: "HOMETAX_CERT_LOAD_FAILED",
      message: `인증서 로드 실패: ${err.message || err}`,
      hint: "설정에서 인증서를 재업로드하세요.",
    });
    return { synced: 0, responseCount: 0, errors, debug };
  }

  const publicKey = Deno.env.get("CODEF_PUBLIC_KEY") || "";
  const encryptedCertPw = publicKey ? rsaEncrypt(certPassword, publicKey) : certPassword;

  // 미래 날짜 cap.
  const todayYmd = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const cappedEnd = endDate > todayYmd ? todayYmd : endDate;
  const cappedStart = startDate > cappedEnd ? cappedEnd : startDate;

  // 회사 사업자번호 — '-' 제거. CODEF identity 파라미터.
  const { data: companyRow } = await supabase.from("companies").select("business_number").eq("id", companyId).maybeSingle();
  const identity = (companyRow?.business_number || "").replaceAll("-", "");

  const result = await codefRequest(token, "/v1/kr/public/nt/cash-receipt/sales-details", {
    organization: HOMETAX_ORG,
    loginType: "0",
    certType: "1",
    certFile: certB64,
    keyFile: keyB64,
    certPassword: encryptedCertPw,
    startDate: cappedStart,
    endDate: cappedEnd,
    orderBy: "0",  // 최신순
    ...(identity ? { identity } : {}),
  });
  debug.push(`cash-receipt sync ${cappedStart}~${cappedEnd} identity=${identity ? "set" : "none"}`);
  // 진단 — 0건 vs parsing 누락 구분 (raw 전체) + base URL.
  console.log("[CASH-RECEIPT-DEBUG]", JSON.stringify({
    period: `${cappedStart}~${cappedEnd}`,
    identitySet: !!identity,
    codefEnv: CODEF_ENV,
    codefBase: CODEF_BASE,
    code: result.result?.code,
    message: result.result?.message,
    extraMessage: result.result?.extraMessage,
    dataType: Array.isArray(result.data) ? "array" : typeof result.data,
    topKeys: result.data && typeof result.data === "object" && !Array.isArray(result.data) ? Object.keys(result.data) : [],
    dataLen: Array.isArray(result.data) ? result.data.length : null,
    sample: Array.isArray(result.data) && result.data[0] ? result.data[0] : null,
    rawDataPreview: JSON.stringify(result.data).slice(0, 800),
  }));

  if (result.result?.code !== "CF-00000") {
    errors.push({
      accountNo: "",
      organization: HOMETAX_ORG,
      code: result.result?.code || "UNKNOWN",
      message: result.result?.message || "응답 없음",
      hint: codefErrorHint(result.result?.code || ""),
    });
    return { synced: 0, responseCount: 0, errors, debug };
  }

  // 응답 정규화 — 단건이면 객체, 다건이면 리스트. data 자체가 array 일 수도 있고 nested key 일 수도.
  let raw: any = result.data;
  if (raw && !Array.isArray(raw) && typeof raw === "object") {
    const arrayLikeKeys = ["resCashReceiptList", "resList", "list"];
    for (const key of arrayLikeKeys) {
      if (Array.isArray(raw[key])) { raw = raw[key]; debug.push(`unwrapped via key=${key}`); break; }
    }
  }
  const receipts = Array.isArray(raw) ? raw : raw && raw.resApprovalNo ? [raw] : [];
  totalResponseCount = receipts.length;
  debug.push(`receipts.length=${receipts.length}`);
  if (receipts.length > 0) {
    const f = receipts[0];
    debug.push(`sample resApprovalNo='${f.resApprovalNo}' resUsedDate='${f.resUsedDate}' resTransTypeNm='${f.resTransTypeNm}'`);
  }

  const rowsToUpsert: any[] = [];
  for (const r of receipts) {
    const approvalNo = String(r.resApprovalNo || "").trim();
    if (!approvalNo) continue;
    const usedDate = String(r.resUsedDate || "").trim();
    if (usedDate.length !== 8 || usedDate < cappedStart || usedDate > cappedEnd) continue;
    const issueDate = `${usedDate.slice(0,4)}-${usedDate.slice(4,6)}-${usedDate.slice(6,8)}`;

    const transType = String(r.resTransTypeNm || "");
    const status = transType.includes("취소") ? "cancelled" : "issued";

    const useType = String(r.resUseType || "");
    const purpose = useType.includes("소득공제") ? "income_deduction" : "expenditure_proof";

    rowsToUpsert.push({
      company_id: companyId,
      type: "income",  // 매출 sync (sales-details)
      amount: Number(r.resTotalAmount || 0),
      supply_amount: Number(r.resSupplyValue || 0),
      tax_amount: Number(r.resVAT || 0),
      counterparty_name: r.resCompanyNm || null,
      counterparty_bizno: r.resCompanyIdentityNo || null,
      issue_date: issueDate,
      approval_number: approvalNo,
      purpose,
      status,
      source: "hometax_sync",
      memo: r.resNote || null,
    });
  }

  if (rowsToUpsert.length > 0) {
    const { error } = await supabase.from("cash_receipts").upsert(rowsToUpsert, {
      onConflict: "company_id,approval_number,type",
    });
    if (error) {
      errors.push({
        accountNo: "", organization: HOMETAX_ORG,
        code: "DB_UPSERT_FAIL",
        message: error.message,
      });
      debug.push(`upsert error: ${error.message}`);
    } else {
      totalSynced = rowsToUpsert.length;
    }
  }

  return { synced: totalSynced, responseCount: totalResponseCount, errors, debug };
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

    const body = await req.json();
    const { companyId, action = "sync", syncType = "all", startDate, endDate, connectedId } = body;

    // 인증 분기:
    //   1) HOMETAX_CRON_SECRET 헤더 매칭 → cron 호출 (cron-tick/job-step만 허용, user 검사 skip)
    //   2) service_role JWT (env 매칭) → 같은 권한
    //   3) 그 외 → user JWT 필수
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const CRON_SECRET = Deno.env.get("HOMETAX_CRON_SECRET") || "";
    const cronSecretHeader = req.headers.get("x-cron-secret") || "";
    const isCronAuth = !!CRON_SECRET && cronSecretHeader === CRON_SECRET;
    const isServiceRoleAuth = !!authHeader && !!SERVICE_ROLE && authHeader.includes(SERVICE_ROLE);
    const isInternalAuth = isCronAuth || isServiceRoleAuth;
    let user: any = null;

    if (!isInternalAuth) {
      const result = await createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_ANON_KEY") ?? "",
        { global: { headers: { Authorization: authHeader } } }
      ).auth.getUser();
      user = result.data?.user ?? null;
      if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    } else {
      // internal 호출은 cron-tick / job-step (background sync chain) 만 허용
      const allowedInternalActions = new Set(["hometax-cron-tick", "hometax-job-step"]);
      if (!allowedInternalActions.has(action)) {
        return new Response(JSON.stringify({ error: "internal auth 는 cron-tick/job-step 만 허용" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // cron-tick 은 companyId 없이 글로벌 처리. 그 외 action 은 companyId 필수.
    if (!companyId && action !== "hometax-cron-tick") {
      return new Response(JSON.stringify({ error: "companyId required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (action === "hometax-cron-tick") {
      // 30분 이내 active job 중 3분+ update 없는 job 만 trigger.
      // step 처리 1~2분 + edge function 150초 timeout 까지 고려 — 3분 skip 으로 진행 중 step 의 동시 호출 차단.
      const now = Date.now();
      const { data: jobs } = await supabase.from("hometax_sync_jobs")
        .select("id, company_id, updated_at")
        .in("status", ["pending", "running"])
        .gt("updated_at", new Date(now - 30 * 60 * 1000).toISOString())
        .lt("updated_at", new Date(now - 3 * 60 * 1000).toISOString())  // 3분 이내 진행 중 skip
        .limit(10);
      const selfUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/codef-sync`;
      const cronSecretForChain = CRON_SECRET;  // cron-tick 호출자가 사용한 secret 그대로 chain 에 전달
      const triggers = (jobs || []).map((job) =>
        fetch(selfUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": authHeader as string,
            "X-Cron-Secret": cronSecretForChain,  // step 호출도 internal auth 통과하게
          },
          body: JSON.stringify({ companyId: job.company_id, action: "hometax-job-step", jobId: job.id }),
        }).catch(() => {})
      );
      // fire-and-forget — 응답 즉시 반환. EdgeRuntime.waitUntil 로 fetch 보장.
      // @ts-expect-error
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
        // @ts-expect-error
        EdgeRuntime.waitUntil(Promise.all(triggers));
      } else {
        Promise.all(triggers).catch(() => {});
      }
      return new Response(JSON.stringify({ ok: true, triggered: jobs?.length || 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
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

    // --- Action: hometax-job-step (production-grade: atomic lock + retry + chain) ---
    // A. Atomic CAS lock 으로 동시 호출 차단 (CF-00016 회피).
    // B. error/partial 월 retry max 3 (CF-TIMEOUT/CF-00016 자동 보완).
    // C. 모든 step + retry 끝나야 status='completed'.
    if (action === "hometax-job-step") {
      const { jobId } = body;
      if (!jobId) return new Response(JSON.stringify({ error: "jobId required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

      // ─── A. Atomic Lock — UPDATE returning. 5분+ stale lock 자동 해제 ───
      const lockExpiry = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const { data: lockedJob, error: lockErr } = await supabase
        .from("hometax_sync_jobs")
        .update({ in_progress: true, last_lock_at: new Date().toISOString() })
        .eq("id", jobId)
        .or(`in_progress.eq.false,last_lock_at.lt.${lockExpiry}`)
        .select()
        .maybeSingle();
      if (lockErr || !lockedJob) {
        return new Response(JSON.stringify({ ok: true, busy: true, message: "다른 chain 이 처리 중 — skip" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const job = lockedJob;
      // helper — 어떤 경우에도 unlock
      const unlock = async (extra: Record<string, any> = {}) => {
        await supabase.from("hometax_sync_jobs")
          .update({ in_progress: false, ...extra })
          .eq("id", jobId);
      };

      try {
        if (["completed", "failed", "cancelled"].includes(job.status)) {
          await unlock();
          return new Response(JSON.stringify({ ok: true, terminal: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        // 월 list
        const sd = new Date(job.start_date);
        const ed = new Date(job.end_date);
        const monthsList: string[] = [];
        let cur = new Date(sd.getFullYear(), sd.getMonth(), 1);
        while (cur <= ed) {
          monthsList.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}`);
          cur.setMonth(cur.getMonth() + 1);
        }
        const perMonth: any[] = job.result_per_month || [];
        const MAX_RETRY = 3;

        // ─── 처리할 step 결정 ───
        let targetMonth: string | null = null;
        let isRetry = false;
        let prevEntry: any = null;

        if (perMonth.length < monthsList.length) {
          // 아직 처리 안 한 월 우선
          targetMonth = monthsList[perMonth.length];
        } else {
          // 모든 month 처리됨 — error/partial retry
          prevEntry = perMonth.find((m) =>
            (m.status === "error" || m.status === "partial") && (m.retryCount || 0) < MAX_RETRY,
          );
          if (prevEntry) {
            targetMonth = prevEntry.month;
            isRetry = true;
          }
        }

        if (!targetMonth) {
          // 모두 처리됨 + retry 끝 → completed
          await unlock({
            status: "completed",
            completed_at: new Date().toISOString(),
            current_progress: { done: monthsList.length, total: monthsList.length, label: "완료" },
          });
          const syncTsCol = job.job_type === "cash_receipt" ? "last_cashreceipt_sync_at" : "last_hometax_sync_at";
          await supabase.from("company_settings").upsert({
            company_id: job.company_id,
            [syncTsCol]: new Date().toISOString(),
          }, { onConflict: "company_id" });
          return new Response(JSON.stringify({ ok: true, completed: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        // status='pending' → 'running'
        if (job.status === "pending") {
          await supabase.from("hometax_sync_jobs").update({
            status: "running", started_at: new Date().toISOString(),
          }).eq("id", jobId);
        }

        // ─── sync 호출 ───
        const [my, mm] = targetMonth.split("-").map(Number);
        const lastDay = new Date(my, mm, 0).getDate();
        const todayYmd = new Date().toISOString().slice(0, 10).replaceAll("-", "");
        const monthStart = `${my}${String(mm).padStart(2, "0")}01`;
        let monthEnd = `${my}${String(mm).padStart(2, "0")}${String(lastDay).padStart(2, "0")}`;
        if (monthEnd > todayYmd) monthEnd = todayYmd;

        let r;
        try {
          const r0 = job.job_type === "cash_receipt"
            ? await syncHometaxCashReceipts(supabase, token, job.company_id, monthStart, monthEnd)
            : await syncHometaxInvoices(supabase, token, job.company_id, "", monthStart, monthEnd);
          r = { synced: r0.synced || 0, responseCount: r0.responseCount || 0, errors: r0.errors || [] };
        } catch (err: any) {
          r = { synced: 0, responseCount: 0, errors: [{ code: "STEP_ERR", message: err.message || String(err) }] };
        }

        const monthStatus: "ok" | "partial" | "error" =
          r.errors.length && r.synced === 0 ? "error"
          : r.errors.length || (r.responseCount > r.synced) ? "partial"
          : "ok";

        // ─── result_per_month 업데이트 ───
        let newPerMonth: any[];
        let totalSyncedDelta = 0;
        let totalResponseDelta = 0;
        const newRetryCount = isRetry ? ((prevEntry?.retryCount || 0) + 1) : 0;

        if (isRetry) {
          // 기존 record 갱신 (delta 계산)
          const oldSynced = prevEntry?.synced || 0;
          const oldResp = prevEntry?.responseCount || 0;
          totalSyncedDelta = r.synced - oldSynced;
          totalResponseDelta = r.responseCount - oldResp;
          newPerMonth = perMonth.map((m: any) =>
            m.month === targetMonth ? {
              month: targetMonth, synced: r.synced, responseCount: r.responseCount,
              status: monthStatus, errorMsg: r.errors[0]?.message, retryCount: newRetryCount,
            } : m,
          );
        } else {
          totalSyncedDelta = r.synced;
          totalResponseDelta = r.responseCount;
          newPerMonth = [...perMonth, {
            month: targetMonth, synced: r.synced, responseCount: r.responseCount,
            status: monthStatus, errorMsg: r.errors[0]?.message, retryCount: 0,
          }];
        }

        const stillPending = newPerMonth.length < monthsList.length;
        const stillRetry = newPerMonth.some((m: any) =>
          (m.status === "error" || m.status === "partial") && (m.retryCount || 0) < MAX_RETRY,
        );

        const progressLabel = isRetry
          ? `${targetMonth} (재시도 ${newRetryCount}/${MAX_RETRY})`
          : targetMonth;

        await unlock({
          current_progress: {
            done: newPerMonth.filter((m: any) => m.status === "ok").length,
            total: monthsList.length,
            label: progressLabel,
          },
          total_synced: (job.total_synced || 0) + totalSyncedDelta,
          total_response: (job.total_response || 0) + totalResponseDelta,
          result_per_month: newPerMonth,
          errors: [...(job.errors || []), ...r.errors],
        });

        // ─── 다음 step trigger or completed ───
        if (stillPending || stillRetry) {
          const selfUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/codef-sync`;
          const triggerNext = async () => {
            await fetch(selfUrl, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": authHeader as string,
                "X-Cron-Secret": cronSecretHeader || CRON_SECRET,
              },
              body: JSON.stringify({ companyId: job.company_id, action: "hometax-job-step", jobId }),
            });
          };
          // @ts-expect-error — Deno EdgeRuntime
          if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
            // @ts-expect-error
            EdgeRuntime.waitUntil(triggerNext());
          } else {
            triggerNext().catch(() => {});
          }
        } else {
          await supabase.from("hometax_sync_jobs").update({
            status: "completed",
            completed_at: new Date().toISOString(),
            current_progress: { done: monthsList.length, total: monthsList.length, label: "완료" },
          }).eq("id", jobId);
          const syncTsCol = job.job_type === "cash_receipt" ? "last_cashreceipt_sync_at" : "last_hometax_sync_at";
          await supabase.from("company_settings").upsert({
            company_id: job.company_id,
            [syncTsCol]: new Date().toISOString(),
          }, { onConflict: "company_id" });
        }

        return new Response(JSON.stringify({
          ok: true, monthDone: targetMonth, isRetry, retryCount: newRetryCount,
          totalDone: newPerMonth.length, totalCount: monthsList.length,
          stillPending, stillRetry,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (err: any) {
        // 에러 발생 시 unlock 보장
        await unlock();
        return new Response(JSON.stringify({ error: err.message || String(err) }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }


    // --- Action: hometax-sync-async (Background sync — job 만들고 즉시 응답 + 백그라운드 처리) ---
    if (action === "hometax-sync-async") {
      const { startDate: aStart, endDate: aEnd, jobType: rawJobType } = body;
      const jobType = rawJobType === "cash_receipt" ? "cash_receipt" : "tax_invoice";
      if (!aStart || !aEnd) {
        return new Response(JSON.stringify({ error: "startDate, endDate 필수 (YYYY-MM-DD)" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // 사용자의 users.id 매핑
      const { data: userRow } = await supabase.from("users").select("id, company_id").eq("auth_id", user.id).maybeSingle();
      if (!userRow || userRow.company_id !== companyId) {
        return new Response(JSON.stringify({ error: "권한이 없습니다." }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // 같은 회사 + 같은 job_type 활성 차단 (CODEF 동시 호출 거부 방지)
      // 다른 job_type (세금계산서 vs 현금영수증) 은 다른 endpoint 라 동시 진행 허용.
      const { data: activeJobs } = await supabase
        .from("hometax_sync_jobs")
        .select("id, status, current_progress, created_at")
        .eq("company_id", companyId)
        .eq("job_type", jobType)
        .in("status", ["pending", "running"])
        .gt("updated_at", new Date(Date.now() - 30 * 60 * 1000).toISOString())
        .limit(1);
      if (activeJobs && activeJobs.length > 0) {
        return new Response(JSON.stringify({
          error: "이미 진행 중인 백그라운드 동기화가 있습니다. 완료 후 다시 시도하세요.",
          activeJobId: activeJobs[0].id,
          progress: activeJobs[0].current_progress,
        }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // 30분+ 무응답 stale job 자동 정리 — 같은 type 만
      await supabase.from("hometax_sync_jobs").update({
        status: "failed",
        completed_at: new Date().toISOString(),
        errors: [{ code: "STALE", message: "30분간 응답 없어 자동 종료" }],
      }).eq("company_id", companyId).eq("job_type", jobType).in("status", ["pending", "running"])
        .lt("updated_at", new Date(Date.now() - 30 * 60 * 1000).toISOString());

      // job 생성
      const { data: job, error: jobErr } = await supabase
        .from("hometax_sync_jobs")
        .insert({
          company_id: companyId,
          start_date: aStart,
          end_date: aEnd,
          status: "pending",
          triggered_by: userRow.id,
          job_type: jobType,
        })
        .select()
        .single();
      if (jobErr || !job) {
        return new Response(JSON.stringify({ error: `job 생성 실패: ${jobErr?.message}` }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // self-invoke chain — user JWT 그대로 사용. 1시간 만료, 13개월 chain ~10분이라 안전.
      const selfUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/codef-sync`;
      const triggerFirst = async () => {
        await fetch(selfUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": authHeader as string },
          body: JSON.stringify({ companyId, action: "hometax-job-step", jobId: job.id }),
        });
      };
      // @ts-expect-error
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
        // @ts-expect-error
        EdgeRuntime.waitUntil(triggerFirst().catch(async (err) => {
          await supabase.from("hometax_sync_jobs").update({
            status: "failed", completed_at: new Date().toISOString(),
            errors: [{ code: "BG_TRIGGER_FAIL", message: err?.message || String(err) }],
          }).eq("id", job.id);
        }));
      } else {
        triggerFirst().catch(() => {});
      }

      return new Response(JSON.stringify({
        success: true, jobId: job.id, status: "pending",
        message: "백그라운드 동기화 시작됨. 진행 상황은 hometax_sync_jobs 테이블에서 Realtime 구독.",
      }), { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // --- Action: hometax-pagination-test (검증용 — endpoint/응답 구조 측정. 기존 흐름 영향 없음) ---
    if (action === "hometax-pagination-test") {
      const { startDate: ts, endDate: te, pageNo = "1", pageSize = "20", transeType = "01",
              path: customPath, organization: customOrg, extraBody = {} } = body;
      const certPath = `${companyId}/signCert.der`;
      const keyPath = `${companyId}/signPri.key`;
      const [certDl, keyDl, credRow] = await Promise.all([
        supabase.storage.from("certificates").download(certPath),
        supabase.storage.from("certificates").download(keyPath),
        supabase.from("automation_credentials").select("credentials").eq("company_id", companyId).eq("service", "hometax").maybeSingle(),
      ]);
      if (certDl.error || !certDl.data || keyDl.error || !keyDl.data || !credRow.data?.credentials?.cert_password) {
        return new Response(JSON.stringify({ error: "cert/key/password 누락" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const { data: plainPw } = await supabase.rpc("decrypt_credential", { p_ciphertext: credRow.data.credentials.cert_password });
      const certBytes = new Uint8Array(await certDl.data.arrayBuffer());
      const keyBytes = new Uint8Array(await keyDl.data.arrayBuffer());
      const certB64 = Buffer.from(certBytes).toString("base64");
      const keyB64 = Buffer.from(keyBytes).toString("base64");
      const publicKey = Deno.env.get("CODEF_PUBLIC_KEY") || "";
      const encryptedCertPw = publicKey ? rsaEncrypt(plainPw as string, publicKey) : (plainPw as string);

      const t0 = Date.now();
      const reqBody: Record<string, any> = {
        organization: customOrg || "0002",
        loginType: "0",
        certType: "1",
        certFile: certB64,
        keyFile: keyB64,
        certPassword: encryptedCertPw,
        startDate: ts,
        endDate: te,
        sortby: "1",
        orderBy: "0",
        transeType,
        type: "0",
        pageNo: String(pageNo),
        pageSize: String(pageSize),
        ...extraBody,
      };
      // 통합세금계산서 호출 시 inquiryType/searchType 필요.
      if (!customPath) {
        reqBody.inquiryType = "01";
        reqBody.searchType = "01";
      }
      const path = customPath || "/v1/kr/public/nt/tax-invoice/integrated-check-list";
      const result = await codefRequest(token, path, reqBody);
      const dt = Date.now() - t0;

      const dataRaw = result.data;
      const isArray = Array.isArray(dataRaw);
      const dataLen = isArray ? dataRaw.length : 0;
      const topKeys = !isArray && dataRaw && typeof dataRaw === "object" ? Object.keys(dataRaw) : [];
      const firstRow = isArray && dataRaw[0] ? dataRaw[0] : (dataRaw && typeof dataRaw === "object" ? dataRaw : null);

      return new Response(JSON.stringify({
        elapsedMs: dt,
        resultCode: result.result?.code,
        resultMessage: result.result?.message,
        dataIsArray: isArray,
        dataLen,
        topKeys,
        paginationFields: firstRow ? {
          commStartPageNo: firstRow.commStartPageNo,
          commEndPageNo: firstRow.commEndPageNo,
          resTotalPageCount: firstRow.resTotalPageCount,
          resTotalCount: firstRow.resTotalCount,
        } : null,
        sampleApprovalNos: isArray ? dataRaw.slice(0, 3).map((r: any) => r.resApprovalNo) : [],
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

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

    // syncType="bank-balance": 잔고만 빠르게 (account-list 만 호출, 거래내역 skip — 대시보드 자동 갱신용)
    if (syncType === "bank-balance") {
      results.bank = await syncBankBalanceOnly(supabase, token, companyId, cid);
    }

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

    const allEntries: SyncError[] = [
      ...(results.bank?.errors ?? []),
      ...(results.card?.errors ?? []),
      ...(results.hometax?.errors ?? []),
    ];
    // 환경/설정성 안내(외부 액션 필요, 코드로 못 고침)는 errors가 아닌 notes로 분리 — 사용자 빨간 알림 안 뜨게
    // CF-00003: 상품 미활성화 / CF-00401: 권한 없음 / CF-13021: 계좌 형식 불일치 / NO_DEMAND_DEPOSIT: 입출금 계좌 미등록
    const noteCodes = new Set(["CF-00003", "CF-00401", "CF-13021", "NO_DEMAND_DEPOSIT", "CF-TIMEOUT", "CF-12200"]);
    const errors = allEntries.filter(e => !noteCodes.has(e.code));
    const notes = allEntries.filter(e => noteCodes.has(e.code));
    const totalSynced =
      (results.bank?.synced ?? 0) + (results.card?.synced ?? 0) + (results.hometax?.synced ?? 0);
    const logStatus =
      errors.length === 0 ? (notes.length > 0 ? "partial" : "success") : totalSynced > 0 ? "partial" : "error";

    await supabase.from("sync_logs").insert({
      company_id: companyId,
      sync_type: `codef_${syncType}`,
      status: logStatus,
      details: { ...results, errorCount: errors.length, noteCount: notes.length, errors, notes },
      synced_by: user.id,
    });

    return new Response(
      JSON.stringify({
        success: errors.length === 0,
        status: logStatus,
        results,
        errors,
        notes,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || "Internal error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
