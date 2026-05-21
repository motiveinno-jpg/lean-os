-- OP-C: 운영자 재무 평균/중앙값 RPC
-- monthly_financials (YYYY-MM, revenue/income/expense/fixed/variable/net_cashflow/bank_balance) 기반.
-- p_month 미지정 시 최신 월 자동.
-- 게이트: is_platform_operator() — OP-A 헬퍼 재사용.

CREATE OR REPLACE FUNCTION public.operator_financial_averages(p_month text DEFAULT NULL)
RETURNS TABLE (
  metric text,
  label text,
  avg_value numeric,
  median_value numeric,
  p25_value numeric,
  p75_value numeric,
  min_value numeric,
  max_value numeric,
  stddev_value numeric,
  sample_size integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_month text;
BEGIN
  IF NOT public.is_platform_operator() THEN
    RAISE EXCEPTION 'platform operator only' USING ERRCODE = '42501';
  END IF;

  -- 인자 없으면 monthly_financials 의 최신 월
  IF p_month IS NULL OR p_month = '' THEN
    SELECT max(month) INTO v_month FROM monthly_financials;
  ELSE
    v_month := p_month;
  END IF;

  IF v_month IS NULL THEN
    RETURN; -- 데이터 0건
  END IF;

  RETURN QUERY
  WITH metrics AS (
    SELECT 'revenue'::text AS m, '매출 (revenue)'::text AS l, revenue AS v FROM monthly_financials WHERE month = v_month
    UNION ALL
    SELECT 'total_income', '총수입', total_income FROM monthly_financials WHERE month = v_month
    UNION ALL
    SELECT 'total_expense', '총지출', total_expense FROM monthly_financials WHERE month = v_month
    UNION ALL
    SELECT 'fixed_cost', '고정비', fixed_cost FROM monthly_financials WHERE month = v_month
    UNION ALL
    SELECT 'variable_cost', '변동비', variable_cost FROM monthly_financials WHERE month = v_month
    UNION ALL
    SELECT 'net_cashflow', '순현금흐름', net_cashflow FROM monthly_financials WHERE month = v_month
    UNION ALL
    SELECT 'bank_balance', '월말 통장잔액', bank_balance FROM monthly_financials WHERE month = v_month
  )
  SELECT
    m AS metric,
    max(l) AS label,
    avg(v)::numeric AS avg_value,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY v)::numeric AS median_value,
    percentile_cont(0.25) WITHIN GROUP (ORDER BY v)::numeric AS p25_value,
    percentile_cont(0.75) WITHIN GROUP (ORDER BY v)::numeric AS p75_value,
    min(v)::numeric AS min_value,
    max(v)::numeric AS max_value,
    stddev_samp(v)::numeric AS stddev_value,
    count(v)::integer AS sample_size
  FROM metrics
  WHERE v IS NOT NULL
  GROUP BY m
  ORDER BY array_position(
    ARRAY['revenue','total_income','total_expense','fixed_cost','variable_cost','net_cashflow','bank_balance']::text[],
    m
  );
END;
$$;

REVOKE ALL ON FUNCTION public.operator_financial_averages(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.operator_financial_averages(text) TO authenticated;

COMMENT ON FUNCTION public.operator_financial_averages(text) IS
  'OP-C: 전체 회사 월별 재무 평균/중앙값/사분위. p_month NULL 시 최신 월 자동.';

-- 사용 가능한 월 목록 (드롭다운용)
CREATE OR REPLACE FUNCTION public.operator_financial_months()
RETURNS TABLE (month text, company_count integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_platform_operator() THEN
    RAISE EXCEPTION 'platform operator only' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT mf.month, count(DISTINCT mf.company_id)::integer AS company_count
  FROM monthly_financials mf
  GROUP BY mf.month
  ORDER BY mf.month DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.operator_financial_months() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.operator_financial_months() TO authenticated;

NOTIFY pgrst, 'reload schema';
