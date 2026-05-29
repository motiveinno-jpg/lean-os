-- ============================================================================
-- 연장근무 신청·승인·자동퇴근 — 스키마 + RLS + RPC 4종 + cron
-- ----------------------------------------------------------------------------
-- 정책 본문은 users/employees 인라인 서브쿼리 금지(재귀 회피, lessons 2026-05-19).
-- 모든 신원/역할 판정은 기존 SECURITY DEFINER STABLE 헬퍼만 사용:
--   - public.current_app_user_id()   : users.id (auth.uid() → users PK)
--   - public.get_my_company_id()     : 호출자 company_id
--   - public.is_company_admin()      : role IN ('owner','admin')
-- 실 컬럼: attendance_records.check_in / check_out / status('present','late').
--   "clocked_in"은 check_in IS NOT NULL AND check_out IS NULL 패턴으로 본다.
-- ============================================================================

-- 1) 테이블 ---------------------------------------------------------------
create table if not exists public.overtime_requests (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  employee_id         uuid not null references public.employees(id) on delete cascade,
  requested_date      date not null,
  requested_end_time  time not null,
  reason              text not null check (char_length(reason) >= 5),
  status              text not null default 'pending'
                      check (status in ('pending','approved','rejected','cancelled')),
  approved_by         uuid references public.users(id),
  approved_at         timestamptz,
  rejected_reason     text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists overtime_requests_company_date_status_idx
  on public.overtime_requests (company_id, requested_date, status);
create index if not exists overtime_requests_employee_date_idx
  on public.overtime_requests (employee_id, requested_date desc);

-- 한 직원·하루에 활성(pending/approved) 신청 1건만
create unique index if not exists overtime_requests_one_active_per_day
  on public.overtime_requests (employee_id, requested_date)
  where status in ('pending','approved');

-- updated_at 자동 갱신 트리거
create or replace function public.overtime_requests_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists overtime_requests_touch_updated_at on public.overtime_requests;
create trigger overtime_requests_touch_updated_at
  before update on public.overtime_requests
  for each row execute function public.overtime_requests_touch_updated_at();

-- 2) attendance_records 컬럼 추가 -----------------------------------------
alter table public.attendance_records
  add column if not exists overtime_request_id uuid references public.overtime_requests(id),
  add column if not exists auto_clocked_out boolean not null default false;

-- 3) RLS -----------------------------------------------------------------
alter table public.overtime_requests enable row level security;
alter table public.overtime_requests force row level security;

-- SELECT: 본인 신청(employee) + 회사 관리자/대표
drop policy if exists overtime_requests_select on public.overtime_requests;
create policy overtime_requests_select on public.overtime_requests
  for select
  using (
    company_id = public.get_my_company_id()
    and (
      public.is_company_admin()
      or employee_id in (
        select id from public.employees where user_id = public.current_app_user_id()
      )
    )
  );
-- NOTE: 위 employees 서브쿼리는 RLS 본문 인라인 서브쿼리지만, public.employees 의
-- SELECT 정책은 본인/회사 격리로 통과되며 회사 격리 헬퍼(get_my_company_id)가
-- 먼저 가드한다. 더 엄격한 회피를 원하면 current_app_employee_id() 헬퍼 신설을
-- db-architect 후속 마이그로 분리할 것.
-- 본 마이그에서는 신규 헬퍼를 별도 SECURITY DEFINER 함수로 캡슐화한다 ↓

create or replace function public.current_app_employee_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select e.id
  from public.employees e
  where e.user_id = public.current_app_user_id()
  limit 1;
$$;

-- 위 헬퍼 신설로 SELECT 정책 본문에서 employees 서브쿼리 제거 (재귀 0)
drop policy if exists overtime_requests_select on public.overtime_requests;
create policy overtime_requests_select on public.overtime_requests
  for select
  using (
    company_id = public.get_my_company_id()
    and (
      public.is_company_admin()
      or employee_id = public.current_app_employee_id()
    )
  );

-- INSERT: 본인 신청만, status=pending, approved_by null, 회사격리 강제
drop policy if exists overtime_requests_insert on public.overtime_requests;
create policy overtime_requests_insert on public.overtime_requests
  for insert
  with check (
    company_id = public.get_my_company_id()
    and employee_id = public.current_app_employee_id()
    and status = 'pending'
    and approved_by is null
    and approved_at is null
  );

-- UPDATE:
--   본인 — 자기 행을 'cancelled' 로만 (다른 필드/상태 전환 X)
--   admin/owner — 회사 안에서 자유 (RPC 통해서만 권장이나 RLS로 막진 않음)
drop policy if exists overtime_requests_update on public.overtime_requests;
create policy overtime_requests_update on public.overtime_requests
  for update
  using (
    company_id = public.get_my_company_id()
    and (
      public.is_company_admin()
      or employee_id = public.current_app_employee_id()
    )
  )
  with check (
    company_id = public.get_my_company_id()
    and (
      public.is_company_admin()
      or (
        employee_id = public.current_app_employee_id()
        and status = 'cancelled'
      )
    )
  );

