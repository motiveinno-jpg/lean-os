-- 승인된 휴가 취소 시 사유·취소자·시각 보존 (2026-08-11 사장님 요청)
-- prod 에는 MCP apply_migration 으로 2026-08-11 적용 완료 — 저장소 미러.
alter table public.leave_requests
  add column if not exists cancel_reason text,
  add column if not exists cancelled_by uuid,
  add column if not exists cancelled_at timestamptz;
