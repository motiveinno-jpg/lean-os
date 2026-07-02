-- 실행형 태스크 라벨 (색상+텍스트 자유 태그) — 2026-07-02
--   project_tasks.labels jsonb = [{ text, color }]
alter table public.project_tasks
  add column if not exists labels jsonb not null default '[]'::jsonb;
