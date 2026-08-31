import type { QueryClient } from "@tanstack/react-query";

// 세금계산서(tax_invoices) 변경 후 캐시 일괄 무효화 (2026-08-31 낡은정보 스윕).
//   발행·수정·삭제·동기화가 자기 화면 키만 지워서, 거래처 원장·미수 에이징·경영 요약·자금 전망·
//   수집 현황이 최소 1분(staleTime) 동안 옛 숫자를 보여줬다. tax_invoices 를 읽는 키 전부를
//   한 곳에 모은다 — 새 화면이 이 테이블을 읽기 시작하면 여기 키를 추가할 것.
const TAX_INVOICE_READER_KEYS = [
  "tax-invoices-full", "tax-invoices", "tax-invoice-issuance-status", "tax-invoice-quota", "ti-wait-outside", "e-invoices",
  "partner-ledger", "partner-ledger-names", "ledger-aging-rows", "ledger-ar-aging", "ledger-sheet-inv", "partner-detail-inv",
  "biz-summary", "cash-outlook", "dash-receivables", "summary-receivable", "overdue-invoices",
  "flow-invoice-summary", "flow-receivable", "pnl-status", "pnl-status-ar", "pnl-monthly",
  "collect-status", "collect-rows", "bank-open-invoices", "bank-line-invoices",
  "founder-data", "projecthub-pnl", "three-way-invoices", "pb-doc-invoices",
];

export function invalidateTaxInvoiceReaders(qc: QueryClient): void {
  for (const k of TAX_INVOICE_READER_KEYS) qc.invalidateQueries({ queryKey: [k] });
}
