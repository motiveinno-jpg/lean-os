-- 입사일을 고치면 자동 발생 연차도 새 입사일에 맞춘다
--
-- 월 연차(1개월 만근)·법정 연차 자동 부여는 입사일로 날짜가 정해지는데, 입사일을 나중에 고쳐도
-- 옛 입사일 기준으로 이미 생긴 줄이 그대로 남고 새 날짜 줄이 또 생겼다
-- (입사 전 날짜의 월 연차, 두 벌이 쌓여 1년 미만 법정 최대 11일을 넘는 경우, 몇 년 차 직원에게 월 연차).
--
-- 사람이 직접 넣은 부여(created_by 있음)와 이월·보정은 건드리지 않는다.
-- 자동 줄의 표식은 발생 함수가 쓰는 memo 그대로다(generate_monthly_leave_grants / generate_annual_leave_grants).

create or replace function public.prune_stale_auto_leave_grants(p_employee_id uuid default null)
returns integer
language plpgsql security definer set search_path to 'public' as $$
declare
  v_rows int;
begin
  with s as (
    select e.id, e.hire_date,
           coalesce((select cs.settings->>'monthly_leave_accrual_basis' from company_settings cs where cs.company_id = e.company_id), 'hire') as basis
      from employees e
     where (p_employee_id is null or e.id = p_employee_id)
  )
  delete from leave_grants g
   using s
   where g.employee_id = s.id
     and g.created_by is null
     and (
       (g.grant_type = 'monthly' and g.memo = '1개월 만근 자동 발생' and (
          s.hire_date is null
          or g.grant_date >= (s.hire_date + interval '1 year')::date
          or not exists (
            select 1 from generate_series(1, 11) n
             where g.grant_date = case when s.basis = 'fiscal'
                                       then (date_trunc('month', s.hire_date::timestamp) + (n || ' months')::interval)::date
                                       else (s.hire_date + (n || ' months')::interval)::date end)))
       or
       (g.grant_type = 'annual' and g.memo like '%년차 법정 연차 자동 부여' and (
          s.hire_date is null
          or not exists (
            select 1 from generate_series(1, 60) k
             where g.grant_date = (s.hire_date + (k || ' years')::interval)::date)))
     );
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

revoke all on function public.prune_stale_auto_leave_grants(uuid) from public, anon, authenticated;
grant execute on function public.prune_stale_auto_leave_grants(uuid) to service_role;

create or replace function public.trg_employees_hire_date_leave_grants()
returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  perform public.prune_stale_auto_leave_grants(new.id);
  -- 새 입사일 기준으로 빠진 줄을 채운다(이미 있는 날짜는 건너뜀)
  if new.hire_date is not null and public.leave_accrual_enabled(new.company_id) then
    perform public.generate_leave_accruals(new.company_id);
  end if;
  return null;
end;
$$;

revoke all on function public.trg_employees_hire_date_leave_grants() from public, anon, authenticated;

drop trigger if exists employees_hire_date_leave_grants on public.employees;
create trigger employees_hire_date_leave_grants
  after update of hire_date on public.employees
  for each row
  when (old.hire_date is distinct from new.hire_date)
  execute function public.trg_employees_hire_date_leave_grants();

-- 이미 어긋나 있는 줄 정리
select public.prune_stale_auto_leave_grants(null);
