-- Migration: leave_accrual_pure_hire_based
-- 연차를 입사일 기준 자동 계산만으로 단순화 (2026-07-30 사장님:
--   "그냥 1년 미만인 사람들은 입사일 기준 한달 만근시 1일씩, 1년 이상인 사람들은 입사일 기준 15개씩.
--    권순철은 연차가 3개여야 되고 하루 써서 2개 남은 걸로 돼야 돼").
--
--   앞서 넣은 '도입일(컷오버)'과 '수동 부여 우선' 규칙을 걷어낸다:
--     · 컷오버(leave_accrual_start_date) 제거 — 입사일부터 도래한 응당일을 전부 생성한다.
--     · 수동 부여(base) 전량 삭제 — 총부여의 정답은 자동 계산분이다.
--     · '그 해 base 가 있으면 1주년 부여 생략' 규칙 제거 — 응당일이 오면 항상 부여한다.
--   관리자가 나중에 '남은 연차'를 직접 고치면 그때 base 발생이 다시 생기고 자동분과 합산된다.
--
--   결과(모티브이노베이션 기준): 권순철(2026-04-10) 5/10·6/10·7/10 = 3일, 사용 1 → 남은 2.
--   1년 넘은 직원은 월 발생 대상에서 빠지므로(1년 미만만) 응당일 15일(3년 이상은 법정 가산)만 남는다.

-- ── 월 1일 발생 — 컷오버 없이 입사일 기준 전부 ──
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
             'hire') AS basis
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

-- ── 1주년 법정 부여 — 컷오버·수동 우선 규칙 없이 응당일마다 ──
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
    SELECT e.id AS employee_id, e.company_id, e.hire_date
    FROM employees e
    WHERE (p_company_id IS NULL OR e.company_id = p_company_id)
      AND e.hire_date IS NOT NULL
      AND COALESCE(e.status, 'active') NOT IN ('inactive', 'resigned', 'terminated')
      AND public.leave_accrual_enabled(e.company_id)
  LOOP
    v_years := v_year - EXTRACT(YEAR FROM r.hire_date)::int;   -- 올해 도래하는 근속연수
    CONTINUE WHEN v_years < 1;

    v_anniv := (r.hire_date + (v_years || ' years')::interval)::date;
    CONTINUE WHEN v_anniv > v_today;

    v_days := public.statutory_annual_leave_days(v_years);
    CONTINUE WHEN v_days <= 0;

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

-- ── 컷오버 설정·함수 제거 ──
UPDATE company_settings SET settings = settings - 'leave_accrual_start_date'
WHERE settings ? 'leave_accrual_start_date';

DROP FUNCTION IF EXISTS public.leave_accrual_start_date(uuid);

-- ── 수동 부여(base) 전량 삭제 — 자동 계산분이 총부여의 정답 ──
DELETE FROM leave_grants WHERE grant_type = 'base';

-- 발생 이력이 하나도 없어진 직원은 총부여 0 (남은 grants 가 없으면 재동기화가 건드리지 않으므로 명시)
UPDATE leave_balances b
SET total_days = 0
WHERE public.leave_accrual_enabled(b.company_id)
  AND b.total_days <> 0
  AND NOT EXISTS (
    SELECT 1 FROM leave_grants g WHERE g.employee_id = b.employee_id AND g.year = b.year
  );

-- ── 입사일 기준으로 전부 재생성 ──
SELECT public.generate_leave_accruals();
