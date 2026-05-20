-- 핸드오프 정공법 (A) — 회기록 본인 UPDATE 차단으로 인한 직원 지각/분 컬럼 0 회귀.
--
-- 진단 (2026-05-20 11:05 KST, 회계담당자 ksc@mo-tive.com 새 출근):
--   - admin_records_update (PERMISSIVE): company_id 매칭 → 통과
--   - attendance_records_update_admin (RESTRICTIVE): is_company_admin() 단독 → 거부
--   ⇒ employee 컨텍스트 UPDATE 42501 silent catch → is_late/regular_minutes 영영 0.
--
-- 해결: RESTRICTIVE UPDATE 정책을 admin 또는 본인(employee) 허용으로 통합.
--   - 비재귀: 본문 인라인 users/employees 서브쿼리 0. SECURITY DEFINER 헬퍼만.
--   - current_employee_id() 는 5/19 reharden 마이그 정의(prosecdef=true) — Q2 확인.
--   - UI 측 직원 편집 폼 0 (시스템 함수만 호출) → 권한 확대 의미 0, 무결성 유지.
--   - DELETE 는 admin only 유지 (편집·삭제는 관리자).
--
-- 직전 SECURITY DEFINER RPC (mark_attendance_late, set_attendance_minutes) 도 그대로 유지 —
--   본 RLS 정책이 안전망, RPC 가 분 컬럼만 좁은 권한 노출(이중 안전).

BEGIN;

-- 기존 admin only RESTRICTIVE 정책 제거
DROP POLICY IF EXISTS "attendance_records_update_admin" ON public.attendance_records;
DROP POLICY IF EXISTS "attendance_records_update_admin_or_self" ON public.attendance_records;

-- 신규: admin 또는 본인 — RESTRICTIVE 로 회사격리(PERMISSIVE)와 AND
CREATE POLICY "attendance_records_update_admin_or_self"
  ON public.attendance_records
  AS RESTRICTIVE
  FOR UPDATE
  TO authenticated
  USING (is_company_admin() OR employee_id = current_employee_id())
  WITH CHECK (is_company_admin() OR employee_id = current_employee_id());

COMMIT;

-- 비재귀 검증 (마이그 이후 0건이어야 함)
-- SELECT polname FROM pg_policy WHERE polrelid='public.attendance_records'::regclass
--   AND (pg_get_expr(polqual, polrelid) ~ '\mFROM\s+(public\.)?(users|employees)\M'
--     OR pg_get_expr(polwithcheck, polrelid) ~ '\mFROM\s+(public\.)?(users|employees)\M');
