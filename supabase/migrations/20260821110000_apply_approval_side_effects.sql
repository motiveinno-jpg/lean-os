-- 결재 승인의 후속 반영을 '승인자 권한'에서 떼어낸다 (2026-08-21 감사)
--
-- 문제: 승인 후 근태·휴가 반영을 승인자의 브라우저 세션으로 직접 INSERT 했다. 그래서 반영 여부가
--   **누가 승인했는지**에 달렸다.
--   · overtime_requests INSERT 정책은 "본인 것 · pending · 미승인" 만 허용한다. 관리자 예외는
--     p4 정책(has_perm('/attendance:records'))뿐 — 모티브 12명 중 4명만 통과한다.
--     나머지 8명(팀장 포함)이 승인자면 42501 로 막혀 **결재는 승인, 근태는 미반영**이 된다.
--     결재선 역할을 직책으로 푸는 수정(2026-08-20) 이후 팀장이 승인자가 되는 일이 늘어 더 위험하다.
--   · 휴가도 같다: employees 의 제한 정책(employees_select_role_or_self)이 남의 구성원 행 조회를
--     막아, 일반 직원이 승인자면 요청자→구성원 매핑이 null 이 되고 연차 차감·휴가 기록이 통째로 건너뛴다.
--
-- 해결: 후속 반영을 SECURITY DEFINER 함수로 옮긴다. 같은 회사 사람이 호출했는지, 그 결재가 실제로
--   승인 상태인지 함수 안에서 검증하므로 권한이 느슨해지지 않는다. 재실행해도 중복이 생기지 않는다.

CREATE OR REPLACE FUNCTION public.apply_approval_side_effects(p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_req         public.approval_requests%rowtype;
  v_my_company  uuid;
  v_employee_id uuid;
  v_email       text;
  v_ot          jsonb;
  v_lv          jsonb;
  v_date        date;
  v_end         time;
  v_reason      text;
  v_start       date;
  v_end_date    date;
  v_days        numeric;
  v_year        int;
  v_balance     public.leave_balances%rowtype;
  v_done        text[] := '{}';
begin
  select * into v_req from public.approval_requests where id = p_request_id;
  if not found then
    raise exception 'REQUEST_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- 호출자는 그 회사 사람이어야 한다 (권한 승격 방지)
  v_my_company := public.get_my_company_id();
  if v_my_company is null or v_my_company <> v_req.company_id then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  -- 실제로 승인된 결재만 반영한다
  if v_req.status <> 'approved' then
    return jsonb_build_object('applied', '{}'::text[], 'skipped', 'not_approved');
  end if;

  -- 요청자(users.id) → 구성원(employees.id): user_id 우선, 실패 시 이메일 매칭
  select e.id into v_employee_id
    from public.employees e
   where e.company_id = v_req.company_id and e.user_id = v_req.requester_id
   limit 1;
  if v_employee_id is null then
    select u.email into v_email from public.users u where u.id = v_req.requester_id;
    if v_email is not null then
      select e.id into v_employee_id
        from public.employees e
       where e.company_id = v_req.company_id and e.email = v_email
       limit 1;
    end if;
  end if;
  if v_employee_id is null then
    return jsonb_build_object('applied', '{}'::text[], 'skipped', 'employee_not_found');
  end if;

  -- ── 초과근무 → 근태가 읽는 overtime_requests ─────────────────────────────
  if v_req.request_type = 'overtime' then
    v_ot := v_req.custom_fields -> 'overtime';
    if v_ot is null or (v_ot ->> 'date') is null then
      return jsonb_build_object('applied', '{}'::text[], 'skipped', 'no_overtime_date');
    end if;
    v_date := (v_ot ->> 'date')::date;

    -- 종료시각: 신청서 → 본인 퇴근시각 → 회사 퇴근시각. 없으면 근태를 임의로 열지 않는다.
    v_end := nullif(substring(coalesce(v_ot ->> 'end_time', '') from '^[0-2]?[0-9]:[0-5][0-9]'), '')::time;
    if v_end is null then
      select nullif(substring(coalesce(e.work_end_time, '') from '^[0-2]?[0-9]:[0-5][0-9]'), '')::time
        into v_end from public.employees e where e.id = v_employee_id;
    end if;
    if v_end is null then
      select cs.work_end_time into v_end
        from public.company_settings cs where cs.company_id = v_req.company_id;
    end if;
    if v_end is null then
      return jsonb_build_object('applied', '{}'::text[], 'skipped', 'no_end_time');
    end if;

    -- 사유는 5자 이상이어야 한다(overtime_requests_reason_check) — 짧은 제목은 채워 준다.
    v_reason := coalesce(nullif(btrim(v_req.title), ''), '전자결재 초과근무');
    if char_length(v_reason) < 5 then
      v_reason := '초과근무 신청 — ' || v_reason;
    end if;

    if not exists (
      select 1 from public.overtime_requests o
       where o.employee_id = v_employee_id and o.requested_date = v_date and o.status = 'approved'
    ) then
      insert into public.overtime_requests
        (company_id, employee_id, requested_date, requested_end_time, reason, status, approved_at)
      values (v_req.company_id, v_employee_id, v_date, v_end, v_reason, 'approved', now());
      v_done := array_append(v_done, 'overtime_request');
    end if;
  end if;

  -- ── 휴가 → leave_requests 기록 + 연차 차감 ───────────────────────────────
  if v_req.request_type = 'leave' then
    v_lv := v_req.custom_fields -> 'leave';
    if v_lv is null or (v_lv ->> 'start_date') is null then
      return jsonb_build_object('applied', '{}'::text[], 'skipped', 'no_leave_data');
    end if;
    v_start    := (v_lv ->> 'start_date')::date;
    v_end_date := coalesce(nullif(v_lv ->> 'end_date', ''), v_lv ->> 'start_date')::date;
    v_days     := coalesce(nullif(v_lv ->> 'days', '')::numeric, 0);

    if not exists (
      select 1 from public.leave_requests l
       where l.employee_id = v_employee_id and l.start_date = v_start
         and l.end_date = v_end_date and l.status = 'approved'
    ) then
      insert into public.leave_requests
        (company_id, employee_id, leave_type, leave_unit, start_date, end_date,
         start_time, end_time, days, reason, status, approved_at)
      values (v_req.company_id, v_employee_id,
              coalesce(v_lv ->> 'leave_type', 'annual'),
              coalesce(v_lv ->> 'leave_unit', 'full_day'),
              v_start, v_end_date,
              nullif(v_lv ->> 'start_time', '')::time,
              nullif(v_lv ->> 'end_time', '')::time,
              v_days,
              coalesce(nullif(btrim(v_req.title), ''), '전자결재 휴가'),
              'approved', now());
      v_done := array_append(v_done, 'leave_request');

      -- 연차 차감은 휴가 기록을 새로 만든 경우에만 (중복 차감 방지)
      if v_days > 0 then
        v_year := extract(year from v_start)::int;
        select * into v_balance from public.leave_balances
         where employee_id = v_employee_id and year = v_year limit 1;
        if found then
          update public.leave_balances
             set used_days = coalesce(used_days, 0) + v_days
           where id = v_balance.id;
          v_done := array_append(v_done, 'leave_balance');
        end if;
      end if;
    end if;
  end if;

  return jsonb_build_object('applied', v_done);
end;
$function$;

REVOKE ALL ON FUNCTION public.apply_approval_side_effects(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.apply_approval_side_effects(uuid) TO authenticated;
