-- Migration: add_billing_day_to_vault_accounts
-- Version: 20260309023426
-- Source: production schema_migrations (auto-extracted 2026-05-04)

ALTER TABLE vault_accounts ADD COLUMN IF NOT EXISTS billing_day INT;
COMMENT ON COLUMN vault_accounts.billing_day IS '자동결제일 (매월 N일)';