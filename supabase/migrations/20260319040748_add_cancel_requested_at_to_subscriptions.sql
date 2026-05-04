-- Migration: add_cancel_requested_at_to_subscriptions
-- Version: 20260319040748
-- Source: production schema_migrations (auto-extracted 2026-05-04)


ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS cancel_requested_at TIMESTAMPTZ;
