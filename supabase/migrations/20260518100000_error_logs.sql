-- Migration: error_logs (서비스 에러 로그 — 운영자 전용 조회)
-- 앱에서 발생한 에러를 적재. 모든 인증 사용자가 INSERT, 조회/수정은 운영자(@mo-tive.com)만.

CREATE TABLE IF NOT EXISTS error_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid,
  user_email text,
  user_name text,
  source text,                 -- mutation | boundary | window | promise | manual
  error_type text,             -- 분류 키 (postgres_22P02 등)
  message text NOT NULL,
  stack text,
  url text,
  user_agent text,
  context jsonb,
  resolved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE error_logs ENABLE ROW LEVEL SECURITY;

-- INSERT: 로그인한 누구나 (앱이 에러를 적재)
DROP POLICY IF EXISTS "error_logs_insert_any" ON error_logs;
CREATE POLICY "error_logs_insert_any" ON error_logs
  FOR INSERT TO authenticated WITH CHECK (true);

-- SELECT/UPDATE/DELETE: 서비스 운영자(@mo-tive.com)만
DROP POLICY IF EXISTS "error_logs_operator_rw" ON error_logs;
CREATE POLICY "error_logs_operator_rw" ON error_logs
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM users u WHERE u.auth_id = auth.uid() AND u.email LIKE '%@mo-tive.com'))
  WITH CHECK (EXISTS (SELECT 1 FROM users u WHERE u.auth_id = auth.uid() AND u.email LIKE '%@mo-tive.com'));

CREATE INDEX IF NOT EXISTS idx_error_logs_created ON error_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_logs_resolved ON error_logs(resolved, created_at DESC);
