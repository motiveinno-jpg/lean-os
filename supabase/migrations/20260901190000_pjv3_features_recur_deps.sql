-- 프로젝트 v3 1차 확장: ＋기능 토글 · 반복 작업 · 앞뒤 순서 (2026-09-01 오두 갭 1차)
-- RLS: deals / project_items 기존 정책(회사 격리) 그대로 적용 — 컬럼 추가라 새 정책 불필요.

-- ＋기능 토글(팀 공유): ["recur","deps"] 같은 문자열 배열. null = 전부 꺼짐
alter table public.deals add column if not exists v3_features jsonb;
comment on column public.deals.v3_features is '프로젝트 v3 ＋기능 토글(문자열 배열: recur·deps) — 팀 공유, null=꺼짐 (2026-09-01)';

-- 반복 작업: { freq: 'daily'|'weekly'|'monthly', weekday?: 0~6 }. 완료로 옮길 때 앱이 다음 줄을 만든다
alter table public.project_items add column if not exists recurrence jsonb;
comment on column public.project_items.recurrence is '반복 설정 {freq, weekday?} — 완료 시 앱이 다음 줄 생성(결정 131)';

-- 앞뒤 순서: 이 줄보다 먼저 끝나야 하는 항목
alter table public.project_items add column if not exists after_id uuid references public.project_items(id) on delete set null;
comment on column public.project_items.after_id is '앞 작업(이게 끝난 뒤) — 강제 아님, 완료 시 안내만(결정 131)';
