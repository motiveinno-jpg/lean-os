-- Migration: chat_enhancement_mentions_reactions_action_cards
-- Version: 20260303150217
-- Source: production schema_migrations (auto-extracted 2026-05-04)


-- 1) 메시지 확장
ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS edited_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS reply_to_id uuid REFERENCES public.chat_messages(id);

-- 2) 채널 확장
ALTER TABLE public.chat_channels
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS allow_guests boolean DEFAULT false;

-- 3) 멘션 테이블
CREATE TABLE public.chat_mentions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES public.chat_channels(id),
  mentioned_user_id uuid NOT NULL REFERENCES public.users(id),
  read boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.chat_mentions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "participant_only" ON public.chat_mentions FOR ALL
  USING (channel_id IN (
    SELECT cp.channel_id FROM public.chat_participants cp
    JOIN public.users u ON cp.user_id = u.id WHERE u.auth_id = auth.uid()
  ));

-- 4) 리액션 테이블
CREATE TABLE public.chat_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id),
  emoji text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(message_id, user_id, emoji)
);
ALTER TABLE public.chat_reactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "participant_only" ON public.chat_reactions FOR ALL
  USING (user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid()));

-- 5) 액션카드 테이블
CREATE TABLE public.chat_action_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES public.chat_channels(id),
  card_type text NOT NULL,
  reference_id uuid NOT NULL,
  reference_table text NOT NULL,
  status text DEFAULT 'active',
  summary_json jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.chat_action_cards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "participant_only" ON public.chat_action_cards FOR ALL
  USING (channel_id IN (
    SELECT cp.channel_id FROM public.chat_participants cp
    JOIN public.users u ON cp.user_id = u.id WHERE u.auth_id = auth.uid()
  ));

-- 6) 인덱스
CREATE INDEX idx_mentions_user ON public.chat_mentions(mentioned_user_id, read);
CREATE INDEX idx_mentions_channel ON public.chat_mentions(channel_id);
CREATE INDEX idx_reactions_message ON public.chat_reactions(message_id);
CREATE INDEX idx_action_cards_channel ON public.chat_action_cards(channel_id);
