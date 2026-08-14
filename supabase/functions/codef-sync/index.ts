import { withSentry } from "../_shared/sentry.ts";
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

// ── 2026-07-03 CODEF 사용량 계측 (phase 1: 측정만, 차단 없음) ──────────────
//   codefRequest 를 지나는 모든 호출을 "요청(invocation) 단위"로 수집해 codef_usage 원장에 적재.
//   - units(과금 추정) = 상품 API(/v1/kr/*) 성공(CF-00000) 호출 수 — CODEF 는 상품 조회 성공 건당 과금
//   - 관리 API(/v1/account/*)는 무과금 → total_calls 에만 포함
//   - cron 은 회사별 자가호출(fan-out) 구조라 invocation 단위 수집으로 회사 귀속이 자동으로 맞음
//   AsyncLocalStorage 미지원 런타임이면 계측만 조용히 비활성(동기화 기능 무영향 — fail-open).
type MeterCall = { path: string; code: string };
type MeterStore = { calls: MeterCall[]; companyId: string | null; action: string };
let usageALS: any = null;
try {
  const hooks = await import("node:async_hooks");
  usageALS = new hooks.AsyncLocalStorage();
} catch (_) {
  usageALS = null;
  console.error("[METER] AsyncLocalStorage unavailable — usage metering disabled");
}
function meterPush(path: string, code: string) {
  try {
    const s = usageALS?.getStore?.() as MeterStore | undefined;
    if (s) s.calls.push({ path, code });
  } catch (_) { /* 계측은 절대 동기화를 깨지 않는다 */ }
}
// ── 2026-07-06 CODEF 원가 가드 — 페이월에 막힌 회사(체험 만료·해지 기간종료)는 자동 cron 제외.
//   앱 접근도 못 하는 회사에 하루 4회 CODEF 과금이 나가는 누수 방지. 수동 동기화는 영향 없음
//   (어차피 페이월로 화면 진입 불가). 구독행 없음(레거시)·active·trialing(유효)·past_due 는 유지.
/** 은행·카드 동기화를 돌려도 되는 회사만 남긴다 (2026-08-06 요금제 개편).
 *  기준이 "체험 만료 여부"에서 "현재 유효 플랜의 bank_sync_enabled"로 바뀌었다.
 *  무료 플랜은 false — 계좌당 월 600원(CODEF)이 나가는 유일한 실변동비라 무료에 열 수 없다.
 *  조회 장애 시엔 fail-open(전체 허용) — 구독 조회 실패가 동기화를 멈추면 안 된다. */
async function filterBillableCompanies(supabase: any, companyIds: string[]): Promise<Set<string>> {
  const allowed = new Set(companyIds);
  if (companyIds.length === 0) return allowed;
  try {
    const [{ data: subs }, { data: plans }] = await Promise.all([
      supabase
        .from("subscriptions")
        .select("company_id, status, trial_ends_at, current_period_end, plan_id, plan_slug, created_at")
        .in("company_id", companyIds)
        .order("created_at", { ascending: false }),
      supabase.from("subscription_plans").select("id, slug, bank_sync_enabled"),
    ]);
    const planById = new Map((plans || []).map((p: any) => [p.id, p]));
    const planBySlug = new Map((plans || []).map((p: any) => [p.slug, p]));
    const syncAllowed = (slug: string) => planBySlug.get(slug)?.bank_sync_enabled !== false;

    // 회사별 최신 구독 1건만 본다 (created_at desc 정렬이라 첫 행이 최신)
    const latest = new Map<string, any>();
    for (const s of subs || []) if (!latest.has(s.company_id)) latest.set(s.company_id, s);

    const now = Date.now();
    for (const id of companyIds) {
      const s = latest.get(id);
      let slug = "free";
      if (s) {
        const trialLive = s.status === "trialing" && s.trial_ends_at && new Date(s.trial_ends_at).getTime() > now;
        const paidLive = ["active", "past_due", "paused"].includes(s.status)
          && (!s.current_period_end || new Date(s.current_period_end).getTime() + 3 * 86400000 > now);
        if (trialLive || paidLive) {
          slug = (s.plan_id ? planById.get(s.plan_id)?.slug : null) || s.plan_slug || "free";
        }
      }
      if (!syncAllowed(slug)) allowed.delete(id);
    }
  } catch (e: any) {
    console.error("[CRON-GUARD] plan check failed:", e?.message);
  }
  return allowed;
}

/** 수동('즉시 동기화') 차단 — 자동(하루 2회)은 무료도 받지만, 버튼은 누를 때마다
 *  CODEF 비용이 나가므로 유료 구독자만 쓴다 (2026-08-07 사장님 결정).
 *  화면에서도 막지만 서버가 최종 판정 — 화면만 막으면 우회된다. */
async function assertBankSyncAllowed(supabase: any, companyId: string): Promise<string | null> {
  const allowed = await filterBillableCompanies(supabase, [companyId]);
  if (!allowed.has(companyId)) {
    return "이 요금제에서는 은행·카드 연동을 사용할 수 없습니다.";
  }
  try {
    const { data } = await supabase.rpc("get_company_entitlement", { p_company_id: companyId });
    const row = Array.isArray(data) ? data[0] : data;
    const slug = row?.effective_plan_slug || "free";
    if (!row?.entitled || slug === "free") {
      return "무료 요금제는 즉시 동기화를 쓸 수 없습니다. 통장·카드는 하루 2회(오전 9시·오후 6시) 자동으로 동기화되고, 원할 때 바로 불러오려면 요금제를 시작해 주세요.";
    }
  } catch (e) {
    // 판정 실패 시엔 막지 않는다 — 조회 장애가 유료 고객의 동기화를 멈추면 안 된다(fail-open).
    console.error("[GUARD] entitlement check failed:", (e as Error)?.message);
  }
  return null;
}

async function flushCodefUsage(store: MeterStore) {
  try {
    if (!store.calls.length) return;
    const units = store.calls.filter((c) => c.code === "CF-00000" && c.path.startsWith("/v1/kr/")).length;
    const byPath: Record<string, number> = {};
    for (const c of store.calls) {
      const k = `${c.path}:${c.code}`;
      byPath[k] = (byPath[k] || 0) + 1;
    }
    const sb = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );
    await sb.from("codef_usage").insert({
      company_id: store.companyId,
      action: store.action || "unknown",
      units,
      total_calls: store.calls.length,
      meta: { byPath },
    });
  } catch (e: any) {
    // 테이블 미생성/일시 장애 시에도 동기화 응답은 정상 — 로그만
    console.error("[METER] codef_usage insert failed:", e?.message);
  }
}

async function codefRequest(token: string, path: string, body: Record<string, any>, timeoutMsOverride?: number): Promise<any> {
  const sanitizedBody = { ...body };
  if (sanitizedBody.accountList) {
    sanitizedBody.accountList = (sanitizedBody.accountList as any[]).map((a: any) => ({
      ...a,
      password: a.password ? "[ENCRYPTED]" : undefined,
      derFile: a.derFile ? `[${a.derFile.length} chars]` : undefined,
      keyFile: a.keyFile ? `[${a.keyFile.length} chars]` : undefined,
    }));
  }
  console.log(`[CODEF] ${path}`); // 요청 body 미로깅(민감정보)

  // 호출별 타임아웃 — 한 invocation 에서 CODEF 를 1번만 부를 땐 더 길게 기다릴 수 있다.
  const timeoutMs = timeoutMsOverride ?? CODEF_REQUEST_TIMEOUT_MS;
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), timeoutMs);
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
      console.error(`[CODEF] AbortError: ${path} > ${timeoutMs}ms`);
      meterPush(path, "CF-TIMEOUT");
      return { result: { code: "CF-TIMEOUT", message: `CODEF 게이트웨이 응답 시간 초과 (${Math.round(timeoutMs / 1000)}초). 잠시 후 다시 시도하세요.` } };
    }
    meterPush(path, "FETCH_ERROR");
    throw err;
  }
  clearTimeout(tid);

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error(`[CODEF] HTTP ${res.status}`);
    meterPush(path, `HTTP_${res.status}`);
    throw new Error(`CODEF API error: ${res.status}`);
  }
  const text = await res.text();
  // CODEF 응답은 application/x-www-form-urlencoded 라 공백이 '+' 로 옴.
  //   decodeURIComponent 는 '+' 를 공백으로 안 바꿔줘서(%XX 만 디코딩) 거래처명이
  //   "주식회사+카카오" 처럼 오염돼 저장되던 버그 (2026-08-04 사장님 제보) —
  //   hometax-issue 의 7/16 수정과 동일하게 '+' → 공백 치환을 먼저 해준다.
  let parsed: any;
  try {
    const decoded = decodeURIComponent(text.replace(/\+/g, " "));
    parsed = JSON.parse(decoded);
  } catch {
    parsed = JSON.parse(text);
  }
  console.log(`[CODEF] Response:`, JSON.stringify({ code: parsed.result?.code, message: parsed.result?.message }));
  meterPush(path, parsed.result?.code || "UNKNOWN");
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
        const { error: insErr } = await supabase.from("bank_accounts").insert({
          company_id: companyId,
          bank_name: BANK_CODES[org] || org,
          account_number: accountNo,
          alias: aliasGuess,
          balance,
        });
        if (insErr) {
          // 무료 요금제 통장·카드 3개 제한 트리거(2026-08-11) — 초과 계좌는 연결하지 않고 안내만
          if (String(insErr.message || "").includes("무료 요금제") &&
              !errors.some((e: any) => e.code === "FREE_ACCOUNT_LIMIT")) {
            errors.push({ accountNo: "", organization: org, code: "FREE_ACCOUNT_LIMIT",
              message: insErr.message, hint: "요금제 화면에서 오너뷰로 업그레이드하면 나머지 계좌도 연결됩니다." });
          }
        } else {
          updated++;
        }
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
        const { error: insErr } = await supabase.from("bank_accounts").insert({
          company_id: companyId,
          bank_name: BANK_CODES[org] || org,
          account_number: accountNo,
          alias: aliasGuess,
          balance,
        });
        // 무료 요금제 통장·카드 3개 제한 트리거(2026-08-11) — 초과 계좌는 연결하지 않고 안내만
        if (insErr && String(insErr.message || "").includes("무료 요금제") &&
            !errors.some((e: any) => e.code === "FREE_ACCOUNT_LIMIT")) {
          errors.push({ accountNo: "", organization: org, code: "FREE_ACCOUNT_LIMIT",
            message: insErr.message, hint: "요금제 화면에서 오너뷰로 업그레이드하면 나머지 계좌도 연결됩니다." });
        }
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
      debug.push(`bank ${org} acct=***${String(accountNo).slice(-4)} code=${result.result?.code} listLen=${_listLen}`);

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
        // CODEF descriptions: resAccountDesc1~4 — 은행별 배치가 달라(예금주명/거래구분/거래내용 등).
        //   descs 예: [예금주명, 거래구분(타행이체·인터넷 등), 거래내용]. 사용자는 '거래내용'만 원함(직원 QA).
        //   → counterparty(예금주명)와 거래구분 토큰을 제외한 나머지만 description 으로. raw_data 에 원본 보존.
        const TR_TYPES = ["타행이체", "당행이체", "인터넷", "자동이체", "대체", "펌뱅킹", "펌뱅크", "CD", "ATM", "체크카드", "급여", "이자", "스마트뱅킹", "폰뱅킹", "창구", "지로", "전자금융", "모바일뱅킹", "모바일", "송금", "이체", "출금", "입금", "카드", "공과금"];
        // 예금주명은 desc1 에만 온다 — desc1 이 비었으면(채널·적요만 온 거래) 예금주 없음.
        //   기존 `desc1 || desc3` 폴백이 적요를 예금주 칸에 밀어넣고 거래내용을 비웠다
        //   (2026-07-29 사장님: "예금주명에 거래내용이 불러와지고 거래내용은 공백").
        const _d1 = tx.resAccountDesc1 == null ? "" : String(tx.resAccountDesc1).trim();
        const counterparty = _d1 && !TR_TYPES.includes(_d1) ? _d1 : "";
        const _descs = [tx.resAccountDesc1, tx.resAccountDesc2, tx.resAccountDesc3, tx.resAccountDesc4]
          .map((d: any) => (d == null ? "" : String(d).trim())).filter(Boolean);
        const memo = _descs.filter((d) => d !== counterparty && !TR_TYPES.includes(d)).join(" ");

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
          raw_data: { accountNo, organization: org, trDate: tStr, trTime: _trTime, counterAccount: tx.resCounterAccount || "", descs: _descs },
        }, { onConflict: "external_id", ignoreDuplicates: true });

        if (!error) totalSynced++;
        else {
          acctInsertErrors++;
          if (!firstInsertErr) firstInsertErr = error.message;
        }
      }

      if (acctSkipNoDate > 0 || acctInsertErrors > 0) {
        debug.push(`bank ${org} acct=***${String(accountNo).slice(-4)} skipNoDate=${acctSkipNoDate} insertErrors=${acctInsertErrors}`);
      }
    }
  }

  return { synced: totalSynced, errors, debug };
}

// 가맹점 사업자번호 — 숫자 10자리일 때만 인정한다 (2026-08-12).
//   카드사는 같은 자리에 '가맹점번호'(카드사 자체 번호, 예: 9955572506)를 넣어 주기도 한다.
//   그걸 사업자번호로 착각해 저장하면 국세청 과세유형 조회가 통째로 헛돈다.
function merchantBizno(v: unknown): string | null {
  const d = String(v ?? "").replace(/[^0-9]/g, "");
  return d.length === 10 ? d : null;
}

