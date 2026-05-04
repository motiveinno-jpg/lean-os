-- Migration: add_tax_invoice_pipeline_columns
-- Version: 20260307063734
-- Source: production schema_migrations (auto-extracted 2026-05-04)


-- Add label and revenue_schedule_id to tax_invoices for pipeline linkage
ALTER TABLE tax_invoices ADD COLUMN IF NOT EXISTS label text;
ALTER TABLE tax_invoices ADD COLUMN IF NOT EXISTS revenue_schedule_id uuid REFERENCES deal_revenue_schedule(id);

-- Add label column to deal_revenue_schedule if not exists
ALTER TABLE deal_revenue_schedule ADD COLUMN IF NOT EXISTS label text;
