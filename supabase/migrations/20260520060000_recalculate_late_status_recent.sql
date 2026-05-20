-- Migration: recalculate_late_status_recent
-- Version: 20260520060000
-- Purpose: 회사별 출근 기준 (company_settings.settings JSONB 의 work_start_time / late_threshold_minutes)
--          에 따라 최근 N일 attendance_records.status 를 재산정한다.
--          함수 생성만 한다 — 호출은 사용자가 명시적으로 결정 (자동 실행 X).
--          기본 정책(미설정) 9:00 + 30분 grace 는 기존 동작과 동일하므로 무회귀.
--
-- 호출 예시 (수동):
--   SELECT recalculate_late_status_recent(30);                    -- 모든 회사
--   SELECT recalculate_late_status_recent(30, '<company-uuid>');  -- 단일 회사
--
-- 주의:
--   - status 가 'absent'/'half_day'/'remote' 인 레코드는 건드리지 않는다 (present/late 사이만 토글)
--   - check_in 이 NULL 인 레코드는 건드리지 않는다
--   - KST(Asia/Seoul) 기준으로 비교

CREATE OR REPLACE FUNCTION recalculate_late_status_recent(
  p_days int DEFAULT 30,
  p_company_id uuid DEFAULT NULL
)
RETURNS TABLE (
  updated_count bigint,
  promoted_to_late bigint,
  demoted_to_present bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff date := (current_date - GREATEST(p_days, 0));
  v_updated bigint := 0;
  v_to_late bigint := 0;
  v_to_present bigint := 0;
BEGIN
  IF p_days IS NULL OR p_days <= 0 THEN
    RAISE EXCEPTION 'p_days must be > 0';
  END IF;

  -- 정책: company_settings.settings ->> 'work_start_time' (HH:MM, default '09:00')
  --       company_settings.settings ->> 'late_threshold_minutes' (int, default 30)
  -- 회사별 정책 결합 후 KST 분 단위 비교

  WITH policy AS (
    SELECT
      c.id AS company_id,
      COALESCE(
        NULLIF(cs.settings ->> 'work_start_time', ''),
        '09:00'
      ) AS work_start_time,
      COALESCE(
        NULLIF(cs.settings ->> 'late_threshold_minutes', '')::int,
        30
      ) AS late_threshold_minutes
    FROM companies c
    LEFT JOIN company_settings cs ON cs.company_id = c.id
    WHERE p_company_id IS NULL OR c.id = p_company_id
  ),
  target AS (
    SELECT
      ar.id,
      ar.status AS old_status,
      CASE
        WHEN (
          EXTRACT(HOUR   FROM (ar.check_in AT TIME ZONE 'Asia/Seoul')) * 60
        + EXTRACT(MINUTE FROM (ar.check_in AT TIME ZONE 'Asia/Seoul'))
        ) > (
          (split_part(p.work_start_time, ':', 1))::int * 60
        + (split_part(p.work_start_time, ':', 2))::int
        + p.late_threshold_minutes
        ) THEN 'late'
        ELSE 'present'
      END AS new_status
    FROM attendance_records ar
    JOIN policy p ON p.company_id = ar.company_id
    WHERE ar.check_in IS NOT NULL
      AND ar.date >= v_cutoff
      AND ar.status IN ('present', 'late')   -- absent/half_day/remote 은 보존
  ),
  upd AS (
    UPDATE attendance_records ar
       SET status = t.new_status
      FROM target t
     WHERE ar.id = t.id
       AND ar.status <> t.new_status
    RETURNING t.old_status, t.new_status
  )
  SELECT
    COUNT(*)::bigint,
    COUNT(*) FILTER (WHERE new_status = 'late')::bigint,
    COUNT(*) FILTER (WHERE new_status = 'present')::bigint
  INTO v_updated, v_to_late, v_to_present
  FROM upd;

  updated_count := v_updated;
  promoted_to_late := v_to_late;
  demoted_to_present := v_to_present;
  RETURN NEXT;
END;
$$;

-- 권한: 운영자만 (서비스 롤 또는 owner) 직접 호출. 일반 직원에게 grant 안 함.
REVOKE ALL ON FUNCTION recalculate_late_status_recent(int, uuid) FROM PUBLIC;
-- (호출은 service_role 키 또는 DB 콘솔에서 — 사용자 결정 시 명시적으로 GRANT)

COMMENT ON FUNCTION recalculate_late_status_recent(int, uuid) IS
  'F2-지각판정: 최근 N일 attendance_records.status 를 회사 정책 기준으로 재산정. 호출은 운영자가 명시적으로. absent/half_day/remote 보존.';
