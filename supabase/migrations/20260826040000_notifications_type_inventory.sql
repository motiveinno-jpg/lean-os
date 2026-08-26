-- 알림 유형 'inventory' — 재고·주문 점검 (2026-08-26 사장님 지시 "알림")
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type = any (array[
  'deal_update','expense_request','contract_expiry','signature_request','payment_due','system','document','approval','chat',
  'overtime_auto_clockout','project_checkin_due','overtime_request','overtime_approved','overtime_rejected','company_join_request',
  'approval_request','approval_approved','approval_rejected','billing','board_post','contract_renewal','hr_contract_package','leave_request',
  'inventory']::text[]));
