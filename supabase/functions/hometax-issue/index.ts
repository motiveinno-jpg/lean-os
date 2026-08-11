import { tfetch } from "../_shared/http.ts";
import { withSentry } from "../_shared/sentry.ts";
import { createMeterStore, runWithMeter, meterPush, flushCodefUsage } from "../_shared/codef-meter.ts";
// hometax-issue: 홈택스(국세청) 전자세금계산서 정발행
//
// CODEF 발행 API(/v1/kr/public/a/tax-invoice/regist-invoicer-trustee) 호출 →
// 국세청 전자발행 + 승인번호(ntsconfirmNum, 24자리) 수신 → nts_confirm_no 저장.
// 명세: 발행 API PDF(2026-05) 기준 — 한글 코드값(정발행/과세/영수/사업자), sendToNtsYn=Y.
//
// 전제: CODEF 대시보드에서 "전자세금계산서 발행" 상품 활성화 + 회사 codef_connected_id 등록.
// 미활성화면 CF-00003/CF-00401 반환 → codefErrorHint 로 안내.

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

// CODEF 전자세금계산서 발행 API (정발행/위수탁). 명세: 승인내역 PDF 기준.
const ISSUE_PATH = "/v1/kr/public/a/tax-invoice/regist-invoicer-trustee";
// 수정발행은 별도 엔드포인트다(명세 2026-04-22). 송신부는 정발행과 동일하고
//   modifyCode(수정사유) + orgNTSConfirmNum(원본 승인번호 24자리)만 추가된다.
//   issueType 은 수정발행에서도 "정발행"/"위수탁" 중 택1 — "수정발행" 이라는 값은 없다.
const REVISE_ISSUE_PATH = "/v1/kr/public/a/tax-invoice/regist-revise-invoicer-trustee";

// Token cache
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

async function codefRequest(token: string, path: string, body: Record<string, unknown>): Promise<any> {
  let res: Response;
  try {
    res = await tfetch(`${CODEF_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Bearer ${token}` },
      body: encodeURIComponent(JSON.stringify(body)),
    });
  } catch (e) {
    meterPush(path, "FETCH_ERROR");
    throw e;
  }
  if (!res.ok) {
    meterPush(path, `HTTP_${res.status}`);
    throw new Error(`CODEF API error: ${res.status}`);
  }
  const text = await res.text();
  // 2026-07-16 QA: CODEF 응답은 application/x-www-form-urlencoded 라 공백이 '+' 로 옴.
  //   decodeURIComponent 는 '+' 를 공백으로 안 바꿔줘서(%XX 만 디코딩) 메시지가
  //   "API+요청+처리중..." 처럼 깨져 저장되던 버그 — '+' → 공백 치환을 먼저 해준다.
  let parsed: any;
  try { parsed = JSON.parse(decodeURIComponent(text.replace(/\+/g, " "))); }
  catch { parsed = JSON.parse(text); }
  meterPush(path, parsed?.result?.code || "UNKNOWN");
  return parsed;
}

// 사용자 친화 한국어 메시지
function codefErrorHint(code?: string): string {
  if (!code) return "응답이 없습니다. CODEF 연동 상태를 확인하세요.";
  if (code === "CF-00000") return "";
  if (code === "CF-00003") return "CODEF 대시보드에서 해당 발행 상품을 신청하지 않았습니다. 정발행은 'regist-invoicer-trustee', 수정발행은 'regist-revise-invoicer-trustee' 로 상품이 각각 분리돼 있습니다. CODEF 관리자 페이지 → 상품 관리 → 사용 API 변경 신청에서 추가하세요.";
  if (code === "CF-00401") return "발행 API 권한 없음. 발행 product (popbill-taxinvoice-*) 가 승인되었는지 CODEF 대시보드에서 확인하세요.";
  if (code === "CF-04015" || code.startsWith("CF-0401")) return "Connected ID/인증 정보가 만료. 설정 → API 연동에서 홈택스 계정을 다시 등록하세요.";
  if (code === "CF-05001") return "공동인증서가 팝빌에 등록되지 않았습니다. 이 화면의 '① 발행 등록 (회원가입+인증서)' 버튼을 눌러 뜨는 팝업에서 인증서를 먼저 등록하세요. (윈도우 PC 전용, URL 30초 유효 — 전자세금용/표준/범용 인증서만 가능, 인터넷뱅킹·보험·증권·우체국용 인증서는 등록 불가)";
  if (code.startsWith("CF-03") || code.startsWith("CF-04")) return "인증 실패. 공동인증서 상태/비밀번호를 확인하세요.";
  if (code.startsWith("CF-12")) return "기관(국세청) 응답 지연/오류. 점검 시간을 피해 재시도하세요.";
  return `CODEF 발행 오류 (${code}). 자세한 내용은 nts_response_payload 또는 CODEF 대시보드 오류 로그를 확인하세요.`;
}

