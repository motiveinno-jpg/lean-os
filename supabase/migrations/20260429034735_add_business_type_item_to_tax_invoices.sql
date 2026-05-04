-- Migration: add_business_type_item_to_tax_invoices
-- Version: 20260429034735
-- Source: production schema_migrations (auto-extracted 2026-05-04)

ALTER TABLE public.tax_invoices ADD COLUMN counterparty_business_type text;
ALTER TABLE public.tax_invoices ADD COLUMN counterparty_business_item text;
COMMENT ON COLUMN public.tax_invoices.counterparty_business_type IS '거래처 업태';
COMMENT ON COLUMN public.tax_invoices.counterparty_business_item IS '거래처 종목';
