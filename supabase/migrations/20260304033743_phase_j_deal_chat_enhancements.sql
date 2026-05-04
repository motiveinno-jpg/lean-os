-- Migration: phase_j_deal_chat_enhancements
-- Version: 20260304033743
-- Source: production schema_migrations (auto-extracted 2026-05-04)

-- Phase J: Deal + Chat Enhancements
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS last_activity_at timestamptz DEFAULT now();
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS is_dormant boolean DEFAULT false;

ALTER TABLE public.chat_channels ADD COLUMN IF NOT EXISTS project_id uuid;
ALTER TABLE public.chat_channels ADD COLUMN IF NOT EXISTS is_dm boolean DEFAULT false;
ALTER TABLE public.chat_channels ADD COLUMN IF NOT EXISTS partner_id uuid;

-- Partner invitations
CREATE TABLE IF NOT EXISTS public.partner_invitations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  deal_id uuid REFERENCES public.deals(id),
  email text NOT NULL,
  name text,
  invite_token text NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  status text DEFAULT 'pending',
  expires_at timestamptz DEFAULT (now() + interval '7 days'),
  created_at timestamptz DEFAULT now(),
  accepted_at timestamptz
);

ALTER TABLE public.partner_invitations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "partner_invitations_company" ON public.partner_invitations
  FOR ALL USING (company_id = get_my_company_id());

CREATE INDEX IF NOT EXISTS idx_partner_invitations_token ON public.partner_invitations(invite_token);
CREATE INDEX IF NOT EXISTS idx_partner_invitations_email ON public.partner_invitations(email);
CREATE INDEX IF NOT EXISTS idx_deals_dormant ON public.deals(is_dormant) WHERE is_dormant = true;
CREATE INDEX IF NOT EXISTS idx_deals_last_activity ON public.deals(last_activity_at);

-- RPC function to mark dormant deals (30 days no activity)
CREATE OR REPLACE FUNCTION public.mark_dormant_deals()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  cnt integer;
BEGIN
  UPDATE public.deals
  SET is_dormant = true, updated_at = now()
  WHERE is_dormant = false
    AND last_activity_at < now() - interval '30 days'
    AND status NOT IN ('closed', 'cancelled');
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RETURN cnt;
END;
$$;