// 국세청 승인번호 정규화 — CODEF 는 24자리 영숫자를 요구한다.
//   홈택스 동기화로 들어온 값은 화면 표기형(8-8-8, 하이픈 2개 = 26자)이라 그대로 보내면 거부된다.
//   실데이터 확인(2026-07-27): 승인번호 보유 1,806건 전부 하이픈 제거 시 정확히 24자리.
//     · 동기화분 1,805건 = 26자 하이픈형 (예: 20250501-10250502-27435031)
//     · CODEF 발행분 1건 = 24자 그대로 (예: 202607224100020300002561)
function normalizeNtsConfirmNum(v: string | null | undefined): string {
  return String(v || "").replace(/[^0-9A-Za-z]/g, "");
}

// 안전 변환: yyyy-mm-dd → yyyymmdd
function toYmd(d: string | null): string {
  if (!d) return new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return d.replaceAll("-", "").slice(0, 8);
}

// ── 수정세금계산서(수정발행) ──────────────────────────────────────────────
//   UI(tax-invoices/page.tsx MODIFICATION_REASONS)가 보내는 사유값 → 국세청 수정사유 코드.
//   modify-tax-invoice 안의 한글 라벨 맵은 UI 값과 형식이 달라 매칭되지 않는 죽은 코드였다.
//   이쪽(전송 단계)이 단일 기준이다.
const NTS_MODIFY_CODES: Record<string, string> = {
  error_correction: "1", // 기재사항 착오정정 (원본 취소분 부(-) + 수정분 정(+) = 2장)
  price_change: "2",     // 공급가액 변동 (증감분 1장)
  return: "3",           // 환입 (부(-) 1장)
  contract_cancel: "4",  // 계약의 해제 (부(-) 1장)
  inland_lc: "5",        // 내국신용장 사후개설 (과세 부(-) + 영세 = 2장)
  duplicate: "6",        // 착오에 의한 이중발급 (부(-) 1장)
};

/** 품목 줄 만들기 — tax_invoices.items(줄 배열)를 CODEF detailList 로. 비어 있으면 한 줄로 폴백. */
function buildDetailList(invoice: any, writeDate: string, supply: string, tax: string) {
  const items = Array.isArray(invoice.items) ? invoice.items : [];
  if (items.length > 0) {
    return items.map((it: any, i: number) => {
      const lineSupply = Math.round(Number(it.supplyAmount ?? (Number(it.qty || 1) * Number(it.unitCost || 0))) || 0);
      //   줄 세액은 과세일 때만 — 영세율·면세 계산서는 합계 세액이 0 이라 줄도 0 이 된다
      const lineTax = Number(tax) > 0 ? Math.round(lineSupply * 0.1) : 0;
      return {
        serialNum: String(i + 1),
        purchaseDT: writeDate,
        itemName: String(it.name || "").trim() || "용역",
        spec: String(it.spec || ""),
        qty: String(it.qty ?? 1),
        unitCost: String(Math.round(Number(it.unitCost || 0))),
        supplyCost: String(lineSupply),
        tax: String(lineTax),
        remark: String(it.remark || ""),
      };
    });
  }
  return [{
    serialNum: "1",
    purchaseDT: writeDate,
    itemName: invoice.item_name || invoice.expense_category || "용역",
    spec: "",
    qty: "1",
    unitCost: supply,
    supplyCost: supply,
    tax,
    remark: "",
  }];
}

