-- 반복 결제 추천(auto_discovery_results) 보강 (2026-09-07).
--   탐지가 빈 표(transactions, 0건)를 읽어 한 번도 결과가 없었다 — 이제 bank_transactions·card_transactions 를 읽는다.
--   어디서 나갔는지(source: bank/card)·며칠에 나가는지(day_of_month)·같은 후보를 다시 권하지 않게 하는 키(pattern_key)를 둔다.
alter table public.auto_discovery_results
  add column if not exists source text,
  add column if not exists day_of_month integer,
  add column if not exists pattern_key text;
create index if not exists idx_auto_discovery_company_key on public.auto_discovery_results (company_id, pattern_key);
