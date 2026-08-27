-- 연말정산 제출 상태 (2026-08-27 인사 6차 G6) — localStorage(브라우저마다 다름) → 회사 공용 표. 계산은 하지 않는다(홈택스 BLOCKED, 세무사 몫).
create table if not exists public.year_end_tax_status (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  year int not null,
  status text not null default 'pending' check (status in ('pending','submitted','reviewed')),
  note text,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  unique (company_id, employee_id, year)
);
alter table public.year_end_tax_status enable row level security;
drop policy if exists company_isolation on public.year_end_tax_status;
create policy company_isolation on public.year_end_tax_status for all using (company_id = (select public.get_my_company_id()));
drop policy if exists advisor_ro_ins on public.year_end_tax_status;
create policy advisor_ro_ins on public.year_end_tax_status for insert to authenticated with check (not (select public.is_advisor_session()));
drop policy if exists advisor_ro_upd on public.year_end_tax_status;
create policy advisor_ro_upd on public.year_end_tax_status for update to authenticated using (not (select public.is_advisor_session()));
drop policy if exists advisor_ro_del on public.year_end_tax_status;
create policy advisor_ro_del on public.year_end_tax_status for delete to authenticated using (not (select public.is_advisor_session()));
--   H8 온보딩 자동 생성(초대 수락 → 입사서류 체크리스트 + 입사 발령 행)은 데이터를 만드는 자동화 — 모티브 먼저.
insert into public.feature_rollout (feature, company_id) values ('onboarding_auto', 'c361afb9-8a52-4cac-add9-8992f0f7c09c') on conflict do nothing;
