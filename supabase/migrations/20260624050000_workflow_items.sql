-- ============================================================
-- P0 — 워크플로우 분리: workflow_items 신설 + 보드 자산 재배선 백필
-- 대상: ownerview (njbvdkuvtdtkxyylwngn)
-- 적용: push·DB 권한 PC에서 실행 (이 PC에서는 미적용 — 핸드오프 전용)
-- 전제 검증 완료(2026-06-24):
--   · 보드 행 = deals,  보드 서브아이템 = project_subitems(별도 테이블),
--     활동피드 = board_item_updates(deal_id, subitem_id)
--   · deal_nodes 는 "재무 WBS 전용"(deal_cost_schedule 등) — 보드와 무관, 본 마이그레이션이 건드리지 않음
--   · RLS 표준 패턴: company_id = (select get_my_company_id())
-- 권장: 스테이징/백업 후 트랜잭션으로 적용 → 검증쿼리 통과 확인 → 운영 적용.
-- ============================================================

begin;

-- 1) 신설 테이블 ------------------------------------------------
create table if not exists public.workflow_items (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  title             text not null default '새 업무',
  linked_project_id uuid references public.deals(id) on delete set null,        -- 끌어온 프로젝트(없으면 독립 내부 업무)
  board_group_id    uuid references public.board_groups(id) on delete set null,
  column_values     jsonb not null default '{}'::jsonb,
  assignee_id       uuid references public.users(id) on delete set null,
  status            text,
  position          integer not null default 0,
  archived_at       timestamptz,
  created_by        uuid references public.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- 2) RLS (board_columns/board_groups/project_subitems 와 동일 패턴) -----
alter table public.workflow_items enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='workflow_items' and policyname='Company can manage workflow_items') then
    create policy "Company can manage workflow_items" on public.workflow_items
      for all
      using (company_id = (select get_my_company_id()))
      with check (company_id = (select get_my_company_id()));
  end if;
end $$;

-- 3) 인덱스 ----------------------------------------------------
create index if not exists idx_workflow_items_company_group_pos on public.workflow_items (company_id, board_group_id, position);
create index if not exists idx_workflow_items_linked_project   on public.workflow_items (linked_project_id);
create index if not exists idx_workflow_items_parent           on public.workflow_items (id);

-- 4) 서브아이템·활동피드에 workflow_item_id 추가 (기존 deal_id 는 레거시로 유지) ----
alter table public.project_subitems   add column if not exists workflow_item_id uuid references public.workflow_items(id) on delete cascade;
alter table public.board_item_updates add column if not exists workflow_item_id uuid references public.workflow_items(id) on delete cascade;
create index if not exists idx_project_subitems_wi   on public.project_subitems (workflow_item_id);
create index if not exists idx_board_item_updates_wi on public.board_item_updates (workflow_item_id);

-- 5) 백필: 현재 보드 행(= 각 deal) → workflow_items 1행 (현재 보드 모습 그대로 보존) ----
--    linked_project_id = deal.id 로 1:1 매핑 → 이후 서브아이템/피드 매핑 키로 사용.
--    archived 포함 전 deal 이전(서브아이템/피드 고아 방지). 재실행 안전(이미 매핑된 deal 제외).
insert into public.workflow_items
  (company_id, title, linked_project_id, board_group_id, column_values, position, archived_at, created_at)
select
  d.company_id,
  d.name,
  d.id,
  d.board_group_id,
  coalesce(d.column_values, '{}'::jsonb),
  (row_number() over (partition by d.company_id, d.board_group_id order by d.created_at) - 1)::int,
  d.archived_at,
  d.created_at
from public.deals d
where not exists (
  select 1 from public.workflow_items w where w.linked_project_id = d.id
);

-- 6) 서브아이템 재배선 (deal_id → 매핑된 workflow_item) ----
update public.project_subitems s
set workflow_item_id = w.id
from public.workflow_items w
where w.linked_project_id = s.deal_id
  and s.workflow_item_id is null;

-- 7) 활동피드 재배선 ----
update public.board_item_updates u
set workflow_item_id = w.id
from public.workflow_items w
where w.linked_project_id = u.deal_id
  and u.workflow_item_id is null;

commit;

-- ============================================================
-- 검증 (커밋 후 별도 실행 — 0/일치 여야 정상)
-- ============================================================
-- 활성 deal 수 == 활성 workflow_item 수
--   select (select count(*) from public.deals where archived_at is null)        as deals_active,
--          (select count(*) from public.workflow_items where archived_at is null) as wi_active;
-- 매핑 누락 서브아이템 0
--   select count(*) as orphan_subitems from public.project_subitems where workflow_item_id is null;
-- 매핑 누락 피드 0 (deal_id 있는데 wi 미매핑)
--   select count(*) as orphan_updates from public.board_item_updates where workflow_item_id is null and deal_id is not null;

-- ============================================================
-- 롤백 (P1 코드 배포 전이라면 안전)
-- ============================================================
-- begin;
--   alter table public.project_subitems   drop column if exists workflow_item_id;
--   alter table public.board_item_updates drop column if exists workflow_item_id;
--   drop table if exists public.workflow_items cascade;
-- commit;
