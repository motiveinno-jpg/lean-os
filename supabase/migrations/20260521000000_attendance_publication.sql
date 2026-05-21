-- 핸드오프 (C) 별건 — attendance_records publication 등록.
--   증상: wss "HTTP Authentication failed; no valid credentials" 콘솔 노이즈.
--   원인: src/ 에서 attendance_records .channel() 구독은 0건이라 직접 영향은 없으나,
--         실시간 화면 갱신 향후 도입 대비 및 IA 정합성.
--
-- feedback_realtime_publication_gate (2026-05-21):
--   신규 테이블 .channel() postgres_changes 구독 추가 시 publication ADD 필수
--   + REPLICA IDENTITY FULL. 누락 시 WebSocket retry 폭증 + auth 504 hang.

-- ADD TABLE — 이미 등록되어 있으면 에러 발생 → DO 블록으로 안전 처리
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'attendance_records'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.attendance_records';
  END IF;
END $$;

-- REPLICA IDENTITY FULL — UPDATE/DELETE 이벤트에서 old row 전체 보존 (gate 권고)
ALTER TABLE public.attendance_records REPLICA IDENTITY FULL;
