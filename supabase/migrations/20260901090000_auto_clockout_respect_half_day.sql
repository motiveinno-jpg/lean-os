-- Migration: 자동 퇴근이 승인된 오후 반차를 무시하던 것 (2026-09-01 사장님 제보)
--
-- 사장님 제보: 권순철 8/31 오후 반차(14:30~18:30 승인)였는데 마이페이지 근태탭에 정상 퇴근으로 찍힘.
-- 원인: auto_clock_out_at_work_end 가 연장근무(overtime_requests)만 보고 승인된 휴가는 안 봤다 —
--   반차로 조퇴해 퇴근을 안 찍으면 크론이 정규 퇴근시각(18:30)에 check_out=now(), status=present 로 마감.
--   근무시간도 반차 구간까지 포함돼 부풀었다(7.95h).
--
-- 변경 (판단 기준: 승인된 부분 휴가가 그 날 근무의 끝을 앞당겼는가):
--   ① 그 날 승인된 부분 휴가(leave_unit half_day/two_hours, start·end_time 있음) 중
--      "퇴근시각까지 이어지는"(end_time >= 퇴근설정) 건이 있으면 — 즉 오후 반차/조퇴형 —
--      자동 마감 check_out 을 now() 가 아니라 그 휴가 시작 시각으로 찍는다.
--   ② 그 경우 status='half_day' (마이페이지·근태 화면이 '반차'로 표시), 근무시간도 그 시각까지로 재산정.
--   ③ 오전 반차(늦은 출근형: end_time 이 퇴근설정보다 이른 것)는 마감 시각과 무관 — 건드리지 않는다.
--   ④ 알림 문구도 반차 마감이면 구분해 적는다.
-- 기존 데이터 처리: 권순철 2026-08-31 1건 정정(아래) — 그 외 같은 패턴은 발견 시 개별 정정.

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
  -- 동시 실행 방지 — 겹치면 즉시 종료(누적 차단)
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
      (
        select min(l.start_time)
          from public.leave_requests l
         where l.employee_id = c.employee_id
           and l.status = 'approved'
           and l.start_date <= v_today_kst and l.end_date >= v_today_kst
           and l.leave_unit in ('half_day', 'two_hours')
           and l.start_time is not null and l.end_time is not null
           and l.end_time >= coalesce(c.work_end, time '18:00')
           and l.start_time > coalesce(c.work_start, time '09:00')
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
      --   반차 마감이면 그 시각(KST), 아니면 지금 — check_out 과 근무시간 산정이 같은 시각을 쓴다
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

-- ── 데이터 정정: 권순철 2026-08-31 — 오후 반차(14:30~)인데 18:30 정상 퇴근으로 자동 마감된 1건 ──
--   check_out=14:30 KST, status=half_day, 근무 = 09:32(clamp 09:30 이후 실제 출근)~14:30 - 점심 60분.
update public.attendance_records ar
   set check_out      = (ar.date + time '14:30')::timestamp at time zone 'Asia/Seoul',
       status         = 'half_day',
       work_hours     = round((greatest(0, extract(epoch from (
                          ((ar.date + time '14:30')::timestamp at time zone 'Asia/Seoul')
                          - greatest(ar.check_in, ((ar.date + time '09:30')::timestamp at time zone 'Asia/Seoul'))
                        )) / 60.0 - 60) / 60.0)::numeric, 2),
       overtime_hours = 0
 where ar.id = '3a697b42-4001-41bb-911a-adb9cc5890c7'
   and ar.auto_clocked_out = true;
