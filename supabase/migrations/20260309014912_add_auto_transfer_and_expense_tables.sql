-- Migration: add_auto_transfer_and_expense_tables
-- Version: 20260309014912
-- Source: production schema_migrations (auto-extracted 2026-05-04)


-- 1) recurring_payments에 자동이체 관련 컬럼 추가
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'recurring_payments' AND column_name = 'auto_transfer_date'
  ) THEN
    ALTER TABLE recurring_payments ADD COLUMN auto_transfer_date INT;
    ALTER TABLE recurring_payments ADD COLUMN auto_transfer_account_id UUID;
    ALTER TABLE recurring_payments ADD COLUMN auto_transfer_memo TEXT;
  END IF;
END $$;

-- 2) expense_requests 테이블 확인/생성
CREATE TABLE IF NOT EXISTS expense_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  requester_id UUID NOT NULL,
  deal_id UUID,
  title TEXT NOT NULL,
  description TEXT,
  amount NUMERIC(15,2) NOT NULL,
  category TEXT DEFAULT 'general',
  receipt_urls TEXT[] DEFAULT '{}',
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'expense_requests' AND policyname = 'expense_requests_company') THEN
    ALTER TABLE expense_requests ENABLE ROW LEVEL SECURITY;
    CREATE POLICY expense_requests_company ON expense_requests FOR ALL USING (
      company_id IN (SELECT company_id FROM employees WHERE user_id = auth.uid())
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_expense_requests_company ON expense_requests(company_id);

-- 3) expense_approvals 테이블 확인/생성
CREATE TABLE IF NOT EXISTS expense_approvals (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL,
  expense_id UUID NOT NULL REFERENCES expense_requests(id) ON DELETE CASCADE,
  approver_id UUID NOT NULL,
  level INT DEFAULT 1,
  status TEXT DEFAULT 'pending',
  comment TEXT,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'expense_approvals' AND policyname = 'expense_approvals_company') THEN
    ALTER TABLE expense_approvals ENABLE ROW LEVEL SECURITY;
    CREATE POLICY expense_approvals_company ON expense_approvals FOR ALL USING (
      company_id IN (SELECT company_id FROM employees WHERE user_id = auth.uid())
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_expense_approvals_expense ON expense_approvals(expense_id);

-- 4) expense_requests에 request_type 추가 (지출결의서 vs 품의서 구분)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'expense_requests' AND column_name = 'request_type'
  ) THEN
    ALTER TABLE expense_requests ADD COLUMN request_type TEXT DEFAULT 'expense';
  END IF;
END $$;
