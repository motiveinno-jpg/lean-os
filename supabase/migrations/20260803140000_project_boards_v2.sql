-- 프로젝트 표(보드) — 새 프로젝트 구조 1단계 (2026-08-03 기획 v2, 사장님 승인).
--   프로젝트 1 : N 표(템플릿에서 생성) : N 그룹 : N 행. 값은 jsonb 한 칸(컬럼ID → 값).
--   회사 전역 보드(board_*)와 별개다 — 그쪽은 '행 = 프로젝트' 구조라 여기서 쓸 수 없다.
--   프로덕션 Management API 선적용, 재현용 기록.
create table if not exists public.project_boards (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  deal_id uuid not null references public.deals(id) on delete cascade,
  name text not null,
  template_key text,
  position int not null default 0,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);
create table if not exists public.project_board_columns (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.project_boards(id) on delete cascade,
  name text not null, type text not null default 'text',
  settings jsonb not null default '{}'::jsonb,
  position int not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists public.project_board_groups (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.project_boards(id) on delete cascade,
  name text not null, color text not null default '#5559DF',
  position int not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists public.project_board_items (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.project_boards(id) on delete cascade,
  group_id uuid references public.project_board_groups(id) on delete cascade,
  parent_item_id uuid references public.project_board_items(id) on delete cascade,
  name text not null default '',
  values jsonb not null default '{}'::jsonb,
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists project_boards_deal_idx on public.project_boards (deal_id, position);
create index if not exists pb_columns_board_idx on public.project_board_columns (board_id, position);
create index if not exists pb_groups_board_idx on public.project_board_groups (board_id, position);
create index if not exists pb_items_board_idx on public.project_board_items (board_id, group_id, position);

alter table public.project_boards enable row level security;
alter table public.project_board_columns enable row level security;
alter table public.project_board_groups enable row level security;
alter table public.project_board_items enable row level security;

-- 회사 멤버는 자기 회사 표를 모두 다룬다(입력이 기본 활동이라 읽기·쓰기 모두 허용).
drop policy if exists project_boards_company_all on public.project_boards;
create policy project_boards_company_all on public.project_boards
  for all using (company_id = (select public.get_my_company_id()))
  with check (company_id = (select public.get_my_company_id()));
drop policy if exists pb_columns_company_all on public.project_board_columns;
create policy pb_columns_company_all on public.project_board_columns
  for all using (exists (select 1 from public.project_boards b where b.id = board_id and b.company_id = (select public.get_my_company_id())))
  with check (exists (select 1 from public.project_boards b where b.id = board_id and b.company_id = (select public.get_my_company_id())));
drop policy if exists pb_groups_company_all on public.project_board_groups;
create policy pb_groups_company_all on public.project_board_groups
  for all using (exists (select 1 from public.project_boards b where b.id = board_id and b.company_id = (select public.get_my_company_id())))
  with check (exists (select 1 from public.project_boards b where b.id = board_id and b.company_id = (select public.get_my_company_id())));
drop policy if exists pb_items_company_all on public.project_board_items;
create policy pb_items_company_all on public.project_board_items
  for all using (exists (select 1 from public.project_boards b where b.id = board_id and b.company_id = (select public.get_my_company_id())))
  with check (exists (select 1 from public.project_boards b where b.id = board_id and b.company_id = (select public.get_my_company_id())));
