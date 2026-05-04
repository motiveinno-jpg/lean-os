-- Migration: add_link_column_to_notifications
-- Version: 20260312064133
-- Source: production schema_migrations (auto-extracted 2026-05-04)

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS link text;