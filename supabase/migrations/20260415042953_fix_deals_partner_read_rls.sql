-- Migration: fix_deals_partner_read_rls
-- Version: 20260415042953
-- Source: production schema_migrations (auto-extracted 2026-05-04)


-- Drop the old broken policy (based on employees table)
DROP POLICY IF EXISTS "deals_partner_read" ON deals;

-- Create helper function to get partner user's email
CREATE OR REPLACE FUNCTION get_my_email()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT email FROM users WHERE auth_id = auth.uid() LIMIT 1;
$$;

-- Create helper function to check if current user is a partner
CREATE OR REPLACE FUNCTION is_partner_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM users WHERE auth_id = auth.uid() AND role = 'partner'
  );
$$;

-- New partner read policy:
-- Partners can SELECT deals where:
-- 1. They were invited via partner_invitations (deal_id linked, accepted)
-- 2. The deal's custom_scope->>'contactEmail' matches their email
-- Non-partner users are unaffected (handled by existing "Company can manage deals" policy)
CREATE POLICY "deals_partner_read" ON deals
  FOR SELECT
  USING (
    -- Only applies to partner-role users
    is_partner_user() AND (
      -- Deal linked via accepted partner invitation
      id IN (
        SELECT pi.deal_id FROM partner_invitations pi
        WHERE pi.email = get_my_email()
          AND pi.status = 'accepted'
          AND pi.deal_id IS NOT NULL
      )
      OR
      -- Deal's custom_scope contactEmail matches partner email
      (custom_scope->>'contactEmail') = get_my_email()
    )
  );
