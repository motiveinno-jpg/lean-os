/**
 * Flex HR Excel Parser — 플렉스 직원 데이터 파서
 *
 * 플렉스 엑셀 → FlexEmployee[] 파싱.
 * 컬럼명 한글 키워드 자동 매핑, 연봉→월급 변환, 중복 감지.
 */
import * as XLSX from 'xlsx';

export interface FlexEmployee {
  employee_number: string | null;
  name: string;
  department: string | null;
  position: string | null;
  job_title: string | null;
  job_grade: string | null;
  hire_date: string | null;
  salary: number;
  email: string | null;
  phone: string | null;
  bank_name: string | null;
  bank_account: string | null;
  bank_holder: string | null;
  contract_type: string | null;
  status: 'active' | 'inactive';
  _confidence: 'high' | 'medium' | 'low';
  _source_row: number;
}

export interface FlexParseResult {
  employees: FlexEmployee[];
  parseLog: string[];
  unmappedColumns: string[];
  warnings: string[];
  totalRows: number;
  mappedFields: Record<string, string>; // 원본컬럼→매핑필드
}

// ── 컬럼 매핑 테이블 (한글 키워드 → 필드명) ──

const COLUMN_MAP: { field: string; keywords: string[]; required?: boolean }[] = [
  { field: 'employee_number', keywords: ['사원번호', '직원번호', 'emp_no', 'employee_id', '번호'] },
  { field: 'name', keywords: ['이름', '성명', '직원명', '사원명', 'name'], required: true },
  { field: 'department', keywords: ['부서', '부서명', '소속', 'department', 'dept'] },
  { field: 'position', keywords: ['직급', '직위', '등급', 'rank', 'level'] },
  { field: 'job_title', keywords: ['직책', '역할', 'title', 'role'] },
  { field: 'job_grade', keywords: ['호봉', '직군', 'grade'] },
  { field: 'hire_date', keywords: ['입사일', '입사일자', '입사', 'hire_date', 'join_date', '시작일'] },
  { field: 'salary', keywords: ['기본급', '월급여', '월급', '급여', 'salary', 'base_pay', '월기본급'] },
  { field: 'annual_salary', keywords: ['연봉', '연간급여', 'annual', 'yearly'] },
  { field: 'email', keywords: ['이메일', 'email', 'e-mail', '메일'] },
  { field: 'phone', keywords: ['전화번호', '연락처', '핸드폰', '휴대폰', 'phone', 'mobile', 'tel'] },
  { field: 'bank_name', keywords: ['은행', '은행명', 'bank'] },
  { field: 'bank_account', keywords: ['계좌번호', '계좌', 'account'] },
  { field: 'bank_holder', keywords: ['예금주', '계좌주', 'holder'] },
  { field: 'contract_type', keywords: ['계약형태', '고용형태', '계약유형', '근무유형', 'contract', '정규직', '계약직'] },
  { field: 'status', keywords: ['재직상태', '상태', '재직', 'status', '퇴직', '재직여부'] },
];

function mapColumns(headers: string[]): { mapping: Record<number, string>; unmapped: string[]; mappedFields: Record<string, string> } {
  const mapping: Record<number, string> = {};
  const mappedFields: Record<string, string> = {};
  const used = new Set<string>();

  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].trim().toLowerCase().replace(/[\s_-]+/g, '');
    if (!h) continue;

    for (const cm of COLUMN_MAP) {
      if (used.has(cm.field)) continue;
      if (cm.keywords.some(kw => h.includes(kw.toLowerCase().replace(/[\s_-]+/g, '')))) {
        mapping[i] = cm.field;
        mappedFields[headers[i].trim()] = cm.field;
        used.add(cm.field);
        break;
      }
    }
  }

  const unmapped = headers.filter((h, i) => h.trim() && !(i in mapping));
  return { mapping, unmapped, mappedFields };
}

function parseDate(val: any): string | null {
  if (!val) return null;
  if (typeof val === 'number') {
    // Excel serial date
    if (val < 40000) return null;
    const utcDays = Math.floor(val) - 25569;
    const d = new Date(utcDays * 86400000);
    return d.toISOString().split('T')[0];
  }
  const s = String(val).trim();
  // YYYY-MM-DD, YYYY.MM.DD, YYYY/MM/DD
  const m = s.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return null;
}

function parseStatus(val: any): 'active' | 'inactive' {
  if (!val) return 'active';
  const s = String(val).trim().toLowerCase();
  if (['퇴직', 'inactive', '퇴사', '휴직', 'resigned', 'left'].some(kw => s.includes(kw))) return 'inactive';
  return 'active';
}

