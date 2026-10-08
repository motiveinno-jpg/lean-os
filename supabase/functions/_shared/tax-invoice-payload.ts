// 전자세금계산서 발행 payload 공용 모듈 — CODEF 발행 API(/v1/kr/public/a/tax-invoice/regist-invoicer-trustee)
//   hometax-issue(오너뷰 회사가 자기 명의로 발행)와 issue-request-public(발행 요청을 받은 비회원 공급자가
//   링크 화면에서 발행)이 같은 규칙으로 payload 를 만들게 한 곳에 둔다.
//   ⚠️ Deno·URL import 를 쓰지 않는 순수 모듈이다 — vitest(src/lib/__tests__)가 직접 불러 검증한다.

// 국세청 승인번호 정규화 — CODEF 는 24자리 영숫자를 요구한다.
//   홈택스 동기화로 들어온 값은 화면 표기형(8-8-8, 하이픈 2개 = 26자)이라 그대로 보내면 거부된다.
//   실데이터 확인(2026-07-27): 승인번호 보유 1,806건 전부 하이픈 제거 시 정확히 24자리.
//     · 동기화분 1,805건 = 26자 하이픈형 (예: 20250501-10250502-27435031)
//     · CODEF 발행분 1건 = 24자 그대로 (예: 202607224100020300002561)
export function normalizeNtsConfirmNum(v: string | null | undefined): string {
  return String(v || "").replace(/[^0-9A-Za-z]/g, "");
}

// 안전 변환: yyyy-mm-dd → yyyymmdd
export function toYmd(d: string | null): string {
  // KST 오늘: UTC 면 KST 새벽 발행의 작성일자가 전날(월경계면 전월)로 전송됐다.
  if (!d) return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10).replaceAll("-", "");
  return d.replaceAll("-", "").slice(0, 8);
}

