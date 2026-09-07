-- 구성원 디렉토리 이름 옆 근무 상태용: 오늘(KST) 재직자별 출퇴근·휴가 신호를 한 번에 돌려준다.
-- 화면이 attendance-schedule.ts 규칙으로 판정하도록 원본 값만 준다. 급여 등 민감 컬럼은 주지 않는다.
create or replace function public.get_company_work_today()
returns table(
  employee_id uuid,
  work_start_time text,
  work_end_time text,
  hire_date date,
  check_in timestamptz,
  check_out timestamptz,
  att_status text,
  attendance_type text,
  leave_unit text,
  leave_start_time text,
  leave_days numeric
)
language sql stable security definer
set search_path to 'public'
as $function$
  with today as (select (now() at time zone 'Asia/Seoul')::date as d)
  select
    e.id,
    e.work_start_time,
    e.work_end_time,
    e.hire_date,
    r.check_in,
    r.check_out,
    r.status,
    r.attendance_type,
    l.leave_unit,
    l.start_time::text,
    l.days
  from employees e
  cross join today t
  left join lateral (
    select a.check_in, a.check_out, a.status, a.attendance_type
    from attendance_records a
    where a.employee_id = e.id and a.date = t.d
    order by a.check_in nulls last
    limit 1
  ) r on true
  left join lateral (
    select q.leave_unit, q.start_time, q.days
    from leave_requests q
    where q.employee_id = e.id and q.status = 'approved'
      and q.start_date <= t.d and q.end_date >= t.d
    order by (q.leave_unit = 'full_day' or coalesce(q.days, 0) >= 1) desc
    limit 1
  ) l on true
  where e.company_id = get_my_company_id()
    and e.status in ('active', 'joined');
$function$;

revoke all on function public.get_company_work_today() from public, anon;
grant execute on function public.get_company_work_today() to authenticated;
