-- Migration: add_card_transactions_external_id_and_card_name
-- Version: 20260415111002
-- Source: production schema_migrations (auto-extracted 2026-05-04)


ALTER TABLE card_transactions ADD COLUMN IF NOT EXISTS external_id text;
ALTER TABLE card_transactions ADD COLUMN IF NOT EXISTS card_name text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_card_transactions_external_id 
  ON card_transactions(external_id) WHERE external_id IS NOT NULL;
