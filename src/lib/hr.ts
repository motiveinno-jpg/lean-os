/**
 * OwnerView HR Engine
 * 급여이력 + 계약서 + 근태관리 + 휴가관리
 */

import { supabase } from './supabase';
import { getCurrentUser } from './queries';
import {
  calcDailyAttendance,
  calcOvertimePay,
  type AttendanceCompanySettings,
  type DailyResult,
  type MonthlyPayResult,
} from './attendance-calc';

// Use `any` cast for tables not yet in the generated DB types
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

// ── Salary History ──
export async function getSalaryHistory(employeeId: string) {
  const { data } = await db
    .from('salary_history')
    .select('*, users:approved_by(name, email)')
    .eq('employee_id', employeeId)
    .order('effective_date', { ascending: false });
  return data || [];
}

export async function addSalaryRecord(params: {
  companyId: string;
  employeeId: string;
  effectiveDate: string;
  salary: number;
  previousSalary?: number;
  changeReason?: string;
  approvedBy?: string;
}) {
  const { data, error } = await db
    .from('salary_history')
    .insert({
      company_id: params.companyId,
      employee_id: params.employeeId,
      effective_date: params.effectiveDate,
      salary: params.salary,
      previous_salary: params.previousSalary || null,
      change_reason: params.changeReason || null,
      approved_by: params.approvedBy || null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ── Employee Contracts ──
export async function getContracts(employeeId: string) {
  const { data } = await db
    .from('employee_contracts')
    .select('*')
    .eq('employee_id', employeeId)
    .order('start_date', { ascending: false });
  return data || [];
}

export async function getActiveContracts(companyId: string) {
  const { data } = await db
    .from('employee_contracts')
    .select('*, employees(name)')
    .eq('company_id', companyId)
    .in('status', ['active', 'joined'])
    .order('start_date', { ascending: false });
  return data || [];
}

export async function createContract(params: {
  companyId: string;
  employeeId: string;
  contractType: string;
  startDate: string;
  endDate?: string;
  salary?: number;
  workHoursPerWeek?: number;
  probationEndDate?: string;
  fileUrl?: string;
}) {
  const { data, error } = await db
    .from('employee_contracts')
    .insert({
      company_id: params.companyId,
      employee_id: params.employeeId,
      contract_type: params.contractType,
      start_date: params.startDate,
      end_date: params.endDate || null,
      salary: params.salary || null,
      work_hours_per_week: params.workHoursPerWeek || 40,
      probation_end_date: params.probationEndDate || null,
      file_url: params.fileUrl || null,
      status: 'active',
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function terminateContract(contractId: string) {
  const { error } = await db
    .from('employee_contracts')
    .update({ status: 'terminated', updated_at: new Date().toISOString() })
    .eq('id', contractId);
  if (error) throw error;
}

// ── Employee update with all editable fields ──
export async function updateEmployee(employeeId: string, updates: Record<string, unknown>) {
  const allowedFields = [
    'name', 'department', 'position', 'job_grade', 'employment_type',
    'email', 'phone', 'birth_date', 'address',
    'emergency_contact', 'emergency_phone',
    'salary', 'bank_name', 'bank_account', 'bank_holder',
    'employee_number', 'hire_date', 'is_4_insurance',
    'meal_allowance_included', 'contract_type',
  ];
  // date/number 컬럼 — 빈 string 받으면 Postgres 가 invalid 에러.
  // 빈 값은 null 로 정규화.
  const dateFields = new Set(['birth_date', 'hire_date']);
  const numericFields = new Set(['salary']);

  const filtered: Record<string, unknown> = {};
  for (const key of allowedFields) {
    if (!(key in updates)) continue;
    let v = updates[key];
    if (dateFields.has(key)) {
      if (v === '' || v === undefined) v = null;
    } else if (numericFields.has(key)) {
      if (v === '' || v === undefined || v === null) v = null;
      else if (typeof v === 'string') {
        const n = Number(v.replace(/[^0-9.-]/g, ''));
        v = Number.isFinite(n) ? n : null;
      }
    } else if (typeof v === 'string' && v.trim() === '') {
      // text 컬럼도 빈 문자열을 null 로 (선택사항이지만 깔끔)
      v = null;
    }
    filtered[key] = v;
  }
  if (Object.keys(filtered).length === 0) return;
  const { error } = await db
    .from('employees')
    .update(filtered as any)
    .eq('id', employeeId);
  if (error) throw error;
}

export const CONTRACT_TYPES = [
  { value: 'full_time', label: '정규직' },
  { value: 'contract', label: '계약직' },
  { value: 'part_time', label: '파트타임' },
  { value: 'intern', label: '인턴' },
  { value: 'freelance', label: '프리랜서' },
] as const;

// ── Attendance & Leave Constants ──

export const LEAVE_TYPES = [
  { value: 'annual', label: '연차', defaultDays: 15, description: '근로기준법 제60조 기반 연차유급휴가' },
  { value: 'sick', label: '병가', defaultDays: 10, description: '질병 또는 부상으로 인한 휴가' },
  { value: 'personal', label: '경조사', defaultDays: 5, description: '개인 경조사 관련 휴가' },
  { value: 'maternity', label: '출산휴가', defaultDays: 90, description: '출산 전후 휴가 (근로기준법 제74조)' },
  { value: 'paternity', label: '배우자출산휴가', defaultDays: 10, description: '배우자 출산 시 사용' },
  { value: 'compensation', label: '대체휴무', defaultDays: 0, description: '휴일 근무에 대한 대체 휴무' },
  { value: 'family_care', label: '가족돌봄휴가', defaultDays: 10, description: '가족 돌봄이 필요한 경우 사용' },
  { value: 'official', label: '공가', defaultDays: 5, description: '공적 업무 수행을 위한 휴가' },
  { value: 'menstrual', label: '생리휴가', defaultDays: 12, description: '근로기준법 제73조 기반' },
  { value: 'compensatory', label: '보상휴가', defaultDays: 0, description: '초과근무에 대한 보상 휴가' },
  { value: 'bereavement', label: '경조휴가', defaultDays: 5, description: '가족 경조사' },
] as const;

export const LEAVE_UNITS = [
  { value: 'full_day', label: '종일', days: 1 },
  { value: 'half_day', label: '반차', days: 0.5 },
  { value: 'two_hours', label: '2시간', days: 0.25 },
] as const;

export type LeaveUnit = typeof LEAVE_UNITS[number]['value'];

export const ATTENDANCE_STATUS = [
  { value: 'present', label: '출근' },
  { value: 'late', label: '지각' },
  { value: 'absent', label: '결근' },
  { value: 'half_day', label: '반차' },
  { value: 'remote', label: '재택' },
] as const;

export const LEAVE_REQUEST_STATUS = {
  pending: { label: '대기', bg: 'bg-yellow-500/10', text: 'text-yellow-400' },
  approved: { label: '승인', bg: 'bg-green-500/10', text: 'text-green-400' },
  rejected: { label: '반려', bg: 'bg-red-500/10', text: 'text-red-400' },
} as const;

// ── Attendance Edge Function helper (bypasses RLS) ──
async function invokeAttendance(action: string, params: Record<string, string>) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("로그인이 필요합니다");

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const res = await fetch(`${supabaseUrl}/functions/v1/attendance-checkin`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
      apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    },
    body: JSON.stringify({ action, ...params }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "근태 처리 실패");
  return json.data;
}

// ── Attendance: 회사별 출근 기준 (company_settings.settings JSONB) ──
// 키 work_start_time (HH:MM 24h, 기본 '09:00'), late_threshold_minutes (int, 기본 30)
// DB 스키마 변경 없이 leave_grant_method 와 동일한 패턴 사용

export type AttendancePolicy = {
  workStartTime: string;        // 'HH:MM'
  lateThresholdMinutes: number; // grace period (분)
};

const DEFAULT_ATTENDANCE_POLICY: AttendancePolicy = {
  workStartTime: '09:00',
  lateThresholdMinutes: 30,
};

/** 회사 출근 기준 조회. 미설정 시 9:00 + 30분 grace (기존 동작 유지).
 *  컬럼 우선(work_start_time/late_grace_minutes) → JSONB settings fallback → 기본값.
 *  F2 호환: 시그니처/반환타입 무변동. checkIn 호출처 영향 없음.
 */
export async function getAttendancePolicy(companyId: string): Promise<AttendancePolicy> {
  try {
    const { data } = await db
      .from('company_settings')
      .select('work_start_time, late_grace_minutes, settings')
      .eq('company_id', companyId)
      .maybeSingle();
    const s = data?.settings || {};
    // 1) 신규 컬럼 우선
    let wst: string | null = null;
    if (typeof data?.work_start_time === 'string' && /^\d{2}:\d{2}/.test(data.work_start_time)) {
      wst = data.work_start_time.slice(0, 5);
    } else if (typeof s.work_start_time === 'string' && /^\d{2}:\d{2}$/.test(s.work_start_time)) {
      wst = s.work_start_time;
    }
    let ltm: number | null = null;
    if (Number.isFinite(Number(data?.late_grace_minutes))) {
      ltm = Math.max(0, Math.min(240, Math.trunc(Number(data.late_grace_minutes))));
    } else if (Number.isFinite(Number(s.late_threshold_minutes))) {
      ltm = Math.max(0, Math.min(240, Math.trunc(Number(s.late_threshold_minutes))));
    }
    return {
      workStartTime: wst ?? DEFAULT_ATTENDANCE_POLICY.workStartTime,
      lateThresholdMinutes: ltm ?? DEFAULT_ATTENDANCE_POLICY.lateThresholdMinutes,
    };
  } catch {
    return { ...DEFAULT_ATTENDANCE_POLICY };
  }
}

/** 회사 출근 기준 저장. 신규 컬럼에 직접 upsert (JSONB 키는 더 이상 안 씀).
 *  기존 settings JSONB 의 다른 키는 보존(다른 모듈이 leave_grant_method 등 사용).
 */
export async function setAttendancePolicy(
  companyId: string,
  policy: Partial<AttendancePolicy>,
): Promise<void> {
  const patch: Record<string, unknown> = { company_id: companyId };
  if (policy.workStartTime && /^\d{2}:\d{2}$/.test(policy.workStartTime)) {
    patch.work_start_time = policy.workStartTime;
  }
  if (typeof policy.lateThresholdMinutes === 'number' && Number.isFinite(policy.lateThresholdMinutes)) {
    patch.late_grace_minutes = Math.max(0, Math.min(240, Math.trunc(policy.lateThresholdMinutes)));
  }

  const { error } = await db
    .from('company_settings')
    .upsert(patch, { onConflict: 'company_id' });
  if (error) throw error;
}

// ── L 근태: 전체 회사 설정 (가산수당 계산 엔진 입력 타입) ──

const DEFAULT_ATTENDANCE_COMPANY_SETTINGS: AttendanceCompanySettings = {
  work_start_time: '09:00',
  work_end_time: '18:00',
  lunch_minutes: 60,
  late_grace_minutes: 0,
  night_start_time: '22:00',
  night_end_time: '06:00',
  weekly_work_hours: 40,
  is_under_5_employees: false,
  is_inclusive_wage: false,
  monthly_standard_hours: 209,
  on_duty_pay_per_shift: 0,
  workdays_mask: 31, // 월~금 (1+2+4+8+16)
};

function hhmm(v: unknown, fallback: string): string {
  if (typeof v === 'string') {
    const m = v.match(/^(\d{2}):(\d{2})/);
    if (m) return `${m[1]}:${m[2]}`;
  }
  return fallback;
}

function num(v: unknown, fallback: number, min = -Infinity, max = Infinity): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

/** L 근태 — 회사 전체 설정 조회 (calcDailyAttendance/calcOvertimePay 입력용).
 *  컬럼 우선·JSONB fallback·기본값 3단 우선순위.
 */
export async function getAttendanceCompanySettings(companyId: string): Promise<AttendanceCompanySettings> {
  const D = DEFAULT_ATTENDANCE_COMPANY_SETTINGS;
  try {
    const { data } = await db
      .from('company_settings')
      .select(
        'work_start_time, work_end_time, lunch_minutes, late_grace_minutes, ' +
        'night_start_time, night_end_time, weekly_work_hours, ' +
        'is_under_5_employees, is_inclusive_wage, monthly_standard_hours, ' +
        'on_duty_pay_per_shift, workdays_mask, settings'
      )
      .eq('company_id', companyId)
      .maybeSingle();
    const s = (data?.settings as Record<string, unknown> | null) || {};
    const pick = (col: unknown, jsonKey: string) =>
      col !== null && col !== undefined ? col : s[jsonKey];

    return {
      work_start_time: hhmm(pick(data?.work_start_time, 'work_start_time'), D.work_start_time),
      work_end_time: hhmm(pick(data?.work_end_time, 'work_end_time'), D.work_end_time),
      lunch_minutes: num(pick(data?.lunch_minutes, 'lunch_minutes'), D.lunch_minutes, 0, 480),
      late_grace_minutes: num(pick(data?.late_grace_minutes, 'late_grace_minutes'),
        num(s.late_threshold_minutes, D.late_grace_minutes, 0, 240), 0, 240),
      night_start_time: hhmm(pick(data?.night_start_time, 'night_start_time'), D.night_start_time),
      night_end_time: hhmm(pick(data?.night_end_time, 'night_end_time'), D.night_end_time),
      weekly_work_hours: num(pick(data?.weekly_work_hours, 'weekly_work_hours'), D.weekly_work_hours, 1, 80),
      is_under_5_employees: Boolean(pick(data?.is_under_5_employees, 'is_under_5_employees')) || false,
      is_inclusive_wage: Boolean(pick(data?.is_inclusive_wage, 'is_inclusive_wage')) || false,
      monthly_standard_hours: num(pick(data?.monthly_standard_hours, 'monthly_standard_hours'), D.monthly_standard_hours, 1, 400),
      on_duty_pay_per_shift: num(pick(data?.on_duty_pay_per_shift, 'on_duty_pay_per_shift'), D.on_duty_pay_per_shift, 0, 10_000_000),
      workdays_mask: num(pick(data?.workdays_mask, 'workdays_mask'), D.workdays_mask, 0, 127),
    };
  } catch {
    return { ...D };
  }
}

/** L 근태 — 회사 전체 설정 저장 (신규 컬럼 upsert). */
export async function setAttendanceCompanySettings(
  companyId: string,
  patch: Partial<AttendanceCompanySettings>,
): Promise<void> {
  const row: Record<string, unknown> = { company_id: companyId };
  for (const k of [
    'work_start_time', 'work_end_time', 'lunch_minutes', 'late_grace_minutes',
    'night_start_time', 'night_end_time', 'weekly_work_hours',
    'is_under_5_employees', 'is_inclusive_wage', 'monthly_standard_hours',
    'on_duty_pay_per_shift', 'workdays_mask',
  ] as const) {
    if (patch[k] !== undefined) row[k] = patch[k];
  }
  const { error } = await db
    .from('company_settings')
    .upsert(row, { onConflict: 'company_id' });
  if (error) throw error;
}

// ── L 근태: 휴일 ──

export type Holiday = {
  id?: string;
  company_id: string;
  date: string;        // 'YYYY-MM-DD'
  name: string;
  type: 'legal' | 'company' | 'substitute';
};

export async function listHolidays(companyId: string, year?: number): Promise<Holiday[]> {
  let q = db.from('holidays').select('*').eq('company_id', companyId).order('date');
  if (year) {
    q = q.gte('date', `${year}-01-01`).lte('date', `${year}-12-31`);
  }
  const { data } = await q;
  return (data as Holiday[]) || [];
}

export async function upsertHoliday(h: Omit<Holiday, 'id'>): Promise<Holiday> {
  const { data, error } = await db
    .from('holidays')
    .upsert(h, { onConflict: 'company_id,date' })
    .select()
    .single();
  if (error) throw error;
  return data as Holiday;
}

export async function deleteHoliday(id: string): Promise<void> {
  const { error } = await db.from('holidays').delete().eq('id', id);
  if (error) throw error;
}

/** 한국 법정공휴일 1년치 일괄 추가 (DB RPC). */
export async function seedKoreanLegalHolidays(year: number): Promise<number> {
  const { data, error } = await db.rpc('seed_korean_legal_holidays', { p_year: year });
  if (error) throw error;
  return Number(data) || 0;
}

// ── L 근태: 재계산 (클라이언트 라운드트립 — SQL 의존 X) ──

/**
 * 기간 내 attendance_records 를 회사 설정·휴일 기반으로 재계산해 분 컬럼을 갱신.
 *   - read → calcDailyAttendance → 변경된 행만 update
 *   - RLS: 호출자가 본인 또는 admin 만 통과 (DB 정책이 자동 차단)
 *   - 반환: { updated, total }
 */
export async function recomputeAttendance(params: {
  companyId: string;
  employeeId?: string;     // 미지정 시 회사 전체
  from: string;            // 'YYYY-MM-DD'
  to: string;              // 'YYYY-MM-DD'
}): Promise<{ updated: number; total: number }> {
  // sec-reviewer 권장: silent fail 방지 — UPDATE RLS 가 admin only 라
  //   직원이 본인 employeeId 한정 호출은 허용하되, 그 외(전체 또는 타인)는
  //   클라이언트 단에서 명시 차단해 update 0 rows silent fail 회피.
  //   서버 권한은 RLS 가 최종 가드 — 클라이언트 체크는 UX 만.
  try {
    const me = await getCurrentUser();
    const isAdmin = me?.role === 'owner' || me?.role === 'admin';
    if (!isAdmin) {
      const myEmpId = await db
        .from('employees')
        .select('id')
        .eq('user_id', me?.id)
        .eq('company_id', params.companyId)
        .maybeSingle();
      const selfId = (myEmpId.data as { id: string } | null)?.id;
      if (!params.employeeId || params.employeeId !== selfId) {
        throw new Error('근태 재계산 권한이 없습니다. 본인 기록만 재계산할 수 있습니다.');
      }
    }
  } catch (e) {
    if ((e as Error)?.message?.startsWith('근태 재계산 권한')) throw e;
    // 사용자 조회 실패 등은 RLS 에 위임 (silent fallback)
  }

  const settings = await getAttendanceCompanySettings(params.companyId);

  // 휴일 set
  const fromYear = Number(params.from.slice(0, 4));
  const toYear = Number(params.to.slice(0, 4));
  const holidaySet = new Set<string>();
  for (let y = fromYear; y <= toYear; y++) {
    const hs = await listHolidays(params.companyId, y);
    hs.forEach((h) => holidaySet.add(h.date));
  }

  // 근태 행
  let q = db
    .from('attendance_records')
    .select('id, employee_id, date, check_in, check_out, attendance_type, status')
    .eq('company_id', params.companyId)
    .gte('date', params.from)
    .lte('date', params.to);
  if (params.employeeId) q = q.eq('employee_id', params.employeeId);
  const { data: rows, error } = await q;
  if (error) throw error;

  // 휴가 행 (on_leave 판단)
  const { data: leaves } = await db
    .from('leave_requests')
    .select('employee_id, start_date, end_date, status')
    .eq('company_id', params.companyId)
    .eq('status', 'approved')
    .lte('start_date', params.to)
    .gte('end_date', params.from);
  const leaveByEmpDate = new Set<string>();
  (leaves || []).forEach((l: any) => {
    const s = new Date(l.start_date);
    const e = new Date(l.end_date);
    for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
      leaveByEmpDate.add(`${l.employee_id}|${d.toISOString().slice(0, 10)}`);
    }
  });

  let updated = 0;
  const total = (rows || []).length;
  const touchedEmpMonths = new Set<string>(); // 'empId|YYYY-MM'
  for (const r of rows || []) {
    const result = calcDailyAttendance({
      check_in: r.check_in,
      check_out: r.check_out,
      date: r.date,
      settings,
      holidays: holidaySet,
      on_leave: leaveByEmpDate.has(`${r.employee_id}|${r.date}`),
      attendance_type: (r.attendance_type as any) || 'normal',
    });

    const { error: upErr } = await db
      .from('attendance_records')
      .update({
        is_late: result.is_late,
        late_minutes: result.late_minutes,
        regular_minutes: result.regular_minutes,
        overtime_minutes: result.overtime_minutes,
        night_minutes: result.night_minutes,
        holiday_minutes: result.holiday_minutes,
        is_holiday: result.is_holiday,
      })
      .eq('id', r.id);
    if (!upErr) {
      updated++;
      touchedEmpMonths.add(`${r.employee_id}|${(r.date as string).slice(0, 7)}`);
    }
  }

  // L 수당: attendance_records 갱신된 직원·월별로 allowance_entries 자동 chain.
  //   - source='auto' 행만 갱신, manual/edit 행은 보존 (force=false).
  //   - 실패 시 silent — 근태 재계산 자체는 성공으로 처리 (UI 가 별도 안내).
  if (touchedEmpMonths.size > 0) {
    try {
      const { recomputeMonthlyAllowances } = await import('./allowance-calc');
      for (const key of touchedEmpMonths) {
        const [empId, ym] = key.split('|');
        try {
          await recomputeMonthlyAllowances(empId, ym);
        } catch {
          // 단일 직원 실패는 다른 직원 진행을 막지 않음
        }
      }
    } catch {
      // 모듈 로드 실패 — 무시
    }
  }

  return { updated, total };
}

/**
 * 월간 가산수당 산정 (UI 표시·payroll 주입 준비용).
 *  - attendance_records 의 분 컬럼이 이미 채워져 있어야 정확. (recomputeAttendance 선행 권장)
 *  - on_duty_count: 별도 입력 (당직 횟수 — UI 에서 받아 전달)
 *  - 반환: MonthlyPayResult (overtime_pay/night_pay/holiday_pay/on_duty_pay/total_extra_pay/cap_exceeded/notes)
 */
export async function recomputeMonthlyExtraPay(params: {
  companyId: string;
  employeeId: string;
  year: number;
  month: number; // 1~12
  monthlyBaseSalary: number;
  onDutyCount?: number;
}): Promise<MonthlyPayResult> {
  const settings = await getAttendanceCompanySettings(params.companyId);

  const ym = `${params.year}-${String(params.month).padStart(2, '0')}`;
  const startDate = `${ym}-01`;
  const lastDay = new Date(params.year, params.month, 0).getDate();
  const endDate = `${ym}-${String(lastDay).padStart(2, '0')}`;

  const { data: rows } = await db
    .from('attendance_records')
    .select('regular_minutes, overtime_minutes, night_minutes, holiday_minutes, is_holiday, is_late, late_minutes, attendance_type')
    .eq('company_id', params.companyId)
    .eq('employee_id', params.employeeId)
    .gte('date', startDate)
    .lte('date', endDate);

  const daily_records: DailyResult[] = (rows || []).map((r: any) => ({
    is_late: !!r.is_late,
    late_minutes: Number(r.late_minutes || 0),
    regular_minutes: Number(r.regular_minutes || 0),
    overtime_minutes: Number(r.overtime_minutes || 0),
    night_minutes: Number(r.night_minutes || 0),
    holiday_minutes: Number(r.holiday_minutes || 0),
    is_holiday: !!r.is_holiday,
    work_minutes: Number(r.regular_minutes || 0) + Number(r.overtime_minutes || 0),
    attendance_type: (r.attendance_type as any) || 'normal',
  }));

  return calcOvertimePay({
    daily_records,
    settings,
    monthly_base_salary: params.monthlyBaseSalary,
    on_duty_count: params.onDutyCount || 0,
  });
}

// ── L 근태: 수정 요청 (직원 → 관리자) ──

export async function createAttendanceEditRequest(params: {
  companyId: string;
  attendanceRecordId: string;
  requestedBy: string;          // user id
  // sec-reviewer 권장: note 추가(핸드오프 명세). 화이트리스트 키만 허용.
  requestedChanges: { check_in?: string; check_out?: string; status?: string; attendance_type?: string; note?: string };
  reason?: string;
}) {
  const { data, error } = await db
    .from('attendance_edit_requests')
    .insert({
      company_id: params.companyId,
      attendance_record_id: params.attendanceRecordId,
      requested_by: params.requestedBy,
      requested_changes: params.requestedChanges,
      reason: params.reason || null,
      status: 'pending',
    })
    .select()
    .single();
  if (error) throw error;

  // 관리자(owner/admin) 에게 알림 (notifications_type_check 안전: 'system' 사용)
  try {
    const { data: admins } = await db
      .from('users')
      .select('id')
      .eq('company_id', params.companyId)
      .in('role', ['owner', 'admin']);
    const rows = (admins || []).map((a: { id: string }) => ({
      company_id: params.companyId,
      user_id: a.id,
      type: 'system',
      title: '근태 수정 요청',
      message: params.reason || '직원이 근태 기록 수정을 요청했습니다.',
      entity_type: 'attendance_edit_request',
      entity_id: data.id,
      is_read: false,
    }));
    if (rows.length) await db.from('notifications').insert(rows);
  } catch (e) {
    // 알림 실패는 요청 자체를 막지 않음
    if (typeof window !== 'undefined') {
      // 클라이언트만 — 서버 console.log 금지
      console.warn('[createAttendanceEditRequest] 알림 실패:', e);
    }
  }
  return data;
}

export async function listAttendanceEditRequests(companyId: string, status?: 'pending' | 'approved' | 'rejected') {
  let q = db
    .from('attendance_edit_requests')
    .select('*, attendance_records!inner(id, date, employee_id, check_in, check_out, status, employees(name))')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });
  if (status) q = q.eq('status', status);
  const { data } = await q;
  return data || [];
}

export async function reviewAttendanceEditRequest(params: {
  requestId: string;
  reviewerId: string;
  decision: 'approved' | 'rejected';
  applyChanges?: boolean; // 승인 시 attendance_records 에 적용
}) {
  const { data: req, error: rErr } = await db
    .from('attendance_edit_requests')
    .select('*')
    .eq('id', params.requestId)
    .single();
  if (rErr) throw rErr;

  // 승인 + applyChanges 면 attendance_records 갱신
  if (params.decision === 'approved' && params.applyChanges) {
    const changes = (req.requested_changes || {}) as Record<string, unknown>;
    const updatePayload: Record<string, unknown> = { edited_by: params.reviewerId, edited_at: new Date().toISOString() };
    // 화이트리스트 적용 — 임의 jsonb 키 차단 (sec-reviewer 권장)
    if (changes.check_in) updatePayload.check_in = changes.check_in;
    if (changes.check_out) updatePayload.check_out = changes.check_out;
    if (changes.status) updatePayload.status = changes.status;
    if (changes.attendance_type) updatePayload.attendance_type = changes.attendance_type;
    if (changes.note !== undefined) updatePayload.note = changes.note;
    const { error: uErr } = await db
      .from('attendance_records')
      .update(updatePayload)
      .eq('id', req.attendance_record_id);
    if (uErr) throw uErr;
  }

  const { error } = await db
    .from('attendance_edit_requests')
    .update({
      status: params.decision,
      reviewed_by: params.reviewerId,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', params.requestId);
  if (error) throw error;
}

// re-export 타입 (UI 가 attendance-calc 직접 임포트 안 해도 되게)
export type { AttendanceCompanySettings, MonthlyPayResult } from './attendance-calc';

/**
 * KST(Asia/Seoul) 기준 현재 분(分) 단위 시각 (0~1439).
 * `date` 미지정 시 호출 시점 사용. 테스트용으로 Date 주입 가능.
 */
export function nowKstMinutes(date: Date = new Date()): number {
  // Intl 로 KST 의 H/m 추출 — 서버 TZ 무관하게 정확
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const h = Number(parts.find(p => p.type === 'hour')?.value ?? '0');
  const m = Number(parts.find(p => p.type === 'minute')?.value ?? '0');
  return h * 60 + m;
}

/** 'HH:MM' → 분. 형식 오류 시 540 (09:00) fallback. */
function parseHhmmToMinutes(hhmm: string): number {
  if (!/^\d{2}:\d{2}$/.test(hhmm)) return 540;
  const [h, m] = hhmm.split(':').map(Number);
  if (h < 0 || h > 23 || m < 0 || m > 59) return 540;
  return h * 60 + m;
}

/**
 * 출근 시각이 지각인지 판정 (회사 정책 기준).
 * 자정 직전·새벽 등 엣지: 분 단위 비교라 안전.
 */
export function isLate(currentKstMin: number, policy: AttendancePolicy): boolean {
  const start = parseHhmmToMinutes(policy.workStartTime);
  return currentKstMin > start + policy.lateThresholdMinutes;
}

// ── Attendance: Check In ──
// 시그니처 불변: (companyId, employeeId, status?)
// status === 'auto' (기본) → 회사 정책 기준 KST 시각으로 present/late 자동 판정
export async function checkIn(companyId: string, employeeId: string, status: string = "auto") {
  if (status === "auto") {
    const policy = await getAttendancePolicy(companyId);
    const mins = nowKstMinutes();
    status = isLate(mins, policy) ? "late" : "present";
  }
  return invokeAttendance("checkin", { companyId, employeeId, status });
}

// ── Attendance: Check Out ──
export async function checkOut(employeeId: string, companyId: string, date?: string) {
  const result = await invokeAttendance("checkout", { companyId, employeeId, ...(date ? { date } : {}) });
  // L 근태 — checkOut 직후 해당 일자의 attendance_records 즉시 재계산.
  //   · is_late / late_minutes / regular_minutes / overtime_minutes / night_minutes / holiday_minutes 채움
  //   · recomputeAttendance 안에서 allowance_entries chain 자동 (회사 분기 룰 반영)
  //   · 실패해도 checkOut 자체는 성공 처리 (회귀 방지) — 백그라운드 silent
  try {
    const targetDate = date || new Date().toISOString().slice(0, 10);
    await recomputeAttendance({
      companyId,
      employeeId,
      from: targetDate,
      to: targetDate,
    });
  } catch (e) {
    if (typeof window !== 'undefined') {
      // 클라이언트만 — 서버 console.log 금지
      console.warn('[checkOut] recompute chain 실패 (체크아웃은 성공):', e);
    }
  }
  return result;
}

// ── Attendance: Cancel Check Out ──
export async function cancelCheckOut(employeeId: string, companyId: string, date?: string) {
  return invokeAttendance("cancel_checkout", { companyId, employeeId, ...(date ? { date } : {}) });
}

// ── Attendance: Admin correction ──
export async function correctAttendanceRecord(recordId: string, updates: {
  check_in?: string;
  check_out?: string;
  status?: string;
}) {
  // Recalculate work hours if both check_in and check_out are provided
  let workHours: number | undefined;
  let overtimeHours: number | undefined;

  if (updates.check_in && updates.check_out) {
    const checkInTime = new Date(updates.check_in).getTime();
    const checkOutTime = new Date(updates.check_out).getTime();
    const diffHours = (checkOutTime - checkInTime) / (1000 * 60 * 60);
    workHours = Math.round(Math.max(0, diffHours - 1) * 100) / 100; // subtract 1hr lunch
    overtimeHours = Math.round(Math.max(0, workHours - 8) * 100) / 100;
  }

  const updatePayload: Record<string, any> = {};
  if (updates.check_in) updatePayload.check_in = updates.check_in;
  if (updates.check_out) updatePayload.check_out = updates.check_out;
  if (updates.status) updatePayload.status = updates.status;
  if (workHours !== undefined) updatePayload.work_hours = workHours;
  if (overtimeHours !== undefined) updatePayload.overtime_hours = overtimeHours;

  const { data, error } = await db
    .from('attendance_records')
    .update(updatePayload)
    .eq('id', recordId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ── Attendance: Get records by date range ──
export async function getAttendanceRecords(companyId: string, startDate: string, endDate: string) {
  const { data } = await db
    .from('attendance_records')
    .select('*, employees(name, department)')
    .eq('company_id', companyId)
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date', { ascending: false });
  return data || [];
}

// ── Attendance: Get monthly attendance for one employee ──
export async function getEmployeeAttendance(employeeId: string, month: string) {
  // month = 'YYYY-MM'
  const startDate = `${month}-01`;
  const endDate = `${month}-${String(new Date(Number(month.slice(0,4)), Number(month.slice(5,7)), 0).getDate()).padStart(2, '0')}`;
  const { data } = await db
    .from('attendance_records')
    .select('*')
    .eq('employee_id', employeeId)
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date');
  return data || [];
}

// ── Attendance: Weekly hours (52-hour monitoring) ──
export async function calculateWeeklyHours(employeeId: string, weekStart: string) {
  // weekStart = Monday YYYY-MM-DD
  const start = new Date(weekStart);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const endStr = end.toISOString().slice(0, 10);

  const { data } = await db
    .from('attendance_records')
    .select('work_hours')
    .eq('employee_id', employeeId)
    .gte('date', weekStart)
    .lte('date', endStr);

  const totalHours = (data || []).reduce((sum: number, r: any) => sum + Number(r.work_hours || 0), 0);
  return Math.round(totalHours * 100) / 100;
}

// ── Attendance: Monthly summary per employee ──
export async function getMonthlyAttendanceSummary(companyId: string, yearMonth: string) {
  // yearMonth = 'YYYY-MM'
  const startDate = `${yearMonth}-01`;
  const [y, m] = yearMonth.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const endDate = `${yearMonth}-${String(lastDay).padStart(2, '0')}`;

  const { data: records } = await db
    .from('attendance_records')
    .select('employee_id, status, work_hours, employees(name, department)')
    .eq('company_id', companyId)
    .gte('date', startDate)
    .lte('date', endDate);

  if (!records) return [];

  // Group by employee
  const map: Record<string, {
    employee_id: string;
    name: string;
    department: string;
    totalDays: number;
    lateDays: number;
    absentDays: number;
    remoteDays: number;
    halfDays: number;
    totalHours: number;
  }> = {};

  records.forEach((r: any) => {
    if (!map[r.employee_id]) {
      map[r.employee_id] = {
        employee_id: r.employee_id,
        name: r.employees?.name || '',
        department: r.employees?.department || '',
        totalDays: 0,
        lateDays: 0,
        absentDays: 0,
        remoteDays: 0,
        halfDays: 0,
        totalHours: 0,
      };
    }
    const entry = map[r.employee_id];
    entry.totalDays++;
    if (r.status === 'late') entry.lateDays++;
    if (r.status === 'absent') entry.absentDays++;
    if (r.status === 'remote') entry.remoteDays++;
    if (r.status === 'half_day') entry.halfDays++;
    entry.totalHours += Number(r.work_hours || 0);
  });

  return Object.values(map);
}

// ── Leave: Get requests ──
export async function getLeaveRequests(companyId: string, status?: string) {
  let query = db
    .from('leave_requests')
    .select('*, employees(name, department), requested_approver:requested_approver_id(name, email)')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });
  if (status) query = query.eq('status', status);
  const { data: leaveData } = await query;

  let approvalQuery = db
    .from('approval_requests')
    .select('*, users(name, email)')
    .eq('company_id', companyId)
    .eq('request_type', 'leave')
    .order('created_at', { ascending: false });
  if (status) approvalQuery = approvalQuery.eq('status', status);
  const { data: approvalLeaves } = await approvalQuery;

  const mapped = (approvalLeaves || []).map((a: any) => ({
    id: `approval-${a.id}`,
    company_id: a.company_id,
    employee_id: a.requester_id,
    leave_type: a.description?.match(/종류:\s*(\S+)/)?.[1] || 'annual',
    start_date: a.description?.match(/기간:\s*(\S+)/)?.[1] || a.created_at?.slice(0, 10),
    end_date: a.description?.match(/~\s*(\S+)/)?.[1] || a.created_at?.slice(0, 10),
    days: Number(a.description?.match(/(\d+(?:\.\d+)?)일/)?.[1]) || 1,
    reason: a.title,
    status: a.status,
    created_at: a.created_at,
    employees: a.users ? { name: a.users.name || a.users.email, department: '' } : null,
    _source: 'approval',
  }));

  return [...(leaveData || []), ...mapped];
}

// ── Leave: Create request (2시간/반차/종일 지원) ──
export async function createLeaveRequest(params: {
  companyId: string;
  employeeId: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  days: number;
  reason?: string;
  leaveUnit?: LeaveUnit;
  startTime?: string; // "09:00" (2시간 단위용)
  endTime?: string;   // "11:00"
  requestedApproverId?: string | null; // 직원이 직접 지정한 승인자 (owner/admin user)
}) {
  // Auto-calculate days based on leave unit
  const unit = params.leaveUnit || 'full_day';
  let days = params.days;
  if (unit === 'half_day') {
    days = 0.5;
  } else if (unit === 'two_hours') {
    days = 0.25;
  }

  // Validate remaining balance for annual leave
  if (params.leaveType === 'annual') {
    const year = new Date(params.startDate).getFullYear();
    const { data: balance } = await db
      .from('leave_balances')
      .select('total_days, used_days')
      .eq('employee_id', params.employeeId)
      .eq('year', year)
      .maybeSingle();

    if (balance) {
      const remaining = Number(balance.total_days) - Number(balance.used_days);
      if (days > remaining) {
        throw new Error(`연차 잔여일수가 부족합니다 (잔여: ${remaining}일, 신청: ${days}일)`);
      }
    }
  }

  const { data, error } = await db
    .from('leave_requests')
    .insert({
      company_id: params.companyId,
      employee_id: params.employeeId,
      leave_type: params.leaveType,
      start_date: params.startDate,
      end_date: params.endDate,
      days,
      reason: params.reason || null,
      status: 'pending',
      leave_unit: unit,
      start_time: params.startTime || null,
      end_time: params.endTime || null,
      requested_approver_id: params.requestedApproverId || null,
    })
    .select()
    .single();
  if (error) throw error;

  // 승인자 + 회사 owner/admin 전원에게 알림 (지정 승인자 우선)
  try {
    const [{ data: emp }, { data: admins }] = await Promise.all([
      db.from('employees').select('name').eq('id', params.employeeId).maybeSingle(),
      db.from('users').select('id').eq('company_id', params.companyId).in('role', ['owner', 'admin']),
    ]);
    const empName = emp?.name || '직원';
    const leaveLabel = LEAVE_TYPES.find((t) => t.value === params.leaveType)?.label || params.leaveType;
    const period = params.startDate === params.endDate
      ? params.startDate
      : `${params.startDate} ~ ${params.endDate}`;

    const recipientIds = new Set<string>();
    if (params.requestedApproverId) recipientIds.add(params.requestedApproverId);
    (admins || []).forEach((a: { id: string }) => recipientIds.add(a.id));

    const rows = Array.from(recipientIds).map((uid) => ({
      company_id: params.companyId,
      user_id: uid,
      type: 'approval',
      title: `${empName} - ${leaveLabel} 신청 (${days}일)`,
      message: `${period}${params.reason ? ` · ${params.reason}` : ''}`,
      entity_type: 'leave_request',
      entity_id: data.id,
      is_read: false,
    }));
    if (rows.length > 0) {
      await db.from('notifications').insert(rows);
    }
  } catch (e) {
    console.error('[createLeaveRequest] 알림 발송 실패:', e);
    // 알림 실패는 신청 자체를 막지 않음
  }

  return data;
}

// ── Leave: Approve ──
export async function approveLeaveRequest(id: string, approverId: string) {
  // Get the request first
  const { data: request } = await db
    .from('leave_requests')
    .select('*, employees(name, user_id)')
    .eq('id', id)
    .single();

  if (!request) throw new Error('휴가 신청을 찾을 수 없습니다');

  // Update leave request status
  const { error } = await db
    .from('leave_requests')
    .update({
      status: 'approved',
      approved_by: approverId,
      approved_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throw error;

  // Update leave balance: increment used_days
  const year = new Date(request.start_date).getFullYear();
  const { data: balance } = await db
    .from('leave_balances')
    .select('*')
    .eq('employee_id', request.employee_id)
    .eq('year', year)
    .maybeSingle();

  if (balance) {
    const newUsed = Number(balance.used_days) + Number(request.days);
    await db
      .from('leave_balances')
      .update({ used_days: newUsed })
      .eq('id', balance.id);
  }

  // 신청자에게 승인 알림
  await notifyLeaveDecision(request, 'approved');
}

// ── Leave: Reject ──
export async function rejectLeaveRequest(id: string, approverId: string) {
  const { data: request } = await db
    .from('leave_requests')
    .select('*, employees(name, user_id)')
    .eq('id', id)
    .single();
  if (!request) throw new Error('휴가 신청을 찾을 수 없습니다');

  const { error } = await db
    .from('leave_requests')
    .update({
      status: 'rejected',
      approved_by: approverId,
      approved_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throw error;

  await notifyLeaveDecision(request, 'rejected');
}

// ── Leave: Cancel (취소) ──
// 승인된(used_days 반영된) 휴가를 취소하면 잔여일을 되돌린다.
export async function cancelLeaveRequest(id: string) {
  const { data: request } = await db
    .from('leave_requests')
    .select('*, employees(name, user_id)')
    .eq('id', id)
    .single();
  if (!request) throw new Error('휴가 신청을 찾을 수 없습니다');
  if (request.status === 'cancelled') return;

  // v4 H2: 이미 시작된 휴가(start_date <= today) 는 취소 불가.
  //   start_date 가 미래(>today KST) 인 휴가만 취소 가능.
  const todayKst = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date()); // 'YYYY-MM-DD'
  if (request.start_date <= todayKst) {
    throw new Error('이미 시작된(또는 오늘) 휴가는 취소할 수 없습니다. 시작 전 휴가만 취소 가능합니다.');
  }

  const wasApproved = request.status === 'approved';

  const { error } = await db
    .from('leave_requests')
    .update({ status: 'cancelled' })
    .eq('id', id);
  if (error) throw error;

  // 승인 상태였다면 차감했던 used_days 복구
  if (wasApproved) {
    const year = new Date(request.start_date).getFullYear();
    const { data: balance } = await db
      .from('leave_balances')
      .select('*')
      .eq('employee_id', request.employee_id)
      .eq('year', year)
      .maybeSingle();
    if (balance) {
      const restored = Math.max(0, Number(balance.used_days) - Number(request.days));
      await db.from('leave_balances').update({ used_days: restored }).eq('id', balance.id);
    }
  }

  // 신청자에게 취소 알림
  try {
    const requesterUserId = request?.employees?.user_id;
    if (requesterUserId) {
      const leaveLabel = LEAVE_TYPES.find((t) => t.value === request.leave_type)?.label || request.leave_type;
      const period = request.start_date === request.end_date
        ? request.start_date
        : `${request.start_date} ~ ${request.end_date}`;
      const rows: Record<string, unknown>[] = [{
        company_id: request.company_id,
        user_id: requesterUserId,
        type: 'approval',
        title: `휴가 취소 — ${leaveLabel} (${Number(request.days)}일)`,
        message: `${period} 휴가가 취소되었습니다.${wasApproved ? ' 연차 잔여가 복구되었습니다.' : ''}`,
        entity_type: 'leave_request',
        entity_id: request.id,
        is_read: false,
      }];
      // v4 H2: 승인했던 관리자에게도 통지
      if (wasApproved && request.approved_by && request.approved_by !== requesterUserId) {
        rows.push({
          company_id: request.company_id,
          user_id: request.approved_by,
          type: 'approval',
          title: `휴가 취소 — ${request.employees?.name || '직원'} (${Number(request.days)}일)`,
          message: `${period} 휴가가 신청자에 의해 취소되었습니다.`,
          entity_type: 'leave_request',
          entity_id: request.id,
          is_read: false,
        });
      }
      await db.from('notifications').insert(rows);
    }
  } catch (e) {
    console.error('[cancelLeaveRequest] 알림 실패:', e);
  }
}

// 휴가 결재 결과 알림 — 신청자(직원 계정) 에게.
async function notifyLeaveDecision(request: any, decision: 'approved' | 'rejected') {
  try {
    const requesterUserId = request?.employees?.user_id;
    if (!requesterUserId) return; // 직원이 user 계정과 연결돼 있지 않으면 알림 못 보냄
    const leaveLabel = LEAVE_TYPES.find((t) => t.value === request.leave_type)?.label || request.leave_type;
    const period = request.start_date === request.end_date
      ? request.start_date
      : `${request.start_date} ~ ${request.end_date}`;
    await db.from('notifications').insert({
      company_id: request.company_id,
      user_id: requesterUserId,
      type: decision === 'approved' ? 'approval' : 'approval',
      title: decision === 'approved'
        ? `휴가 신청 승인 — ${leaveLabel} (${Number(request.days)}일)`
        : `휴가 신청 반려 — ${leaveLabel} (${Number(request.days)}일)`,
      message: period,
      entity_type: 'leave_request',
      entity_id: request.id,
      is_read: false,
    });
  } catch (e) {
    console.error('[notifyLeaveDecision] 알림 발송 실패:', e);
  }
}

// ── Leave: Get balances ──
export async function getLeaveBalances(companyId: string, year: number) {
  const { data } = await db
    .from('leave_balances')
    .select('*, employees(name, department)')
    .eq('company_id', companyId)
    .eq('year', year);
  return data || [];
}

// ── Leave: 근로기준법 기반 연차 자동계산 ──
/**
 * 근로기준법 제60조 연차유급휴가 자동계산
 * - 1년 미만 재직: 매월 개근 시 1일 (최대 11일)
 * - 1년 이상 재직: 15일
 * - 3년 이상 재직: 매 2년 초과 근무마다 1일 가산 (최대 25일)
 * @param hireDate 입사일 (YYYY-MM-DD)
 * @param referenceDate 기준일 (기본: 오늘)
 */
export function calculateAnnualLeave(hireDate: string, referenceDate?: string): {
  totalDays: number;
  yearsWorked: number;
  monthsWorked: number;
  formula: string;
} {
  const hire = new Date(hireDate);
  const ref = referenceDate ? new Date(referenceDate) : new Date();

  // 총 근무 개월수
  const diffMs = ref.getTime() - hire.getTime();
  if (diffMs < 0) return { totalDays: 0, yearsWorked: 0, monthsWorked: 0, formula: '입사 전' };

  const totalMonths = (ref.getFullYear() - hire.getFullYear()) * 12 + (ref.getMonth() - hire.getMonth());
  const yearsWorked = Math.floor(totalMonths / 12);
  const monthsWorked = totalMonths;

  let totalDays: number;
  let formula: string;

  if (yearsWorked < 1) {
    // 1년 미만: 매월 1일, 최대 11일
    totalDays = Math.min(totalMonths, 11);
    formula = `1년 미만 (${totalMonths}개월) → 월 1일 × ${totalDays}개월 = ${totalDays}일`;
  } else {
    // 1년 이상: 기본 15일
    let base = 15;
    // 3년 이상: 매 2년 초과근무마다 +1일
    if (yearsWorked >= 3) {
      const extraDays = Math.floor((yearsWorked - 1) / 2);
      base = Math.min(15 + extraDays, 25);
    }
    totalDays = base;
    formula = yearsWorked >= 3
      ? `${yearsWorked}년 근속 → 15일 + ${totalDays - 15}일(장기근속) = ${totalDays}일`
      : `${yearsWorked}년 근속 → 기본 ${totalDays}일`;
  }

  return { totalDays, yearsWorked, monthsWorked, formula };
}

/**
 * 직원의 연차를 입사일 기반으로 자동 세팅 (사용연차 수동 지정 가능)
 */
export async function autoInitLeaveBalance(
  companyId: string,
  employeeId: string,
  hireDate: string,
  year: number,
  usedDaysOverride?: number,
) {
  const { totalDays } = calculateAnnualLeave(hireDate, `${year}-12-31`);

  const { data: existing } = await db
    .from('leave_balances')
    .select('id, used_days')
    .eq('company_id', companyId)
    .eq('employee_id', employeeId)
    .eq('year', year)
    .maybeSingle();

  const usedDays = usedDaysOverride ?? existing?.used_days ?? 0;

  if (existing) {
    const { data, error } = await db
      .from('leave_balances')
      .update({ total_days: totalDays, used_days: usedDays })
      .eq('id', existing.id)
      .select()
      .single();
    if (error) throw error;
    return data;
  } else {
    const { data, error } = await db
      .from('leave_balances')
      .insert({ company_id: companyId, employee_id: employeeId, year, total_days: totalDays, used_days: usedDays })
      .select()
      .single();
    if (error) throw error;
    return data;
  }
}

/**
 * 전 직원 연차 일괄 자동 세팅 (입사일 기반)
 */
export async function bulkAutoInitLeaveBalances(companyId: string, year: number) {
  const { data: employees } = await db
    .from('employees')
    .select('id, hire_date')
    .eq('company_id', companyId)
    .in('status', ['active', 'joined']);

  if (!employees || employees.length === 0) return { updated: 0 };

  let updated = 0;
  for (const emp of employees) {
    if (!emp.hire_date) continue;
    await autoInitLeaveBalance(companyId, emp.id, emp.hire_date, year);
    updated++;
  }
  return { updated };
}

// ── Leave Promotion (연차촉진) — 근로기준법 §61 ──

/**
 * 연차촉진 대상 직원 조회
 * 미사용 연차가 있는 직원 목록 반환
 */
export async function getLeavePromotionCandidates(companyId: string, year: number) {
  const { data: balances } = await db
    .from('leave_balances')
    .select('*, employees(name, email, department, hire_date)')
    .eq('company_id', companyId)
    .eq('year', year);

  if (!balances) return [];

  return balances
    .filter((b: any) => {
      const remaining = Number(b.total_days) - Number(b.used_days);
      return remaining > 0;
    })
    .map((b: any) => ({
      employeeId: b.employee_id,
      employeeName: b.employees?.name || '',
      email: b.employees?.email || '',
      department: b.employees?.department || '',
      hireDate: b.employees?.hire_date || '',
      totalDays: Number(b.total_days),
      usedDays: Number(b.used_days),
      remainingDays: Number(b.total_days) - Number(b.used_days),
      year,
    }));
}

/**
 * 연차촉진 통보 발송
 * 근로기준법 §61: 사용자는 연차 소멸 6개월 전(1차) / 2개월 전(2차)에 통보해야 함
 * 통보 미이행 시 미사용 연차에 대한 보상의무 발생
 */
export async function sendLeavePromotionNotice(params: {
  companyId: string;
  employeeId: string;
  year: number;
  noticeType: 'first' | 'second'; // first=6개월전, second=2개월전
  unusedDays: number;
  email: string;
  employeeName: string;
}) {
  const { companyId, employeeId, year, noticeType, unusedDays, email, employeeName } = params;

  // Calculate deadline based on notice type
  const deadline = new Date();
  if (noticeType === 'first') {
    deadline.setMonth(deadline.getMonth() + 4); // 4개월 내 사용 계획 제출
  } else {
    deadline.setMonth(deadline.getMonth() + 1); // 1개월 내 사용
  }

  // Record the notice
  const { data: notice, error } = await db
    .from('leave_promotion_notices')
    .insert({
      company_id: companyId,
      employee_id: employeeId,
      year,
      notice_type: noticeType,
      unused_days: unusedDays,
      sent_via: 'email',
      email_to: email,
      deadline: deadline.toISOString().slice(0, 10),
    })
    .select()
    .single();

  if (error) throw error;

  // Get company name
  const { data: company } = await db
    .from('companies')
    .select('name')
    .eq('id', companyId)
    .single();

  // Send email via Edge Function
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { notice, emailSent: false };

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/send-leave-promotion-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        to: email,
        employeeName,
        companyName: company?.name || '',
        year,
        noticeType,
        unusedDays,
        deadline: deadline.toISOString().slice(0, 10),
      }),
    });

    return { notice, emailSent: res.ok };
  } catch {
    return { notice, emailSent: false };
  }
}

/**
 * 연차촉진 통보 이력 조회
 */
export async function getLeavePromotionNotices(companyId: string, year: number) {
  const { data } = await db
    .from('leave_promotion_notices')
    .select('*, employees(name, department)')
    .eq('company_id', companyId)
    .eq('year', year)
    .order('sent_at', { ascending: false });

  return data || [];
}

// ── Leave: Init/update balance ──
export async function initLeaveBalance(companyId: string, employeeId: string, year: number, totalDays: number) {
  // Check if exists
  const { data: existing } = await db
    .from('leave_balances')
    .select('id')
    .eq('company_id', companyId)
    .eq('employee_id', employeeId)
    .eq('year', year)
    .maybeSingle();

  if (existing) {
    const { data, error } = await db
      .from('leave_balances')
      .update({ total_days: totalDays })
      .eq('id', existing.id)
      .select()
      .single();
    if (error) throw error;
    return data;
  } else {
    const { data, error } = await db
      .from('leave_balances')
      .insert({
        company_id: companyId,
        employee_id: employeeId,
        year,
        total_days: totalDays,
        used_days: 0,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  }
}

// ── Leave: 부여 방식 (자동부여 / 직접입력) ──
// company_settings.settings JSONB 에 저장 (스키마 변경 아님)

export type LeaveGrantMethod = 'auto' | 'manual';

/** 회사의 연차 부여 방식 조회. 미설정 시 'auto'(입사일 기준) 기본값. */
export async function getLeaveGrantMethod(companyId: string): Promise<LeaveGrantMethod> {
  const { data } = await db
    .from('company_settings')
    .select('settings')
    .eq('company_id', companyId)
    .maybeSingle();
  const m = data?.settings?.leave_grant_method;
  return m === 'manual' ? 'manual' : 'auto';
}

/** 연차 부여 방식 저장 (기존 settings JSONB 의 다른 키 보존). */
export async function setLeaveGrantMethod(companyId: string, method: LeaveGrantMethod): Promise<void> {
  const { data: existing } = await db
    .from('company_settings')
    .select('settings')
    .eq('company_id', companyId)
    .maybeSingle();

  const nextSettings = { ...(existing?.settings || {}), leave_grant_method: method };

  const { error } = await db
    .from('company_settings')
    .upsert(
      { company_id: companyId, settings: nextSettings },
      { onConflict: 'company_id' },
    );
  if (error) throw error;
}

// ── L 수당: 카탈로그 CRUD (UI C-1 에서 사용) ──

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

/** 회사 수당 카탈로그 조회 (display_order ASC). */
export async function listAllowanceTypes(companyId: string): Promise<AllowanceTypeRow[]> {
  const { data, error } = await db
    .from('allowance_types')
    .select('*')
    .eq('company_id', companyId)
    .order('display_order', { ascending: true });
  if (error) throw error;
  return (data as AllowanceTypeRow[]) || [];
}

/** 수당 추가 — code 자동 생성 (slug + random4). 관리자만(RLS). */
export async function createAllowanceType(params: {
  companyId: string;
  name: string;
  calc_mode: AllowanceTypeRow['calc_mode'];
  base_field?: string | null;
  rate_type: AllowanceTypeRow['rate_type'];
  rate_amount: number;
  applies_to?: AllowanceTypeRow['applies_to'];
  target_employee_ids?: string[];
  display_order?: number;
  is_active?: boolean;
}): Promise<AllowanceTypeRow> {
  // slug + random4
  const baseSlug = (params.name || 'custom')
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24) || 'custom';
  const rand4 = Math.random().toString(36).slice(2, 6);
  const code = `${baseSlug}_${rand4}`;

  const row = {
    company_id: params.companyId,
    code,
    name: params.name,
    calc_mode: params.calc_mode,
    base_field: params.base_field ?? null,
    rate_type: params.rate_type,
    rate_amount: params.rate_amount,
    is_legal_mandatory: false,
    is_active: params.is_active ?? true,
    applies_to: params.applies_to || 'all',
    target_employee_ids: params.target_employee_ids || [],
    display_order: params.display_order ?? 100,
  };
  const { data, error } = await db
    .from('allowance_types')
    .insert(row)
    .select()
    .single();
  if (error) throw error;
  return data as AllowanceTypeRow;
}

/** 수당 수정 — 법정행은 DB 트리거가 code/is_legal_mandatory 변경 차단. */
export async function updateAllowanceType(
  id: string,
  patch: Partial<Omit<AllowanceTypeRow, 'id' | 'company_id' | 'code' | 'is_legal_mandatory'>>,
): Promise<void> {
  const { error } = await db
    .from('allowance_types')
    .update(patch)
    .eq('id', id);
  if (error) throw error;
}

/** 수당 삭제 — 법정행은 DB 트리거가 거부 (RAISE EXCEPTION). */
export async function deleteAllowanceType(id: string): Promise<void> {
  const { error } = await db.from('allowance_types').delete().eq('id', id);
  if (error) throw error;
}

/** 회사 법정 4종 재seed (단가 바뀌어 INSERT 재실행 — ON CONFLICT DO NOTHING). */
export async function seedLegalAllowances(companyId: string): Promise<number> {
  const { data, error } = await db.rpc('seed_legal_allowances', { p_company_id: companyId });
  if (error) throw error;
  return Number(data) || 0;
}

// ── L 수당: 월별 entries 조회/편집 (UI C-2, C-3 에서 사용) ──

export type AllowanceEntryRow = {
  id: string;
  company_id: string;
  employee_id: string;
  payroll_month: string; // 'YYYY-MM'
  allowance_type_id: string;
  calculated_minutes: number | null;
  count: number | null;
  amount: number;
  source: 'auto' | 'manual' | 'edit';
  edited_by: string | null;
  edited_at: string | null;
  note: string | null;
};

/** 본인 월별 수당 — RLS 가 본인 또는 admin 만 허용. */
export async function listMyAllowanceEntries(
  employeeId: string,
  yyyymm: string,
): Promise<AllowanceEntryRow[]> {
  const { data, error } = await db
    .from('allowance_entries')
    .select('*')
    .eq('employee_id', employeeId)
    .eq('payroll_month', yyyymm);
  if (error) throw error;
  return (data as AllowanceEntryRow[]) || [];
}

/** 회사 전체 직원의 월별 수당 — admin only(RLS). */
export async function listCompanyAllowanceEntries(
  companyId: string,
  yyyymm: string,
): Promise<AllowanceEntryRow[]> {
  const { data, error } = await db
    .from('allowance_entries')
    .select('*')
    .eq('company_id', companyId)
    .eq('payroll_month', yyyymm);
  if (error) throw error;
  return (data as AllowanceEntryRow[]) || [];
}

/** 관리자 — entries 셀 인라인 수정 (source='edit', edited_by 기록). */
export async function upsertAllowanceEntryManual(params: {
  companyId: string;
  employeeId: string;
  payrollMonth: string;
  allowanceTypeId: string;
  amount: number;
  editedBy: string;
  source?: 'manual' | 'edit';
  note?: string;
}): Promise<void> {
  const row = {
    company_id: params.companyId,
    employee_id: params.employeeId,
    payroll_month: params.payrollMonth,
    allowance_type_id: params.allowanceTypeId,
    amount: Math.round(params.amount),
    source: params.source || 'edit',
    edited_by: params.editedBy,
    edited_at: new Date().toISOString(),
    note: params.note ?? null,
  };
  const { error } = await db
    .from('allowance_entries')
    .upsert(row, {
      onConflict: 'company_id,employee_id,payroll_month,allowance_type_id',
    });
  if (error) throw error;
}
