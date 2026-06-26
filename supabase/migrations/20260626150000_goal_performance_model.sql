-- 목표형 = 성과관리 모델 업그레이드 (2026-06-26)
--   다중 KPI(project_kpis) + 수동실적(project_kpi_entries.kpi_id) + 성과 체크인(project_updates) + 매출자동 뷰.
--   기존 단일목표(deals.target_amount 등)는 미사용으로 남김(무해). 신규 테이블 RLS 필수.

-- 1) 다중 KPI 정의 (프로젝트당 N개)
create table if not exists public.project_kpis (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  deal_id uuid not null references public.deals(id) on delete cascade,
  label text not null,
  unit text default '원',
  target_value numeric not null,
  direction text not null default 'up' check (direction in ('up','down')),
  source text not null default 'manual' check (source in ('manual','revenue_auto')),
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_project_kpis_deal on public.project_kpis (deal_id, sort_order);
create index if not exists idx_project_kpis_company on public.project_kpis (company_id);
alter table public.project_kpis enable row level security;
drop policy if exists project_kpis_company on public.project_kpis;
create policy project_kpis_company on public.project_kpis
  for all using (company_id = public.get_my_company_id())
  with check (company_id = public.get_my_company_id());

-- 2) 수동 KPI 실적 — kpi_id 기준으로 일반화 (기존 deal_id 컬럼은 nullable 유지)
alter table public.project_kpi_entries add column if not exists kpi_id uuid references public.project_kpis(id) on delete cascade;
alter table public.project_kpi_entries alter column deal_id drop not null;
create index if not exists idx_project_kpi_entries_kpi on public.project_kpi_entries (kpi_id, entry_date);

-- 3) 성과 체크인 (정성 — 신호등 + 코멘트 + KPI 스냅샷)
create table if not exists public.project_updates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  deal_id uuid not null references public.deals(id) on delete cascade,
  update_date date not null,
  status text not null default 'green' check (status in ('green','yellow','red')),
  body text,
  kpi_snapshot jsonb,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_project_updates_deal on public.project_updates (deal_id, update_date desc);
create index if not exists idx_project_updates_company on public.project_updates (company_id);
alter table public.project_updates enable row level security;
drop policy if exists project_updates_company on public.project_updates;
create policy project_updates_company on public.project_updates
  for all using (company_id = public.get_my_company_id())
  with check (company_id = public.get_my_company_id());

-- 4) 매출 자동 실적 뷰 (revenue_auto KPI용) — tax_invoices sales(void 제외) supply_amount 합
create or replace view public.v_deal_revenue_actual as
  select d.id as deal_id, coalesce(sum(ti.supply_amount),0) as actual_amount
  from public.deals d
  left join public.tax_invoices ti on ti.deal_id = d.id and ti.type='sales' and coalesce(ti.status,'')<>'void'
  group by d.id;
