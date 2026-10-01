import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';
import { assertSameOrigin } from '@/lib/api-authz';
import { fetchHolidayDates } from '@/lib/effective-holidays';
import {
  calcDailyAttendance,
  classifyLeaveForLate,
  parseAttendanceCompanySettings,
  applyEmployeeWorkTimeOverride,
} from '@/lib/attendance-calc';

// 직원 본인 근태 분 재계산 — 서버에서 계산해 서버가 쓴다 (2026-10-01).
//   History: 퇴근 직후 브라우저가 calcDailyAttendance 로 분(정규·연장·야간·휴일)을 계산해 set_attendance_minutes RPC 로 저장했다.
//   그 RPC 는 본인 행이면 아무 숫자나 받아서, 직원이 연장 분을 부풀려 넣을 수 있었다(연장 수당 직결).
//   이제 직원 경로는 여기 — 입력은 날짜뿐, 출퇴근 시각·회사 설정·개인 근무시간·공휴일·승인 휴가는 서버가 DB 에서 읽는다.
//   계산 함수는 브라우저와 같은 attendance-calc 하나. set_attendance_minutes 는 관리자 전용으로 닫았다.
//   관리자(마스터·/attendance:records) 재계산은 지금처럼 브라우저 → RPC (다른 사람 행·회사 전체).

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 31;

export async function POST(request: NextRequest) {
  { const csrf = assertSameOrigin(request); if (csrf) return csrf; }
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: '인증이 필요합니다' } }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const companyId = String(body?.companyId || '');
    const from = String(body?.from || '');
    const to = String(body?.to || '');
    if (!companyId || !DATE_RE.test(from) || !DATE_RE.test(to) || from > to) {
      return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: '날짜가 올바르지 않습니다' } }, { status: 400 });
    }
    const span = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
    if (span > MAX_DAYS) {
      return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: `기간은 ${MAX_DAYS}일까지입니다` } }, { status: 400 });
    }
    //   지난달 1일보다 이전은 직원 경로로 다시 쓰지 않는다(보안 검토 L4) — 급여가 끝난 달의 분은 관리자 재계산 몫
    const kstToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
    const [ty, tm] = kstToday.split('-').map(Number);
    const prevMonthFirst = tm === 1 ? `${ty - 1}-12-01` : `${ty}-${String(tm - 1).padStart(2, '0')}-01`;
    if (from < prevMonthFirst || to > kstToday) {
      return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: '지난달 1일부터 오늘까지만 다시 계산할 수 있습니다' } }, { status: 400 });
    }

    const admin = createSupabaseAdminClient();
    // 본인 확인 — 이 회사에서 내 계정에 연결된 직원 행만 (한 사람이 여러 회사 직원일 수 있다)
    const { data: me } = await admin.from('users').select('id').eq('auth_id', user.id).maybeSingle();
    if (!me?.id) return NextResponse.json({ error: { code: 'FORBIDDEN', message: '사용자 정보를 찾을 수 없습니다' } }, { status: 403 });
    const { data: emp } = await admin.from('employees')
      .select('id, work_start_time, work_end_time')
      .eq('company_id', companyId).eq('user_id', me.id).maybeSingle();
    if (!emp?.id) return NextResponse.json({ error: { code: 'FORBIDDEN', message: '이 회사의 직원으로 연결돼 있지 않습니다' } }, { status: 403 });

    const [{ data: rows, error: rowErr }, { data: cs }, holidays, { data: leaves }] = await Promise.all([
      admin.from('attendance_records')
        .select('id, date, check_in, check_out, attendance_type')
        .eq('company_id', companyId).eq('employee_id', emp.id)
        .gte('date', from).lte('date', to),
      admin.from('company_settings')
        .select('work_start_time, work_end_time, lunch_minutes, late_grace_minutes, night_start_time, night_end_time, weekly_work_hours, is_under_5_employees, is_inclusive_wage, monthly_standard_hours, on_duty_pay_per_shift, workdays_mask, settings')
        .eq('company_id', companyId).maybeSingle(),
      fetchHolidayDates(admin as never, companyId, `${from.slice(0, 4)}-01-01`, `${to.slice(0, 4)}-12-31`),
      admin.from('leave_requests')
        .select('start_date, end_date, leave_unit, start_time, end_time, days')
        .eq('company_id', companyId).eq('employee_id', emp.id).eq('status', 'approved')
        .lte('start_date', to).gte('end_date', from),
    ]);
    if (rowErr) throw rowErr;

    const settings = applyEmployeeWorkTimeOverride(
      parseAttendanceCompanySettings(cs as Record<string, unknown> | null),
      { work_start_time: emp.work_start_time || null, work_end_time: emp.work_end_time || null },
    );

    let updated = 0;
    for (const r of rows || []) {
      const dayLeaves = (leaves || []).filter((l) => l.start_date <= r.date && l.end_date >= r.date);
      const exempt = classifyLeaveForLate(dayLeaves as never);
      const result = calcDailyAttendance({
        check_in: r.check_in,
        check_out: r.check_out,
        date: r.date,
        settings,
        holidays,
        on_leave: exempt.full,
        leave_exempt_until: exempt.exempt_until,
        attendance_type: (r.attendance_type as never) || 'normal',
      });
      // is_late·late_minutes·is_holiday 는 attendance_judge 트리거가 다시 판정한다 — set_attendance_minutes 와 같은 칸을 쓴다
      const { error } = await admin.from('attendance_records').update({
        is_late: result.is_late,
        late_minutes: result.late_minutes,
        regular_minutes: result.regular_minutes,
        overtime_minutes: result.overtime_minutes,
        night_minutes: result.night_minutes,
        holiday_minutes: result.holiday_minutes,
        is_holiday: result.is_holiday,
      }).eq('id', r.id);
      if (!error) updated++;
    }
    return NextResponse.json({ data: { updated, total: (rows || []).length } });
  } catch (e) {
    //   DB 오류 원문은 응답에 싣지 않는다(보안 검토 L2) — 서버 로그로만
    console.error('[attendance/recompute-self]', e);
    return NextResponse.json({ error: { code: 'INTERNAL', message: '근무 시간 재계산 중 오류가 발생했습니다' } }, { status: 500 });
  }
}
