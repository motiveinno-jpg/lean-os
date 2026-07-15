-- 2026-07-15 자동퇴근 배치 전체 마비 인시던트 수정
-- 증상: 2026-07-14 18:30 KST~자정 auto_clock_out_at_work_end() 66회 연속 실패
--       ERROR: numeric field overflow (precision 4, scale 2 must round to < 10^2)
-- 근본원인: attendance_records 에 손상 행 1건(date=2026-07-14 인데 check_in=2026-07-01,
--          자정 정각 — 시드/테스트 잔재)이 candidates 에 잡혀
--          (now() - check_in) = 300시간대 → work_hours numeric(4,2)(<100) 초과 →
--          단일 UPDATE 문 전체 롤백 → 전 테넌트 자동퇴근 마비.
-- 수정: candidates CTE 에 '48시간 이내 출근' 가드 추가.
--       정상 하루 근무는 이 범위를 벗어날 수 없다. 비정상적으로 오래된 check_in 은
--       데이터 이상치이므로 자동퇴근 대상에서 제외(수동 확인 필요) — 억지로 클램프해
--       가짜 근무시간을 만들지 않는다. 이상치 1건이 전체 배치를 깨뜨리지 못하게 한다.
-- 함수 로직은 위 가드 한 줄 외 기존과 동일.

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
      -- 인시던트 가드: 비정상적으로 오래된 check_in(시드/손상 행)은 자동퇴근 대상에서 제외.
      -- 정상 하루 근무는 48h 를 넘지 않는다. 이상치 1건이 전체 UPDATE 를 overflow 로 깨뜨리지 못하게 함.
      and now() - ar.check_in < interval '48 hours'
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
$function$;

-- ── 일회성 인시던트 데이터 교정 (2026-07-15) ──────────────────────────────
-- 특정 row id 스코프라 재실행/타 환경에서 no-op → idempotent 안전.

-- (A) 위 손상으로 07-14 자동퇴근이 누락된 3명(company c361afb9...) 수동 교정.
--     그날 정상 자동퇴근됐어야 할 시각 18:30 KST(=2026-07-14 09:30:00+00 UTC)로 설정.
--     work_hours/overtime 은 함수와 동일 공식(9h - 1h 휴게 = 8.00, 초과 0.00).
update public.attendance_records ar
   set check_out        = timestamptz '2026-07-14 09:30:00+00',
       auto_clocked_out = true,
       work_hours       = round(greatest(0, extract(epoch from (timestamptz '2026-07-14 09:30:00+00' - ar.check_in)) / 3600.0 - 1)::numeric, 2),
       overtime_hours   = round(greatest(0, greatest(0, extract(epoch from (timestamptz '2026-07-14 09:30:00+00' - ar.check_in)) / 3600.0 - 1) - 8)::numeric, 2)
 where ar.id in (
         '45cce496-3621-4b3b-bae6-d5565a8a1e56',  -- 양정훈
         '35aed2dc-2499-4779-92cb-b5c2fbbec016',  -- 정다정
         '7de4f5c4-a8f2-4619-ab14-614a3c6041af'   -- 회계관리자
       )
   and ar.check_out is null;

-- (B) 근본원인이 된 손상 행 제거. date=2026-07-14 인데 check_in=2026-07-01 00:00(정각),
--     check_out null — 실제 근무 아님(시드/테스트 잔재). 재사용 가치 없음 → 삭제.
--     같은 직원의 정상 행(2026-07-15 등)은 건드리지 않도록 id 로만 스코프.
delete from public.attendance_records
 where id = '503d80ba-9dc9-4f58-91e5-ca1a29cddae0'
   and check_in = timestamptz '2026-07-01 00:00:00+00'
   and date = date '2026-07-14';
