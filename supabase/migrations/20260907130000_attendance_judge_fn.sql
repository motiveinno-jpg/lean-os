-- 근태 판정 함수 — 지각·휴일·상태를 정하는 규칙을 DB 한 곳에 둔다 (2026-09-07).
--
-- 왜: is_late 를 쓰는 경로가 다섯 곳(출근 엣지·수정요청 승인·기록 수정·관리자 저장·퇴근 재계산)이고
--     SQL 에도 recalculate_late_status_recent 가 옛 JSON 설정(09:00+30)으로 따로 판정하고 있었다.
--     같은 규칙을 여러 곳이 각자 계산하니 08-31 처럼 status='late' 인데 is_late=false 인 행이 생겼다.
-- 규칙(attendance-calc.ts calcLateOnCheckIn 과 동일):
--   · 근무 시작 = 직원 개인 시각(employees.work_start_time) > 회사(company_settings.work_start_time) > 09:00
--   · 유예 = company_settings.late_grace_minutes (없으면 30, 0~240)
--   · 휴일 = holidays 에 있거나 workdays_mask(월=1…일=64)에서 꺼진 요일 → 지각 없음
--   · 승인 휴가: 종일(또는 시각 없는 부분 휴가) → 지각 없음. 부분 휴가 시작 < 13:00 → 지각 기준 = 휴가 종료시각.
--     오후 반차는 아침 출근 의무 그대로. 반차가 있으면 자동 status 는 'half_day'.
--   · 사람이 고른 상태(absent·remote·half_day)는 보존, present/late 는 시각으로 다시 정한다. absent 는 지각 아님.
create or replace function public.attendance_judge(
  p_company_id uuid, p_employee_id uuid, p_date date, p_check_in timestamptz, p_status text
) returns table(is_late boolean, late_minutes integer, is_holiday boolean, status text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_emp_start text; v_cs_start time; v_grace int; v_mask int;
  v_start int; v_bit int;
  v_holiday boolean := false; v_full boolean := false; v_half boolean := false; v_exempt int := 0;
  v_ci int; v_base int; v_late boolean := false; v_late_min int := 0; v_chosen text; v_status text;
  r record;
begin
  select e.work_start_time, cs.work_start_time, cs.late_grace_minutes, cs.workdays_mask
    into v_emp_start, v_cs_start, v_grace, v_mask
    from public.employees e
    left join public.company_settings cs on cs.company_id = e.company_id
   where e.id = p_employee_id;
  if not found then
    select cs.work_start_time, cs.late_grace_minutes, cs.workdays_mask into v_cs_start, v_grace, v_mask
      from public.company_settings cs where cs.company_id = p_company_id;
  end if;
  v_grace := least(greatest(coalesce(v_grace, 30), 0), 240);
  v_mask  := case when coalesce(v_mask, 0) > 0 then v_mask else 31 end;
  v_start := case
    when v_emp_start ~ '^[0-2][0-9]:[0-5][0-9]' then substring(v_emp_start from 1 for 2)::int * 60 + substring(v_emp_start from 4 for 2)::int
    when v_cs_start is not null then extract(hour from v_cs_start)::int * 60 + extract(minute from v_cs_start)::int
    else 9 * 60 end;

  v_bit := 1 << (extract(isodow from p_date)::int - 1);
  v_holiday := (v_mask & v_bit) = 0
            or exists (select 1 from public.holidays h where h.company_id = p_company_id and h.date = p_date);

  for r in
    select l.leave_unit, l.start_time, l.end_time, l.days
      from public.leave_requests l
     where l.employee_id = p_employee_id and l.status = 'approved'
       and l.start_date <= p_date and l.end_date >= p_date
  loop
    if not (coalesce(r.leave_unit, '') in ('half_day', 'two_hours') or r.days = 0.5)
       or r.start_time is null or r.end_time is null
       or r.start_time !~ '^[0-2][0-9]:[0-5][0-9]' or r.end_time !~ '^[0-2][0-9]:[0-5][0-9]' then
      v_full := true; continue;
    end if;
    if r.leave_unit = 'half_day' or r.days = 0.5 then v_half := true; end if;
    if substring(r.start_time from 1 for 5) < '13:00' then
      v_exempt := greatest(v_exempt, substring(r.end_time from 1 for 2)::int * 60 + substring(r.end_time from 4 for 2)::int);
    end if;
  end loop;

  v_chosen := case when p_status in ('absent', 'remote', 'half_day') then p_status else null end;
  if p_check_in is null then
    return query select false, 0, v_holiday, coalesce(p_status, 'present');
    return;
  end if;

  v_ci := extract(hour from (p_check_in at time zone 'Asia/Seoul'))::int * 60
        + extract(minute from (p_check_in at time zone 'Asia/Seoul'))::int;
  v_base := greatest(v_start, v_exempt);
  v_late := (not v_holiday) and (not v_full) and coalesce(v_chosen, '') <> 'absent' and v_ci > v_base + v_grace;
  v_late_min := case when v_late then greatest(0, v_ci - v_base) else 0 end;
  v_status := coalesce(v_chosen, case when v_half then 'half_day' when v_late then 'late' else 'present' end);
  return query select v_late, v_late_min, v_holiday, v_status;
end $$;

revoke all on function public.attendance_judge(uuid, uuid, date, timestamptz, text) from public, anon;
grant execute on function public.attendance_judge(uuid, uuid, date, timestamptz, text) to authenticated, service_role;
