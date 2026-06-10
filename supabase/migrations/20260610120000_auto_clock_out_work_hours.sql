-- 2026-06-10 자동퇴근 work_hours 누락 버그 수정
-- 증상: auto_clock_out_at_work_end() 가 check_out 만 세팅하고 work_hours/overtime_hours 미계산
--       → 자동퇴근된 직원 '총 근무 0.0h' + 퇴근 안 된 것처럼 표시(연준호 06-08 사례).
-- 수정: 수동퇴근(attendance-checkin 엣지함수)과 동일 식으로 work_hours/overtime_hours 채움.
--       work_hours = round(max(0,(퇴근-출근)h - 1h 휴게),2), overtime = round(max(0, work_hours-8),2)
-- + 기존 망가진 자동퇴근 기록 백필.

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
      cs.work_end_time as work_end,
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
      and cs.work_end_time is not null
  ),
  closing as (
    select c.attendance_id, c.employee_id, c.company_id, c.user_id, c.work_end
      from candidates c
      where v_now_kst::time > c.work_end
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
      '회사 퇴근시각(' || to_char(cl.work_end, 'HH24:MI')
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
$function$

-- 백필: 자동퇴근됐는데 work_hours=0 인 과거 기록 식대로 재계산
update public.attendance_records
   set work_hours    = round(greatest(0, extract(epoch from (check_out - check_in))/3600.0 - 1)::numeric, 2),
       overtime_hours = round(greatest(0, greatest(0, extract(epoch from (check_out - check_in))/3600.0 - 1) - 8)::numeric, 2)
 where auto_clocked_out = true and check_in is not null and check_out is not null and coalesce(work_hours,0) = 0;
