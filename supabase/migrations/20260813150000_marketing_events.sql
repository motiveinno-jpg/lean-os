-- 마케팅 퍼널 이벤트 자체 기록 (2026-08-13) — GA4 병행. 운영자 페이지 시각화용.
--   쓰기: 정책 없음(서비스롤 전용 — /api/track 라우트만 삽입, 익명 방문자 이벤트라 auth 불가).
--   읽기: 운영자(@mo-tive.com)만 — error_logs 와 동일 패턴.
CREATE TABLE IF NOT EXISTS marketing_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event text NOT NULL CHECK (event IN ('page_view','tool_calculate','sign_up','bank_connect','checkout_start')),
  params jsonb NOT NULL DEFAULT '{}',
  path text,
  referrer text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE marketing_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "marketing_events_operator_read" ON marketing_events;
CREATE POLICY "marketing_events_operator_read" ON marketing_events
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM users u WHERE u.auth_id = auth.uid() AND u.email LIKE '%@mo-tive.com'));

CREATE INDEX IF NOT EXISTS idx_marketing_events_created ON marketing_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_marketing_events_event_created ON marketing_events(event, created_at DESC);
