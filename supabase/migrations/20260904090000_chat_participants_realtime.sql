-- chat_participants 를 realtime publication 에 추가.
--   last_read_at 변경이 브라우저로 바로 흘러가야 내 메시지 옆 '안 읽음 1' 이 상대가 읽는 즉시 사라진다.
--   (지금까지는 10초 폴링이라 새로고침·대기 없이는 안 사라졌다.)
SET statement_timeout = '60000';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'chat_participants'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_participants;
  END IF;
END $$;
