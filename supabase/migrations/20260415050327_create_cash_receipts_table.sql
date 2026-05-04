-- Migration: create_cash_receipts_table
-- Version: 20260415050327
-- Source: production schema_migrations (auto-extracted 2026-05-04)


-- 현금영수증 관리 테이블
CREATE TABLE IF NOT EXISTS cash_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES companies(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('income', 'expense')),
  -- income: 매출 현금영수증 (발행), expense: 매입 현금영수증 (수취)
  amount numeric NOT NULL,
  supply_amount numeric,
  tax_amount numeric,
  counterparty_name text,
  counterparty_bizno text,
  issue_date date NOT NULL,
  approval_number text, -- 승인번호
  identity_number text, -- 소비자 식별번호 (전화번호/사업자번호)
  identity_type text CHECK (identity_type IN ('phone', 'bizno', 'card')),
  purpose text CHECK (purpose IN ('expenditure_proof', 'income_deduction')),
  -- expenditure_proof: 지출증빙, income_deduction: 소득공제
  status text DEFAULT 'issued' CHECK (status IN ('issued', 'cancelled', 'void')),
  source text DEFAULT 'manual' CHECK (source IN ('manual', 'hometax_sync', 'pos')),
  deal_id uuid REFERENCES deals(id) ON DELETE SET NULL,
  memo text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_cash_receipts_company ON cash_receipts(company_id);
CREATE INDEX IF NOT EXISTS idx_cash_receipts_date ON cash_receipts(company_id, issue_date);
CREATE INDEX IF NOT EXISTS idx_cash_receipts_type ON cash_receipts(company_id, type);

-- RLS
ALTER TABLE cash_receipts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own company cash receipts"
  ON cash_receipts FOR SELECT
  USING (company_id IN (SELECT company_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Users can insert own company cash receipts"
  ON cash_receipts FOR INSERT
  WITH CHECK (company_id IN (SELECT company_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Users can update own company cash receipts"
  ON cash_receipts FOR UPDATE
  USING (company_id IN (SELECT company_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Users can delete own company cash receipts"
  ON cash_receipts FOR DELETE
  USING (company_id IN (SELECT company_id FROM users WHERE id = auth.uid()));

-- Trigger for updated_at
CREATE TRIGGER set_cash_receipts_updated_at
  BEFORE UPDATE ON cash_receipts
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
