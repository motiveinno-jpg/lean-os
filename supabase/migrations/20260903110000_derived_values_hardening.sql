-- 파생 숫자 전수 예외처리 (2026-09-03 사장님: "휴가처럼 안 맞는 곳 절대 안 나오게 싹 다")
--
--   조사 결과(DB 함수·앱 코드에서 '기존값 ± N' 으로 합계를 고치는 곳 전수):
--     ① leave_balances.used_days — 20260903100000 에서 승인 기록 합으로 재계산(완료)
--     ② leave_balances.total_days — leave_grants 합. 자정 크론(sync_leave_balance_totals)만 맞춰서 관리자가 부여를 넣으면
--        다음날까지 잔여가 안 맞았다 → 부여가 바뀌면 즉시 재계산(트리거)
--     ③ company_storage_usage — 스토리지 트리거가 유지. 트리거는 예외안전이라 실패분이 조용히 누락될 수 있음 → 매일 새벽 실물과 대조·보정
--     ④ bank_accounts.balance — 지급대기 '지급 완료/환불'이 화면에서 ±금액 하던 것은 앱에서 제거(이체 기능 없음, 잔액은 은행 연동이 원천)
--     ⑤ credit_balances(충전 잔액)·sync_quota_usage·view_count 류 — DB 함수 단일 경로(구매 원장 status='paid' 잠금)라 유지, 대조 대상 아님
--     ⑥ 부분 휴가(반차) 승인 시 근태를 '반차'로 바꾸는 트리거가 취소·반려 때는 되돌리지 않았다 → 되돌림 추가
--   기존 데이터 처리: 아래 reconcile_derived_values() 를 즉시 1회 실행(모티브 포함 전 회사 — 파생값 정합이라 데이터 생성 아님).

-- ② 부여(leave_grants) 변경 → 그 직원·연도 총부여 즉시 재계산 (sync_leave_balance_totals 와 같은 식·같은 게이트)
create or replace function public.trg_leave_grants_sync_total()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_emp uuid; v_year int; v_company uuid; v_total numeric;
begin
  v_emp := coalesce(new.employee_id, old.employee_id);
  v_year := coalesce(new.year, old.year);
  v_company := coalesce(new.company_id, old.company_id);
  if not public.leave_accrual_enabled(v_company) then return coalesce(new, old); end if;
  select coalesce(sum(days), 0) into v_total from public.leave_grants where employee_id = v_emp and year = v_year;
  insert into public.leave_balances (company_id, employee_id, year, total_days, used_days)
  values (v_company, v_emp, v_year, v_total, 0)
  on conflict (employee_id, year) do update set total_days = excluded.total_days;
  return coalesce(new, old);
end $$;
drop trigger if exists leave_grants_sync_total on public.leave_grants;
create trigger leave_grants_sync_total
  after insert or update or delete on public.leave_grants
  for each row execute function public.trg_leave_grants_sync_total();

-- ⑥ 부분 휴가 취소·반려 → 근태 '반차' 표시 되돌림 (승인 트리거의 반대 동작)
create or replace function public.reconcile_attendance_on_leave_cancel()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op <> 'UPDATE' then return new; end if;
  if old.status <> 'approved' or new.status not in ('cancelled', 'rejected') then return new; end if;
  if old.leave_unit not in ('half_day', 'two_hours') then return new; end if;
  update public.attendance_records ar
     set status = case when coalesce(ar.is_late, false) then 'late' else 'present' end
   where ar.employee_id = old.employee_id
     and ar.date between old.start_date and old.end_date
     and ar.status = 'half_day' and ar.check_in is not null;
  return new;
end $$;
drop trigger if exists trg_leave_cancel_reconcile on public.leave_requests;
create trigger trg_leave_cancel_reconcile
  after update of status on public.leave_requests
  for each row execute function public.reconcile_attendance_on_leave_cancel();

-- ③ + 자기치유: 매일 새벽 파생값을 원천과 대조해 고친다 (트리거가 놓친 것까지)
create or replace function public.reconcile_derived_values()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_leave int := 0; v_storage int := 0; v_storage_before jsonb;
begin
  -- 연차: 총부여(부여 합)·사용(승인 기록 합 + 보정) 다시 계산
  perform public.sync_leave_balance_totals(null);
  with t as (update public.leave_balances lb set used_days = lb.used_days
             where lb.used_days is distinct from (public.leave_used_from_requests(lb.employee_id, lb.year) + coalesce(lb.adjust_days, 0))
             returning 1)
  select count(*) into v_leave from t;

  -- 스토리지: 실물(storage.objects) 합계와 카운터 대조 → 다른 회사만 고친다
  with actual as (
    select public.storage_object_company(bucket_id, name) as cid,
           sum(coalesce((metadata->>'size')::bigint, 0)) as bytes, count(*) as n
      from storage.objects group by 1
  ),
  fixed as (
    update public.company_storage_usage u
       set used_bytes = a.bytes, object_count = a.n, updated_at = now()
      from actual a
     where a.cid = u.company_id and (u.used_bytes <> a.bytes or u.object_count <> a.n)
     returning u.company_id
  ),
  inserted as (
    insert into public.company_storage_usage (company_id, used_bytes, object_count)
    select a.cid, a.bytes, a.n from actual a
     where a.cid is not null and not exists (select 1 from public.company_storage_usage u where u.company_id = a.cid)
    returning company_id
  ),
  zeroed as (
    update public.company_storage_usage u set used_bytes = 0, object_count = 0, updated_at = now()
     where u.used_bytes > 0 and not exists (select 1 from actual a where a.cid = u.company_id)
     returning company_id
  )
  select (select count(*) from fixed) + (select count(*) from inserted) + (select count(*) from zeroed) into v_storage;

  return jsonb_build_object('leave_balances_fixed', v_leave, 'storage_rows_fixed', v_storage, 'at', now());
end $$;
revoke all on function public.reconcile_derived_values() from public, anon, authenticated;

do $$ begin
  perform cron.unschedule('reconcile-derived-values') where exists (select 1 from cron.job where jobname = 'reconcile-derived-values');
end $$;
select cron.schedule('reconcile-derived-values', '30 18 * * *', $cron$select public.reconcile_derived_values();$cron$);  -- 03:30 KST

-- 즉시 1회
select public.reconcile_derived_values();
