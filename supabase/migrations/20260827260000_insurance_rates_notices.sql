-- 4대보험 요율표 + 고지서 대조 (2026-08-27 인사 2차 G3·H2, 결정 96)
--   결정 96 — 요율은 회사설정 연도별 표. 행이 없으면 화면·계산이 법정 기본값(lib/insurance-rates.ts)을 쓴다. 코드 상수로 계산하지 않는다.
--   요율은 소수(0.045 = 4.5%). 직원/회사 몫을 따로 둔다 — 고용보험은 회사 몫이 더 크다(고용안정·직능 포함).
create table if not exists public.company_insurance_rates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  year int not null,
  np_emp numeric(8,6) not null, np_er numeric(8,6) not null,
  hi_emp numeric(8,6) not null, hi_er numeric(8,6) not null,
  ltc_pct numeric(8,6) not null,            -- 장기요양 = 건강보험료 × ltc_pct
  ei_emp numeric(8,6) not null, ei_er numeric(8,6) not null,
  ia_rate numeric(8,6) not null,            -- 산재 = 회사만, 업종별
  np_floor numeric not null, np_ceiling numeric not null,
  hi_floor numeric not null, hi_ceiling numeric not null,
  note text,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  unique (company_id, year)
);
alter table public.company_insurance_rates enable row level security;
drop policy if exists company_isolation on public.company_insurance_rates;
create policy company_isolation on public.company_insurance_rates for all using (company_id = (select public.get_my_company_id()));
drop policy if exists advisor_ro_ins on public.company_insurance_rates;
create policy advisor_ro_ins on public.company_insurance_rates for insert to authenticated with check (not (select public.is_advisor_session()));
drop policy if exists advisor_ro_upd on public.company_insurance_rates;
create policy advisor_ro_upd on public.company_insurance_rates for update to authenticated using (not (select public.is_advisor_session()));
drop policy if exists advisor_ro_del on public.company_insurance_rates;
create policy advisor_ro_del on public.company_insurance_rates for delete to authenticated using (not (select public.is_advisor_session()));

--   고지서 대조 (H2) — 공단 고지 합계(직원+회사)를 달마다 적어 두면 급여 계산 합계와의 차이를 보여 준다. 출처: 장부 대조.
create table if not exists public.insurance_notices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  month text not null,                      -- 'YYYY-MM'
  np numeric not null default 0, hi numeric not null default 0, ei numeric not null default 0, ia numeric not null default 0,
  note text,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  unique (company_id, month)
);
alter table public.insurance_notices enable row level security;
drop policy if exists company_isolation on public.insurance_notices;
create policy company_isolation on public.insurance_notices for all using (company_id = (select public.get_my_company_id()));
drop policy if exists advisor_ro_ins on public.insurance_notices;
create policy advisor_ro_ins on public.insurance_notices for insert to authenticated with check (not (select public.is_advisor_session()));
drop policy if exists advisor_ro_upd on public.insurance_notices;
create policy advisor_ro_upd on public.insurance_notices for update to authenticated using (not (select public.is_advisor_session()));
drop policy if exists advisor_ro_del on public.insurance_notices;
create policy advisor_ro_del on public.insurance_notices for delete to authenticated using (not (select public.is_advisor_session()));
