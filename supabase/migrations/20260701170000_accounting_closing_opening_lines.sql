-- Upgrade accounting_closing to per-account/per-party opening balances (2026-07-01)
--   Replaces simple opening_bank_balance/opening_cumulative_net with opening_lines jsonb grid.
--   Existing rows keep closing_date/note; opening_lines defaults to []. (feature is new -> no real data loss)
alter table public.accounting_closing add column if not exists opening_lines jsonb not null default '[]'::jsonb;
alter table public.accounting_closing drop column if exists opening_bank_balance;
alter table public.accounting_closing drop column if exists opening_cumulative_net;
