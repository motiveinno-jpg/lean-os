-- 회귀픽스: checkIn chain 의 attendance_records UPDATE 가 employee 컨텍스트에서
--   RESTRICTIVE UPDATE (admin only) 에 거부됨 → is_late/late_minutes 영영 0.
--   진단(2026-05-20 인시던트 직후): 회계담당자 09:34 출근, 회사 09:30 정책 →
--   late 4분이어야 하는데 is_late=false. admin 권순철은 11:05 출근 → 정상 95분.
--
-- 해결: SECURITY DEFINER RPC 로 본인 행 late 컬럼만 UPDATE 허용 (admin 권한 우회).
--   - 본인 employee_id 인지 검증 (employees.user_id = current_app_user_id())
--   - admin 도 같은 RPC 사용 가능 (일관성)
--   - 다른 컬럼 (check_in, check_out, status 등) 은 변경 안 함 — 잘못된 권한 확대 0
--   - is_late, late_minutes, is_holiday 만 UPDATE
--
-- 신규 헬퍼 X — 기존 current_app_user_id() / is_company_admin() 재사용.

CREATE OR REPLACE FUNCTION public.mark_attendance_late(
  p_employee_id uuid,
  p_date date,
  p_is_late boolean,
  p_late_minutes int,
  p_is_holiday boolean DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid := current_app_user_id();
  v_employee_user uuid;
  v_company uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  -- 권한: 본인 직원 행 또는 admin
  SELECT e.user_id, e.company_id INTO v_employee_user, v_company
  FROM employees e WHERE e.id = p_employee_id;
  IF v_employee_user IS NULL THEN
    RAISE EXCEPTION 'employee not found';
  END IF;
  IF v_user_id != v_employee_user AND NOT is_company_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- 회사격리 추가 가드 (admin 이라도 다른 회사 행 못 건드림)
  IF NOT is_company_admin() AND v_company != get_my_company_id() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- late 컬럼만 UPDATE — 다른 컬럼 무수정
  UPDATE attendance_records
  SET is_late = p_is_late,
      late_minutes = COALESCE(p_late_minutes, 0),
      is_holiday = COALESCE(p_is_holiday, is_holiday)
  WHERE employee_id = p_employee_id
    AND date = p_date;

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_attendance_late(uuid, date, boolean, int, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_attendance_late(uuid, date, boolean, int, boolean) TO authenticated;

COMMENT ON FUNCTION public.mark_attendance_late IS
  '회귀픽스: checkIn chain 의 본인 행 late 컬럼 UPDATE. employee 가 admin only UPDATE 정책 우회. is_late/late_minutes/is_holiday 만 변경.';
