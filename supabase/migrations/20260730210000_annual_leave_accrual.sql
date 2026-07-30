-- Migration: annual_leave_accrual
-- 연차 자동 부여 완성 (2026-07-30 사장님: "입사 한달 뒤부터 1일씩, 1년 되면 또 부여되게 —
--   지금은 자동이 안 되고 수동으로만 된다").
--   그동안 안 돌던 이유: generate_monthly_leave_grants 가 company_settings 에
--   monthly_leave_accrual_enabled='true' 인 회사만 대상으로 했는데, 그 설정을 켠 회사가 하나도 없었다
--   (INNER JOIN 이라 설정 행 자체가 없는 회사는 애초에 후보에서 빠졌다).
--
--   1) 기본값을 '켬' 으로 — 설정에 'false' 로 명시한 회사만 제외 (leave_accrual_enabled()).
--   2) 1주년부터 근속연수별 법정 연차 자동 부여 (근로기준법 60조):
--        1~2년 15일 / 3년 이상은 최초 1년 초과 매 2년마다 +1일 / 상한 25일.
--      올해 도래한 응당일만 생성 — 지난 연도는 소급하지 않는다(이미 정산·소멸된 연차를 되살리지 않기 위해).
--   3) 수동 부여(base)는 그대로 두고 자동분을 그 위에 더한다 (사장님 확정).
--      → leave_balances.total_days = 해당 연도 leave_grants 합계 라는 기존 단일 출처 규칙 유지.
--      단, 1주년 부여는 그 해 수동 부여(base)와 성격이 겹쳐(수동 16일 + 자동 16일 = 32일) 중복이므로,
--      해당 연도에 수동 부여가 있으면 1주년 자동 부여는 생략한다 (사장님 확정 — 수동 설정한 해는 수동 존중,
--      수동 설정이 없는 다음 응당일부터 자동). 월 발생은 겹치지 않으므로 그대로 더한다.
--   4) 퇴사자 제외 범위 교정 — 기존엔 status='inactive' 만 걸러 'resigned'(퇴사)·'terminated' 는
--      계속 연차가 쌓였다.

-- ── grant_type 에 'annual'(1주년 이상 법정 부여) 추가 ──
ALTER TABLE leave_grants DROP CONSTRAINT IF EXISTS leave_grants_grant_type_check;
ALTER TABLE leave_grants ADD CONSTRAINT leave_grants_grant_type_check
  CHECK (grant_type IN ('base','monthly','annual','carryover','adjustment'));

-- ── 회사별 자동 발생 사용 여부 — 설정 행이 없거나 키가 없으면 '켬' 이 기본 ──
CREATE OR REPLACE FUNCTION public.leave_accrual_enabled(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT cs.settings->>'monthly_leave_accrual_enabled'
       FROM company_settings cs WHERE cs.company_id = p_company_id),
    'true') <> 'false';
$$;

-- ── 근속연수별 법정 연차일수 (근로기준법 60조 1·4항) ──
--   1년:15, 2년:15, 3~4년:16, 5~6년:17 … 상한 25
CREATE OR REPLACE FUNCTION public.statutory_annual_leave_days(p_years integer)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN p_years < 1 THEN 0 ELSE LEAST(25, 15 + (p_years - 1) / 2) END;
$$;

