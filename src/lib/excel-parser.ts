/**
 * Excel Importer v1 — CEO 보고 엑셀 파서
 *
 * 대표님 보고자료_모티브 통합 엑셀 구조 기반.
 * 완벽 정규화 금지. Founder 지표 최소치 우선.
 *
 * 추출 대상:
 * A) 월 고정비 (월 burn) ← 자금예산현황
 * B) 월별 예상 입금/지출 ← 자금예산현황 + 현금시제기준
 * C) 월별 매출/실적 ← 자금예산현황 + 실적보고서
 * D) 미수금/승인대기 항목 ← 현금시제기준
 */
import * as XLSX from 'xlsx';

export interface ParsedExcelData {
  months: ParsedMonth[];
  items: ParsedItem[];
  bankBalance: number;
  summary: {
    currentMonth: string;
    totalIncome: number;
    totalExpense: number;
    fixedCost: number;
    variableCost: number;
    netCashflow: number;
    revenue: number;
    bankBalance: number;
  };
  parseLog: string[];
}

export interface ParsedMonth {
  month: string;  // YYYY-MM
  totalIncome: number;
  totalExpense: number;
  fixedCost: number;
  variableCost: number;
  netCashflow: number;
  revenue: number;
  bankBalance: number;
}

export interface ParsedItem {
  category: 'income' | 'expense' | 'receivable' | 'payable' | 'fixed_cost';
  name: string;
  amount: number;
  dueDate: string | null;
  status: 'pending' | 'confirmed' | 'overdue' | 'paid';
  projectName: string | null;
  accountType: string | null;
  month: string;
}

// Month label to YYYY-MM mapping
function parseMonthLabel(label: string): string | null {
  // "26.01월" → "2026-01", "25.12월" → "2025-12"
  const m = label.match(/(\d{2})\.(\d{2})월/);
  if (m) return `20${m[1]}-${m[2]}`;
  // "2026.01월"
  const m2 = label.match(/(\d{4})\.(\d{2})월/);
  if (m2) return `${m2[1]}-${m2[2]}`;
  return null;
}

function excelDateToISO(serial: number): string | null {
  if (!serial || serial < 40000) return null;
  const utcDays = Math.floor(serial) - 25569;
  const d = new Date(utcDays * 86400000);
  return d.toISOString().split('T')[0];
}

