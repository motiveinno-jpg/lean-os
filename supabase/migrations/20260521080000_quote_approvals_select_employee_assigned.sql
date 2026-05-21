-- 직원 본인 담당 프로젝트의 quote_approvals SELECT 허용.
--   배경: 현 RESTRICTIVE SELECT = is_company_admin() OR created_by = current_app_user_id()
--   → 관리자가 만든 행을 직원이 못 봄 → 활동탭 파일/로그 빈 화면.
--   해결: SECURITY DEFINER 헬퍼 is_user_assigned_to_deal(deal_id) 신설 + 정책 OR 확장.
--
-- 비재귀 게이트 (feedback_rls_recursion_gate 준수):
--   - 정책 본문에 users/employees 인라인 서브쿼리 0
--   - deal_assignments 만 인라인 (자체 RLS PERMISSIVE 회사격리, 재귀 안전)
--   - 더 안전하게 SECDEF 헬퍼로 캡슐화 → 정책 본문은 함수 호출만
--
-- 권한 확대 영향:
--   - SELECT 만 확장 (INSERT/UPDATE/DELETE 정책 무변경 — 작성·수정은 admin 유지)
--   - 직원은 본인 deal_assignments.is_active=true 인 deal 의 quote_approvals 만 SELECT
--   - 미할당 deal 은 0행 유지 (보안 갭 0)
--
-- 5/19 504 인시던트 (RLS 재귀 부트스트랩) 패턴 검증 필수:
--   - is_user_assigned_to_deal 은 SECURITY DEFINER 라 RLS bypass → 재귀 무관
--   - deal_assignments SELECT RLS 만 사용 (users/employees 미참조)

BEGIN;

-- 1) SECDEF 헬퍼 신설 — 정책 본문 캡슐화 + 재사용 가능
CREATE OR REPLACE FUNCTION public.is_user_assigned_to_deal(p_deal_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM deal_assignments
    WHERE deal_id = p_deal_id
      AND user_id = current_app_user_id()
      AND is_active = true
  );
$$;

REVOKE ALL ON FUNCTION public.is_user_assigned_to_deal(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_user_assigned_to_deal(uuid) TO authenticated;

COMMENT ON FUNCTION public.is_user_assigned_to_deal IS
  '직원이 특정 deal 에 active assignment 가졌는지 검증. SECDEF + STABLE. quote_approvals RLS 직원 분기 캡슐화.';

-- 2) quote_approvals SELECT 정책 확장 — 직원 본인 담당딜 OR 추가
DROP POLICY IF EXISTS quote_approvals_select_admin_or_self ON public.quote_approvals;

CREATE POLICY quote_approvals_select_admin_or_self
  ON public.quote_approvals
  AS RESTRICTIVE
  FOR SELECT
  TO authenticated
  USING (
    is_company_admin()
    OR created_by = current_app_user_id()
    OR is_user_assigned_to_deal(deal_id)
  );

COMMENT ON POLICY quote_approvals_select_admin_or_self ON public.quote_approvals IS
  'SELECT 허용: admin, 작성자(직원이 본인 발송), 본인 담당 프로젝트(deal_assignments active). INSERT/UPDATE/DELETE 는 별도 admin 정책.';

COMMIT;

-- ─── 비재귀 검증 (마이그 후 0건이어야 함) ───
-- SELECT polname FROM pg_policy
-- WHERE polrelid='public.quote_approvals'::regclass
--   AND (pg_get_expr(polqual, polrelid) ~ '\mFROM\s+(public\.)?(users|employees)\M'
--     OR pg_get_expr(polwithcheck, polrelid) ~ '\mFROM\s+(public\.)?(users|employees)\M');
