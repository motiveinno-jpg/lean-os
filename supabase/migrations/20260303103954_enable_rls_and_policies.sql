-- Migration: enable_rls_and_policies
-- Version: 20260303103954
-- Source: production schema_migrations (auto-extracted 2026-05-04)


-- Enable RLS on all tables
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_revenue_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_cost_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE transaction_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_snapshot ENABLE ROW LEVEL SECURITY;

-- Helper function: get company_id for current auth user
CREATE OR REPLACE FUNCTION public.get_my_company_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT company_id FROM users WHERE auth_id = auth.uid() LIMIT 1;
$$;

-- Companies: users can see their own company
CREATE POLICY "Users can view own company" ON companies
  FOR SELECT USING (id = public.get_my_company_id());

CREATE POLICY "Owners can update company" ON companies
  FOR UPDATE USING (id = public.get_my_company_id());

-- Users: can see users in same company
CREATE POLICY "Users can view company members" ON users
  FOR SELECT USING (company_id = public.get_my_company_id());

CREATE POLICY "Users can insert self" ON users
  FOR INSERT WITH CHECK (auth_id = auth.uid());

CREATE POLICY "Owners can manage users" ON users
  FOR ALL USING (
    company_id = public.get_my_company_id()
    AND EXISTS (SELECT 1 FROM users u WHERE u.auth_id = auth.uid() AND u.role = 'owner')
  );

-- Deals: company-scoped
CREATE POLICY "Company can manage deals" ON deals
  FOR ALL USING (company_id = public.get_my_company_id());

-- Deal Nodes: via deal's company
CREATE POLICY "Company can manage nodes" ON deal_nodes
  FOR ALL USING (
    EXISTS (SELECT 1 FROM deals d WHERE d.id = deal_nodes.deal_id AND d.company_id = public.get_my_company_id())
  );

-- Revenue Schedule: via deal
CREATE POLICY "Company can manage revenue" ON deal_revenue_schedule
  FOR ALL USING (
    EXISTS (SELECT 1 FROM deals d WHERE d.id = deal_revenue_schedule.deal_id AND d.company_id = public.get_my_company_id())
  );

-- Cost Schedule: via node → deal
CREATE POLICY "Company can manage costs" ON deal_cost_schedule
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM deal_nodes dn
      JOIN deals d ON d.id = dn.deal_id
      WHERE dn.id = deal_cost_schedule.deal_node_id
      AND d.company_id = public.get_my_company_id()
    )
  );

-- Vendors: company-scoped
CREATE POLICY "Company can manage vendors" ON vendors
  FOR ALL USING (company_id = public.get_my_company_id());

-- Transactions: company-scoped
CREATE POLICY "Company can manage transactions" ON transactions
  FOR ALL USING (company_id = public.get_my_company_id());

-- Transaction Matches: via transaction
CREATE POLICY "Company can manage matches" ON transaction_matches
  FOR ALL USING (
    EXISTS (SELECT 1 FROM transactions t WHERE t.id = transaction_matches.transaction_id AND t.company_id = public.get_my_company_id())
  );

-- Employees: company-scoped
CREATE POLICY "Company can manage employees" ON employees
  FOR ALL USING (company_id = public.get_my_company_id());

-- Cash Snapshot: company-scoped
CREATE POLICY "Company can manage cash" ON cash_snapshot
  FOR ALL USING (company_id = public.get_my_company_id());
