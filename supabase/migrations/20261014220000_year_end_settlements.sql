-- 연말정산(year_end_settlements) — 2026-10-14 연말정산 2단계 (docs/20261014_PLAN_year_end_settlement.md)
--
-- 왜: 연말정산은 직원이 공제 자료를 넣고(마이페이지) 담당자가 급여 자료와 맞춰 계산·확정하는 일이다.
--     지금은 담을 곳이 없어 엑셀·메일로 오갔다. 직원 1명 × 귀속연도 1줄로 입력 → 제출 → (반려) → 확정 흐름을 남긴다.
--
-- 규칙:
--   한 사람 한 해 한 줄 — unique (employee_id, year).
--   input    = 직원이 넣은 공제 자료(64KB 미만).
--   payroll  = 담당자 확정 때 급여 자료 스냅샷(총급여·4대보험·기납부, 64KB 미만) — 나중에 급여가 고쳐져도 확정본은 그대로.
--   result   = 확정 때 계산 결과(128KB 미만). 계산은 화면(lib)이 하고 숫자를 저장한다.
--   상태: draft(작성) → submitted(제출) → returned(반려, 사유) / confirmed(확정).
--   읽기 = 본인 행은 본인 · 같은 회사 AND (마스터 OR /employees:salary) — retirement_payments 와 같은 모양.
--   쓰기(insert·update) = 같은 조건(본인 OR 인사 담당). 지우기 = 인사 담당만.
--   가드 트리거(SECURITY DEFINER — 정책이 칸을 못 보므로 여기서 칸을 지킨다):
--     · 사용자 호출은 company_id = 내 회사여야 한다(아니면 직원과 상관없이 '권한이 없습니다' 42501 — 20261014110000 과 같은 이유).
--       직원은 같은 회사 사람이어야 한다. UPDATE 는 회사·직원·연도·작성시각을 old 로 고정한다.
--     · 인사 담당이 아닌 직원: 자기 행만 · 상태는 draft·submitted 만 · 확정된 행은 못 고친다 ·
--       payroll·result·confirmed_by/at·return_reason 은 못 바꾼다(새 줄이면 비운다).
--     · 인사 담당: 어떤 상태든. confirmed 로 바뀔 때 confirmed_by = 나, confirmed_at = now() 를 강제하고, 확정에서 벗어나면 비운다.
--     · submitted 로 바뀔 때 submitted_at = now(). 그 밖엔 old 값(화면 값 무시).
--   세무대리인 쓰기 금지 — advisor_ro_* RESTRICTIVE 정본 패턴.
--   화면은 feature_rollout('year_end_settlement') 로 모티브부터 연다(표·정책은 전 회사 공통, 데이터는 사람이 만든다).
--
-- 기존 데이터: 새 표라 없음. feature_rollout 에 모티브 한 줄만 더한다.
-- 버린 안: 공제 항목마다 정규화된 표 — 국세청 서식이 해마다 바뀌고 줄 단위 조회가 필요 없다. jsonb 한 덩어리 + 확정 스냅샷.
--          / 직원 입력과 담당자 계산을 다른 표로 — 반려·재제출이 오가는 한 건이라 상태 하나로 묶는 편이 단순하다.
--          / 확정 후 잠금을 정책으로 — 정책은 old 값을 못 본다. 트리거가 맡는다.

create table if not exists public.year_end_settlements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  year int not null check (year between 2020 and 2100),
  status text not null default 'draft' check (status in ('draft', 'submitted', 'returned', 'confirmed')),
  input jsonb not null default '{}'::jsonb check (pg_column_size(input) < 65536),
  payroll jsonb not null default '{}'::jsonb check (pg_column_size(payroll) < 65536),
  result jsonb not null default '{}'::jsonb check (pg_column_size(result) < 131072),
  return_reason text check (length(return_reason) <= 500),
  submitted_at timestamptz,
  confirmed_by uuid references public.users(id) on delete set null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint year_end_settlements_employee_year_key unique (employee_id, year)
);

comment on table public.year_end_settlements is
  '연말정산 — 직원 1명 × 귀속연도 1줄. 직원 입력(input) → 제출 → 담당자 확정(payroll·result 스냅샷).';

create index if not exists year_end_settlements_company_year_idx on public.year_end_settlements (company_id, year);

alter table public.year_end_settlements enable row level security;

revoke all on public.year_end_settlements from anon;
revoke truncate, references, trigger on public.year_end_settlements from authenticated;
grant select, insert, update, delete on public.year_end_settlements to authenticated;

drop policy if exists year_end_settlements_select on public.year_end_settlements;
create policy year_end_settlements_select on public.year_end_settlements
  for select to authenticated
  using (
    employee_id = (select public.current_employee_id())
    or (company_id = (select public.get_my_company_id())
        and ((select public.is_company_admin()) or (select public.has_perm('/employees:salary'))))
  );

drop policy if exists year_end_settlements_insert on public.year_end_settlements;
create policy year_end_settlements_insert on public.year_end_settlements
  for insert to authenticated
  with check (
    employee_id = (select public.current_employee_id())
    or (company_id = (select public.get_my_company_id())
        and ((select public.is_company_admin()) or (select public.has_perm('/employees:salary'))))
  );

