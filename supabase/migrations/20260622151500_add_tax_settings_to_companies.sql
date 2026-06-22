-- QA F7: settings 세무자동화 탭 read/update 400
-- TaxAutomationTab reads/writes companies.tax_settings, but the column did not exist on prod
-- (companies already has automation_settings jsonb; mirror that pattern). Idempotent.
alter table public.companies
  add column if not exists tax_settings jsonb not null default '{}'::jsonb;
