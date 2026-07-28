-- Migration: notifications_type_check_widen (2026-07-28)
-- 결함류(구독해지 billing_events 와 동일): CHECK 가 코드 emit 값보다 좁아 INSERT 가
--   조용히 실패 — 알림 코드가 전부 try/catch 로 감싸져 있어 아무도 눈치채지 못함.
--   prod 로그에 notifications_type_check 위반 다발, 어제 "결재 알림 안 옴" 제보의 뿌리.
--
-- 코드 전수 대조(src + supabase/functions + 마이그레이션 RPC)로 확인된 누락 8종 추가:
--   approval_request / approval_approved / approval_rejected  (결재 요청·승인·반려 — 전부 무음 실패 중이었음)
--   billing / board_post / contract_renewal / hr_contract_package / leave_request
-- 기존 허용값은 그대로 유지 (넓히기만 — 좁히지 않음).

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type = any (array[
  'deal_update'::text, 'expense_request'::text, 'contract_expiry'::text, 'signature_request'::text,
  'payment_due'::text, 'system'::text, 'document'::text, 'approval'::text, 'chat'::text,
  'overtime_auto_clockout'::text, 'project_checkin_due'::text, 'overtime_request'::text,
  'overtime_approved'::text, 'overtime_rejected'::text, 'company_join_request'::text,
  -- 2026-07-28 추가 — 코드가 emit 하지만 막혀 있던 타입
  'approval_request'::text, 'approval_approved'::text, 'approval_rejected'::text,
  'billing'::text, 'board_post'::text, 'contract_renewal'::text,
  'hr_contract_package'::text, 'leave_request'::text
]));
