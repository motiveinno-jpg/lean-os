-- Migration: add_deals_counterparty_column
-- Version: 20260415034351
-- Source: production schema_migrations (auto-extracted 2026-05-04)

ALTER TABLE deals ADD COLUMN IF NOT EXISTS counterparty TEXT;