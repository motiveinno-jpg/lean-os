-- Migration: fix_programs_rls_policy
-- Version: 20260423061030
-- Source: production schema_migrations (auto-extracted 2026-05-04)

-- programs RLS: employees 기반 → get_my_company_id() 기반으로 변경
-- 기존: owner가 employees에 없으면 INSERT 불가 (프로그램 생성 에러 원인)
DROP POLICY IF EXISTS "programs_company_access" ON programs;
CREATE POLICY "programs_company_access" ON programs FOR ALL
  USING (company_id = get_my_company_id())
  WITH CHECK (company_id = get_my_company_id());