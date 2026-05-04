-- Migration: phase_k_ai_integration
-- Version: 20260304033832
-- Source: production schema_migrations (auto-extracted 2026-05-04)

-- Phase K: AI Integration
CREATE TABLE IF NOT EXISTS public.ai_interactions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  user_id uuid REFERENCES public.users(id),
  query text NOT NULL,
  response text,
  tool_calls jsonb,
  tokens_used integer,
  model text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ai_pending_actions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  user_id uuid REFERENCES public.users(id),
  action_type text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  description text NOT NULL,
  payload jsonb NOT NULL,
  status text DEFAULT 'pending',
  approved_by uuid REFERENCES public.users(id),
  decided_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.ai_interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_pending_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_interactions_company" ON public.ai_interactions
  FOR ALL USING (company_id = get_my_company_id());
CREATE POLICY "ai_pending_actions_company" ON public.ai_pending_actions
  FOR ALL USING (company_id = get_my_company_id());

CREATE INDEX IF NOT EXISTS idx_ai_interactions_user ON public.ai_interactions(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_interactions_created ON public.ai_interactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_pending_actions_status ON public.ai_pending_actions(status) WHERE status = 'pending';