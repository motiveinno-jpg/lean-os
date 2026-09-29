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

/**
 * 줄 모양 그대로(머리 줄 + 값 줄, 빈 줄로 단락 구분) 엑셀로 — 손익계산서·재무상태표처럼
 *   항목마다 칸 수가 다른 보고서용. 숫자는 숫자 칸으로 들어가 엑셀에서 바로 합계가 된다.
 */
export function exportRowsToExcel(
  rows: Array<Array<string | number | null>>,
  sheetName: string,
  fileName: string,
) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, `${fileName}.xlsx`);
}

/**
 * csv-export.downloadCsv 와 같은 모양(파일명 · 머리 줄 · 값 줄)으로 **진짜 .xlsx** 를 내려받는다.
 *   버튼 이름이 '엑셀'인 곳은 이것을 쓴다 — 이름은 엑셀인데 .csv 가 내려오면 파일 형식이 거짓말을 한다.
 *   xlsx 는 글자 칸을 수식으로 읽지 않으므로 CSV 의 '=·+·-·@' 막기(작은따옴표)가 필요 없다.
 */
export function downloadXlsx(fileName: string, header: string[], rows: Array<Array<string | number>>, sheetName = "자료") {
  exportRowsToExcel([header, ...rows], sheetName, fileName.replace(/\.(csv|xlsx)$/i, ""));
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

// 회계 프로그램 업로드용 거래내역 엑셀 (xlsx). 회계 프로그램 CSV 와 컬럼 동일.
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
