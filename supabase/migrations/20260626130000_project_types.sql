-- 프로젝트 3종 유형 업그레이드 P0 (2026-06-26)
--   margin(수익형)/goal(목표형)/delivery(실행형). 기존 27행은 default 'margin' 자동 백필.
--   신규: project_tasks(실행형 칸반/간트), project_kpi_entries(목표형 수동실적), v_deal_goal_actual(목표형 매출 자동실적).
--   함수/뷰 본문 ASCII. 신규 테이블 RLS 필수.

-- 1) deals 유형 컬럼 (저위험 — default 백필)
alter table public.deals
  add column if not exists project_type text not null default 'margin'
    check (project_type in ('margin','goal','delivery')),
  add column if not exists target_amount numeric,
  add column if not exists target_label  text default '매출',
  add column if not exists target_unit   text default '원',
  add column if not exists goal_source   text;
create index if not exists idx_deals_company_type on public.deals (company_id, project_type) where archived_at is null;

-- 2) project_tasks (실행형 칸반+간트)
create table if not exists public.project_tasks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  deal_id uuid not null references public.deals(id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'todo' check (status in ('todo','doing','review','done')),
  assignee_id uuid references public.users(id) on delete set null,
  start_date date,
  due_date date,
  progress int not null default 0,
  position int not null default 0,
  parent_task_id uuid references public.project_tasks(id) on delete set null,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create index if not exists idx_project_tasks_deal on public.project_tasks (deal_id, status, position);
create index if not exists idx_project_tasks_company on public.project_tasks (company_id);
create index if not exists idx_project_tasks_assignee on public.project_tasks (assignee_id);
create index if not exists idx_project_tasks_due on public.project_tasks (deal_id, due_date);
alter table public.project_tasks enable row level security;
drop policy if exists project_tasks_company on public.project_tasks;
create policy project_tasks_company on public.project_tasks
  for all using (company_id = public.get_my_company_id())
  with check (company_id = public.get_my_company_id());

-- 3) project_kpi_entries (목표형 비매출 수동 실적)
create table if not exists public.project_kpi_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  deal_id uuid not null references public.deals(id) on delete cascade,
  entry_date date not null,
  value numeric not null,
  memo text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_project_kpi_deal on public.project_kpi_entries (deal_id, entry_date);
create index if not exists idx_project_kpi_company on public.project_kpi_entries (company_id);
alter table public.project_kpi_entries enable row level security;
drop policy if exists project_kpi_company on public.project_kpi_entries;
create policy project_kpi_company on public.project_kpi_entries
  for all using (company_id = public.get_my_company_id())
  with check (company_id = public.get_my_company_id());

-- 4) 목표형 매출 자동 실적 뷰 — 단일 출처(tax_invoices sales, void 제외)로 이중계상 방지
create or replace view public.v_deal_goal_actual as
  select d.id as deal_id,
         coalesce(sum(ti.supply_amount), 0) as actual_amount
  from public.deals d
  left join public.tax_invoices ti
    on ti.deal_id = d.id and ti.type = 'sales' and coalesce(ti.status,'') <> 'void'
  group by d.id;
