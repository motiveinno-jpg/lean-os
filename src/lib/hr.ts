/**
 * LeanOS HR Engine
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
    .eq('status', 'active')
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

// ── Employee update with new fields ──
export async function updateEmployee(employeeId: string, updates: {
  department?: string;
  position?: string;
  email?: string;
  phone?: string;
  contractType?: string;
}) {
  const { error } = await db
    .from('employees')
    .update({
      department: updates.department,
      position: updates.position,
      email: updates.email,
      phone: updates.phone,
      contract_type: updates.contractType,
    })
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
  { value: 'annual', label: '연차' },
  { value: 'sick', label: '병가' },
  { value: 'personal', label: '경조사' },
  { value: 'maternity', label: '출산휴가' },
  { value: 'paternity', label: '배우자출산휴가' },
  { value: 'compensation', label: '대체휴무' },
] as const;

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

// ── Attendance: Check In ──
export async function checkIn(companyId: string, employeeId: string) {
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();

  // Check if already checked in today
  const { data: existing } = await db
    .from('attendance_records')
    .select('id')
    .eq('employee_id', employeeId)
    .eq('date', today)
    .maybeSingle();

  if (existing) {
    throw new Error('이미 오늘 출근 기록이 있습니다');
  }

  // Determine status: if check-in after 09:30, it's late
  const hour = new Date().getHours();
  const minute = new Date().getMinutes();
  const status = (hour > 9 || (hour === 9 && minute > 30)) ? 'late' : 'present';

  const { data, error } = await db
    .from('attendance_records')
    .insert({
      company_id: companyId,
      employee_id: employeeId,
      date: today,
      check_in: now,
      status,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ── Attendance: Check Out ──
export async function checkOut(employeeId: string, date?: string) {
  const targetDate = date || new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();

  // Find today's attendance record
  const { data: record } = await db
    .from('attendance_records')
    .select('*')
    .eq('employee_id', employeeId)
    .eq('date', targetDate)
    .maybeSingle();

  if (!record) {
    throw new Error('출근 기록이 없습니다. 먼저 출근 처리해주세요.');
  }
  if (record.check_out) {
    throw new Error('이미 퇴근 처리되었습니다');
  }

  // Calculate work hours
  const checkInTime = new Date(record.check_in).getTime();
  const checkOutTime = new Date(now).getTime();
  const diffHours = (checkOutTime - checkInTime) / (1000 * 60 * 60);
  const workHours = Math.round(Math.max(0, diffHours - 1) * 100) / 100; // subtract 1hr lunch
  const overtimeHours = Math.round(Math.max(0, workHours - 8) * 100) / 100;

  const { data, error } = await db
    .from('attendance_records')
    .update({
      check_out: now,
      work_hours: workHours,
      overtime_hours: overtimeHours,
    })
    .eq('id', record.id)
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
  const endDate = `${month}-31`;
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
  const endDate = `${yearMonth}-31`;

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
    .select('*, employees(name, department)')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });
  if (status) query = query.eq('status', status);
  const { data } = await query;
  return data || [];
}

// ── Leave: Create request ──
export async function createLeaveRequest(params: {
  companyId: string;
  employeeId: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  days: number;
  reason?: string;
}) {
  const { data, error } = await db
    .from('leave_requests')
    .insert({
      company_id: params.companyId,
      employee_id: params.employeeId,
      leave_type: params.leaveType,
      start_date: params.startDate,
      end_date: params.endDate,
      days: params.days,
      reason: params.reason || null,
      status: 'pending',
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ── Leave: Approve ──
export async function approveLeaveRequest(id: string, approverId: string) {
  // Get the request first
  const { data: request } = await db
    .from('leave_requests')
    .select('*')
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
    await db
      .from('leave_balances')
      .update({ used_days: balance.used_days + request.days })
      .eq('id', balance.id);
  }
}

// ── Leave: Reject ──
export async function rejectLeaveRequest(id: string, approverId: string) {
  const { error } = await db
    .from('leave_requests')
    .update({
      status: 'rejected',
      approved_by: approverId,
      approved_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throw error;
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
