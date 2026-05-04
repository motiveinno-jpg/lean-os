-- Migration: fix_invoices_nullable_and_defaults
-- Version: 20260320134941
-- Source: production schema_migrations (auto-extracted 2026-05-04)

-- Make invoice_number nullable so Stripe webhook inserts don't fail
ALTER TABLE public.invoices ALTER COLUMN invoice_number DROP NOT NULL;

-- Add currency column with default if it doesn't exist
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'invoices' AND column_name = 'currency') THEN
    ALTER TABLE public.invoices ADD COLUMN currency text DEFAULT 'krw';
  END IF;
END $$;