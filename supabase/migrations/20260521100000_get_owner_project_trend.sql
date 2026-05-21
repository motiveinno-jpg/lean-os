-- 2026-05-21 대표 대시보드 '프로젝트 추이' — 월/분기/년 단위 토글
-- 별도 RPC로 분리(기존 get_owner_dashboard_summary 본문 미접촉). 페이로드 부담 분리.
-- is_company_admin() 가드 + RLS 무관(SECDEF, search_path public).

CREATE OR REPLACE FUNCTION get_owner_project_trend(p_period text DEFAULT 'quarter')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
  v_today date := current_date;
  v_result jsonb;
BEGIN
  IF NOT is_company_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT get_my_company_id() INTO v_company_id;
  IF v_company_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  IF p_period NOT IN ('month', 'quarter', 'year') THEN
    p_period := 'quarter';
  END IF;

  WITH
  base_deals AS (
    SELECT d.id, d.stage, d.contract_total, d.archived_at
    FROM deals d
    WHERE d.company_id = v_company_id
  ),
  rev_by_deal AS (
    SELECT
      r.deal_id,
      SUM(CASE WHEN r.status = 'paid' THEN COALESCE(r.amount, 0) ELSE 0 END) AS paid_total,
      MAX(r.received_at) FILTER (WHERE r.status = 'paid') AS last_paid_at
    FROM deal_revenue_schedule r
    WHERE r.deal_id IN (SELECT id FROM base_deals)
    GROUP BY r.deal_id
  ),
  cost_by_deal AS (
    SELECT
      COALESCE(dn.deal_id, sd.parent_deal_id) AS deal_id,
      SUM(COALESCE(dcs.amount, 0)) AS cost_total
    FROM deal_cost_schedule dcs
    LEFT JOIN deal_nodes dn ON dn.id = dcs.deal_node_id
    LEFT JOIN sub_deals sd ON sd.id = dcs.sub_deal_id
    WHERE dcs.company_id = v_company_id
      AND COALESCE(dn.deal_id, sd.parent_deal_id) IS NOT NULL
    GROUP BY COALESCE(dn.deal_id, sd.parent_deal_id)
  ),
  deal_pnl AS (
    SELECT
      bd.id AS deal_id,
      bd.stage,
      bd.archived_at,
      COALESCE(rev.paid_total, 0) AS paid_total,
      rev.last_paid_at,
      COALESCE(c.cost_total, 0) AS cost_total,
      COALESCE(rev.paid_total, 0) - COALESCE(c.cost_total, 0) AS profit
    FROM base_deals bd
    LEFT JOIN rev_by_deal rev ON rev.deal_id = bd.id
    LEFT JOIN cost_by_deal c ON c.deal_id = bd.id
  ),
  -- 기간 축 — period 에 따라 동적 생성
  axis AS (
    SELECT
      CASE p_period
        WHEN 'month'   THEN (date_trunc('month',   v_today) - (offs * INTERVAL '1 month'))::date
        WHEN 'year'    THEN (date_trunc('year',    v_today) - (offs * INTERVAL '1 year'))::date
        ELSE                (date_trunc('quarter', v_today) - (offs * INTERVAL '3 months'))::date
      END AS p_start,
      CASE p_period
        WHEN 'month'   THEN (date_trunc('month',   v_today) - (offs * INTERVAL '1 month')  + INTERVAL '1 month - 1 day')::date
        WHEN 'year'    THEN (date_trunc('year',    v_today) - (offs * INTERVAL '1 year')   + INTERVAL '1 year - 1 day')::date
        ELSE                (date_trunc('quarter', v_today) - (offs * INTERVAL '3 months') + INTERVAL '3 months - 1 day')::date
      END AS p_end
    FROM generate_series(
      0,
      CASE p_period WHEN 'month' THEN 11 WHEN 'year' THEN 3 ELSE 3 END
    ) AS offs
  ),
  trend AS (
    SELECT
      CASE p_period
        WHEN 'month' THEN to_char(ax.p_start, 'YY.MM')
        WHEN 'year'  THEN to_char(ax.p_start, 'YYYY')
        ELSE              to_char(ax.p_start, 'YYYY "Q"Q')
      END AS label,
      ax.p_start,
      ax.p_end,
      COUNT(DISTINCT dp.deal_id) FILTER (
        WHERE dp.stage IN ('completed','settlement')
          AND COALESCE(dp.archived_at::date, dp.last_paid_at::date) BETWEEN ax.p_start AND ax.p_end
      ) AS done_count,
      COALESCE(SUM(
        CASE WHEN dp.last_paid_at::date BETWEEN ax.p_start AND ax.p_end THEN dp.paid_total ELSE 0 END
      ), 0) AS revenue,
      COALESCE(SUM(
        CASE WHEN dp.last_paid_at::date BETWEEN ax.p_start AND ax.p_end THEN dp.profit ELSE 0 END
      ), 0) AS profit
    FROM axis ax
    LEFT JOIN deal_pnl dp ON TRUE
    GROUP BY ax.p_start, ax.p_end
    ORDER BY ax.p_start ASC
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'label', label,
    'p_start', p_start,
    'p_end', p_end,
    'done_count', done_count,
    'revenue', revenue,
    'profit', profit
  )), '[]'::jsonb)
  INTO v_result
  FROM trend;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION get_owner_project_trend(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_owner_project_trend(text) TO authenticated;

COMMENT ON FUNCTION get_owner_project_trend(text) IS
  '대표 대시보드 ''프로젝트 추이'' — 월(최근12)/분기(최근4)/년(최근4) 단위 done_count/revenue/profit 집계. is_company_admin() 게이트.';