// CODEF 발행 payload 구성 — 발행 API PDF 명세 기준 (한글 코드값).
function buildIssuePayload(args: {
  invoice: any;
  company: any;
  partner: any | null;
  invoicerEmail: string;
  connectedId: string;
  /** 수정발행일 때만 — 당초 승인번호 + 국세청 수정사유 코드 */
  modification?: { originalConfirmNo: string; reasonCode: string } | null;
}): Record<string, unknown> {
  const { invoice, company, partner, invoicerEmail, connectedId, modification } = args;
  const writeDate = toYmd(invoice.issue_date);
  const supply = String(Math.round(Number(invoice.supply_amount || 0)));
  const tax = String(Math.round(Number(invoice.tax_amount || 0)));
  const total = String(Math.round(Number(invoice.total_amount || 0)));

  // 거래처 정보: invoice 컬럼 우선 → partners fallback
  const buyerCorpNum = invoice.counterparty_bizno || partner?.business_number || "";
  const buyerCorpName = invoice.counterparty_name || partner?.company_name || partner?.name || "";
  // 2026-08-10 사장님 지적으로 발견 — 대표자·주소·이메일만 **등록된 거래처에서만** 읽고 있었다.
  //   계산서 행에 적어 넣어도(발행 화면에서 채워도) 국세청에는 빈칸으로 나갔다.
  //   업태·종목과 같은 규칙(계산서 값 우선 → 거래처 보조)으로 통일한다.
  const buyerCEO = invoice.counterparty_representative || partner?.representative || "";
  const buyerAddr = invoice.counterparty_address || partner?.address || "";
  const buyerBizType = invoice.counterparty_business_type || partner?.business_type || "";
  const buyerBizClass = invoice.counterparty_business_item || partner?.business_item || "";
  const buyerEmail = invoice.counterparty_email || partner?.contact_email || "";

  // CODEF 발행 API(/a/tax-invoice/regist-invoicer-trustee) 명세는 한글 코드값을 받는다.
  //   issueType "정발행"/"위수탁", taxType "과세"/"영세"/"면세", purposeType "영수"/"청구",
  //   invoiceeType "사업자"/"개인"/"외국인". (organization/connectedId/chargeDirection 미사용)
  const purposeType = (invoice.label || "").includes("청구") ? "청구" : "영수";
  // 공급받는자 구분: 사업자번호 10자리=사업자, 그 외 길이는 개인/외국인 대응(기본 사업자).
  const buyerNumDigits = String(buyerCorpNum || "").replace(/\D/g, "");
  const invoiceeType = buyerNumDigits.length === 13 ? "개인" : "사업자";

  const myCorpNum = (company.business_number || "").replace(/\D/g, "");
  void connectedId; // QA 2026-07-13: connectedId 는 발행 API 공식 명세에 없는 필드 — payload 에 넣으면 CF-05001(API 처리 오류) 유발 확인. 제거.
  return {
    corpNum: myCorpNum,         // 회원가입 완료 사업자번호 (CODEF 필수) = 발행 주체
    issueType: "정발행",        // 수정발행에서도 "정발행"/"위수탁" 중 택1 (명세 2026-04-22)
    // 수정발행 전용 항목 — 엔드포인트(REVISE_ISSUE_PATH)와 함께 이 둘이 수정분을 결정한다.
    ...(modification
      ? { modifyCode: modification.reasonCode, orgNTSConfirmNum: modification.originalConfirmNo }
      : {}),
    taxType: "과세",            // 영세/면세는 추후 invoice 유형 컬럼 연동
    purposeType,                // "영수"(결제완료) / "청구"
    sendToNtsYn: "N",           // 2026-07-22 CODEF(헥토데이터) 공식 안내: Y(즉시전송) 시 Codef 로직 버그로 CF-05001 반환.
                                //   N 이면 팝빌 정상 등록 후 다음 영업일 국세청 전송(승인번호는 전송 후 부여). CODEF "Y" 버그 수정 안내 오면 원복.
                                //   (7/16 N 실패는 당시 kwon/ho 누락이라는 별개 CF-05001 원인 때문 — 7/20 책번호 fix 후엔 sendToNtsYn 만 남은 원인.)
    writeDate,                  // YYYYMMDD
    // 책번호 — CODEF 공식 답변(2026-07-20): kwon/ho 미포함 시 서버 내부 변환 예외로
    //   CF-05001 발생. 정식 수정 배포 전까지 빈 문자열(문자열 타입)로 반드시 포함해야 함.
    //   CODEF 측 수정 반영 안내가 오면 제거 가능.
    kwon: "",
    ho: "",

    // 공급자 (회사 본인) — invoicerCorpNum 으로 발행 주체 식별
    invoicerCorpNum: (company.business_number || "").replace(/\D/g, ""),
    invoicerCorpName: company.name || "",
    invoicerCEOName: company.representative || "",
    invoicerAddr: company.address || "",
    invoicerBizType: company.business_type || "",       // 업태
    invoicerBizClass: company.business_category || "",   // 종목
    invoicerEmail,

    // 공급받는자
    invoiceeType,
    invoiceeCorpNum: buyerNumDigits,
    invoiceeCorpName: buyerCorpName,
    invoiceeCEOName: buyerCEO,
    invoiceeAddr: buyerAddr,
    invoiceeBizType: buyerBizType,       // 업태
    invoiceeBizClass: buyerBizClass,     // 종목
    invoiceeEmail1: buyerEmail,

    // 합계 (문자열)
    supplyCostTotal: supply,
    taxTotal: tax,
    totalAmount: total,

    // 품목 — 계산서 한 장에 여러 줄이 올 수 있다 (2026-08-10). items 가 비면 예전처럼 한 줄로 보낸다.
    //   2026-07-16 QA: invoice.label 은 영수/청구 토글값("영수"/"청구")이지 품목명이 아님 —
    //   item_name 미입력 건에서 품목명이 "청구"로 잘못 나가던 버그(purposeType 과 혼용).
    detailList: buildDetailList(invoice, writeDate, supply, tax),

    remark1: invoice.label || "",
  };
}

