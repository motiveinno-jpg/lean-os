-- Migration: add_login_password_to_vault_accounts
-- Version: 20260309023031
-- Source: production schema_migrations (auto-extracted 2026-05-04)

ALTER TABLE vault_accounts ADD COLUMN IF NOT EXISTS login_password TEXT;