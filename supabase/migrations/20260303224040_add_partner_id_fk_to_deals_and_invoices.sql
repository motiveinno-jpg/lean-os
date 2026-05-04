-- Migration: add_partner_id_fk_to_deals_and_invoices
-- Version: 20260303224040
-- Source: production schema_migrations (auto-extracted 2026-05-04)


-- 4) ALTER: deals, tax_invoices, sub_deals에 partner_id FK 추가
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS partner_id uuid REFERENCES public.partners(id);
ALTER TABLE public.tax_invoices ADD COLUMN IF NOT EXISTS partner_id uuid REFERENCES public.partners(id);
ALTER TABLE public.sub_deals ADD COLUMN IF NOT EXISTS partner_id uuid REFERENCES public.partners(id);

-- Indexes for FK
CREATE INDEX idx_deals_partner ON public.deals(partner_id);
CREATE INDEX idx_tax_invoices_partner ON public.tax_invoices(partner_id);
CREATE INDEX idx_sub_deals_partner ON public.sub_deals(partner_id);
