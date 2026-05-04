-- Migration: add_resignation_date_to_employees
-- Version: 20260423061213
-- Source: production schema_migrations (auto-extracted 2026-05-04)

ALTER TABLE employees ADD COLUMN IF NOT EXISTS resignation_date date;