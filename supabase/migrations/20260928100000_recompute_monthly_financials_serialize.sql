begin;
CREATE OR REPLACE FUNCTION public.recompute_monthly_financials(p_company_id uuid, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_months int;
  v_items int;
  v_this_month text := to_char(CURRENT_DATE, 'YYYY-MM');
BEGIN
  IF auth.uid() IS NULL AND auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF auth.uid() IS NOT NULL THEN
    IF p_company_id <> COALESCE(public.get_my_company_id(), '00000000-0000-0000-0000-000000000000'::uuid)
       AND NOT public.is_platform_operator() THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
  END IF;

  --   같은 회사 재집계가 겹치면(탭 두 개·두 사람 동시 진입) 둘 다 지우고 둘 다 넣다가 (company_id, month) 유니크에 걸린다.
  --   회사 단위로 줄 세운다 — 뒤에 온 호출은 앞 호출이 끝난 뒤 같은 결과로 다시 덮는다.
  PERFORM pg_advisory_xact_lock(hashtext('recompute_monthly_financials'), hashtext(p_company_id::text));

  DELETE FROM monthly_financials WHERE company_id = p_company_id AND source = 'auto';
  DELETE FROM financial_items WHERE company_id = p_company_id AND source = 'auto';

  WITH all_months AS (
    SELECT DISTINCT month FROM (
      SELECT to_char(transaction_date, 'YYYY-MM') AS month FROM bank_transactions WHERE company_id = p_company_id
      UNION SELECT to_char(issue_date, 'YYYY-MM') FROM tax_invoices WHERE company_id = p_company_id
      UNION SELECT to_char(transaction_date, 'YYYY-MM') FROM card_transactions WHERE company_id = p_company_id
    ) u WHERE month IS NOT NULL
  ),
  bank_agg AS (
    SELECT to_char(transaction_date, 'YYYY-MM') AS month,
           SUM(amount) FILTER (WHERE type = 'income')  AS income,
           SUM(amount) FILTER (WHERE type = 'expense') AS expense
    FROM bank_transactions WHERE company_id = p_company_id GROUP BY 1
  ),
  sales_agg AS (
    SELECT to_char(issue_date, 'YYYY-MM') AS month,
           SUM(supply_amount) FILTER (WHERE type = 'sales') AS sales
    FROM tax_invoices WHERE company_id = p_company_id GROUP BY 1
  ),
  card_agg AS (
    SELECT to_char(transaction_date, 'YYYY-MM') AS month, SUM(amount) AS card
    FROM card_transactions WHERE company_id = p_company_id GROUP BY 1
  )
  INSERT INTO monthly_financials
    (company_id, month, revenue, total_income, total_expense, variable_cost, fixed_cost, net_cashflow, bank_balance, source)
  SELECT
    p_company_id,
    m.month,
    COALESCE(s.sales, 0),
    COALESCE(b.income, 0),
    COALESCE(b.expense, 0),
    COALESCE(c.card, 0),
    0,
    COALESCE(b.income, 0) - COALESCE(b.expense, 0),
    COALESCE(bal.balance_after, 0),
    'auto'
  FROM all_months m
  LEFT JOIN bank_agg b ON b.month = m.month
  LEFT JOIN sales_agg s ON s.month = m.month
  LEFT JOIN card_agg c ON c.month = m.month
  LEFT JOIN LATERAL (
    SELECT bt.balance_after FROM bank_transactions bt
    WHERE bt.company_id = p_company_id AND to_char(bt.transaction_date, 'YYYY-MM') = m.month
    ORDER BY bt.transaction_date DESC, bt.created_at DESC LIMIT 1
  ) bal ON true
  WHERE (p_from IS NULL OR m.month >= to_char(p_from, 'YYYY-MM'))
    AND (p_to   IS NULL OR m.month <= to_char(p_to, 'YYYY-MM'))
  --   엑셀 업로드(manual)·샘플(sample) 행이 있는 달은 그 값을 남긴다 — 유니크가 source 를 가리지 않는다
  ON CONFLICT (company_id, month) DO NOTHING;

  GET DIAGNOSTICS v_months = ROW_COUNT;

  INSERT INTO financial_items (company_id, month, category, name, amount, status, source)
  SELECT p_company_id, v_this_month, 'payable',
         COALESCE(NULLIF(trim(counterparty_name), ''), '(거래처 미상)'),
         SUM(total_amount), 'pending', 'auto'
  FROM tax_invoices
  WHERE company_id = p_company_id AND type = 'purchase' AND status = 'issued'
  GROUP BY COALESCE(NULLIF(trim(counterparty_name), ''), '(거래처 미상)')
  HAVING SUM(total_amount) > 0;

  INSERT INTO financial_items (company_id, month, category, name, amount, status, source, deal_id, project_name)
  SELECT p_company_id, v_this_month, 'receivable',
         d.name, (d.contract_total - COALESCE(paid.s, 0)), 'pending', 'auto', d.id, d.name
  FROM deals d
  LEFT JOIN (
    SELECT deal_id, SUM(amount) AS s FROM deal_revenue_schedule WHERE status = 'paid' GROUP BY deal_id
  ) paid ON paid.deal_id = d.id
  WHERE d.company_id = p_company_id
    AND d.archived_at IS NULL
    AND d.stage NOT IN ('completed', 'settlement')
    AND (d.contract_total - COALESCE(paid.s, 0)) > 0;

  GET DIAGNOSTICS v_items = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'company_id', p_company_id,
    'months_upserted', v_months,
    'items_upserted', v_items
  );
END;
$function$
;
commit;
