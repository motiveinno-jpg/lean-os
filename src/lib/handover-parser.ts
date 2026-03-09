/**
 * Handover/Status Board Parser — 인수인계/현황판 엑셀 파서
 *
 * 기존 excel-parser.ts의 parseExcel() 호출로 기본 데이터 추출 후,
 * 추가 시트 스캔하여 딜/미수금/미지급/반복비용/직원 정보 추출.
 */
import * as XLSX from 'xlsx';
import { parseExcel, type ParsedExcelData, type ParsedItem } from './excel-parser';

// ── Types ──

export interface DetectedDeal {
  name: string;
  counterparty: string | null;
  amount: number;
  status: string;
  startDate: string | null;
  endDate: string | null;
  memo: string | null;
  _source: string; // 시트명
  _row: number;
}

export interface DetectedReceivable {
  counterparty: string;
  amount: number;
  dueDate: string | null;
  project: string | null;
  memo: string | null;
  _source: string;
}

export interface DetectedPayable {
  name: string;
  amount: number;
  dueDate: string | null;
  category: string | null;
  memo: string | null;
  _source: string;
}

export interface DetectedRecurringItem {
  name: string;
  amount: number;
  category: string | null;
  recipientName: string | null;
  memo: string | null;
  _source: string;
}

export interface DetectedEmployeeBasic {
  name: string;
  department: string | null;
  position: string | null;
  salary: number;
  memo: string | null;
  _source: string;
}

export interface HandoverParseResult {
  excelData: ParsedExcelData | null;
  detectedDeals: DetectedDeal[];
  detectedReceivables: DetectedReceivable[];
  detectedPayables: DetectedPayable[];
  detectedRecurring: DetectedRecurringItem[];
  detectedEmployees: DetectedEmployeeBasic[];
  parseLog: string[];
}

// ── 키워드 기반 시트 분류 ──

const DEAL_SHEET_KW = ['프로젝트', '거래처', '계약', '딜', '수주', '진행'];
const DEAL_HEADER_KW = ['프로젝트명', '거래처', '계약금액', '상태', '시작일', '종료일', '담당자'];

const HR_SHEET_KW = ['인사', '직원', '급여', '인력', '조직'];
const HR_HEADER_KW = ['이름', '부서', '직급', '급여', '연봉'];

const RECURRING_SHEET_KW = ['고정비', '반복', '월비용', '운영비'];
const RECURRING_HEADER_KW = ['항목', '금액', '주기', '수취인', '비고'];

const ACCOUNT_KW = ['미수금', '미지급', '외상', '채권', '채무', '입금예정', '지출예정'];

// ── Helpers ──

function num(v: any): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[,₩원\s]/g, ''));
  return isNaN(n) ? 0 : n;
}

function str(v: any): string {
  return String(v ?? '').trim();
}

function parseDate(val: any): string | null {
  if (!val) return null;
  if (typeof val === 'number') {
    if (val < 40000) return null;
    const utcDays = Math.floor(val) - 25569;
    const d = new Date(utcDays * 86400000);
    return d.toISOString().split('T')[0];
  }
  const s = String(val).trim();
  const m = s.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return null;
}

function matchesAny(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some(kw => lower.includes(kw.toLowerCase()));
}

function findHeaderRow(rows: any[][]): { index: number; cols: string[] } {
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    const row = rows[i];
    if (row && row.filter(c => c !== '' && c != null).length >= 3) {
      return { index: i, cols: row.map((c: any) => str(c)) };
    }
  }
  return { index: 0, cols: (rows[0] || []).map((c: any) => str(c)) };
}

function findCol(headers: string[], keywords: string[]): number {
  for (let i = 0; i < headers.length; i++) {
    if (matchesAny(headers[i], keywords)) return i;
  }
  return -1;
}

// ── Category 추론 ──

const CATEGORY_MAP: Record<string, string[]> = {
  rent: ['임차', '임대', '월세', '관리비', '사무실'],
  insurance: ['보험', '4대보험', '국민연금', '건강보험'],
  salary: ['급여', '인건비', '월급', '상여'],
  utility: ['전기', '수도', '가스', '통신', '인터넷'],
  subscription: ['구독', 'SaaS', '클라우드'],
  tax: ['세금', '부가세', '법인세'],
  accounting: ['세무', '회계', '기장'],
  marketing: ['광고', '마케팅'],
};

function guessCategory(name: string): string | null {
  const lower = name.toLowerCase();
  for (const [cat, kws] of Object.entries(CATEGORY_MAP)) {
    if (kws.some(k => lower.includes(k.toLowerCase()))) return cat;
  }
  return null;
}

// ── Main Parser ──

