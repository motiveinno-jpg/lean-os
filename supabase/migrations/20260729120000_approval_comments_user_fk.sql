-- 결재 댓글 → 작성자 FK (2026-07-29)
--   approval_comments 에 user_id → users FK 가 없어 PostgREST 임베드
--   (users:user_id(name,…)) 가 400 으로 죽어 있었다 — 댓글 목록이 전 사용자에게
--   로드 실패(24h 에러 6건). 임베드는 FK 관계가 있어야 동작한다.
--   고아 검사 후 적용(댓글 0건). REST 재검증: 동일 쿼리 400 → 200.
--   ※ 이미 MCP 로 prod 적용됨 — 이 파일은 저장소 기록용.

alter table public.approval_comments
  drop constraint if exists approval_comments_user_id_fkey;
alter table public.approval_comments
  add constraint approval_comments_user_id_fkey
  foreign key (user_id) references public.users(id) on delete cascade;

create index if not exists approval_comments_user_idx on public.approval_comments(user_id);

notify pgrst, 'reload schema';
