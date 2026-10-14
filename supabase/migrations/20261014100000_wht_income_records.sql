-- 원천세 소득 확장 자료 — 일용근로 기록(daily_work_logs) · 기타·이자·배당 지급 기록(income_payments)
--   2026-10-14 세무 2차 4단계, 결정 262 (docs/20261012_PLAN_tax_closing_v2.md)
--
-- 왜: 원천세 신고서는 급여(payroll_items)·퇴직금(retirement_payments)만 읽어 A03(일용근로)·A40(기타)·A50(이자)·A60(배당)이
--     늘 0 이었다. 직접 더해 적으라고만 했고 근거가 남지 않았다. 지급 한 건을 한 줄로 남겨 그 지급월 신고서에 자동으로 넣는다.
--
-- 규칙:
--   세액은 화면(lib/tax-forms/wht-income.ts)이 계산해 저장한다 — 신고서는 저장된 숫자를 그대로 쓴다(낸 신고는 세법이 바뀌어도 그대로).
--   daily_work_logs
--     한 사람 하루 한 줄 — unique (employee_id, work_date). 일당은 1억 이하.
--     직원은 같은 회사 + employment_type = 'daily' 만(아니면 22023 '일용직 구성원만 기록합니다').
--     읽기 = 본인 행은 본인도 · 같은 회사 AND (회사 관리자 OR /employees:salary) — retirement_payments 와 같은 모양.
--     쓰기 = 같은 회사 AND (회사 관리자 OR /employees:salary).
--   income_payments
--     받는 사람 이름·개인/법인만 적는다. **주민등록번호 칸은 두지 않는다**(이 표에 주민번호를 저장하지 않는다 — 지급명세서는 따로).
--     필요경비 ≤ 지급액, 세율 0~50%.
--     읽기·쓰기 = 같은 회사 AND (회사 관리자 OR /finance/tax-filing).
--   두 표 공통
--     가드 트리거(SECURITY DEFINER): UPDATE 는 회사·작성자·작성시각부터 고정한 뒤 직원을 확인한다
--       (retirement_payments 2026-10-07 security-reviewer 지적 순서 — 반대면 company_id 를 남의 회사로 보내 그 회사 직원 이름을 읽는다).
--     INSERT 의 작성자는 current_app_user_id() 로 강제(화면 값 무시). 이름 스냅샷은 언제나 DB 에서.
--     created_by 는 users FK on delete set null — 사용자 행이 지워진 경우에만 NULL 로 내려가게 둔다
--       (그 밖엔 old 값으로 되돌린다. 무조건 되돌리면 사용자 삭제가 FK 검사에 걸려 실패한다 — tax_returns 보강 때 같은 함정).
--     세무대리인 쓰기 금지 — advisor_ro_* RESTRICTIVE 정본 패턴.
--
-- 기존 데이터: 새 표라 없음.
-- 버린 안: payroll_items 에 '일용' 줄로 넣기 — 급여 명세 발송·간이지급명세서(근로)·급여 대장이 그 표를 읽어 일용 소득이 상용 근로로 섞인다.
--          / 기타·이자·배당을 partners(거래처)에 묶기 — 받는 사람이 개인(강사·주주)인 경우가 많아 거래처가 없다. 이름만 적는다.
--          / income_payments 에 주민번호 칸 — 보관·암호화·열람 기록 부담이 생긴다. 지급명세서 제출 때 따로 받는다.

-- ── 1. 일용근로 기록 ─────────────────────────────────────────────────────
create table if not exists public.daily_work_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete set null,
  employee_name text not null default '',
  work_date date not null,
  paid_on date not null,
  daily_wage bigint not null check (daily_wage >= 0 and daily_wage <= 100000000),
  non_taxable bigint not null default 0 check (non_taxable >= 0),
  income_tax bigint not null default 0 check (income_tax >= 0),
  local_tax bigint not null default 0 check (local_tax >= 0),
  memo text check (length(memo) <= 500),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint daily_work_logs_employee_day_key unique (employee_id, work_date)
);

comment on table public.daily_work_logs is
  '일용근로 기록 — 한 사람 하루 한 줄. 원천세 A03 자동 반영(결정 262).';

create index if not exists daily_work_logs_company_paid_idx on public.daily_work_logs (company_id, paid_on desc);
create index if not exists daily_work_logs_employee_idx on public.daily_work_logs (employee_id);

alter table public.daily_work_logs enable row level security;

revoke all on public.daily_work_logs from anon;
revoke truncate, references, trigger on public.daily_work_logs from authenticated;
grant select, insert, update, delete on public.daily_work_logs to authenticated;

drop policy if exists daily_work_logs_select on public.daily_work_logs;
create policy daily_work_logs_select on public.daily_work_logs
  for select to authenticated
  using (
    employee_id = (select public.current_employee_id())
    or (company_id = (select public.get_my_company_id())
        and ((select public.is_company_admin()) or (select public.has_perm('/employees:salary'))))
  );

drop policy if exists daily_work_logs_write on public.daily_work_logs;
create policy daily_work_logs_write on public.daily_work_logs
  for all to authenticated
  using (
    company_id = (select public.get_my_company_id())
    and ((select public.is_company_admin()) or (select public.has_perm('/employees:salary')))
  )
  with check (
    company_id = (select public.get_my_company_id())
    and ((select public.is_company_admin()) or (select public.has_perm('/employees:salary')))
  );

drop policy if exists advisor_ro_ins on public.daily_work_logs;
create policy advisor_ro_ins on public.daily_work_logs as restrictive for insert to authenticated with check (not (select public.is_advisor_session()));
drop policy if exists advisor_ro_upd on public.daily_work_logs;
create policy advisor_ro_upd on public.daily_work_logs as restrictive for update to authenticated using (not (select public.is_advisor_session()));
drop policy if exists advisor_ro_del on public.daily_work_logs;
create policy advisor_ro_del on public.daily_work_logs as restrictive for delete to authenticated using (not (select public.is_advisor_session()));

