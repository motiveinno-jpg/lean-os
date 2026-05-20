-- =====================================================================
-- A4 거래처원장 RPC — 거래처별 통합 분개 ledger (세금계산서+은행+카드)
-- =====================================================================
-- 직원 원문: "거래처별로 볼 수 있어야 하고 외상매출금/미지급금/입금/출금별로
--           볼 수 있어야 함... 결국 잔액이 0이 될 수 있게 관리하는 장부"
--
-- 출처 통합:
--   매출 세금계산서(type='sales')  → 외상매출금(+)
--   매입 세금계산서(type='purchase') → 미지급금(+)
--   통장 입금(type='income')          → 입금(+)  (counterparty 매칭)
--   통장 출금(type='expense')         → 출금(+)  (counterparty 매칭)
--   카드 결제                          → 출금(+)  (merchant_name 매칭)
--
-- 누적잔액 식:
--   running_balance = Σ(receivable - inflow) - Σ(payable - outflow)
--   = 받을돈(매출-입금) - 줄돈(매입-출금). 0 에 수렴하면 청산 완료.
--
-- 회사격리: get_my_company_id() 사용. SECURITY DEFINER 라 호출자 회사
-- 컨텍스트를 RPC 진입 시점에 한 번 확정 → 회사 간 누출 0.
--
-- 컬럼 매핑 (introspect 2026-05-20):
--   tax_invoices: counterparty_name / type / issue_date / total_amount / item_name
--   bank_transactions: counterparty / type ('income'|'expense') / transaction_date / amount / description
--   card_transactions: merchant_name / transaction_date / amount
-- =====================================================================

CREATE OR REPLACE FUNCTION public.get_partner_ledger(
  p_partner_name text,
  p_from date DEFAULT (CURRENT_DATE - INTERVAL '6 months')::date,
  p_to   date DEFAULT CURRENT_DATE
)
RETURNS TABLE(
  entry_date      date,
  source          text,       -- 'tax_invoice' | 'bank' | 'card'
  source_id       uuid,
  description     text,
  receivable      numeric,    -- 외상매출금(+)
  payable         numeric,    -- 미지급금(+)
  inflow          numeric,    -- 입금(+)
  outflow         numeric,    -- 출금(+)
  running_balance numeric,    -- 누적잔액 = Σ(receivable - payable - inflow + outflow)
  sort_order      int
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_company uuid := public.get_my_company_id();
BEGIN
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  IF p_partner_name IS NULL OR length(trim(p_partner_name)) = 0 THEN
    RAISE EXCEPTION 'partner_name required';
  END IF;

  RETURN QUERY
  WITH entries AS (
    -- 매출 세금계산서 → 외상매출금(+)
    SELECT
      ti.issue_date::date                                                     AS entry_date,
      'tax_invoice'::text                                                     AS source,
      ti.id                                                                   AS source_id,
      ('매출 세금계산서: ' || COALESCE(NULLIF(ti.item_name, ''), '-'))::text   AS description,
      COALESCE(ti.total_amount, 0)::numeric                                   AS receivable,
      0::numeric                                                              AS payable,
      0::numeric                                                              AS inflow,
      0::numeric                                                              AS outflow,
      1                                                                       AS sort_order
    FROM public.tax_invoices ti
    WHERE ti.company_id = v_company
      AND ti.counterparty_name = p_partner_name
      AND ti.type = 'sales'
      AND ti.issue_date::date BETWEEN p_from AND p_to

    UNION ALL
    -- 매입 세금계산서 → 미지급금(+)
    SELECT
      ti.issue_date::date,
      'tax_invoice'::text,
      ti.id,
      ('매입 세금계산서: ' || COALESCE(NULLIF(ti.item_name, ''), '-'))::text,
      0::numeric,
      COALESCE(ti.total_amount, 0)::numeric,
      0::numeric,
      0::numeric,
      2
    FROM public.tax_invoices ti
    WHERE ti.company_id = v_company
      AND ti.counterparty_name = p_partner_name
      AND ti.type = 'purchase'
      AND ti.issue_date::date BETWEEN p_from AND p_to

    UNION ALL
    -- 통장 입금 → 입금(+)
    SELECT
      bt.transaction_date::date,
      'bank'::text,
      bt.id,
      ('통장 입금: ' || COALESCE(NULLIF(bt.description, ''), '-'))::text,
      0::numeric,
      0::numeric,
      COALESCE(bt.amount, 0)::numeric,
      0::numeric,
      3
    FROM public.bank_transactions bt
    WHERE bt.company_id = v_company
      AND bt.counterparty = p_partner_name
      AND bt.type = 'income'
      AND bt.transaction_date::date BETWEEN p_from AND p_to

    UNION ALL
    -- 통장 출금 → 출금(+)
    SELECT
      bt.transaction_date::date,
      'bank'::text,
      bt.id,
      ('통장 출금: ' || COALESCE(NULLIF(bt.description, ''), '-'))::text,
      0::numeric,
      0::numeric,
      0::numeric,
      COALESCE(bt.amount, 0)::numeric,
      4
    FROM public.bank_transactions bt
    WHERE bt.company_id = v_company
      AND bt.counterparty = p_partner_name
      AND bt.type = 'expense'
      AND bt.transaction_date::date BETWEEN p_from AND p_to

    UNION ALL
    -- 카드 결제 → 출금(+)
    SELECT
      ct.transaction_date::date,
      'card'::text,
      ct.id,
      ('카드 결제: ' || COALESCE(NULLIF(ct.merchant_name, ''), '-'))::text,
      0::numeric,
      0::numeric,
      0::numeric,
      COALESCE(ct.amount, 0)::numeric,
      5
    FROM public.card_transactions ct
    WHERE ct.company_id = v_company
      AND ct.merchant_name = p_partner_name
      AND ct.transaction_date::date BETWEEN p_from AND p_to
  )
  SELECT
    e.entry_date,
    e.source,
    e.source_id,
    e.description,
    e.receivable,
    e.payable,
    e.inflow,
    e.outflow,
    SUM(e.receivable - e.payable - e.inflow + e.outflow)
      OVER (ORDER BY e.entry_date, e.sort_order, e.source_id
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
      AS running_balance,
    e.sort_order
  FROM entries e
  ORDER BY e.entry_date, e.sort_order, e.source_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_partner_ledger(text, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_partner_ledger(text, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_partner_ledger(text, date, date) TO service_role;

COMMENT ON FUNCTION public.get_partner_ledger(text, date, date)
  IS 'A4 거래처원장 — 세금계산서/은행/카드 통합 분개 + 누적잔액. SECURITY DEFINER + get_my_company_id 회사격리.';
