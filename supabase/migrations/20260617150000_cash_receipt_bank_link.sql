-- 통장거래 ↔ 현금영수증 연결(마킹) 지원 (2026-06-17 수동매칭 확장 Phase A)
--   세금계산서=invoice_settlements, 카드=bank_transactions.card_transaction_id(기존),
--   현금영수증=신설 cash_receipts.bank_transaction_id. 연결 시 통장거래 settlement_status='settled' 마킹.
alter table public.cash_receipts
  add column if not exists bank_transaction_id uuid references public.bank_transactions(id) on delete set null;
create index if not exists idx_cash_receipts_bank_tx on public.cash_receipts(bank_transaction_id) where bank_transaction_id is not null;
