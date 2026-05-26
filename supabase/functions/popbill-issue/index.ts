// popbill-issue: 팝빌(POPBiLL) 직접 연동 전자세금계산서 발행.
//   CODEF(중개) 대신 팝빌 Node SDK 를 Deno Edge Function 에서 직접 사용.
//   LinkHub 인증(HMAC)·전자서명은 SDK 가 처리.
//
// Actions:
//   balance     — SDK 작동/연동 확인 (포인트 잔액 조회)
//   check       — 회원사(corpNum) 가입여부 확인
//   join        — 회원사 가입 (우리 LinkID 아래 corpNum 등록)
//   cert-url    — 공인인증서 등록 팝빌 URL 발급 (사용자가 그 URL 에서 등록)
//   issue       — 세금계산서 즉시발행 (RegistIssue) + 우리 DB 저장
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
const ti = popbill.TaxinvoiceService();

// 콜백 기반 SDK → Promise 래핑
function call<T>(fn: (ok: (r: T) => void, ng: (e: any) => void) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => fn(resolve, reject));
}

function toYmd(d: string | null): string {
  if (!d) return new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return d.replaceAll("-", "").slice(0, 8);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: { user } } = await createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } }).auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json();
    const action = body.action || "issue";
    // issue 는 invoice_id 로 company 도출 허용 (클라이언트 단순화)
    let companyId = body.companyId;
    if (!companyId && body.invoice_id) {
      const { data: invc } = await supabase.from("tax_invoices").select("company_id").eq("id", body.invoice_id).maybeSingle();
      companyId = invc?.company_id;
    }
    if (!companyId) return json({ error: "companyId required" }, 400);

    // 권한 + 회사
    const { data: uRow } = await supabase.from("users").select("company_id, email").eq("auth_id", user.id).maybeSingle();
    if (!uRow || uRow.company_id !== companyId) return json({ error: "권한이 없습니다." }, 403);
    const { data: comp } = await supabase.from("companies").select("*").eq("id", companyId).maybeSingle();
    if (!comp?.business_number) return json({ error: "회사 사업자등록번호가 없습니다. 설정 → 회사 정보에서 입력하세요." }, 400);
    const corpNum = String(comp.business_number).replace(/\D/g, "");

    // ── SDK 작동 확인: 포인트 잔액 ──
    if (action === "balance") {
      const bal = await call<number>((ok, ng) => ti.getBalance(corpNum, ok, ng));
      return json({ success: true, balance: bal, isTest: IS_TEST });
    }

    // ── 회원사 가입여부 ──
    if (action === "check") {
      const joined = await call<boolean>((ok, ng) => ti.checkIsMember(corpNum, Deno.env.get("POPBILL_LINK_ID") || "", ok, ng));
      return json({ success: true, joined });
    }

    // 팝빌 회원 ID — 영숫자만(언더스코어 등 제외). 가입/인증서/발행에서 동일 사용.
    const popUserId = `motive${corpNum}`;

    // ── 회원사 가입 + 인증서 등록 URL (통합) ──
    if (action === "join" || action === "register" || action === "cert-url") {
      const joinForm = {
        ID: popUserId,
        Password: "Mtv!" + crypto.randomUUID().replace(/-/g, "").slice(0, 12),
        LinkID: Deno.env.get("POPBILL_LINK_ID") || "",
        CorpNum: corpNum,
        CEOName: comp.representative || "",
        CorpName: comp.name || "",
        Addr: comp.address || "",
        BizType: comp.business_type || "",
        BizClass: comp.business_category || "",
        ContactName: comp.representative || comp.name || "담당자",
        ContactEmail: comp.automation_settings?.invoicer_email || uRow.email || "",
        ContactTEL: comp.phone || "",
      };
      let joinNote = "";
      try {
        await call<any>((ok, ng) => ti.joinMember(joinForm, ok, ng));
        joinNote = "가입 완료";
      } catch (e: any) {
        joinNote = "가입 skip: " + (e?.message || String(e));
      }
      // 인증서 등록 URL — 여러 UserID 후보로 시도 (이미 가입된 회원의 ID 불일치 대응)
      const idCandidates = [popUserId, `motive_${corpNum}`, "", corpNum];
      const errs: string[] = [];
      for (const uid of idCandidates) {
        try {
          const url = await call<string>((ok, ng) => ti.getTaxCertURL(corpNum, uid, ok, ng));
          if (url) return json({ success: true, certURL: url, joinNote, usedId: uid, message: "팝빌 인증서 등록 페이지로 이동하세요. 등록 후 발행 가능합니다." });
        } catch (e: any) {
          errs.push(`${uid || "(빈값)"}: ${e?.message || String(e)}`);
        }
      }
      return json({ error: `인증서 URL 발급 실패 — 모든 ID 후보 실패 [${errs.join(" | ")}] (회원가입: ${joinNote})` }, 400);
    }

    // ── 발행 (RegistIssue) ──
    if (action === "issue") {
      const invoiceId = body.invoice_id;
      if (!invoiceId) return json({ error: "invoice_id required" }, 400);
      const { data: inv } = await supabase.from("tax_invoices").select("*").eq("id", invoiceId).maybeSingle();
      if (!inv) return json({ error: "세금계산서를 찾을 수 없습니다." }, 404);
      if (inv.company_id !== companyId) return json({ error: "권한이 없습니다." }, 403);
      if (inv.nts_confirm_no) return json({ success: true, alreadyIssued: true, nts_confirm_no: inv.nts_confirm_no, message: "이미 발행됨" });

      let partner: any = null;
      if (inv.partner_id) { const { data } = await supabase.from("partners").select("*").eq("id", inv.partner_id).maybeSingle(); partner = data; }

      const writeDate = toYmd(inv.issue_date);
      const supply = Math.round(Number(inv.supply_amount || 0));
      const tax = Math.round(Number(inv.tax_amount || 0));
      const total = Math.round(Number(inv.total_amount || 0));
      const buyerBizNo = String(inv.counterparty_bizno || partner?.business_number || "").replace(/\D/g, "");
      const invoiceeType = buyerBizNo.length === 13 ? "개인" : "사업자";
      const purposeType = (inv.label || "").includes("청구") ? "청구" : "영수";
      const mgtKey = `OV${String(inv.id).replace(/-/g, "").slice(0, 22)}`;

      const taxinvoice = {
        writeDate,
        chargeDirection: "정과금",
        issueType: "정발행",
        purposeType,
        taxType: "과세",
        invoicerMgtKey: mgtKey,
        invoicerCorpNum: corpNum,
        invoicerCorpName: comp.name || "",
        invoicerCEOName: comp.representative || "",
        invoicerAddr: comp.address || "",
        invoicerBizType: comp.business_type || "",
        invoicerBizClass: comp.business_category || "",
        invoicerContactName: comp.representative || comp.name || "",
        invoicerEmail: comp.automation_settings?.invoicer_email || uRow.email || "",
        invoiceeType,
        invoiceeCorpNum: buyerBizNo,
        invoiceeCorpName: inv.counterparty_name || partner?.name || "",
        invoiceeCEOName: partner?.representative || "",
        invoiceeAddr: partner?.address || "",
        invoiceeEmail1: partner?.contact_email || "",
        supplyCostTotal: String(supply),
        taxTotal: String(tax),
        totalAmount: String(total),
        detailList: [{
          serialNum: 1,
          purchaseDT: writeDate,
          itemName: inv.item_name || inv.label || inv.expense_category || "용역",
          qty: "1",
          supplyCost: String(supply),
          tax: String(tax),
        }],
      };

      await supabase.from("tax_invoices").update({ nts_issue_status: "pending", nts_request_payload: taxinvoice, nts_error_code: null, nts_error_message: null }).eq("id", invoiceId);

      // registIssue(CorpNum, Taxinvoice, WriteSpecification, Memo, ForceIssue, DealInvoiceMgtKey, EmailSubject, UserID, success, error)
      // 회원 ID 불일치 대응: 여러 UserID 후보로 시도 (아이디 에러일 때만 다음 후보)
      const idCandidates = [popUserId, `motive_${corpNum}`, "", corpNum];
      let r: any = null; let lastErr = ""; const tried: string[] = [];
      for (const uid of idCandidates) {
        try {
          r = await call<any>((ok, ng) => ti.registIssue(corpNum, taxinvoice, false, "", false, "", "", uid, ok, ng));
          break;
        } catch (e: any) {
          lastErr = e?.message || String(e);
          tried.push(`${uid || "(빈값)"}: ${lastErr}`);
          if (!/아이디|아닙니다|member|MEMBER/i.test(lastErr)) break; // 아이디 문제가 아니면 즉시 중단
        }
      }
      if (r) {
        const ntsNo = r?.ntsConfirmNum || r?.ntsconfirmNum || "";
        await supabase.from("tax_invoices").update({
          nts_issue_status: "issued",
          nts_confirm_no: ntsNo || mgtKey,
          nts_issued_at: new Date().toISOString(),
          nts_response_payload: r,
          status: "issued",
        }).eq("id", invoiceId);
        return json({ success: true, nts_confirm_no: ntsNo, mgtKey, message: ntsNo ? `발행 완료 (승인번호 ${ntsNo})` : "발행 완료 (국세청 전송 대기)", result: r });
      }
      await supabase.from("tax_invoices").update({ nts_issue_status: "failed", nts_error_message: lastErr, nts_response_payload: { tried } }).eq("id", invoiceId);
      return json({ error: "발행 실패: " + lastErr + ` [시도: ${tried.join(" | ")}]` }, 400);
    }

    return json({ error: "알 수 없는 action" }, 400);
  } catch (err: any) {
    return json({ error: err?.message || "Internal error" }, 500);
  }
});
