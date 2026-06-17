-- 카드 다대일 매칭 (2026-06-17 A2): 카드대금 1건(통장 출금) ↔ 카드내역 여러 건
--   card_transactions.bank_transaction_id (many 카드 → one 통장거래). 수동매칭 카드 탭 다중 선택용.
alter table public.card_transactions
  add column if not exists bank_transaction_id uuid references public.bank_transactions(id) on delete set null;
create index if not exists idx_card_transactions_bank_tx on public.card_transactions(bank_transaction_id) where bank_transaction_id is not null;
