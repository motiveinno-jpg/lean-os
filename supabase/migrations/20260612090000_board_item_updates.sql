-- 먼데이식 아이템 업데이트(말풍선 히스토리) 피드 — 프로젝트 보드 행별 메모/대화.
--   RLS: 회사격리 (기존 SECURITY DEFINER 헬퍼 get_my_company_id 재사용 — 인라인 서브쿼리 금지 게이트 준수).
--   Realtime 구독 없음(publication 추가 불필요). idempotent.

create table if not exists public.board_item_updates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  deal_id uuid not null references public.deals(id) on delete cascade,
  author_user_id uuid,
  author_name text,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_board_item_updates_deal
  on public.board_item_updates (deal_id, created_at desc);
create index if not exists idx_board_item_updates_company
  on public.board_item_updates (company_id);

alter table public.board_item_updates enable row level security;

drop policy if exists board_item_updates_company on public.board_item_updates;
create policy board_item_updates_company on public.board_item_updates
  for all to authenticated
  using (company_id = public.get_my_company_id())
  with check (company_id = public.get_my_company_id());