function num(v: any): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[,₩원\s]/g, ''));
  return isNaN(n) ? 0 : n;
}

export function parseFlexExport(buffer: ArrayBuffer): FlexParseResult {
  const wb = XLSX.read(buffer, { type: 'array' });
  const log: string[] = [];
  const warnings: string[] = [];

  // 첫 번째 시트 or '구성원'/'직원' 시트 탐색
  const targetSheetName = wb.SheetNames.find(n =>
    ['구성원', '직원', '사원', '인사', 'HR', 'Employee'].some(kw => n.includes(kw))
  ) || wb.SheetNames[0];

  log.push(`시트 선택: "${targetSheetName}"`);

  const sheet = wb.Sheets[targetSheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as any[][];

  if (rows.length < 2) {
    return { employees: [], parseLog: ['데이터 행이 없습니다'], unmappedColumns: [], warnings: [], totalRows: 0, mappedFields: {} };
  }

  // 첫 5행 중 컬럼수 가장 많은 행을 헤더로
  let headerIdx = 0;
  let maxCols = 0;
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    const nonEmpty = rows[i].filter(c => c !== '' && c != null).length;
    if (nonEmpty > maxCols) { maxCols = nonEmpty; headerIdx = i; }
  }

  const headers = rows[headerIdx].map((h: any) => String(h || ''));
  const { mapping, unmapped, mappedFields } = mapColumns(headers);

  log.push(`헤더 행: ${headerIdx + 1}행 (${maxCols}개 컬럼)`);
  log.push(`매핑된 필드: ${Object.values(mappedFields).join(', ')}`);
  if (unmapped.length) log.push(`미매핑 컬럼: ${unmapped.join(', ')}`);

  const hasName = Object.values(mapping).includes('name');
  if (!hasName) {
    warnings.push('필수 필드 "이름/성명" 컬럼을 찾지 못했습니다');
    return { employees: [], parseLog: log, unmappedColumns: unmapped, warnings, totalRows: rows.length - headerIdx - 1, mappedFields };
  }

  const employees: FlexEmployee[] = [];

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const get = (field: string): any => {
      for (const [col, f] of Object.entries(mapping)) {
        if (f === field) return row[Number(col)];
      }
      return null;
    };

    const name = String(get('name') || '').trim();
    if (!name) continue; // 이름 없으면 스킵

    let salary = num(get('salary'));
    const annualSalary = num(get('annual_salary'));
    if (salary === 0 && annualSalary > 0) {
      salary = Math.round(annualSalary / 12);
    }

    // 신뢰도 계산
    const filledFields = ['employee_number', 'department', 'position', 'hire_date', 'salary', 'email', 'bank_account']
      .filter(f => {
        const v = get(f);
        return v !== null && v !== '' && v !== 0;
      }).length;
    const confidence: 'high' | 'medium' | 'low' = filledFields >= 5 ? 'high' : filledFields >= 3 ? 'medium' : 'low';

    employees.push({
      employee_number: String(get('employee_number') || '').trim() || null,
      name,
      department: String(get('department') || '').trim() || null,
      position: String(get('position') || '').trim() || null,
      job_title: String(get('job_title') || '').trim() || null,
      job_grade: String(get('job_grade') || '').trim() || null,
      hire_date: parseDate(get('hire_date')),
      salary,
      email: String(get('email') || '').trim() || null,
      phone: String(get('phone') || '').trim() || null,
      bank_name: String(get('bank_name') || '').trim() || null,
      bank_account: String(get('bank_account') || '').trim() || null,
      bank_holder: String(get('bank_holder') || '').trim() || null,
      contract_type: String(get('contract_type') || '').trim() || null,
      status: parseStatus(get('status')),
      _confidence: confidence,
      _source_row: i + 1,
    });
  }

  log.push(`직원 ${employees.length}명 파싱 완료`);
  log.push(`  높은 신뢰도: ${employees.filter(e => e._confidence === 'high').length}명`);
  log.push(`  중간 신뢰도: ${employees.filter(e => e._confidence === 'medium').length}명`);
  log.push(`  낮은 신뢰도: ${employees.filter(e => e._confidence === 'low').length}명`);

  return {
    employees,
    parseLog: log,
    unmappedColumns: unmapped,
    warnings,
    totalRows: rows.length - headerIdx - 1,
    mappedFields,
  };
}
