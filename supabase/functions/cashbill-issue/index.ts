import { tfetch } from "../_shared/http.ts";
import { withSentry } from "../_shared/sentry.ts";
import { createMeterStore, runWithMeter, meterPush, flushCodefUsage } from "../_shared/codef-meter.ts";
// cashbill-issue: 현금영수증 국세청 실발행 (CODEF ↔ 팝빌 제휴)
//
// 액션 3종 — 공식 가이드(developer.codef.io 현금영수증 발행 API, 2026-02-02) 기준:
//   issue   — /v1/kr/public/a/cash-bill/regist-issue (tradeType "승인거래") → documentKey 수신 → cash_receipts insert
//   refresh — /v1/kr/public/a/cash-bill/regist-issue-info → ntsconfirmNum(국세청 승인번호)·상태코드 갱신
//             (승인번호는 발행 당일 밤 24시 국세청 일괄 전송 시점에 부여 — 발행 직후엔 비어있는 게 정상)
//   cancel  — /v1/kr/public/a/cash-bill/regist-cancel-issue (전용 엔드포인트, 공식 가이드 2026-02-02.
//             2026-08-03 사장님 제공 가이드로 재교정 — 입력은 corpNum·orgConfirmNum·orgTradeDate·memo 4개뿐).
//             국세청 전송 이전 "발행완료" 상태만 취소 가능 — 발행분은 당일 밤 24시에 국세청 일괄 전송되므로
//             사실상 발행 당일에만 취소된다. 전송 후에는 이 API 로 취소 불가.
//
// 전제: CODEF "현금영수증 발행" 상품 승인 + 팝빌 제휴사 회원가입(발행 전 join-member 자동 시도, 멱등).
//       공동인증서는 불필요. 정식버전은 api.codef.io (CODEF_ENV=production), 가이드 Timeout 200초.
//
// 2026-07-21: 사장님 결정으로 CODEF 단독 경로 유지 (팝빌 직접 연동 v7은 롤백).
//   CF-05001 인시던트(오류 응답인데 실발행) 재발 방지용 재시도 차단 가드 포함 (v8→v9).

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CODEF_ENV = Deno.env.get("CODEF_ENV") || "sandbox";
const CODEF_BASE = CODEF_ENV === "production"
  ? "https://api.codef.io"
  : CODEF_ENV === "development"
    ? "https://development.codef.io"
    : "https://sandbox.codef.io";
const CODEF_TOKEN_URL = "https://oauth.codef.io/oauth/token";

const ISSUE_PATH = "/v1/kr/public/a/cash-bill/regist-issue";
const CANCEL_PATH = "/v1/kr/public/a/cash-bill/regist-cancel-issue";
const INFO_PATH = "/v1/kr/public/a/cash-bill/regist-issue-info";
const JOIN_PATH = "/v1/kr/public/a/pop-bill/join-member";

// 공식 가이드 Timeout 200초 — 발행/취소 호출에 적용 (tfetch 기본 SLOW 180초보다 길다)
const GUIDE_TIMEOUT_MS = 200_000;

let tokenCache: { token: string; expiresAt: number } | null = null;

