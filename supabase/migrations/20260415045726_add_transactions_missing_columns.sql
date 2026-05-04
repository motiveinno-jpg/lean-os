-- Migration: add_transactions_missing_columns
-- Version: 20260415045726
-- Source: production schema_migrations (auto-extracted 2026-05-04)


-- Add missing columns for manual entry + CODEF sync
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS memo text;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS bank_name text;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS source text DEFAULT 'manual';
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS external_id text;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS balance_after numeric;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS mapping_status text DEFAULT 'unmapped';
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS updated_at timestamp without time zone DEFAULT now();

-- Unique constraint for external_id (CODEF upsert uses onConflict)
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_external_id ON transactions(external_id) WHERE external_id IS NOT NULL;

-- Index for source filtering
CREATE INDEX IF NOT EXISTS idx_transactions_source ON transactions(source);
CREATE INDEX IF NOT EXISTS idx_transactions_mapping_status ON transactions(mapping_status);
