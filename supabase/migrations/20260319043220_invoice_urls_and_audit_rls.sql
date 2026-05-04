-- Migration: invoice_urls_and_audit_rls
-- Version: 20260319043220
-- Source: production schema_migrations (auto-extracted 2026-05-04)

-- Add Stripe invoice URL columns for billing page invoice links
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS stripe_invoice_id TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS stripe_invoice_url TEXT;

-- Performance index for subscription lookups
CREATE INDEX IF NOT EXISTS idx_subscriptions_company_status
  ON subscriptions(company_id, status);

CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_sub_id
  ON subscriptions(stripe_subscription_id);

-- Fix audit_logs RLS: use users table instead of non-existent company_members table
DROP POLICY IF EXISTS "Users can view audit logs for their company" ON audit_logs;
CREATE POLICY "Users can view audit logs for their company"
  ON audit_logs FOR SELECT
  USING (
    company_id IN (
      SELECT users.company_id FROM users WHERE users.auth_id = auth.uid()
    )
  );