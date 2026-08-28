-- 승인된 '휴가성 커스텀 결재 양식'도 leave_requests 를 생성하게 (2026-08-28 사장님)
--   문제: 병역의무 이행 휴가·경조휴가 등은 표준 request_type='leave' 가 아니라 커스텀 양식으로 올라가
--     leave_requests 가 안 만들어졌고, 근태(워크보드·현황)는 leave_requests 만 읽어 '결근' 으로 떴다.
--   해결: apply_approval_side_effects 에 '양식에 period(날짜범위) 필드가 있으면 휴가로 보고 승인
--     leave_request 생성' 분기 추가. 연차 차감은 하지 않음(공가·경조 등 차감 규칙 상이 → 오차감 방지).
--   실증(2026-08-28): 병역의무 양식 필드 5d8e0849(휴가일)='2026-08-27 ~ 2026-08-27' 파싱 OK.

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

  -- ── 커스텀 휴가 양식(양식 기반, period 필드 보유) → leave_requests 생성 (2026-08-28 사장님) ──
  --   표준 request_type='leave' 가 아닌 결재 양식(병역의무 이행 휴가·경조휴가 등)은 근태가 leave_requests
  --   만 읽어 반영을 못 해 '결근' 으로 떴다. 양식에 period(날짜범위) 필드가 있으면 휴가 양식으로 보고,
  --   그 값으로 승인 leave_request 를 만든다. ⚠ 연차 차감은 하지 않는다 — 공가·경조 등 유형별 차감
  --   규칙이 제각각이라 오차감을 피한다(근태 반영이 목적, 차감은 표준 휴가 신청 경로에서만).
  if v_req.request_type not in ('leave', 'overtime') and v_req.form_id is not null then
    declare
      v_form  public.approval_forms%rowtype;
      v_pkey  text;
      v_pval  text;
      v_tval  text;
      v_ltype text;
    begin
      select * into v_form from public.approval_forms where id = v_req.form_id;
      if found and v_form.fields is not null then
        select f ->> 'key' into v_pkey
          from jsonb_array_elements(v_form.fields) f
         where f ->> 'type' = 'period' limit 1;
        if v_pkey is not null then
          v_pval := v_req.custom_fields ->> v_pkey;  -- 예: "2026-08-27 ~ 2026-08-27"
          if v_pval ~ '[0-9]{4}-[0-9]{2}-[0-9]{2}' then
            v_start    := (substring(v_pval from '([0-9]{4}-[0-9]{2}-[0-9]{2})'))::date;
            v_end_date := coalesce(nullif(substring(v_pval from '([0-9]{4}-[0-9]{2}-[0-9]{2})[^0-9]*$'), '')::date, v_start);
            select v_req.custom_fields ->> (f ->> 'key') into v_tval
              from jsonb_array_elements(v_form.fields) f
             where f ->> 'label' ilike '%휴가종류%' or f ->> 'label' ilike '%휴가유형%' limit 1;
            v_ltype := case
              when coalesce(v_tval, '') ilike '%연차%' or v_form.name ilike '%연차%' then 'annual'
              when coalesce(v_tval, '') ilike '%병가%' then 'sick'
              when coalesce(v_tval, '') ilike '%경조%' or v_form.name ilike '%경조%' then 'bereavement'
              else 'official' end;
            if not exists (
              select 1 from public.leave_requests l
               where l.employee_id = v_employee_id
                 and l.start_date <= v_end_date and l.end_date >= v_start
                 and l.status = 'approved'
            ) then
              insert into public.leave_requests
                (company_id, employee_id, leave_type, leave_unit, start_date, end_date,
                 days, reason, status, approved_at)
              values (v_req.company_id, v_employee_id, v_ltype, 'full_day', v_start, v_end_date,
                      (v_end_date - v_start + 1),
                      coalesce(nullif(btrim(v_req.title), ''), '전자결재 휴가'),
                      'approved', now());
              v_done := array_append(v_done, 'leave_request_from_form');
            end if;
          end if;
        end if;
      end if;
    end;
  end if;

  return jsonb_build_object('applied', v_done);
end;
$function$
