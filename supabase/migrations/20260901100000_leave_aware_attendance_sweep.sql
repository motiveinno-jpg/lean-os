-- Migration: 근태 자동 로직이 승인 휴가를 모르는 동류 버그 스윕 (2026-09-01 사장님 "이런류 싹 다")
--
-- 발단: 오후 반차인데 자동 퇴근이 정상퇴근으로 마감(20260901090000 에서 수정). 같은 부류 2건 추가 수정:
--
-- ① recalculate_late_status_recent — 지각 일괄 재계산이 휴가를 안 봐서, 오전 반차로 늦게 출근한
--    (승인이 출근 뒤라 status=present 로 남은) 날을 'late' 로 승격시킬 수 있었다.
--    → 승인 휴가가 걸린 날은 재계산에서 통째로 제외(보수적 — 휴가 낀 날은 사람이 본다).
--
-- ② 휴가 승인 시점이 출퇴근 기록보다 늦으면 그날 기록이 영영 안 맞았다 (권순철 8/31 의 뿌리:
--    09:32 출근 → 12:19 반차 승인 → 기록은 계속 present). 출근 엣지(체크인 시점)와 자동 퇴근
--    (퇴근 시점)은 휴가를 보지만, "그 사이에 승인" 은 아무도 안 봤다.
--    → leave_requests 승인 트리거로 그 날짜 기록을 보정:
--       · 오후 반차(퇴근시각까지 이어짐): 자동 마감으로 반차 시작보다 늦게 닫힌 기록만 반차 시작으로
--         당기고 근무 재산정(사람이 직접 찍은 퇴근은 존중), status='half_day'
--       · 오전 반차(끝이 퇴근시각 전): status='half_day', 반차 끝+유예 30분 안 출근이면 지각 해제
--       · 종일 휴가·시간 정보 없는 건은 건드리지 않는다
--    커버 경로: 휴가 탭 승인 / 전자결재 leave / 커스텀 휴가 양식(apply_approval_side_effects 의
--    insert 도 이 트리거를 지나므로) 전부.

-- ── ① 지각 재계산: 승인 휴가 낀 날 제외 ─────────────────────────────────────────
--   기존 함수와 기본값 서명이 달라 REPLACE 불가(42P13) — DROP 후 재생성 (호출부는 types 만, 앱 코드 미사용)
drop function if exists public.recalculate_late_status_recent(integer, uuid);
create or replace function public.recalculate_late_status_recent(p_days integer, p_company_id uuid default null)
returns table(updated_count bigint, promoted_to_late bigint, demoted_to_present bigint)
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_cutoff date := (current_date - GREATEST(p_days, 0));
  v_updated bigint := 0;
  v_to_late bigint := 0;
  v_to_present bigint := 0;
BEGIN
  IF p_days IS NULL OR p_days <= 0 THEN
    RAISE EXCEPTION 'p_days must be > 0';
  END IF;

  WITH policy AS (
    SELECT
      c.id AS company_id,
      COALESCE(NULLIF(cs.settings ->> 'work_start_time', ''), '09:00') AS work_start_time,
      COALESCE(NULLIF(cs.settings ->> 'late_threshold_minutes', '')::int, 30) AS late_threshold_minutes
    FROM companies c
    LEFT JOIN company_settings cs ON cs.company_id = c.id
    WHERE p_company_id IS NULL OR c.id = p_company_id
  ),
  target AS (
    SELECT
      ar.id,
      ar.status AS old_status,
      CASE
        WHEN (
          EXTRACT(HOUR   FROM (ar.check_in AT TIME ZONE 'Asia/Seoul')) * 60
        + EXTRACT(MINUTE FROM (ar.check_in AT TIME ZONE 'Asia/Seoul'))
        ) > (
          (split_part(p.work_start_time, ':', 1))::int * 60
        + (split_part(p.work_start_time, ':', 2))::int
        + p.late_threshold_minutes
        ) THEN 'late'
        ELSE 'present'
      END AS new_status
    FROM attendance_records ar
    JOIN policy p ON p.company_id = ar.company_id
    WHERE ar.check_in IS NOT NULL
      AND ar.date >= v_cutoff
      AND ar.status IN ('present', 'late')   -- absent/half_day/remote 은 보존
      -- 승인 휴가(반차 포함)가 걸린 날은 재계산 제외 — 오전 반차 출근을 지각으로 승격시키지 않는다 (2026-09-01)
      AND NOT EXISTS (
        SELECT 1 FROM leave_requests l
         WHERE l.employee_id = ar.employee_id
           AND l.status = 'approved'
           AND l.start_date <= ar.date AND l.end_date >= ar.date
      )
  ),
  upd AS (
    UPDATE attendance_records ar
       SET status = t.new_status
      FROM target t
     WHERE ar.id = t.id
       AND ar.status <> t.new_status
    RETURNING t.old_status, t.new_status
  )
  SELECT
    COUNT(*)::bigint,
    COUNT(*) FILTER (WHERE new_status = 'late')::bigint,
    COUNT(*) FILTER (WHERE new_status = 'present')::bigint
  INTO v_updated, v_to_late, v_to_present
  FROM upd;

  updated_count := v_updated;
  promoted_to_late := v_to_late;
  demoted_to_present := v_to_present;
  RETURN NEXT;
