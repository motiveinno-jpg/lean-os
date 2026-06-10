-- 2026-06-10 프로젝트 → Monday.com 스타일 커스텀 보드 (Phase 1: 스키마)
--   행 = deals(기존, 재무 연동 보존), + 그룹(board_groups) + 커스텀 컬럼(board_columns) + 셀값(deals.column_values).
--   회사당 단일 보드(다중 그룹). RLS = get_my_company_id() 헬퍼(재귀 없음, feedback_rls_recursion_gate 준수).

-- 그룹 (예: "소상공인 LIST")
create table if not exists public.board_groups (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  name        text not null default '새 그룹',
  color       text not null default '#6366F1',
  position    int  not null default 0,
  created_at  timestamptz not null default now()
);
alter table public.board_groups enable row level security;
drop policy if exists "Company can manage board_groups" on public.board_groups;
create policy "Company can manage board_groups" on public.board_groups
  for all using (company_id = (select get_my_company_id()))
  with check (company_id = (select get_my_company_id()));
create index if not exists idx_board_groups_company on public.board_groups(company_id, position);

-- 커스텀 컬럼 정의. type: text|status|date|person|number|priority|link
--   settings(jsonb): status/priority → {"options":[{"id","label","color"}]}
create table if not exists public.board_columns (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  name        text not null default '새 컬럼',
  type        text not null default 'text',
  settings    jsonb not null default '{}'::jsonb,
  position    int  not null default 0,
  created_at  timestamptz not null default now()
);
alter table public.board_columns enable row level security;
drop policy if exists "Company can manage board_columns" on public.board_columns;
create policy "Company can manage board_columns" on public.board_columns
  for all using (company_id = (select get_my_company_id()))
  with check (company_id = (select get_my_company_id()));
create index if not exists idx_board_columns_company on public.board_columns(company_id, position);

-- deals 확장: 그룹 소속 + 커스텀 셀값(컬럼id → 값)
alter table public.deals add column if not exists board_group_id uuid references public.board_groups(id) on delete set null;
alter table public.deals add column if not exists column_values jsonb not null default '{}'::jsonb;