/** 품목 줄 만들기 — tax_invoices.items(줄 배열)를 CODEF detailList 로. 비어 있으면 한 줄로 폴백. */
// deno-lint-ignore no-explicit-any
export function buildDetailList(invoice: any, writeDate: string, supply: string, tax: string) {
  const items = Array.isArray(invoice.items) ? invoice.items : [];
  if (items.length > 0) {
    //   줄 세액은 **과세일 때만** 매긴다(영세율·면세는 합계 세액 0 → 줄도 0).
    //   ★ 과세 판정은 tax!==0 — 음수 세액(수정·환입 계산서)도 과세다. 예전엔 tax>0 이라
    //     마이너스 계산서의 줄 세액이 0 이 돼 '상세 세액 합계≠총세액'으로 홈택스가 거부했다 (2026-09-01).
    const taxable = Number(tax) !== 0;
    // deno-lint-ignore no-explicit-any
    const lines = items.map((it: any, i: number) => {
      const lineSupply = Math.round(Number(it.supplyAmount ?? (Number(it.qty || 1) * Number(it.unitCost || 0))) || 0);
      //   줄마다 거래일자를 따로 적을 수 있다(홈택스 서식의 '월/일' 칸). 안 적으면 작성일자를 쓴다.
      //   연도는 작성일자를 따른다 — 홈택스도 월·일만 받는다.
      const mm = String(it.month ?? "").replace(/[^0-9]/g, "").padStart(2, "0");
      const dd = String(it.day ?? "").replace(/[^0-9]/g, "").padStart(2, "0");
      const lineDate = (mm !== "00" && dd !== "00" && mm.length === 2 && dd.length === 2)
        ? `${writeDate.slice(0, 4)}${mm}${dd}`
        : writeDate;
      return {
        serialNum: String(i + 1),
        purchaseDT: lineDate,
        itemName: String(it.name || "").trim() || "용역",
        spec: String(it.spec || ""),
        qty: String(it.qty ?? 1),
        unitCost: String(Math.round(Number(it.unitCost || 0))),
        supplyCost: String(lineSupply),
        tax: taxable ? Math.round(lineSupply * 0.1) : 0,
        remark: String(it.remark || ""),
      };
    });
    //   ★ 줄 세액 합계를 총세액과 **정확히** 맞춘다 — 다줄 반올림 오차를 마지막 줄이 흡수한다.
    //     홈택스는 상세 세액 합계와 총세액이 1원이라도 다르면 거부한다.
    if (taxable && lines.length > 0) {
      // deno-lint-ignore no-explicit-any
      const sum = lines.reduce((s: number, l: any) => s + l.tax, 0);
      lines[lines.length - 1].tax += Number(tax) - sum;
    }
    // deno-lint-ignore no-explicit-any
    return lines.map((l: any) => ({ ...l, tax: String(l.tax) }));
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
export function buildIssuePayload(args: {
  // deno-lint-ignore no-explicit-any
  invoice: any;
  // deno-lint-ignore no-explicit-any
  company: any;
  // deno-lint-ignore no-explicit-any
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
  // 2026-08-10 대표 지적으로 발견 — 대표자·주소·이메일만 **등록된 거래처에서만** 읽고 있었다.
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
  void connectedId; // connectedId 는 발행 API 공식 명세에 없는 필드 — payload 에 넣으면 CF-05001(API 처리 오류) 유발 확인. 제거.
  return {
    corpNum: myCorpNum,         // 회원가입 완료 사업자번호 (CODEF 필수) = 발행 주체
    issueType: "정발행",        // 수정발행에서도 "정발행"/"위수탁" 중 택1 (명세 2026-04-22)
    // 수정발행 전용 항목 — 엔드포인트(REVISE_ISSUE_PATH)와 함께 이 둘이 수정분을 결정한다.
    ...(modification
      ? { modifyCode: modification.reasonCode, orgNTSConfirmNum: modification.originalConfirmNo }
      : {}),
    //   과세형태 — 계산서 자신이 들고 있는 tax_kind 를 그대로 따른다 (2026-08-13).
    //   ★ 예전엔 "과세" 하드코딩이었다. 발행 폼에는 과세/영세율/면세 칸이 있었으므로
    //     **'면세'로 골라 만든 건이 국세청에는 과세 세금계산서로 나가고 있었다.**
    //     화면은 「전자계산서」라고 그려 주는데(상세 팝업 baseTitle) 실제 발행물이 달랐다.
    //     면세 = 전자계산서, 영세 = 영세율 전자세금계산서. 줄 세액은 buildDetailList 가 0 으로 맞춘다.
    taxType: invoice.tax_kind === "exempt" ? "면세" : invoice.tax_kind === "zero_rated" ? "영세" : "과세",
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

    //   계산서 비고 — 사람이 적은 '전체 비고'. 예전엔 label(영수/청구 토글)이 들어가
    //   국세청 비고란에 "청구" 가 찍혔다. remark 가 비면 비고 없이 보낸다.
    remark1: String(invoice.remark || "").trim(),
  };
}

// ── 세금계산서 발행 요청(tax_invoice_requests) → 발행 payload ──────────────────────────
//   요청 회사(받는 쪽)가 미리 채운 내용을, 공급자가 링크 화면에서 입력한 자기 정보와 합쳐
//   buildIssuePayload 가 읽는 계산서 모양으로 바꾼다. 공급자 사업자번호는 **요청에 적힌 값만** 쓴다
//   (화면이 보낸 값은 믿지 않는다 — 남의 사업자번호로 발행하는 통로가 되지 않게).

/** 요청 품목 한 줄 — 화면·DB(tax_invoice_requests.items) 공통 모양 */
export type RequestItemRow = {
  name?: string | null;
  spec?: string | null;
  qty?: number | string | null;
  unit_price?: number | string | null;
  supply_amount?: number | string | null;
  tax_amount?: number | string | null;
};

/** 공급자가 링크 화면에서 입력한 자기 회사 정보 (tax_invoice_requests.supplier_profile) */
export type SupplierProfile = {
  corp_name: string;
  ceo_name: string;
  addr: string;
  biz_type: string;
  biz_class: string;
  tel?: string;
  email: string;
  contact_name?: string;
};

/** 국세청 비고란 — 발주번호를 앞에 붙인다. 150자를 넘기면 자른다(홈택스 비고 한도).
 *  ⚠️ src/lib/tax-invoice-request.ts 의 requestRemark 와 같은 규칙이어야 한다(테스트가 대조한다). */
export function requestRemarkText(poNumber: string | null | undefined, memo: string | null | undefined): string {
  const parts = [
    String(poNumber || "").trim() ? `발주번호 ${String(poNumber).trim()}` : "",
    String(memo || "").trim(),
  ].filter(Boolean);
  return parts.join(" / ").slice(0, 150);
}

/** 요청 품목 → 계산서 품목(tax_invoices.items 모양). 이름 없는 줄은 뺀다. */
export function requestItemsToInvoiceItems(items: RequestItemRow[] | null | undefined) {
  return (Array.isArray(items) ? items : [])
    .filter((it) => String(it?.name || "").trim())
    .map((it) => {
      const qty = Number(it.qty) || 1;
      const unitCost = Math.round(Number(it.unit_price) || 0);
      const supplyAmount = it.supply_amount != null && it.supply_amount !== ""
        ? Math.round(Number(it.supply_amount) || 0)
        : Math.round(qty * unitCost);
      return { name: String(it.name).trim(), spec: String(it.spec || "").trim(), qty, unitCost, supplyAmount, remark: "" };
    });
}

/** 요청 한 건 + 공급자 정보 → buildIssuePayload 인자 */
export function requestToIssueArgs(
  // deno-lint-ignore no-explicit-any
  request: any,
  profile: SupplierProfile,
  writeDate: string,
) {
  const invoice = {
    issue_date: writeDate,
    supply_amount: request.supply_amount,
    tax_amount: request.tax_amount,
    total_amount: request.total_amount,
    tax_kind: request.tax_kind,
    label: request.purpose,
    counterparty_bizno: request.buyer_business_number,
    counterparty_name: request.buyer_name,
    counterparty_representative: request.buyer_representative,
    counterparty_address: request.buyer_address,
    counterparty_business_type: request.buyer_business_type,
    counterparty_business_item: request.buyer_business_item,
    counterparty_email: request.buyer_email,
    items: requestItemsToInvoiceItems(request.items),
    item_name: request.title || null,
    remark: requestRemarkText(request.po_number, request.memo),
  };
  const company = {
    business_number: String(request.supplier_business_number || "").replace(/\D/g, ""),
    name: profile.corp_name,
    representative: profile.ceo_name,
    address: profile.addr,
    business_type: profile.biz_type,
    business_category: profile.biz_class,
  };
  return { invoice, company, partner: null, invoicerEmail: profile.email, connectedId: "" };
}
