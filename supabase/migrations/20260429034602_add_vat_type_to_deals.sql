-- Migration: add_vat_type_to_deals
-- Version: 20260429034602
-- Source: production schema_migrations (auto-extracted 2026-05-04)

ALTER TABLE public.deals ADD COLUMN vat_type text NOT NULL DEFAULT 'inclusive';
COMMENT ON COLUMN public.deals.vat_type IS 'VAT 유형: inclusive(포함), exclusive(별도), zero(영세율)';
