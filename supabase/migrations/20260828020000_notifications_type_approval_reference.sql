-- 알림 유형 'approval_reference' — 결재 참조 통보 (2026-08-28 24h 에러 조치).
--   2026-08-26 커밋 03fa5dac 에서 참조 알림 type 을 approval_request → approval_reference 로 분리했는데
--   이 CHECK 제약을 같은 커밋에서 넓히지 않았다("값 제약 동기화 규칙" 위반) →
--   2026-08-27 13:52 KST /approvals 상신 시 참조자 인앱 알림 insert 가 400 으로 불발
--   (인앱 유실 + 그 insert 트리거를 타는 웹푸시도 함께 불발. 결재 흐름 자체는 막지 않았다).
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type = any (array[
  'deal_update','expense_request','contract_expiry','signature_request','payment_due','system','document','approval','chat',
  'overtime_auto_clockout','project_checkin_due','overtime_request','overtime_approved','overtime_rejected','company_join_request',
  'approval_request','approval_approved','approval_rejected','approval_reference','billing','board_post','contract_renewal','hr_contract_package','leave_request',
  'inventory']::text[]));
