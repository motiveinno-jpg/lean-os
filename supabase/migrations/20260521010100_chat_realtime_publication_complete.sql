-- L 채팅 인접: chat_events / chat_mentions / chat_reactions 도 supabase_realtime publication 에 추가
-- (quote_approvals 인시던트 후속 점검 — realtime.ts 가 .channel() 구독하나
--  publication 미등록 → 같은 WebSocket retry 폭증 + auth 504 hang 재발 위험)
--
-- chat_messages 는 이미 publication 에 있음. 인접 3개 테이블이 누락.

SET lock_timeout = '4000';
SET statement_timeout = '60000';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'chat_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_events;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'chat_mentions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_mentions;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'chat_reactions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_reactions;
  END IF;
END $$;
