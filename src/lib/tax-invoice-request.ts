// 세금계산서 발행 요청 — 받는 쪽(요청 회사)이 내용을 미리 채워 공급자에게 링크로 보내고,
//   공급자는 작성일만 넣고 **자기 명의로** 발행한다(세금계산서는 공급자가 발행하는 문서다).
//
//   흐름
//     요청 회사  : 세금·증빙 › 발행 요청 탭에서 쓰고 보낸다 → tax_invoice_requests 한 줄 + 메일(send-issue-request-email)
//     공급자     : 메일 링크(/issue-request?token=…)
//                  · 오너뷰 회사면 → 세금·증빙 › 받은 발행 요청 에서 hometax-issue 로 발행 → issue_request_mark_issued
//                  · 아니면 (가) 홈택스 직접 발행 후 승인번호 입력(issue_request_mark_manual)
//                         (나) 링크 화면에서 인증서 등록 후 바로 발행(issue-request-public)
//     연결       : 요청 회사의 매입 계산서가 홈택스 수집으로 들어오면 DB 트리거가 승인번호로 묶는다
//
//   이 파일은 화면 공용 계산·검증과 DB 호출만 갖는다. 테이블은 생성 타입에 아직 없어 any 로 부른다.

import { supabase } from "./supabase";
import { logRead } from "./log-read";
import { fetchPaged } from "./fetch-paged";
import type { TaxInvoiceItem } from "./tax-invoice";

export type RequestTaxKind = "taxable" | "zero_rated" | "exempt";
export type RequestPurpose = "영수" | "청구";
export type RequestStatus = "sent" | "viewed" | "issued" | "canceled";
export type IssuedVia = "ownerview" | "popbill_public" | "hometax_manual";

export type RequestItem = {
  name: string;
  spec: string;
  qty: number;
  unit_price: number;
  supply_amount: number;
  tax_amount: number;
};

