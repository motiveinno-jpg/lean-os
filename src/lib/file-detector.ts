/**
 * File Detector — Import Hub 파일 유형 자동 감지
 *
 * CSV 헤더 / XLSX 시트명 / 컬럼 패턴으로 파일 유형을 판별.
 * 순수 함수 — DB 의존성 없음.
 */
import * as XLSX from 'xlsx';

export type DetectedFileType =
  | 'bank_csv'
  | 'card_csv'
  | 'hometax_excel'
  | 'ceo_report_excel'
  | 'flex_hr_excel'
  | 'handover_excel'
  | 'unknown';

export interface FileDetectionResult {
  type: DetectedFileType;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  sheetNames?: string[];
  headers?: string[];
}

// ── CSV 감지 (헤더 키워드 기반) ──

const BANK_CSV_KEYWORDS = ['거래일', '적요', '출금', '입금', '잔액', '거래후잔액', '거래점', '취급점', '기재내용', '거래시간'];
const CARD_CSV_KEYWORDS = ['승인일', '가맹점', '카드번호', '승인번호', '결제금액', '이용금액', '할부', '매입상태', '승인금액'];

function detectCSV(text: string): FileDetectionResult {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length < 2) return { type: 'unknown', confidence: 'low', reason: 'CSV 데이터 부족' };

  const header = lines[0].replace(/"/g, '').toLowerCase();
  const headerCols = header.split(',').map(h => h.trim());

  const bankHits = BANK_CSV_KEYWORDS.filter(kw => headerCols.some(h => h.includes(kw.toLowerCase())));
  const cardHits = CARD_CSV_KEYWORDS.filter(kw => headerCols.some(h => h.includes(kw.toLowerCase())));

  if (bankHits.length >= 3) {
    return { type: 'bank_csv', confidence: bankHits.length >= 4 ? 'high' : 'medium', reason: `은행 CSV 키워드 ${bankHits.length}개 매칭: ${bankHits.join(', ')}`, headers: headerCols };
  }
  if (cardHits.length >= 3) {
    return { type: 'card_csv', confidence: cardHits.length >= 4 ? 'high' : 'medium', reason: `카드 CSV 키워드 ${cardHits.length}개 매칭: ${cardHits.join(', ')}`, headers: headerCols };
  }

  return { type: 'unknown', confidence: 'low', reason: `CSV 헤더 패턴 불일치 (은행 ${bankHits.length}, 카드 ${cardHits.length})`, headers: headerCols };
}

// ── XLSX 감지 (시트명 + 첫 행 패턴) ──

const HOMETAX_SHEET_KW = ['세금계산서', '매출', '매입', '전자세금', '합계표'];
const HOMETAX_HEADER_KW = ['거래처명', '사업자번호', '공급가액', '세액', '발행일', '작성일자', '상호', '사업자등록번호'];

const CEO_REPORT_SHEET_KW = ['자금예산현황', '현금시제기준', '실적보고서'];

const FLEX_SHEET_KW = ['구성원', '직원', '사원', '인사', '급여', 'HR', 'Employee'];
const FLEX_HEADER_KW = ['사원번호', '이름', '성명', '부서', '직급', '입사일', '기본급', '연봉', '계좌번호', '은행', '재직상태'];

const HANDOVER_SHEET_KW = ['인수인계', '현황', '프로젝트', '거래처', '계약', '매출', '매입', '고정비', '자산'];
const HANDOVER_HEADER_KW = ['거래처', '금액', '상태', '프로젝트명', '계약금액', '입금예정', '지출예정', '담당자', '비고'];