async function getCodefToken(clientId: string, clientSecret: string): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.token;
  const basicAuth = btoa(`${clientId}:${clientSecret}`);
  const res = await tfetch(CODEF_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${basicAuth}` },
    body: "grant_type=client_credentials&scope=read",
  });
  if (!res.ok) throw new Error(`CODEF token error: ${res.status}`);
  const data = await res.json();
  tokenCache = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return data.access_token;
}

async function codefRequest(token: string, path: string, body: Record<string, unknown>, timeoutMs?: number): Promise<any> {
  let res: Response;
  try {
    res = await tfetch(`${CODEF_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Bearer ${token}` },
      body: encodeURIComponent(JSON.stringify(body)),
    }, timeoutMs);
  } catch (e) {
    meterPush(path, "FETCH_ERROR");
    throw e;
  }
  if (!res.ok) {
    meterPush(path, `HTTP_${res.status}`);
    throw new Error(`CODEF API error: ${res.status}`);
  }
  const text = await res.text();
  let parsed: any;
  try { parsed = JSON.parse(decodeURIComponent(text)); }
  catch { parsed = JSON.parse(text); }
  meterPush(path, parsed?.result?.code || "UNKNOWN");
  return parsed;
}

function codefErrorHint(code?: string, message?: string): string {
  if (!code) return "응답이 없습니다. CODEF 연동 상태를 확인하세요.";
  if (code === "CF-00003") return "CODEF 대시보드에서 '현금영수증 발행' 상품이 승인되지 않았습니다. 상품 관리에서 확인하세요.";
  if (code === "CF-00401") return "발행 API 권한이 없습니다. CODEF 대시보드에서 현금영수증 발행 상품 승인 상태를 확인하세요.";
  if (code === "CF-05001") return "CODEF 중개(팝빌 연동) 처리 오류 — CODEF 서버측 원인으로, CODEF 운영팀이 수정해야 해결됩니다. 오류 응답에도 실제 발행됐을 수 있어 같은 건 재시도는 3일간 차단됩니다. 실제 발행 여부는 홈택스에서 확인하세요.";
  if (code.startsWith("CF-12")) return "기관(팝빌/국세청) 응답 지연·오류. 잠시 후 재시도하세요.";
  return `CODEF 오류 (${code}${message ? `: ${message}` : ""})`;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// KST 오늘 (즉시발행이라 거래일 = 오늘)
const todayKst = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

serve(withSentry("cashbill-issue", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // CODEF 사용량 계측 — codefRequest 호출을 수집해 finally 에서 원장 적재 (fail-open)
  const meterStore = createMeterStore("cashbill");
  return await runWithMeter(meterStore, async () => {
  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: { user } } = await createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    }).auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const { data: userRow } = await admin.from("users").select("company_id, email").eq("auth_id", user.id).maybeSingle();
    if (!userRow?.company_id) return json({ error: "회사 정보를 찾을 수 없습니다." }, 403);
    const companyId = userRow.company_id;

    const body = await req.json();
    const action = body.action || "issue";
    meterStore.companyId = companyId;
    meterStore.action = `cashbill-${action}`;

    const clientId = Deno.env.get("CODEF_CLIENT_ID");
    const clientSecret = Deno.env.get("CODEF_CLIENT_SECRET");
    if (!clientId || !clientSecret) return json({ error: "CODEF API 인증정보가 없습니다." }, 500);

    const { data: company } = await admin.from("companies").select("*").eq("id", companyId).maybeSingle();
    if (!company) return json({ error: "회사 정보를 찾을 수 없습니다." }, 404);
    const corpNum = String(company.business_number || "").replace(/\D/g, "");
    if (corpNum.length !== 10) return json({ error: "회사 사업자등록번호(10자리)가 없습니다. 설정 → 회사 정보에서 입력하세요." }, 400);

    const token = await getCodefToken(clientId, clientSecret);

    // ── 발행정보 조회 공통: documentKey → 상태·국세청 승인번호·거래일자 반영 ──
    async function refreshReceipt(receipt: any): Promise<any> {
      if (!receipt.document_key) return receipt;
      const info = await codefRequest(token, INFO_PATH, { documentKeyList: [receipt.document_key] });
      if (info?.result?.code !== "CF-00000") {
        throw Object.assign(new Error(codefErrorHint(info?.result?.code, info?.result?.message)), { codef: info?.result });
      }
      const d = Array.isArray(info.data) ? info.data[0] : info.data;
      if (!d) return receipt;
      const patch: Record<string, unknown> = {
        nts_state_code: String(d.stateCode || ""),
        issue_response: d,
      };
      if (d.ntsconfirmNum) patch.approval_number = d.ntsconfirmNum;
      if (String(d.stateCode) === "400") patch.status = "cancelled";
      const { data: updated } = await admin.from("cash_receipts").update(patch).eq("id", receipt.id).select().maybeSingle();
      return updated || receipt;
    }

    // ══ issue: 승인거래 즉시발행 ══
    if (action === "issue") {
      const amount = Math.round(Number(body.amount || 0));
      if (!amount || amount <= 0) return json({ error: "금액을 입력하세요." }, 400);
      const identityRaw = String(body.identityNum || "").replace(/[^0-9]/g, "");
      if (identityRaw.length < 10) return json({ error: "식별번호(휴대폰/사업자/카드번호)를 확인하세요." }, 400);
      const purpose = body.purpose === "income_deduction" ? "income_deduction" : "expenditure_proof";
      const taxationType = body.taxationType === "비과세" ? "비과세" : "과세";
      const supplyCost = taxationType === "과세" ? Math.round(amount / 1.1) : amount;
      const tax = amount - (taxationType === "과세" ? supplyCost : amount);

      // 가맹점(회사) 정보 — CODEF 필수값 검증 (corpName/corpCEOName/corpAddress/corpTEL 모두 Required O)
      const corpName = company.name || "";
      const corpCEOName = company.representative || "";
      const corpAddress = company.address || "";
      const corpTEL = String(company.phone || "").replace(/\D/g, "");
      const missing = [
        !corpName && "상호", !corpCEOName && "대표자", !corpAddress && "주소", !corpTEL && "전화번호",
      ].filter(Boolean);
      if (missing.length) {
        return json({ error: `회사 정보가 비어 있습니다: ${missing.join(", ")} — 설정 → 회사 정보에서 입력하세요.` }, 400);
      }

      // 요금제 발행 한도 확인 (monthly_cashbill_limit NULL=무제한)
      const { data: subRow } = await admin
        .from("subscriptions")
        .select("status, trial_ends_at, subscription_plans(name, monthly_cashbill_limit)")
        .eq("company_id", companyId)
        .in("status", ["active", "trialing", "paused", "past_due"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      // 체험 만료 서버 차단 — trialing 인데 trial_ends_at 지났으면 발행 불가(엣지 직접호출 우회 방지)
      if (subRow?.status === "trialing" && subRow.trial_ends_at && new Date(subRow.trial_ends_at) < new Date()) {
        return json({
          error: "무료 체험이 종료되었습니다. 요금제를 구독하면 계속 발행할 수 있습니다.",
          code: "TRIAL_EXPIRED",
        }, 402);
      }
      const planLimit = subRow?.subscription_plans?.monthly_cashbill_limit;
      if (typeof planLimit === "number") {
        const monthStart = todayKst().slice(0, 7) + "-01";
        const { count } = await admin
          .from("cash_receipts")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId)
          .eq("source", "codef")
          .neq("status", "cancelled")
          .gte("issue_date", monthStart);
        if ((count || 0) >= planLimit) {
          return json({
            error: `이번 달 현금영수증 발행 한도(${planLimit}건)를 모두 사용했습니다.`,
            hint: `${subRow?.subscription_plans?.name || "현재 요금제"}는 월 ${planLimit}건까지 발행 가능합니다. 울트라로 업그레이드하면 무제한 발행할 수 있습니다.`,
            code: "PLAN_LIMIT_EXCEEDED",
          }, 429);
        }
      }

      // 🚨 2026-07-21 이중발행 가드 — 세금계산서 CF-05001 인시던트(CODEF는 오류 응답, 팝빌은
      //   실발행돼 5건 중복)와 같은 사고 방지: CF-05001로 실패했던 것과 같은 식별번호·금액의
      //   재시도를 3일간 차단. CODEF 발행 API는 실패 시 documentKey 를 주지 않아 실제 발행
      //   여부를 조회로 확인할 방법이 없다 — 홈택스에서 직접 확인하도록 안내.
      const failedAttempts: { identity: string; amount: number; code: string; at: string }[] =
        Array.isArray(company.automation_settings?.cashbill_failed_attempts)
          ? company.automation_settings.cashbill_failed_attempts : [];
      const retryCutoff = Date.now() - 3 * 86400 * 1000;
      const blocked = failedAttempts.find((a) =>
        a.code === "CF-05001" && a.identity === identityRaw && Number(a.amount) === amount &&
        new Date(a.at).getTime() > retryCutoff);
      if (blocked) {
        return json({
          error: `재시도 차단: 이 식별번호·금액(₩${amount.toLocaleString("ko-KR")})은 ${blocked.at.slice(0, 10)}에 CF-05001로 실패했던 건입니다. CODEF가 오류를 응답해도 실제로는 발행됐을 수 있어(2026-07-20 세금계산서 5건 중복 인시던트) 재시도하면 이중발행 위험이 있습니다.`,
          hint: "실제 발행 여부를 홈택스(현금영수증 매출내역)에서 먼저 확인하세요. 미발행이 확인됐고 꼭 다시 발행해야 하면 3일 후 재시도하거나 CODEF 원인 수정 후 진행하세요.",
          code: "CF05001_RETRY_BLOCKED",
        }, 409);
      }

      // 발급사업자(제휴사) 회원가입 — 최초 1회 필요, 멱등(기가입이면 그대로 진행).
      //   2026-07-30 사장님: 자동 가입 실패가 조용히 삼켜져 발행 실패의 원인을 알 수 없었고
      //   수동 등록으로 우회해야 했다 → 실패 사유를 기억해 발행 실패 시 안내에 병기한다.
      let joinFailMsg = "";
      try {
        const joinRes = await codefRequest(token, JOIN_PATH, {
          corpNum, CEOName: corpCEOName, corpName, corpAddress,
          bizType: company.business_type || "", bizClass: company.business_category || "",
          contactName: corpCEOName || "담당자", contactTEL: company.phone || "",
          contactEmail: company.automation_settings?.invoicer_email || userRow.email || "", contactFAX: "",
        });
        const jc = joinRes?.result?.code;
        const jMsg = String(joinRes?.data?.message || joinRes?.result?.message || "");
        // 성공 또는 "이미 가입" 계열 응답은 정상 취급
        if (jc !== "CF-00000" && !/이미|기가입|가입된|already/i.test(jMsg)) {
          joinFailMsg = `${jc || ""} ${jMsg}`.trim() || "알 수 없는 오류";
        }
      } catch (e) {
        joinFailMsg = (e as Error)?.message || "네트워크 오류";
      }

      // 공식 가이드 입력부 그대로 — 명시된 키 외에는 아무것도 보내지 않는다 (여분 필드가 CF-05001 유발한 전례 있음)
      const payload: Record<string, unknown> = {
        corpNum, corpName, corpCEOName, corpAddress, corpTEL,
        tradeType: "승인거래",
        tradeUsage: purpose === "income_deduction" ? "소득공제용" : "지출증빙용",
        tradeOpt: "일반",
        taxationType,
        totalAmount: String(amount),
        supplyCost: String(supplyCost),
        tax: String(tax),
        serviceFee: "0",
        identityNum: identityRaw,
        customerName: body.customerName || body.counterpartyName || "",
        itemName: body.itemName || "",
        orderNumber: "",
        email: body.email || "",
        phoneNo: "",
        memo: body.memo || "",
        emailSubject: "",
      };

      const resp = await codefRequest(token, ISSUE_PATH, payload, GUIDE_TIMEOUT_MS);
      const rc = resp?.result?.code;
      const documentKey = resp?.data?.documentKey || "";
      const dataCode = String(resp?.data?.code ?? "");
      if (rc !== "CF-00000" || !documentKey) {
        const msg = resp?.data?.message || resp?.result?.message || "발행 실패";
        if (rc === "CF-05001") {
          // 재시도 차단 가드용 실패 기록 (최근 20건만 유지 — best-effort, 실패해도 응답은 그대로)
          const next = [...failedAttempts, { identity: identityRaw, amount, code: rc, at: new Date().toISOString() }].slice(-20);
          await admin.from("companies").update({
            automation_settings: { ...(company.automation_settings || {}), cashbill_failed_attempts: next },
          }).eq("id", companyId);
        }
        // 자동 가입이 실패한 상태의 발행 실패 = 등록 문제일 가능성이 높다 — 사유를 함께 안내
        const joinHint = joinFailMsg
          ? `발급사업자 등록(최초 1회 자동 진행)이 완료되지 않았을 수 있습니다 — 등록 응답: ${joinFailMsg}. 설정 → 회사 정보의 상호·대표자·주소·전화·업태·종목을 채운 뒤 다시 발행해 주세요. 계속 실패하면 고객센터로 문의해 주세요.`
          : codefErrorHint(rc, msg);
        return json({ error: `현금영수증 발행 실패: ${msg}`, code: rc, hint: joinHint, raw: resp?.data ?? resp?.result }, 400);
      }
      if (dataCode && dataCode !== "1") {
        return json({ error: `현금영수증 발행 실패: ${resp?.data?.message || "팝빌 오류"} (code ${dataCode})`, raw: resp?.data }, 400);
      }

      const { data: inserted, error: insErr } = await admin.from("cash_receipts").insert({
        company_id: companyId,
        type: "income",
        amount,
        supply_amount: supplyCost,
        tax_amount: tax,
        counterparty_name: body.counterpartyName || body.customerName || null,
        counterparty_bizno: purpose === "expenditure_proof" ? (body.identityNum || null) : null,
        issue_date: todayKst(),
        approval_number: null, // 국세청 승인번호는 전송(당일 24시) 후 refresh 로 수신
        identity_number: body.identityNum || identityRaw,
        identity_type: body.identityType || (purpose === "income_deduction" ? "phone" : "bizno"),
        purpose,
        status: "issued",
        source: "codef",
        memo: body.memo || null,
        document_key: documentKey,
        nts_state_code: "300",
        issue_response: resp.data,
      }).select().single();
      if (insErr) {
        // 발행은 이미 성공 — DB 실패 시 documentKey(가이드: 필수 관리 대상)를 반드시 사용자에게 남긴다
        return json({ error: `발행은 완료됐지만 저장 실패: ${insErr.message} — 발행문서번호 ${documentKey} 를 보관하세요.` }, 500);
      }

      // 즉시 발행정보 1회 조회 (승인번호는 보통 아직 없음 — 상태코드·거래일자만 갱신)
      let receipt = inserted;
      try { receipt = await refreshReceipt(inserted); } catch { /* 발행 자체는 성공 — 조회 실패 무시 */ }

      return json({ success: true, receipt, documentKey, message: "현금영수증 발행 완료 — 국세청 승인번호는 다음날 '승인번호 조회'로 확인됩니다." });
    }

    // ── receipt 로드 + 회사 검증 (refresh/cancel 공통) ──
    const receiptId = body.receipt_id;
    if (!receiptId) return json({ error: "receipt_id required" }, 400);
    const { data: receipt } = await admin.from("cash_receipts").select("*").eq("id", receiptId).maybeSingle();
    if (!receipt || receipt.company_id !== companyId) return json({ error: "현금영수증을 찾을 수 없습니다." }, 404);
    if (receipt.source !== "codef" || !receipt.document_key) {
      return json({ error: "CODEF 로 발행된 현금영수증이 아닙니다." }, 400);
    }

    // ══ refresh: 국세청 승인번호·상태 조회 ══
    if (action === "refresh") {
      const updated = await refreshReceipt(receipt);
      const state = String(updated.nts_state_code || "");
      const stateMsg =
        state === "304" ? "국세청 전송 완료" :
        state === "305" ? "국세청 전송 실패" :
        state === "400" ? "발행 취소됨" :
        updated.approval_number ? "승인번호 수신" : "국세청 전송 대기 중 (발행 당일 밤 24시 일괄 전송)";
      return json({ success: true, receipt: updated, message: stateMsg });
    }

    // ══ cancel: 발행취소 — 전용 엔드포인트 regist-cancel-issue (공식 가이드 2026-02-02).
    //   입력은 corpNum·orgConfirmNum(원본 승인번호)·orgTradeDate(원본 거래일자 yyyyMMdd)·memo 4개.
    //   국세청 전송 이전 "발행완료" 상태만 취소 가능(전송은 발행 당일 밤 24시 일괄). ══
    if (action === "cancel") {
      // 국세청 전송이 이미 끝난 건(304)은 이 API 로 취소 불가 — 호출 전에 명확히 안내
      if (String(receipt.nts_state_code || "") === "304") {
        return json({
          error: "이미 국세청 전송이 완료된 현금영수증입니다.",
          hint: "발행취소 API 는 국세청 전송 이전(발행 당일 밤 24시 전)의 발행완료 건만 취소할 수 있습니다. 전송 완료 건은 홈택스에서 취소거래를 진행하세요.",
        }, 400);
      }
      // 원본 승인번호 — 발행 응답의 confirmNum 우선, 없으면 저장된 승인번호, 그래도 없으면 발행정보 재조회
      let target = receipt;
      let orgConfirmNum = String((target.issue_response as any)?.confirmNum || target.approval_number || "");
      if (!orgConfirmNum) {
        try {
          target = await refreshReceipt(receipt);
          orgConfirmNum = String((target.issue_response as any)?.confirmNum || target.approval_number || "");
        } catch { /* 아래 안내로 */ }
      }
      if (!orgConfirmNum) {
        return json({
          error: "원본 승인번호를 확인할 수 없어 취소할 수 없습니다.",
          hint: "'승인번호 조회'를 먼저 실행한 뒤 다시 시도하세요. 그래도 없으면 발행 직후 일시적 지연일 수 있습니다.",
        }, 400);
      }
      // 원본 거래일자 — 발행정보 응답부 tradeDate 우선, 없으면 발행일(issue_date)을 yyyyMMdd 로
      const orgTradeDate = String((target.issue_response as any)?.tradeDate || String(target.issue_date || "").replaceAll("-", "")).replace(/\D/g, "").slice(0, 8);
      if (orgTradeDate.length !== 8) {
        return json({ error: "원본 거래일자를 확인할 수 없습니다. '승인번호 조회' 후 다시 시도하세요." }, 400);
      }
      // 공식 가이드 입력부 그대로 — 명시된 4개 키 외에는 아무것도 보내지 않는다
      const payload: Record<string, unknown> = {
        corpNum,
        orgConfirmNum,
        orgTradeDate,
        memo: String(body.memo || "발행취소").slice(0, 200),
      };
      const resp = await codefRequest(token, CANCEL_PATH, payload, GUIDE_TIMEOUT_MS);
      const rc = resp?.result?.code;
      const d = Array.isArray(resp?.data) ? resp.data[0] : resp?.data;
      const dataCode = String(d?.code ?? "");
      if (rc !== "CF-00000" || (dataCode && dataCode !== "1")) {
        const msg = d?.message || resp?.result?.message || "취소 실패";
        const hint = rc === "CF-00003" || rc === "CF-00401"
          ? "CODEF 대시보드에서 '현금영수증 발행취소' 상품이 승인됐는지 확인하세요. 미신청이면 상품 신청 후 다시 시도하세요."
          : codefErrorHint(rc, msg);
        return json({ error: `발행취소 실패: ${msg}`, code: rc, hint, raw: d ?? resp?.result }, 400);
      }
      const { data: updated } = await admin.from("cash_receipts").update({
        status: "cancelled",
        nts_state_code: "400",
        issue_response: d,
      }).eq("id", receiptId).select().maybeSingle();
      return json({
        success: true,
        receipt: updated,
        message: `현금영수증 발행취소 완료${d?.confirmNum ? ` (승인번호 ${d.confirmNum})` : ""} — 국세청 전송 대상에서 제외됩니다.`,
      });
    }

    return json({ error: `unknown action: ${action}` }, 400);
  } catch (err: any) {
    return json({ error: err.message || "Internal error" }, 500);
  } finally {
    // 사용량 원장 적재 — 실패해도 응답에 영향 없음 (내부 try/catch)
    await flushCodefUsage(meterStore);
  }
  });
}));
