-- L 견적: quote_approvals 를 supabase_realtime publication 에 등록
-- (20260520180000 작성 시 누락 — WebSocket 채널 거부 → 클라 retry 폭증 픽스)
--
-- 증상: 견적 발송 클릭 시 콘솔에 WebSocket(wss realtime) 연결 실패 반복 +
--       auth/v1/user 504, 발송 2분 hang.
-- 원인: subscribeApprovalStatus (quote-approvals.ts L191) 가 postgres_changes
--       on quote_approvals 구독 시도 → publication 미등록 → 채널 거부 →
--       클라 retry 폭증 → 같은 supabase 클라이언트의 다른 호출(auth.getUser)
--       리퀘스트큐 점거.
-- 픽스: publication ADD + REPLICA IDENTITY FULL.

SET lock_timeout = '4000';
SET statement_timeout = '60000';

DO $$
BEGIN
  -- 멱등: 이미 publication 에 있으면 통과
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'quote_approvals'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.quote_approvals;
  END IF;
END $$;

-- postgres_changes 필터 동작 보장 (deal_id eq 필터 사용 중 — UPDATE 시
-- old/new 둘 다 row 전체 필요)
ALTER TABLE public.quote_approvals REPLICA IDENTITY FULL;

COMMENT ON TABLE public.quote_approvals IS
  '견적·계약·진행·완료·정산 단계별 외부 승인 워크플로우. '
  'Realtime publication 등록됨(20260521010000) — subscribeApprovalStatus 채널.';
