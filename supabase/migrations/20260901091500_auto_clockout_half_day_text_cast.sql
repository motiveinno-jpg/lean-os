-- Migration: 20260901090000 후속 — leave_requests.start_time/end_time 은 text 라 time 비교가 런타임 에러
--   (직전 마이그레이션의 leave_start 서브쿼리가 크론 실행 시 42883 으로 전체 자동 퇴근을 깨뜨림).
--   employees.work_*_time 과 같은 방식의 정규식 가드 + substring::time 캐스팅으로 교체. 로직 동일.

create or replace function public.auto_clock_out_at_work_end()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_now_kst   timestamp;
  v_today_kst date;
  v_count     integer := 0;
begin
  if not pg_try_advisory_xact_lock(948271) then
    return 0;
  end if;
  set local lock_timeout = '3s';
  set local statement_timeout = '30s';

  v_now_kst   := (now() at time zone 'Asia/Seoul');
  v_today_kst := v_now_kst::date;

  with candidates as (
    select
      ar.id            as attendance_id,
      ar.employee_id   as employee_id,
      ar.company_id    as company_id,
      ar.check_in      as check_in,
      e.user_id        as user_id,
      coalesce(
        case when e.work_start_time ~ '^[0-2][0-9]:[0-5][0-9]'
             then substring(e.work_start_time from 1 for 5)::time end,
        cs.work_start_time
      ) as work_start,
      coalesce(
        case when e.work_end_time ~ '^[0-2][0-9]:[0-5][0-9]'
             then substring(e.work_end_time from 1 for 5)::time end,
        cs.work_end_time
      ) as work_end,
      coalesce(nullif(cs.lunch_minutes, null), 60) as lunch_min,
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
      and now() - ar.check_in < interval '48 hours'
  ),
  closing as (
    select c.*,
      greatest(
        c.check_in,
        ((v_today_kst + coalesce(c.work_start, time '09:00'))::timestamp at time zone 'Asia/Seoul')
      ) as eff_check_in,
      case
        when c.work_start is not null and c.work_end is not null
             and extract(epoch from (c.work_end - c.work_start)) / 60 - coalesce(c.lunch_min, 60) > 0
        then extract(epoch from (c.work_end - c.work_start)) / 60 - coalesce(c.lunch_min, 60)
        else 480
      end as nominal_min,
      -- 오후 반차/조퇴형: 그 날 승인된 부분 휴가가 퇴근시각까지 이어지면 근무 끝 = 휴가 시작 (2026-09-01)
      --   ⚠ leave_requests.start_time/end_time 은 text('HH:MM:SS') — 정규식 가드 후 캐스팅 필수
      (
        select min(substring(l.start_time from 1 for 5)::time)
          from public.leave_requests l
         where l.employee_id = c.employee_id
           and l.status = 'approved'
           and l.start_date <= v_today_kst and l.end_date >= v_today_kst
           and l.leave_unit in ('half_day', 'two_hours')
           and l.start_time ~ '^[0-2][0-9]:[0-5][0-9]'
           and l.end_time   ~ '^[0-2][0-9]:[0-5][0-9]'
           and substring(l.end_time from 1 for 5)::time   >= coalesce(c.work_end, time '18:00')
           and substring(l.start_time from 1 for 5)::time >  coalesce(c.work_start, time '09:00')
      ) as leave_start
      from candidates c
      where c.work_end is not null
        and v_now_kst::time > c.work_end
        and (c.ot_end is null or v_now_kst::time > c.ot_end)
  ),
  locked as (
    select ar.id as attendance_id
      from public.attendance_records ar
     where ar.id in (select attendance_id from closing)
       and ar.check_out is null
       for update skip locked
  ),
  calc as (
    select cl.*,
      case when cl.leave_start is not null
           then ((v_today_kst + cl.leave_start)::timestamp at time zone 'Asia/Seoul')
           else now() end as close_ts
    from closing cl
  ),
  calc1 as (
    select c.*,
      greatest(0, extract(epoch from (c.close_ts - c.eff_check_in)) / 60.0) as gross_min
    from calc c
  ),
  calc2 as (
    select c.*,
      case when c.gross_min > coalesce(c.lunch_min, 60)
           then c.gross_min - coalesce(c.lunch_min, 60)
           else c.gross_min end as work_min
    from calc1 c
  ),
  updated as (
    update public.attendance_records ar
       set check_out         = c2.close_ts,
           auto_clocked_out  = true,
           status            = case when c2.leave_start is not null then 'half_day' else ar.status end,
           work_hours        = round((c2.work_min / 60.0)::numeric, 2),
           overtime_hours    = round((greatest(0, c2.work_min - c2.nominal_min) / 60.0)::numeric, 2)
      from calc2 c2
     where ar.id = c2.attendance_id
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
      case when cl.leave_start is not null
        then '승인된 반차 시작(' || to_char(cl.leave_start, 'HH24:MI') || ') 기준으로 퇴근 처리됐습니다.'
        else '설정된 퇴근시각(' || to_char(cl.work_end, 'HH24:MI')
          || ')이 지나 자동으로 퇴근 처리됐습니다. 연장 근무가 필요하면 사전 신청해 주세요.'
      end,
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
