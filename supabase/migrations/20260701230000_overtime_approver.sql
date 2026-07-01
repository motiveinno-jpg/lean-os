-- 연장근무 승인자 지정 (2026-07-01)
--   신청 시 승인자(회사 admin/owner)를 지정할 수 있게 approver_id 추가.
--   기존 3-arg request_overtime 유지(무중단 배포) + 4-arg 오버로드 추가(p_approver_id).
--   approved_by(실제 승인자)는 approve_overtime 이 그대로 기록 — 이력은 실제 승인자를 표시.
alter table public.overtime_requests
  add column if not exists approver_id uuid references public.users(id) on delete set null;

create or replace function public.request_overtime(
  p_requested_date date,
  p_requested_end_time time without time zone,
  p_reason text,
  p_approver_id uuid
) returns uuid
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_user_id uuid; v_employee_id uuid; v_company_id uuid; v_req_id uuid;
begin
  v_user_id := public.current_app_user_id();
  if v_user_id is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;

  select e.id, e.company_id into v_employee_id, v_company_id
    from public.employees e
    where e.user_id = v_user_id and e.status = 'joined'
    limit 1;
  if v_employee_id is null then raise exception 'EMPLOYEE_NOT_FOUND' using errcode = 'P0002'; end if;

  if p_reason is null or char_length(btrim(p_reason)) < 5 then raise exception 'REASON_TOO_SHORT' using errcode = '22023'; end if;
  if p_requested_end_time is null then raise exception 'END_TIME_REQUIRED' using errcode = '22023'; end if;
  if p_requested_date is null then raise exception 'DATE_REQUIRED' using errcode = '22023'; end if;

  insert into public.overtime_requests(
    company_id, employee_id, requested_date, requested_end_time, reason, status, approver_id
  ) values (
    v_company_id, v_employee_id, p_requested_date, p_requested_end_time, btrim(p_reason), 'pending', p_approver_id
  ) returning id into v_req_id;

  return v_req_id;
exception
  when unique_violation then raise exception 'ALREADY_REQUESTED_FOR_DATE' using errcode = '23505';
end;
$function$;

grant execute on function public.request_overtime(date, time without time zone, text, uuid) to authenticated;
