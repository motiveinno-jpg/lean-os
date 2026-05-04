-- Migration: phase_j_chat_members
-- Version: 20260304060439
-- Source: production schema_migrations (auto-extracted 2026-05-04)


-- chat_members: DM 및 채널 멤버십 관리
CREATE TABLE IF NOT EXISTS public.chat_members (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  channel_id uuid NOT NULL REFERENCES public.chat_channels(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id),
  role text DEFAULT 'member',
  joined_at timestamptz DEFAULT now(),
  UNIQUE(channel_id, user_id)
);

ALTER TABLE public.chat_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "chat_members_company" ON public.chat_members
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.chat_channels cc
      WHERE cc.id = chat_members.channel_id
      AND cc.company_id = public.get_my_company_id()
    )
  );

CREATE INDEX idx_chat_members_channel ON public.chat_members(channel_id);
CREATE INDEX idx_chat_members_user ON public.chat_members(user_id);
