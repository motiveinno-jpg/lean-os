-- 스티커 메모 — 색·제목 (2026-08-27 사장님: "메모는 스티커 메모 형식, 목록 제공, 여러 개 클릭해서 열기")
alter table public.quick_notes add column if not exists color text not null default 'yellow';
alter table public.quick_notes add column if not exists title text;
