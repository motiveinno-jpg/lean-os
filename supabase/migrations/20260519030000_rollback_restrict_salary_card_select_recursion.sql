-- Migration: rollback_restrict_salary_card_select_recursion
--
-- 🚨 PRODUCTION INCIDENT ROLLBACK (504 on login / DB connection pool exhaustion)
--
-- 원인 (확정):
--   20260518190000_restrict_salary_card_select_by_role.sql 의
--   "employees_select_role_or_self" RESTRICTIVE FOR SELECT 정책 USING 절이
--   SECURITY DEFINER 헬퍼 밖에서 users 를 인라인 서브쿼리로 직접 참조:
--       OR user_id IN (SELECT id    FROM users WHERE auth_id = auth.uid())
--       OR email   =  (SELECT email FROM users WHERE auth_id = auth.uid())
--   이 서브쿼리는 호출자 RLS 컨텍스트에서 평가되므로 users 의 SELECT RLS
--   정책을 다시 트리거한다. users RLS 가 employees(또는 employees 를 다시
--   참조하는 다른 정책)를 참조하면 employees → users → employees … 상호
--   재귀가 발생.
--   로그인 부트스트랩(getCurrentUser: SELECT FROM users / SELECT FROM
--   employees)이 매 요청마다 이 재귀를 일으켜 statement timeout 까지 hang →
--   Postgres 커넥션이 해제되지 않고 누적 → 커넥션 풀 고갈 → 신규 로그인
--   504, 관리 API 도 connection timeout(HTTP 544).
--   (프로젝트 전력: 20260303121842_fix_users_rls_infinite_recursion.sql)
--
-- 조치 (속도 우선 — 로그인 복구가 RLS 하드닝보다 우선, 사용자 승인 범위):
--   20260518190000 가 추가한 RESTRICTIVE FOR SELECT 정책 4개 + is_company_admin()
--   헬퍼만 제거한다. 이로써 employees / payslip_overrides / card_transactions /
--   corporate_cards 는 기존 PERMISSIVE 회사격리(company_id = get_my_company_id())
--   정책만 남아 5/18 이전 동작으로 복귀(재귀 없음). 스키마/데이터/다른 정책
--   무변경. get_company_directory() RPC(20260518200000)는 로그인 경로와 무관
--   하고 SECURITY DEFINER 라 재귀 원인이 아니므로 유지(제거 시 /team 회귀).
--
-- 보안 영향 (의도적·임시):
--   동일 회사 내 employee/partner 계정이 anon/authenticated 키로 employees /
--   payslip_overrides / card_transactions / corporate_cards 를 직접 조회 시
--   타인 급여·법인카드 사용액이 다시 노출 가능(= 20260518190000 가 막으려던
--   갭의 재발). 이는 가용성 우선 결정에 따른 한시적 노출이며, 재귀 없는
--   설계(정책 본문은 SECURITY DEFINER 헬퍼 호출만 — users 인라인 서브쿼리
--   금지)로 재하드닝하는 후속 마이그레이션이 필요(보고서 참조).

-- 인시던트 중 적용: 락 대기로 커넥션 슬롯을 점유하지 않도록 바운드.
-- DROP POLICY 는 ACCESS EXCLUSIVE 락이 필요한데 재귀 SELECT 들이 테이블에
-- ACCESS SHARE 락을 들고 hang 중이므로, 무한 대기 대신 빠르게 실패 후
-- 재시도하도록 lock_timeout 을 짧게 건다(멱등이라 재시도 안전).
SET lock_timeout = '4000';
SET statement_timeout = '20000';

-- 멱등: 정책이 없어도 에러 없이 진행.
DROP POLICY IF EXISTS "employees_select_role_or_self"          ON public.employees;
DROP POLICY IF EXISTS "payslip_overrides_select_role_or_self"  ON public.payslip_overrides;
DROP POLICY IF EXISTS "card_transactions_select_admin_only"    ON public.card_transactions;
DROP POLICY IF EXISTS "corporate_cards_select_admin_only"      ON public.corporate_cards;

-- get_company_directory() (20260518200000) 가 is_company_admin() 에 의존하지
-- 않으므로 헬퍼는 안전하게 제거 가능. 잔존 시 향후 재하드닝과 충돌 가능 →
-- 깨끗이 제거(재하드닝 마이그레이션이 재귀 없는 형태로 재정의).
DROP FUNCTION IF EXISTS public.is_company_admin();