export function parseExcel(buffer: ArrayBuffer): ParsedExcelData {
  const wb = XLSX.read(buffer, { type: 'array' });
  const log: string[] = [];
  const months: ParsedMonth[] = [];
  const items: ParsedItem[] = [];
  let bankBalance = 0;

  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  // ═══ A) 자금예산현황 시트 파싱 ═══
  const cfSheet = findSheet(wb, ['자금예산현황 (2)', '자금예산현황']);
  if (cfSheet) {
    log.push('✅ 자금예산현황 시트 발견');
    const data = XLSX.utils.sheet_to_json(cfSheet, { header: 1, defval: '' }) as any[][];

    // Find header row (contains "월별" and month labels)
    let headerRow = -1;
    for (let i = 0; i < Math.min(50, data.length); i++) {
      const row = data[i];
      if (row && row[0] === '월별' && row[2] && String(row[2]).includes('월')) {
        headerRow = i;
        break;
      }
    }

    if (headerRow >= 0) {
      const headers = data[headerRow];
      const monthCols: { col: number; month: string }[] = [];

      for (let c = 2; c < headers.length; c++) {
        const label = String(headers[c] || '');
        const parsed = parseMonthLabel(label);
        if (parsed) monthCols.push({ col: c, month: parsed });
      }
      log.push(`  월 컬럼 ${monthCols.length}개 발견`);

      // Read rows after header
      const rowMap: Record<string, any[]> = {};
      for (let i = headerRow + 1; i < Math.min(headerRow + 20, data.length); i++) {
        const row = data[i];
        if (row && row[0] && typeof row[0] === 'string') {
          rowMap[row[0].trim()] = row;
        }
      }

      for (const mc of monthCols) {
        const pm: ParsedMonth = {
          month: mc.month,
          totalIncome: num(rowMap['수입액총액']?.[mc.col]),
          totalExpense: Math.abs(num(rowMap['지출액총액']?.[mc.col])),
          fixedCost: Math.abs(num(rowMap['고정비용']?.[mc.col])),
          variableCost: Math.abs(num(rowMap['변동비용']?.[mc.col])),
          netCashflow: num(rowMap['순이익']?.[mc.col]),
          revenue: num(rowMap['매출액(예상+확정)']?.[mc.col]),
          bankBalance: num(rowMap['통장월말잔액']?.[mc.col]),
        };
        months.push(pm);
      }
      log.push(`  월별 데이터 ${months.length}개 추출 완료`);
    } else {
      log.push('⚠️ 자금예산현황 헤더를 찾지 못했습니다');
    }
  } else {
    log.push('⚠️ 자금예산현황 시트를 찾지 못했습니다');
  }

  // ═══ B) 현금시제기준 시트 파싱 (가장 최근 월) ═══
  const cashSheetName = wb.SheetNames.find(n => n.includes('현금시제기준') && n.includes('26.'));
  if (cashSheetName) {
    log.push(`✅ 현금시제 시트 발견: ${cashSheetName}`);
    const cashSheet = wb.Sheets[cashSheetName];
    const data = XLSX.utils.sheet_to_json(cashSheet, { header: 1, defval: '' }) as any[][];

    // Extract month from sheet name
    const sheetMonthMatch = cashSheetName.match(/(\d{2})\.(\d{2})월/);
    const sheetMonth = sheetMonthMatch ? `20${sheetMonthMatch[1]}-${sheetMonthMatch[2]}` : currentMonth;

    // Find bank balance (통장잔액) - usually row 4, col 9
    for (let i = 0; i < Math.min(20, data.length); i++) {
      const row = data[i];
      if (row) {
        for (let c = 0; c < row.length; c++) {
          const cell = String(row[c] || '');
          if (cell.includes('기업은행') && cell.includes('통장') || cell.includes('법인통장 잔액')) {
            bankBalance = num(row[9]) || num(row[c + 1]);
            log.push(`  통장 잔액: ₩${bankBalance.toLocaleString()}`);
            break;
          }
        }
        if (bankBalance > 0) break;
      }
    }

    // If not found by label, try row 4 col 9 (common position)
    if (bankBalance === 0 && data[4]) {
      bankBalance = num(data[4][9]);
      if (bankBalance > 0) log.push(`  통장 잔액(위치 기반): ₩${bankBalance.toLocaleString()}`);
    }

    // Parse income items (입금예정)
    let inIncomeSection = false;
    let inExpenseSection = false;

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      if (!row) continue;
      const col1 = String(row[1] || '');

      if (col1.includes('입금예정') && !col1.includes('총')) {
        inIncomeSection = true;
        inExpenseSection = false;
        continue;
      }
      if (col1.includes('지출예정') && !col1.includes('총')) {
        inIncomeSection = false;
        inExpenseSection = true;
        continue;
      }
      if (col1.includes('총 입금예정') || col1.includes('총 지출예정') || col1.includes('현금시제잔액')) {
        inIncomeSection = false;
        inExpenseSection = false;
        continue;
      }

      const amount = num(row[9]);
      const name = String(row[6] || row[5] || row[4] || '').trim();
      const project = String(row[4] || '').trim();
      const account = String(row[7] || '').trim();
      const dueDateRaw = row[3];

      if (amount !== 0 && name && !name.startsWith('#')) {
        const dueDate = typeof dueDateRaw === 'number' ? excelDateToISO(dueDateRaw) : null;

        if (inIncomeSection) {
          // Determine if this is a receivable (미수금) or confirmed income
          const isReceivable = name.includes('미수') || name.includes('잔금') ||
            name.includes('입금예정') || col1.includes('외상매출');
          items.push({
            category: isReceivable ? 'receivable' : 'income',
            name,
            amount: Math.abs(amount),
            dueDate,
            status: 'pending',
            projectName: project || null,
            accountType: account || null,
            month: sheetMonth,
          });
        } else if (inExpenseSection) {
          const isFixed = String(row[5] || '').includes('고정') ||
            ['급여', '임차료', '보험', '이자', '세무사'].some(k => name.includes(k));
          items.push({
            category: isFixed ? 'fixed_cost' : 'expense',
            name,
            amount: Math.abs(amount),
            dueDate,
            status: 'pending',
            projectName: project || null,
            accountType: account || null,
            month: sheetMonth,
          });
        }
      }
    }
    log.push(`  입출금 항목 ${items.length}개 추출`);
  } else {
    log.push('⚠️ 현금시제기준 시트를 찾지 못했습니다');
  }

  // ═══ C) 실적보고서 파싱 (매출 데이터) ═══
  const perfSheet = findSheet(wb, ['실적보고서']);
  if (perfSheet) {
    log.push('✅ 실적보고서 시트 발견');
    const data = XLSX.utils.sheet_to_json(perfSheet, { header: 1, defval: '' }) as any[][];

    // Extract key metrics
    for (let i = 0; i < Math.min(20, data.length); i++) {
      const row = data[i];
      if (!row || !row[1]) continue;
      const label = String(row[1]).trim();
      const val = num(row[2]);

      if (label === '확정매출액' && val > 0) {
        log.push(`  확정매출: ₩${val.toLocaleString()}`);
      }
      if (label === '(예상_평균 월고정비용)' && val > 0) {
        log.push(`  평균 월고정비: ₩${val.toLocaleString()}`);
      }
    }
  }

  // ═══ Summary ═══
  const currentMonthData = months.find(m => m.month === currentMonth) || months[0];
  const summary = {
    currentMonth: currentMonthData?.month || currentMonth,
    totalIncome: currentMonthData?.totalIncome || 0,
    totalExpense: currentMonthData?.totalExpense || 0,
    fixedCost: currentMonthData?.fixedCost || 0,
    variableCost: currentMonthData?.variableCost || 0,
    netCashflow: currentMonthData?.netCashflow || 0,
    revenue: currentMonthData?.revenue || 0,
    bankBalance: bankBalance || currentMonthData?.bankBalance || 0,
  };

  log.push(`\n📊 파싱 완료: ${months.length}개월 데이터, ${items.length}개 항목`);
  log.push(`   통장잔고: ₩${summary.bankBalance.toLocaleString()}`);
  log.push(`   이번달 순현금흐름: ₩${(summary.totalIncome - summary.totalExpense).toLocaleString()}`);
  log.push(`   월 고정비: ₩${summary.fixedCost.toLocaleString()}`);

  return { months, items, bankBalance: summary.bankBalance, summary, parseLog: log };
}

// ── Helpers ──
function findSheet(wb: XLSX.WorkBook, keywords: string[]): XLSX.WorkSheet | null {
  for (const kw of keywords) {
    const name = wb.SheetNames.find(n => n.includes(kw));
    if (name) return wb.Sheets[name];
  }
  return null;
}

function num(v: any): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[,₩원]/g, ''));
  return isNaN(n) ? 0 : n;
}
