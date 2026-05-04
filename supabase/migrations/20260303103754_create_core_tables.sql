-- Migration: create_core_tables
-- Version: 20260303103754
-- Source: production schema_migrations (auto-extracted 2026-05-04)


-- Companies
CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  industry TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Users
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id UUID UNIQUE,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  role TEXT CHECK (role IN ('owner','manager','staff')) DEFAULT 'staff',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Deals (Master)
CREATE TABLE deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  contract_total NUMERIC DEFAULT 0,
  status TEXT DEFAULT 'active',
  start_date DATE,
  end_date DATE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_deals_company_id ON deals(company_id);

-- Infinite Tree Structure
CREATE TABLE deal_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID REFERENCES deals(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES deal_nodes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  revenue_amount NUMERIC DEFAULT 0,
  expected_cost NUMERIC DEFAULT 0,
  actual_cost NUMERIC DEFAULT 0,
  deadline DATE,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_deal_nodes_deal_id ON deal_nodes(deal_id);
CREATE INDEX idx_deal_nodes_parent_id ON deal_nodes(parent_id);

-- Revenue Installments
CREATE TABLE deal_revenue_schedule (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID REFERENCES deals(id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL,
  due_date DATE,
  type TEXT,
  status TEXT DEFAULT 'scheduled',
  received_at TIMESTAMP,
  expected_sender TEXT,
  expected_account TEXT,
  keyword_hint TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_revenue_schedule_deal_id ON deal_revenue_schedule(deal_id);

-- Vendors
CREATE TABLE vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  account_number TEXT,
  bank_name TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Cost Schedule
CREATE TABLE deal_cost_schedule (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_node_id UUID REFERENCES deal_nodes(id) ON DELETE CASCADE,
  vendor_id UUID REFERENCES vendors(id),
  amount NUMERIC NOT NULL,
  due_date DATE,
  status TEXT DEFAULT 'scheduled',
  approved BOOLEAN DEFAULT FALSE,
  approved_at TIMESTAMP,
  approved_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_cost_schedule_node_id ON deal_cost_schedule(deal_node_id);

-- Transactions (CSV upload first phase)
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  transaction_date DATE,
  amount NUMERIC,
  type TEXT CHECK (type IN ('income','expense')),
  counterparty TEXT,
  description TEXT,
  matched BOOLEAN DEFAULT FALSE,
  raw_data JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_transactions_company_id ON transactions(company_id);
CREATE INDEX idx_transactions_date ON transactions(transaction_date);

-- Matching
CREATE TABLE transaction_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID REFERENCES transactions(id) ON DELETE CASCADE,
  revenue_schedule_id UUID REFERENCES deal_revenue_schedule(id),
  cost_schedule_id UUID REFERENCES deal_cost_schedule(id),
  match_score INTEGER,
  status TEXT CHECK (status IN ('auto','review','unmatched')) DEFAULT 'unmatched',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Employees
CREATE TABLE employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  salary NUMERIC DEFAULT 0,
  hire_date DATE,
  status TEXT DEFAULT 'active',
  retirement_accrual NUMERIC DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Cash Snapshot
CREATE TABLE cash_snapshot (
  company_id UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  current_balance NUMERIC DEFAULT 0,
  monthly_fixed_cost NUMERIC DEFAULT 0,
  updated_at TIMESTAMP DEFAULT NOW()
);
