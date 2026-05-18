-- Migration: company_directory_rpc
--
-- 회귀 해소 (commit 40ed4de / 20260518190000_restrict_salary_card_select_by_role):
--   employees 에 RESTRICTIVE FOR SELECT 정책이 추가되면서 owner/admin 이 아닌
--   employee/partner 는 본인 1행만 SELECT 가능해졌다. 이 보안 보완은 타인
--   급여·민감정보 직접조회 차단이 목적이라 유지해야 하지만, 그 결과로
--   /team(사내 구성원 디렉토리, employee 허용 화면)이 employee 계정에서
--   "총 1명"으로 깨졌다 — src/app/(app)/team/page.tsx 가 employees 테이블을
--   직접 select(id,name,department,position,email,phone,status,hire_date) 하기
--   때문.
--
-- 해결 (순수 additive — 함수 신설 + grant 만, 기존 정책/스키마/데이터 무변경):
--   SECURITY DEFINER RPC 를 신설해 디렉토리 수준의 안전 컬럼만, 호출자
--   회사로 한정해 반환한다. SECURITY DEFINER 라 employees RESTRICTIVE SELECT
--   정책을 우회하지만, 함수가 직접:
--     * 회사 격리: company_id = get_my_company_id() (인자 없음 → 회사 위조 불가,
--       서버에서 auth.uid() 기반 결정)
--     * 안전 projection 만: id, name, department, position, email, phone,
--       status, hire_date — salary / retirement_accrual / non_taxable_amount /
--       bank_* / account_number / birth_date / address / emergency_* /
--       saved_signature 등 보수·금융·민감 PII 컬럼은 절대 미반환
--   GRANT EXECUTE 는 authenticated 만(anon 제외). owner/admin/employee/partner
--   모든 사내 역할이 동일한 안전 디렉토리를 본다.
--
-- get_my_company_id() / is_company_owner() / is_company_admin() 와 동일 패턴
-- (STABLE + SECURITY DEFINER + SET search_path = public 로 RLS 재귀/우회 봉인).

CREATE OR REPLACE FUNCTION public.get_company_directory()
RETURNS TABLE (
  id          uuid,
  name        text,
  department  text,
  "position"  text,
  email       text,
  phone       text,
  status      text,
  hire_date   date
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    e.id,
    e.name,
    e.department,
    e."position",
    e.email,
    e.phone,
    e.status,
    e.hire_date
  FROM employees e
  WHERE e.company_id = get_my_company_id()
  ORDER BY e.department NULLS LAST, e.name;
$function$;

-- anon 제외: 로그인 사용자(authenticated)만 호출 가능.
REVOKE ALL ON FUNCTION public.get_company_directory() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_company_directory() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_company_directory() TO authenticated;

COMMENT ON FUNCTION public.get_company_directory() IS
  '사내 구성원 디렉토리(/team). 호출자 회사(get_my_company_id())로 한정, salary 등 민감 컬럼 제외한 안전 projection 만 반환. SECURITY DEFINER — employees RESTRICTIVE SELECT 우회용. authenticated 전용.';
