-- Migration: reharden_salary_card_select_nonrecursive
--
-- 🔁 RE-HARDENING (비재귀 재설계) — 20260518190000 의 보안 의도를 재구현하되
--    20260519030000 으로 롤백된 504 전면장애의 재귀 원인을 박멸한다.
--
-- ── 장애 원인 (재발 절대 금지) ───────────────────────────────────────────
--   롤백된 20260518190000 의 employees / payslip_overrides RESTRICTIVE
--   FOR SELECT 정책 USING 절이 SECURITY DEFINER 헬퍼 밖에서 users /
--   employees 를 인라인 서브쿼리로 참조:
--       OR user_id IN (SELECT id    FROM users    WHERE auth_id = auth.uid())
--       OR email   =  (SELECT email FROM users    WHERE auth_id = auth.uid())
--       OR employee_id IN (SELECT e.id FROM employees e WHERE e.user_id IN
--                          (SELECT id FROM users WHERE auth_id = auth.uid()))
--   이 인라인 서브쿼리는 호출자 RLS 컨텍스트에서 평가 → users / employees 의
--   SELECT RLS 가 재트리거 → employees → users → employees … 상호재귀.
--   로그인 부트스트랩(getCurrentUser: SELECT users / SELECT employees)이
--   매 요청 재귀 → statement timeout hang → 커넥션 풀 고갈 → 로그인 504.
--   (프로젝트 전력: 20260303121842_fix_users_rls_infinite_recursion.sql,
--    게이트: 메모리 feedback_rls_recursion_gate.)
--
-- ── 비재귀 재설계 (이 마이그레이션) ──────────────────────────────────────
--   정책 USING 본문에서 users / employees 인라인 서브쿼리를 완전히 제거하고,
--   "현재 사용자/직원" 식별을 전부 SECURITY DEFINER 헬퍼로 캡슐화한다.
--   SECURITY DEFINER + SET search_path=public 헬퍼는 함수 소유자(postgres)
--   권한으로 실행되어 호출자 RLS 를 우회하므로(검증: is_company_owner /
--   get_my_company_id / get_company_directory 와 동일 패턴 — 모두 prod 에서
--   재귀 없이 정상 동작 중) users/employees 를 읽어도 RLS 재진입이 없다.
--   정책 본문은 헬퍼 호출 + 스칼라(=) 비교만 → 서브쿼리 0.
--
-- ── 보안 효과 ────────────────────────────────────────────────────────────
--   기존 PERMISSIVE FOR ALL 회사격리 정책(employees: "Company can manage
--   employees", payslip_overrides: "payslip_overrides_company",
--   card_transactions / corporate_cards: 각 회사격리 정책)은 절대 건드리지
--   않는다(write 경로·자동화 회귀 방지, 순수 additive). 신규 RESTRICTIVE
--   FOR SELECT 가 AND 로 결합되어 순 SELECT 권한 =
--     (기존 회사격리)  AND  (is_company_admin() OR <본인 행>)
--   → 동일 회사 employee/partner 가 anon/authenticated 키로 타인 급여·
--     법인카드 사용액 직접조회하던 갭 차단. write(INSERT/UPDATE/DELETE) 는
--     FOR SELECT 정책이라 영향 없음. codef-sync 등 service_role 자동화는
--     RLS 우회라 무영향. /team 은 SECURITY DEFINER get_company_directory()
--     경유라 무영향.
--
-- ── 스키마 근거 (마이그레이션 히스토리 정적 검증) ────────────────────────
--   users(id uuid PK, auth_id uuid UNIQUE, email text, role text)
--     — 20260303103754_create_core_tables.sql
--   employees.user_id uuid REFERENCES users(id), employees.email text
--     — 20260304055245_phase_g_hr_enhancement_v2.sql L73/L76
--   payslip_overrides.employee_id uuid REFERENCES employees(id)
--     — 20260515150000_payslip_overrides.sql L8
--
-- 멱등: 헬퍼는 CREATE OR REPLACE, 정책은 DROP POLICY IF EXISTS 선행.
-- 롤백: 문제 발생 시 20260519030000_rollback_restrict_salary_card_select_
--       recursion.sql 을 재적용하면 정책 4개 + is_company_admin() 가 즉시
--       제거되어 PERMISSIVE 회사격리만 남는 안전 상태로 원복(검증된 경로).

-- 적용 안전장치 (20260519030000 롤백 마이그레이션과 동일 패턴):
-- DROP/CREATE POLICY 는 ACCESS EXCLUSIVE 락이 필요하므로, 만약 어떤 세션이
-- 테이블에 락을 들고 있어도 무한 대기로 커넥션 슬롯을 점유하지 않도록
-- 짧게 실패시킨다(멱등이라 재시도 안전).
SET lock_timeout = '4000';
SET statement_timeout = '20000';

