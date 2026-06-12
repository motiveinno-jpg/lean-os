-- 말풍선 업데이트를 서브아이템(프로젝트 상세 행) 단위로도 — subitem_id 추가.
--   subitem_id NULL = 프로젝트(딜) 레벨 피드, NOT NULL = 해당 서브아이템 피드.
--   RLS 는 기존 회사격리 정책 그대로 적용. idempotent.

alter table public.board_item_updates
  add column if not exists subitem_id uuid references public.project_subitems(id) on delete cascade;

create index if not exists idx_board_item_updates_subitem
  on public.board_item_updates (subitem_id, created_at desc);
