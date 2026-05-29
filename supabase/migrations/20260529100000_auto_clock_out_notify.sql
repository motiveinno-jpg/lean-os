-- ============================================================================
-- auto_clock_out_at_work_end() 재정의 — 자동 퇴근 처리 + 직원 알림 insert
-- ----------------------------------------------------------------------------
-- 핸드오프(2026-05-29): cron 자동 퇴근 시 해당 직원에게 notifications insert.
-- 이전 마이그(20260529090000_overtime_requests.sql) 의 함수 본문만 교체.
-- cron job(auto-clock-out, */5 * * * *) 은 재등록 X — 함수 본문만 갱신.
--
-- 핸드오프 SQL vs 실제 스키마 차이 조정:
--   - attendance_records 컬럼은 check_in / check_out (이전 마이그 주석 명시).
--     핸드오프의 check_out_time → check_out 로 변경.
--   - 'clocked_in' status enum 없음. 'present'/'late' + check_in NOT NULL +
--     check_out IS NULL 패턴이 곧 "출근중" (이전 마이그 패턴과 동일).
--   - 함수 시그니처는 returns integer 유지 (clients/RPC 호환). table 반환으로
--     바꾸면 typeof RPC 변경 → 클라이언트 깨짐 + 핸드오프 "타입 변경 0" 위배.
--   - attendance_records.company_id 가 존재(이전 마이그에서 활용) — 직접 사용.
--     employees join 으로 user_id 만 추가 fetch.
--   - notifications.type CHECK 제약에 'overtime_auto_clockout' 등록 필요(아래 1).
--   - notifications RLS: insert 함수가 SECURITY DEFINER + owner=postgres 이므로
--     RLS bypass 가능. owner 명시 변경 없이 그대로(이전 함수와 동일).
--   - 일부 employees.user_id 가 null 가능 — INSERT 절에서 user_id IS NOT NULL
--     인 대상만 알림 발송.
-- ============================================================================

-- 1) notifications.type CHECK 제약에 'overtime_auto_clockout' 추가 ----------
--    (idempotent — 기존 제약 drop 후 새 enum 셋으로 재생성)
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type = any (array[
    'deal_update'::text,
    'expense_request'::text,
    'contract_expiry'::text,
    'signature_request'::text,
    'payment_due'::text,
    'system'::text,
    'document'::text,
    'approval'::text,
    'chat'::text,
    'overtime_auto_clockout'::text
  ]));

-- 2) auto_clock_out_at_work_end() 본문 재정의 -------------------------------
create or replace function public.auto_clock_out_at_work_end()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now_kst   timestamp;
  v_today_kst date;
  v_count     integer := 0;
begin
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
  updated as (
    update public.attendance_records ar
       set check_out         = now(),
           auto_clocked_out  = true
      from closing cl
     where ar.id = cl.attendance_id
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
$$;

revoke all on function public.auto_clock_out_at_work_end() from public;

comment on function public.auto_clock_out_at_work_end() is
  '5분 cron: 오늘 출근중인 직원 중 work_end_time(또는 승인된 overtime 종료시각) 지난 행을 자동 퇴근 처리. 마감 건수 반환. 자동 퇴근 처리된 직원에게 notifications insert (user_id NOT NULL 인 경우).';
