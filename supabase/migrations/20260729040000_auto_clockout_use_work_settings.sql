-- Migration: auto_clock_out_at_work_end 근무·연장 산정을 회사/개인 설정 기준으로 (2026-07-29)
--
-- 사장님 제보: 9:30 출근 회사에서 9:25 출근 후 정상 퇴근하면 5분 연장으로 찍힘.
-- 수동 퇴근(attendance-checkin 엣지)은 2026-07-27 에 고쳤지만(조기출근 clamp + 설정 기반 점심/정시),
-- 자동 퇴근 cron 함수는 구식 하드코딩 식 — (퇴근-출근)-1h, 8h 초과=연장, clamp 없음 — 이 남아
-- 자동퇴근된 날마다 조기출근분이 그대로 연장으로 계산됐다 (7/28 전 직원 재현).
--
-- 변경: 엣지 함수 checkout 과 동일 규칙으로 통일 —
--   ① 조기출근은 산정 시각만 지정 출근시각으로 clamp (check_in 원본 보존)
--   ② 점심·정시는 company_settings + employees 개인 override 에서 읽음
--   ③ 정시(nominal) = (퇴근설정-출근설정) - 점심, 비정상이면 480분 fallback

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
      -- 개인 출퇴근시간 우선 (text 'HH:MM' — 형식 맞을 때만), 없으면 회사 기본
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
      -- 인시던트 가드: 비정상적으로 오래된 check_in(시드/손상 행)은 제외 (정상 근무 < 48h)
      and now() - ar.check_in < interval '48 hours'
  ),
  closing as (
    select c.*,
      -- 조기출근 clamp: 산정용 출근시각 = max(실제 출근, 그 날의 지정 출근시각[KST])
      greatest(
        c.check_in,
        ((v_today_kst + coalesce(c.work_start, time '09:00'))::timestamp at time zone 'Asia/Seoul')
      ) as eff_check_in,
      -- 정시(분) = (퇴근설정 - 출근설정) - 점심, 비정상이면 480 fallback
      case
        when c.work_start is not null and c.work_end is not null
             and extract(epoch from (c.work_end - c.work_start)) / 60 - coalesce(c.lunch_min, 60) > 0
        then extract(epoch from (c.work_end - c.work_start)) / 60 - coalesce(c.lunch_min, 60)
        else 480
      end as nominal_min
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
      -- gross(분) = 퇴근 - clamp된 출근. 점심은 gross > 점심일 때만 차감(짧은 근무 음수 방지)
      greatest(0, extract(epoch from (now() - cl.eff_check_in)) / 60.0) as gross_min
    from closing cl
  ),
  calc2 as (
    select c.*,
      case when c.gross_min > coalesce(c.lunch_min, 60)
           then c.gross_min - coalesce(c.lunch_min, 60)
           else c.gross_min end as work_min
    from calc c
  ),
  updated as (
    update public.attendance_records ar
       set check_out         = now(),
           auto_clocked_out  = true,
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

-- ── 데이터 정정: 구식 공식으로 자동퇴근된 기록의 근무/연장 재계산 (엣지 픽스 이후 기간) ──
-- 조기출근 clamp + 설정 기반 점심/정시로 재산정. check_in/check_out 원본은 그대로.
with fix as (
  select ar.id,
    greatest(
      ar.check_in,
      ((ar.date + coalesce(
        case when e.work_start_time ~ '^[0-2][0-9]:[0-5][0-9]'
             then substring(e.work_start_time from 1 for 5)::time end,
        cs.work_start_time, time '09:00'))::timestamp at time zone 'Asia/Seoul')
    ) as eff_ci,
    ar.check_out as co,
    coalesce(cs.lunch_minutes, 60) as lunch_min,
    case
      when cs.work_start_time is not null and cs.work_end_time is not null
           and extract(epoch from (
             coalesce(
               case when e.work_end_time ~ '^[0-2][0-9]:[0-5][0-9]'
                    then substring(e.work_end_time from 1 for 5)::time end,
               cs.work_end_time)
             - coalesce(
               case when e.work_start_time ~ '^[0-2][0-9]:[0-5][0-9]'
                    then substring(e.work_start_time from 1 for 5)::time end,
               cs.work_start_time))) / 60 - coalesce(cs.lunch_minutes, 60) > 0
      then extract(epoch from (
             coalesce(
               case when e.work_end_time ~ '^[0-2][0-9]:[0-5][0-9]'
                    then substring(e.work_end_time from 1 for 5)::time end,
               cs.work_end_time)
             - coalesce(
               case when e.work_start_time ~ '^[0-2][0-9]:[0-5][0-9]'
                    then substring(e.work_start_time from 1 for 5)::time end,
               cs.work_start_time))) / 60 - coalesce(cs.lunch_minutes, 60)
      else 480
    end as nominal_min
  from public.attendance_records ar
  join public.employees e         on e.id = ar.employee_id
  join public.company_settings cs on cs.company_id = ar.company_id
  where ar.auto_clocked_out = true
    and ar.check_in is not null and ar.check_out is not null
    and ar.date >= date '2026-07-27'
),
fix2 as (
  select id,
    case when greatest(0, extract(epoch from (co - eff_ci)) / 60.0) > lunch_min
         then greatest(0, extract(epoch from (co - eff_ci)) / 60.0) - lunch_min
         else greatest(0, extract(epoch from (co - eff_ci)) / 60.0) end as work_min,
    nominal_min
  from fix
)
update public.attendance_records ar
   set work_hours     = round((f.work_min / 60.0)::numeric, 2),
       overtime_hours = round((greatest(0, f.work_min - f.nominal_min) / 60.0)::numeric, 2)
  from fix2 f
 where ar.id = f.id
   and (ar.work_hours     is distinct from round((f.work_min / 60.0)::numeric, 2)
     or ar.overtime_hours is distinct from round((greatest(0, f.work_min - f.nominal_min) / 60.0)::numeric, 2));
