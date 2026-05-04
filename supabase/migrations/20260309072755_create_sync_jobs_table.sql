-- Migration: create_sync_jobs_table
-- Version: 20260309072755
-- Source: production schema_migrations (auto-extracted 2026-05-04)


CREATE TABLE sync_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES companies(id) NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed')),
  targets text[] DEFAULT ARRAY['bank','hometax','card','classify'],
  requested_by uuid REFERENCES users(id),
  started_at timestamptz,
  completed_at timestamptz,
  result jsonb,
  error_message text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE sync_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sync_jobs_company" ON sync_jobs
  FOR ALL USING (
    company_id IN (SELECT company_id FROM users WHERE id = auth.uid())
  );

CREATE INDEX idx_sync_jobs_pending ON sync_jobs (company_id, status) WHERE status = 'pending';
