/**
 * OwnerView HR Engine
 * 급여이력 + 계약서 + 근태관리 + 휴가관리
 */

import { supabase } from './supabase';

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

// ── Attendance: Check In ──
export async function checkIn(companyId: string, employeeId: string, status: string = "auto") {
  if (status === "auto") {
    const hour = new Date().getHours();
    const minute = new Date().getMinutes();
    status = (hour > 9 || (hour === 9 && minute > 30)) ? "late" : "present";
  }
  return invokeAttendance("checkin", { companyId, employeeId, status });
}

// ── Attendance: Check Out ──
export async function checkOut(employeeId: string, companyId: string, date?: string) {
  return invokeAttendance("checkout", { companyId, employeeId, ...(date ? { date } : {}) });
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
      await db.from('notifications').insert({
        company_id: request.company_id,
        user_id: requesterUserId,
        type: 'approval',
        title: `휴가 취소 — ${leaveLabel} (${Number(request.days)}일)`,
        message: `${period} 휴가가 취소되었습니다.${wasApproved ? ' 연차 잔여가 복구되었습니다.' : ''}`,
        entity_type: 'leave_request',
        entity_id: request.id,
        is_read: false,
      });
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
