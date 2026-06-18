-- AI 매칭 시도 표시 — 매칭 안 된 입금이 반복 호출마다 재처리되는 것 방지(끝까지 1회 처리).
alter table bank_transactions add column if not exists ai_attempted_at timestamptz;
create index if not exists idx_bank_tx_ai_unattempted
  on bank_transactions(company_id, settlement_status)
  where ai_attempted_at is null;
