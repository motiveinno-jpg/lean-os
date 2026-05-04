-- Migration: add_automation_settings_to_companies
-- Version: 20260416073149
-- Source: production schema_migrations (auto-extracted 2026-05-04)

ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS automation_settings JSONB NOT NULL DEFAULT '{}'::jsonb;