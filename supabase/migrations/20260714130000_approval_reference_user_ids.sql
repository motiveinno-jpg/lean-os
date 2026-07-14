-- 결재 "참조(CC)" 인원 (2026-07-14)
--   결재선(승인 단계)과 별개로 결과를 통보만 받는 인원(결재 권한 없음).
--   approval_forms(양식 빌더에서 미리 지정) -> approval_requests(요청 생성 시 복사).
--   uuid[] 컬럼, DEFAULT '{}'::uuid[], NOT NULL.
alter table public.approval_forms
  add column if not exists reference_user_ids uuid[] not null default '{}'::uuid[];

alter table public.approval_requests
  add column if not exists reference_user_ids uuid[] not null default '{}'::uuid[];