-- 직원 소속·일용 확인 + 이름 스냅샷 + 작성자·시각
--   ★ UPDATE 는 회사·작성자부터 고정한 뒤 직원을 확인한다.
create or replace function public.daily_work_logs_guard()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_name text; v_type text;
begin
  if tg_op = 'UPDATE' then
    new.company_id := old.company_id;   -- 회사는 못 옮긴다
    -- 작성자: 사용자 행이 지워져 FK 가 NULL 로 내리는 경우만 따른다
    if not (new.created_by is null and old.created_by is not null
            and not exists (select 1 from public.users u where u.id = old.created_by)) then
      new.created_by := old.created_by;
    end if;
    new.created_at := old.created_at;
    new.updated_at := now();
  else
    new.created_by := public.current_app_user_id();
    new.created_at := now();
    new.updated_at := now();
  end if;
  if new.employee_id is not null then
    select coalesce(e.name, ''), e.employment_type into v_name, v_type
      from public.employees e where e.id = new.employee_id and e.company_id = new.company_id;
    if not found then raise exception '같은 회사 직원이 아닙니다' using errcode = '42501'; end if;
    -- 직원을 바꾸거나 새로 적을 때만 일용 여부를 본다(나중에 고용형태가 바뀌어도 지난 기록은 고칠 수 있게)
    if (tg_op = 'INSERT' or new.employee_id is distinct from old.employee_id) and v_type is distinct from 'daily' then
      raise exception '일용직 구성원만 기록합니다' using errcode = '22023';
    end if;
    new.employee_name := v_name;
  elsif tg_op = 'UPDATE' then
    new.employee_name := old.employee_name;   -- 직원이 지워진 기록은 스냅샷 이름을 지킨다
  end if;
  return new;
end $$;

drop trigger if exists trg_daily_work_logs_guard on public.daily_work_logs;
create trigger trg_daily_work_logs_guard before insert or update on public.daily_work_logs
  for each row execute function public.daily_work_logs_guard();

revoke all on function public.daily_work_logs_guard() from public, anon, authenticated;

-- ── 2. 기타·이자·배당 지급 기록 ──────────────────────────────────────────
create table if not exists public.income_payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  payee_name text not null check (length(payee_name) between 1 and 100),
  payee_kind text not null default 'person' check (payee_kind in ('person', 'corp')),
  income_kind text not null check (income_kind in ('other', 'interest', 'dividend')),
  sub_kind text check (length(sub_kind) <= 50),
  paid_on date not null,
  amount bigint not null check (amount >= 0 and amount <= 100000000000),
  necessary_expense bigint not null default 0 check (necessary_expense >= 0 and necessary_expense <= amount),
  tax_rate numeric(5,2) not null default 20 check (tax_rate >= 0 and tax_rate <= 50),
  income_tax bigint not null default 0 check (income_tax >= 0),
  local_tax bigint not null default 0 check (local_tax >= 0),
  memo text check (length(memo) <= 500),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.income_payments is
  '기타·이자·배당 지급 기록 — 원천세 A40·A50·A60 자동 반영(결정 262). 주민등록번호는 저장하지 않는다.';

create index if not exists income_payments_company_paid_idx on public.income_payments (company_id, paid_on desc);

alter table public.income_payments enable row level security;

revoke all on public.income_payments from anon;
revoke truncate, references, trigger on public.income_payments from authenticated;
grant select, insert, update, delete on public.income_payments to authenticated;

drop policy if exists income_payments_select on public.income_payments;
create policy income_payments_select on public.income_payments
  for select to authenticated
  using (
    company_id = (select public.get_my_company_id())
    and ((select public.is_company_admin()) or (select public.has_perm('/finance/tax-filing')))
  );

drop policy if exists income_payments_write on public.income_payments;
create policy income_payments_write on public.income_payments
  for all to authenticated
  using (
    company_id = (select public.get_my_company_id())
    and ((select public.is_company_admin()) or (select public.has_perm('/finance/tax-filing')))
  )
  with check (
    company_id = (select public.get_my_company_id())
    and ((select public.is_company_admin()) or (select public.has_perm('/finance/tax-filing')))
  );

drop policy if exists advisor_ro_ins on public.income_payments;
create policy advisor_ro_ins on public.income_payments as restrictive for insert to authenticated with check (not (select public.is_advisor_session()));
drop policy if exists advisor_ro_upd on public.income_payments;
create policy advisor_ro_upd on public.income_payments as restrictive for update to authenticated using (not (select public.is_advisor_session()));
drop policy if exists advisor_ro_del on public.income_payments;
create policy advisor_ro_del on public.income_payments as restrictive for delete to authenticated using (not (select public.is_advisor_session()));

create or replace function public.income_payments_guard()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if tg_op = 'UPDATE' then
    new.company_id := old.company_id;   -- 회사는 못 옮긴다
    if not (new.created_by is null and old.created_by is not null
            and not exists (select 1 from public.users u where u.id = old.created_by)) then
      new.created_by := old.created_by;
    end if;
    new.created_at := old.created_at;
    new.updated_at := now();
  else
    new.created_by := public.current_app_user_id();
    new.created_at := now();
    new.updated_at := now();
  end if;
  return new;
end $$;

drop trigger if exists trg_income_payments_guard on public.income_payments;
create trigger trg_income_payments_guard before insert or update on public.income_payments
  for each row execute function public.income_payments_guard();

revoke all on function public.income_payments_guard() from public, anon, authenticated;
