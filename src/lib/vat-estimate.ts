// 부가세 납부 예상 — 앱 전체가 이 한 함수의 값을 쓴다.
//
//   예전엔 화면마다 기준이 달랐다. 세무 신고 › 부가세(신고서 준비)는 확정 매입매출전표,
//   경영 요약·자금 전망·월별 흐름(이번 달)은 세금계산서 + 현금영수증 − 카드 공제 추정(getVATPreview),
//   월별 흐름(월별 표)·분석 › 부가세 › 기간별 집계는 세금계산서 매출세액 − 매입세액만 — 같은 신고분이 세 값으로 보였다.
//
//   기준: 확정 매입매출전표(journal_entries entry_kind=sale_purchase, status=confirmed)의 부가세 유형 — 신고서 준비(VatReturn 결정 60)와 같다.
//     원본 자료(홈택스 세금계산서·카드)가 아니라 장부에 올린 것만 신고서에 가므로, 예상액도 신고서에 적힐 숫자를 따라간다.
//     카드 매입세액은 카드 전표(57)가 되어야 공제로 잡힌다 — 원본 기준의 '카드 공제 추정'을 따로 빼지 않는다.
//   신고기간: 분기(1기 예정 1–3월 · 1기 확정 4–6월 · 2기 예정 7–9월 · 2기 확정 10–12월). 확정 신고는 예정분을 뺀 3개월만(결정 61).
//   전표로 아직 안 옮긴 세금계산서는 여기 없다 — unpostedInvoices 로 건수를 같이 돌려 화면이 "빠진 것"을 적게 한다.

import { supabase } from "@/lib/supabase";
import { fetchPaged } from "@/lib/fetch-paged";
import { summarizeByVatType } from "@/lib/vat-voucher";

/** 화면 표기 — 값이 나오는 모든 자리에서 같은 이름을 쓴다 */
export const VAT_ESTIMATE_LABEL = "부가세 납부 예상";
export const VAT_ESTIMATE_BASIS = "확정 매입매출전표 기준";

export type VatQuarterKey = "1p" | "1c" | "2p" | "2c";
export type VatEstimate = {
  year: number;
  /** VatReturn 의 신고기간 키와 같다 */
  key: VatQuarterKey;
  /** "2026-Q3" — 옛 getVATPreview 와 같은 표기 */
  quarter: string;
  /** "2기 예정" */
  periodLabel: string;
  from: string; to: string;
  /** 신고·납부 기한 */
  dueDate: string;
  salesVat: number;
  /** 공제 매입세액 (51·57·61). 불공제(54)는 빠진다 */
  deductibleVat: number;
  /** 납부(+) / 환급(−) 예상 = salesVat − deductibleVat */
  payable: number;
  /** 이 기간 확정 매입매출전표 건수 */
  vouchers: number;
  /** 이 기간 발행일인데 전표가 없는 세금계산서 건수 — 예상액에서 빠져 있다 */
  unpostedInvoices: number;
};

const Q: { key: VatQuarterKey; label: string; from: string; to: string }[] = [
  { key: "1p", label: "1기 예정", from: "01-01", to: "03-31" },
  { key: "1c", label: "1기 확정", from: "04-01", to: "06-30" },
  { key: "2p", label: "2기 예정", from: "07-01", to: "09-30" },
  { key: "2c", label: "2기 확정", from: "10-01", to: "12-31" },
];
const DUE = ["04-25", "07-25", "10-25", "01-25"];

type VoucherRow = { entry_date: string; vat_type: string | null; supply_amount: number | null; vat_amount: number | null; linked_invoice_id?: string | null };

/** 순수 계산 — 한 해 전표·미처리 계산서 발행일 → 분기별 예상 */
export function vatEstimatesFromRows(year: number, rows: VoucherRow[], unpostedIssueDates: string[] = []): VatEstimate[] {
  return Q.map((q, i) => {
    const from = `${year}-${q.from}`, to = `${year}-${q.to}`;
    const inQ = rows.filter((r) => r.entry_date >= from && r.entry_date <= to);
    const s = summarizeByVatType(inQ);
    return {
      year, key: q.key, quarter: `${year}-Q${i + 1}`, periodLabel: q.label, from, to,
      dueDate: `${i === 3 ? year + 1 : year}-${DUE[i]}`,
      salesVat: Math.round(s.salesVat), deductibleVat: Math.round(s.purchaseVat), payable: Math.round(s.payable),
      vouchers: inQ.length,
      unpostedInvoices: unpostedIssueDates.filter((d) => d >= from && d <= to).length,
    };
  });
}

/** 한 해 네 분기 — 분석 › 부가세 · 월별 흐름이 쓴다 */
export async function getVatEstimates(companyId: string, year: number): Promise<VatEstimate[]> {
  const from = `${year}-01-01`, to = `${year}-12-31`;
  const [rows, unposted] = await Promise.all([
    fetchPaged<VoucherRow>("vat-estimate:vouchers", () => (supabase as any).from("journal_entries")
      .select("id, entry_date, vat_type, supply_amount, vat_amount, linked_invoice_id")
      .eq("company_id", companyId).eq("entry_kind", "sale_purchase").eq("status", "confirmed")
      .gte("entry_date", from).lte("entry_date", to)
      .order("entry_date").order("id"), 50000),
    //   분석 › 부가세 › 증빙 누락 점검의 '전표 없는 세금계산서'와 같은 조건
    fetchPaged<{ id: string; issue_date: string }>("vat-estimate:unposted", () => (supabase as any).from("tax_invoices")
      .select("id, issue_date")
      .eq("company_id", companyId).is("journal_entry_id", null).neq("status", "void")
      .gte("issue_date", from).lte("issue_date", to)
      .order("issue_date").order("id"), 50000),
  ]);
  //   전표 쪽에만 연결(linked_invoice_id)이 남은 계산서도 전표가 있는 것이다 — 빠진 건수에서 뺀다
  const linked = new Set(rows.map((r) => r.linked_invoice_id).filter(Boolean) as string[]);
  return vatEstimatesFromRows(year, rows, unposted.filter((r) => !linked.has(r.id)).map((r) => String(r.issue_date || "").slice(0, 10)));
}

/** 납부일이 남은 것 — 1월엔 전년 2기 확정(1/25)이 코앞이라 전년도까지 본다. 경영 요약·자금 전망이 쓴다 */
export async function getVatEstimatesAround(companyId: string, year: number): Promise<VatEstimate[]> {
  const [a, b] = await Promise.all([getVatEstimates(companyId, year - 1), getVatEstimates(companyId, year)]);
  return [...a, ...b];
}
