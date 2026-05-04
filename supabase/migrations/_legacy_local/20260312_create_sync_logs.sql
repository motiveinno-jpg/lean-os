-- Sync logs: tracks data synchronization events per company
CREATE TABLE IF NOT EXISTS sync_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  sync_type text NOT NULL,           -- 'full', 'bank', 'card', 'fixed_costs', 'income'
  status text NOT NULL DEFAULT 'running', -- 'running', 'completed', 'failed'
  results jsonb DEFAULT '[]',
  total_items integer DEFAULT 0,
  started_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  triggered_by uuid,                 -- user who clicked sync
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_sync_logs_company ON sync_logs(company_id, started_at DESC);

-- RLS policies
ALTER TABLE sync_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sync_logs_select_own_company" ON sync_logs
  FOR SELECT USING (
    company_id IN (
      SELECT company_id FROM users WHERE auth_id = auth.uid()
    )
  );

CREATE POLICY "sync_logs_insert_own_company" ON sync_logs
  FOR INSERT WITH CHECK (
    company_id IN (
      SELECT company_id FROM users WHERE auth_id = auth.uid()
    )
  );

CREATE POLICY "sync_logs_update_own_company" ON sync_logs
  FOR UPDATE USING (
    company_id IN (
      SELECT company_id FROM users WHERE auth_id = auth.uid()
    )
  );