//   biznoOnly: 청구내역을 받아 **사업자번호만 얹고 행은 만들지도 고치지도 않는다** (2026-08-12).
//     과거분 번호를 채우려고 그냥 재수집하면 upsert 가 mapping_status 를 unmapped 로 되돌려
//     사람이 해 둔 분류가 날아간다. 사장님 분류를 지키면서 번호만 채우려는 용도.
async function syncCardBilling(
  supabase: any, token: string, companyId: string, connectedId: string,
  startDate: string, endDate: string, opts?: { biznoOnly?: boolean }
) {
  const biznoOnly = opts?.biznoOnly === true;
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
  //   수집 후 검증용 — 명세에서 받은 모든 건을 기억해 두고, 끝에서 DB에 실제로 있는지 대조한다.
  //   upsert 가 "성공" 응답이어도 BEFORE INSERT 트리거가 조용히 버릴 수 있어(2026-08-12 사업자번호
  //   유실 사건과 같은 뿌리) 응답만 믿으면 안 된다. (2026-08-14)
  const fetchedForRecon: Array<{ row: Record<string, any>; date: string; approvalNo: string; amount: number; store: string }> = [];
  //   가맹점 사업자번호가 실제로 몇 건이나 오는지 — 카드사가 안 주는 것과 우리가 안 뽑는 것을
  //   다음 사람이 구분할 수 있게 남긴다. (2026-08-12)
  let biznoSeen = 0, biznoTotal = 0, biznoFilled = 0;

  // 카드 청구 내역은 YYYYMM 6자리 날짜
  const billingStart = startDate.slice(0, 6);
  const billingEnd = endDate.slice(0, 6);

  for (const org of cardOrgs) {
    //   memberStoreInfoType "1"(가맹점 포함) — 안 넣으면 default "0" 이라 CODEF 가
    //   가맹점 사업자번호(resMemberStoreCorpNo)·업종·전화번호를 아예 빼고 준다. (2026-08-12)
    const result = await codefRequest(token, "/v1/kr/card/b/account/billing-list", {
      connectedId, organization: org, startDate: billingStart, endDate: billingEnd, orderBy: "0", inquiryType: "1",
      memberStoreInfoType: "1",
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
        debuggedChargeKeys = true;
      }

      for (const charge of charges) {
        const usedDate = charge.resUsedDate || charge.resDate || "";
        const usedAmount = charge.resUsedAmount || charge.resAmount || charge.resMemberStoreAmt || 0;
        const storeName = charge.resStoreName || charge.resMemberStoreName || charge.resUsedStore || "";
        const bizno = merchantBizno(charge.resMemberStoreCorpNo);
        biznoTotal++; if (bizno) biznoSeen++;
        const approvalNo = charge.resCardApprovalNo || charge.resApprovalNo || "";
        const externalId = `codef_card_${org}_${usedDate}_${charge.resUsedTime || ""}_${approvalNo || totalSynced}`;
        const formattedDate = usedDate.length >= 8
          ? `${usedDate.slice(0,4)}-${usedDate.slice(4,6)}-${usedDate.slice(6,8)}`
          : new Date().toISOString().split("T")[0];

        if (!biznoOnly) {
          //   ★ 해외 결제는 같은 결제가 승인·청구 두 채널로 들어오는데 금액(환율 확정)과
          //     가맹점명(SUPABASE PTE LTD ↔ SUPABASE(USD))이 서로 달라 external_id 도,
          //     내용 대조 트리거(card_tx_prevent_dup)도 못 잡고 두 줄이 쌓였다. (2026-08-14)
          //     같은 카드사·같은 일자·같은 승인번호면 같은 결제다 — 이미 있으면 새로 안 쌓는다.
          //     취소·환불(음수 금액, [취소] 표시)은 별 사건이므로 대조 대상에서 뺀다.
          let dupRow: { id: string; amount: number; mapping_status: string; journal_entry_id: string | null; raw_data: Record<string, unknown> | null } | null = null;
          if (approvalNo && Number(usedAmount) > 0) {
            const { data: dupHits } = await supabase.from("card_transactions")
              .select("id, amount, mapping_status, journal_entry_id, raw_data")
              .eq("company_id", companyId)
              .eq("transaction_date", formattedDate)
              .eq("approval_number", approvalNo)
              .neq("external_id", externalId)
              .like("external_id", `codef_card_${org}_%`)
              .gt("amount", 0)
              .not("merchant_name", "like", "[%")
              .limit(1);
            dupRow = (dupHits as typeof dupRow[] | null)?.[0] ?? null;
          }

          const upsertRow: Record<string, any> = {
            company_id: companyId,
            external_id: externalId,
            amount: Number(usedAmount),
            merchant_name: storeName,
            transaction_date: formattedDate,
            approval_number: approvalNo || null,
            card_name: charge.resCardName || CARD_CODES[org] || null,
            //   못 받은 회차엔 아예 안 보낸다 — 한 번 채워 둔 번호를 빈 응답이 지우지 않게. (2026-08-12)
            ...(bizno ? { merchant_bizno: bizno } : {}),
            source: "codef_card",
            mapping_status: "unmapped",
            raw_data: { cardNo, organization: org, usedDate, usedTime: charge.resUsedTime || "", charge },
          };
          fetchedForRecon.push({ row: upsertRow, date: formattedDate, approvalNo: String(approvalNo || ""), amount: Number(usedAmount), store: storeName });

          if (dupRow) {
            //   승인내역으로 먼저 들어온 행이 있다 — 새 행 대신, 아직 안 쓰인 행이면
            //   승인 시점 환산액을 청구 확정액으로 바로잡는다 (매핑·전표 붙은 행은 안 건드림).
            if (dupRow.mapping_status === "unmapped" && !dupRow.journal_entry_id && Number(dupRow.amount) !== Number(usedAmount)) {
              await supabase.from("card_transactions")
                .update({
                  amount: Number(usedAmount),
                  raw_data: { ...(dupRow.raw_data || {}), chargeConfirm: { usedDate, usedTime: charge.resUsedTime || "", charge } },
                })
                .eq("id", dupRow.id);
            }
          } else {
          const { error } = await supabase.from("card_transactions").upsert(upsertRow, { onConflict: "external_id" });

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

        //   ★ 같은 결제가 승인내역으로 먼저 들어와 있으면 위 upsert 는 **조용히 버려진다**.
        //     external_id 가 서로 다르고(승인은 사용시각 포함, 청구는 없음) ON CONFLICT 가 안 걸리는데
        //     BEFORE INSERT 트리거 card_tx_prevent_dup 이 내용 중복이라 판단해 return null 하기 때문.
        //     그래서 사업자번호를 **청구내역만** 주는 카드사(롯데)는 번호가 통째로 버려졌다.
        //     버려졌든 아니든, 아직 번호가 없는 그 결제 건에 번호만 얹는다. (2026-08-12)
        //   찾는 순서: ①승인번호 ②승인번호가 없던 옛 행을 위해 (일자·금액·가맹점명)
        //     — ②는 트리거 card_tx_prevent_dup 이 "같은 결제"를 가리는 바로 그 기준이다.
        if (bizno) {
          if (approvalNo) {
            const { data: hit } = await supabase.from("card_transactions")
              .update({ merchant_bizno: bizno })
              .eq("company_id", companyId)
              .eq("transaction_date", formattedDate)
              .eq("approval_number", approvalNo)
              .is("merchant_bizno", null)
              .select("id");
            biznoFilled += (hit as any[] | null)?.length ?? 0;
          }
          const { data: hit2 } = await supabase.from("card_transactions")
            .update({ merchant_bizno: bizno })
            .eq("company_id", companyId)
            .eq("transaction_date", formattedDate)
            .eq("amount", Number(usedAmount))
            .eq("merchant_name", storeName)
            .is("merchant_bizno", null)
            .select("id");
          biznoFilled += (hit2 as any[] | null)?.length ?? 0;
        }
      }
    }
  }

  if (biznoTotal > 0) {
    debug.push(`card 가맹점 사업자번호: 응답 ${biznoSeen}/${biznoTotal}건${biznoOnly ? " (번호만 채우기 모드)" : ""} · 새로 채운 행 ${biznoFilled}`);
  }

  //   ── 수집 후 검증 ──  명세에서 받은 건이 DB에 실제로 있는지 전수 대조. (2026-08-14)
  //   "같은 결제"의 다른 표현(승인·청구, 상호 표기차)이 이미 있으면 있는 것으로 친다 —
  //   승인번호 일치 또는 (일자·금액·상호) 일치. 그래도 없으면 한 번 더 적재하고,
  //   그마저 안 들어가면 errors 로 격상해 sync_logs 에서 바로 보이게 한다.
  if (!biznoOnly && fetchedForRecon.length > 0) {
    try {
      const dates = [...new Set(fetchedForRecon.map((f) => f.date))];
      const { data: dbRows } = await supabase.from("card_transactions")
        .select("transaction_date, approval_number, amount, merchant_name")
        .eq("company_id", companyId)
        .in("transaction_date", dates);
      const byApproval = new Set<string>();
      const byContent = new Set<string>();
      for (const r of (dbRows || [])) {
        if (r.approval_number) byApproval.add(`${r.transaction_date}|${r.approval_number}`);
        byContent.add(`${r.transaction_date}|${Number(r.amount)}|${r.merchant_name || ""}`);
      }
      const isPresent = (f: typeof fetchedForRecon[number]) =>
        (f.approvalNo && byApproval.has(`${f.date}|${f.approvalNo}`)) ||
        byContent.has(`${f.date}|${f.amount}|${f.store}`);

      const missing = fetchedForRecon.filter((f) => !isPresent(f));
      if (missing.length > 0) {
        for (const f of missing) {
          await supabase.from("card_transactions").upsert(f.row, { onConflict: "external_id" });
        }
        // 재적재 후 실존 재확인
        const { data: recheck } = await supabase.from("card_transactions")
          .select("transaction_date, approval_number, amount, merchant_name")
          .eq("company_id", companyId)
          .in("transaction_date", [...new Set(missing.map((f) => f.date))]);
        const byApproval2 = new Set<string>();
        const byContent2 = new Set<string>();
        for (const r of (recheck || [])) {
          if (r.approval_number) byApproval2.add(`${r.transaction_date}|${r.approval_number}`);
          byContent2.add(`${r.transaction_date}|${Number(r.amount)}|${r.merchant_name || ""}`);
        }
        const stillMissing = missing.filter((f) =>
          !(f.approvalNo && byApproval2.has(`${f.date}|${f.approvalNo}`)) &&
          !byContent2.has(`${f.date}|${f.amount}|${f.store}`));
        debug.push(`검증: 명세 ${fetchedForRecon.length}건 중 누락 ${missing.length}건 재적재 → 미해결 ${stillMissing.length}건`);
        for (const f of stillMissing.slice(0, 10)) {
          errors.push({
            accountNo: "", organization: "",
            code: "RECON_MISSING",
            message: `명세 건이 DB에 안 들어감: ${f.date} ${f.store} ${f.amount.toLocaleString()}원 (승인 ${f.approvalNo || "없음"})`,
            hint: "card_tx_prevent_dup 트리거/제약과의 충돌 여부를 확인하세요.",
          });
        }
      } else {
        debug.push(`검증: 명세 ${fetchedForRecon.length}건 전부 DB 반영 확인`);
      }
    } catch (e: any) {
      debug.push(`검증 실패(수집 자체는 정상): ${e?.message || e}`);
    }
  }

  return { synced: totalSynced, biznoFilled, errors, debug, orgs: [...cardOrgs] };
}

// 카드사 유실 감시 — 최근까지 수집되던 카드사가 CODEF 계정 목록에서 사라지면 크게 알린다.
//   2026-08-05 실사고: 재등록 폴백이 BC카드 계정을 지운 채 실패했는데 크론은 남은 카드사만
//   조용히 돌아서 9일간 아무도 몰랐다. "오류 없음"과 "전부 수집됨"은 다르다 — 여기서 대조한다.
async function alertMissingCardOrgs(
  supabase: any, companyId: string, seenOrgs: string[],
): Promise<string[]> {
  const missing: string[] = [];
  try {
    const seen = new Set(seenOrgs);
    for (const org of Object.keys(CARD_CODES)) {
      if (seen.has(org)) continue;
      // 최근 45일 내 이 카드사 거래가 적재된 적이 있나 (있는데 목록에 없으면 유실)
      const { data: recent } = await supabase.from("card_transactions")
        .select("id").eq("company_id", companyId)
        .like("external_id", `codef_card_${org}_%`)
        .gte("created_at", new Date(Date.now() - 45 * 86400000).toISOString())
        .limit(1);
      if (!recent || recent.length === 0) continue;
      missing.push(org);

      // 인앱 알림 — 마스터에게. 크론이 2시간마다 돌므로 24시간 내 같은 알림은 다시 안 보낸다.
      //   type 은 notifications CHECK 허용 목록에 있는 'system' 만 통과한다 ('sync'는 무음 실패 — 2026-08-14 실측).
      const title = `카드 수집 중단: ${CARD_CODES[org]}`;
      const { data: dup } = await supabase.from("notifications")
        .select("id").eq("company_id", companyId).eq("title", title)
        .gte("created_at", new Date(Date.now() - 24 * 3600000).toISOString())
        .limit(1);
      if (dup && dup.length > 0) continue;
      const { data: masters } = await supabase.from("users")
        .select("id").eq("company_id", companyId).eq("is_master", true);
      const rows = (masters || []).map((m: { id: string }) => ({
        company_id: companyId,
        user_id: m.id,
        type: "system",
        title,
        message: `${CARD_CODES[org]} 계정이 연결 목록에서 사라져 거래 수집이 멈췄습니다. 설정 > API 연동에서 ${CARD_CODES[org]}를 다시 등록해 주세요.`,
        link: "/settings",
      }));
      if (rows.length) await supabase.from("notifications").insert(rows);
    }
  } catch (e) {
    console.error("alertMissingCardOrgs failed", e); // 감시 실패가 수집을 막지 않게
  }
  return missing;
}

// 카드 승인내역(실시간) sync — 청구서 마감 전에도 결제 즉시 거래 반영.
//   법인: /v1/kr/card/b/account/approval-list, 개인: /v1/kr/card/p/account/approval-list
//   계정의 clientType(B/P)로 카드별 엔드포인트 라우팅.
//   ⚠️ dedup: billing-list 와 "동일한" external_id 포맷(codef_card_{org}_{date}_{time}_{approvalNo}) 사용 →
//      같은 승인건이 청구·승인 두 채널로 들어와도 onConflict external_id 로 1건 수렴.
//      ignoreDuplicates:true → 이미 적재된 행(사용자 매핑/거래처 연결 포함)은 절대 덮어쓰지 않음.
//   응답 필드(CODEF 카드 승인내역 명세): resUsedDate(yyyyMMdd), resUsedTime(hhmmss),
//      resApprovalNo(승인번호), resUsedAmount(이용금액), resKRWAmt(해외건 원화), resMemberStoreName,
//      resCardName(개인만), resCancelYN("0"정상/"1"취소/"2"부분취소/"3"거절), resInstallmentMonth.
async function syncCardApprovals(
  supabase: any, token: string, companyId: string, connectedId: string,
  startDate: string, endDate: string
) {
  const errors: SyncError[] = [];
  const debug: string[] = [];

  const accounts = await getAccountList(token, connectedId, "card");
  // 카드 계정만 추출 + clientType(B 법인/P 개인) 판별 (org 중복 제거).
  const cardAccounts: Array<{ org: string; isPersonal: boolean }> = [];
  const seenOrg = new Set<string>();
  for (const acct of accounts) {
    const org = acct.organization;
    if (!org) continue;
    if (!(acct.businessType === "CD" || CARD_CODES[org])) continue;
    if (seenOrg.has(org)) continue;
    seenOrg.add(org);
    cardAccounts.push({ org, isPersonal: acct.clientType === "P" });
  }
  debug.push(`approval accounts: ${cardAccounts.map((c) => `${c.org}(${c.isPersonal ? "P" : "B"})`).join(",") || "없음"}`);
  if (cardAccounts.length === 0) {
    return { synced: 0, errors, debug };
  }

  // 승인내역은 YYYYMMDD 8자리 (청구내역의 YYYYMM 6자리와 다름).
  const apprStart = startDate.slice(0, 8);
  const apprEnd = endDate.slice(0, 8);

  let totalSynced = 0;
  let debuggedKeys = false;
  let biznoSeen = 0, biznoTotal = 0, biznoFilled = 0;   // 청구내역과 같은 이유 — 카드사별 제공 여부를 눈에 보이게

  for (const { org, isPersonal } of cardAccounts) {
    const path = isPersonal
      ? "/v1/kr/card/p/account/approval-list"
      : "/v1/kr/card/b/account/approval-list";
    const reqBody: Record<string, any> = {
      connectedId, organization: org,
      startDate: apprStart, endDate: apprEnd,
      //   "0"(미포함) 이면 resMemberStoreCorpNo 가 통째로 빈칸으로 온다 — 실제로 승인 479건 전부 빈칸이었다.
      //   "1"(가맹점 포함) 이라야 사업자번호·업종·주소·전화가 붙는다. (2026-08-12)
      //   "3"(가맹점+부가세)도 있지만 BC·현대는 그때 다른 조회화면(출력양식=회계)을 타므로 안 건드린다.
      orderBy: "0", inquiryType: "1", memberStoreInfoType: "1",
    };
    if (!isPersonal) reqBody.applicationType = "0"; // 법인: 전체(취소 포함)

    const result = await codefRequest(token, path, reqBody);
    if (result.result?.code !== "CF-00000") {
      const code = result.result?.code || "UNKNOWN";
      errors.push({ accountNo: "", organization: org, code, message: result.result?.message || "승인내역 조회 실패", hint: codefErrorHint(code) });
      continue;
    }

    // 응답 정규화 — 단건 객체 / 다건 배열 / nested 래퍼 모두 대응.
    let raw: any = result.data;
    if (raw && !Array.isArray(raw) && typeof raw === "object") {
      for (const k of ["resApprovalList", "resCardApprovalList", "resList", "list"]) {
        if (Array.isArray(raw[k])) { raw = raw[k]; break; }
      }
    }
    const approvals = Array.isArray(raw) ? raw : (raw && raw.resApprovalNo) ? [raw] : [];
    debug.push(`card ${org}(${isPersonal ? "P" : "B"}) approvals: ${approvals.length}건`);
    if (approvals.length > 0 && !debuggedKeys) {
      debug.push(`card ${org} firstApproval keys: [${Object.keys(approvals[0]).join(",")}]`);
      debuggedKeys = true;
    }

    let skipNoApproval = 0;
    let skipRejected = 0;
    for (const a of approvals) {
      const cancelYN = String(a.resCancelYN || "").trim();
      if (cancelYN === "3") { skipRejected++; continue; } // 거절 — 실제 청구 안 됨

      const approvalNo = String(a.resCardApprovalNo || a.resApprovalNo || "").trim();
      const usedDate = String(a.resUsedDate || "").trim();
      // 승인번호 없는 알림성 건(신한 카드사용알림서비스료 등) 또는 날짜 결손 skip — external_id 안정성.
      if (!approvalNo || usedDate.length < 8) { skipNoApproval++; continue; }
      const usedTime = String(a.resUsedTime || "").trim();
      const formattedDate = `${usedDate.slice(0, 4)}-${usedDate.slice(4, 6)}-${usedDate.slice(6, 8)}`;

      // 금액: 해외건은 resKRWAmt(원화 환산) 우선, 국내는 resUsedAmount(원화).
      const usedAmt = Number(String(a.resUsedAmount || "0").replace(/,/g, "")) || 0;
      const krwAmt = Number(String(a.resKRWAmt || "0").replace(/,/g, "")) || 0;
      const amount = krwAmt > 0 ? krwAmt : usedAmt;

      const installments = Number(String(a.resInstallmentMonth || "0").replace(/,/g, "")) || null;
      const storeName = a.resMemberStoreName || "";
      const bizno = merchantBizno(a.resMemberStoreCorpNo);
      biznoTotal++; if (bizno) biznoSeen++;
      const cancelTag = cancelYN === "1" ? "[취소] " : cancelYN === "2" ? "[부분취소] " : "";

      // billing-list 와 동일 포맷 → 같은 승인건 자동 dedup.
      const externalId = `codef_card_${org}_${usedDate}_${usedTime}_${approvalNo}`;

      //   ★ 청구내역이 먼저 들어온 해외 결제는 external_id(사용시각 없음)·금액(환율)·가맹점명이
      //     서로 달라 여기서 두 줄이 됐다 — 같은 카드사·일자·승인번호가 이미 있으면 안 쌓는다. (2026-08-14)
      //     취소([취소] 표시, 음수)는 별 사건이라 대조하지 않는다. 사업자번호 얹기는 그대로 지나간다.
      let dupExists = false;
      if (cancelYN !== "1" && cancelYN !== "2" && amount > 0) {
        const { data: dupHits } = await supabase.from("card_transactions")
          .select("id")
          .eq("company_id", companyId)
          .eq("transaction_date", formattedDate)
          .eq("approval_number", approvalNo)
          .neq("external_id", externalId)
          .like("external_id", `codef_card_${org}_%`)
          .gt("amount", 0)
          .not("merchant_name", "like", "[%")
          .limit(1);
        dupExists = ((dupHits as unknown[] | null)?.length ?? 0) > 0;
      }

      if (!dupExists) {
      const { error } = await supabase.from("card_transactions").upsert({
        company_id: companyId,
        external_id: externalId,
        amount,
        merchant_name: cancelTag ? `${cancelTag}${storeName}` : storeName,
        transaction_date: formattedDate,
        approval_number: approvalNo,
        card_name: a.resCardName || CARD_CODES[org] || null,
        installments,
        merchant_bizno: bizno,
        source: "codef_card",
        mapping_status: "unmapped",
        raw_data: { channel: "codef_card_approval", organization: org, clientType: isPersonal ? "P" : "B", usedDate, usedTime, cancelYN, approval: a },
      }, { onConflict: "external_id", ignoreDuplicates: true });

      if (error) {
        debug.push(`card ${org} approval insert error: ${error.message}`);
      } else {
        totalSynced++;
      }
      }

      //   위 upsert 는 ignoreDuplicates 라 **이미 있는 행은 절대 안 건드린다**(사용자 매핑 보호).
      //   그래서 사업자번호를 받기 전에 들어온 옛 행은 영영 비어 있다 — 번호만 얹어 준다.
      //   청구내역과 같은 방식이고, 채워진 행만 바꾸므로 매핑·전표는 그대로다. (2026-08-12)
      if (bizno) {
        const { data: hit } = await supabase.from("card_transactions")
          .update({ merchant_bizno: bizno })
          .eq("company_id", companyId)
          .eq("transaction_date", formattedDate)
          .eq("approval_number", approvalNo)
          .is("merchant_bizno", null)
          .select("id");
        biznoFilled += (hit as any[] | null)?.length ?? 0;
      }
    }
    if (skipNoApproval > 0 || skipRejected > 0) {
      debug.push(`card ${org} skipped: noApprovalNo=${skipNoApproval}, rejected=${skipRejected}`);
    }
  }

  if (biznoTotal > 0) {
    debug.push(`approval 가맹점 사업자번호: 응답 ${biznoSeen}/${biznoTotal}건 · 새로 채운 행 ${biznoFilled}`);
  }
  return { synced: totalSynced, biznoFilled, errors, debug };
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

  const businessType = accountType === "card" ? "CD" : accountType === "hometax" ? "PB" : "BK";

  // 재등록 지원 (2026-08-04 사장님): 같은 기관이 이미 connectedId 에 등록돼 있으면
  //   add 는 중복 오류가 나므로 update 로 인증서/비밀번호를 갈아끼운다.
  //   오류 코드 추측 대신 계정 목록을 먼저 조회해 결정적으로 분기.
  //   /v1/account/* 는 무과금 관리 API — 상품 신청·과금과 무관.
  let path = "/v1/account/create";
  let matchedExisting: any = null;
  if (existingConnectedId) {
    try {
      const existing = await getAccountList(token, existingConnectedId);
      matchedExisting = existing.find((a: any) =>
        String(a.organization) === String(organization) && String(a.businessType) === businessType) || null;
    } catch (_) { /* 목록 조회 실패 시 기존 동작(add)으로 진행 */ }
    path = matchedExisting ? "/v1/account/update" : "/v1/account/add";
    if (matchedExisting) console.log(`[CODEF] org=${organization} already on connectedId — using /v1/account/update (credential swap)`);
  }

  const accountEntry: Record<string, any> = {
    countryCode: "KR",
    businessType,
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
      // CODEF API팀 답변(2026-08-05): pfx 인증서는 certType "0"이 아니라 "pfx" — "0"이면 CF-04009.
      accountEntry.certType = "pfx";
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

  let result = await codefRequest(token, path, body);

  // update 폴백 (2026-08-04 사장님 실기기 CF-04010 재현): 기관·기존 등록 방식에 따라 update 를
  //   거부하는 계정이 있어 "기존 계정 삭제 → 새 자격증명으로 add" 로 전환한다.
  //   delete/add 모두 무과금 관리 API. 우리 DB(거래내역·bank_accounts)는 CODEF 계정과 별개라 손실 없음.
  //   delete 매칭 파라미터는 새 요청값이 아니라 "기존 등록 계정"의 값으로 보낸다 (loginType 불일치 방지).
  if (result.result?.code !== "CF-00000" && path === "/v1/account/update" && matchedExisting) {
    console.log(`[CODEF] update failed (${result.result?.code}) — fallback to delete+add`);
    const delRes = await codefRequest(token, "/v1/account/delete", {
      connectedId: existingConnectedId,
      accountList: [{
        countryCode: matchedExisting.countryCode || "KR",
        businessType: matchedExisting.businessType || businessType,
        clientType: matchedExisting.clientType || (loginOpts.clientType || "B"),
        organization,
        loginType: matchedExisting.loginType ?? loginOpts.loginType,
      }],
    });
    if (delRes.result?.code === "CF-00000") {
      path = "/v1/account/add";
      result = await codefRequest(token, path, body);
      //   ⚠️ 2026-08-05 실사고: delete 성공 직후 add 가 CF-04009(중복)로 거부됨 — CODEF 측
      //     삭제 반영 지연. 여기서 포기하면 계정은 이미 지워진 채 남아 BC카드 수집이
      //     9일간 소리 없이 끊겼다. 지연 흡수를 위해 잠시 기다렸다 재시도한다.
      for (let retry = 0; retry < 3 && result.result?.code === "CF-04009"; retry++) {
        await new Promise((r) => setTimeout(r, 3000));
        console.log(`[CODEF] add after delete got CF-04009 — retry ${retry + 1}/3 (deletion propagation)`);
        result = await codefRequest(token, path, body);
      }
      if (result.result?.code !== "CF-00000") {
        //   재시도로도 복구 실패 = 기존 계정은 지워졌고 새 계정은 안 붙었다.
        //   "등록 실패"로만 보이면 이전 연결이 살아있는 줄 알게 되므로 상태를 명시한다.
        result.result = {
          ...result.result,
          message: `${result.result?.message || "등록 실패"} — ⚠️ 기존 ${organization} 계정은 삭제된 상태입니다. 이 카드/은행의 자동 수집이 멈춰 있으니 반드시 다시 등록해 주세요.`,
        };
      }
    } else {
      console.error(`[CODEF] delete fallback failed (${delRes.result?.code})`);
    }
  }

  if (result.result?.code !== "CF-00000") {
    const hint = codefErrorHint(result.result?.code);
    const extraMessage = result.result?.extraMessage || result.data?.errorMessage || "";
    console.error(`[CODEF] Registration failed: ${result?.result?.code || "unknown"}`);
    const err: any = new Error(`계정 등록 실패: ${result.result?.message || "알 수 없는 오류"} (${result.result?.code}, tx:${result.result?.transactionId || "-"})${extraMessage ? " [" + extraMessage + "]" : ""}${hint ? " — " + hint : ""}`);
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
  return Array.isArray(accounts) ? accounts : accounts ? [accounts] : [];
}

// ── 홈택스 인증 자료 로딩 (PFX 우선 → der/key 폴백) ─────────────────────────
//   2026-08-05: CODEF API팀 답변으로 pfx 는 certType "pfx" 로 보내야 함이 확인됐고(은행 등록 실증),
//   국세청 통합조회도 pfx 로 CF-00000 성공을 실증했다. 그래서 'PC 인증서 자동 선택'이 저장한
//   hometax.pfx 가 있으면 그것을, 없으면 기존 signCert.der/signPri.key 를 쓴다.
//   반환 auth 는 CODEF 요청부에 그대로 spread 하면 되는 형태.
type HometaxCert = { auth: Record<string, string>; encryptedCertPw: string; source: "pfx" | "derkey" };
async function loadHometaxCert(
  supabase: any, companyId: string,
): Promise<{ cert: HometaxCert | null; error: SyncError | null }> {
  const ORG = "0002";
  const fail = (code: string, message: string, hint: string) =>
    ({ cert: null, error: { accountNo: "", organization: ORG, code, message, hint } });
  try {
    const [pfxDl, credRow] = await Promise.all([
      supabase.storage.from("certificates").download(`${companyId}/hometax.pfx`),
      supabase.from("automation_credentials").select("credentials").eq("company_id", companyId).eq("service", "hometax").maybeSingle(),
    ]);
    const encryptedPw = credRow.data?.credentials?.cert_password;
    if (!encryptedPw) {
      return fail("HOMETAX_CERT_PASSWORD_MISSING", "홈택스 공동인증서 비밀번호가 등록되어 있지 않습니다.",
        "설정 → 은행연동 → 홈택스에서 인증서를 다시 등록하세요.");
    }
    const { data: plainPw, error: decErr } = await supabase.rpc("decrypt_credential", { p_ciphertext: encryptedPw });
    if (decErr || !plainPw) {
      return fail("HOMETAX_CERT_DECRYPT_FAILED", `인증서 비밀번호 복호화 실패: ${decErr?.message || "응답 없음"}`,
        "설정에서 인증서를 다시 등록하세요.");
    }
    const publicKey = Deno.env.get("CODEF_PUBLIC_KEY") || "";
    const encryptedCertPw = publicKey ? rsaEncrypt(String(plainPw), publicKey) : String(plainPw);

    if (!pfxDl.error && pfxDl.data) {
      const pfxB64 = Buffer.from(new Uint8Array(await pfxDl.data.arrayBuffer())).toString("base64");
      return { cert: { auth: { certType: "pfx", certFile: pfxB64 }, encryptedCertPw, source: "pfx" }, error: null };
    }
    const [certDl, keyDl] = await Promise.all([
      supabase.storage.from("certificates").download(`${companyId}/signCert.der`),
      supabase.storage.from("certificates").download(`${companyId}/signPri.key`),
    ]);
    if (certDl.error || !certDl.data || keyDl.error || !keyDl.data) {
      return fail("HOMETAX_CERT_MISSING", "홈택스 공동인증서가 등록되어 있지 않습니다.",
        "설정 → 은행연동 → 홈택스에서 'PC 인증서 자동 선택'으로 등록하세요.");
    }
    return {
      cert: {
        auth: {
          certType: "1",
          certFile: Buffer.from(new Uint8Array(await certDl.data.arrayBuffer())).toString("base64"),
          keyFile: Buffer.from(new Uint8Array(await keyDl.data.arrayBuffer())).toString("base64"),
        },
        encryptedCertPw,
        source: "derkey",
      },
      error: null,
    };
  } catch (err: any) {
    return fail("HOMETAX_CERT_LOAD_FAILED", `인증서 로드 실패: ${err?.message || err}`, "설정에서 인증서를 재등록하세요.");
  }
}

// ── 전자세금계산서 상세 조회 (2026-08-05 사장님: "홈택스엔 공급받는자 주소·이메일이 다 있는데") ──
//   통합 목록 API 는 사업장 주소·이메일을 주지 않는다. 상세 API 에는 둘 다 있다:
//     resSupplierBusinessPlace/resContractorBusinessPlace(사업장), resEmail(공급자)/resEmail1(공급받는자), 대표자명
//   ⚠️ 건당 과금 + CODEF 문서 경고("과도한 호출 시 대상기관 IP 차단") → 한 건당 한 번만, 결과는 DB 에 캐시.
//   승인번호(approvalNo)가 있는 발행분만 조회 가능.
async function fetchHometaxInvoiceDetail(
  supabase: any, token: string, invoice: any, cert: HometaxCert,
): Promise<{ ok: boolean; code?: string; message?: string }> {
  const approvalNo = String(invoice.nts_confirm_no || "").trim();
  if (!approvalNo) return { ok: false, code: "NO_APPROVAL_NO", message: "승인번호가 없어 상세 조회 불가" };

  const resp = await codefRequest(token, "/v1/kr/public/nt/tax-invoice/info-detail", {
    organization: "0002",
    loginType: "0",
    ...cert.auth,
    certPassword: cert.encryptedCertPw,
    approvalNo,
    originDataYN: "0",   // 원문 PDF(Base64)는 용량이 커 받지 않는다
  });
  const code = resp?.result?.code;
  if (code !== "CF-00000") return { ok: false, code, message: resp?.result?.message };

  const d = Array.isArray(resp.data) ? resp.data[0] : resp.data;
  if (!d) return { ok: false, code: "EMPTY", message: "상세 응답 없음" };

  // 매출 = 우리가 공급자 → 거래처는 공급받는자(Contractor). 매입 = 반대(Supplier).
  const isSales = invoice.type === "sales";
  const pick = (v: unknown) => String(v ?? "").replace(/\+/g, " ").trim() || null;
  const patch: Record<string, unknown> = {
    counterparty_address: pick(isSales ? d.resContractorBusinessPlace : d.resSupplierBusinessPlace),
    counterparty_email: pick(isSales ? (d.resEmail1 || d.resEmail2) : d.resEmail),
    counterparty_representative: pick(isSales ? d.resContractorName : d.resSupplierName),
    counterparty_business_type: pick(isSales ? d.resContractorBusinessTypes : d.resSupplierBusinessTypes),
    counterparty_business_item: pick(isSales ? d.resContractorBusinessItems : d.resSupplierBusinessItems),
    detail_fetched_at: new Date().toISOString(),
  };
  // 상세가 빈 값을 준 항목은 기존 값을 지우지 않는다(명부 폴백으로 채워둔 값 보호).
  for (const k of ["counterparty_address", "counterparty_email", "counterparty_representative",
                   "counterparty_business_type", "counterparty_business_item"]) {
    if (patch[k] === null) delete patch[k];
  }
  const { error } = await supabase.from("tax_invoices").update(patch).eq("id", invoice.id);
  if (error) return { ok: false, code: "DB_UPDATE_FAIL", message: error.message };
  return { ok: true };
}

// HomeTax tax invoice sync via CODEF API
// '전자세금계산서 통합 API' (/integrated-check-list) 는 connectedId 가 아닌 매번 cert 로 인증.
// 1) Storage 의 NPKI 인증서(signCert.der/signPri.key) + automation_credentials.hometax.cert_password 로딩
// 2) RSA 암호화 (CODEF_PUBLIC_KEY) 후 reqBody 에 포함
// 3) verify 함수와 동일한 endpoint/필드 사용
async function syncHometaxInvoices(
  supabase: any, token: string, companyId: string, _connectedId: string,
  startDate: string, endDate: string,
  // 조회할 방향. 한 번에 한 방향만 부르면 대기시간을 길게 줄 수 있어 CF-TIMEOUT 이 크게 준다.
  //   (CODEF 이 API 자체 Timeout 은 600초. 우리 상한 70초가 실패의 주원인이었다 — 2026-08-06)
  directions: ("매출" | "매입")[] = ["매출", "매입"],
  // 이어받기 — 앞 step 이 시간 예산 때문에 못 끝낸 페이지부터 시작한다.
  startPage = 1,
  // 문서 종류 (2026-08-10 사장님 — "전자계산서도 불러와줘") —
  //   tax = 전자세금계산서(searchType 01, 기존), exempt = 전자계산서(면세, searchType 02).
  //   같은 통합 API·같은 인증서로 조회하며 tax_invoices.doc_kind 로 구분 저장.
  //   searchType 값이 예상과 달라 같은 세금계산서가 다시 와도, 승인번호(nts_confirm_no)가
  //   이미 있는 행은 insert 를 건너뛰므로 데이터가 오염되지 않는다(신규 0건으로 끝남).
  docKind: "tax" | "exempt" = "tax",
) {
  const errors: SyncError[] = [];
  const debug: string[] = [];   // 응답 구조 진단용 — totalSynced=0 인데 진짜 0건인지 parsing 누락인지 구분
  let totalSynced = 0;
  let totalResponseCount = 0;   // CODEF 가 응답에 준 row 수 (매출+매입 합계). 누락 진단용.

  // 국세청(홈택스) organization code — '전자세금계산서 통합' product 는 0002 사용 (3a91f86 확인).
  const HOMETAX_ORG = "0002";

  // ─── cert 로딩 (PFX 우선 → der/key 폴백) ───
  const { cert: htCert, error: htCertErr } = await loadHometaxCert(supabase, companyId);
  if (!htCert) {
    errors.push(htCertErr!);
    return { synced: 0, errors };
  }
  const encryptedCertPw = htCert.encryptedCertPw;
  debug.push(`cert source=${htCert.source}`);

  // CF-13001 방지: 미래 날짜는 today 로 cap. CODEF 통합 API 는 endDate > today 면 거부.
  const todayYmd = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const cappedEnd = endDate > todayYmd ? todayYmd : endDate;
  const cappedStart = startDate > cappedEnd ? cappedEnd : startDate;

  // ─── 매출/매입 병렬 호출 (단일 기간) ───
  // CODEF 가 동일 인증 정보로 같은 product 의 동시 호출 거부 (CF-00016 — 중복 요청 거부).
  // chunk 별 병렬은 불가. 한 호출에 받은 startDate~endDate 그대로 처리.
  // 1년치 sync 가 필요하면 frontend 가 월별 12번 sequential 호출.
  // 한 방향만 조회하면 이 invocation 에서 CODEF 호출이 1번뿐 → Edge 150초 안에서 135초까지 대기 가능.
  const perCallTimeoutMs = directions.length === 1 ? 135_000 : CODEF_REQUEST_TIMEOUT_MS;
  // 페이지 단위 조회 (2026-08-06) — 종전엔 startPageNo/pageCount 를 안 보내 **한 달치를 통째로**
  //   요청했고, 건수가 많은 달(6월 매출 290건)은 135초 안에 응답이 안 와 매번 실패했다.
  //   같은 시간대에 141건(7월)은 성공, 377건(6월)은 실패 — 시간대가 아니라 응답 크기가 원인.
  //   한 번에 한 페이지만 받아 빠르게 끝내고, 남은 페이지는 이어서 받는다.
  const callDirection = (direction: "매출" | "매입", startPageNo: number, timeoutMs: number) =>
    codefRequest(token, "/v1/kr/public/nt/tax-invoice/integrated-check-list", {
      organization: HOMETAX_ORG,
      loginType: "0",
      ...htCert.auth,
      certPassword: encryptedCertPw,
      // 공식 문서 확정(2026-08-11, developer.codef.io SPA 렌더로 확보):
      //   inquiryType(조회구분) "01" 전자세금계산서 / "02" 위수탁 세금계산서 / "03" 전자계산서 / "04" 위수탁 계산서
      //   searchType(조회 기간 구분) "01" 작성일자 / "02" 발급일자 / "03" 전송일자
      //   type "0" 기존 조회 / "1" 엑셀다운로드
      inquiryType: docKind === "exempt" ? "03" : "01",
      searchType: "01",
      startDate: cappedStart,
      endDate: cappedEnd,
      sortby: "1",
      orderBy: "0",
      transeType: direction === "매출" ? "01" : "02",
      type: "0",
      startPageNo: String(startPageNo),
      pageCount: "1",
    }, timeoutMs).then((result) => ({ direction, result, chunkStart: cappedStart, chunkEnd: cappedEnd }));

  // 응답에서 행 배열을 꺼내는 공통 로직 (아래 본 처리와 같은 규칙)
  const unwrapRows = (data: any): any[] => {
    let raw: any = data;
    if (raw && !Array.isArray(raw) && typeof raw === "object") {
      for (const key of ["resTaxInvoiceList", "resInvoiceList", "list", "resList"]) {
        if (Array.isArray(raw[key])) { raw = raw[key]; break; }
      }
    }
    return Array.isArray(raw) ? raw : raw ? [raw] : [];
  };

  const reportedCodes = new Set<string>();
  const fatalCodes = new Set(["CF-00003", "CF-00007", "CF-00401", "CF-04015", "CF-12200"]);

  // 매출/매입은 sequential — CODEF 가 동시 호출을 거부한다(CF-00016, 검증됨).
  //   방향을 1개만 받으면 Edge 150초 한계 안에서 최대한 길게(135초) 기다린다.
  //   2개를 다 받으면 종전대로 70초씩(= 최대 140초).
  //   ⚠️ Edge Function 은 실행 시간 상한(150초)이 있다. 페이지를 한 invocation 안에서 계속 돌면
  //   상한을 넘겨 **아무것도 기록하지 못한 채 죽는다**(2026-08-06 실측: 결과 0건, 락만 갱신).
  //   그래서 남은 예산을 보며 돌고, 못 끝낸 페이지는 다음 step 이 이어받는다(pageCursor 반환).
  const INVOCATION_BUDGET_MS = 115_000;   // 150초 한도 - 여유(업서트·백필 시간)
  const startedAt = Date.now();
  const remainingMs = () => INVOCATION_BUDGET_MS - (Date.now() - startedAt);

  const settled: { direction: "매출" | "매입"; result: any; chunkStart: string; chunkEnd: string }[] = [];
  const MAX_PAGES = 30;   // 무한루프 방지 상한
  let nextCursor: { direction: "매출" | "매입"; page: number } | null = null;
  for (const dir of directions) {
    let page = startPage;
    // ⚠️ 총 페이지 수는 **응답을 받아야 알 수 있다**. 1 로 시작해 `page <= totalPages` 로 들어가면
    //   이어받기(page=3 등)에서 `3 <= 1` 이 거짓이라 **호출을 한 번도 안 하고** 빈 결과로 끝나고,
    //   그게 '완료'로 기록돼 남은 페이지가 영영 안 받아졌다 (2026-08-06 실측·수정).
    //   → 첫 페이지는 무조건 호출하고, 총 페이지 수는 응답에서 확인한다.
    let totalPages: number | null = null;
    while (page <= MAX_PAGES) {
      if (totalPages !== null && page > totalPages) break;   // 마지막 페이지까지 다 받음
      // 이번 호출을 제대로 감당할 시간이 없으면 **호출하지 않고** 다음 step 에 넘긴다.
      //   (남은 예산이 적어도 20초짜리로 강행하면 그 페이지가 항상 타임아웃났다 — 실측)
      const MIN_CALL_MS = 45_000;
      if (remainingMs() < MIN_CALL_MS) { nextCursor = { direction: dir, page }; break; }
      const one = await callDirection(dir, page, Math.min(perCallTimeoutMs, remainingMs() - 5_000));
      settled.push(one);
      if (one.result?.result?.code !== "CF-00000") {
        // 실패한 페이지부터 이어받게 커서를 남긴다 — 없으면 재시도가 1페이지부터 다시 받아
        // 같은 자리에서 계속 막힌다(이미 받은 페이지도 다시 받아 시간·과금 낭비).
        nextCursor = { direction: dir, page };
        break;
      }
      const rows = unwrapRows(one.result.data);
      const tp = Number(rows[0]?.resTotalPageCount);
      if (Number.isFinite(tp) && tp > 0) totalPages = tp;
      else if (totalPages === null) totalPages = 1;   // 총 페이지를 안 주면 1페이지짜리로 간주
      if (rows.length === 0) break;                   // 더 받을 데이터 없음
      page++;
      if (totalPages !== null && page > totalPages) break;
    }
    debug.push(`${dir} pages ${startPage}~${page - 1}/${totalPages ?? "?"}`);
    if (nextCursor) break;   // 예산 소진 — 남은 방향도 다음 step 으로
  }
  debug.push(`sync ${cappedStart}~${cappedEnd} dirs=[${directions.join(",")}] budget=${INVOCATION_BUDGET_MS / 1000}s`);

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

    // 진단(2026-08-05 사장님: "홈택스엔 공급받는자 주소·이메일이 다 있는데 왜 안 불러오냐") —
    //   CODEF 가 실제로 어떤 필드를 주는지 확인용. **필드명만** 남긴다(값은 개인정보라 금지).
    //   주소·이메일 필드가 응답에 있으면 그걸 읽어 저장하도록 매핑을 넓히면 된다.
    if (invoices.length > 0) {
      const keys = Object.keys(invoices[0] || {});
      console.log(`[HOMETAX-FIELDS] ${direction} keys=${keys.join(",")}`);
      const interesting = keys.filter((k) => /addr|email|mail|tel|phone|zip|post/i.test(k));
      console.log(`[HOMETAX-FIELDS] ${direction} addr/email 후보=${interesting.join(",") || "없음"}`);
      // 전자계산서(면세) 검증 진단 — 계산서면 전 행이 부가세 0원이어야 한다 (2026-08-11)
      if (docKind === "exempt") {
        const zeroVat = invoices.filter((i: any) => Number(i.resTaxAmt || 0) === 0).length;
        debug.push(`${direction} exempt 검증: 부가세0원 ${zeroVat}/${invoices.length}건`);
        // 응답 필드명 — 계산서 응답이 세금계산서와 필드 구조가 다르면 여기서 드러난다 (값은 미기록)
        debug.push(`${direction} keys=${Object.keys(invoices[0] || {}).slice(0, 30).join(",")}`);
        console.log(`[EXEMPT-CHECK] ${direction} zeroVat=${zeroVat}/${invoices.length}`);
      }
    }

    const isSales = direction === "매출";
    let upsertErrors = 0;
    let firstUpsertError: any = null;
    const rowsToUpsert: any[] = [];   // batch upsert 용 — N row × DB round trip 1번
    // 스킵 사유 카운터 (2026-08-11 진단) — synced=0 이 어느 필터 때문인지 구분
    let skipNoConfirm = 0, skipDateRange = 0, skipTaxAmt = 0;

    for (const inv of invoices) {
      // CODEF 통합 API 응답: resApprovalNo = 국세청 승인번호 (= nts_confirm_no 에 저장)
      //   2026-08-04: 목록 API 는 하이픈 포함(예: 20260722-41000203-00002561), 발행 API 는
      //   24자리 무하이픈 — 형식이 달라 같은 계산서가 upsert 키 불일치로 중복 저장됐다.
      //   저장 전 항상 영숫자만 남겨 정규화(발행 경로·기존 데이터 정규화와 동일 기준).
      const ntsConfirmNo = String(inv.resApprovalNo || "").trim().replace(/[^0-9A-Za-z]/g, "");
      if (!ntsConfirmNo) { skipNoConfirm++; continue; }

      // ⚠️ 작성일자(공급일자) vs 발행일자 구분:
      //   resReportingDate = 작성일자/공급일자 (예: 20260228) — 한국 세무 관행상 거래 월 기준
      //   resIssueDate     = 발행일 (예: 20260309) — 다음달 10일까지 발행 가능
      // 화면 월별 그룹핑은 issue_date 컬럼(=작성일자) 기준.
      const reportingDate = String(inv.resReportingDate || "").trim();
      // CODEF 매입 응답이 검색 기간 외(특히 그 이후) 작성일자도 섞어 보내는 케이스 방어.
      // 작성일자가 이 chunk 기간 밖이면 skip — 다른 chunk 호출에서 정확히 잡힘.
      if (reportingDate.length !== 8 || reportingDate < chunkStart || reportingDate > chunkEnd) {
        skipDateRange++;
        continue;
      }

      // 전자계산서(면세) 모드 가드 — 계산서는 부가세가 항상 0원. 파라미터가 어긋나
      //   세금계산서가 섞여 와도 doc_kind='exempt' 로 오염 저장되지 않게 여기서 차단 (2026-08-11).
      if (docKind === "exempt" && Number(inv.resTaxAmt || 0) !== 0) {
        skipTaxAmt++;
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
      // 대표자명 — 상호(CompanyName)와 별개 필드(resContractor/SupplierName = 대표자/성명).
      const counterpartyRep = isSales
        ? (inv.resContractorName || "")
        : (inv.resSupplierName || "");
      // 이메일 — ⚠️ 2026-08-05 사장님 지적으로 발견한 오매핑:
      //   종전엔 resContractorEmail / resSupplierEmail 을 읽었는데 **응답에 없는 이름**이라
      //   1,826건 전부 빈 값이었다. 통합 목록 API 실제 필드는
      //     resEmail(공급자) / resEmail1·resEmail2(공급받는자).
      const counterpartyEmail = isSales
        ? (inv.resEmail1 || inv.resEmail2 || "")
        : (inv.resEmail || "");
      // 사업장 주소 — 목록 응답에 이미 있는데 아예 읽지 않아 화면에서 '-' 로 나오던 값.
      //   (매출이면 거래처=공급받는자, 매입이면 거래처=공급자)
      const counterpartyAddress = isSales
        ? (inv.resContractorBusinessPlace || "")
        : (inv.resSupplierBusinessPlace || "");

      rowsToUpsert.push({
        company_id: companyId,
        nts_confirm_no: ntsConfirmNo,
        issue_date: formattedDate,
        type: isSales ? "sales" : "purchase",
        doc_kind: docKind,   // tax=세금계산서 / exempt=전자계산서(면세) — 수집 경로 구분
        // 면세 계산서는 과세유형도 exempt 로 — 발행 경로의 tax_kind('taxable'|'zero_rated'|'exempt')와 정합.
        //   세금계산서(tax) 수집은 종전대로 tax_kind 를 건드리지 않는다(DB 기본값 유지).
        ...(docKind === "exempt" ? { tax_kind: "exempt" } : {}),
        status: "issued",
        source: "codef_hometax",
        counterparty_name: counterpartyName,
        counterparty_bizno: counterpartyBizno,
        counterparty_business_type: counterpartyBizType,
        counterparty_business_item: counterpartyBizItem,
        counterparty_representative: counterpartyRep || null,
        counterparty_email: counterpartyEmail || null,
        counterparty_address: counterpartyAddress || null,
        supply_amount: Number(inv.resSupplyValue || 0),
        tax_amount: Number(inv.resTaxAmt || 0),
        total_amount: Number(inv.resTotalAmount || 0),
        item_name: inv.resRepItems || null,
        hometax_synced_at: new Date().toISOString(),
      });
    }

    // Batch upsert — row 마다 1 round trip → 한 번에 처리. 큰 응답일수록 큰 효과 (100건이면 ~100배 빠름).
    // 2026-08-04: 이미 있는 행(발행 경로 manual, 수정발행 modified 등)은 status·source·금액을
    //   덮지 않고 hometax_synced_at 만 갱신 — '미전송' 오표시만 해소하고 로컬 상태는 보존.
    //   신규 행만 전체 insert (국세청 발행분은 불변이라 기존 행 재갱신 필요 없음).
    if (rowsToUpsert.length > 0) {
      const keys = rowsToUpsert.map((r) => r.nts_confirm_no);
      const { data: existingRows, error: exErr } = await supabase
        .from("tax_invoices")
        .select("id, nts_confirm_no, counterparty_address, counterparty_email, counterparty_representative")
        .eq("company_id", companyId)
        .in("nts_confirm_no", keys);
      if (exErr) {
        upsertErrors = rowsToUpsert.length;
        firstUpsertError = { message: exErr.message, code: (exErr as any).code };
        debug.push(`${direction} existing-keys select error: ${exErr.message}`);
      } else {
        const existingSet = new Set((existingRows || []).map((r: any) => r.nts_confirm_no));
        const newRows = rowsToUpsert.filter((r) => !existingSet.has(r.nts_confirm_no));
        const existingIds = (existingRows || []).map((r: any) => r.id);

        if (newRows.length > 0) {
          const { error } = await supabase.from("tax_invoices").upsert(newRows, { onConflict: "company_id,nts_confirm_no" });
          if (error) {
            upsertErrors = newRows.length;
            firstUpsertError = { message: error.message, code: (error as any).code };
            debug.push(`${direction} batch upsert error: ${error.message}`);
          } else {
            totalSynced += newRows.length;
          }
        }
        if (existingIds.length > 0) {
          const { error } = await supabase.from("tax_invoices")
            .update({ hometax_synced_at: new Date().toISOString() })
            .in("id", existingIds);
          if (error) {
            debug.push(`${direction} synced_at update error: ${error.message}`);
          } else {
            totalSynced += existingIds.length;
          }
          // 이메일·사업장 오매핑으로 과거에 못 채운 값 backfill (2026-08-05).
          //   **비어 있는 칸만** 채운다 — 사용자가 직접 고쳐 넣은 값은 건드리지 않는다.
          //   다시 동기화만 하면 과거 건도 채워지므로 별도 소급 작업이 필요 없다.
          const byKey = new Map(rowsToUpsert.map((r) => [r.nts_confirm_no, r]));
          let filled = 0;
          for (const ex of existingRows || []) {
            const src = byKey.get(ex.nts_confirm_no);
            if (!src) continue;
            const patch: Record<string, unknown> = {};
            if (!ex.counterparty_address && src.counterparty_address) patch.counterparty_address = src.counterparty_address;
            if (!ex.counterparty_email && src.counterparty_email) patch.counterparty_email = src.counterparty_email;
            if (!ex.counterparty_representative && src.counterparty_representative) patch.counterparty_representative = src.counterparty_representative;
            if (Object.keys(patch).length === 0) continue;
            const { error: upErr } = await supabase.from("tax_invoices").update(patch).eq("id", ex.id);
            if (!upErr) filled++;
          }
          if (filled > 0) debug.push(`${direction} 기존행 주소·이메일 backfill ${filled}건`);
        }
        debug.push(`${direction} new=${newRows.length}, existing(synced_at only)=${existingIds.length}`);
      }
    }
    if (upsertErrors > 0) {
      debug.push(`${direction} upsertErrors=${upsertErrors}, first=${JSON.stringify(firstUpsertError)}`);
    }
    if (skipNoConfirm || skipDateRange || skipTaxAmt) {
      debug.push(`${direction} skip: 승인번호없음=${skipNoConfirm} 기간밖=${skipDateRange} 부가세있음=${skipTaxAmt}`);
    }
  }

  // ── 신규 건 상세 보강 (2026-08-05 사장님 지시 2번) ───────────────────────────
  //   통합 목록에 없는 사업장 주소·이메일을 상세 API 로 채운다. 새로 들어온 건만, 그리고
  //   한 번에 DETAIL_MAX 건까지만 — CODEF 문서가 "과도한 호출 시 기관 IP 차단" 을 경고하고
  //   건당 과금이라 배치처럼 몰아치지 않는다. 남은 건은 상세 화면을 열 때 1건씩 채워진다.
  //   상세 실패는 동기화 자체를 실패시키지 않는다(본체는 이미 저장 완료).
  //   ⚠️ 2026-08-05 재확인: 사업장 주소·이메일은 **통합 목록 응답에 이미 있다**(resContractorBusinessPlace,
  //   resEmail/resEmail1). 위 매핑에서 바로 저장하므로 상세 API 를 부를 이유가 없다 — 기본 비활성.
  //   상세 API 는 품목 리스트·원문 PDF 같은 추가 정보가 필요할 때만 쓴다(상품 승인 + 건당 과금 필요).
  const DETAIL_ENRICH_ENABLED = false;
  const DETAIL_MAX = 10;
  try {
    if (!DETAIL_ENRICH_ENABLED) throw new Error("detail enrich disabled — 목록 응답으로 충분");
    const { data: pending } = await supabase
      .from("tax_invoices")
      .select("id, type, nts_confirm_no")
      .eq("company_id", companyId)
      .eq("source", "codef_hometax")
      .is("detail_fetched_at", null)
      .not("nts_confirm_no", "is", null)
      .gte("issue_date", `${cappedStart.slice(0, 4)}-${cappedStart.slice(4, 6)}-${cappedStart.slice(6, 8)}`)
      .lte("issue_date", `${cappedEnd.slice(0, 4)}-${cappedEnd.slice(4, 6)}-${cappedEnd.slice(6, 8)}`)
      .order("issue_date", { ascending: false })
      .limit(DETAIL_MAX);
    let done = 0;
    for (const row of pending || []) {
      const r = await fetchHometaxInvoiceDetail(supabase, token, row, htCert);
      if (r.ok) { done++; continue; }
      // 영구 실패는 즉시 중단 — 재시도해도 결과가 같아 호출만 태운다.
      //   CF-00401/CF-00003 = 상품 미신청·권한 없음 (2026-08-05 실측: 상세 상품 미신청 상태에서 44콜 낭비)
      //   CF-12xx = 기관(국세청) 지연·차단 신호
      if (r.code === "CF-00401" || r.code === "CF-00003" || (r.code || "").startsWith("CF-12")) {
        debug.push(`detail 보강 중단(${r.code})`);
        break;
      }
    }
    if ((pending?.length ?? 0) > 0) debug.push(`detail 보강 ${done}/${pending!.length}건`);
  } catch (e: any) {
    debug.push(`detail 보강 skip: ${e?.message || e}`);
  }

  return { synced: totalSynced, responseCount: totalResponseCount, errors, debug, nextCursor };
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

  // ─── cert 로딩 (PFX 우선 → der/key 폴백, syncHometaxInvoices 와 동일 헬퍼) ───
  const { cert: htCert, error: htCertErr } = await loadHometaxCert(supabase, companyId);
  if (!htCert) {
    errors.push({ ...htCertErr!, organization: HOMETAX_ORG });
    return { synced: 0, responseCount: 0, errors, debug };
  }
  const encryptedCertPw = htCert.encryptedCertPw;
  debug.push(`cert source=${htCert.source}`);

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
    ...htCert.auth,
    certPassword: encryptedCertPw,
    startDate: cappedStart,
    endDate: cappedEnd,
    orderBy: "0",  // 최신순
    ...(identity ? { identity } : {}),
  });
  debug.push(`cash-receipt sync ${cappedStart}~${cappedEnd} identity=${identity ? "set" : "none"}`);
  // 현금영수증 진단 상세 로그 제거(민감정보) — 오류코드는 아래 분기에서 처리.
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

serve(withSentry("codef-sync", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // 계측 스토어 — 이 invocation 의 CODEF 호출을 ALS 로 수집, 응답 후 원장 적재
  const meterStore: MeterStore = { calls: [], companyId: null, action: "" };
  const runWithMeter = usageALS
    ? (fn: () => Promise<Response>) => usageALS.run(meterStore, fn)
    : (fn: () => Promise<Response>) => fn();
  return await runWithMeter(async () => {
  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const body = await req.json();
    const { companyId, action = "sync", syncType = "all", startDate, endDate, connectedId } = body;
    meterStore.companyId = companyId || null;
    meterStore.action = action;

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
      const allowedInternalActions = new Set(["hometax-cron-tick", "hometax-job-step", "bank-cron-tick", "bank-cron-one", "card-cron-tick", "card-cron-one", "card-approval-cron-one", "card-approval-peek", "card-bizno-backfill"]);
      if (!allowedInternalActions.has(action)) {
        return new Response(JSON.stringify({ error: "internal auth 는 cron-tick/job-step 만 허용" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // ── 수동 수집 요금제 검사 (2026-08-11) ─────────────────────────────────
    //   지금까지 요금제 검사가 **화면에만** 있어 엣지를 직접 부르면 무료 계정도 수동 수집이 됐다.
    //   CODEF 는 계좌당 월 600원이 실제로 나가는 유일한 변동비라 여기서 한 번 더 막는다.
    //   · cron/서비스롤(isInternalAuth) 은 검사하지 않는다 — 자동 수집은 요금제가 이미 정한 일이다.
    //   · **요금제만** 본다. 30분 쿨타임은 화면에 남긴다 — '한 번에 수집'이 홈택스 3종을 차례로
    //     부르는데 셋 다 sync_type='hometax' 라 여기서 쿨타임을 걸면 두 번째부터 스스로 막힌다.
    //   · 조회 자체가 실패하면 막지 않는다(fail-open) — 검사 장애가 수집을 멈추면 안 된다.
    if (!isInternalAuth && companyId) {
      try {
        const { data: allowed, error: planErr } = await supabase
          .rpc("is_manual_sync_allowed", { p_company: companyId });
        if (!planErr && allowed === false) {
          return new Response(JSON.stringify({
            error: "무료 요금제는 수동 수집을 쓸 수 없습니다 — 자동 수집(하루 2회)은 그대로 됩니다.",
            code: "MANUAL_NOT_ALLOWED",
          }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      } catch { /* 검사 장애로 수집을 멈추지 않는다 */ }
    }

    // cron-tick 은 companyId 없이 글로벌 처리. 그 외 action 은 companyId 필수.
    //   (bank-cron-tick 도 글로벌 — companyId 없이 회사 enumerate 후 fan-out)
    if (!companyId && action !== "hometax-cron-tick" && action !== "bank-cron-tick" && action !== "card-cron-tick") {
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

    // --- Action: bank-cron-tick (글로벌, companyId 없이) ---
    //   은행 거래 자동 동기화 스케줄러. codef_connected_id 보유 회사를 enumerate 해
    //   회사별로 bank-cron-one 을 fire-and-forget 자가호출(타임아웃 격리).
    //   ⚠️ 은행 분기 전용 — 홈택스/현금영수증/카드 미접촉. dedup(20260518130000)으로
    //      중복 안전. hometax-cron-tick 과 동일한 fan-out 패턴.
    if (action === "bank-cron-tick") {
      const { data: allCompanies } = await supabase
        .from("company_settings")
        .select("company_id, codef_connected_id, codef_client_id")
        .not("codef_connected_id", "is", null)
        .neq("codef_connected_id", "")
        .limit(50);
      // 체험 만료·해지 기간종료 회사 제외 — 페이월 뒤 회사에 CODEF 과금 누수 방지
      const billable = await filterBillableCompanies(supabase, (allCompanies || []).map((c: any) => c.company_id));
      const companies = (allCompanies || []).filter((c: any) => billable.has(c.company_id));
      const selfUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/codef-sync`;
      const cronSecretForChain = CRON_SECRET;
      const triggers = (companies || []).map((c: any) =>
        fetch(selfUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": authHeader as string,
            "X-Cron-Secret": cronSecretForChain,
          },
          body: JSON.stringify({ companyId: c.company_id, action: "bank-cron-one" }),
        }).catch(() => {})
      );
      // @ts-expect-error EdgeRuntime
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
        // @ts-expect-error EdgeRuntime
        EdgeRuntime.waitUntil(Promise.all(triggers));
      } else {
        Promise.all(triggers).catch(() => {});
      }
      return new Response(JSON.stringify({ ok: true, triggered: companies?.length || 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- Action: card-cron-tick (글로벌, companyId 없이) — 카드 자동 동기화 스케줄러 ---
    //   2026-06-10 추가. bank-cron-tick 미러: codef_connected_id 보유 회사 enumerate → 회사별 자가호출.
    //   2026-06-29: 청구내역(card-cron-one)에 더해 실시간 승인내역(card-approval-cron-one)도 회사별로 발사.
    //     · 청구내역은 카드사 마감 후에야 내려와 수일~수주 지연 → 최근 거래가 안 보였음.
    //     · 승인내역은 결제 즉시 잡혀 "오늘까지" 보임(은행 동기화 체감과 동일).
    //     · billing+approval 을 같은 호출에 묶으면 Edge 150s 초과(HTTP 546) → 회사당 2개 호출로 분리.
    //   dedup(external_id 동일 포맷)으로 billing/approval 간 중복 안전.
    if (action === "card-cron-tick") {
      const { data: allCardCompanies } = await supabase
        .from("company_settings")
        .select("company_id, codef_connected_id")
        .not("codef_connected_id", "is", null)
        .neq("codef_connected_id", "")
        .limit(50);
      // 체험 만료·해지 기간종료 회사 제외 — bank-cron-tick 과 동일 가드
      const cardBillable = await filterBillableCompanies(supabase, (allCardCompanies || []).map((c: any) => c.company_id));
      const companies = (allCardCompanies || []).filter((c: any) => cardBillable.has(c.company_id));
      const selfUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/codef-sync`;
      const triggers = (companies || []).flatMap((c: any) => [
        fetch(selfUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": authHeader as string, "X-Cron-Secret": CRON_SECRET },
          body: JSON.stringify({ companyId: c.company_id, action: "card-cron-one" }),
        }).catch(() => {}),
        fetch(selfUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": authHeader as string, "X-Cron-Secret": CRON_SECRET },
          body: JSON.stringify({ companyId: c.company_id, action: "card-approval-cron-one" }),
        }).catch(() => {}),
      ]);
      // @ts-expect-error EdgeRuntime
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
        // @ts-expect-error EdgeRuntime
        EdgeRuntime.waitUntil(Promise.all(triggers));
      } else {
        Promise.all(triggers).catch(() => {});
      }
      return new Response(JSON.stringify({ ok: true, triggered: companies?.length || 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!companyId) return new Response(JSON.stringify({ error: "companyId required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // 2026-07-06 보안감사 P1(IDOR): 일반 유저 호출은 body.companyId 가 그 유저 소속인지 검증.
    //   미검증 시 임의 companyId 로 타사 CODEF sync 강제 → 타사 과금(호출당 실비)+데이터 조작 가능했음.
    //   internal(cron/service_role) 호출은 이미 위에서 allowlist 로 제한되므로 제외.
    if (!isInternalAuth) {
      const { data: callerRow } = await supabase.from("users").select("company_id").eq("auth_id", user.id).maybeSingle();
      if (!callerRow || callerRow.company_id !== companyId) {
        return new Response(JSON.stringify({ error: "권한이 없습니다." }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // Get CODEF credentials from company settings
    const { data: settings } = await supabase.from("company_settings").select("codef_client_id, codef_client_secret, codef_connected_id").eq("company_id", companyId).maybeSingle();

    const clientId = settings?.codef_client_id || Deno.env.get("CODEF_CLIENT_ID");
    const clientSecret = settings?.codef_client_secret || Deno.env.get("CODEF_CLIENT_SECRET");
    const cid = connectedId || settings?.codef_connected_id;

    if (!clientId || !clientSecret) {
      return new Response(JSON.stringify({ error: "CODEF API 인증정보가 설정되지 않았습니다. 설정 > API 연동에서 설정해주세요." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const token = await getCodefToken(clientId, clientSecret);

    // --- Action: bank-cron-one (회사별 은행 자동 동기화 — bank-cron-tick 가 호출) ---
    //   은행 거래만 동기화(롤링 14일 윈도우 → dedup 으로 중복 안전) 후
    //   recompute_bank_balances RPC(e39b351 동일 산식)로 잔액 재계산.
    //   ⚠️ 은행 분기 전용. 홈택스/현금영수증/카드 미접촉.
    if (action === "bank-cron-one") {
      if (!cid) {
        return new Response(JSON.stringify({ ok: true, skipped: "no connectedId" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const endC = new Date().toISOString().split("T")[0].replace(/-/g, "");
      const startC = (() => { const d = new Date(); d.setDate(d.getDate() - 14); return d.toISOString().split("T")[0].replace(/-/g, ""); })();
      let bankRes: any = null;
      try {
        bankRes = await syncBankTransactions(supabase, token, companyId, cid, startC, endC);
      } catch (e: any) {
        return new Response(JSON.stringify({ ok: false, error: e?.message || String(e) }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      // e39b351 동일 산식 잔액 재계산 (서버측 RPC — 마이그레이션 미적용 시 graceful skip)
      try { await supabase.rpc("recompute_bank_balances", { p_company: companyId }); } catch { /* RPC 미배포 — 다음 syncBankBalances 가 보정 */ }
      try {
        await supabase.from("sync_logs").insert({
          company_id: companyId,
          sync_type: "codef_bank_cron",
          status: (bankRes?.errors?.length ?? 0) === 0 ? "success" : ((bankRes?.synced ?? 0) > 0 ? "partial" : "error"),
          details: { bank: bankRes, cron: true },
          synced_by: null,
        });
      } catch { /* sync_logs 실패는 동기화 자체를 막지 않음 */ }
      return new Response(JSON.stringify({ ok: true, synced: bankRes?.synced ?? 0, errors: bankRes?.errors ?? [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- Action: card-cron-one (회사별 카드 청구내역 자동 동기화 — card-cron-tick 가 호출) ---
    //   2026-06-10 추가. bank-cron-one 미러. 카드 청구내역만(승인내역 제외). ~35일 윈도우(월경계 커버),
    //   dedup(external_id)로 중복 안전. 잔액 재계산 불필요.
    if (action === "card-cron-one") {
      if (!cid) {
        return new Response(JSON.stringify({ ok: true, skipped: "no connectedId" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      //   기간 지정 재수집 (2026-08-14): 과거 어느 달이든 카드사 명세 기준으로 다시 채울 수 있게
      //   internal 호출에 한해 startDate/endDate(YYYYMMDD) 를 받는다. 미지정이면 기존 35일 윈도우.
      const ovrEnd = String(endDate || "").replace(/-/g, "");
      const ovrStart = String(startDate || "").replace(/-/g, "");
      const endC = ovrEnd.length === 8 ? ovrEnd : new Date().toISOString().split("T")[0].replace(/-/g, "");
      const startC = ovrStart.length === 8 ? ovrStart : (() => { const d = new Date(); d.setDate(d.getDate() - 35); return d.toISOString().split("T")[0].replace(/-/g, ""); })();
      let cardRes: any = null;
      try {
        cardRes = await syncCardBilling(supabase, token, companyId, cid, startC, endC);
        //   수집이 "성공"해도 카드사 자체가 목록에서 빠져 있으면 그 카드는 0건으로 조용히 새는
        //   상태다 — 최근까지 적재되던 카드사가 사라졌으면 오류로 격상 + 마스터에게 인앱 알림.
        const missingOrgs = await alertMissingCardOrgs(supabase, companyId, cardRes?.orgs || []);
        for (const org of missingOrgs) {
          cardRes.errors = cardRes.errors || [];
          cardRes.errors.push({
            accountNo: "", organization: org, code: "ORG_MISSING",
            message: `${CARD_CODES[org]} 계정이 CODEF 연결 목록에서 사라짐 — 수집 중단 상태`,
            hint: "설정 > API 연동에서 해당 카드사를 다시 등록하세요.",
          });
        }
      } catch (e: any) {
        return new Response(JSON.stringify({ ok: false, error: e?.message || String(e) }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      try {
        await supabase.from("sync_logs").insert({
          company_id: companyId,
          sync_type: "codef_card_cron",
          status: (cardRes?.errors?.length ?? 0) === 0 ? "success" : ((cardRes?.synced ?? 0) > 0 ? "partial" : "error"),
          details: { card: cardRes, cron: true },
          synced_by: null,
        });
      } catch { /* sync_logs 실패는 동기화 자체를 막지 않음 */ }
      return new Response(JSON.stringify({ ok: true, synced: cardRes?.synced ?? 0, errors: cardRes?.errors ?? [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- Action: card-bizno-backfill (과거 청구내역에서 가맹점 사업자번호만 채우기, 1회성) ---
    //   2026-08-12 사장님 승인. 그냥 재수집하면 upsert 가 mapping_status 를 unmapped 로 되돌려
    //   사람이 해 둔 분류가 날아간다. 그래서 biznoOnly — 행은 만들지도 고치지도 않고 번호만 얹는다.
    //   한 번에 **한 청구월**만 (호출자가 달을 돌린다) — 엣지 150초 안에 끝나게.
    if (action === "card-bizno-backfill") {
      const month = String(body.month || "").replace(/[^0-9]/g, "").slice(0, 6);
      if (!cid) return new Response(JSON.stringify({ ok: true, skipped: "no connectedId" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (month.length !== 6) return new Response(JSON.stringify({ ok: false, error: "month(YYYYMM) 가 필요합니다" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      let res: any = null;
      try {
        res = await syncCardBilling(supabase, token, companyId, cid, `${month}01`, `${month}28`, { biznoOnly: true });
      } catch (e: any) {
        return new Response(JSON.stringify({ ok: false, month, error: e?.message || String(e) }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ ok: true, month, biznoFilled: res?.biznoFilled ?? 0, errors: res?.errors ?? [], debug: res?.debug ?? [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- Action: card-approval-peek (읽기 전용 진단 — 기간 지정 승인내역 원본 조회, DB 기록 없음) ---
    //   2026-08-14: 중복 의심 결제를 승인시각까지 눈으로 대조하기 위한 운영 진단.
    //   cron 윈도우(14일) 밖 과거 날짜도 조회 가능. internal auth 전용. 적재·수정 없음.
    if (action === "card-approval-peek") {
      if (!cid) {
        return new Response(JSON.stringify({ ok: false, error: "no connectedId" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const peekStart = String(startDate || "").replace(/-/g, "");
      const peekEnd = String(endDate || "").replace(/-/g, "");
      if (peekStart.length !== 8 || peekEnd.length !== 8) {
        return new Response(JSON.stringify({ ok: false, error: "startDate/endDate (YYYYMMDD) 필수" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const orgFilter = String(body.organization || "").trim();
      const accounts = await getAccountList(token, cid, "card");
      const peekCards: Array<{ org: string; isPersonal: boolean }> = [];
      const peekSeen = new Set<string>();
      for (const acct of accounts) {
        const org = acct.organization;
        if (!org) continue;
        if (!(acct.businessType === "CD" || CARD_CODES[org])) continue;
        if (peekSeen.has(org)) continue;
        peekSeen.add(org);
        peekCards.push({ org, isPersonal: acct.clientType === "P" });
      }
      const peekChannel = String(body.channel || "approval").trim(); // approval | billing
      // 계정 목록 원본 요약 — 카드사가 목록에서 소리 없이 빠졌을 때(BC 2026-08-05) 원인 추적용.
      const accountsRaw = accounts.map((a: any) => ({
        organization: a.organization, businessType: a.businessType, clientType: a.clientType,
        loginType: a.loginType, accountName: a.accountName || "", lastStatus: a.lastResultCode || a.resultCode || "",
      }));
      const peek: any[] = [];
      for (const { org, isPersonal } of peekCards) {
        if (orgFilter && org !== orgFilter) continue;
        if (peekChannel === "billing") {
          // 청구내역(월 명세) — 승인내역 조회기간(CF-13001) 밖의 과거 결제 대조용. YYYYMM.
          const result = await codefRequest(token, "/v1/kr/card/b/account/billing-list", {
            connectedId: cid, organization: org,
            startDate: peekStart.slice(0, 6), endDate: peekEnd.slice(0, 6),
            orderBy: "0", inquiryType: "1", memberStoreInfoType: "1",
          });
          const rawBillings = result.data?.resBillingList ?? result.data;
          const billings = Array.isArray(rawBillings) ? rawBillings : rawBillings ? [rawBillings] : [];
          const entries: any[] = [];
          for (const bill of billings) {
            for (const c of (bill.resChargeHistoryList || [])) {
              entries.push({
                dueDate: bill.resPaymentDueDate || "", date: c.resUsedDate || c.resDate || "",
                time: c.resUsedTime || "",
                approvalNo: c.resCardApprovalNo || c.resApprovalNo || "",
                amount: c.resUsedAmount || c.resAmount || c.resMemberStoreAmt || 0,
                store: c.resStoreName || c.resMemberStoreName || c.resUsedStore || "",
                bizno: c.resMemberStoreCorpNo || "",
              });
            }
          }
          peek.push({ org, channel: "billing", code: result.result?.code, message: result.result?.message || "", entries });
          continue;
        }
        const path = isPersonal ? "/v1/kr/card/p/account/approval-list" : "/v1/kr/card/b/account/approval-list";
        const reqBody: Record<string, any> = {
          connectedId: cid, organization: org,
          startDate: peekStart, endDate: peekEnd,
          orderBy: "0", inquiryType: "1", memberStoreInfoType: "1",
        };
        if (!isPersonal) reqBody.applicationType = "0";
        const result = await codefRequest(token, path, reqBody);
        let raw: any = result.data;
        if (raw && !Array.isArray(raw) && typeof raw === "object") {
          for (const k of ["resApprovalList", "resCardApprovalList", "resList", "list"]) {
            if (Array.isArray(raw[k])) { raw = raw[k]; break; }
          }
        }
        const entries = (Array.isArray(raw) ? raw : (raw && raw.resApprovalNo) ? [raw] : []).map((a: any) => ({
          date: a.resUsedDate, time: a.resUsedTime,
          approvalNo: a.resCardApprovalNo || a.resApprovalNo || "",
          amount: a.resUsedAmount, cancelYN: a.resCancelYN,
          store: a.resMemberStoreName, bizno: a.resMemberStoreCorpNo || "",
        }));
        peek.push({ org, clientType: isPersonal ? "P" : "B", channel: "approval", code: result.result?.code, message: result.result?.message || "", entries });
      }
      return new Response(JSON.stringify({ ok: true, accounts: accountsRaw, peek }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // --- Action: card-approval-cron-one (회사별 카드 승인내역 자동 동기화 — card-cron-tick 가 호출) ---
    //   2026-06-29 추가. card-cron-one(청구내역) 미러. 실시간 승인내역만 — 결제 즉시 잡혀 "오늘까지" 반영.
    //   billing 과 별도 호출(150s 초과 회피). 14일 윈도우(하루 2회 cron 이라 충분 + 누락 catch-up).
    //   billing 과 동일 external_id 포맷이라 중복 없이 수렴.
    if (action === "card-approval-cron-one") {
      if (!cid) {
        return new Response(JSON.stringify({ ok: true, skipped: "no connectedId" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      //   기간 지정 재수집 — card-cron-one 과 동일 (카드사 승인내역 조회 허용 기간 안에서만 유효).
      const ovrEndA = String(endDate || "").replace(/-/g, "");
      const ovrStartA = String(startDate || "").replace(/-/g, "");
      const endC = ovrEndA.length === 8 ? ovrEndA : new Date().toISOString().split("T")[0].replace(/-/g, "");
      const startC = ovrStartA.length === 8 ? ovrStartA : (() => { const d = new Date(); d.setDate(d.getDate() - 14); return d.toISOString().split("T")[0].replace(/-/g, ""); })();
      let apprRes: any = null;
      try {
        apprRes = await syncCardApprovals(supabase, token, companyId, cid, startC, endC);
      } catch (e: any) {
        return new Response(JSON.stringify({ ok: false, error: e?.message || String(e) }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      try {
        await supabase.from("sync_logs").insert({
          company_id: companyId,
          sync_type: "codef_card_approval_cron",
          status: (apprRes?.errors?.length ?? 0) === 0 ? "success" : ((apprRes?.synced ?? 0) > 0 ? "partial" : "error"),
          details: { cardApproval: apprRes, cron: true },
          synced_by: null,
        });
      } catch { /* sync_logs 실패는 동기화 자체를 막지 않음 */ }
      return new Response(JSON.stringify({ ok: true, synced: apprRes?.synced ?? 0, errors: apprRes?.errors ?? [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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

        // ─── step = 월 × 방향 (2026-08-06) ───────────────────────────────────
        //   종전엔 한 step 에서 매출·매입을 연달아 불러 각 70초로 묶였고(합 140초, Edge 150초 한계),
        //   재시도 때는 이미 성공한 방향까지 다시 불러 시간·과금을 버렸다.
        //   방향을 나누면 ① 한 호출당 135초까지 기다릴 수 있어 CF-TIMEOUT 이 크게 줄고
        //   ② 실패한 방향만 재시도한다. (세금계산서만 해당 — 현금영수증은 방향 개념이 없다)
        const isInvoiceJob = job.job_type !== "cash_receipt";
        const DIRS: ("매출" | "매입")[] = ["매출", "매입"];
        const stepList: { month: string; direction: ("매출" | "매입") | null }[] = isInvoiceJob
          ? monthsList.flatMap((m) => DIRS.map((d) => ({ month: m, direction: d })))
          : monthsList.map((m) => ({ month: m, direction: null }));
        const keyOf = (e: { month: string; direction?: string | null }) =>
          `${e.month}|${e.direction ?? ""}`;
        const doneKeys = new Set(perMonth.map((m) => keyOf(m)));

        let targetMonth: string | null = null;
        let targetDirection: ("매출" | "매입") | null = null;
        let isRetry = false;
        let prevEntry: any = null;

        const nextNew = stepList.find((st) => !doneKeys.has(keyOf(st)));
        if (nextNew) {
          targetMonth = nextNew.month;
          targetDirection = nextNew.direction;
        } else {
          // 모든 step 처리됨 — error/partial 만 재시도(그 방향만)
          prevEntry = perMonth.find((m) =>
            (m.status === "error" || m.status === "partial") && (m.retryCount || 0) < MAX_RETRY,
          );
          if (prevEntry) {
            targetMonth = prevEntry.month;
            targetDirection = prevEntry.direction ?? null;
            isRetry = true;
          }
        }

        if (!targetMonth) {
          // 모두 처리됨 + retry 끝 → completed
          await unlock({
            status: "completed",
            completed_at: new Date().toISOString(),
            current_progress: { done: stepList.length, total: stepList.length, label: "완료" },
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
            : await syncHometaxInvoices(supabase, token, job.company_id, "", monthStart, monthEnd,
                targetDirection ? [targetDirection] : ["매출", "매입"],
                Number(prevEntry?.nextPage) > 1 ? Number(prevEntry.nextPage) : 1,
                job.job_type === "exempt_invoice" ? "exempt" : "tax");
          r = { synced: r0.synced || 0, responseCount: r0.responseCount || 0, errors: r0.errors || [],
                nextPage: (r0 as any).nextCursor?.page || null,
                // 전자계산서 진단(2026-08-11) — 응답 필드명·매핑 스킵 사유를 스텝 기록에 남긴다.
                //   console.log 는 MCP/외부에서 못 읽어 result_per_month(jsonb)로 보존. 파라미터
                //   확정 후에도 가볍고(8줄) 문제 재발 시 바로 원인을 보게 유지한다.
                debug: job.job_type === "exempt_invoice" ? ((r0 as any).debug || []).slice(0, 8) : undefined };
        } catch (err: any) {
          r = { synced: 0, responseCount: 0, errors: [{ code: "STEP_ERR", message: err.message || String(err) }], nextPage: null, debug: undefined };
        }

        // 남은 페이지가 있으면 아직 완료가 아니다 — partial 로 두어 다음 step 이 이어받게 한다.
        const hasMorePages = !!(r as any).nextPage;
        // ⚠️ 2026-08-11: 종전엔 responseCount > synced 도 partial 로 쳐서 재시도를 3회씩 돌렸다.
        //   하지만 그 차이는 손실이 아니라 정상 스킵이다 — 이미 저장된 건(중복), 작성일이 이
        //   chunk 기간 밖인 건(다른 chunk 담당). 저장 실패는 r.errors 로 이미 잡힌다.
        //   전자계산서 첫 동기화가 이 오판 때문에 스텝마다 재시도 루프를 돌아 20분+ 걸렸다.
        const monthStatus: "ok" | "partial" | "error" =
          r.errors.length && r.synced === 0 ? "error"
          : (r.errors.length || hasMorePages) ? "partial"
          : "ok";

        // ─── result_per_month 업데이트 ───
        let newPerMonth: any[];
        let totalSyncedDelta = 0;
        let totalResponseDelta = 0;
        //   페이지 이어받기(nextPage)는 재시도가 아니라 '계속'이라 retry 를 늘리지 않는다.
        //   단 **진전이 있을 때만** — 같은 페이지에서 계속 실패하는데도 계속으로 치면 무한히 돈다.
        //   진전 = 이번에 뭔가 받았거나(synced>0) 커서가 앞으로 갔을 때.
        const prevPage = Number(prevEntry?.nextPage) || 0;
        const newPage = Number((r as any).nextPage) || 0;
        const madeProgress = (r.synced || 0) > 0 || (newPage > prevPage);
        const isPageContinuation = isRetry && prevPage > 1 && madeProgress;
        const newRetryCount = isRetry && !isPageContinuation ? ((prevEntry?.retryCount || 0) + 1) : (prevEntry?.retryCount || 0);

        if (isRetry) {
          // 기존 record 갱신 (delta 계산)
          const oldSynced = prevEntry?.synced || 0;
          const oldResp = prevEntry?.responseCount || 0;
          totalSyncedDelta = r.synced - oldSynced;
          totalResponseDelta = r.responseCount - oldResp;
          newPerMonth = perMonth.map((m: any) =>
            (m.month === targetMonth && (m.direction ?? null) === targetDirection) ? {
              month: targetMonth, direction: targetDirection, synced: r.synced, responseCount: r.responseCount,
              status: monthStatus, errorMsg: r.errors[0]?.message, retryCount: newRetryCount,
              nextPage: (r as any).nextPage || null, debug: (r as any).debug,
            } : m,
          );
        } else {
          totalSyncedDelta = r.synced;
          totalResponseDelta = r.responseCount;
          newPerMonth = [...perMonth, {
            month: targetMonth, direction: targetDirection, synced: r.synced, responseCount: r.responseCount,
            status: monthStatus, errorMsg: r.errors[0]?.message, retryCount: 0,
            nextPage: (r as any).nextPage || null, debug: (r as any).debug,
          }];
        }

        const stillPending = newPerMonth.length < stepList.length;
        const stillRetry = newPerMonth.some((m: any) =>
          (m.status === "error" || m.status === "partial") && (m.retryCount || 0) < MAX_RETRY,
        );

        const stepLabel = targetDirection ? `${targetMonth} ${targetDirection}` : targetMonth;
        const progressLabel = isRetry
          ? `${stepLabel} (재시도 ${newRetryCount}/${MAX_RETRY})`
          : stepLabel;

        await unlock({
          current_progress: {
            done: newPerMonth.filter((m: any) => m.status === "ok").length,
            total: stepList.length,
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
            current_progress: { done: stepList.length, total: stepList.length, label: "완료" },
          }).eq("id", jobId);
          const syncTsCol = job.job_type === "cash_receipt" ? "last_cashreceipt_sync_at" : "last_hometax_sync_at";
          await supabase.from("company_settings").upsert({
            company_id: job.company_id,
            [syncTsCol]: new Date().toISOString(),
          }, { onConflict: "company_id" });
        }

        return new Response(JSON.stringify({
          ok: true, monthDone: targetMonth, isRetry, retryCount: newRetryCount,
          totalDone: newPerMonth.length, totalCount: stepList.length,
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


    // --- Action: hometax-invoice-detail (상세 화면에서 그 건만 보강 — 2026-08-05 사장님 지시 1번) ---
    //   통합 목록에 없는 사업장 주소·이메일·대표자명을 CODEF 상세 API 로 1건만 조회해 채운다.
    //   건당 과금 + 기관 IP 차단 경고가 있어 **이미 보강된 건(detail_fetched_at)은 다시 부르지 않는다**.
    if (action === "hometax-invoice-detail") {
      const { invoiceId, force } = body;
      if (!invoiceId) {
        return new Response(JSON.stringify({ error: "invoiceId required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const { data: inv } = await supabase.from("tax_invoices")
        .select("id, company_id, type, nts_confirm_no, detail_fetched_at").eq("id", invoiceId).maybeSingle();
      if (!inv || inv.company_id !== companyId) {
        return new Response(JSON.stringify({ error: "세금계산서를 찾을 수 없습니다." }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (!inv.nts_confirm_no) {
        return new Response(JSON.stringify({ ok: true, skipped: "no_approval_no", message: "국세청 승인번호가 없어 상세 조회 대상이 아닙니다." }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (inv.detail_fetched_at && !force) {
        return new Response(JSON.stringify({ ok: true, skipped: "already", message: "이미 보강된 건입니다." }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const { cert, error: certErr } = await loadHometaxCert(supabase, companyId);
      if (!cert) {
        return new Response(JSON.stringify({ error: certErr?.message, hint: certErr?.hint, code: certErr?.code }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const r = await fetchHometaxInvoiceDetail(supabase, token, inv, cert);
      if (!r.ok) {
        // CF-00401/CF-00003 은 "상세" 상품 자체가 CODEF 에서 승인되지 않은 상태 — 코드가 아니라 상품 신청 문제.
        //   일반 권한 안내(은행 상품 문구)로는 원인을 못 찾아 전용 문구를 준다(2026-08-05 실측).
        const productIssue = r.code === "CF-00401" || r.code === "CF-00003";
        return new Response(JSON.stringify({
          error: productIssue
            ? "CODEF 에서 '전자세금계산서 상세' 상품이 승인되지 않았습니다."
            : `상세 조회 실패: ${r.message || r.code}`,
          code: r.code,
          hint: productIssue
            ? "CODEF 관리자 페이지 → 상품 관리 → 사용 API 변경 신청에서 '전자세금계산서 상세'(/v1/kr/public/nt/tax-invoice/info-detail) 를 추가하세요. 승인되면 상세를 다시 열기만 하면 채워집니다."
            : codefErrorHint(r.code),
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const { data: updated } = await supabase.from("tax_invoices").select("*").eq("id", invoiceId).maybeSingle();
      return new Response(JSON.stringify({ ok: true, invoice: updated }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // --- Action: hometax-sync-async (Background sync — job 만들고 즉시 응답 + 백그라운드 처리) ---
    if (action === "hometax-sync-async") {
      const { startDate: aStart, endDate: aEnd, jobType: rawJobType } = body;
      const jobType = rawJobType === "cash_receipt" ? "cash_receipt"
        : rawJobType === "exempt_invoice" ? "exempt_invoice"   // 전자계산서(면세) — 2026-08-10
        : "tax_invoice";
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
      // 단 세금계산서·전자계산서는 **같은 통합 API·같은 인증서**라 서로도 차단 (CF-00016 방지).
      const conflictTypes = jobType === "cash_receipt" ? ["cash_receipt"] : ["tax_invoice", "exempt_invoice"];
      const { data: activeJobs } = await supabase
        .from("hometax_sync_jobs")
        .select("id, status, current_progress, created_at, job_type")
        .eq("company_id", companyId)
        .in("job_type", conflictTypes)
        .in("status", ["pending", "running"])
        .gt("updated_at", new Date(Date.now() - 30 * 60 * 1000).toISOString())
        .limit(1);
      if (activeJobs && activeJobs.length > 0) {
        return new Response(JSON.stringify({
          error: activeJobs[0].job_type !== jobType
            ? "세금계산서·전자계산서는 같은 인증서를 써서 동시에 못 돌립니다. 진행 중인 동기화가 끝난 뒤 다시 시도하세요."
            : "이미 진행 중인 백그라운드 동기화가 있습니다. 완료 후 다시 시도하세요.",
          activeJobId: activeJobs[0].id,
          activeJobType: activeJobs[0].job_type,   // FE: 다른 종류 잡이면 진행표시를 넘겨받지 않게 (2026-08-11)
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
    let start = startDate || (() => { const d = new Date(); d.setMonth(d.getMonth() - 3); return d.toISOString().split("T")[0].replace(/-/g, ""); })();

    // 회계마감 컷오프: 마감일 이전(또는 2년 초과) 자료는 수집하지 않도록 시작일을 하한으로 clamp.
    //   data_sync_floor() = max(마감일+1, today-2년). 미설정이어도 2년 상한 적용.
    try {
      const { data: floorRow } = await supabase.rpc("data_sync_floor", { p_company: companyId });
      if (floorRow) {
        const floorYmd = String(floorRow).replace(/-/g, ""); // 'YYYY-MM-DD' → 'YYYYMMDD'
        if (floorYmd > start) start = floorYmd;
      }
    } catch (_e) { /* floor 조회 실패 시 기존 동작 유지 */ }
    // 마감일이 오늘 이후로 잘못 설정되면 start > end 가 되어 CODEF 조회가 통째로 빈다(잔액만 갱신·거래 0건) — end 로 clamp.
    if (start > end) start = end;

    const results: Record<string, any> = {};

    // 무료 플랜은 수동 동기화도 차단 (2026-08-06) — 홈택스만 쓰는 요청은 통과시킨다.
    if (syncType !== "hometax") {
      const denied = await assertBankSyncAllowed(supabase, companyId);
      if (denied) {
        return new Response(JSON.stringify({ error: denied, code: "PLAN_BANK_SYNC_DISABLED" }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

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

    // 승인내역(실시간) — 반드시 "별도 invocation" 으로만 실행 (billing 과 묶으면 카드 호출이 2배 →
    //   은행+카드청구+카드승인 순차로 Edge 150s 초과 HTTP 546). billing 과 동일 external_id 로 dedup.
    if (syncType === "card_approval") {
      results.cardApproval = await syncCardApprovals(supabase, token, companyId, cid, start, end);
    }

    if (syncType === "hometax" || syncType === "all") {
      results.hometax = await syncHometaxInvoices(supabase, token, companyId, cid, start, end);
    }

    const allEntries: SyncError[] = [
      ...(results.bank?.errors ?? []),
      ...(results.card?.errors ?? []),
      ...(results.cardApproval?.errors ?? []),
      ...(results.hometax?.errors ?? []),
    ];
    // 환경/설정성 안내(외부 액션 필요, 코드로 못 고침)는 errors가 아닌 notes로 분리 — 사용자 빨간 알림 안 뜨게
    // CF-00003: 상품 미활성화 / CF-00401: 권한 없음 / CF-13021: 계좌 형식 불일치 / NO_DEMAND_DEPOSIT: 입출금 계좌 미등록
    const noteCodes = new Set(["CF-00003", "CF-00401", "CF-13021", "NO_DEMAND_DEPOSIT", "CF-TIMEOUT", "CF-12200"]);
    const errors = allEntries.filter(e => !noteCodes.has(e.code));
    const notes = allEntries.filter(e => noteCodes.has(e.code));
    const totalSynced =
      (results.bank?.synced ?? 0) + (results.card?.synced ?? 0) + (results.cardApproval?.synced ?? 0) + (results.hometax?.synced ?? 0);
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
  } finally {
    // 사용량 원장 적재 — 실패해도 응답에 영향 없음 (내부 try/catch)
    await flushCodefUsage(meterStore);
  }
  });
}));
