/**
 * L 수당 카탈로그 — 일반화된 월별 가산수당 계산 엔진.
 *
 * 핸드오프 §B 산출물.
 *   - allowance_types (회사별 카탈로그) × attendance_records (월 근태) →
 *     allowance_entries (월별 직원별 산정 결과) 를 UPSERT.
 *   - 법정 4종(+휴일 8h 초과 분리행) 은 db-architect 의 seed_legal_allowances 가
 *     이미 INSERT 해둠. 본 엔진은 그 카탈로그를 읽어 calc_mode 에 따라 처리.
 *   - source='manual' 또는 'edit' 행은 보존 (관리자 수정 손실 방지).
 *     force=true 옵션이면 덮어쓰기 (관리자 명시적 강제 재계산).
 *
 * 의존:
 *   - employees.salary (월 통상임금) / company_settings.monthly_standard_hours
 *     → hourly = salary / monthly_standard_hours
 *   - attendance_records.{overtime_minutes,night_minutes,holiday_minutes}
 *     (휴일 8h 초과는 holiday_minutes 에서 MAX(.. - 480, 0) 일별 합산)
 *   - 휴가일(annual_leave 등) 행은 attendance_records 자체에서 분 컬럼이
 *     이미 0 이므로 별도 제외 불필요. attendance_type='on_duty' 일 행 수가
 *     per_count 의 기본 base.
 *
 * 5인 미만(is_under_5_employees) / 포괄임금제(is_inclusive_wage):
 *   - is_legal_mandatory=true 행 amount=0. custom 행은 정상 계산.
 *
 * 비재귀 — 순수 DB 읽기/쓰기, 트리거 없음. recomputeAttendance 의 chain 으로 호출됨.
 */

import { supabase } from './supabase';
import { getAttendanceCompanySettings } from './hr';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

// ── 타입 ──

export type AllowanceEntryResult = {
  allowance_type_id: string;
  code: string;
  name: string;
  amount: number;
  calculated_minutes: number | null;
  count: number | null;
  source: 'auto' | 'manual' | 'edit';
};

export type RecomputeResult = {
  entries: AllowanceEntryResult[];
  total: number;
};

export type AllowanceTypeRow = {
  id: string;
  company_id: string;
  code: string;
  name: string;
  calc_mode: 'auto_time' | 'per_count' | 'manual' | 'fixed_per_month';
  base_field: string | null;
  rate_type: 'hourly_multiplier' | 'fixed_per_minute' | 'fixed_per_count' | 'fixed_per_month';
  rate_amount: number;
  is_legal_mandatory: boolean;
  is_active: boolean;
  applies_to: 'all' | 'employees';
  target_employee_ids: string[];
  display_order: number;
};

type AttendanceRecordRow = {
  id: string;
  date: string;
  attendance_type: string | null;
  overtime_minutes: number | null;
  night_minutes: number | null;
  holiday_minutes: number | null;
  is_holiday: boolean | null;
};

type AllowanceEntryRow = {
  id: string;
  allowance_type_id: string;
  amount: number;
  source: 'auto' | 'manual' | 'edit';
};

// ── 헬퍼 ──

