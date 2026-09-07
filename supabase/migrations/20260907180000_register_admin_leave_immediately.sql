-- 구성원 상세 > 휴가에서 휴가 관리 권한자가 직접 등록하면 결재 없이 확정한다.
-- 승인 기록 INSERT가 기존 트리거를 깨워 연차 사용일수와 부분휴가 근태를 즉시 재계산한다.

create or replace function public.register_admin_leave(
  p_company_id uuid,
  p_employee_id uuid,
  p_leave_type text,
  p_start_date date,
  p_end_date date,
  p_days numeric,
  p_reason text default null,
  p_leave_unit text default 'full_day',
  p_start_time text default null,
  p_end_time text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := public.current_app_user_id();
  v_employee_user_id uuid;
  v_request_id uuid;
  v_days numeric := case
    when p_leave_unit = 'half_day' then 0.5
    when p_leave_unit = 'two_hours' then 0.25
    else p_days
  end;
  v_remaining numeric;
begin
  if v_actor_id is null
     or not (public.is_company_admin() or public.has_perm('/employees:leave')) then
    raise exception 'forbidden: leave management permission required';
  end if;
  if p_company_id is null or p_company_id <> public.get_my_company_id() then
    raise exception 'forbidden: company mismatch';
  end if;
  if p_start_date is null or p_end_date is null or p_end_date < p_start_date or v_days <= 0 then
    raise exception 'invalid leave period';
  end if;
  if p_leave_unit not in ('full_day', 'half_day', 'two_hours') then
    raise exception 'invalid leave unit';
  end if;
  if p_leave_unit = 'two_hours'
     and (p_start_time is null or p_end_time is null or p_start_time >= p_end_time) then
    raise exception 'invalid leave time';
  end if;

  select user_id into v_employee_user_id
    from public.employees
   where id = p_employee_id and company_id = p_company_id;
  if not found then
    raise exception 'employee not found';
  end if;

  if p_leave_type = 'annual' then
    select total_days - used_days into v_remaining
      from public.leave_balances
     where employee_id = p_employee_id
       and year = extract(year from p_start_date)::int
     for update;
    if not found then
      raise exception '연차가 설정되지 않았습니다.';
    end if;
    if v_days > v_remaining then
      raise exception '연차 잔여일수가 부족합니다 (잔여: %일, 등록: %일)', v_remaining, v_days;
    end if;
  end if;

  insert into public.leave_requests (
    company_id, employee_id, leave_type, start_date, end_date, days, reason,
    status, leave_unit, start_time, end_time, approved_by, approved_at,
    requested_approver_id, second_approver_id, approval_steps, cc_user_ids
  ) values (
    p_company_id, p_employee_id, p_leave_type, p_start_date, p_end_date, v_days,
    nullif(trim(p_reason), ''), 'approved', p_leave_unit, p_start_time, p_end_time,
    v_actor_id, now(), null, null, '[]'::jsonb, '{}'::uuid[]
  ) returning id into v_request_id;

  if v_employee_user_id is not null then
    begin
      insert into public.notifications (
        company_id, user_id, type, title, message, entity_type, entity_id, is_read
      ) values (
        p_company_id, v_employee_user_id, 'approval', '휴가 등록 완료',
        to_char(p_start_date, 'YYYY-MM-DD')
          || case when p_end_date > p_start_date then ' ~ ' || to_char(p_end_date, 'YYYY-MM-DD') else '' end
          || ' · ' || v_days || '일',
        'leave_request', v_request_id, false
      );
    exception when others then
      null;
    end;
  end if;

  return v_request_id;
end;
$$;

revoke all on function public.register_admin_leave(uuid, uuid, text, date, date, numeric, text, text, text, text)
  from public, anon;
grant execute on function public.register_admin_leave(uuid, uuid, text, date, date, numeric, text, text, text, text)
  to authenticated;

comment on function public.register_admin_leave(uuid, uuid, text, date, date, numeric, text, text, text, text)
  is '휴가 관리 권한자의 직접 휴가 등록: 결재 없이 승인 기록을 생성한다.';
