-- 게시판 댓글 사진/파일 첨부 (2026-07-01)
--   기존 board_comments 에 attachments jsonb 추가. 게시글 첨부와 동일 구조([{name,url,type,size}]).
--   신규 컬럼만 추가(기존 불변 → 회귀 0). RLS는 기존 board_comments 정책 그대로 적용.
alter table public.board_comments add column if not exists attachments jsonb not null default '[]'::jsonb;
