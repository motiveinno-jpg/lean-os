-- Migration: restrict_salary_card_select_by_role
--
-- 보안 하드닝 (security-reviewer Critical 차단 해소):
--   /reports/by-person(인원별지출) 가 직원별 급여 + 법인카드 사용액을 정식
--   진입점으로 표면화. 데이터 소스 4개 테이블(employees / payslip_overrides /
--   card_transactions / corporate_cards)의 RLS 가 회사격리(company_id =
--   get_my_company_id())만 있고 역할 제한이 없어, 동일 회사 employee/partner
--   계정이 anon/authenticated 키로 네트워크 직접 조회 시 타인 급여·카드사용액
--   노출 가능. UI role 가드는 우회 가능하므로 RLS 가 실제 경계여야 함.
--
-- 설계 (순수 additive, 비파괴):
--   * 기존 PERMISSIVE FOR ALL 회사격리 정책은 그대로 둔다 → INSERT/UPDATE/DELETE
--     write 경로(owner/admin UI · payroll/payment-batch 브라우저 클라이언트)는
--     회귀 없음. codef-sync 등 자동화는 service_role 키 사용 → RLS 우회라
--     영향 없음.
--   * 새 RESTRICTIVE FOR SELECT 정책을 추가한다. RESTRICTIVE 는 기존
--     PERMISSIVE 와 AND 로 결합 → 순 SELECT 권한 =
--       (company_id = get_my_company_id())          -- 기존 회사격리 유지
--       AND (is_company_admin() OR <본인 행>)       -- 신규 역할/본인 범위
--     write 커맨드는 FOR SELECT 정책이라 영향 없음(기본 deny 가 아니라
--     기존 PERMISSIVE FOR ALL 이 계속 허용).
--
-- 회귀 절충:
--   * employees: /mypage(본인 email) · /my-contracts(본인 user_id) ·
--     app-shell 온보딩(본인 user_id) 가 본인 행을 읽음 → owner/admin 전체,
--     그 외는 본인 행(user_id 또는 email 매칭)만 SELECT 허용.
--   * payslip_overrides: 본인 명세를 보는 화면은 없으나(employees/by-person/
--     payroll 라이브러리 = 전부 owner/admin 워크플로) 방어적·미래대비로 본인
--     employee 의 override 는 허용. 그 외 타인 급여는 차단.
--   * card_transactions / corporate_cards: 직원-매핑 컬럼이 없고
--     employee/partner 허용 라우트에도 없음 → owner/admin 전용 SELECT.
--
-- employees.user_id 는 users.id 를 FK 로 가리킴(라이브 스키마 검증). 로그인
-- 사용자의 users.id = (SELECT id FROM users WHERE auth_id = auth.uid()).

-- ── 역할 헬퍼 (기존 is_company_owner() 패턴과 동일: SECURITY DEFINER +
--    search_path=public 로 users RLS 재귀 방지) ──
CREATE OR REPLACE FUNCTION public.is_company_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM users
    WHERE auth_id = auth.uid()
      AND role IN ('owner', 'admin')
  );
$function$;

-- ── employees: owner/admin 전체 · 그 외 본인 행만 SELECT ──
DROP POLICY IF EXISTS "employees_select_role_or_self" ON public.employees;
CREATE POLICY "employees_select_role_or_self" ON public.employees
  AS RESTRICTIVE
  FOR SELECT
  USING (
    is_company_admin()
    OR user_id IN (SELECT id FROM users WHERE auth_id = auth.uid())
    OR email = (SELECT email FROM users WHERE auth_id = auth.uid())
  );

-- ── payslip_overrides: owner/admin 전체 · 그 외 본인 employee 의 override 만 ──
DROP POLICY IF EXISTS "payslip_overrides_select_role_or_self" ON public.payslip_overrides;
CREATE POLICY "payslip_overrides_select_role_or_self" ON public.payslip_overrides
  AS RESTRICTIVE
  FOR SELECT
  USING (
    is_company_admin()
    OR employee_id IN (
      SELECT e.id FROM employees e
      WHERE e.user_id IN (SELECT id FROM users WHERE auth_id = auth.uid())
    )
  );

-- ── card_transactions: owner/admin 전용 SELECT (직원 매핑 없음) ──
DROP POLICY IF EXISTS "card_transactions_select_admin_only" ON public.card_transactions;
CREATE POLICY "card_transactions_select_admin_only" ON public.card_transactions
  AS RESTRICTIVE
  FOR SELECT
  USING (is_company_admin());

-- ── corporate_cards: owner/admin 전용 SELECT ──
DROP POLICY IF EXISTS "corporate_cards_select_admin_only" ON public.corporate_cards;
CREATE POLICY "corporate_cards_select_admin_only" ON public.corporate_cards
  AS RESTRICTIVE
  FOR SELECT
  USING (is_company_admin());