-- ─────────────────────────────────────────────────────────────────────────
-- 1) SECURITY DEFINER 헬퍼 (전부 LANGUAGE sql STABLE SECURITY DEFINER
--    SET search_path=public — is_company_owner / get_my_company_id /
--    get_company_directory 와 동일 패턴. 본문이 users/employees 를 읽지만
--    SECURITY DEFINER 라 호출자 RLS 우회 → 재귀 없음.)
-- ─────────────────────────────────────────────────────────────────────────

-- 1a) 역할 헬퍼 (롤백 때 제거됐던 것 복원 — 재귀 원인 아니었음).
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

-- 1b) 로그인 사용자의 users.id (employees.user_id 매칭용).
CREATE OR REPLACE FUNCTION public.current_app_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT id FROM users WHERE auth_id = auth.uid();
$function$;

-- 1c) 로그인 사용자의 users.email (employees.email 매칭용 — user_id
--     미연결 직원 레코드 대비).
CREATE OR REPLACE FUNCTION public.current_app_user_email()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT email FROM users WHERE auth_id = auth.uid();
$function$;

-- 1d) 로그인 사용자의 employees.id (payslip_overrides.employee_id 매칭용).
--     본문이 employees 를 읽되 SECURITY DEFINER 라 employees RLS 우회 →
--     재귀 없음. user_id 우선, 없으면 email 폴백.
CREATE OR REPLACE FUNCTION public.current_employee_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT e.id
  FROM employees e
  WHERE e.user_id = (SELECT u.id FROM users u WHERE u.auth_id = auth.uid())
     OR e.email   = (SELECT u.email FROM users u WHERE u.auth_id = auth.uid())
  -- user_id 직접 매칭을 email 폴백보다 우선 (security-reviewer 권고:
  -- 동일 email/연결 직원 복수 시 LIMIT 1 비결정성 제거).
  ORDER BY (e.user_id IS NOT NULL) DESC
  LIMIT 1;
$function$;

-- 헬퍼 호출 권한 (RLS 평가 컨텍스트에서 호출되므로 authenticated/anon 모두
-- 정책 평가 시 실행 가능해야 함 — 함수 자체는 auth.uid() 기반이라 익명은
-- NULL 반환. 기존 헬퍼 패턴과 동일하게 PUBLIC 실행 허용 유지.)
GRANT EXECUTE ON FUNCTION public.is_company_admin()        TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.current_app_user_id()     TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.current_app_user_email()  TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.current_employee_id()     TO authenticated, anon;

COMMENT ON FUNCTION public.current_app_user_id() IS
  'RLS 전용. 로그인 사용자 users.id. SECURITY DEFINER 로 users RLS 우회 → 정책 인라인 서브쿼리 박멸(20260518190000 재귀 회피).';
COMMENT ON FUNCTION public.current_app_user_email() IS
  'RLS 전용. 로그인 사용자 users.email. SECURITY DEFINER 로 users RLS 우회.';
COMMENT ON FUNCTION public.current_employee_id() IS
  'RLS 전용. 로그인 사용자 employees.id. SECURITY DEFINER 로 employees RLS 우회 → payslip 정책 재귀 회피.';

-- ─────────────────────────────────────────────────────────────────────────
-- 2) RESTRICTIVE FOR SELECT 정책 (본문 = 헬퍼 호출 + 스칼라 비교, 서브쿼리 0)
-- ─────────────────────────────────────────────────────────────────────────

-- 2a) employees: owner/admin 전체 · 그 외 본인 행만 SELECT.
DROP POLICY IF EXISTS "employees_select_role_or_self" ON public.employees;
CREATE POLICY "employees_select_role_or_self" ON public.employees
  AS RESTRICTIVE
  FOR SELECT
  USING (
    is_company_admin()
    OR user_id = current_app_user_id()
    OR email   = current_app_user_email()
  );

-- 2b) payslip_overrides: owner/admin 전체 · 그 외 본인 employee 의 override만.
DROP POLICY IF EXISTS "payslip_overrides_select_role_or_self" ON public.payslip_overrides;
CREATE POLICY "payslip_overrides_select_role_or_self" ON public.payslip_overrides
  AS RESTRICTIVE
  FOR SELECT
  USING (
    is_company_admin()
    OR employee_id = current_employee_id()
  );

-- 2c) card_transactions: owner/admin 전용 SELECT (직원 매핑 없음).
--     20260518190000 와 동일(인라인 없음 — 재귀 무관, collateral 복원).
DROP POLICY IF EXISTS "card_transactions_select_admin_only" ON public.card_transactions;
CREATE POLICY "card_transactions_select_admin_only" ON public.card_transactions
  AS RESTRICTIVE
  FOR SELECT
  USING (is_company_admin());

-- 2d) corporate_cards: owner/admin 전용 SELECT.
DROP POLICY IF EXISTS "corporate_cards_select_admin_only" ON public.corporate_cards;
CREATE POLICY "corporate_cards_select_admin_only" ON public.corporate_cards
  AS RESTRICTIVE
  FOR SELECT
  USING (is_company_admin());