-- DELETE: admin/owner 만 (회사격리)
drop policy if exists overtime_requests_delete on public.overtime_requests;
create policy overtime_requests_delete on public.overtime_requests
  for delete
  using (
    company_id = public.get_my_company_id()
    and public.is_company_admin()
  );

-- 4) RPC ----------------------------------------------------------------

-- 4-1) request_overtime: 본인이 사전 신청
create or replace function public.request_overtime(
  p_requested_date     date,
  p_requested_end_time time,
  p_reason             text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id     uuid;
  v_employee_id uuid;
  v_company_id  uuid;
  v_req_id      uuid;
begin
  v_user_id := public.current_app_user_id();
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select e.id, e.company_id
    into v_employee_id, v_company_id
    from public.employees e
    where e.user_id = v_user_id
      and e.status = 'joined'
    limit 1;

  if v_employee_id is null then
    raise exception 'EMPLOYEE_NOT_FOUND' using errcode = 'P0002';
  end if;

  if p_reason is null or char_length(btrim(p_reason)) < 5 then
    raise exception 'REASON_TOO_SHORT' using errcode = '22023';
  end if;

  if p_requested_end_time is null then
    raise exception 'END_TIME_REQUIRED' using errcode = '22023';
  end if;

  if p_requested_date is null then
    raise exception 'DATE_REQUIRED' using errcode = '22023';
  end if;

  insert into public.overtime_requests(
    company_id, employee_id, requested_date, requested_end_time, reason, status
  )
  values (
    v_company_id, v_employee_id, p_requested_date, p_requested_end_time, btrim(p_reason), 'pending'
  )
  returning id into v_req_id;

  return v_req_id;
exception
  when unique_violation then
    raise exception 'ALREADY_REQUESTED_FOR_DATE' using errcode = '23505';
end;
$$;

revoke all on function public.request_overtime(date, time, text) from public;
grant execute on function public.request_overtime(date, time, text) to authenticated;

-- 4-2) approve_overtime: 관리자/대표 승인
create or replace function public.approve_overtime(
  p_request_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id    uuid;
  v_company_id uuid;
  v_req        public.overtime_requests%rowtype;
begin
  v_user_id := public.current_app_user_id();
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  if not public.is_company_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  v_company_id := public.get_my_company_id();

  select * into v_req
    from public.overtime_requests
    where id = p_request_id
    for update;

  if not found then
    raise exception 'REQUEST_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_req.company_id <> v_company_id then
    raise exception 'FORBIDDEN_CROSS_COMPANY' using errcode = '42501';
  end if;

  if v_req.status <> 'pending' then
    raise exception 'NOT_PENDING' using errcode = '22023';
  end if;

  update public.overtime_requests
     set status      = 'approved',
         approved_by = v_user_id,
         approved_at = now()
   where id = p_request_id;
end;
$$;

revoke all on function public.approve_overtime(uuid) from public;
grant execute on function public.approve_overtime(uuid) to authenticated;

-- 4-3) reject_overtime: 관리자/대표 반려 (사유 필수)
create or replace function public.reject_overtime(
  p_request_id uuid,
  p_reason     text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id    uuid;
  v_company_id uuid;
  v_req        public.overtime_requests%rowtype;
begin
  v_user_id := public.current_app_user_id();
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  if not public.is_company_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    raise exception 'REASON_TOO_SHORT' using errcode = '22023';
  end if;

  v_company_id := public.get_my_company_id();

  select * into v_req
    from public.overtime_requests
    where id = p_request_id
    for update;

  if not found then
    raise exception 'REQUEST_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_req.company_id <> v_company_id then
    raise exception 'FORBIDDEN_CROSS_COMPANY' using errcode = '42501';
  end if;

  if v_req.status <> 'pending' then
    raise exception 'NOT_PENDING' using errcode = '22023';
  end if;

  update public.overtime_requests
     set status          = 'rejected',
         approved_by     = v_user_id,
         approved_at     = now(),
         rejected_reason = btrim(p_reason)
   where id = p_request_id;
end;
$$;

revoke all on function public.reject_overtime(uuid, text) from public;
grant execute on function public.reject_overtime(uuid, text) to authenticated;

-- 4-4) check_can_clock_in_after_hours
-- 인풋: p_employee_id (호출자가 본인 또는 회사 admin 인지는 RLS/RPC 호출 흐름에서 분리 검증)
-- 반환: (allowed, reason, overtime_request_id)
--   allowed=true, reason 'BEFORE_WORK_END' : 아직 work_end_time 이전
--   allowed=true, reason 'NO_WORK_END'     : work_end_time 미설정 회사
--   allowed=true, reason 'OVERTIME_APPROVED', overtime_request_id 동봉
--   allowed=false, reason 'NO_OVERTIME_REQUEST'
--   allowed=false, reason 'OVERTIME_EXPIRED'
create or replace function public.check_can_clock_in_after_hours(
  p_employee_id uuid
)
returns table(
  allowed             boolean,
  reason              text,
  overtime_request_id uuid
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company_id   uuid;
  v_work_end     time;
  v_now_kst      timestamp;
  v_today_kst    date;
  v_now_time_kst time;
  v_req_id       uuid;
  v_req_end      time;
begin
  -- KST(now)
  v_now_kst      := (now() at time zone 'Asia/Seoul');
  v_today_kst    := v_now_kst::date;
  v_now_time_kst := v_now_kst::time;

  -- 직원 → 회사 → work_end_time
  select e.company_id
    into v_company_id
    from public.employees e
    where e.id = p_employee_id;

  if v_company_id is null then
    return query select false, 'EMPLOYEE_NOT_FOUND'::text, null::uuid;
    return;
  end if;

  select cs.work_end_time
    into v_work_end
    from public.company_settings cs
    where cs.company_id = v_company_id
    limit 1;

  if v_work_end is null then
    return query select true, 'NO_WORK_END'::text, null::uuid;
    return;
  end if;

  if v_now_time_kst <= v_work_end then
    return query select true, 'BEFORE_WORK_END'::text, null::uuid;
    return;
  end if;

  -- work_end_time 지남 → approved overtime 필요
  select o.id, o.requested_end_time
    into v_req_id, v_req_end
    from public.overtime_requests o
    where o.employee_id    = p_employee_id
      and o.requested_date = v_today_kst
      and o.status         = 'approved'
    order by o.approved_at desc nulls last
    limit 1;

  if v_req_id is null then
    return query select false, 'NO_OVERTIME_REQUEST'::text, null::uuid;
    return;
  end if;

  if v_now_time_kst > v_req_end then
    return query select false, 'OVERTIME_EXPIRED'::text, v_req_id;
    return;
  end if;

  return query select true, 'OVERTIME_APPROVED'::text, v_req_id;
end;
$$;

revoke all on function public.check_can_clock_in_after_hours(uuid) from public;
grant execute on function public.check_can_clock_in_after_hours(uuid) to authenticated;

-- 5) 자동 퇴근 함수 + cron --------------------------------------------------
-- KST 자정 기준 오늘 + clocked_in(check_in IS NOT NULL AND check_out IS NULL)
-- work_end_time 지났고 approved overtime 없거나 종료시각 지난 행을
-- auto_clocked_out=true + check_out=KST(now) 로 마감
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
      ar.id           as attendance_id,
      ar.employee_id  as employee_id,
      ar.company_id   as company_id,
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
    join public.company_settings cs on cs.company_id = ar.company_id
    where ar.date = v_today_kst
      and ar.check_in  is not null
      and ar.check_out is null
      and cs.work_end_time is not null
  ),
  closing as (
    select c.attendance_id
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
     returning ar.id
  )
  select count(*)::int into v_count from updated;

  return coalesce(v_count, 0);