drop policy if exists year_end_settlements_update on public.year_end_settlements;
create policy year_end_settlements_update on public.year_end_settlements
  for update to authenticated
  using (
    employee_id = (select public.current_employee_id())
    or (company_id = (select public.get_my_company_id())
        and ((select public.is_company_admin()) or (select public.has_perm('/employees:salary'))))
  )
  with check (
    employee_id = (select public.current_employee_id())
    or (company_id = (select public.get_my_company_id())
        and ((select public.is_company_admin()) or (select public.has_perm('/employees:salary'))))
  );

drop policy if exists year_end_settlements_delete on public.year_end_settlements;
create policy year_end_settlements_delete on public.year_end_settlements
  for delete to authenticated
  using (
    company_id = (select public.get_my_company_id())
    and ((select public.is_company_admin()) or (select public.has_perm('/employees:salary')))
  );

drop policy if exists advisor_ro_ins on public.year_end_settlements;
create policy advisor_ro_ins on public.year_end_settlements as restrictive for insert to authenticated with check (not (select public.is_advisor_session()));
drop policy if exists advisor_ro_upd on public.year_end_settlements;
create policy advisor_ro_upd on public.year_end_settlements as restrictive for update to authenticated using (not (select public.is_advisor_session()));
drop policy if exists advisor_ro_del on public.year_end_settlements;
create policy advisor_ro_del on public.year_end_settlements as restrictive for delete to authenticated using (not (select public.is_advisor_session()));

-- 칸 보호 — 회사·직원 확인 → 고정 칸 → 직원/담당자 규칙 → 시각
create or replace function public.year_end_settlements_guard()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_sys boolean := auth.uid() is null;   -- 서비스 키·DB 직접(크론 등) — 사람 규칙을 적용하지 않는다
        v_hr boolean; v_emp_co uuid; v_keep_by uuid;
begin
  if tg_op = 'INSERT' and not v_sys and new.company_id is distinct from public.get_my_company_id() then
    raise exception '권한이 없습니다' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    new.company_id := old.company_id;
    new.employee_id := old.employee_id;
    new.year := old.year;
    new.created_at := old.created_at;
    -- 확정자 칸: 사용자 행이 지워져 FK 가 NULL 로 내리는 경우만 따른다(그 밖엔 old 로 되돌린다 — 무조건 되돌리면 사용자 삭제가 실패한다)
    v_keep_by := case when new.confirmed_by is null and old.confirmed_by is not null
                           and not exists (select 1 from public.users u where u.id = old.confirmed_by)
                      then null else old.confirmed_by end;
  else
    select e.company_id into v_emp_co from public.employees e where e.id = new.employee_id;
    if v_emp_co is distinct from new.company_id then raise exception '같은 회사 직원이 아닙니다' using errcode = '42501'; end if;
    new.created_at := now();
  end if;

  v_hr := v_sys or public.is_company_admin() or public.has_perm('/employees:salary');

  if not v_hr then
    if new.employee_id is distinct from public.current_employee_id() then
      raise exception '본인 연말정산만 고칠 수 있습니다' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and old.status = 'confirmed' then
      raise exception '확정된 연말정산은 고칠 수 없습니다 — 담당자에게 확정 취소를 요청하세요' using errcode = '42501';
    end if;
    if new.status not in ('draft', 'submitted') then
      raise exception '작성·제출만 할 수 있습니다' using errcode = '42501';
    end if;
    if tg_op = 'INSERT' then
      new.payroll := '{}'::jsonb; new.result := '{}'::jsonb; new.return_reason := null;
      new.confirmed_by := null; new.confirmed_at := null;
    else
      new.payroll := old.payroll; new.result := old.result; new.return_reason := old.return_reason;
      new.confirmed_by := v_keep_by; new.confirmed_at := old.confirmed_at;
    end if;
  else
    if new.status = 'confirmed' then
      if tg_op = 'INSERT' or old.status is distinct from 'confirmed' then
        new.confirmed_by := public.current_app_user_id();
        new.confirmed_at := now();
      else
        new.confirmed_by := v_keep_by;
        new.confirmed_at := old.confirmed_at;
      end if;
    else
      new.confirmed_by := null;
      new.confirmed_at := null;
    end if;
  end if;

  if new.status = 'submitted' and (tg_op = 'INSERT' or old.status is distinct from 'submitted') then
    new.submitted_at := now();
  elsif tg_op = 'UPDATE' then
    new.submitted_at := old.submitted_at;
  else
    new.submitted_at := null;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_year_end_settlements_guard on public.year_end_settlements;
create trigger trg_year_end_settlements_guard before insert or update on public.year_end_settlements
  for each row execute function public.year_end_settlements_guard();

revoke all on function public.year_end_settlements_guard() from public, anon, authenticated;

-- 화면 게이트 — 모티브부터
insert into public.feature_rollout (feature, company_id, note)
select 'year_end_settlement', 'c361afb9-8a52-4cac-add9-8992f0f7c09c'::uuid, '연말정산 2단계 — 모티브 먼저(2026-10-14)'
where not exists (select 1 from public.feature_rollout where feature = 'year_end_settlement');
