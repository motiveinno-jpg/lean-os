-- Migration: create_partner_communications
-- Version: 20260414104222
-- Source: production schema_migrations (auto-extracted 2026-05-04)


CREATE TABLE public.partner_communications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  partner_id UUID NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  comm_type TEXT NOT NULL CHECK (comm_type IN ('phone', 'email', 'meeting', 'other')),
  summary TEXT NOT NULL,
  notes TEXT,
  comm_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_partner_communications_partner_id ON public.partner_communications(partner_id);
CREATE INDEX idx_partner_communications_company_id ON public.partner_communications(company_id);
CREATE INDEX idx_partner_communications_comm_date ON public.partner_communications(comm_date DESC);

ALTER TABLE public.partner_communications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their company communications"
  ON public.partner_communications FOR SELECT
  USING (company_id IN (SELECT company_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "Users can insert their company communications"
  ON public.partner_communications FOR INSERT
  WITH CHECK (company_id IN (SELECT company_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "Users can update their company communications"
  ON public.partner_communications FOR UPDATE
  USING (company_id IN (SELECT company_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "Users can delete their company communications"
  ON public.partner_communications FOR DELETE
  USING (company_id IN (SELECT company_id FROM public.users WHERE id = auth.uid()));
