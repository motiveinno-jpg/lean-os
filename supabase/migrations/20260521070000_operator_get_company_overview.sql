-- OP-B: 운영자 회사 드릴다운 — get_company_overview(p_company_id)
-- SECURITY DEFINER. 게이트는 함수 내부에서 @mo-tive.com 이메일 또는 기존 owner+모티브이노베이션 회사명.
-- RLS 우회 + 게이트 자체검증 패턴 (다른 운영자 RPC도 동일하게 사용).

CREATE OR REPLACE FUNCTION public.is_platform_operator()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM users u
    LEFT JOIN companies c ON c.id = u.company_id
    WHERE u.id = auth.uid()
      AND (
        u.email ~* '@mo-tive\.com$'
        OR (u.role = 'owner' AND c.name = '모티브이노베이션')
      )
  );
$$;

REVOKE ALL ON FUNCTION public.is_platform_operator() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_platform_operator() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_company_overview(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_result jsonb;
  v_24h timestamptz := now() - interval '24 hours';
BEGIN
  IF NOT public.is_platform_operator() THEN
    RAISE EXCEPTION 'platform operator only' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'company', to_jsonb(c.*),
    'user_count', COALESCE((SELECT count(*) FROM users WHERE company_id = c.id), 0),
    'admin_count', COALESCE((SELECT count(*) FROM users WHERE company_id = c.id AND role IN ('owner','admin')), 0),
    'employee_count', COALESCE((SELECT count(*) FROM employees WHERE company_id = c.id AND status NOT IN ('left','withdrawn')), 0),
    'subscription', (
      SELECT to_jsonb(s.*) || jsonb_build_object('plan', to_jsonb(sp.*))
      FROM subscriptions s
      LEFT JOIN subscription_plans sp ON sp.id = s.plan_id
      WHERE s.company_id = c.id
      ORDER BY s.created_at DESC
      LIMIT 1
    ),
    'paid_invoices_total', COALESCE((
      SELECT sum(total_amount) FROM invoices WHERE company_id = c.id AND status = 'paid'
    ), 0),
    'paid_invoices_count', COALESCE((
      SELECT count(*) FROM invoices WHERE company_id = c.id AND status = 'paid'
    ), 0),
    'bank_tx_count', COALESCE((
      SELECT count(*) FROM bank_transactions WHERE company_id = c.id
    ), 0),
    'card_tx_count', COALESCE((
      SELECT count(*) FROM card_transactions WHERE company_id = c.id
    ), 0),
    'deals_count', COALESCE((
      SELECT count(*) FROM deals WHERE company_id = c.id
    ), 0),
    'deals_active_count', COALESCE((
      SELECT count(*) FROM deals WHERE company_id = c.id AND stage NOT IN ('done','dropped','closed')
    ), 0),
    'errors_24h', COALESCE((
      SELECT count(*) FROM error_logs WHERE company_id = c.id AND created_at >= v_24h
    ), 0),
    'last_login_at', (
      SELECT max(au.last_sign_in_at)
      FROM auth.users au
      WHERE au.id IN (SELECT id FROM public.users WHERE company_id = c.id)
    ),
    'created_at', c.created_at
  )
  INTO v_result
  FROM companies c
  WHERE c.id = p_company_id;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'company not found' USING ERRCODE = 'P0002';
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_company_overview(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_company_overview(uuid) TO authenticated;

COMMENT ON FUNCTION public.is_platform_operator() IS
  'OP-A: @mo-tive.com 이메일 OR 모티브이노베이션 owner 게이트 (운영자 전용 RPC 공통 헬퍼)';
COMMENT ON FUNCTION public.get_company_overview(uuid) IS
  'OP-B: 운영자용 회사 드릴다운 개요 (구독·매출·거래·딜·에러 종합)';

NOTIFY pgrst, 'reload schema';
