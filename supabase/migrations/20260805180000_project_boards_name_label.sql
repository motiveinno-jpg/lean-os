-- 표의 첫 칸(행 이름) 이름표 — 사용자가 '이름' 대신 '상호명'·'현장명' 처럼 바꿔 쓸 수 있게 (2026-08-05 사장님 지시).
--   비어 있으면 지금처럼 템플릿별 기본 라벨(ITEM_LABEL)을 쓴다. RLS 는 테이블 정책을 그대로 따른다.
alter table public.project_boards add column if not exists name_label text;
comment on column public.project_boards.name_label is '첫 칸(행 이름) 머리글. NULL 이면 템플릿 기본 라벨 사용.';