END;
$function$;

-- ── ② 휴가 승인 → 그 날짜 근태 기록 보정 트리거 ─────────────────────────────────
create or replace function public.reconcile_attendance_on_leave_approve()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_work_start time;
  v_work_end   time;
  v_lunch      integer;
  v_lv_start   time;
  v_lv_end     time;
  r record;
begin
  if new.status <> 'approved' then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'approved' then return new; end if;
  -- 부분 휴가만 보정 대상 — 종일 휴가는 출근 기록과 독립(휴가 중 출근한 기록을 건드리지 않는다)
  if new.leave_unit not in ('half_day', 'two_hours') then return new; end if;
  -- ⚠ start/end_time 은 text — 정규식 가드 후 캐스팅 (20260901091500 교훈)
  if new.start_time is null or new.end_time is null
     or new.start_time !~ '^[0-2][0-9]:[0-5][0-9]' or new.end_time !~ '^[0-2][0-9]:[0-5][0-9]' then
    return new;
  end if;
  v_lv_start := substring(new.start_time from 1 for 5)::time;
  v_lv_end   := substring(new.end_time   from 1 for 5)::time;

  select
    coalesce(case when e.work_start_time ~ '^[0-2][0-9]:[0-5][0-9]'
                  then substring(e.work_start_time from 1 for 5)::time end,
             cs.work_start_time, time '09:00'),
    coalesce(case when e.work_end_time ~ '^[0-2][0-9]:[0-5][0-9]'
                  then substring(e.work_end_time from 1 for 5)::time end,
             cs.work_end_time, time '18:00'),
    coalesce(cs.lunch_minutes, 60)
    into v_work_start, v_work_end, v_lunch
    from public.employees e
    join public.company_settings cs on cs.company_id = e.company_id
   where e.id = new.employee_id;
  if v_work_start is null then return new; end if;

  for r in
    select * from public.attendance_records ar
     where ar.employee_id = new.employee_id
       and ar.date between new.start_date and new.end_date
       and ar.check_in is not null
  loop
    if v_lv_end >= v_work_end and v_lv_start > v_work_start then
      -- 오후 반차/조퇴형 — 자동 마감이 반차 시작보다 늦게 닫았으면 그 시각으로 당긴다 (수동 퇴근은 존중)
      if r.check_out is not null and r.auto_clocked_out
         and (r.check_out at time zone 'Asia/Seoul')::time > v_lv_start then
        update public.attendance_records
           set check_out      = (r.date + v_lv_start)::timestamp at time zone 'Asia/Seoul',
               status         = 'half_day',
               work_hours     = round((greatest(0,
                                  extract(epoch from (
                                    ((r.date + v_lv_start)::timestamp at time zone 'Asia/Seoul')
                                    - greatest(r.check_in, ((r.date + v_work_start)::timestamp at time zone 'Asia/Seoul'))
                                  )) / 60.0 - v_lunch) / 60.0)::numeric, 2),
               overtime_hours = 0
         where id = r.id;
      elsif r.status in ('present', 'late') then
        update public.attendance_records set status = 'half_day' where id = r.id;
      end if;
    elsif v_lv_end < v_work_end then
      -- 오전 반차형 — 반차 끝 + 유예 30분 안 출근이면 지각 해제
      if r.status in ('present', 'late') then
        update public.attendance_records
           set status       = 'half_day',
               is_late      = case when (r.check_in at time zone 'Asia/Seoul')::time <= v_lv_end + interval '30 minutes'
                                   then false else r.is_late end,
               late_minutes = case when (r.check_in at time zone 'Asia/Seoul')::time <= v_lv_end + interval '30 minutes'
                                   then 0 else r.late_minutes end
         where id = r.id;
      end if;
    end if;
  end loop;
  return new;
end;
$function$;

drop trigger if exists trg_leave_approve_reconcile on public.leave_requests;
create trigger trg_leave_approve_reconcile
  after insert or update of status on public.leave_requests
  for each row execute function public.reconcile_attendance_on_leave_approve();
