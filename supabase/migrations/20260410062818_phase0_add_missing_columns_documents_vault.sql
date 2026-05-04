-- Migration: phase0_add_missing_columns_documents_vault
-- Version: 20260410062818
-- Source: production schema_migrations (auto-extracted 2026-05-04)

-- documents: add updated_at timestamp (referenced in approval-center.ts)
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- auto-update trigger
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_documents_touch_updated_at ON documents;
CREATE TRIGGER trg_documents_touch_updated_at
BEFORE UPDATE ON documents
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- vault_accounts: add encrypted_password for server-side encryption (queries.ts:1079)
ALTER TABLE vault_accounts
  ADD COLUMN IF NOT EXISTS encrypted_password text;