-- Migration: create_loans_and_certificate_logs
-- Version: 20260308143904
-- Source: production schema_migrations (auto-extracted 2026-05-04)


-- loans table
CREATE TABLE loans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  lender TEXT NOT NULL,
  loan_type TEXT DEFAULT 'term',
  original_amount BIGINT NOT NULL DEFAULT 0,
  remaining_balance BIGINT NOT NULL DEFAULT 0,
  interest_rate NUMERIC(5,2),
  start_date DATE,
  maturity_date DATE,
  payment_day INT,
  interest_day INT,
  bank_account_id UUID REFERENCES bank_accounts(id),
  status TEXT DEFAULT 'active',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE loans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company_isolation" ON loans FOR ALL
  USING (company_id IN (SELECT company_id FROM users WHERE id = auth.uid()));

-- loan_payments table
CREATE TABLE loan_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id UUID NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  payment_date DATE NOT NULL,
  principal_amount BIGINT DEFAULT 0,
  interest_amount BIGINT DEFAULT 0,
  total_amount BIGINT NOT NULL,
  payment_number INT,
  bank_transaction_id UUID REFERENCES bank_transactions(id),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE loan_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "via_loan" ON loan_payments FOR ALL
  USING (loan_id IN (SELECT id FROM loans WHERE company_id IN (SELECT company_id FROM users WHERE id = auth.uid())));

-- certificate_logs table
CREATE TABLE certificate_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  employee_id UUID NOT NULL REFERENCES employees(id),
  certificate_type TEXT NOT NULL,
  certificate_number TEXT NOT NULL UNIQUE,
  issued_by UUID NOT NULL REFERENCES users(id),
  purpose TEXT,
  pdf_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE certificate_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company_isolation" ON certificate_logs FOR ALL
  USING (company_id IN (SELECT company_id FROM users WHERE id = auth.uid()));
