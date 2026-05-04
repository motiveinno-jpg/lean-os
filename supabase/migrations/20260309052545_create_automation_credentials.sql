-- Migration: create_automation_credentials
-- Version: 20260309052545
-- Source: production schema_migrations (auto-extracted 2026-05-04)


-- 자동화 인증정보 저장 테이블
CREATE TABLE automation_credentials (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  service TEXT NOT NULL CHECK (service IN ('ibk', 'hometax', 'lottecard')),
  credentials JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, service)
);

-- RLS: 회사 owner만 접근
ALTER TABLE automation_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_read_own" ON automation_credentials
  FOR SELECT USING (
    company_id IN (
      SELECT company_id FROM users WHERE id = auth.uid() AND role = 'owner'
    )
  );

CREATE POLICY "owner_insert_own" ON automation_credentials
  FOR INSERT WITH CHECK (
    company_id IN (
      SELECT company_id FROM users WHERE id = auth.uid() AND role = 'owner'
    )
  );

CREATE POLICY "owner_update_own" ON automation_credentials
  FOR UPDATE USING (
    company_id IN (
      SELECT company_id FROM users WHERE id = auth.uid() AND role = 'owner'
    )
  );

CREATE POLICY "owner_delete_own" ON automation_credentials
  FOR DELETE USING (
    company_id IN (
      SELECT company_id FROM users WHERE id = auth.uid() AND role = 'owner'
    )
  );

-- 서비스키로 anon key 접근 허용 (로컬 에이전트용)
CREATE POLICY "service_key_read" ON automation_credentials
  FOR SELECT USING (true);
