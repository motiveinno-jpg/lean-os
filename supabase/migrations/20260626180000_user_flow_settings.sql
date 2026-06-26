-- 경영흐름 콕핏 개인화 (2026-06-26)
--   대표가 기본 뷰/렌즈/기간 범위를 저장. 신규 테이블 0 — user_preferences 에 jsonb 컬럼만 추가.
--   RLS: user_preferences 기존 정책(본인 행) 그대로 적용.
alter table public.user_preferences
  add column if not exists flow_settings jsonb not null default '{}'::jsonb;
