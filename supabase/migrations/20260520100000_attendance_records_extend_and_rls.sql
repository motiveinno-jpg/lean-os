-- L 근태: attendance_records 컬럼 확장 + RLS 강화 (직원 동료 수정 금지).
ALTER TABLE public.attendance_records
  ADD COLUMN IF NOT EXISTS attendance_type text DEFAULT 'normal'
    CHECK (attendance_type IN ('normal','field_work','on_duty','remote','business_trip')),
  ADD COLUMN IF NOT EXISTS is_late boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS late_minutes int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS regular_minutes int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS overtime_minutes int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS night_minutes int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS holiday_minutes int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_holiday boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS note text,
  ADD COLUMN IF NOT EXISTS edited_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS edited_at timestamptz;

-- 인덱스 (멱등)
CREATE INDEX IF NOT EXISTS idx_attendance_records_company_date
  ON public.attendance_records (company_id, date);
-- UNIQUE 시도 — 중복 행 있으면 conflict, 그땐 일반 인덱스 fallback
DO $$
BEGIN
  BEGIN
    CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_records_company_emp_date
      ON public.attendance_records (company_id, employee_id, date);
  EXCEPTION WHEN unique_violation OR duplicate_table THEN
    -- 중복 데이터가 있어 UNIQUE 못 만들면 일반 인덱스로 대체
    CREATE INDEX IF NOT EXISTS idx_attendance_records_company_emp_date
      ON public.attendance_records (company_id, employee_id, date);
  END;
END $$;

-- RLS 강화 — 기존 PERMISSIVE 회사격리 유지, RESTRICTIVE 본인격리 추가.
-- 직원이 동료 출퇴근 SELECT/UPDATE/DELETE 가능했던 갭 차단.
-- 비재귀 게이트 준수: SECURITY DEFINER 헬퍼만 사용 (재귀 0).

DROP POLICY IF EXISTS attendance_records_select_self_or_admin ON public.attendance_records;
CREATE POLICY attendance_records_select_self_or_admin ON public.attendance_records
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (is_company_admin() OR employee_id = current_employee_id());

DROP POLICY IF EXISTS attendance_records_insert_self_or_admin ON public.attendance_records;
CREATE POLICY attendance_records_insert_self_or_admin ON public.attendance_records
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (is_company_admin() OR employee_id = current_employee_id());

DROP POLICY IF EXISTS attendance_records_update_admin ON public.attendance_records;
CREATE POLICY attendance_records_update_admin ON public.attendance_records
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (is_company_admin())
  WITH CHECK (is_company_admin());

DROP POLICY IF EXISTS attendance_records_delete_admin ON public.attendance_records;
CREATE POLICY attendance_records_delete_admin ON public.attendance_records
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (is_company_admin());

-- 수정요청 테이블
CREATE TABLE IF NOT EXISTS public.attendance_edit_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  attendance_record_id uuid NOT NULL REFERENCES public.attendance_records(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  requested_changes jsonb NOT NULL, -- { check_in?: ts, check_out?: ts, attendance_type?, note? }
  reason text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_by uuid REFERENCES public.users(id),
  reviewed_at timestamptz,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_attendance_edit_requests_company_status
  ON public.attendance_edit_requests (company_id, status);

ALTER TABLE public.attendance_edit_requests ENABLE ROW LEVEL SECURITY;

-- 본인이 만든 요청 + 관리자가 회사 전체 SELECT
DROP POLICY IF EXISTS aer_select ON public.attendance_edit_requests;
CREATE POLICY aer_select ON public.attendance_edit_requests
  FOR SELECT TO authenticated
  USING (
    company_id = get_my_company_id()
    AND (is_company_admin() OR requested_by = current_app_user_id())
  );

-- 본인만 INSERT
DROP POLICY IF EXISTS aer_insert ON public.attendance_edit_requests;
CREATE POLICY aer_insert ON public.attendance_edit_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = get_my_company_id()
    AND requested_by = current_app_user_id()
  );

-- 관리자만 status UPDATE
DROP POLICY IF EXISTS aer_update_admin ON public.attendance_edit_requests;
CREATE POLICY aer_update_admin ON public.attendance_edit_requests
  FOR UPDATE TO authenticated
  USING (is_company_admin() AND company_id = get_my_company_id())
  WITH CHECK (is_company_admin() AND company_id = get_my_company_id());

COMMENT ON TABLE public.attendance_edit_requests IS 'L 근태: 직원이 본인 attendance_records 수정 요청. 직접 UPDATE 금지, 관리자 승인 후 반영.';
