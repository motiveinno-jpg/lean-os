-- Migration: create_audit_logs
-- Version: 20260303224006
-- Source: production schema_migrations (auto-extracted 2026-05-04)


-- 1) audit_logs: 범용 감사 로그
CREATE TABLE public.audit_logs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  user_id uuid REFERENCES public.users(id),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  action text NOT NULL,
  before_json jsonb,
  after_json jsonb,
  metadata jsonb,
  created_at timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_logs_company_access" ON public.audit_logs
  FOR ALL USING (company_id = public.get_my_company_id());

-- Indexes
CREATE INDEX idx_audit_logs_company ON public.audit_logs(company_id);
CREATE INDEX idx_audit_logs_entity ON public.audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_logs_created ON public.audit_logs(created_at DESC);
CREATE INDEX idx_audit_logs_action ON public.audit_logs(action);
