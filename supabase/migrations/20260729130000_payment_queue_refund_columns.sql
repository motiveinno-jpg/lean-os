-- 지급 환불 처리 컬럼 (2026-07-29 스키마 드리프트 전수 스윕 R2)
--   payments 화면의 환불 처리(submitRefund)가 refund_reason/refunded_at/refunded_by 를
--   update 하는데 컬럼이 없어 클릭 즉시 42703 → 환불 기능이 통째로 죽어 있었다.
--   status CHECK 는 없어 'refunded' 값 자체는 문제없음.
--   검증: PATCH(status,refund_reason,refunded_at) → 204.
--   ※ 이미 MCP 로 prod 적용됨 — 이 파일은 저장소 기록용.

alter table public.payment_queue
  add column if not exists refund_reason text,
  add column if not exists refunded_at  timestamptz,
  add column if not exists refunded_by  uuid references public.users(id);

comment on column public.payment_queue.refund_reason is '환불 사유 (payments 화면 환불 처리)';
