-- 대시보드 "재무 데이터 없음" 해결 — 원천(통장/카드/세금계산서) → monthly_financials 자동 집계.
-- 진단: monthly_financials/financial_items 를 채우는 경로가 엑셀 업로드/샘플뿐이라
--   CODEF 자동 연동(bank/card/tax) 회사는 집계가 비어 대시보드가 "데이터 없음" 표시.
--
-- 집계 기준 (손익계산서·재무상태표와 정합):
--   revenue       = tax_invoices type='sales' 공급가액(supply_amount) 월합 (발생주의 매출, 손익 정합)
--   total_income  = bank_transactions type='income' 월합 (현금 유입)
--   total_expense = bank_transactions type='expense' 월합 (현금 유출)
--                   ※ 카드대금·매입대금 출금이 bank expense 에 이미 포함 → card/purchase 별도 가산 안 함(이중계상 회피)
--   variable_cost = card_transactions 월합 (표시용)
--   fixed_cost    = 0 (대시보드가 recurring_payments 합으로 fallback)
--   net_cashflow  = total_income - total_expense
--   bank_balance  = 해당 월 마지막 거래의 balance_after
--
-- 중복 방지: source='excel'(수동) 보존, source='auto' 만 delete + 재집계.
-- 게이트: service_role(백필, auth.uid IS NULL) 통과 / 클라이언트는 본인회사 또는 운영자만.

CREATE OR REPLACE FUNCTION public.recompute_monthly_financials(
  p_company_id uuid,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_months int;
  v_items int;
  v_this_month text := to_char(CURRENT_DATE, 'YYYY-MM');
BEGIN
  -- 게이트
  IF auth.uid() IS NOT NULL THEN
    IF p_company_id <> COALESCE(public.get_my_company_id(), '00000000-0000-0000-0000-000000000000'::uuid)
       AND NOT public.is_platform_operator() THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- auto 행만 정리 (excel 수동분 보존)
  DELETE FROM monthly_financials WHERE company_id = p_company_id AND source = 'auto';
  DELETE FROM financial_items WHERE company_id = p_company_id AND source = 'auto';

  -- 월별 집계
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
    AND (p_to   IS NULL OR m.month <= to_char(p_to, 'YYYY-MM'));

  GET DIAGNOSTICS v_months = ROW_COUNT;

  -- financial_items: 이번 달 미지급(매입 issued 거래처별) + 미수금(미정산 deals)
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
$$;

REVOKE ALL ON FUNCTION public.recompute_monthly_financials(uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recompute_monthly_financials(uuid, date, date) TO authenticated;

COMMENT ON FUNCTION public.recompute_monthly_financials(uuid, date, date) IS
  '원천(bank/card/tax)→monthly_financials+financial_items 자동 집계. source=auto만 재계산(excel 보존).';

NOTIFY pgrst, 'reload schema';
