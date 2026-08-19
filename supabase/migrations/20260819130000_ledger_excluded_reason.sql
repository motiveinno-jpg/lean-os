-- 2026-08-19 '장부 제외' 처리 (docs/20260819_PLAN_duplicate_voucher_handling.md)
--   전표를 만들 필요가 없는 거래(중복·계좌 간 이체·개인 지출 등)를 사유와 함께 끝낸 것으로 표시.
--   journal_entry_id 는 그대로 비어 있고(장부 불변) 목록 기본(미전표)에서만 빠진다. 되돌리기 = null.
alter table public.bank_transactions add column if not exists ledger_excluded_reason text;
alter table public.card_transactions add column if not exists ledger_excluded_reason text;
comment on column public.bank_transactions.ledger_excluded_reason is '장부 제외 사유(중복/이체/개인/기타 …) — 전표 없이 처리 끝. null 이면 미처리';
comment on column public.card_transactions.ledger_excluded_reason is '장부 제외 사유 — 전표 없이 처리 끝. null 이면 미처리';
create index if not exists idx_bank_tx_ledger_excluded on public.bank_transactions (company_id) where ledger_excluded_reason is not null;
create index if not exists idx_card_tx_ledger_excluded on public.card_transactions (company_id) where ledger_excluded_reason is not null;
