-- 프로젝트 v3: ＋보기로 켠 보기 구성(["kanban","calendar","gantt"] 같은 문자열 배열)을
-- 팀이 같이 보게 deal 에 저장(결정 131 — 지금까지는 임시로 localStorage). null = 표만.
-- RLS: deals 기존 정책(회사 격리) 그대로 적용 — 컬럼 추가라 새 정책 불필요.
alter table public.deals add column if not exists v3_views jsonb;
comment on column public.deals.v3_views is '프로젝트 v3 ＋보기 구성(문자열 배열) — 팀 공유. null = 표만 (2026-09-01 결정 131)';
