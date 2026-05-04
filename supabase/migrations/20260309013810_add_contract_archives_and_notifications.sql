-- Migration: add_contract_archives_and_notifications
-- Version: 20260309013810
-- Source: production schema_migrations (auto-extracted 2026-05-04)


-- ============================================
-- 1. contract_archives: 기존 스캔 계약서 보관함
-- ============================================
CREATE TABLE IF NOT EXISTS contract_archives (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  contract_type TEXT NOT NULL DEFAULT 'other',
  counterparty TEXT,
  start_date DATE,
  end_date DATE,
  auto_renewal BOOLEAN DEFAULT false,
  renewal_notice_days INT DEFAULT 30,
  amount NUMERIC(15,2),
  file_urls TEXT[] DEFAULT '{}',
  notes TEXT,
  status TEXT DEFAULT 'active',
  created_by UUID REFERENCES employees(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE contract_archives ENABLE ROW LEVEL SECURITY;
CREATE POLICY "contract_archives_company" ON contract_archives FOR ALL USING (
  company_id IN (SELECT company_id FROM employees WHERE user_id = auth.uid())
);
CREATE INDEX idx_contract_archives_company ON contract_archives(company_id);
CREATE INDEX idx_contract_archives_status ON contract_archives(company_id, status);

-- ============================================
-- 2. document_notifications: 상태변경 알림 이력
-- ============================================
CREATE TABLE IF NOT EXISTS document_notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL,
  document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  recipient_email TEXT,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'
);

ALTER TABLE document_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "doc_notifications_company" ON document_notifications FOR ALL USING (
  company_id IN (SELECT company_id FROM employees WHERE user_id = auth.uid())
);
CREATE INDEX idx_doc_notifications_company ON document_notifications(company_id);

-- ============================================
-- 3. documents 테이블에 content_type 컬럼 확인/추가
-- ============================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'documents' AND column_name = 'content_type'
  ) THEN
    ALTER TABLE documents ADD COLUMN content_type TEXT;
  END IF;
END $$;

-- 기존 documents에서 content_json->>'type' 값으로 content_type 채움
UPDATE documents 
SET content_type = content_json->>'type' 
WHERE content_type IS NULL 
  AND content_json->>'type' IS NOT NULL;
