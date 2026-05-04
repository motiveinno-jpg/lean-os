-- Migration: add_programs_table
-- Version: 20260415033847
-- Source: production schema_migrations (auto-extracted 2026-05-04)


-- 1. programs 테이블 생성
CREATE TABLE programs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  total_budget BIGINT DEFAULT 0,
  deal_template JSONB DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. deals 테이블에 program_id, partner_company_id 추가
ALTER TABLE deals ADD COLUMN IF NOT EXISTS program_id UUID REFERENCES programs(id) ON DELETE SET NULL;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS partner_company_id UUID REFERENCES companies(id) ON DELETE SET NULL;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS custom_scope JSONB DEFAULT '{}';

-- 3. 인덱스
CREATE INDEX idx_programs_company_id ON programs(company_id);
CREATE INDEX idx_programs_status ON programs(status);
CREATE INDEX idx_deals_program_id ON deals(program_id);
CREATE INDEX idx_deals_partner_company_id ON deals(partner_company_id);

-- 4. RLS 활성화
ALTER TABLE programs ENABLE ROW LEVEL SECURITY;

-- 5. RLS 정책: 자기 회사 프로그램만 접근
CREATE POLICY "programs_company_access" ON programs
  FOR ALL USING (
    company_id IN (
      SELECT company_id FROM employees WHERE user_id = auth.uid()
    )
  );

-- 6. deals RLS 업데이트: 파트너사도 자기 배정 딜 조회 가능
CREATE POLICY "deals_partner_read" ON deals
  FOR SELECT USING (
    partner_company_id IN (
      SELECT company_id FROM employees WHERE user_id = auth.uid()
    )
  );

-- 7. updated_at 자동 갱신 트리거
CREATE OR REPLACE FUNCTION update_programs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER programs_updated_at
  BEFORE UPDATE ON programs
  FOR EACH ROW
  EXECUTE FUNCTION update_programs_updated_at();
