// hometax-issue: 홈택스(국세청) 전자세금계산서 정발행
//
// 현재 issueTaxInvoice / process-invoice-queue 는 DB의 status 만 'issued' 로 마킹.
// 실제 홈택스에는 발행 안 됨. 이 함수가 CODEF popbill 발행 API를 호출해서
// 진짜 전자발행을 수행하고 승인번호(nts_confirm_no)를 받아 저장.
//
// ⚠️ TODO: CODEF 발행 product (popbill-taxinvoice-regist-invoicer-trustee) 가
// 회사 계정에 활성화되어야 동작. 미활성화면 CF-00003/CF-00401 반환되며
// 사용자에게 "CODEF 대시보드에서 발행 product 신청" 안내가 뜸.
//
// ⚠️ TODO: 정확한 endpoint URL/필드명은 CODEF 문서 확인 후 ISSUE_PATH 와
// buildIssuePayload() 의 필드명을 확정해야 함. 현재는 POPBiLL 표준 + CODEF 패턴
// 추정값. 활성화 후 첫 호출 시 응답 코드/메시지 보고 정확히 맞춤.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// CODEF API endpoints
const CODEF_ENV = Deno.env.get("CODEF_ENV") || "sandbox";
const CODEF_BASE = CODEF_ENV === "production"
  ? "https://api.codef.io"
  : CODEF_ENV === "development"
    ? "https://development.codef.io"
    : "https://sandbox.codef.io";
const CODEF_TOKEN_URL = "https://oauth.codef.io/oauth/token";

// ⚠️ best-guess endpoint. 실제 URL 은 CODEF 대시보드(상품 → 개발 가이드)에서 확인 후 교체.
const ISSUE_PATH = "/v1/kr/public/nt/popbill/taxinvoice/regist-invoicer-trustee";
const HOMETAX_ORG = "0001"; // ⚠️ POPBiLL 발행 product 의 org 코드. 조회용 0004 와 다를 수 있음 — 활성화 후 확정.

// Token cache
let tokenCache: { token: string; expiresAt: number } | null = null;

async function getCodefToken(clientId: string, clientSecret: string): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.token;
  const basicAuth = btoa(`${clientId}:${clientSecret}`);
  const res = await fetch(CODEF_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${basicAuth}` },
    body: "grant_type=client_credentials&scope=read",
  });
  if (!res.ok) throw new Error(`CODEF token error: ${res.status}`);
  const data = await res.json();
  tokenCache = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return data.access_token;
}

async function codefRequest(token: string, path: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${CODEF_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Bearer ${token}` },
    body: encodeURIComponent(JSON.stringify(body)),
  });
  if (!res.ok) throw new Error(`CODEF API error: ${res.status}`);
  const text = await res.text();
  try { return JSON.parse(decodeURIComponent(text)); }
  catch { return JSON.parse(text); }
}

// 사용자 친화 한국어 메시지
function codefErrorHint(code?: string): string {
  if (!code) return "응답이 없습니다. CODEF 연동 상태를 확인하세요.";
  if (code === "CF-00000") return "";
  if (code === "CF-00003") return "CODEF 대시보드에서 '전자세금계산서 발행 (popbill-taxinvoice-regist-invoicer-trustee)' 상품을 신청하지 않았습니다. CODEF 관리자 페이지 → 상품 관리 → 사용 API 변경 신청에서 추가하세요.";
  if (code === "CF-00401") return "발행 API 권한 없음. 발행 product (popbill-taxinvoice-*) 가 승인되었는지 CODEF 대시보드에서 확인하세요.";
  if (code === "CF-04015" || code.startsWith("CF-0401")) return "Connected ID/인증 정보가 만료. 설정 → API 연동에서 홈택스 계정을 다시 등록하세요.";
  if (code.startsWith("CF-03") || code.startsWith("CF-04")) return "인증 실패. 공동인증서 상태/비밀번호를 확인하세요.";
  if (code.startsWith("CF-12")) return "기관(국세청) 응답 지연/오류. 점검 시간을 피해 재시도하세요.";
  return `CODEF 발행 오류 (${code}). 자세한 내용은 nts_response_payload 또는 CODEF 대시보드 오류 로그를 확인하세요.`;
}

// 안전 변환: yyyy-mm-dd → yyyymmdd
function toYmd(d: string | null): string {
  if (!d) return new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return d.replaceAll("-", "").slice(0, 8);
}

