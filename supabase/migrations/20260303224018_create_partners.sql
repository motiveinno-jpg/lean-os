-- Migration: create_partners
-- Version: 20260303224018
-- Source: production schema_migrations (auto-extracted 2026-05-04)


-- 2) partners: 확장 CRM 테이블
CREATE TABLE public.partners (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  name text NOT NULL,
  type text DEFAULT 'vendor' CHECK (type IN ('vendor', 'client', 'partner', 'government', 'other')),
  classification text,
  business_number text,
  representative text,
  contact_name text,
  contact_email text,
  contact_phone text,
  address text,
  bank_name text,
  account_number text,
  tags text[] DEFAULT '{}',
  notes text,
  is_active boolean DEFAULT true,
  source_deal_id uuid REFERENCES public.deals(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE public.partners ENABLE ROW LEVEL SECURITY;

CREATE POLICY "partners_company_access" ON public.partners
  FOR ALL USING (company_id = public.get_my_company_id());

-- Indexes
CREATE INDEX idx_partners_company ON public.partners(company_id);
CREATE INDEX idx_partners_type ON public.partners(type);
CREATE INDEX idx_partners_active ON public.partners(is_active);
CREATE INDEX idx_partners_business_number ON public.partners(business_number);
