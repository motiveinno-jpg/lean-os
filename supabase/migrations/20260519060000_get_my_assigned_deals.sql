-- Migration: get_my_assigned_deals
--
-- 🎯 목적: 직원 '내 프로젝트' 위젯(B-2) 전용 안전 RPC.
--   직원은 `deals` 를 화면에서만 필터하면 anon/authenticated 키로 전사
--   딜(매출 contract_total·마진·원가) 직접 조회가 가능하다. 현재
--   `deals` RLS = "Company can manage deals" FOR ALL USING(company_id =
--   get_my_company_id()) — 회사 단위 격리뿐, 본인 담당 여부와 무관하게
--   같은 회사 모든 딜 + 모든 컬럼 노출. /leave·payroll_items 와 동일한
--   "화면만 필터 = 누출" 패턴이므로, 순수 UI 필터 금지.
--
-- 해결 (순수 additive — 함수 신설 + grant 만, 기존 정책/스키마/데이터 무변경):
--   SECURITY DEFINER RPC 를 신설해 (1) 호출자 회사로 한정 (2) 본인이
--   manager/reviewer/participant 로 배정됐거나 internal_manager 인 딜만
--   (3) 재무 필드 0 — id, name, status, my_role, created_at 만 반환.
--   contract_total / deal_nodes(revenue_amount·cost) / 마진·확률 등
--   금액성 컬럼은 일절 미반환.
--
-- ── 재귀 회피 (메모리 feedback_rls_recursion_gate · PART A 504 전례) ──────
--   PART A(20260519040000) 로그인 504 전면장애 원인 = 정책/함수 본문의
--   users/employees 인라인 서브쿼리가 호출자 RLS 재진입을 유발한 상호재귀.
--   이 함수는 본문에서 users/employees 를 **인라인 서브쿼리로 참조하지
--   않는다**. "현재 사용자 users.id" 와 "회사 스코프" 는 이미 prod 에 존재
--   하는 검증된 SECURITY DEFINER STABLE 헬퍼만 호출해 얻는다:
--     * current_app_user_id()  (20260519040000 reharden 신설:
--         auth.uid()→users.id, sql STABLE SECURITY DEFINER
--         SET search_path=public — prod 재확인: prosecdef=t, volatile=s,
--         config=search_path=public)
--     * get_my_company_id()    (20260303103954: auth.uid()→users.company_id,
--         동일 패턴 — prod 재확인 동일)
--   두 헬퍼는 함수 소유자(postgres) 권한으로 실행되어 호출자 RLS 를 우회
--   하므로(get_company_directory / is_company_owner 와 동일 검증 패턴),
--   본문이 deals/deal_assignments 만 참조 + users 인라인 서브쿼리 0 →
--   호출자 RLS 재진입 없음 = 비재귀. 또한 이 RPC 는 인증 후 명시 호출
--   (supabase.rpc) 경로 only — 로그인 부트스트랩(getCurrentUser 의
--   SELECT users / SELECT employees) 과 무관해 504 재귀 표면이 없다.
--
-- ── 스키마 근거 (prod 조회로 확정 — 추측 아님) ──────────────────────────
--   deals: company_id, id, name, status, internal_manager_id, created_at
--          (timestamp without time zone) 존재 / stage·updated_at 없음.
--          contract_total·classification 등 재무성 컬럼은 **미반환**.
--   deal_assignments: deal_id, user_id, role, is_active, assigned_at,
--          removed_at, handover_notes, id.
--
-- 멱등: CREATE OR REPLACE FUNCTION. 롤백: DROP FUNCTION
--       public.get_my_assigned_deals();
-- 노출: get_company_directory 와 동일 — anon REVOKE, authenticated GRANT.

-- 적용 안전장치 (20260519040000 와 동일 패턴 — DDL 락 무한대기 방지).
SET lock_timeout = '4000';
SET statement_timeout = '20000';

-- ─────────────────────────────────────────────────────────────────────────
-- get_my_assigned_deals(): 본인 담당 딜의 비재무 안전 projection.
--   본문 = deals / deal_assignments 만 + SECURITY DEFINER 헬퍼 호출.
--   users / employees 인라인 서브쿼리 0 → 비재귀.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_my_assigned_deals()
RETURNS TABLE (
  id          uuid,
  name        text,
  status      text,
  my_role     text,
  created_at  timestamp without time zone
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    d.id,
    d.name,
    d.status,
    COALESCE(
      (SELECT da.role
         FROM deal_assignments da
        WHERE da.deal_id = d.id
          AND da.user_id = current_app_user_id()
          AND da.role IN ('manager', 'reviewer', 'participant')
          AND da.is_active = true
        ORDER BY da.assigned_at DESC
        LIMIT 1),
      CASE WHEN d.internal_manager_id = current_app_user_id()
           THEN 'manager' END
    ) AS my_role,
    d.created_at
  FROM deals d
  WHERE d.company_id = get_my_company_id()
    AND (
      EXISTS (
        SELECT 1
          FROM deal_assignments da
         WHERE da.deal_id = d.id
           AND da.user_id = current_app_user_id()
           AND da.role IN ('manager', 'reviewer', 'participant')
           AND da.is_active = true
      )
      OR d.internal_manager_id = current_app_user_id()
    )
  ORDER BY d.created_at DESC NULLS LAST;
$function$;

-- anon 제외: 로그인 사용자(authenticated)만 호출 가능
-- (get_company_directory 와 동일 노출 정책).
REVOKE ALL ON FUNCTION public.get_my_assigned_deals() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_assigned_deals() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_assigned_deals() TO authenticated;

COMMENT ON FUNCTION public.get_my_assigned_deals() IS
  '직원 ''내 프로젝트'' 위젯(B-2). 호출자 회사(get_my_company_id())의 딜 중 본인이 deal_assignments(manager/reviewer/participant, is_active) 이거나 internal_manager 인 건만, 재무 컬럼 제외(id/name/status/my_role/created_at) 안전 projection. SECURITY DEFINER — deals 회사격리 정책 우회용, 본문 users/employees 인라인 서브쿼리 0(비재귀). authenticated 전용.';
