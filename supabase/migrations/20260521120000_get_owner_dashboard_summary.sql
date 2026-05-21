-- 대표 대시보드 종합 RPC — 6 섹션을 한 호출로 묶음.
-- 게이트: is_company_admin() — 직원/파트너 호출 시 NULL.
-- 재귀 금지: get_my_company_id() / is_company_admin() 헬퍼만 사용 (users/employees 인라인 X).

CREATE OR REPLACE FUNCTION public.get_owner_dashboard_summary(
  p_from date DEFAULT NULL,   -- 미지정 시 12개월 전
  p_to   date DEFAULT NULL    -- 미지정 시 오늘
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_company_id uuid;
  v_today date := CURRENT_DATE;
  v_from date;
  v_to date;

  -- 분기 경계
  v_q_start date;
  v_q_end date;
  v_prev_q_start date;
  v_prev_q_end date;
  v_q_label text;
  v_prev_q_label text;

  v_result jsonb;
BEGIN
  -- 1) 게이트
  IF NOT public.is_company_admin() THEN
    RETURN NULL;
  END IF;
  v_company_id := public.get_my_company_id();
  IF v_company_id IS NULL THEN
    RETURN NULL;
  END IF;

  v_from := COALESCE(p_from, (v_today - INTERVAL '12 months')::date);
  v_to   := COALESCE(p_to, v_today);

  -- 2) 분기 경계
  v_q_start := date_trunc('quarter', v_today)::date;
  v_q_end   := (v_q_start + INTERVAL '3 months - 1 day')::date;
  v_prev_q_start := (v_q_start - INTERVAL '3 months')::date;
  v_prev_q_end   := (v_q_start - INTERVAL '1 day')::date;
  v_q_label := to_char(v_q_start, 'YYYY "Q"Q');
  v_prev_q_label := to_char(v_prev_q_start, 'YYYY "Q"Q');

  -- 3) 본 집계 (CTE 묶음 후 한 번에 jsonb 조립)
  WITH
  -- 회사의 모든 활성 deals
  base_deals AS (
    SELECT d.id, d.name, d.stage, d.status, d.contract_total,
           d.partner_id, d.internal_manager_id, d.created_at,
           d.archived_at, d.start_date, d.end_date, d.next_action_text,
           d.custom_scope, d.priority, d.classification
    FROM deals d
    WHERE d.company_id = v_company_id
  ),
  -- deal 별 매출 (paid) 합 + 마지막 paid 시각 (완료 분기 판정용)
  rev_by_deal AS (
    SELECT
      r.deal_id,
      SUM(CASE WHEN r.status = 'paid' THEN COALESCE(r.amount, 0) ELSE 0 END) AS paid_total,
      SUM(CASE WHEN r.status <> 'paid' THEN COALESCE(r.amount, 0) ELSE 0 END) AS unpaid_total,
      MAX(r.received_at) FILTER (WHERE r.status = 'paid') AS last_paid_at
    FROM deal_revenue_schedule r
    WHERE r.deal_id IN (SELECT id FROM base_deals)
    GROUP BY r.deal_id
  ),
  -- deal 별 비용 (deal_cost_schedule via deal_nodes/sub_deals — 중복 없이 COALESCE)
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
  -- deal 별 매출/비용/이윤 평탄화
  deal_pnl AS (
    SELECT
      bd.id AS deal_id,
      bd.stage,
      bd.contract_total,
      bd.archived_at,
      bd.partner_id,
      bd.internal_manager_id,
      COALESCE(rev.paid_total, 0)   AS paid_total,
      COALESCE(rev.unpaid_total, 0) AS unpaid_total,
      rev.last_paid_at,
      COALESCE(c.cost_total, 0)     AS cost_total,
      COALESCE(rev.paid_total, 0) - COALESCE(c.cost_total, 0) AS profit
    FROM base_deals bd
    LEFT JOIN rev_by_deal rev ON rev.deal_id = bd.id
    LEFT JOIN cost_by_deal c   ON c.deal_id   = bd.id
  ),
  -- 분기별 매출/이윤 (last_paid_at 기준 OR archived_at 기준 OR end_date)
  --   "이번 분기 완료/지난 분기 완료" 판정용 = stage IN ('completed','settlement') + COALESCE(archived_at, last_paid_at) IN 분기
  done_in AS (
    SELECT
      deal_id,
      stage,
      contract_total,
      paid_total,
      cost_total,
      profit,
      COALESCE(archived_at::date, last_paid_at::date) AS done_at
    FROM deal_pnl
    WHERE stage IN ('completed','settlement')
  ),
  -- KPI 이번 분기
  kpi_now AS (
    SELECT
      COUNT(*) FILTER (WHERE stage IN ('estimate','contract','in_progress')) AS active_count,
      COUNT(*) FILTER (
        WHERE stage IN ('completed','settlement')
        AND COALESCE(archived_at::date, last_paid_at::date) BETWEEN v_q_start AND v_q_end
      ) AS done_count_q,
      COALESCE(SUM(
        CASE WHEN last_paid_at::date BETWEEN v_q_start AND v_q_end THEN paid_total ELSE 0 END
      ), 0) AS revenue_q,
      COALESCE(SUM(
        CASE WHEN last_paid_at::date BETWEEN v_q_start AND v_q_end THEN profit ELSE 0 END
      ), 0) AS profit_q
    FROM deal_pnl
  ),
  kpi_prev AS (
    SELECT
      COUNT(*) FILTER (
        WHERE stage IN ('completed','settlement')
        AND COALESCE(archived_at::date, last_paid_at::date) BETWEEN v_prev_q_start AND v_prev_q_end
      ) AS done_count_pq,
      COALESCE(SUM(
        CASE WHEN last_paid_at::date BETWEEN v_prev_q_start AND v_prev_q_end THEN paid_total ELSE 0 END
      ), 0) AS revenue_pq,
      COALESCE(SUM(
        CASE WHEN last_paid_at::date BETWEEN v_prev_q_start AND v_prev_q_end THEN profit ELSE 0 END
      ), 0) AS profit_pq
    FROM deal_pnl
  ),
  -- 단계 분포
  stage_dist AS (
    SELECT
      stage,
      COUNT(*) AS cnt,
      COALESCE(SUM(contract_total), 0) AS contract_sum
    FROM base_deals
    GROUP BY stage
  ),
  -- TOP 거래처 — 이번 분기 매출 desc
  top_partners AS (
    SELECT
      p.id, p.name, p.representative,
      COUNT(DISTINCT dp.deal_id) AS deal_count,
      COALESCE(SUM(
        CASE WHEN dp.last_paid_at::date BETWEEN v_q_start AND v_q_end THEN dp.paid_total ELSE 0 END
      ), 0) AS revenue_q
    FROM deal_pnl dp
    JOIN partners p ON p.id = dp.partner_id
    WHERE dp.partner_id IS NOT NULL
    GROUP BY p.id, p.name, p.representative
    HAVING COALESCE(SUM(
      CASE WHEN dp.last_paid_at::date BETWEEN v_q_start AND v_q_end THEN dp.paid_total ELSE 0 END
    ), 0) > 0
    ORDER BY revenue_q DESC
    LIMIT 5
  ),
  -- TOP 담당자 (internal_manager_id) — 이번 분기 매출 desc
  top_managers AS (
    SELECT
      u.id, u.name, u.email,
      COUNT(DISTINCT dp.deal_id) AS deal_count,
      COALESCE(SUM(
        CASE WHEN dp.last_paid_at::date BETWEEN v_q_start AND v_q_end THEN dp.paid_total ELSE 0 END
      ), 0) AS revenue_q
    FROM deal_pnl dp
    JOIN users u ON u.id = dp.internal_manager_id
    WHERE dp.internal_manager_id IS NOT NULL
    GROUP BY u.id, u.name, u.email
    HAVING COALESCE(SUM(
      CASE WHEN dp.last_paid_at::date BETWEEN v_q_start AND v_q_end THEN dp.paid_total ELSE 0 END
    ), 0) > 0
    ORDER BY revenue_q DESC
    LIMIT 5
  ),
  -- 분기별 추이 — 최근 4분기 (last_paid_at 기준)
  q_axis AS (
    SELECT
      (date_trunc('quarter', v_today) - (offs || ' months')::interval)::date AS q_start,
      (date_trunc('quarter', v_today) - (offs || ' months')::interval + INTERVAL '3 months - 1 day')::date AS q_end
    FROM generate_series(0, 9, 3) AS offs  -- 0, 3, 6, 9 → 이번 + 3개 전
  ),
  quarterly_trend AS (
    SELECT
      to_char(qa.q_start, 'YYYY "Q"Q') AS quarter_label,
      qa.q_start,
      qa.q_end,
      COUNT(DISTINCT dp.deal_id) FILTER (
        WHERE dp.stage IN ('completed','settlement')
        AND COALESCE(dp.archived_at::date, dp.last_paid_at::date) BETWEEN qa.q_start AND qa.q_end
      ) AS done_count,
      COALESCE(SUM(
        CASE WHEN dp.last_paid_at::date BETWEEN qa.q_start AND qa.q_end THEN dp.paid_total ELSE 0 END
      ), 0) AS revenue,
      COALESCE(SUM(
        CASE WHEN dp.last_paid_at::date BETWEEN qa.q_start AND qa.q_end THEN dp.profit ELSE 0 END
      ), 0) AS profit
    FROM q_axis qa
    LEFT JOIN deal_pnl dp ON TRUE
    GROUP BY qa.q_start, qa.q_end
    ORDER BY qa.q_start ASC
  ),
  -- 진행 중 프로젝트 리스트
  in_progress_list AS (
    SELECT
      bd.id, bd.name, bd.stage, bd.contract_total, bd.next_action_text,
      bd.priority, bd.start_date, bd.end_date,
      p.id AS partner_id, p.name AS partner_name,
      u.id AS manager_id, u.name AS manager_name,
      COALESCE(dp.cost_total, 0) AS cost_total,
      bd.contract_total - COALESCE(dp.cost_total, 0) AS expected_margin,
      (bd.custom_scope -> 'progress_report' ->> 'progress_pct')::int AS progress_pct_override
    FROM base_deals bd
    LEFT JOIN deal_pnl dp ON dp.deal_id = bd.id
    LEFT JOIN partners p  ON p.id = bd.partner_id
    LEFT JOIN users u     ON u.id = bd.internal_manager_id
    WHERE bd.stage IN ('estimate','contract','in_progress')
    ORDER BY
      CASE bd.stage WHEN 'in_progress' THEN 0 WHEN 'contract' THEN 1 ELSE 2 END,
      bd.end_date NULLS LAST,
      bd.created_at DESC
    LIMIT 20
  ),
  -- 완료 보고서 — 분기별 폴더 (stage IN done) + 정산/완료 PDF URL
  done_reports AS (
    SELECT
      dp.deal_id,
      bd.name,
      p.name AS partner_name,
      COALESCE(dp.archived_at::date, dp.last_paid_at::date) AS done_at,
      to_char(COALESCE(dp.archived_at::date, dp.last_paid_at::date, CURRENT_DATE), 'YYYY "Q"Q') AS quarter_label,
      dp.paid_total AS revenue,
      dp.profit,
      -- 정산서 PDF (stage='settlement' approved)
      (SELECT COALESCE(qa.fully_signed_contract_url, qa.signed_contract_url)
       FROM quote_approvals qa
       WHERE qa.deal_id = dp.deal_id AND qa.stage = 'settlement' AND qa.status IN ('approved','fully_signed')
       ORDER BY qa.decided_at DESC NULLS LAST LIMIT 1) AS settlement_url,
      (SELECT qa.id FROM quote_approvals qa
       WHERE qa.deal_id = dp.deal_id AND qa.stage = 'settlement' AND qa.status IN ('approved','fully_signed')
       ORDER BY qa.decided_at DESC NULLS LAST LIMIT 1) AS settlement_id,
      -- 완료확인서 PDF (stage='completion' approved)
      (SELECT COALESCE(qa.fully_signed_contract_url, qa.signed_contract_url)
       FROM quote_approvals qa
       WHERE qa.deal_id = dp.deal_id AND qa.stage = 'completion' AND qa.status IN ('approved','fully_signed')
       ORDER BY qa.decided_at DESC NULLS LAST LIMIT 1) AS completion_url,
      (SELECT qa.id FROM quote_approvals qa
       WHERE qa.deal_id = dp.deal_id AND qa.stage = 'completion' AND qa.status IN ('approved','fully_signed')
       ORDER BY qa.decided_at DESC NULLS LAST LIMIT 1) AS completion_id
    FROM done_in dp
    JOIN base_deals bd ON bd.id = dp.deal_id
    LEFT JOIN partners p ON p.id = bd.partner_id
  )
  -- 4) jsonb 조립
  SELECT jsonb_build_object(
    'quarter', jsonb_build_object(
      'label', v_q_label,
      'from', v_q_start,
      'to', v_q_end,
      'prev_label', v_prev_q_label
    ),
    'kpi', jsonb_build_object(
      'active_count', (SELECT active_count FROM kpi_now),
      'done_count_q', (SELECT done_count_q FROM kpi_now),
      'revenue_q', (SELECT revenue_q FROM kpi_now),
      'profit_q', (SELECT profit_q FROM kpi_now),
      'profit_pct_q', CASE WHEN (SELECT revenue_q FROM kpi_now) > 0
                      THEN ROUND(((SELECT profit_q FROM kpi_now) / (SELECT revenue_q FROM kpi_now)) * 100, 1)
                      ELSE 0 END,
      'done_count_pq', (SELECT done_count_pq FROM kpi_prev),
      'revenue_pq', (SELECT revenue_pq FROM kpi_prev),
      'profit_pq', (SELECT profit_pq FROM kpi_prev)
    ),
    'stage_distribution', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'stage', stage, 'count', cnt, 'contract_sum', contract_sum
      ) ORDER BY array_position(
        ARRAY['estimate','contract','in_progress','completed','settlement']::text[], stage
      )), '[]'::jsonb)
      FROM stage_dist
    ),
    'top_partners', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'representative', representative,
        'deal_count', deal_count, 'revenue_q', revenue_q
      ) ORDER BY revenue_q DESC), '[]'::jsonb)
      FROM top_partners
    ),
    'top_managers', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'email', email,
        'deal_count', deal_count, 'revenue_q', revenue_q
      ) ORDER BY revenue_q DESC), '[]'::jsonb)
      FROM top_managers
    ),
    'quarterly_trend', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'label', quarter_label,
        'q_start', q_start,
        'q_end', q_end,
        'done_count', done_count,
        'revenue', revenue,
        'profit', profit
      ) ORDER BY q_start ASC), '[]'::jsonb)
      FROM quarterly_trend
    ),
    'in_progress', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'stage', stage,
        'contract_total', contract_total,
        'next_action_text', next_action_text,
        'priority', priority,
        'start_date', start_date, 'end_date', end_date,
        'partner', CASE WHEN partner_id IS NOT NULL
                    THEN jsonb_build_object('id', partner_id, 'name', partner_name) ELSE NULL END,
        'manager', CASE WHEN manager_id IS NOT NULL
                    THEN jsonb_build_object('id', manager_id, 'name', manager_name) ELSE NULL END,
        'cost_total', cost_total,
        'expected_margin', expected_margin,
        'progress_pct_override', progress_pct_override
      )), '[]'::jsonb)
      FROM in_progress_list
    ),
    'completed_reports', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', deal_id, 'name', name,
        'partner_name', partner_name,
        'done_at', done_at,
        'quarter_label', quarter_label,
        'revenue', revenue,
        'profit', profit,
        'settlement_url', settlement_url,
        'settlement_id', settlement_id,
        'completion_url', completion_url,
        'completion_id', completion_id
      ) ORDER BY done_at DESC NULLS LAST), '[]'::jsonb)
      FROM done_reports
    ),
    'generated_at', now()
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_owner_dashboard_summary(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_owner_dashboard_summary(date, date) TO authenticated;

COMMENT ON FUNCTION public.get_owner_dashboard_summary(date, date) IS
  '대표 대시보드 종합 — KPI/단계분포/TOP거래처담당자/분기추이/진행중리스트/완료보고서 한 호출.
   is_company_admin() 게이트, 직원/파트너 호출 시 NULL.';

NOTIFY pgrst, 'reload schema';
