-- Migration: add_document_shares
-- Version: 20260307080458
-- Source: production schema_migrations (auto-extracted 2026-05-04)


-- Document sharing with public tokens and view tracking
CREATE TABLE IF NOT EXISTS document_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  share_token text NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex') UNIQUE,
  created_by uuid REFERENCES users(id),
  expires_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  allow_feedback boolean NOT NULL DEFAULT true,
  view_count integer NOT NULL DEFAULT 0,
  last_viewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_document_shares_token ON document_shares(share_token) WHERE is_active = true;
CREATE INDEX idx_document_shares_document ON document_shares(document_id);

-- View log for tracking
CREATE TABLE IF NOT EXISTS document_share_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id uuid NOT NULL REFERENCES document_shares(id) ON DELETE CASCADE,
  viewer_ip text,
  viewer_ua text,
  viewed_at timestamptz NOT NULL DEFAULT now()
);

-- Feedback on shared documents
CREATE TABLE IF NOT EXISTS document_share_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id uuid NOT NULL REFERENCES document_shares(id) ON DELETE CASCADE,
  decision text NOT NULL CHECK (decision IN ('approved', 'hold', 'rejected')),
  comment text,
  responder_name text,
  responder_email text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE document_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_share_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_share_feedback ENABLE ROW LEVEL SECURITY;

-- Authenticated users can manage shares for their company
CREATE POLICY "company_members_manage_shares" ON document_shares
  FOR ALL USING (company_id IN (SELECT company_id FROM users WHERE id = auth.uid()));

-- Public read for share views/feedback (via service role or anon with token)
CREATE POLICY "anon_read_active_shares" ON document_shares
  FOR SELECT USING (is_active = true);

CREATE POLICY "anon_insert_views" ON document_share_views
  FOR INSERT WITH CHECK (true);

CREATE POLICY "anon_read_views" ON document_share_views
  FOR SELECT USING (true);

CREATE POLICY "anon_insert_feedback" ON document_share_feedback
  FOR INSERT WITH CHECK (true);

CREATE POLICY "anon_read_feedback" ON document_share_feedback
  FOR SELECT USING (true);

CREATE POLICY "auth_read_feedback" ON document_share_feedback
  FOR SELECT USING (true);
