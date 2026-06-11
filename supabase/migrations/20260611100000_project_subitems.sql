-- 2026-06-11 프로젝트 상세 = 먼데이 서브아이템 표.
--   deal(프로젝트) 1 → N project_subitems(하위 항목 행). 컬럼은 board_columns(회사 공용) 재사용
--   → 리스트/상세가 동일 컬럼을 공유. 첫 줄=컬럼 헤더(옆으로 추가), 아래=항목 행(밑으로 추가, 같은 컬럼 적용).
--   RLS = get_my_company_id() 헬퍼(재귀 없음, feedback_rls_recursion_gate 준수).
create table if not exists public.project_subitems (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  deal_id       uuid not null references public.deals(id) on delete cascade,
  name          text not null default '새 항목',
  column_values jsonb not null default '{}'::jsonb,
  position      int  not null default 0,
  created_at    timestamptz not null default now()
);
alter table public.project_subitems enable row level security;
drop policy if exists "Company can manage project_subitems" on public.project_subitems;
create policy "Company can manage project_subitems" on public.project_subitems
  for all using (company_id = (select get_my_company_id()))
  with check (company_id = (select get_my_company_id()));
create index if not exists idx_project_subitems_deal on public.project_subitems(deal_id, position);
