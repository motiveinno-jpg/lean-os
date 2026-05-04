-- Migration: fix_users_rls_infinite_recursion
-- Version: 20260303121842
-- Source: production schema_migrations (auto-extracted 2026-05-04)


-- Fix infinite recursion in users table RLS policies
-- Problem: "Owners can manage users" policy has EXISTS(SELECT FROM users) 
-- which triggers RLS on users again → infinite loop

-- 1) Create SECURITY DEFINER helper to check owner status without RLS
CREATE OR REPLACE FUNCTION public.is_company_owner()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT EXISTS(
    SELECT 1 FROM users WHERE auth_id = auth.uid() AND role = 'owner'
  );
$$;

-- 2) Drop problematic policies
DROP POLICY IF EXISTS "Users can view company members" ON users;
DROP POLICY IF EXISTS "Owners can manage users" ON users;
DROP POLICY IF EXISTS "Users can insert self" ON users;

-- 3) Recreate without self-referential subqueries
-- SELECT: any user can view members in same company
CREATE POLICY "Users can view company members" ON users
  FOR SELECT USING (company_id = get_my_company_id());

-- INSERT: user can insert their own row
CREATE POLICY "Users can insert self" ON users
  FOR INSERT WITH CHECK (auth_id = auth.uid());

-- UPDATE: owners can update company users, or user can update self
CREATE POLICY "Users can update" ON users
  FOR UPDATE USING (
    auth_id = auth.uid() 
    OR (company_id = get_my_company_id() AND is_company_owner())
  );

-- DELETE: only owners can delete company users (not self)
CREATE POLICY "Owners can delete users" ON users
  FOR DELETE USING (
    company_id = get_my_company_id() AND is_company_owner()
  );