serve(withSentry("hometax-issue", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // CODEF 사용량 계측 — codefRequest 호출을 수집해 finally 에서 원장 적재 (fail-open)
  const meterStore = createMeterStore("hometax-issue");
  return await runWithMeter(meterStore, async () => {
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

    const body = await req.json();
    const { invoice_id, action } = body;
    if (action) meterStore.action = `hometax-${action}`;

    // ── 발행 등록(최초 1회): 팝빌 제휴사 회원가입 + 인증서 등록 URL 발급 ──
    //   발행 PDF 선행 절차. action='register-issuer', companyId 필요.
    if (action === "register-issuer") {
      const companyId = body.companyId;
      if (!companyId) {
        return new Response(JSON.stringify({ error: "companyId required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const { data: uRow } = await supabase.from("users").select("company_id, email").eq("auth_id", user.id).maybeSingle();
      if (!uRow || uRow.company_id !== companyId) {
        return new Response(JSON.stringify({ error: "권한이 없습니다." }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      meterStore.companyId = companyId;
      const { data: comp } = await supabase.from("companies").select("*").eq("id", companyId).maybeSingle();
      if (!comp?.business_number) {
        return new Response(JSON.stringify({ error: "회사 사업자등록번호가 없습니다. 설정 → 회사 정보에서 입력하세요." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      // QA 2026-07-13: 팝빌 join-member 는 상호/대표자/주소/업태/종목/전화번호를 전부 필수로 요구.
      //   회사 전화번호(phone) 미입력 시 빈 문자열 전송 → CF-00001(필수 파라미터 누락) → 인증서URL도 연쇄 실패.
      const missingFields = [
        !comp.name && "상호", !comp.representative && "대표자", !comp.address && "주소",
        !comp.business_type && "업태", !comp.business_category && "종목", !comp.phone && "전화번호",
      ].filter(Boolean);
      if (missingFields.length) {
        return new Response(JSON.stringify({
          error: `회사 정보가 비어 있어 발행 등록을 진행할 수 없습니다: ${missingFields.join(", ")} — 설정 → 회사 정보에서 입력 후 다시 시도하세요.`,
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const corpNum = String(comp.business_number).replace(/\D/g, "");
      const clientId0 = Deno.env.get("CODEF_CLIENT_ID");
      const clientSecret0 = Deno.env.get("CODEF_CLIENT_SECRET");
      if (!clientId0 || !clientSecret0) {
        return new Response(JSON.stringify({ error: "CODEF API 인증정보가 없습니다." }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      try {
        const token0 = await getCodefToken(clientId0, clientSecret0);
        // 1) 제휴사 회원가입 (이미 가입돼 있으면 code 로 구분 — 실패해도 cert-url 진행)
        const joinResp = await codefRequest(token0, "/v1/kr/public/a/pop-bill/join-member", {
          corpNum,
          CEOName: comp.representative || "",
          corpName: comp.name || "",
          corpAddress: comp.address || "",
          bizType: comp.business_type || "",
          bizClass: comp.business_category || "",
          contactName: comp.representative || comp.name || "담당자",
          contactTEL: comp.phone || "",
          contactEmail: comp.automation_settings?.invoicer_email || uRow.email || "",
          contactFAX: "",
        });
        const joinCode = joinResp?.data?.code ?? joinResp?.result?.code;
        // 2) 인증서 등록 URL 발급
        const certResp = await codefRequest(token0, "/v1/kr/public/a/pop-bill/tax-cert-url", { corpNum });
        const certURL = certResp?.data?.certURL || certResp?.data?.certUrl || certResp?.certURL || "";

        // 2026-07-16 QA: 성공 시엔 팝빌이 실제로 뭐라 응답했는지(회원가입/인증서URL 원본 result)가
        //   어디에도 안 남아 CF-05001 재현 시 대조할 방법이 없었음 — automation_settings 에 남겨둔다.
        await supabase.from("companies").update({
          automation_settings: {
            ...(comp.automation_settings || {}),
            codef_issuer_debug: {
              at: new Date().toISOString(),
              corpNum,
              codefEnv: CODEF_ENV,
              codefBase: CODEF_BASE,
              joinResult: joinResp?.result,
              certResult: certResp?.result,
              hadCertURL: !!certURL,
            },
          },
        }).eq("id", companyId).then(() => {}, () => {});

        if (!certURL) {
          const jc = joinResp?.result?.code, jm = joinResp?.result?.message || "";
          const cc = certResp?.result?.code, cm = certResp?.result?.message || "";
          const ce = certResp?.result?.extraMessage || "";
          return new Response(JSON.stringify({
            error: `인증서 URL 발급 실패 — 회원가입(${jc}: ${jm}) / 인증서URL(${cc}: ${cm}${ce ? " / " + ce : ""})`,
            joinResult: joinResp?.result, certResult: certResp?.result, certData: certResp?.data,
          }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        return new Response(JSON.stringify({
          success: true,
          joinCode,                 // "1"=가입(또는 이미가입)
          certURL,                  // 팝빌 인증서 등록 페이지 (Windows, 30초 유효)
          message: "인증서 등록 페이지로 이동하세요 (30초 이내). 등록 후 발행이 가능합니다.",
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (err: any) {
        return new Response(JSON.stringify({ error: "발행 등록 실패: " + (err.message || "") }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

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
    meterStore.companyId = invoice.company_id;

    // 3-0) 🚨 2026-07-20 인시던트 가드: CODEF가 CF-05001 오류를 반환해도 팝빌에서는
    //   실제 발행이 진행됨이 확인됨(같은 건 재시도 5회 → 실발행 5건, 팝빌 발행 안내 메일로 확인).
    //   CODEF가 원인 수정을 안내할 때까지 CF-05001 실패 건의 재발행을 차단한다.
    if (invoice.nts_error_code === "CF-05001") {
      return new Response(JSON.stringify({
        error: "재발행 차단: 이 건은 CF-05001로 실패 표시됐지만 실제로는 팝빌에서 발행됐을 가능성이 높습니다. 재시도하면 중복 발행됩니다.",
        hint: "다음날 홈택스 동기화로 실제 발행 여부(승인번호)를 확인한 뒤 처리하세요. CODEF 문의 진행 중.",
        code: "CF05001_REISSUE_BLOCKED",
      }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 3-1) 수정세금계산서(수정발행) 판정 + 전제조건 검증
    //   기존엔 이 분기가 없어 수정세금계산서도 issueType "정발행" 으로 전송됐다 —
    //   국세청에 잘못된 문서가 나가는 경로였으므로 여기서 반드시 걸러낸다.
    let modification: { originalConfirmNo: string; reasonCode: string } | null = null;
    if (invoice.original_invoice_id) {
      const { data: original } = await supabase
        .from("tax_invoices")
        .select("id, nts_confirm_no, nts_issue_status, counterparty_name")
        .eq("id", invoice.original_invoice_id)
        .maybeSingle();

      if (!original) {
        return new Response(JSON.stringify({
          error: "당초 세금계산서를 찾을 수 없습니다. 수정세금계산서를 발행할 수 없습니다.",
          code: "MODIFY_ORIGINAL_NOT_FOUND",
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      // 수정세금계산서는 당초 승인번호가 반드시 필요하다(국세청 필수 항목).
      const orgConfirmNo = normalizeNtsConfirmNum(original.nts_confirm_no);
      if (!original.nts_confirm_no) {
        return new Response(JSON.stringify({
          error: "당초 세금계산서에 국세청 승인번호가 없습니다. 원본이 홈택스에 실제 발행된 뒤에만 수정세금계산서를 발행할 수 있습니다.",
          hint: "원본이 아직 미발행(draft)이면 수정 대신 원본을 삭제·정정해 다시 발행하세요.",
          code: "MODIFY_ORIGINAL_NOT_ISSUED",
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const reasonCode = NTS_MODIFY_CODES[String(invoice.modification_reason || "")];
      if (!reasonCode) {
        return new Response(JSON.stringify({
          error: `수정사유가 올바르지 않습니다: ${invoice.modification_reason ?? "(없음)"}`,
          hint: `허용값: ${Object.keys(NTS_MODIFY_CODES).join(", ")}`,
          code: "MODIFY_REASON_INVALID",
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (orgConfirmNo.length !== 24) {
        return new Response(JSON.stringify({
          error: `당초 승인번호 형식이 올바르지 않습니다(24자리 필요, 현재 ${orgConfirmNo.length}자리).`,
          hint: "홈택스 동기화 값이 손상됐을 수 있습니다. 원본 세금계산서의 승인번호를 확인하세요.",
          code: "MODIFY_ORIGINAL_CONFIRM_NO_INVALID",
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      modification = { originalConfirmNo: orgConfirmNo, reasonCode };
    }

    // 3) 이미 발행된 건 중복 방지
    if (invoice.nts_issue_status === "issued" && invoice.nts_confirm_no) {
      return new Response(JSON.stringify({
        success: true, alreadyIssued: true,
        nts_confirm_no: invoice.nts_confirm_no,
        message: "이미 홈택스에 발행된 세금계산서입니다.",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 3.5) 요금제 발행 한도 — 세금계산서+현금영수증 합산 (2026-08-06 개편, NULL=무제한).
    //   체험 만료는 더 이상 차단 사유가 아니다(무료 플랜으로 강등되어 무료 한도가 적용됨).
    const { data: entRow } = await supabase
      .rpc("get_company_entitlement", { p_company_id: invoice.company_id })
      .maybeSingle();
    const planSlug = (entRow as any)?.effective_plan_slug || "free";
    const { data: planRow } = await supabase
      .from("subscription_plans")
      .select("name, monthly_tax_invoice_limit")
      .eq("slug", planSlug)
      .maybeSingle();
    const planLimit = planRow?.monthly_tax_invoice_limit;
    // 월 제공량 + 충전 잔액을 합쳐 판정한다 (2026-08-07 충전 도입).
    //   2026-08-11 요금제 개편: 한도가 합산 → 세금계산서·현금영수증 각각으로 분리 —
    //   issue_allowance(p_kind) 가 단일 소스. 충전 잔액은 종류 공용 주머니.
    const { data: allowance } = await supabase
      .rpc("issue_allowance", { p_company_id: invoice.company_id, p_kind: "tax" });
    const allow = (allowance || {}) as {
      unlimited?: boolean; allowed?: boolean; plan_remaining?: number; credits?: number;
    };
    if (!allow.unlimited && allow.allowed === false) {
      return new Response(JSON.stringify({
        error: `이번 달 세금계산서 발행 한도(${planLimit}건)를 모두 사용했습니다.`,
        hint: `${planRow?.name || "현재 요금제"}는 세금계산서를 월 ${planLimit}건까지 발행할 수 있습니다. 요금제 > 충전에서 발행 건수를 충전하면 이어서 발행할 수 있습니다.`,
        code: "PLAN_LIMIT_EXCEEDED",
      }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
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
    const payload = buildIssuePayload({ invoice, company, partner, invoicerEmail, connectedId, modification });
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
      codefResp = await codefRequest(token, modification ? REVISE_ISSUE_PATH : ISSUE_PATH, payload);
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
      // 승인번호 추출 — CODEF 발행 응답: ntsconfirmNum(24자리, 소문자 c). 폴백 다수 유지.
      //   2026-08-04: 하이픈 포함 형식(resApprovalNo 등 폴백)이 섞이면 codef-sync upsert 키와
      //   어긋나 같은 계산서가 중복 저장됨 → 저장 전 항상 정규화(영숫자만).
      const ntsConfirmNum = normalizeNtsConfirmNum(
        codefResp.data?.ntsconfirmNum ||
        codefResp.data?.ntsConfirmNum ||
        codefResp.data?.resIssueNum ||
        codefResp.data?.resApprovalNo ||
        codefResp.data?.resInvoiceNumber ||
        "");

      await supabase.from("tax_invoices").update({
        nts_issue_status: "issued",
        nts_confirm_no: ntsConfirmNum,
        nts_issued_at: new Date().toISOString(),
        nts_response_payload: codefResp,
        status: "issued",
        issue_date: invoice.issue_date || new Date().toISOString().split("T")[0],
        auto_issued: false,
      }).eq("id", invoice_id);

      // 충전 차감 — 월 제공량이 남아 있으면 함수가 아무것도 하지 않는다(사용 집계로 자동 반영).
      //   제공량을 다 쓴 뒤 발행한 건만 충전 잔액에서 1건 빠진다. 실패해도 발행은 이미 끝났으므로 막지 않는다.
      try {
        await supabase.rpc("consume_issue_credit", { p_company_id: invoice.company_id });
      } catch (e) {
        console.error("[credit] consume_issue_credit failed:", (e as Error)?.message);
      }

      return new Response(JSON.stringify({
        success: true,
        nts_confirm_no: ntsConfirmNum,
        message: ntsConfirmNum ? `홈택스 발행 완료 (승인번호: ${ntsConfirmNum})` : "홈택스 발행 완료",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 실패
    const errorMsg = codefResp?.result?.message || "발행 실패";
    const hint = codefErrorHint(resultCode);
    const { error: updErr } = await supabase.from("tax_invoices").update({
      nts_issue_status: "failed",
      nts_error_code: resultCode || "UNKNOWN",
      nts_error_message: errorMsg,
      // 2026-07-16 QA: CODEF_ENV/BASE 어느 환경으로 나갔는지 응답에 같이 남겨 sandbox
      //   폴백(문서에 없는 URL) 사용 여부를 즉시 대조할 수 있게 한다.
      nts_response_payload: { ...codefResp, _codefEnv: CODEF_ENV, _codefBase: CODEF_BASE },
    }).eq("id", invoice_id);

    return new Response(JSON.stringify({
      error: `발행 실패 (${resultCode}): ${errorMsg}`,
      code: resultCode,
      hint,
      // QA 2026-07-14: DB 기록 확인이 안 돼 update 에러 자체를 응답에 포함해 진단.
      dbUpdateError: updErr ? { message: updErr.message, code: (updErr as any).code, details: (updErr as any).details } : null,
      debugInvoiceId: invoice_id,
      debugPayloadSent: payload,
    }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } finally {
    // 사용량 원장 적재 — 실패해도 응답에 영향 없음 (내부 try/catch)
    await flushCodefUsage(meterStore);
  }
  });
}));
