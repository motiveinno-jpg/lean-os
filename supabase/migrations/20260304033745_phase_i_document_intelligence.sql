-- Migration: phase_i_document_intelligence
-- Version: 20260304033745
-- Source: production schema_migrations (auto-extracted 2026-05-04)

-- Phase I: Document Intelligence
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS auto_classified_type text;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS extracted_fields jsonb;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS full_text text;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS file_url text;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS file_size bigint;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS mime_type text;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS partner_id uuid REFERENCES public.partners(id);
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS contract_start_date date;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS contract_end_date date;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS contract_amount numeric;

CREATE INDEX IF NOT EXISTS idx_documents_full_text ON public.documents USING gin(full_text gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_documents_partner_id ON public.documents(partner_id);
CREATE INDEX IF NOT EXISTS idx_documents_auto_classified ON public.documents(auto_classified_type);