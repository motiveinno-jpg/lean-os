-- Migration: leave_accrual_start_date
-- 연차 자동 부여에 '도입일(컷오버)' 도입 (2026-07-30 사장님: "기존 남은 연차를 먼저 입력하고
--   그 다음부터 자동부여를 하자 — 지금은 기존 연차에 자동부여까지 다 더해진다").
--
--   직전 마이그레이션(annual_leave_accrual)은 과거 응당일까지 소급 생성해서, 관리자가 이미 손으로
--   맞춰둔 잔여 연차 위에 지난 달 발생분이 또 얹혔다(정다정 8일 + 5/8·6/8·7/8 = 11일).
--   회사가 오너뷰를 쓰기 시작한 시점의 잔여 연차는 이미 '현재 상태'이므로, 그 이전 발생분을
--   다시 만들면 안 된다.
--
--   → 회사별 도입일(leave_accrual_start_date) 이후에 도래하는 응당일만 자동 부여한다.
--     · 설정이 없으면 회사 생성일(companies.created_at) — 신규 회사는 가입 후 발생분만 쌓인다.
--     · 기존 4개 회사는 이 마이그레이션 시점(2026-07-30)으로 명시 기록.
--   도입일 이전의 연차는 직원별 '총 부여일수'로 입력해 두면 그대로 유지된다(base 발생).

-- ── 회사별 자동 부여 도입일 ──
CREATE OR REPLACE FUNCTION public.leave_accrual_start_date(p_company_id uuid)
RETURNS date
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT NULLIF(cs.settings->>'leave_accrual_start_date', '')::date
       FROM company_settings cs WHERE cs.company_id = p_company_id),
    (SELECT c.created_at::date FROM companies c WHERE c.id = p_company_id),
    CURRENT_DATE);
$$;

-- ── 월 1일 발생 — 도입일 이후 응당일만 ──
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
           COALESCE(
             (SELECT cs.settings->>'monthly_leave_accrual_basis'
                FROM company_settings cs WHERE cs.company_id = e.company_id),
             'hire') AS basis,
           public.leave_accrual_start_date(e.company_id) AS start_date
    FROM employees e
    WHERE (p_company_id IS NULL OR e.company_id = p_company_id)
      AND e.hire_date IS NOT NULL
      AND COALESCE(e.status, 'active') NOT IN ('inactive', 'resigned', 'terminated')
      AND e.hire_date > (v_today - INTERVAL '1 year')   -- 1년 미만 근속자만
      AND public.leave_accrual_enabled(e.company_id)
  LOOP
    FOR n IN 1..11 LOOP
      IF r.basis = 'fiscal' THEN
        v_date := (date_trunc('month', r.hire_date::timestamp) + (n || ' months')::interval)::date;
      ELSE
        v_date := (r.hire_date + (n || ' months')::interval)::date;
      END IF;

      -- 미래분·1주년 이후분은 만들지 않는다 (날짜가 단조증가하므로 여기서 종료)
      EXIT WHEN v_date > v_today OR v_date >= (r.hire_date + INTERVAL '1 year')::date;

      -- 도입일 이전 발생분은 건너뛴다 — 그 시점 잔여는 관리자가 입력한 값이 정답이다.
      CONTINUE WHEN v_date < r.start_date;

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

  PERFORM public.sync_leave_balance_totals(p_company_id);
  RETURN v_total;
END;
$$;

-- ── 1주년 법정 부여 — 도입일 이후 응당일만 ──
CREATE OR REPLACE FUNCTION public.generate_annual_leave_grants(p_company_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today   date := (timezone('Asia/Seoul', now()))::date;
  v_year    int  := EXTRACT(YEAR FROM (timezone('Asia/Seoul', now())))::int;
  v_total   int  := 0;
  v_rows    int;
  r         record;
  v_years   int;
  v_anniv   date;
  v_days    int;
BEGIN
  FOR r IN
    SELECT e.id AS employee_id, e.company_id, e.hire_date,
           public.leave_accrual_start_date(e.company_id) AS start_date
    FROM employees e
    WHERE (p_company_id IS NULL OR e.company_id = p_company_id)
      AND e.hire_date IS NOT NULL
      AND COALESCE(e.status, 'active') NOT IN ('inactive', 'resigned', 'terminated')
      AND public.leave_accrual_enabled(e.company_id)
  LOOP
    v_years := v_year - EXTRACT(YEAR FROM r.hire_date)::int;
    CONTINUE WHEN v_years < 1;

    v_anniv := (r.hire_date + (v_years || ' years')::interval)::date;
    CONTINUE WHEN v_anniv > v_today;
    CONTINUE WHEN v_anniv < r.start_date;   -- 도입일 이전 응당일은 이미 반영된 것으로 본다

    v_days := public.statutory_annual_leave_days(v_years);
    CONTINUE WHEN v_days <= 0;

    -- 그 해 수동 부여(base)가 있으면 중복이므로 생략
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM leave_grants g
      WHERE g.employee_id = r.employee_id AND g.year = v_year AND g.grant_type = 'base'
    );

    INSERT INTO leave_grants (company_id, employee_id, year, grant_date, days, grant_type, memo)
    SELECT r.company_id, r.employee_id, v_year, v_anniv, v_days, 'annual',
           v_years || '년차 법정 연차 자동 부여'
    WHERE NOT EXISTS (
      SELECT 1 FROM leave_grants g
      WHERE g.employee_id = r.employee_id AND g.grant_date = v_anniv AND g.grant_type = 'annual'
    );
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_total := v_total + v_rows;
  END LOOP;

  PERFORM public.sync_leave_balance_totals(p_company_id);
  RETURN v_total;
END;
$$;

REVOKE ALL ON FUNCTION public.leave_accrual_start_date(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leave_accrual_start_date(uuid) TO authenticated;

-- ── 기존 회사는 도입일을 오늘로 명시 (설정 없는 회사는 생성일이 기본이라 소급될 수 있음) ──
INSERT INTO company_settings (company_id, settings)
SELECT c.id, jsonb_build_object('leave_accrual_start_date', '2026-07-30')
FROM companies c
ON CONFLICT (company_id) DO UPDATE
SET settings = company_settings.settings
              || jsonb_build_object('leave_accrual_start_date',
                   COALESCE(company_settings.settings->>'leave_accrual_start_date', '2026-07-30'));

-- ── 도입일 이전에 잘못 생성된 자동 발생분 회수 + 총부여 재동기화 ──
--   (직전 마이그레이션 실행분: 월 발생 14건. 관리자가 입력한 base 는 건드리지 않는다.)
DELETE FROM leave_grants g
WHERE g.grant_type IN ('monthly', 'annual')
  AND g.grant_date < public.leave_accrual_start_date(g.company_id);

SELECT public.sync_leave_balance_totals(NULL);
