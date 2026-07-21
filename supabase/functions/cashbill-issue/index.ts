import { withSentry } from "../_shared/sentry.ts";
// cashbill-issue: 현금영수증 국세청 실발행 — 팝빌(POPBiLL) SDK 직접 연동 (v7, 2026-07-21)
//
// 2026-07-21 CODEF 중개(cash-bill regist-issue) → 팝빌 직접 연동 전환.
//   사유: CODEF 중개 경로가 CF-05001(API 처리 오류)로 전면 실패 — 세금계산서와 동일 인시던트.
//   CODEF는 오류를 응답해도 팝빌에선 실발행될 수 있어(2026-07-20 세금계산서 5건 중복 확인)
//   발행 전 최근 3일 동일 식별번호·금액 대조 가드를 둔다. popbill-issue(세금계산서)와 동일하게
//   LinkID 제휴 + 회원사 UserID 후보 순회. 현금영수증은 공동인증서 불필요.
//
// 액션 (요청/응답 계약은 CODEF 버전과 동일 — 프론트 수정 불필요):
//   issue   — registIssue(승인거래 즉시발행) → 국세청 승인번호 즉시 수신 → cash_receipts insert
//   refresh — getInfo → stateCode(300 발행완료/304 전송성공/305 전송실패)·승인번호 갱신
//   cancel  — revokeRegistIssue(취소거래) → status='cancelled' (승인번호 즉시 부여되므로 당일 취소 가능)
//   search  — 팝빌 발행내역 조회 (진단용 — CODEF CF-05001 시절 유령 발행 대조)
//
// Secrets: POPBILL_LINK_ID, POPBILL_SECRET_KEY, POPBILL_ENV(test|production)

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import popbill from "https://esm.sh/popbill@1.64.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const IS_TEST = (Deno.env.get("POPBILL_ENV") || "test") !== "production";
popbill.config({
  LinkID: Deno.env.get("POPBILL_LINK_ID") || "",
  SecretKey: Deno.env.get("POPBILL_SECRET_KEY") || "",
  IsTest: IS_TEST,
  IPRestrictOnOff: false,
  UseStaticIP: false,
  UseLocalTimeYN: true,
  defaultErrorHandler: () => {},
});
const cb = popbill.CashbillService();

// 콜백 기반 SDK → Promise 래핑
function call<T>(fn: (ok: (r: T) => void, ng: (e: any) => void) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => fn(resolve, reject));
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// KST 오늘/N일 전 (즉시발행이라 거래일 = 오늘. 엣지 런타임은 UTC — +9h 보정)
const kstDate = (offsetDays = 0) =>
  new Date(Date.now() + 9 * 3600 * 1000 - offsetDays * 86400 * 1000).toISOString().slice(0, 10);
const todayKst = () => kstDate(0);

