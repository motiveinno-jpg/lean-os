-- 프로젝트 스크럼 스프린트 (2026-07-13)
--   deal(프로젝트)별 스프린트 — 이름/목표/상태/기간/완료포인트.
--   회사 격리 RLS는 project_issues·project_kpis 와 동일 패턴(get_my_company_id) 미러링. 새 헬퍼 함수 없음.
--   project_tasks 에 sprint_id / story_points 컬럼 추가(nullable, 기존 데이터 보존).

create table if not exists public.project_sprints (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  deal_id          uuid not null references public.deals(id) on delete cascade,
  name             text not null,
  goal             text,
  status           text not null default 'planned' check (status in ('planned','active','completed')),
  start_date       date,
  end_date         date,
  completed_points int,
  sort_order       int not null default 0,
  completed_at     timestamptz,
  created_by       uuid references public.users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_project_sprints_deal        on public.project_sprints (deal_id);
create index if not exists idx_project_sprints_deal_status on public.project_sprints (deal_id, status);

alter table public.project_sprints enable row level security;
drop policy if exists project_sprints_company on public.project_sprints;
create policy project_sprints_company on public.project_sprints
  for all using (company_id = public.get_my_company_id())
  with check (company_id = public.get_my_company_id());

-- project_tasks 컬럼 추가 (기존 RLS/정책은 그대로, 컬럼만 추가)
alter table public.project_tasks add column if not exists sprint_id    uuid references public.project_sprints(id) on delete set null;
alter table public.project_tasks add column if not exists story_points int;

create index if not exists idx_project_tasks_sprint on public.project_tasks (sprint_id);