end;
$$;

revoke all on function public.auto_clock_out_at_work_end() from public;
-- cron 은 superuser 컨텍스트 — 명시적 grant 불요. authenticated 클라이언트에서
-- 임의 호출은 막는다.

-- pg_cron 등록 (5분마다). 이미 같은 이름의 job 이 있으면 unschedule 후 재등록.
do $$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname = 'auto-clock-out';
  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;

  perform cron.schedule(
    'auto-clock-out',
    '*/5 * * * *',
    $cmd$ select public.auto_clock_out_at_work_end(); $cmd$
  );
end;
$$;

-- 6) Comments -------------------------------------------------------------
comment on table public.overtime_requests is '연장근무 사전 신청 — 직원이 work_end_time 이후 출근/잔류 사유와 종료시각을 신고하고 admin/owner 가 승인.';
comment on column public.overtime_requests.requested_end_time is '연장근무 종료 예정 시각 (KST). cron 자동 퇴근 함수가 이 시각을 지나면 강제 마감.';
comment on column public.attendance_records.overtime_request_id is '해당 출근이 연계된 연장근무 신청. 클라이언트 출근 시 check_can_clock_in_after_hours 로 검증 후 채워넣기.';
comment on column public.attendance_records.auto_clocked_out is 'cron 자동 마감 여부. true 면 직원이 명시 퇴근 처리 안 한 상태에서 시스템이 닫음.';
comment on function public.request_overtime(date, time, text) is '본인 연장근무 신청. status=pending 으로 입력. UNIQUE (employee_id, date) WHERE status IN (pending,approved) 가드.';
comment on function public.approve_overtime(uuid) is '관리자/대표가 pending 신청을 approved 로 전환.';
comment on function public.reject_overtime(uuid, text) is '관리자/대표가 pending 신청을 rejected 로 전환 (사유 필수).';
comment on function public.check_can_clock_in_after_hours(uuid) is '특정 직원이 work_end_time 이후 시점에 출근 허용되는지 판정. (allowed, reason, overtime_request_id) 반환.';
comment on function public.auto_clock_out_at_work_end() is '5분 cron: 오늘 출근중인 직원 중 work_end_time(또는 승인된 overtime 종료시각) 지난 행을 자동 퇴근 처리. 마감 건수 반환.';
