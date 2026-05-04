-- Migration: create_automation_runs
-- Version: 20260308022308
-- Source: production schema_migrations (auto-extracted 2026-05-04)


CREATE TABLE automation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  run_type text NOT NULL,
  status text NOT NULL DEFAULT 'running',
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  result_summary jsonb,
  error_message text,
  triggered_by text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE automation_runs IS '자동화 실행 이력 추적';
COMMENT ON COLUMN automation_runs.run_type IS 'bank_import | hometax_import | monthly_batch | matching | full_pipeline';
COMMENT ON COLUMN automation_runs.status IS 'running | completed | failed';
COMMENT ON COLUMN automation_runs.triggered_by IS 'manual | schedule | n8n';

CREATE INDEX idx_automation_runs_company ON automation_runs(company_id);
CREATE INDEX idx_automation_runs_status ON automation_runs(status);
CREATE INDEX idx_automation_runs_type ON automation_runs(run_type);

ALTER TABLE automation_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "automation_runs_company" ON automation_runs
  FOR ALL USING (company_id = get_my_company_id());
