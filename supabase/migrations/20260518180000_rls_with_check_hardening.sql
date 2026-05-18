-- Migration: rls_with_check_hardening
-- Version: 20260518180000
-- Security hardening (additive, non-destructive): add WITH CHECK to
-- company-scoped FOR ALL / FOR UPDATE policies that were missing it.
--
-- Defect: policies created with only USING (...) and no WITH CHECK allow
-- INSERT/UPDATE to write rows whose company_id points at another company,
-- because PostgreSQL falls back to USING for the row-write check ONLY for
-- UPDATE (the post-update row), and for INSERT there is NO check at all when
-- WITH CHECK is absent. This lets a tenant create/relabel rows with a
-- foreign company_id.
--
-- Fix: replace each affected policy in-place (DROP POLICY IF EXISTS +
-- CREATE POLICY, same name, identical USING) and add the matching
-- WITH CHECK clause. No table/column/data is dropped. Policy replacement
-- is a non-destructive metadata operation.
--
-- IMPORTANT: company signup INSERT into `companies` is handled by a
-- SEPARATE dedicated policy "Authenticated users can create company"
-- (20260319040702). The "Owners can update company" policy below is
-- FOR UPDATE only, so adding WITH CHECK does not touch the signup path.

-- ---------------------------------------------------------------------------
-- 1) company_settings : "company_settings_access" (FOR ALL)
--    Used by setLeaveGrantMethod() upsert (src/lib/hr.ts) + CODEF/hometax
--    credential storage. Without WITH CHECK an upsert could persist a row
--    with a foreign company_id.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "company_settings_access" ON company_settings;
CREATE POLICY "company_settings_access" ON company_settings
  FOR ALL
  USING (company_id = public.get_my_company_id())
  WITH CHECK (company_id = public.get_my_company_id());

-- ---------------------------------------------------------------------------
-- 2) recurring_payments : "recurring_payments_company" (FOR ALL)
--    Fixed-cost / subscription recurring payments. Same FOR ALL gap.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "recurring_payments_company" ON public.recurring_payments;
CREATE POLICY "recurring_payments_company" ON public.recurring_payments
  FOR ALL
  USING (company_id = public.get_my_company_id())
  WITH CHECK (company_id = public.get_my_company_id());

-- ---------------------------------------------------------------------------
-- 3) companies : "Owners can update company" (FOR UPDATE)
--    settings/page.tsx updates companies.seal_url for the user's own company.
--    Adding WITH CHECK ensures an UPDATE cannot re-assign the row to a
--    different company id. SELECT / INSERT (signup) policies are untouched.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Owners can update company" ON companies;
CREATE POLICY "Owners can update company" ON companies
  FOR UPDATE
  USING (id = public.get_my_company_id())
  WITH CHECK (id = public.get_my_company_id());
