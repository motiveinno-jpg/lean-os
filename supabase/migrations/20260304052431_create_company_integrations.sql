-- Migration: create_company_integrations
-- Version: 20260304052431
-- Source: production schema_migrations (auto-extracted 2026-05-04)


-- 외부 서비스 연동 정보 저장
CREATE TABLE public.company_integrations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  service_type text NOT NULL,  -- 'hometax', 'bank_scraping', 'card_scraping', 'nts_cert'
  service_name text,
  login_id text,
  login_pw_encrypted text,
  cert_dn text,
  status text DEFAULT 'pending',  -- pending, connected, syncing, error, disconnected
  last_synced_at timestamptz,
  sync_error text,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE public.company_integrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company_integrations_policy" ON public.company_integrations
  USING (company_id = public.get_my_company_id());

-- Indexes
CREATE INDEX idx_company_integrations_company ON public.company_integrations(company_id);
CREATE INDEX idx_company_integrations_service ON public.company_integrations(service_type);