-- ── leave_balances.total_days 재동기화 — 총 부여일수의 단일 출처는 leave_grants 합계 ──
--   자동 발생을 끈 회사(설정 'false')는 건드리지 않는다.
CREATE OR REPLACE FUNCTION public.sync_leave_balance_totals(p_company_id uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO leave_balances (company_id, employee_id, year, total_days, used_days)
  SELECT g.company_id, g.employee_id, g.year, SUM(g.days), 0
  FROM leave_grants g
  WHERE (p_company_id IS NULL OR g.company_id = p_company_id)
    AND public.leave_accrual_enabled(g.company_id)
  GROUP BY g.company_id, g.employee_id, g.year
  ON CONFLICT (employee_id, year) DO UPDATE SET total_days = EXCLUDED.total_days;
END;
$$;

-- ── 1년 미만 근속자 월 1일 발생 (기존 함수 교체 — 기본값 켬 + 퇴사자 제외 교정) ──
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

  PERFORM public.sync_leave_balance_totals(p_company_id);
  RETURN v_total;
END;
$$;

-- ── 1주년부터 근속연수별 법정 연차 발생 ──
--   올해 도래한 입사 응당일만 대상. 아직 안 온 응당일은 그날 cron 이 만든다.
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

    -- 그 해 수동 부여(base)가 있으면 중복이므로 생략 — 관리자가 직접 정한 해는 그 값을 존중한다.
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

-- ── cron/관리자 단일 진입점 — 월 발생 + 1주년 발생 ──
CREATE OR REPLACE FUNCTION public.generate_leave_accruals(p_company_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.generate_monthly_leave_grants(p_company_id)
       + public.generate_annual_leave_grants(p_company_id);
END;
$$;

-- 자동 실행 전용 — 클라이언트에서 직접 호출 금지(회사 지정 우회 방지)
REVOKE ALL ON FUNCTION public.generate_monthly_leave_grants(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.generate_annual_leave_grants(uuid)  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.generate_leave_accruals(uuid)       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_leave_balance_totals(uuid)     FROM PUBLIC, anon, authenticated;

-- ── 관리자용 "지금 반영" — 항상 호출자 본인 회사만, owner/admin(또는 마스터)만 ──
--   ⚠️ auth.uid() 대조는 users.auth_id 로 한다 (users.id 와 다른 계정이 실제로 존재 —
--      id 로 대조하면 그 계정만 조용히 권한 없음이 된다).
CREATE OR REPLACE FUNCTION public.sync_my_leave_accruals()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company uuid;
  v_role    text;
  v_master  boolean;
BEGIN
  SELECT company_id, role, COALESCE(is_master, false)
    INTO v_company, v_role, v_master
    FROM users WHERE auth_id = auth.uid();
  IF v_company IS NULL OR (v_role NOT IN ('owner', 'admin') AND NOT v_master) THEN
    RAISE EXCEPTION '권한이 없습니다';
  END IF;
  RETURN public.generate_leave_accruals(v_company);
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_my_leave_accruals() TO authenticated;

-- 구버전 이름은 새 진입점으로 위임 (배포 순서상 남아있는 클라이언트 대비)
CREATE OR REPLACE FUNCTION public.sync_my_monthly_leave_grants()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.sync_my_leave_accruals();
$$;

GRANT EXECUTE ON FUNCTION public.sync_my_monthly_leave_grants() TO authenticated;

-- ── 수동으로만 넣어둔 기존 연차를 'base' 발생으로 보존 ──
--   leave_balances 에는 값이 있는데 그 해 leave_grants 가 하나도 없는 직원이 있다
--   (create_leave_grants 백필 이후 수동 설정된 건들). 자동 발생이 켜지면 total_days 가
--   grants 합계로 재동기화되므로, 먼저 base 로 옮겨놔야 수동분이 사라지지 않는다.
INSERT INTO leave_grants (company_id, employee_id, year, grant_date, days, grant_type, memo)
SELECT b.company_id, b.employee_id, b.year, make_date(b.year, 1, 1), b.total_days, 'base', '기존 연차 설정 이관'
FROM leave_balances b
WHERE b.total_days IS NOT NULL
  AND b.total_days <> 0
  AND NOT EXISTS (
    SELECT 1 FROM leave_grants g WHERE g.employee_id = b.employee_id AND g.year = b.year
  );

-- ── cron 재등록 — 매일 KST 00:10 (UTC 15:10), 월 발생 + 1주년 발생 ──
SELECT cron.unschedule('monthly-leave-accrual')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'monthly-leave-accrual');

SELECT cron.unschedule('leave-accrual')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'leave-accrual');

SELECT cron.schedule('leave-accrual', '10 15 * * *', $cron$SELECT public.generate_leave_accruals()$cron$);
