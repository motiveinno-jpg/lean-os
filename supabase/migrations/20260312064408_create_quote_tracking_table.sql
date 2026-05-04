-- Migration: create_quote_tracking_table
-- Version: 20260312064408
-- Source: production schema_migrations (auto-extracted 2026-05-04)

CREATE TABLE IF NOT EXISTS quote_tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  document_id uuid REFERENCES documents(id),
  quote_title text NOT NULL,
  recipient_name text NOT NULL,
  recipient_email text NOT NULL,
  recipient_company text,
  total_amount numeric,
  currency text DEFAULT 'KRW',
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','viewed','approved','rejected','expired')),
  tracking_token text NOT NULL UNIQUE,
  valid_until timestamptz,
  sent_at timestamptz NOT NULL DEFAULT now(),
  viewed_at timestamptz,
  responded_at timestamptz,
  response_note text,
  view_count integer DEFAULT 0,
  last_viewed_at timestamptz,
  created_by uuid,
  note text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE quote_tracking ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own company quote tracking" ON quote_tracking
  FOR SELECT USING (company_id IN (SELECT company_id FROM employees WHERE id = auth.uid()));

CREATE POLICY "Users can insert own company quote tracking" ON quote_tracking
  FOR INSERT WITH CHECK (company_id IN (SELECT company_id FROM employees WHERE id = auth.uid()));

CREATE POLICY "Users can update own company quote tracking" ON quote_tracking
  FOR UPDATE USING (company_id IN (SELECT company_id FROM employees WHERE id = auth.uid()));

-- Allow anonymous access for public token-based operations (view/respond)
CREATE POLICY "Anyone can view by token" ON quote_tracking
  FOR SELECT USING (true);

CREATE POLICY "Anyone can update by token" ON quote_tracking
  FOR UPDATE USING (true);