export type TaxInvoiceRequest = {
  id: string;
  company_id: string;
  partner_id: string | null;
  supplier_business_number: string;
  supplier_name: string;
  supplier_representative: string | null;
  supplier_email: string;
  supplier_company_id: string | null;
  title: string | null;
  po_number: string | null;
  items: RequestItem[];
  supply_amount: number;
  tax_amount: number;
  total_amount: number;
  tax_kind: RequestTaxKind;
  purpose: RequestPurpose;
  pay_bank_text: string | null;
  pay_due_date: string | null;
  memo: string | null;
  buyer_name: string | null;
  buyer_business_number: string | null;
  buyer_representative: string | null;
  buyer_address: string | null;
  buyer_business_type: string | null;
  buyer_business_item: string | null;
  buyer_email: string | null;
  token: string;
  status: RequestStatus;
  write_date: string | null;
  issued_at: string | null;
  issued_via: IssuedVia | null;
  nts_confirm_no: string | null;
  supplier_invoice_id: string | null;
  purchase_invoice_id: string | null;
  viewed_at: string | null;
  last_sent_at: string | null;
  created_at: string;
  expires_at: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

// ── 계산 ────────────────────────────────────────────────────────────────

/** 줄 금액 — 공급가액 = 수량×단가(원 단위 반올림), 세액 = 과세 10% · 영세율·면세 0 */
export function calcRequestLine(qty: number, unitPrice: number, taxKind: RequestTaxKind): { supply: number; tax: number } {
  const supply = Math.round((Number(qty) || 0) * (Number(unitPrice) || 0));
  const tax = taxKind === "taxable" ? Math.round(supply * 0.1) : 0;
  return { supply, tax };
}

/** 합계 — 줄마다 고친 값(공급가액·세액)을 그대로 더한다. 이름 없는 줄은 뺀다. */
export function sumRequestItems(items: Pick<RequestItem, "name" | "supply_amount" | "tax_amount">[]): { supply: number; tax: number; total: number } {
  let supply = 0, tax = 0;
  for (const it of items) {
    if (!String(it.name || "").trim()) continue;
    supply += Math.round(Number(it.supply_amount) || 0);
    tax += Math.round(Number(it.tax_amount) || 0);
  }
  return { supply, tax, total: supply + tax };
}

/** 국세청 비고란 — 발주번호를 앞에 붙인다(150자 한도).
 *  ⚠️ supabase/functions/_shared/tax-invoice-payload.ts 의 requestRemarkText 와 같은 규칙(테스트가 대조). */
export function requestRemark(poNumber: string | null | undefined, memo: string | null | undefined): string {
  const parts = [
    String(poNumber || "").trim() ? `발주번호 ${String(poNumber).trim()}` : "",
    String(memo || "").trim(),
  ].filter(Boolean);
  return parts.join(" / ").slice(0, 150);
}

/** 요청 품목 → 공급자 쪽 계산서 품목(tax_invoices.items). 이름 없는 줄은 뺀다. */
export function requestItemsToTaxInvoiceItems(items: RequestItem[] | null | undefined): TaxInvoiceItem[] {
  return (items || [])
    .filter((it) => String(it?.name || "").trim())
    .map((it) => ({
      name: String(it.name).trim(),
      spec: String(it.spec || "").trim(),
      qty: Number(it.qty) || 1,
      unitCost: Math.round(Number(it.unit_price) || 0),
      supplyAmount: Math.round(Number(it.supply_amount) || 0),
      remark: "",
    }));
}

// ── 검증 ────────────────────────────────────────────────────────────────

export const digitsOnly = (v: string | null | undefined) => String(v || "").replace(/\D/g, "");

/** 사업자번호 보기 좋게 — 123-45-67890 */
export function formatBizNo(v: string | null | undefined): string {
  const d = digitsOnly(v);
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}` : String(v || "");
}

/** 승인번호 정규화 — 하이픈·공백을 빼고 영숫자만 */
export function normalizeConfirmNo(v: string | null | undefined): string {
  return String(v || "").replace(/[^0-9A-Za-z]/g, "");
}

/** 승인번호 보기 좋게 — 8-8-8 */
export function formatConfirmNo(v: string | null | undefined): string {
  const n = normalizeConfirmNo(v);
  return n.length === 24 ? `${n.slice(0, 8)}-${n.slice(8, 16)}-${n.slice(16)}` : String(v || "");
}

/** 국세청 승인번호 확인 — 하이픈을 빼고 24자리 영숫자, 앞 8자리는 작성일자(YYYYMMDD).
 *  운영 데이터 3,063건 전부 앞 8자리 = 작성일자였다. 틀리면 이유를 돌려준다. */
export function validateConfirmNo(raw: string, writeDate: string | null | undefined): string | null {
  const n = normalizeConfirmNo(raw);
  if (!n) return "국세청 승인번호를 입력해 주세요.";
  if (n.length !== 24) return `승인번호는 하이픈을 빼고 24자리입니다 (지금 ${n.length}자리).`;
  const ymd = String(writeDate || "").replace(/-/g, "");
  if (ymd.length === 8 && n.slice(0, 8) !== ymd) {
    return "승인번호 앞 8자리는 작성일자와 같아야 합니다. 작성일자나 승인번호를 다시 확인해 주세요.";
  }
  return null;
}

/** 작성일자 확인 — YYYY-MM-DD, 오늘(KST)보다 늦으면 안 된다 */
export function validateWriteDate(writeDate: string | null | undefined, todayKst: string): string | null {
  const v = String(writeDate || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) return "작성일자를 입력해 주세요.";
  if (v > todayKst) return "작성일자는 오늘보다 늦을 수 없습니다.";
  return null;
}

export const isEmail = (v: string | null | undefined) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v || "").trim());

// ── 상태 ────────────────────────────────────────────────────────────────

export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = {
  sent: "보냄", viewed: "열람", issued: "발행됨", canceled: "취소",
};
export const ISSUED_VIA_LABEL: Record<IssuedVia, string> = {
  ownerview: "오너뷰", popbill_public: "링크 화면", hometax_manual: "홈택스 직접",
};
export const TAX_KIND_LABEL: Record<RequestTaxKind, string> = {
  taxable: "과세", zero_rated: "영세율", exempt: "면세",
};

export function isRequestExpired(r: Pick<TaxInvoiceRequest, "status" | "expires_at">, now = Date.now()): boolean {
  return (r.status === "sent" || r.status === "viewed") && !!r.expires_at && Date.parse(r.expires_at) < now;
}

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.owner-view.com").replace(/\/$/, "");
export function issueRequestLink(token: string): string {
  return `${SITE}/issue-request?token=${encodeURIComponent(token)}`;
}

// ── DB ──────────────────────────────────────────────────────────────────

const LIST_COLS = "*";

/** 우리가 보낸 요청 — 회사 전체라 페이징 */
export async function listSentRequests(companyId: string): Promise<TaxInvoiceRequest[]> {
  return fetchPaged<TaxInvoiceRequest>("taxInvoiceRequests.sent", () => db
    .from("tax_invoice_requests").select(LIST_COLS)
    .eq("company_id", companyId)
    .order("created_at", { ascending: false }).order("id", { ascending: false }), 10000);
}

/** 우리가 받은 요청 — 공급자로 지정된 것 */
export async function listReceivedRequests(companyId: string): Promise<TaxInvoiceRequest[]> {
  return fetchPaged<TaxInvoiceRequest>("taxInvoiceRequests.received", () => db
    .from("tax_invoice_requests").select(LIST_COLS)
    .eq("supplier_company_id", companyId)
    .order("created_at", { ascending: false }).order("id", { ascending: false }), 10000);
}

export async function countOpenReceivedRequests(companyId: string): Promise<number> {
  const { count } = await db.from("tax_invoice_requests")
    .select("id", { count: "exact", head: true })
    .eq("supplier_company_id", companyId)
    .in("status", ["sent", "viewed"]);
  return count || 0;
}

export type NewRequestInput = {
  companyId: string;
  partnerId: string | null;
  supplierBusinessNumber: string;
  supplierName: string;
  supplierRepresentative: string;
  supplierEmail: string;
  title: string;
  poNumber: string;
  items: RequestItem[];
  taxKind: RequestTaxKind;
  purpose: RequestPurpose;
  payBankText: string;
  payDueDate: string;
  memo: string;
};

/** 요청 저장 — 받는 쪽(우리 회사) 정보는 DB 트리거가 회사 정보에서 채운다(화면 값을 믿지 않는다). */
export async function createIssueRequest(input: NewRequestInput): Promise<TaxInvoiceRequest> {
  const items = input.items.filter((it) => String(it.name || "").trim()).map((it) => ({
    name: it.name.trim(), spec: (it.spec || "").trim(),
    qty: Number(it.qty) || 0, unit_price: Math.round(Number(it.unit_price) || 0),
    supply_amount: Math.round(Number(it.supply_amount) || 0), tax_amount: Math.round(Number(it.tax_amount) || 0),
  }));
  const sum = sumRequestItems(items);
  const { data, error } = await db.from("tax_invoice_requests").insert({
    company_id: input.companyId,
    partner_id: input.partnerId,
    supplier_business_number: digitsOnly(input.supplierBusinessNumber),
    supplier_name: input.supplierName.trim(),
    supplier_representative: input.supplierRepresentative.trim() || null,
    supplier_email: input.supplierEmail.trim(),
    title: input.title.trim() || null,
    po_number: input.poNumber.trim() || null,
    items,
    supply_amount: sum.supply,
    tax_amount: sum.tax,
    total_amount: sum.total,
    tax_kind: input.taxKind,
    purpose: input.purpose,
    pay_bank_text: input.payBankText.trim() || null,
    pay_due_date: input.payDueDate || null,
    memo: input.memo.trim() || null,
  }).select(LIST_COLS).single();
  if (error) throw error;
  return data as TaxInvoiceRequest;
}

/** 요청 메일 보내기(처음·다시) */
export async function sendIssueRequestEmail(requestId: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke("send-issue-request-email", { body: { requestId } });
  if (error) {
    // functions.invoke 는 2xx 가 아니면 본문을 error.context 에 싣는다
    let msg = "";
    try { msg = (await (error as { context?: Response }).context?.json())?.error || ""; } catch { /* 무시 */ }
    throw new Error(msg || error.message || "메일을 보내지 못했습니다");
  }
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
}

export async function cancelIssueRequest(requestId: string): Promise<void> {
  const { data, error } = await db.from("tax_invoice_requests")
    .update({ status: "canceled" }).eq("id", requestId).in("status", ["sent", "viewed"]).select("id");
  if (error) throw error;
  if (!data?.length) throw new Error("이미 발행됐거나 취소된 요청입니다.");
}

/** 공급자(오너뷰 회사)가 발행을 끝낸 뒤 요청에 그 계산서를 묶는다 */
export async function markRequestIssued(requestId: string, supplierInvoiceId: string): Promise<void> {
  const { error } = await db.rpc("issue_request_mark_issued", { p_request_id: requestId, p_supplier_invoice_id: supplierInvoiceId });
  if (error) throw error;
}

// ── 공개 링크 화면 ──────────────────────────────────────────────────────

/** 토큰으로 읽은 요청(공개 RPC issue_request_by_token 결과) */
export type PublicRequest = {
  state: "open" | "issued" | "canceled" | "expired";
  request_id: string | null;
  is_supplier_member: boolean;
  buyer_name: string | null;
  buyer_business_number?: string | null;
  buyer_representative?: string | null;
  buyer_address?: string | null;
  buyer_business_type?: string | null;
  buyer_business_item?: string | null;
  buyer_email?: string | null;
  supplier_business_number?: string;
  supplier_name?: string;
  supplier_representative?: string | null;
  supplier_email?: string;
  title?: string | null;
  po_number?: string | null;
  items?: RequestItem[];
  supply_amount?: number;
  tax_amount?: number;
  total_amount?: number;
  tax_kind?: RequestTaxKind;
  purpose?: RequestPurpose;
  pay_bank_text?: string | null;
  pay_due_date?: string | null;
  memo?: string | null;
  write_date?: string | null;
  issued_at?: string | null;
  issued_via?: IssuedVia | null;
  nts_confirm_no?: string | null;
  expires_at?: string;
  supplier_profile?: Record<string, string> | null;
  public_issue_status?: "pending" | "failed" | "issued" | null;
};

export async function loadRequestByToken(token: string): Promise<PublicRequest | null> {
  const { data, error } = await db.rpc("issue_request_by_token", { p_token: token });
  if (error) throw error;
  return (data || null) as PublicRequest | null;
}

export async function markRequestManual(token: string, writeDate: string, confirmNo: string): Promise<void> {
  const { error } = await db.rpc("issue_request_mark_manual", {
    p_token: token, p_write_date: writeDate, p_nts_confirm_no: normalizeConfirmNo(confirmNo),
  });
  if (error) throw error;
}