export function parseHandoverDoc(buffer: ArrayBuffer): HandoverParseResult {
  const log: string[] = [];

  // 1) 기존 CEO 보고서 파서로 기본 데이터 추출 시도
  let excelData: ParsedExcelData | null = null;
  try {
    excelData = parseExcel(buffer);
    log.push('기존 파서로 기본 데이터 추출 완료');
    log.push(`  월별 데이터: ${excelData.months.length}개월, 항목: ${excelData.items.length}개`);
  } catch {
    log.push('기존 파서 호출 실패 (CEO 보고서 형식 아님 — 인수인계 전용 파싱 진행)');
  }

  // 2) 전체 시트 스캔
  const wb = XLSX.read(buffer, { type: 'array' });
  log.push(`전체 시트 ${wb.SheetNames.length}개: ${wb.SheetNames.join(', ')}`);

  const detectedDeals: DetectedDeal[] = [];
  const detectedReceivables: DetectedReceivable[] = [];
  const detectedPayables: DetectedPayable[] = [];
  const detectedRecurring: DetectedRecurringItem[] = [];
  const detectedEmployees: DetectedEmployeeBasic[] = [];

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as any[][];
    if (rows.length < 2) continue;

    const { index: hIdx, cols: headers } = findHeaderRow(rows);
    const headerStr = headers.join(' ').toLowerCase();
    const sheetNameLower = sheetName.toLowerCase();

    // ── 딜/프로젝트 시트 ──
    if (matchesAny(sheetNameLower, DEAL_SHEET_KW) || matchesAny(headerStr, DEAL_HEADER_KW)) {
      const nameCol = findCol(headers, ['프로젝트명', '프로젝트', '건명', '딜명', '거래건']);
      const cpCol = findCol(headers, ['거래처', '거래처명', '업체', '고객사', '발주처']);
      const amtCol = findCol(headers, ['계약금액', '금액', '수주금액', '총액', '계약액']);
      const statusCol = findCol(headers, ['상태', '진행상태', '단계', '진행']);
      const startCol = findCol(headers, ['시작일', '계약일', '수주일']);
      const endCol = findCol(headers, ['종료일', '완료일', '납기일', '마감일']);
      const memoCol = findCol(headers, ['비고', '메모', '참고']);

      if (nameCol >= 0 || cpCol >= 0) {
        for (let i = hIdx + 1; i < rows.length; i++) {
          const r = rows[i];
          const name = str(r[nameCol >= 0 ? nameCol : cpCol]);
          if (!name) continue;
          detectedDeals.push({
            name,
            counterparty: cpCol >= 0 ? str(r[cpCol]) || null : null,
            amount: amtCol >= 0 ? num(r[amtCol]) : 0,
            status: statusCol >= 0 ? str(r[statusCol]) || '진행중' : '진행중',
            startDate: startCol >= 0 ? parseDate(r[startCol]) : null,
            endDate: endCol >= 0 ? parseDate(r[endCol]) : null,
            memo: memoCol >= 0 ? str(r[memoCol]) || null : null,
            _source: sheetName,
            _row: i + 1,
          });
        }
        log.push(`  [${sheetName}] 딜/프로젝트 ${detectedDeals.length}건 감지`);
      }
    }

    // ── 직원/인사 시트 ──
    if (matchesAny(sheetNameLower, HR_SHEET_KW) || matchesAny(headerStr, HR_HEADER_KW)) {
      const nameCol = findCol(headers, ['이름', '성명', '직원명']);
      const deptCol = findCol(headers, ['부서', '부서명', '소속']);
      const posCol = findCol(headers, ['직급', '직위', '직책']);
      const salaryCol = findCol(headers, ['급여', '기본급', '월급', '연봉']);
      const memoCol = findCol(headers, ['비고', '메모', '참고']);

      if (nameCol >= 0) {
        for (let i = hIdx + 1; i < rows.length; i++) {
          const r = rows[i];
          const name = str(r[nameCol]);
          if (!name) continue;
          let salary = salaryCol >= 0 ? num(r[salaryCol]) : 0;
          // 연봉인 경우 (1200만원 이상) → 월급 변환
          if (salary >= 12000000) salary = Math.round(salary / 12);
          detectedEmployees.push({
            name,
            department: deptCol >= 0 ? str(r[deptCol]) || null : null,
            position: posCol >= 0 ? str(r[posCol]) || null : null,
            salary,
            memo: memoCol >= 0 ? str(r[memoCol]) || null : null,
            _source: sheetName,
          });
        }
        log.push(`  [${sheetName}] 직원 ${detectedEmployees.length}명 감지`);
      }
    }

    // ── 고정비/반복비용 시트 ──
    if (matchesAny(sheetNameLower, RECURRING_SHEET_KW) || matchesAny(headerStr, RECURRING_HEADER_KW)) {
      const nameCol = findCol(headers, ['항목', '항목명', '비용명', '내용', '적요']);
      const amtCol = findCol(headers, ['금액', '월금액', '비용', '월비용']);
      const recipCol = findCol(headers, ['수취인', '거래처', '업체']);
      const memoCol = findCol(headers, ['비고', '메모', '참고']);

      if (nameCol >= 0 && amtCol >= 0) {
        for (let i = hIdx + 1; i < rows.length; i++) {
          const r = rows[i];
          const name = str(r[nameCol]);
          const amount = num(r[amtCol]);
          if (!name || amount <= 0) continue;
          detectedRecurring.push({
            name,
            amount,
            category: guessCategory(name),
            recipientName: recipCol >= 0 ? str(r[recipCol]) || null : null,
            memo: memoCol >= 0 ? str(r[memoCol]) || null : null,
            _source: sheetName,
          });
        }
        log.push(`  [${sheetName}] 반복비용 ${detectedRecurring.length}건 감지`);
      }
    }

    // ── 미수금/미지급 (인라인 감지 — 시트명 또는 헤더에 키워드) ──
    if (matchesAny(sheetNameLower, ACCOUNT_KW) || matchesAny(headerStr, ACCOUNT_KW)) {
      const cpCol = findCol(headers, ['거래처', '거래처명', '업체', '고객사', '항목', '항목명']);
      const amtCol = findCol(headers, ['금액', '잔액', '미수금', '미지급', '미수', '미지급액']);
      const dateCol = findCol(headers, ['예정일', '기한', '입금예정', '지급예정', '만기일']);
      const projCol = findCol(headers, ['프로젝트', '건명', '관련딜']);
      const memoCol = findCol(headers, ['비고', '메모', '참고']);

      const isReceivable = matchesAny(sheetNameLower + ' ' + headerStr, ['미수', '채권', '입금예정', '매출']);

      if (cpCol >= 0 && amtCol >= 0) {
        for (let i = hIdx + 1; i < rows.length; i++) {
          const r = rows[i];
          const cp = str(r[cpCol]);
          const amount = num(r[amtCol]);
          if (!cp || amount <= 0) continue;

          if (isReceivable) {
            detectedReceivables.push({
              counterparty: cp,
              amount,
              dueDate: dateCol >= 0 ? parseDate(r[dateCol]) : null,
              project: projCol >= 0 ? str(r[projCol]) || null : null,
              memo: memoCol >= 0 ? str(r[memoCol]) || null : null,
              _source: sheetName,
            });
          } else {
            detectedPayables.push({
              name: cp,
              amount,
              dueDate: dateCol >= 0 ? parseDate(r[dateCol]) : null,
              category: guessCategory(cp),
              memo: memoCol >= 0 ? str(r[memoCol]) || null : null,
              _source: sheetName,
            });
          }
        }
        log.push(`  [${sheetName}] ${isReceivable ? '미수금' : '미지급'} ${isReceivable ? detectedReceivables.length : detectedPayables.length}건 감지`);
      }
    }
  }

  // 3) 기존 parseExcel 항목에서 미수금/미지급 추출 (현금시제기준 시트)
  if (excelData) {
    for (const item of excelData.items) {
      if (item.category === 'receivable' && item.amount > 0) {
        // 이미 추출된 것과 중복 체크
        const exists = detectedReceivables.some(r => r.counterparty === item.name && r.amount === item.amount);
        if (!exists) {
          detectedReceivables.push({
            counterparty: item.name,
            amount: item.amount,
            dueDate: item.dueDate,
            project: item.projectName,
            memo: null,
            _source: '현금시제기준',
          });
        }
      }
      if ((item.category === 'expense' || item.category === 'fixed_cost') && item.amount > 0) {
        if (item.category === 'fixed_cost') {
          const exists = detectedRecurring.some(r => r.name === item.name && r.amount === item.amount);
          if (!exists) {
            detectedRecurring.push({
              name: item.name,
              amount: item.amount,
              category: guessCategory(item.name),
              recipientName: null,
              memo: null,
              _source: '현금시제기준',
            });
          }
        } else {
          const exists = detectedPayables.some(p => p.name === item.name && p.amount === item.amount);
          if (!exists) {
            detectedPayables.push({
              name: item.name,
              amount: item.amount,
              dueDate: item.dueDate,
              category: guessCategory(item.name),
              memo: null,
              _source: '현금시제기준',
            });
          }
        }
      }
    }
  }

  log.push('');
  log.push(`총 감지: 딜 ${detectedDeals.length}건, 미수금 ${detectedReceivables.length}건, 미지급 ${detectedPayables.length}건, 반복비용 ${detectedRecurring.length}건, 직원 ${detectedEmployees.length}명`);

  return {
    excelData,
    detectedDeals,
    detectedReceivables,
    detectedPayables,
    detectedRecurring,
    detectedEmployees,
    parseLog: log,
  };
}
