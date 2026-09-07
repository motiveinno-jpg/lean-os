-- 근태 판정 트리거 — attendance_records 에 무엇이 어떻게 쓰이든 is_late·late_minutes·is_holiday·status(present/late)는
-- attendance_judge() 한 규칙으로 정해진다 (2026-09-07). 출근 엣지·브라우저·관리자 저장·수정요청 승인·퇴근 재계산이
-- 각자 판정하던 것을 전부 걷어내고 여기 하나로 모았다.
create or replace function public.attendance_records_judge_trg()
returns trigger language plpgsql security definer set search_path = public as $$
declare j record;
begin
  select * into j from public.attendance_judge(new.company_id, new.employee_id, new.date, new.check_in, new.status);
  new.is_late := j.is_late;
  new.late_minutes := j.late_minutes;
  new.is_holiday := j.is_holiday;
  new.status := j.status;
  return new;
end $$;

drop trigger if exists attendance_records_judge on public.attendance_records;
create trigger attendance_records_judge
  before insert or update on public.attendance_records
  for each row execute function public.attendance_records_judge_trg();

-- 옛 재계산 함수 — 옛 JSON 설정(settings->>'work_start_time', 기본 09:00+30)으로 따로 판정해 09:30 회사에서
-- 엉뚱한 지각을 만들 수 있었다. 이제는 행을 건드려 트리거가 다시 판정하게만 한다(시그니처·반환 유지).
create or replace function public.recalculate_late_status_recent(p_days integer, p_company_id uuid default null::uuid)
returns table(updated_count bigint, promoted_to_late bigint, demoted_to_present bigint)
language plpgsql security definer set search_path = public as $$
declare v_cutoff date := (current_date - greatest(p_days, 0));
begin
  if p_days is null or p_days <= 0 then raise exception 'p_days must be > 0'; end if;
  return query
  with before as (
    select ar.id, ar.status as old_status from public.attendance_records ar
     where ar.check_in is not null and ar.date >= v_cutoff
       and (p_company_id is null or ar.company_id = p_company_id)
  ),
  upd as (
    update public.attendance_records ar set check_in = ar.check_in
      from before b where ar.id = b.id
    returning b.old_status, ar.status as new_status
  )
  select count(*) filter (where old_status is distinct from new_status)::bigint,
         count(*) filter (where new_status = 'late' and old_status is distinct from 'late')::bigint,
         count(*) filter (where new_status = 'present' and old_status is distinct from 'present')::bigint
    from upd;
end $$;

-- 브라우저가 계산한 값을 받아 쓰던 함수 — 이제 값은 무시하고 행을 건드려 트리거가 판정하게 한다(호환용).
create or replace function public.mark_attendance_late(p_employee_id uuid, p_date date, p_is_late boolean, p_late_minutes integer, p_is_holiday boolean default null::boolean)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_user_id uuid := current_app_user_id();
  v_employee_user uuid;
  v_company uuid;
begin
  if v_user_id is null then raise exception 'unauthenticated'; end if;
  select e.user_id, e.company_id into v_employee_user, v_company from public.employees e where e.id = p_employee_id;
  if v_employee_user is null then raise exception 'employee not found'; end if;
  if v_user_id != v_employee_user and not (public.is_company_admin() or public.has_perm('/attendance:records')) then raise exception 'forbidden'; end if;
  if not (public.is_company_admin() or public.has_perm('/attendance:records')) and v_company != get_my_company_id() then raise exception 'forbidden'; end if;
  update public.attendance_records set check_in = check_in where employee_id = p_employee_id and date = p_date;
  return found;
end $$;
