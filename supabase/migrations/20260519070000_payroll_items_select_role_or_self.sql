-- Migration: payroll_items_select_role_or_self
--
-- 🔒 P0 갭 차단 — 20260519040000_reharden_salary_card_select_nonrecursive.sql
--    의 본인격리 RESTRICTIVE SELECT 패턴을 payroll_items 로 확장한다.
--
-- ── 배경 (갭) ────────────────────────────────────────────────────────────
--   20260519040000 은 employees / payslip_overrides / card_transactions /
--   corporate_cards 만 다뤘고 payroll_items 는 누락. prod 의 payroll_items
--   에는 PERMISSIVE FOR ALL 회사격리 정책 1개만 존재:
--       "payroll_items_company_policy"
--         USING (batch_id IN (SELECT id FROM payment_batches
--                             WHERE company_id = get_my_company_id()))
--       — 20260304131027_phase_o_payroll_items_and_employees_alter.sql L29
--   회사 단위 격리만이라, 동일 회사 직원/파트너가 anon/authenticated 키로
--   from('payroll_items').select 직접 호출 시 동료의 base_salary /
--   national_pension / income_tax / net_pay 등 급여 상세를 조회 가능한 갭.
--   payslip_overrides 와 동일하게 본인격리 RESTRICTIVE SELECT 를 추가한다.
--
-- ── 비재귀 보장 (feedback_rls_recursion_gate 준수) ───────────────────────
--   정책 USING 본문은 SECURITY DEFINER STABLE search_path=public 헬퍼
--   호출(is_company_admin / current_employee_id) + 스칼라(=) 비교만으로
--   구성 — 인라인 서브쿼리 0. 두 헬퍼는 20260519040000 에서 신설되어
--   prod 적용·검증 완료(secdef=true / volatility=stable / search_path=public).
--   SECURITY DEFINER 라 헬퍼 본문이 users/employees 를 읽어도 호출자 RLS
--   를 우회 → users↔employees 상호재귀(20260518190000 504 장애 원인) 없음.
--   ⚠️ 본 마이그레이션은 헬퍼를 CREATE 하지 않는다(이미 prod 존재, 공유
--   자산). payroll_items 의 기존 PERMISSIVE 정책도 건드리지 않는다.
--
-- ── 보안 효과 ────────────────────────────────────────────────────────────
--   기존 PERMISSIVE FOR ALL 회사격리("payroll_items_company_policy") 는
--   미변경(write·admin·codef-sync·payment-batch 경로 회귀 방지, 순수
--   additive). 신규 RESTRICTIVE FOR SELECT 가 AND 결합되어
--     순 SELECT = (회사격리) AND (is_company_admin() OR 본인 employee 행)
--   → 동일 회사 직원이 타인 급여 상세를 직접조회하던 갭 차단.
--   write(INSERT/UPDATE/DELETE) 는 FOR SELECT 정책이라 무영향.
--   service_role 자동화(codef-sync 등)는 RLS 우회라 무영향.
--
-- ── 회귀 무영향 근거 ─────────────────────────────────────────────────────
--   · 관리자 급여명세(getPayrollItems: batch_id 필터, employee 필터 없음)
--     → 관리자/오너는 is_company_admin()=true → RESTRICTIVE 통과(전체).
--   · 직원 대시보드 '이번 달 급여' myPayroll
--     (.eq employee_id = 본인 employees.id) → employee_id =
--     current_employee_id() 매칭 → RESTRICTIVE 통과(본인 행만).
--   · payroll_items 는 getCurrentUser 로그인 부트스트랩 경로 아님
--     (직원 대시보드·관리자 PayrollPreviewTab/payment-batch 만 읽음) →
--     로그인 504 무영향.
--
-- ── 스키마 근거 (마이그레이션 히스토리 정적 검증) ────────────────────────
--   payroll_items.employee_id uuid NOT NULL REFERENCES employees(id)
--     — 20260304131027_phase_o_payroll_items_and_employees_alter.sql L12
--
-- 멱등: DROP POLICY IF EXISTS 선행. 정책만 변경(헬퍼·컬럼·RPC 무변경) →
--       database.generated.ts 재생성 불요.
-- 롤백: DROP POLICY IF EXISTS "payroll_items_select_role_or_self"
--         ON public.payroll_items;  (헬퍼는 공유 자산 — 절대 DROP 금지)
--       제거 시 PERMISSIVE 회사격리만 남는 20260519040000 적용 직전 상태.

-- 적용 안전장치 (20260519040000 과 동일 패턴):
-- DROP/CREATE POLICY 는 ACCESS EXCLUSIVE 락이 필요하므로, 어떤 세션이
-- 테이블 락을 들고 있어도 무한 대기로 커넥션 슬롯을 점유하지 않도록
-- 짧게 실패시킨다(멱등이라 재시도 안전).
SET lock_timeout = '4000';
SET statement_timeout = '20000';

-- ─────────────────────────────────────────────────────────────────────────
-- RESTRICTIVE FOR SELECT (본문 = 헬퍼 호출 + 스칼라 비교, 서브쿼리 0).
-- 20260519040000 의 payslip_overrides_select_role_or_self 의 정확한 미러
-- (테이블만 payroll_items 로 교체 — employee_id 컬럼 동형).
-- ─────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "payroll_items_select_role_or_self" ON public.payroll_items;
CREATE POLICY "payroll_items_select_role_or_self" ON public.payroll_items
  AS RESTRICTIVE
  FOR SELECT
  USING (
    is_company_admin()
    OR employee_id = current_employee_id()
  );

COMMENT ON POLICY "payroll_items_select_role_or_self" ON public.payroll_items IS
  '본인격리 RESTRICTIVE SELECT. 기존 PERMISSIVE 회사격리와 AND 결합 → owner/admin 전체 · 그 외 본인 employee 의 급여행만. 본문 SECURITY DEFINER 헬퍼만 호출(비재귀, 20260519040000 패턴 미러).';
