-- 달력 휴가 RPC 에 누구의 휴가인지(직원 id·계정 id·이메일)를 함께 돌려준다.
--   일정 › 달력의 '내 것만' 이 일정은 내 것만 보여 주면서 휴가는 전 직원 것을 그대로 보여 줬다.
--   민감 컬럼은 여전히 주지 않는다(사유·승인자 등 제외).
drop function if exists public.leave_calendar();
create or replace function public.leave_calendar()
returns table(
  employee_name text, leave_type text, leave_unit text, days numeric,
  start_date date, end_date date, start_time text,
  employee_id uuid, user_id uuid, employee_email text
)
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  select e.name, lr.leave_type, lr.leave_unit, lr.days, lr.start_date, lr.end_date, lr.start_time,
         e.id, e.user_id, e.email
  from leave_requests lr
  join employees e on e.id = lr.employee_id
  where lr.company_id = get_my_company_id()
    and lr.status = 'approved';
$function$;
revoke all on function public.leave_calendar() from public, anon;
grant execute on function public.leave_calendar() to authenticated;
