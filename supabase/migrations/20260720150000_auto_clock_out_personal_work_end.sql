-- 2026-07-20 자동퇴근이 직원 개인 퇴근시간(employees.work_end_time)을 무시하던 버그
-- 증상: 개인 퇴근 15:00 직원(김혜진)이 회사 기본 18:30 에 자동퇴근 처리됨.
-- 수정: candidates 에서 개인 work_end_time(text 'HH:MM')이 있으면 회사 기본보다 우선.
--       text 컬럼이라 형식 검증(~ '^\d{2}:\d{2}') 후에만 ::time 캐스팅 — 이상치 1건이
--       배치 전체를 깨뜨리던 2026-07-15 인시던트 재발 방지 원칙 유지.
--       알림 문구도 "회사 퇴근시각" → "설정된 퇴근시각" (개인 기준일 수 있으므로).
-- 함수 로직은 위 두 곳 외 20260715100000 버전과 동일 (락/가드/근무시간 공식 불변).

CREATE OR REPLACE FUNCTION public.auto_clock_out_at_work_end()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_now_kst   timestamp;
  v_today_kst date;
  v_count     integer := 0;
begin
  -- 동시 실행 방지 — 겹치면 즉시 종료(누적 차단)
  if not pg_try_advisory_xact_lock(948271) then
    return 0;
  end if;
  -- 단일 실행이 분 단위로 끌지 않도록 가드(경합 시 빠르게 양보)
  set local lock_timeout = '3s';
  set local statement_timeout = '30s';

  v_now_kst   := (now() at time zone 'Asia/Seoul');
  v_today_kst := v_now_kst::date;

  with candidates as (
    select
      ar.id            as attendance_id,
      ar.employee_id   as employee_id,
      ar.company_id    as company_id,
      e.user_id        as user_id,
      -- 개인 퇴근시간 우선 (text 'HH:MM' — 형식 맞을 때만 캐스팅), 없으면 회사 기본
      coalesce(
        case when e.work_end_time ~ '^[0-2][0-9]:[0-5][0-9]'
             then substring(e.work_end_time from 1 for 5)::time end,
        cs.work_end_time
      ) as work_end,
      (
        select o.requested_end_time
          from public.overtime_requests o
          where o.employee_id    = ar.employee_id
            and o.requested_date = v_today_kst
            and o.status         = 'approved'
          order by o.approved_at desc nulls last
          limit 1
      ) as ot_end
    from public.attendance_records ar
    join public.employees e        on e.id          = ar.employee_id
    join public.company_settings cs on cs.company_id = ar.company_id
    where ar.date = v_today_kst
      and ar.check_in  is not null
      and ar.check_out is null
      -- 인시던트 가드: 비정상적으로 오래된 check_in(시드/손상 행)은 자동퇴근 대상에서 제외.
      -- 정상 하루 근무는 48h 를 넘지 않는다. 이상치 1건이 전체 UPDATE 를 overflow 로 깨뜨리지 못하게 함.
      and now() - ar.check_in < interval '48 hours'
  ),
  closing as (
    select c.attendance_id, c.employee_id, c.company_id, c.user_id, c.work_end
      from candidates c
      where c.work_end is not null
        and v_now_kst::time > c.work_end
        and (c.ot_end is null or v_now_kst::time > c.ot_end)
  ),
  -- 라이브 수동퇴근이 잡은 행은 건너뛴다(경합 회피). 다음 주기에 재처리.
  locked as (
    select ar.id as attendance_id
      from public.attendance_records ar
     where ar.id in (select attendance_id from closing)
       and ar.check_out is null
       for update skip locked
  ),
  updated as (
    update public.attendance_records ar
       set check_out         = now(),
           auto_clocked_out  = true,
           -- 수동퇴근(attendance-checkin 엣지함수)과 동일 식: (퇴근-출근) - 1h 휴게, 2자리 반올림
           work_hours        = round(greatest(0, extract(epoch from (now() - ar.check_in)) / 3600.0 - 1)::numeric, 2),
           overtime_hours    = round(greatest(0, greatest(0, extract(epoch from (now() - ar.check_in)) / 3600.0 - 1) - 8)::numeric, 2)
      from closing cl
     where ar.id = cl.attendance_id
       and ar.id in (select attendance_id from locked)
       and ar.check_out is null
     returning ar.id as attendance_id
  ),
  notified as (
    insert into public.notifications
      (company_id, user_id, type, title, message, entity_type, entity_id, link)
    select
      cl.company_id,
      cl.user_id,
      'overtime_auto_clockout',
      '자동 퇴근 처리되었습니다',
      '설정된 퇴근시각(' || to_char(cl.work_end, 'HH24:MI')
        || ')이 지나 자동으로 퇴근 처리됐습니다. 연장 근무가 필요하면 사전 신청해 주세요.',
      'attendance_records',
      cl.attendance_id,
      '/attendance'
    from closing cl
    join updated u on u.attendance_id = cl.attendance_id
    where cl.user_id is not null
    returning id
  )
  select count(*)::int into v_count from updated;

  return coalesce(v_count, 0);
end;
$function$;
