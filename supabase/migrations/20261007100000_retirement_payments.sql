-- 퇴직금 지급 기록(retirement_payments) — 2026-10-07 ERP 3차 A (docs/20261007_PLAN_erp_gap_audit3.md)
--
-- 왜: 퇴사 정산 초안은 화면 계산뿐이라 남는 기록이 없었고, 원천세 신고 화면은 "퇴직소득 지급분은 직접 더하세요"라고 적었다.
--     지급한 퇴직금·원천징수 세액을 한 줄로 남겨 그 지급월 원천세 신고서의 A22(퇴직소득 그 외)·A20(가감계)에 자동으로 넣는다.
--
-- 규칙:
--   세액은 화면(lib/retirement-tax.ts)이 계산해 저장한다 — 신고서는 저장된 숫자를 그대로 쓴다(나중에 세법이 바뀌어도 낸 신고는 그대로).
--   irp_deferred = IRP 이전(과세이연) — 원천징수 0, 신고서 자동 반영에서 빠지고 "직접 신고" 로 따로 보인다.
--   읽기  = 같은 회사 AND (마스터 OR /employees:salary) · 본인 행은 본인도 (payroll_items 와 같은 모양)
--   쓰기  = 같은 회사 AND (회사 관리자 OR /employees:salary) — payroll_items_admin_write 와 같은 모양(관리자 역할 포함).
--           화면 버튼은 마스터|급여 권한만 보인다(급여 화면과 같은 기준).
--   직원이 다른 회사 사람이면 막는다 — 정책 안에 employees 서브쿼리를 두지 않고(재귀 사고 시그니처, rls-smoke 게이트)
--   SECURITY DEFINER 트리거에서 확인하고 이름을 스냅샷한다(직원이 지워져도 신고 기록은 남는다).
--
-- 기존 데이터: 새 표라 없음.
-- 버린 안: payroll_items 에 '퇴직' 줄로 넣기 — 급여 명세 발송·간이지급명세서·급여 대장이 전부 그 표를 읽어 퇴직금이
--          근로소득으로 섞인다. / employees 에 칸 추가 — 중간정산·재입사로 한 사람이 여러 번 받을 수 있다.

create table if not exists public.retirement_payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete set null,
  employee_name text not null default '',
  paid_on date not null,
  service_start date not null,
  service_end date not null,
  service_years int not null check (service_years >= 0),
  retirement_pay bigint not null check (retirement_pay >= 0),
  income_tax bigint not null default 0 check (income_tax >= 0),
  local_tax bigint not null default 0 check (local_tax >= 0),
  irp_deferred boolean not null default false,
  note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (service_end >= service_start),
  check (income_tax + local_tax <= retirement_pay)   -- 실지급액이 음수인 기록은 받지 않는다
);

create index if not exists retirement_payments_company_paid_idx on public.retirement_payments (company_id, paid_on desc);
create index if not exists retirement_payments_employee_idx on public.retirement_payments (employee_id);

alter table public.retirement_payments enable row level security;

create policy retirement_payments_select on public.retirement_payments
  for select to authenticated
  using (
    employee_id = (select public.current_employee_id())
    or (company_id = (select public.get_my_company_id())
        and ((select public.is_company_admin()) or (select public.has_perm('/employees:salary'))))
  );

create policy retirement_payments_write on public.retirement_payments
  for all to authenticated
  using (
    company_id = (select public.get_my_company_id())
    and ((select public.is_company_admin()) or (select public.has_perm('/employees:salary')))
  )
  with check (
    company_id = (select public.get_my_company_id())
    and ((select public.is_company_admin()) or (select public.has_perm('/employees:salary')))
  );

-- 세무대리인 쓰기 금지 — 정본 패턴(20260811200000) 그대로 RESTRICTIVE. 지금 정책으로도 막히지만 정책이 넓어질 때를 대비한 다층 방어
create policy advisor_ro_ins on public.retirement_payments as restrictive for insert to authenticated with check (not (select public.is_advisor_session()));
create policy advisor_ro_upd on public.retirement_payments as restrictive for update to authenticated using (not (select public.is_advisor_session()));
create policy advisor_ro_del on public.retirement_payments as restrictive for delete to authenticated using (not (select public.is_advisor_session()));

-- 직원 소속 확인 + 이름 스냅샷 + updated_at
--   ★ UPDATE 는 회사·작성자부터 고정한 뒤 직원을 확인한다(security-reviewer 2026-10-07: 순서가 반대면 company_id 를
--     남의 회사로 보내 그 회사 직원 이름을 스냅샷으로 읽을 수 있었다). 이름은 언제나 DB 에서 다시 채운다(클라이언트 값 무시).
create or replace function public.retirement_payments_guard()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_name text;
begin
  if tg_op = 'UPDATE' then
    new.company_id := old.company_id;   -- 회사는 못 옮긴다
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_at := now();
  end if;
  if new.employee_id is not null then
    select coalesce(e.name, '') into v_name from public.employees e where e.id = new.employee_id and e.company_id = new.company_id;
    if not found then raise exception '같은 회사 직원이 아닙니다' using errcode = '42501'; end if;
    new.employee_name := v_name;
  elsif tg_op = 'UPDATE' then
    new.employee_name := old.employee_name;   -- 직원이 지워진 기록은 스냅샷 이름을 지킨다
  end if;
  return new;
end $$;

drop trigger if exists trg_retirement_payments_guard on public.retirement_payments;
create trigger trg_retirement_payments_guard before insert or update on public.retirement_payments
  for each row execute function public.retirement_payments_guard();

revoke all on function public.retirement_payments_guard() from public, anon, authenticated;
