-- 회귀픽스 #2: recomputeAttendance (311fcdba checkOut chain) 도 같은 RLS 회귀.
--   attendance_records.update(분 컬럼들) 가 employee 컨텍스트에서 admin only
--   UPDATE 정책에 거부 → overtime/night/holiday 영영 0 (admin 만 정상).
--
-- 해결: SECURITY DEFINER RPC 로 본인 또는 admin 분 컬럼만 UPDATE 허용.
--   - mark_attendance_late (20260520200000) 의 확장판.
--   - regular/overtime/night/holiday + late 컬럼 모두 갱신.
--   - check_in/check_out/status/note 등 다른 컬럼 무수정 — 권한 확대 0.

CREATE OR REPLACE FUNCTION public.set_attendance_minutes(
  p_record_id uuid,
  p_is_late boolean,
  p_late_minutes int,
  p_regular_minutes int,
  p_overtime_minutes int,
  p_night_minutes int,
  p_holiday_minutes int,
  p_is_holiday boolean
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

  -- 행 조회 + 본인/admin 권한 가드
  SELECT e.user_id, e.company_id INTO v_employee_user, v_company
  FROM attendance_records ar
  JOIN employees e ON e.id = ar.employee_id
  WHERE ar.id = p_record_id;
  IF v_employee_user IS NULL THEN
    RAISE EXCEPTION 'record not found';
  END IF;
  IF v_user_id != v_employee_user AND NOT is_company_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF NOT is_company_admin() AND v_company != get_my_company_id() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  UPDATE attendance_records
  SET is_late = p_is_late,
      late_minutes = COALESCE(p_late_minutes, 0),
      regular_minutes = COALESCE(p_regular_minutes, 0),
      overtime_minutes = COALESCE(p_overtime_minutes, 0),
      night_minutes = COALESCE(p_night_minutes, 0),
      holiday_minutes = COALESCE(p_holiday_minutes, 0),
      is_holiday = COALESCE(p_is_holiday, is_holiday)
  WHERE id = p_record_id;

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.set_attendance_minutes(uuid, boolean, int, int, int, int, int, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_attendance_minutes(uuid, boolean, int, int, int, int, int, boolean) TO authenticated;

COMMENT ON FUNCTION public.set_attendance_minutes IS
  '회귀픽스 #2: recomputeAttendance 의 본인 행 분 컬럼 UPDATE. employee 가 admin only UPDATE 정책 우회.';
