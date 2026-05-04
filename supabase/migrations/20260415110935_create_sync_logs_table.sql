-- Migration: create_sync_logs_table
-- Version: 20260415110935
-- Source: production schema_migrations (auto-extracted 2026-05-04)


CREATE TABLE IF NOT EXISTS sync_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  sync_type text NOT NULL,
  status text NOT NULL DEFAULT 'success',
  details jsonb DEFAULT '{}',
  synced_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sync_logs_company_id ON sync_logs(company_id);
CREATE INDEX idx_sync_logs_created_at ON sync_logs(created_at DESC);

ALTER TABLE sync_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own company sync logs"
  ON sync_logs FOR SELECT
  USING (company_id IN (
    SELECT company_id FROM users WHERE auth_id = auth.uid()
  ));

CREATE POLICY "Service role can insert sync logs"
  ON sync_logs FOR INSERT
  WITH CHECK (true);