// CODEF 발행 payload 구성. POPBiLL 표준 필드명 추정.
// ⚠️ 활성화 후 실제 응답 보고 필드명/형식 확정 필요.
function buildIssuePayload(args: {
  invoice: any;
  company: any;
  partner: any | null;
  invoicerEmail: string;
  connectedId: string;
}): Record<string, unknown> {
  const { invoice, company, partner, invoicerEmail, connectedId } = args;
  const writeDate = toYmd(invoice.issue_date);
  const supply = String(Math.round(Number(invoice.supply_amount || 0)));
  const tax = String(Math.round(Number(invoice.tax_amount || 0)));
  const total = String(Math.round(Number(invoice.total_amount || 0)));

  // 거래처 정보: invoice 컬럼 우선 → partners fallback
  const buyerCorpNum = invoice.counterparty_bizno || partner?.business_number || "";
  const buyerCorpName = invoice.counterparty_name || partner?.company_name || partner?.name || "";
  const buyerCEO = partner?.representative || "";
  const buyerAddr = partner?.address || "";
  const buyerBizClass = invoice.counterparty_business_type || partner?.business_type || "";
  const buyerBizType = invoice.counterparty_business_item || partner?.business_item || "";
  const buyerEmail = partner?.contact_email || "";

  return {
    organization: HOMETAX_ORG,
    connectedId,
    issueType: "01",            // 01=정발행
    chargeDirection: "01",      // 01=정과금 (영수)
    purposeType: "02",          // 02=영수 (현금/계좌이체 결제 완료) / 01=청구
    taxType: "01",              // 01=과세 / 02=영세 / 03=면세
    writeDate,                  // YYYYMMDD

    // 공급자 (회사 본인)
    invoicerCorpNum: company.business_number || "",
    invoicerCorpName: company.name || "",
    invoicerCEOName: company.representative || "",
    invoicerAddr: company.address || "",
    invoicerBizClass: company.business_type || "",
    invoicerBizType: company.business_category || "",
    invoicerEmail,

    // 공급받는자
    invoiceeType: "01",         // 01=사업자 / 02=개인 / 03=외국인
    invoiceeCorpNum: buyerCorpNum,
    invoiceeCorpName: buyerCorpName,
    invoiceeCEOName: buyerCEO,
    invoiceeAddr: buyerAddr,
    invoiceeBizClass: buyerBizClass,
    invoiceeBizType: buyerBizType,
    invoiceeEmail1: buyerEmail,

    // 합계
    supplyCostTotal: supply,
    taxTotal: tax,
    totalAmount: total,

    // 품목 (1줄)
    detailList: [{
      serialNum: 1,
      purchaseDT: writeDate,
      itemName: invoice.item_name || invoice.label || invoice.expense_category || "용역",
      spec: "",
      qty: "1",
      unitCost: supply,
      supplyCost: supply,
      tax,
      remark: "",
    }],

    remark1: invoice.label || "",
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: { user } } = await createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    }).auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { invoice_id } = await req.json();
    if (!invoice_id) {
      return new Response(JSON.stringify({ error: "invoice_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1) invoice 조회
    const { data: invoice } = await supabase.from("tax_invoices").select("*").eq("id", invoice_id).maybeSingle();
    if (!invoice) {
      return new Response(JSON.stringify({ error: "세금계산서를 찾을 수 없습니다." }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2) 권한 확인 (같은 회사)
    const { data: userRow } = await supabase.from("users").select("company_id, email")
      .eq("auth_id", user.id).maybeSingle();
    if (!userRow || userRow.company_id !== invoice.company_id) {
      return new Response(JSON.stringify({ error: "권한이 없습니다." }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3) 이미 발행된 건 중복 방지
    if (invoice.nts_issue_status === "issued" && invoice.nts_confirm_no) {
      return new Response(JSON.stringify({
        success: true, alreadyIssued: true,
        nts_confirm_no: invoice.nts_confirm_no,
        message: "이미 홈택스에 발행된 세금계산서입니다.",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 4) company + connected_id + credentials
    const [{ data: company }, { data: settings }] = await Promise.all([
      supabase.from("companies").select("*").eq("id", invoice.company_id).maybeSingle(),
      supabase.from("company_settings")
        .select("codef_client_id, codef_client_secret, codef_connected_id")
        .eq("company_id", invoice.company_id).maybeSingle(),
    ]);
    if (!company) {
      return new Response(JSON.stringify({ error: "회사 정보를 찾을 수 없습니다." }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!company.business_number) {
      return new Response(JSON.stringify({
        error: "회사 사업자등록번호가 등록되어 있지 않습니다. 설정 → 회사 정보에서 입력하세요.",
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const connectedId = settings?.codef_connected_id;
    if (!connectedId) {
      return new Response(JSON.stringify({
        error: "CODEF 연결이 설정되지 않았습니다. 설정 → 은행연동에서 홈택스를 먼저 연결하세요.",
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const clientId = settings?.codef_client_id || Deno.env.get("CODEF_CLIENT_ID");
    const clientSecret = settings?.codef_client_secret || Deno.env.get("CODEF_CLIENT_SECRET");
    if (!clientId || !clientSecret) {
      return new Response(JSON.stringify({ error: "CODEF API 인증정보가 없습니다." }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 5) partner (거래처 추가 정보)
    let partner: any = null;
    if (invoice.partner_id) {
      const { data } = await supabase.from("partners").select("*").eq("id", invoice.partner_id).maybeSingle();
      partner = data;
    }

    // 6) 발행 담당자 이메일 결정 — automation_settings.invoicer_email 우선, 없으면 요청 사용자, 그래도 없으면 첫 owner
    let invoicerEmail: string =
      company.automation_settings?.invoicer_email ||
      userRow.email ||
      "";
    if (!invoicerEmail) {
      const { data: owner } = await supabase.from("users")
        .select("email").eq("company_id", invoice.company_id).eq("role", "owner")
        .order("created_at").limit(1).maybeSingle();
      invoicerEmail = owner?.email || "";
    }
    if (!invoicerEmail) {
      return new Response(JSON.stringify({
        error: "발행자 이메일이 없습니다. 설정 → 자동화 → 발행자 이메일을 입력하거나 회사 owner 계정 이메일을 확인하세요.",
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 7) payload 구성 + pending 상태 마킹
    const payload = buildIssuePayload({ invoice, company, partner, invoicerEmail, connectedId });
    await supabase.from("tax_invoices").update({
      nts_issue_status: "pending",
      nts_request_payload: payload,
      nts_error_code: null,
      nts_error_message: null,
    }).eq("id", invoice_id);

    // 8) CODEF 호출
    let codefResp: any;
    try {
      const token = await getCodefToken(clientId, clientSecret);
      codefResp = await codefRequest(token, ISSUE_PATH, payload);
    } catch (err: any) {
      await supabase.from("tax_invoices").update({
        nts_issue_status: "failed",
        nts_error_code: "NETWORK_ERROR",
        nts_error_message: err.message || "CODEF 통신 실패",
      }).eq("id", invoice_id);
      return new Response(JSON.stringify({
        error: "CODEF 통신 실패: " + (err.message || ""),
        hint: "잠시 후 다시 시도하세요. 지속 발생 시 CODEF 상태 확인.",
      }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 9) 결과 처리
    const resultCode = codefResp?.result?.code;
    if (resultCode === "CF-00000") {
      // 승인번호 추출 — POPBiLL 응답 필드 추정 (ntsConfirmNum, resIssueNum, resApprovalNo 등 가능)
      const ntsConfirmNum =
        codefResp.data?.ntsConfirmNum ||
        codefResp.data?.resIssueNum ||
        codefResp.data?.resApprovalNo ||
        codefResp.data?.resInvoiceNumber ||
        "";

      await supabase.from("tax_invoices").update({
        nts_issue_status: "issued",
        nts_confirm_no: ntsConfirmNum,
        nts_issued_at: new Date().toISOString(),
        nts_response_payload: codefResp,
        status: "issued",
        issue_date: invoice.issue_date || new Date().toISOString().split("T")[0],
        auto_issued: false,
      }).eq("id", invoice_id);

      return new Response(JSON.stringify({
        success: true,
        nts_confirm_no: ntsConfirmNum,
        message: ntsConfirmNum ? `홈택스 발행 완료 (승인번호: ${ntsConfirmNum})` : "홈택스 발행 완료",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 실패
    const errorMsg = codefResp?.result?.message || "발행 실패";
    const hint = codefErrorHint(resultCode);
    await supabase.from("tax_invoices").update({
      nts_issue_status: "failed",
      nts_error_code: resultCode || "UNKNOWN",
      nts_error_message: errorMsg,
      nts_response_payload: codefResp,
    }).eq("id", invoice_id);

    return new Response(JSON.stringify({
      error: `발행 실패 (${resultCode}): ${errorMsg}`,
      code: resultCode,
      hint,
    }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
