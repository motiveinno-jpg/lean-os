/**
 * Excel Export — xlsx 패키지 활용 다운로드 유틸
 */
import { todayKst } from '@/lib/kst';
import * as XLSX from 'xlsx';

export function exportToExcel(
  data: Array<Record<string, unknown>>,
  sheetName: string,
  fileName: string,
) {
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, `${fileName}.xlsx`);
}

export function exportFinancialReport(
  months: Array<{ month: string; revenue: number; expense: number; netIncome: number }>,
  fileName?: string,
) {
  const rows = months.map(m => ({
    '월': m.month,
    '매출': m.revenue,
    '비용': m.expense,
    '순이익': m.netIncome,
  }));
  exportToExcel(rows, '재무현황', fileName || `재무리포트_${todayKst()}`);
}

export function exportDrillDownItems(
  items: Array<{ name: string; category: string; amount: number; status: string; due_date: string | null }>,
  month: string,
) {
  const rows = items.map(i => ({
    '항목': i.name,
    '구분': i.category,
    '금액': i.amount,
    '상태': i.status,
    '만기일': i.due_date || '-',
  }));
  exportToExcel(rows, month, `재무상세_${month}`);
}

// 회계 프로그램 업로드용 거래내역 엑셀 (xlsx). 더존 CSV 와 컬럼 동일.
export interface BankTxExcelRow {
  transaction_date: string;
  amount: number | string;
  type: string; // income / expense
  counterparty: string | null;
  description: string | null;
  category?: string | null;
  classification?: string | null;
  balance_after?: number | string | null;
  bank_accounts?: { alias?: string | null; bank_name?: string | null } | null;
}

export function exportBankTransactionsExcel(rows: BankTxExcelRow[], periodLabel: string) {
  const data = rows.map(t => {
    const amt = Math.abs(Number(t.amount || 0));
    const isIncome = t.type === 'income' || t.type === '입금';
    return {
      '일자': t.transaction_date || '',
      '통장': t.bank_accounts?.alias || t.bank_accounts?.bank_name || '',
      '거래처': t.counterparty || '',
      '적요': t.description || '',
      '분류': t.classification || t.category || '',
      '입금': isIncome ? amt : '',
      '출금': !isIncome ? amt : '',
      '잔액': t.balance_after != null ? Number(t.balance_after) : '',
    };
  });
  exportToExcel(data, '통장거래내역', `통장거래내역_${periodLabel}`);
}