function detectXLSX(buffer: ArrayBuffer): FileDetectionResult {
  const wb = XLSX.read(buffer, { type: 'array' });
  const sheetNames = wb.SheetNames;
  const sheetNamesLower = sheetNames.map(n => n.toLowerCase());

  // 첫 번째 시트의 첫 행 헤더 추출
  const firstSheet = wb.Sheets[sheetNames[0]];
  const firstRows = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: '' }) as any[][];
  const headerRow = findHeaderRow(firstRows);
  const headers = headerRow.map(h => String(h || '').trim().toLowerCase());

  // 1) 홈택스 세금계산서
  const hometaxSheetHits = HOMETAX_SHEET_KW.filter(kw => sheetNamesLower.some(n => n.includes(kw.toLowerCase())));
  const hometaxHeaderHits = HOMETAX_HEADER_KW.filter(kw => headers.some(h => h.includes(kw.toLowerCase())));
  if (hometaxHeaderHits.length >= 3) {
    return { type: 'hometax_excel', confidence: hometaxHeaderHits.length >= 4 ? 'high' : 'medium', reason: `홈택스 헤더 ${hometaxHeaderHits.length}개 매칭: ${hometaxHeaderHits.join(', ')}`, sheetNames, headers };
  }
  if (hometaxSheetHits.length >= 1 && hometaxHeaderHits.length >= 2) {
    return { type: 'hometax_excel', confidence: 'medium', reason: `홈택스 시트 "${hometaxSheetHits[0]}" + 헤더 ${hometaxHeaderHits.length}개`, sheetNames, headers };
  }

  // 2) CEO 보고자료 (자금예산현황 + 현금시제기준)
  const ceoSheetHits = CEO_REPORT_SHEET_KW.filter(kw => sheetNames.some(n => n.includes(kw)));
  if (ceoSheetHits.length >= 2) {
    return { type: 'ceo_report_excel', confidence: 'high', reason: `CEO 보고서 시트 ${ceoSheetHits.length}개 매칭: ${ceoSheetHits.join(', ')}`, sheetNames, headers };
  }
  if (ceoSheetHits.length === 1) {
    return { type: 'ceo_report_excel', confidence: 'medium', reason: `CEO 보고서 시트 "${ceoSheetHits[0]}" 감지`, sheetNames, headers };
  }

  // 3) 플렉스 HR
  const flexSheetHits = FLEX_SHEET_KW.filter(kw => sheetNamesLower.some(n => n.includes(kw.toLowerCase())));
  const flexHeaderHits = FLEX_HEADER_KW.filter(kw => headers.some(h => h.includes(kw.toLowerCase())));
  if (flexHeaderHits.length >= 3) {
    return { type: 'flex_hr_excel', confidence: flexHeaderHits.length >= 5 ? 'high' : 'medium', reason: `Flex HR 헤더 ${flexHeaderHits.length}개 매칭: ${flexHeaderHits.join(', ')}`, sheetNames, headers };
  }
  if (flexSheetHits.length >= 1 && flexHeaderHits.length >= 2) {
    return { type: 'flex_hr_excel', confidence: 'medium', reason: `Flex 시트 "${flexSheetHits[0]}" + 헤더 ${flexHeaderHits.length}개`, sheetNames, headers };
  }

  // 4) 인수인계/현황판 (가장 느슨한 기준 — fallback)
  const handoverSheetHits = HANDOVER_SHEET_KW.filter(kw => sheetNamesLower.some(n => n.includes(kw.toLowerCase())));
  const handoverHeaderHits = HANDOVER_HEADER_KW.filter(kw => headers.some(h => h.includes(kw.toLowerCase())));
  if (handoverSheetHits.length >= 2 || handoverHeaderHits.length >= 3) {
    const totalHits = handoverSheetHits.length + handoverHeaderHits.length;
    return { type: 'handover_excel', confidence: totalHits >= 5 ? 'high' : 'medium', reason: `현황판 시트 ${handoverSheetHits.length}개 + 헤더 ${handoverHeaderHits.length}개`, sheetNames, headers };
  }
  if (handoverSheetHits.length >= 1 || handoverHeaderHits.length >= 2) {
    return { type: 'handover_excel', confidence: 'low', reason: `현황판 추정 (시트 ${handoverSheetHits.length}, 헤더 ${handoverHeaderHits.length})`, sheetNames, headers };
  }

  return { type: 'unknown', confidence: 'low', reason: '파일 유형을 자동 감지할 수 없습니다', sheetNames, headers };
}

// 첫 5행 중 비어있지 않은 행을 헤더로 추정
function findHeaderRow(rows: any[][]): any[] {
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    const row = rows[i];
    if (row && row.filter(c => c !== '' && c != null).length >= 3) return row;
  }
  return rows[0] || [];
}

// ── Public API ──

export async function detectFileType(file: File): Promise<FileDetectionResult> {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';

  if (ext === 'csv' || ext === 'tsv') {
    const text = await file.text();
    return detectCSV(text);
  }

  if (ext === 'xlsx' || ext === 'xls') {
    const buffer = await file.arrayBuffer();
    return detectXLSX(buffer);
  }

  return { type: 'unknown', confidence: 'low', reason: `지원하지 않는 확장자: .${ext}` };
}

// 감지 유형의 한글 라벨
export const FILE_TYPE_LABELS: Record<DetectedFileType, { label: string; icon: string; color: string }> = {
  bank_csv: { label: '은행 거래내역 CSV', icon: '🏦', color: 'text-blue-600 bg-blue-50' },
  card_csv: { label: '법인카드 CSV', icon: '💳', color: 'text-purple-600 bg-purple-50' },
  hometax_excel: { label: '홈택스 세금계산서', icon: '🧾', color: 'text-emerald-600 bg-emerald-50' },
  ceo_report_excel: { label: 'CEO 보고자료', icon: '📊', color: 'text-amber-600 bg-amber-50' },
  flex_hr_excel: { label: 'Flex HR 직원정보', icon: '👥', color: 'text-indigo-600 bg-indigo-50' },
  handover_excel: { label: '인수인계/현황판', icon: '📋', color: 'text-rose-600 bg-rose-50' },
  unknown: { label: '알 수 없는 파일', icon: '❓', color: 'text-gray-500 bg-gray-50' },
};
