-- Migration: fix_signup_rls_policies
-- Version: 20260319040702
-- Source: production schema_migrations (auto-extracted 2026-05-04)


-- Fix: Allow authenticated users to create a company during signup
-- Before their user record exists, they need to insert into companies
CREATE POLICY "Authenticated users can create company"
  ON companies FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Fix: Allow authenticated users to insert cash_snapshot for their new company
-- The existing ALL policy requires get_my_company_id() which needs user record first
-- This INSERT policy allows it right after user record creation
CREATE POLICY "Users can insert cash_snapshot for own company"
  ON cash_snapshot FOR INSERT
  TO authenticated
  WITH CHECK (
    company_id IN (
      SELECT users.company_id FROM users WHERE users.auth_id = auth.uid()
    )
  );

-- Fix: Allow owners to insert subscriptions for their company (for free plan on signup)
-- The existing ALL policy should handle this, but let's ensure INSERT specifically works
-- after user record exists with owner role
CREATE POLICY "Owners can insert subscription"
  ON subscriptions FOR INSERT
  TO authenticated
  WITH CHECK (
    company_id IN (
      SELECT users.company_id FROM users
      WHERE users.auth_id = auth.uid()
      AND users.role IN ('owner', 'admin')
    )
  );
