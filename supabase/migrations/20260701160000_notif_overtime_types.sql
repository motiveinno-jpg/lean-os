-- Allow overtime request/approval/rejection notification types (2026-07-01)
--   Root cause: notifications_type_check omitted 'overtime_request'/'overtime_approved'/'overtime_rejected'
--   -> client-side overtime notifications violated the CHECK and silently failed (0 delivered).
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type = any (array[
    'deal_update','expense_request','contract_expiry','signature_request','payment_due','system',
    'document','approval','chat','overtime_auto_clockout','project_checkin_due',
    'overtime_request','overtime_approved','overtime_rejected'
  ]));
