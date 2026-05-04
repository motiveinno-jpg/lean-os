-- Migration: add_stages_to_approval_policies
-- Version: 20260423061403
-- Source: production schema_migrations (auto-extracted 2026-05-04)

ALTER TABLE approval_policies ADD COLUMN IF NOT EXISTS stages jsonb;