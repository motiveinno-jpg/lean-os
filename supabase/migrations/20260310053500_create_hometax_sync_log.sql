-- Migration: create_hometax_sync_log
-- Version: 20260310053500
-- Source: production schema_migrations (auto-extracted 2026-05-04)


-- 홈택스 동기화 이력
CREATE TABLE IF NOT EXISTS hometax_sync_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  sync_type text NOT NULL, -- 'fetch_sales', 'fetch_purchase', 'issue', 'modify'
  status text NOT NULL DEFAULT 'pending', -- pending, running, completed, failed
  request_payload jsonb,
  response_payload jsonb,
  invoices_fetched int DEFAULT 0,
  invoices_created int DEFAULT 0,
  invoices_updated int DEFAULT 0,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE hometax_sync_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company members can view sync logs" ON hometax_sync_log
  FOR SELECT USING (
    company_id IN (SELECT company_id FROM users WHERE id = auth.uid())
  );

CREATE INDEX idx_hometax_sync_company ON hometax_sync_log(company_id, created_at DESC);

-- 자동발행 대기 큐
CREATE TABLE IF NOT EXISTS tax_invoice_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  deal_id uuid REFERENCES deals(id),
  revenue_schedule_id uuid REFERENCES deal_revenue_schedule(id),
  action text NOT NULL, -- 'issue', 'modify', 'cancel'
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending', -- pending, processing, completed, failed, needs_approval
  approved_by uuid REFERENCES users(id),
  approved_at timestamptz,
  error_message text,
  created_at timestamptz DEFAULT now(),
  processed_at timestamptz
);

ALTER TABLE tax_invoice_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company members can view queue" ON tax_invoice_queue
  FOR SELECT USING (
    company_id IN (SELECT company_id FROM users WHERE id = auth.uid())
  );

CREATE POLICY "Company members can update queue" ON tax_invoice_queue
  FOR UPDATE USING (
    company_id IN (SELECT company_id FROM users WHERE id = auth.uid())
  );

CREATE INDEX idx_tiq_pending ON tax_invoice_queue(company_id, status) WHERE status = 'pending';
