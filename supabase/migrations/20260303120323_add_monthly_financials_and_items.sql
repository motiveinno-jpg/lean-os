-- Migration: add_monthly_financials_and_items
-- Version: 20260303120323
-- Source: production schema_migrations (auto-extracted 2026-05-04)


-- Monthly financial summaries (from Excel or manual input)
CREATE TABLE monthly_financials (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  month text NOT NULL,  -- 'YYYY-MM' format
  bank_balance numeric DEFAULT 0,
  total_income numeric DEFAULT 0,
  total_expense numeric DEFAULT 0,
  fixed_cost numeric DEFAULT 0,
  variable_cost numeric DEFAULT 0,
  net_cashflow numeric DEFAULT 0,
  revenue numeric DEFAULT 0,
  source text DEFAULT 'manual',  -- 'excel', 'manual', 'sample'
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(company_id, month)
);

-- Individual financial line items (receivables, payables, expense items)
CREATE TABLE financial_items (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  month text NOT NULL,
  category text NOT NULL,  -- 'income', 'expense', 'receivable', 'payable', 'fixed_cost'
  name text NOT NULL,
  amount numeric DEFAULT 0,
  due_date date,
  status text DEFAULT 'pending',  -- 'pending', 'confirmed', 'overdue', 'paid'
  risk_label text,  -- 'LOW_MARGIN', 'DUE_SOON', 'AR_OVER_30', 'OUTSOURCE_OVER_MARGIN'
  project_name text,  -- deal/project association
  account_type text,  -- 계정과목
  source text DEFAULT 'manual',
  created_at timestamptz DEFAULT now()
);

-- Growth targets
CREATE TABLE growth_targets (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period text NOT NULL,  -- 'YYYY-MM', 'YYYY-Q1', 'YYYY'
  target_revenue numeric DEFAULT 0,
  target_profit numeric DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE(company_id, period)
);

-- Indexes
CREATE INDEX idx_monthly_financials_company ON monthly_financials(company_id, month);
CREATE INDEX idx_financial_items_company ON financial_items(company_id, month);
CREATE INDEX idx_financial_items_category ON financial_items(company_id, category);
CREATE INDEX idx_financial_items_risk ON financial_items(company_id, risk_label);

-- RLS
ALTER TABLE monthly_financials ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE growth_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company_access" ON monthly_financials
  FOR ALL USING (company_id = get_my_company_id());
CREATE POLICY "company_access" ON financial_items
  FOR ALL USING (company_id = get_my_company_id());
CREATE POLICY "company_access" ON growth_targets
  FOR ALL USING (company_id = get_my_company_id());
