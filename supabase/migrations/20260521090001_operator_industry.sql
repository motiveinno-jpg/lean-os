-- OP-D: 운영자 업계 분류 + 업계별 분포/평균
-- companies.industry 컬럼은 이미 존재 (1/10 분류됨, 9 미분류).
-- 게이트: is_platform_operator() (OP-A 헬퍼).

-- 1) 미분류 회사 목록 + 분포
CREATE OR REPLACE FUNCTION public.operator_industry_distribution()
RETURNS TABLE (industry text, company_count integer)
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
  SELECT
    COALESCE(NULLIF(c.industry, ''), '(미분류)')::text AS industry,
    count(*)::integer AS company_count
  FROM companies c
  GROUP BY COALESCE(NULLIF(c.industry, ''), '(미분류)')
  ORDER BY count(*) DESC, industry ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.operator_industry_distribution() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.operator_industry_distribution() TO authenticated;

-- 2) 미분류 회사 (분류 UI용)
CREATE OR REPLACE FUNCTION public.operator_unclassified_companies()
RETURNS TABLE (id uuid, name text, business_number text, created_at timestamptz)
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
  SELECT c.id, c.name, c.business_number, c.created_at
  FROM companies c
  WHERE c.industry IS NULL OR c.industry = ''
  ORDER BY c.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.operator_unclassified_companies() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.operator_unclassified_companies() TO authenticated;

-- 3) 업종 update (운영자만)
CREATE OR REPLACE FUNCTION public.operator_set_company_industry(p_company_id uuid, p_industry text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_clean text;
  v_updated jsonb;
BEGIN
  IF NOT public.is_platform_operator() THEN
    RAISE EXCEPTION 'platform operator only' USING ERRCODE = '42501';
  END IF;

  v_clean := NULLIF(btrim(COALESCE(p_industry, '')), '');

  UPDATE companies
  SET industry = v_clean
  WHERE id = p_company_id
  RETURNING jsonb_build_object('id', id, 'name', name, 'industry', industry) INTO v_updated;

  IF v_updated IS NULL THEN
    RAISE EXCEPTION 'company not found' USING ERRCODE = 'P0002';
  END IF;

  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.operator_set_company_industry(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.operator_set_company_industry(uuid, text) TO authenticated;

-- 4) 업계별 월 평균 (특정 업종 1개 또는 NULL=전체)
CREATE OR REPLACE FUNCTION public.operator_financial_averages_by_industry(p_month text DEFAULT NULL, p_industry text DEFAULT NULL)
RETURNS TABLE (
  metric text,
  label text,
  avg_value numeric,
  median_value numeric,
  p25_value numeric,
  p75_value numeric,
  min_value numeric,
  max_value numeric,
  sample_size integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_month text;
  v_ind text;
BEGIN
  IF NOT public.is_platform_operator() THEN
    RAISE EXCEPTION 'platform operator only' USING ERRCODE = '42501';
  END IF;

  IF p_month IS NULL OR p_month = '' THEN
    SELECT max(month) INTO v_month FROM monthly_financials;
  ELSE
    v_month := p_month;
  END IF;
  IF v_month IS NULL THEN RETURN; END IF;

  v_ind := NULLIF(btrim(COALESCE(p_industry, '')), '');

  RETURN QUERY
  WITH joined AS (
    SELECT mf.*
    FROM monthly_financials mf
    JOIN companies c ON c.id = mf.company_id
    WHERE mf.month = v_month
      AND (v_ind IS NULL OR c.industry = v_ind)
  ),
  metrics AS (
    SELECT 'revenue'::text AS m, '매출'::text AS l, revenue AS v FROM joined
    UNION ALL SELECT 'total_income', '총수입', total_income FROM joined
    UNION ALL SELECT 'total_expense', '총지출', total_expense FROM joined
    UNION ALL SELECT 'fixed_cost', '고정비', fixed_cost FROM joined
    UNION ALL SELECT 'variable_cost', '변동비', variable_cost FROM joined
    UNION ALL SELECT 'net_cashflow', '순현금흐름', net_cashflow FROM joined
    UNION ALL SELECT 'bank_balance', '월말 잔액', bank_balance FROM joined
  )
  SELECT
    m,
    max(l),
    avg(v)::numeric,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY v)::numeric,
    percentile_cont(0.25) WITHIN GROUP (ORDER BY v)::numeric,
    percentile_cont(0.75) WITHIN GROUP (ORDER BY v)::numeric,
    min(v)::numeric, max(v)::numeric,
    count(v)::integer
  FROM metrics
  WHERE v IS NOT NULL
  GROUP BY m
  ORDER BY array_position(
    ARRAY['revenue','total_income','total_expense','fixed_cost','variable_cost','net_cashflow','bank_balance']::text[],
    m
  );
END;
$$;

REVOKE ALL ON FUNCTION public.operator_financial_averages_by_industry(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.operator_financial_averages_by_industry(text, text) TO authenticated;

COMMENT ON FUNCTION public.operator_industry_distribution() IS 'OP-D: 업종별 회사 수 분포 (미분류 포함).';
COMMENT ON FUNCTION public.operator_unclassified_companies() IS 'OP-D: 운영자가 분류할 미분류 회사 목록.';
COMMENT ON FUNCTION public.operator_set_company_industry(uuid, text) IS 'OP-D: 운영자가 회사 업종 지정.';
COMMENT ON FUNCTION public.operator_financial_averages_by_industry(text, text) IS 'OP-D: 업종 필터 가능한 월별 재무 평균.';

NOTIFY pgrst, 'reload schema';
