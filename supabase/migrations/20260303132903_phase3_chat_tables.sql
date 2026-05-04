-- Migration: phase3_chat_tables
-- Version: 20260303132903
-- Source: production schema_migrations (auto-extracted 2026-05-04)


-- ═══════════════════════════════════════════════
-- Phase 3: 딜룸 채팅 (5 신규 테이블)
-- ═══════════════════════════════════════════════

-- chat_channels: 딜 생성 시 자동 생성
CREATE TABLE chat_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  deal_id UUID REFERENCES deals(id),
  sub_deal_id UUID REFERENCES sub_deals(id),
  type TEXT DEFAULT 'deal',
  name TEXT NOT NULL,
  is_archived BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- chat_participants: Role 기반 권한
CREATE TABLE chat_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  role TEXT DEFAULT 'member',
  invite_token TEXT,
  last_read_at TIMESTAMPTZ,
  invited_at TIMESTAMPTZ DEFAULT now()
);

-- chat_messages: 텍스트/시스템/파일/스레드
CREATE TABLE chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES users(id),
  content TEXT NOT NULL,
  type TEXT DEFAULT 'text',
  thread_id UUID REFERENCES chat_messages(id),
  pinned BOOLEAN DEFAULT false,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ
);

-- chat_files: 첨부파일
CREATE TABLE chat_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  file_url TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size BIGINT,
  mime_type TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- chat_events: 시스템 이벤트 자동 기록
CREATE TABLE chat_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  data_json JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── Indexes ──
CREATE INDEX idx_chat_channels_company ON chat_channels(company_id);
CREATE INDEX idx_chat_channels_deal ON chat_channels(deal_id);
CREATE INDEX idx_chat_participants_channel ON chat_participants(channel_id);
CREATE INDEX idx_chat_participants_user ON chat_participants(user_id);
CREATE INDEX idx_chat_messages_channel ON chat_messages(channel_id);
CREATE INDEX idx_chat_messages_created ON chat_messages(channel_id, created_at DESC);
CREATE INDEX idx_chat_messages_thread ON chat_messages(thread_id) WHERE thread_id IS NOT NULL;
CREATE INDEX idx_chat_files_message ON chat_files(message_id);
CREATE INDEX idx_chat_events_channel ON chat_events(channel_id);

-- ── RLS ──
ALTER TABLE chat_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_events ENABLE ROW LEVEL SECURITY;

-- chat_channels: company 소속만
CREATE POLICY "chat_channels_company" ON chat_channels
  FOR ALL USING (company_id = get_my_company_id());

-- chat_participants: 자기 회사 채널의 참가자만
CREATE POLICY "chat_participants_company" ON chat_participants
  FOR ALL USING (
    channel_id IN (SELECT id FROM chat_channels WHERE company_id = get_my_company_id())
  );

-- chat_messages: 자기 회사 채널의 메시지만
CREATE POLICY "chat_messages_company" ON chat_messages
  FOR ALL USING (
    channel_id IN (SELECT id FROM chat_channels WHERE company_id = get_my_company_id())
  );

-- chat_files: 자기 회사 채널의 파일만
CREATE POLICY "chat_files_company" ON chat_files
  FOR ALL USING (
    channel_id IN (SELECT id FROM chat_channels WHERE company_id = get_my_company_id())
  );

-- chat_events: 자기 회사 채널의 이벤트만
CREATE POLICY "chat_events_company" ON chat_events
  FOR ALL USING (
    channel_id IN (SELECT id FROM chat_channels WHERE company_id = get_my_company_id())
  );

-- ── Enable Realtime for chat_messages ──
ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;
