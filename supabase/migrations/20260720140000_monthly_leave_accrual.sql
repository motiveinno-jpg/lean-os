-- Migration: monthly_leave_accrual
-- 1년 미만 근속자 월 1일 연차 자동 발생 (근로기준법 60조 2항).
--   회사별 on/off + 기준(입사일 / 회계연도)은 company_settings.settings JSONB 에 저장:
--     monthly_leave_accrual_enabled: 'true' | 'false'
--     monthly_leave_accrual_basis:   'hire' | 'fiscal'
--   · hire   — 입사 응당일마다 (예: 3/15 입사 → 4/15, 5/15 …)
--   · fiscal — 입사 다음 달부터 매월 1일
--   최대 11건(1주년 전까지). 이미 있는 날짜는 건너뛰어 멱등.

CREATE OR REPLACE FUNCTION public.generate_monthly_leave_grants(p_company_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today   date := (timezone('Asia/Seoul', now()))::date;
  v_total   int  := 0;
  v_rows    int;
  r         record;
  n         int;
  v_date    date;
BEGIN
  FOR r IN
    SELECT e.id AS employee_id, e.company_id, e.hire_date,
           COALESCE(cs.settings->>'monthly_leave_accrual_basis', 'hire') AS basis
    FROM employees e
    JOIN company_settings cs ON cs.company_id = e.company_id
    WHERE (cs.settings->>'monthly_leave_accrual_enabled') = 'true'
      AND (p_company_id IS NULL OR e.company_id = p_company_id)
      AND e.hire_date IS NOT NULL
      AND COALESCE(e.status, 'active') <> 'inactive'
      AND e.hire_date > (v_today - INTERVAL '1 year')   -- 1년 미만 근속자만
  LOOP
    FOR n IN 1..11 LOOP
      IF r.basis = 'fiscal' THEN
        -- 입사월의 1일 + n개월 = 입사 다음 달부터 매월 1일
        v_date := (date_trunc('month', r.hire_date::timestamp) + (n || ' months')::interval)::date;
      ELSE
        v_date := (r.hire_date + (n || ' months')::interval)::date;
      END IF;

      -- 미래분·1주년 이후분은 만들지 않는다 (날짜가 단조증가하므로 여기서 종료)
      EXIT WHEN v_date > v_today OR v_date >= (r.hire_date + INTERVAL '1 year')::date;

      INSERT INTO leave_grants (company_id, employee_id, year, grant_date, days, grant_type, memo)
      SELECT r.company_id, r.employee_id, EXTRACT(YEAR FROM v_date)::int, v_date, 1, 'monthly', '1개월 만근 자동 발생'
      WHERE NOT EXISTS (
        SELECT 1 FROM leave_grants g
        WHERE g.employee_id = r.employee_id AND g.grant_date = v_date AND g.grant_type = 'monthly'
      );
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      v_total := v_total + v_rows;
    END LOOP;
  END LOOP;

  -- total_days 재동기화 — 총 부여일수의 단일 출처는 leave_grants 합계(앱 레이어와 동일 규칙).
  --   자동 발생을 켠 회사에 한정해 다른 회사 데이터는 건드리지 않는다.
  INSERT INTO leave_balances (company_id, employee_id, year, total_days, used_days)
  SELECT g.company_id, g.employee_id, g.year, SUM(g.days), 0
  FROM leave_grants g
  WHERE (p_company_id IS NULL OR g.company_id = p_company_id)
    AND g.company_id IN (
      SELECT company_id FROM company_settings WHERE (settings->>'monthly_leave_accrual_enabled') = 'true'
    )
  GROUP BY g.company_id, g.employee_id, g.year
  ON CONFLICT (employee_id, year) DO UPDATE SET total_days = EXCLUDED.total_days;

  RETURN v_total;
END;
$$;

-- 자동 실행 전용 — 클라이언트에서 직접 호출 금지(회사 지정 우회 방지)
REVOKE ALL ON FUNCTION public.generate_monthly_leave_grants(uuid) FROM PUBLIC, anon, authenticated;

-- 관리자용 "지금 반영" — 항상 호출자 본인 회사만, owner/admin 만.
CREATE OR REPLACE FUNCTION public.sync_my_monthly_leave_grants()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company uuid;
  v_role    text;
BEGIN
  SELECT company_id, role INTO v_company, v_role FROM users WHERE id = auth.uid();
  IF v_company IS NULL OR v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION '권한이 없습니다';
  END IF;
  RETURN public.generate_monthly_leave_grants(v_company);
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_my_monthly_leave_grants() TO authenticated;

-- 매일 KST 00:10 (UTC 15:10) — 입사 응당일이 매달 아무 날이나 될 수 있어 일 단위로 확인
SELECT cron.unschedule('monthly-leave-accrual')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'monthly-leave-accrual');

SELECT cron.schedule('monthly-leave-accrual', '10 15 * * *', $cron$SELECT public.generate_monthly_leave_grants()$cron$);
