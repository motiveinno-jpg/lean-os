-- 2026-06-11 확정된 정산 매칭 조회 뷰 (확정 취소/되돌리기 UI용).
--   v_settlement_review_queue 와 동일 컬럼 구조, status='confirmed' 만. security_invoker=on(RLS 적용).
--   확정 취소 = invoice_settlements.status 를 'suggested' 로 되돌림 → trg_recalc_settlement 가 미수금 자동 원복.
create or replace view public.v_settlement_confirmed
with (security_invoker = on) as
select s.id, s.company_id, s.bank_transaction_id, s.tax_invoice_id, s.amount,
       s.match_type, s.match_source, s.status, s.confidence, s.reason, s.created_by, s.created_at, s.updated_at,
       b.transaction_date, b.amount as txn_amount, b.counterparty, b.type as txn_type,
       i.issue_date, i.total_amount as invoice_amount, i.counterparty_name, i.type as invoice_type
from invoice_settlements s
join bank_transactions b on b.id = s.bank_transaction_id
join tax_invoices i on i.id = s.tax_invoice_id
where s.status = 'confirmed';
