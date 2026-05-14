// 더존(Douzone) Smart-A / 위하고 양식 export — Granter 의 더존 export 벤치마킹
// 거래내역 / 세금계산서 / 카드내역 → 더존 양식 CSV 다운로드
//
// 더존 양식 표준:
// - euc-kr 인코딩 (한국 회계 SW 호환). 단 브라우저 다운로드라 BOM+UTF-8 도 안전.
// - 콤마 구분, 큰따옴표 escape.
// - 날짜는 YYYY-MM-DD 또는 YYYYMMDD.

function escapeCsv(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function downloadCsv(filename: string, lines: string[]) {
  // UTF-8 BOM — 엑셀에서 한글 깨짐 방지
  const bom = '﻿';
  const content = bom + lines.join('\n');
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── 1. 통장 거래내역 export (더존 분개 양식 호환) ──
export interface BankTxExport {
  transaction_date: string;
  amount: number | string;
  type: string;             // income / expense
  counterparty: string | null;
  description: string | null;
  category?: string | null;
  classification?: string | null;
  bank_accounts?: { alias?: string; bank_name?: string } | null;
}

export function exportBankTransactionsDouzone(rows: BankTxExport[], periodLabel?: string) {
  const lines = [
    '일자,통장,거래처,적요,분류,입금,출금,비고',
  ];
  for (const t of rows) {
    const date = t.transaction_date || '';
    const bank = t.bank_accounts?.alias || t.bank_accounts?.bank_name || '';
    const cp = t.counterparty || '';
    const memo = t.description || '';
    const category = t.classification || t.category || '';
    const amt = Math.abs(Number(t.amount || 0));
    const isIncome = t.type === 'income' || t.type === '입금';
    const income = isIncome ? amt : 0;
    const expense = !isIncome ? amt : 0;
    lines.push([
      escapeCsv(date), escapeCsv(bank), escapeCsv(cp), escapeCsv(memo), escapeCsv(category),
      escapeCsv(income || ''), escapeCsv(expense || ''), '',
    ].join(','));
  }
  const fname = `통장거래내역_더존_${periodLabel || new Date().toISOString().slice(0, 10)}.csv`;
  downloadCsv(fname, lines);
}

// ── 2. 세금계산서 export (더존 매출/매입처원장) ──
export interface TaxInvoiceExport {
  issue_date: string;
  nts_confirm_no?: string | null;
  type: string;             // sales / purchase
  counterparty_name: string | null;
  counterparty_bizno: string | null;
  supply_amount: number | string | null;
  tax_amount: number | string | null;
  total_amount: number | string | null;
  item_name?: string | null;
  status?: string | null;
}

export function exportTaxInvoicesDouzone(rows: TaxInvoiceExport[], periodLabel?: string) {
  const lines = [
    '발행일,승인번호,구분,거래처명,사업자번호,품목,공급가액,세액,합계,상태',
  ];
  for (const inv of rows) {
    lines.push([
      escapeCsv(inv.issue_date || ''),
      escapeCsv(inv.nts_confirm_no || ''),
      escapeCsv(inv.type === 'sales' ? '매출' : inv.type === 'purchase' ? '매입' : inv.type),
      escapeCsv(inv.counterparty_name || ''),
      escapeCsv(inv.counterparty_bizno || ''),
      escapeCsv(inv.item_name || ''),
      escapeCsv(Number(inv.supply_amount || 0)),
      escapeCsv(Number(inv.tax_amount || 0)),
      escapeCsv(Number(inv.total_amount || 0)),
      escapeCsv(inv.status || ''),
    ].join(','));
  }
  const fname = `세금계산서_더존_${periodLabel || new Date().toISOString().slice(0, 10)}.csv`;
  downloadCsv(fname, lines);
}

// ── 3. 카드내역 export ──
export interface CardTxExport {
  transaction_date: string;
  transaction_time?: string | null;
  amount: number | string;
  merchant_name?: string | null;
  category?: string | null;
  card_name?: string | null;
  classification?: string | null;
}

export function exportCardTransactionsDouzone(rows: CardTxExport[], periodLabel?: string) {
  const lines = [
    '일자,시각,카드,가맹점,업종,분류,금액',
  ];
  for (const t of rows) {
    lines.push([
      escapeCsv(t.transaction_date || ''),
      escapeCsv(t.transaction_time || ''),
      escapeCsv(t.card_name || ''),
      escapeCsv(t.merchant_name || ''),
      escapeCsv(t.category || ''),
      escapeCsv(t.classification || ''),
      escapeCsv(Number(t.amount || 0)),
    ].join(','));
  }
  const fname = `카드내역_더존_${periodLabel || new Date().toISOString().slice(0, 10)}.csv`;
  downloadCsv(fname, lines);
}