serve(withSentry("cashbill-issue", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

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

    if (!Deno.env.get("POPBILL_LINK_ID") || !Deno.env.get("POPBILL_SECRET_KEY")) {
      return json({ error: "팝빌 API 인증정보가 없습니다." }, 500);
    }

    const { data: company } = await admin.from("companies").select("*").eq("id", companyId).maybeSingle();
    if (!company) return json({ error: "회사 정보를 찾을 수 없습니다." }, 404);
    const corpNum = String(company.business_number || "").replace(/\D/g, "");
    if (corpNum.length !== 10) return json({ error: "회사 사업자등록번호(10자리)가 없습니다. 설정 → 회사 정보에서 입력하세요." }, 400);

    // 팝빌 회원 UserID 후보 순회 — popbill-issue(세금계산서)와 동일 패턴.
    //   아이디 불일치 오류일 때만 다음 후보, 그 외 오류는 즉시 반환.
    const popUserId = `motive${corpNum}`;
    const idCandidates = [popUserId, `motive_${corpNum}`, "", corpNum];
    async function tryIds<T>(run: (uid: string) => Promise<T>): Promise<T> {
      const errs: string[] = [];
      for (const uid of idCandidates) {
        try {
          return await run(uid);
        } catch (e: any) {
          const msg = e?.message || String(e);
          errs.push(`${uid || "(빈값)"}: ${msg}`);
          if (!/아이디|아닙니다|member|MEMBER/i.test(msg)) throw new Error(msg);
        }
      }
      throw new Error(errs.join(" | "));
    }

    // ── search: 팝빌 발행내역 조회 (진단용) ──
    if (action === "search") {
      const sdate = String(body.sdate || "").replace(/\D/g, "") || kstDate(14).replaceAll("-", "");
      const edate = String(body.edate || "").replace(/\D/g, "") || todayKst().replaceAll("-", "");
      const r = await tryIds((uid) => call<any>((ok, ng) =>
        cb.search(corpNum, "T", sdate, edate, null, null, null, null, null, "", "D", 1, 500, "", uid, ok, ng)));
      const list = (r?.list || []).map((x: any) => ({
        mgtKey: x.mgtKey, tradeType: x.tradeType, tradeDate: x.tradeDate, issueDT: x.issueDT,
        totalAmount: x.totalAmount, identityNum: x.identityNum, customerName: x.customerName,
        itemName: x.itemName, confirmNum: x.confirmNum, stateCode: x.stateCode,
      }));
      return json({ success: true, total: r?.total ?? list.length, list });
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

      // 가맹점(회사) 정보 — 발행서식 표기용 필수값 검증
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

      // 팝빌 회원사 가입 (멱등 — 이미 가입이면 무시하고 진행)
      try {
        await call<any>((ok, ng) => cb.joinMember({
          ID: popUserId,
          Password: "Mtv!" + crypto.randomUUID().replace(/-/g, "").slice(0, 12),
          LinkID: Deno.env.get("POPBILL_LINK_ID") || "",
          CorpNum: corpNum,
          CEOName: corpCEOName,
          CorpName: corpName,
          Addr: corpAddress,
          BizType: company.business_type || "",
          BizClass: company.business_category || "",
          ContactName: corpCEOName || "담당자",
          ContactEmail: company.automation_settings?.invoicer_email || userRow.email || "",
          ContactTEL: company.phone || "",
        }, ok, ng));
      } catch { /* 가입 실패해도 발행 시도 — 기가입이면 발행은 성공 */ }

      // 🚨 이중발행 가드 — CODEF CF-05001 시절 "오류 응답인데 실발행" 인시던트 대비:
      //   최근 3일 팝빌 발행분에 같은 식별번호·금액의 승인거래(미상쇄)가 있으면 차단하고 승인번호 안내.
      //   조회 자체가 실패하면 가드는 생략(발행을 막지 않는다 — 미가입 등은 registIssue 가 정확히 알려줌).
      try {
        const sd = kstDate(3).replaceAll("-", "");
        const ed = todayKst().replaceAll("-", "");
        const prev = await tryIds((uid) => call<any>((ok, ng) =>
          cb.search(corpNum, "T", sd, ed, null, null, null, null, null, "", "D", 1, 500, "", uid, ok, ng)));
        const matches = (prev?.list || []).filter((x: any) =>
          String(x.identityNum || "").replace(/\D/g, "") === identityRaw &&
          Math.round(Number(x.totalAmount || 0)) === amount);
        const issued = matches.filter((x: any) => x.tradeType === "승인거래");
        const canceled = matches.filter((x: any) => x.tradeType === "취소거래").length;
        if (issued.length > canceled) {
          const dup = issued[0];
          return json({
            error: `중복 발행 차단: 최근 3일 내 같은 식별번호·금액(₩${amount.toLocaleString("ko-KR")})으로 이미 발행된 현금영수증이 팝빌에 있습니다 (거래일 ${dup.tradeDate || "?"}, 국세청 승인번호 ${dup.confirmNum || "미부여"}).`,
            hint: "이전 CODEF 오류(CF-05001) 때 실패로 표시됐지만 실제로는 발행됐을 수 있습니다. 해당 건 취소가 필요하면 알려주세요. 별건의 정당한 거래라면 잠시 후 다시 시도하거나 금액·식별번호를 확인하세요.",
            code: "DUPLICATE_SUSPECTED",
            raw: dup,
          }, 409);
        }
      } catch { /* 가드 생략 */ }

      const mgtKey = `CB${Date.now()}${Math.floor(Math.random() * 1000).toString().padStart(3, "0")}`;
      const cashbill = {
        mgtKey,
        tradeType: "승인거래",
        tradeUsage: purpose === "income_deduction" ? "소득공제용" : "지출증빙용",
        tradeOpt: "일반",
        taxationType,
        totalAmount: String(amount),
        supplyCost: String(supplyCost),
        tax: String(tax),
        serviceFee: "0",
        franchiseCorpNum: corpNum,
        franchiseCorpName: corpName,
        franchiseCEOName: corpCEOName,
        franchiseAddr: corpAddress,
        franchiseTEL: corpTEL,
        identityNum: identityRaw,
        customerName: body.customerName || body.counterpartyName || "",
        itemName: body.itemName || "",
        orderNumber: "",
        email: body.email || "",
        hp: "",
        smssendYN: false,
      };

      let resp: any;
      try {
        resp = await tryIds((uid) => call<any>((ok, ng) =>
          cb.registIssue(corpNum, cashbill, body.memo || "", uid, "", ok, ng)));
      } catch (e: any) {
        return json({ error: `현금영수증 발행 실패: ${e?.message || String(e)}`, code: e?.code }, 400);
      }
      const confirmNum = resp?.confirmNum || "";

      const { data: inserted, error: insErr } = await admin.from("cash_receipts").insert({
        company_id: companyId,
        type: "income",
        amount,
        supply_amount: supplyCost,
        tax_amount: tax,
        counterparty_name: body.counterpartyName || body.customerName || null,
        counterparty_bizno: purpose === "expenditure_proof" ? (body.identityNum || null) : null,
        issue_date: todayKst(),
        approval_number: confirmNum || null, // 팝빌 즉시발행 — 국세청 승인번호 즉시 부여
        identity_number: body.identityNum || identityRaw,
        identity_type: body.identityType || (purpose === "income_deduction" ? "phone" : "bizno"),
        purpose,
        status: "issued",
        source: "codef", // 기존 국세청 실발행 소스 값 유지 (UI 분기·발행 한도 집계와 호환)
        memo: body.memo || null,
        document_key: mgtKey,
        nts_state_code: "300",
        issue_response: resp,
      }).select().single();
      if (insErr) {
        // 발행은 이미 성공 — DB 실패 시 승인번호를 반드시 사용자에게 남긴다
        return json({ error: `발행은 완료됐지만 저장 실패: ${insErr.message} — 국세청 승인번호 ${confirmNum || mgtKey} 를 보관하세요.` }, 500);
      }

      return json({
        success: true, receipt: inserted, documentKey: mgtKey,
        message: confirmNum
          ? `현금영수증 발행 완료 — 국세청 승인번호 ${confirmNum}`
          : "현금영수증 발행 완료 — 승인번호는 '승인번호 조회'로 확인하세요.",
      });
    }

    // ── receipt 로드 + 회사 검증 (refresh/cancel 공통) ──
    const receiptId = body.receipt_id;
    if (!receiptId) return json({ error: "receipt_id required" }, 400);
    const { data: receipt } = await admin.from("cash_receipts").select("*").eq("id", receiptId).maybeSingle();
    if (!receipt || receipt.company_id !== companyId) return json({ error: "현금영수증을 찾을 수 없습니다." }, 404);
    if (receipt.source !== "codef" || !receipt.document_key) {
      return json({ error: "국세청 실발행으로 발행된 현금영수증이 아닙니다." }, 400);
    }

    // ══ refresh: 국세청 승인번호·상태 조회 ══
    if (action === "refresh") {
      const info = await tryIds((uid) => call<any>((ok, ng) => cb.getInfo(corpNum, receipt.document_key, uid, ok, ng)));
      const patch: Record<string, unknown> = {
        nts_state_code: String(info?.stateCode || receipt.nts_state_code || ""),
        issue_response: info,
      };
      if (info?.confirmNum) patch.approval_number = info.confirmNum;
      const { data: updated } = await admin.from("cash_receipts").update(patch).eq("id", receipt.id).select().maybeSingle();
      const state = String(updated?.nts_state_code || "");
      const stateMsg =
        state === "304" ? "국세청 전송 완료" :
        state === "305" ? "국세청 전송 실패" :
        updated?.approval_number ? `승인번호 ${updated.approval_number} — 국세청 전송 대기 중` : "국세청 전송 대기 중";
      return json({ success: true, receipt: updated || receipt, message: stateMsg });
    }

    // ══ cancel: 취소거래 발행 (국세청 승인번호 필요 — 즉시발행이라 발행 직후부터 가능) ══
    if (action === "cancel") {
      let confirmNum = receipt.approval_number;
      if (!confirmNum) {
        try {
          const info = await tryIds((uid) => call<any>((ok, ng) => cb.getInfo(corpNum, receipt.document_key, uid, ok, ng)));
          confirmNum = info?.confirmNum || null;
        } catch { /* 아래 안내로 */ }
      }
      if (!confirmNum) {
        return json({ error: "국세청 승인번호가 아직 없어 취소할 수 없습니다. '승인번호 조회'를 먼저 실행하세요." }, 400);
      }
      const orgTradeDate = String(receipt.issue_date || "").replaceAll("-", "").slice(0, 8);
      const cancelKey = `CX${Date.now()}${Math.floor(Math.random() * 1000).toString().padStart(3, "0")}`;
      let resp: any;
      try {
        resp = await tryIds((uid) => call<any>((ok, ng) =>
          cb.revokeRegistIssue(corpNum, cancelKey, confirmNum, orgTradeDate, false, body.memo || "발행취소", uid,
            false, null, "", "", "", "", "", "", ok, ng)));
      } catch (e: any) {
        return json({ error: `발행취소 실패: ${e?.message || String(e)}`, code: e?.code }, 400);
      }
      const { data: updated } = await admin.from("cash_receipts").update({
        status: "cancelled",
        nts_state_code: "400",
        approval_number: confirmNum,
        issue_response: resp,
      }).eq("id", receiptId).select().maybeSingle();
      return json({ success: true, receipt: updated, message: "현금영수증 발행취소 완료 (취소거래 국세청 신고)" });
    }

    return json({ error: `unknown action: ${action}` }, 400);
  } catch (err: any) {
    return json({ error: err.message || "Internal error" }, 500);
  }
}));