function ymRange(yyyymm: string): { start: string; end: string } {
  const [y, m] = yyyymm.split('-').map(Number);
  if (!y || !m) throw new Error(`invalid payroll_month: ${yyyymm}`);
  const start = `${yyyymm}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const end = `${yyyymm}-${String(lastDay).padStart(2, '0')}`;
  return { start, end };
}

function sumMinutesByField(
  rows: AttendanceRecordRow[],
  baseField: string,
): number {
  let sum = 0;
  for (const r of rows) {
    if (baseField === 'overtime_minutes') sum += Number(r.overtime_minutes || 0);
    else if (baseField === 'night_minutes') sum += Number(r.night_minutes || 0);
    else if (baseField === 'holiday_minutes') {
      // 8h(=480분) 이내만
      sum += Math.min(Number(r.holiday_minutes || 0), 480);
    }
    else if (baseField === 'holiday_over_8h_minutes') {
      // attendance_records 에 별도 컬럼 없음 → holiday_minutes 의 480 초과분 일별 합산
      sum += Math.max(Number(r.holiday_minutes || 0) - 480, 0);
    }
  }
  return sum;
}

// per_count 의 attendance_type 매칭 룰 — 시스템 코드 기본 매핑.
//   custom per_count 는 일단 'field_work' 로 매칭 (추후 확장 가능).
function matchAttendanceTypeForCount(code: string): string | null {
  if (code === 'on_duty') return 'on_duty';
  return 'field_work';
}

// ── 핵심 함수 ──

/**
 * 월별 가산수당 재계산 — 직원 1명 × 1개월.
 *
 * @param employeeId 직원 ID
 * @param yyyymm 'YYYY-MM' (payroll_month)
 * @param opts.force true 시 manual/edit 행도 덮어쓰기
 * @returns { entries, total }
 */
export async function recomputeMonthlyAllowances(
  employeeId: string,
  yyyymm: string,
  opts?: { force?: boolean },
): Promise<RecomputeResult> {
  const force = !!opts?.force;

  // 1) 직원 조회 — company_id, salary
  const { data: emp } = await db
    .from('employees')
    .select('id, company_id, salary')
    .eq('id', employeeId)
    .maybeSingle();
  if (!emp?.company_id) {
    return { entries: [], total: 0 };
  }
  const companyId: string = emp.company_id;
  const baseSalary = Number(emp.salary || 0);

  // 2) 회사 설정 — monthly_standard_hours, is_under_5_employees, is_inclusive_wage
  const settings = await getAttendanceCompanySettings(companyId);
  const stdHours = Math.max(1, Number(settings.monthly_standard_hours || 209));
  const hourly = baseSalary > 0 ? baseSalary / stdHours : 0;
  const legalSuppressed = settings.is_under_5_employees || settings.is_inclusive_wage;

  // 3) allowance_types 활성 + applies_to 매칭 — display_order ASC
  const { data: typesRaw } = await db
    .from('allowance_types')
    .select('*')
    .eq('company_id', companyId)
    .eq('is_active', true)
    .order('display_order', { ascending: true });

  const types: AllowanceTypeRow[] = ((typesRaw || []) as AllowanceTypeRow[]).filter((t) => {
    if (t.applies_to === 'all') return true;
    if (t.applies_to === 'employees') {
      return Array.isArray(t.target_employee_ids) && t.target_employee_ids.includes(employeeId);
    }
    return false;
  });

  if (types.length === 0) {
    return { entries: [], total: 0 };
  }

  // 4) 해당 월 attendance_records 로드
  const { start, end } = ymRange(yyyymm);
  const { data: arRaw } = await db
    .from('attendance_records')
    .select('id, date, attendance_type, overtime_minutes, night_minutes, holiday_minutes, is_holiday')
    .eq('company_id', companyId)
    .eq('employee_id', employeeId)
    .gte('date', start)
    .lte('date', end);

  const allRecords: AttendanceRecordRow[] = (arRaw || []) as AttendanceRecordRow[];
  // 휴가 행 제외 — annual_leave / sick_leave / official_leave / etc 는 가산 계산에 미반영.
  //   (recomputeAttendance 가 on_leave 인 경우 분 컬럼을 모두 0 으로 set 하지만, 방어적으로 한번 더 차단.)
  const LEAVE_TYPES = new Set(['annual_leave', 'sick_leave', 'official_leave', 'etc']);
  const records = allRecords.filter((r) => !LEAVE_TYPES.has(String(r.attendance_type || '')));

  // 5) 기존 entries 로드 (manual/edit 보존 판정용)
  const { data: existingRaw } = await db
    .from('allowance_entries')
    .select('id, allowance_type_id, amount, source')
    .eq('company_id', companyId)
    .eq('employee_id', employeeId)
    .eq('payroll_month', yyyymm);

  const existingByType = new Map<string, AllowanceEntryRow>();
  for (const e of (existingRaw || []) as AllowanceEntryRow[]) {
    existingByType.set(e.allowance_type_id, e);
  }

  // 6) 각 type 분기 계산
  const upsertRows: Array<{
    company_id: string;
    employee_id: string;
    payroll_month: string;
    allowance_type_id: string;
    calculated_minutes: number | null;
    count: number | null;
    amount: number;
    source: 'auto';
  }> = [];

  const resultEntries: AllowanceEntryResult[] = [];

  for (const t of types) {
    const existing = existingByType.get(t.id);

    // manual 행은 자동에서 새로 만들지 않음 — 기존 행 보존, 결과에 그대로 반영.
    //   (manual 모드는 관리자가 entries 표에서 직접 입력하는 항목).
    if (t.calc_mode === 'manual') {
      if (existing) {
        resultEntries.push({
          allowance_type_id: t.id,
          code: t.code,
          name: t.name,
          amount: Number(existing.amount || 0),
          calculated_minutes: null,
          count: null,
          source: existing.source,
        });
      }
      // 기존 없으면 skip — 관리자가 만들 때까지 행 자체 없음.
      continue;
    }

    // force=false 면 manual/edit 행 보존 (덮어쓰지 않음).
    if (!force && existing && (existing.source === 'manual' || existing.source === 'edit')) {
      resultEntries.push({
        allowance_type_id: t.id,
        code: t.code,
        name: t.name,
        amount: Number(existing.amount || 0),
        calculated_minutes: null,
        count: null,
        source: existing.source,
      });
      continue;
    }

    let calculated_minutes: number | null = null;
    let count: number | null = null;
    let amount = 0;

    if (t.calc_mode === 'auto_time') {
      const baseField = t.base_field || '';
      const sumMin = sumMinutesByField(records, baseField);
      calculated_minutes = sumMin;
      if (t.rate_type === 'hourly_multiplier') {
        amount = (sumMin / 60) * hourly * Number(t.rate_amount || 0);
      } else if (t.rate_type === 'fixed_per_minute') {
        amount = sumMin * Number(t.rate_amount || 0);
      }
    } else if (t.calc_mode === 'per_count') {
      const matchType = matchAttendanceTypeForCount(t.code);
      const c = matchType
        ? records.filter((r) => String(r.attendance_type || '') === matchType).length
        : 0;
      count = c;
      amount = c * Number(t.rate_amount || 0);
    } else if (t.calc_mode === 'fixed_per_month') {
      // 'always' 룰 — 해당 월 카탈로그 활성이면 무조건 지급.
      //   (요구사항 §B 6: 일단 always 적용으로 단순화)
      amount = Number(t.rate_amount || 0);
    }

    // 5인 미만 / 포괄임금제 — 법정행 amount=0
    if (legalSuppressed && t.is_legal_mandatory) {
      amount = 0;
    }

    amount = Math.round(amount);

    upsertRows.push({
      company_id: companyId,
      employee_id: employeeId,
      payroll_month: yyyymm,
      allowance_type_id: t.id,
      calculated_minutes,
      count,
      amount,
      source: 'auto',
    });

    resultEntries.push({
      allowance_type_id: t.id,
      code: t.code,
      name: t.name,
      amount,
      calculated_minutes,
      count,
      source: 'auto',
    });
  }

  // 7) UPSERT — UNIQUE(company_id, employee_id, payroll_month, allowance_type_id)
  if (upsertRows.length > 0) {
    const { error } = await db
      .from('allowance_entries')
      .upsert(upsertRows, {
        onConflict: 'company_id,employee_id,payroll_month,allowance_type_id',
      });
    if (error) {
      // 실패해도 결과는 반환 (UI 에서 에러 토스트는 호출자가 표시).
      throw error;
    }
  }

  const total = resultEntries.reduce((s, e) => s + (e.amount || 0), 0);
  return { entries: resultEntries, total };
}

/**
 * 회사 + 특정 월 전 직원 일괄 재계산.
 *   - 관리자 화면의 "이번 달 일괄 재계산" 버튼이 호출.
 *   - chunk(=5) 병렬, 오류 직원은 errors 에 기록 후 다음 직원 진행.
 */
export async function recomputeMonthlyAllowancesForCompany(
  companyId: string,
  yyyymm: string,
  opts?: { force?: boolean; chunk?: number },
): Promise<{ ok: number; failed: number; errors: Array<{ employeeId: string; message: string }> }> {
  const chunk = Math.max(1, opts?.chunk || 5);
  const { data: employees } = await db
    .from('employees')
    .select('id')
    .eq('company_id', companyId)
    .in('status', ['active', 'joined', 'invited']);

  const ids: string[] = (employees || []).map((e: { id: string }) => e.id);
  let ok = 0;
  let failed = 0;
  const errors: Array<{ employeeId: string; message: string }> = [];

  for (let i = 0; i < ids.length; i += chunk) {
    const batch = ids.slice(i, i + chunk);
    const results = await Promise.allSettled(
      batch.map((id) => recomputeMonthlyAllowances(id, yyyymm, { force: opts?.force })),
    );
    results.forEach((r, idx) => {
      if (r.status === 'fulfilled') ok++;
      else {
        failed++;
        errors.push({ employeeId: batch[idx], message: (r.reason as Error)?.message || 'unknown' });
      }
    });
  }

  return { ok, failed, errors };
}

// ── 단위 테스트용 export ──
export const __internal = { sumMinutesByField, matchAttendanceTypeForCount, ymRange };
