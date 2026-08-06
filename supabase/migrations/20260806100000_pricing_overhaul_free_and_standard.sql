-- 요금제 전면 개편 (2026-08-06 사장님 확정)
--   · 무료: 영구 무료. 기능은 다 열되 횟수 제한. 은행·카드 연동 불가(수동 동기화도 차단).
--   · 오너뷰 19,000원(VAT 별도): 기본 5명 포함, 추가 1명 5,000원.
--     발행(세금계산서+현금영수증) 합산 월 100건, 전자계약 무제한,
--     은행·카드 계좌 수 제한 없이 하루 2회 자동 동기화, AI 참모 월 50회.
--   원가 근거: 계좌당 600원/월(하루 2회), 세금계산서 100원/건, 현금영수증 10원/건, AI 57원/회.
--   기존 프로/울트라/엔터프라이즈는 신규 노출만 중단(is_active=false) — 기존 구독 행은 건드리지 않는다.

-- 1) 발행 한도를 '합산' 으로 — 세금계산서와 현금영수증을 한 주머니에서 쓴다
ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS monthly_issue_limit integer,      -- NULL = 무제한
  ADD COLUMN IF NOT EXISTS monthly_ai_call_limit integer,    -- AI 참모 호출 횟수(토큰 대신 횟수로 관리)
  ADD COLUMN IF NOT EXISTS bank_sync_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS daily_sync_count integer;         -- 하루 자동 동기화 횟수 (NULL = 동기화 없음)

COMMENT ON COLUMN public.subscription_plans.monthly_issue_limit IS
  '세금계산서+현금영수증 국세청 발행 합산 월 한도. NULL=무제한. (2026-08-06 개편: 종류별 한도 → 합산)';
COMMENT ON COLUMN public.subscription_plans.bank_sync_enabled IS
  '은행·카드 연동 허용 여부. 무료 플랜은 false — 자동/수동 모두 차단(CODEF 원가 방어).';

-- 2) 새 플랜 두 개
--    free 는 기존 행(14일 체험)을 영구 무료로 성격 변경 — slug 를 그대로 써야 기존 코드 경로가 산다.
UPDATE public.subscription_plans SET
  name = '무료',
  base_price = 0,
  per_seat_price = 0,
  included_seats = 5,
  max_seats = 5,
  max_employees = 5,
  monthly_issue_limit = 5,          -- 세금계산서+현금영수증 합산 5건
  monthly_tax_invoice_limit = NULL, -- 합산 컬럼으로 일원화(개별 한도 미사용)
  monthly_cashbill_limit = NULL,
  monthly_contract_limit = 5,       -- 전자계약 5건
  monthly_ai_call_limit = 10,
  monthly_ai_token_limit = 100000,
  bank_sync_enabled = false,        -- 은행·카드 연동 불가
  daily_sync_count = NULL,
  is_active = true,
  sort_order = 0,
  features = to_jsonb(ARRAY[
    '구성원 5명',
    '전자결재·근태·급여·프로젝트·게시판·문서함 무제한',
    '세금계산서+현금영수증 발행 합산 월 5건',
    '전자계약 월 5건',
    'AI 참모 월 10회',
    '은행·카드 연동은 유료 플랜에서'
  ])
WHERE slug = 'free';

--    19,000원 단일 유료 플랜
INSERT INTO public.subscription_plans (
  slug, name, base_price, per_seat_price, included_seats, max_seats, max_employees,
  monthly_issue_limit, monthly_tax_invoice_limit, monthly_cashbill_limit,
  monthly_contract_limit, monthly_ai_call_limit, monthly_ai_token_limit,
  bank_sync_enabled, daily_sync_count, is_active, sort_order, features
) VALUES (
  'standard', '오너뷰', 19000, 5000, 5, NULL, NULL,
  100, NULL, NULL,
  NULL, 50, 500000,
  true, 2, true, 1,
  to_jsonb(ARRAY[
    '기본 5명 포함 · 추가 1명 ₩5,000/월',
    '세금계산서+현금영수증 발행 합산 월 100건',
    '전자계약 무제한',
    '은행·카드 계좌 수 제한 없이 하루 2회 자동 동기화',
    '홈택스 자동 수집',
    'AI 대표 참모 월 50회',
    '전자결재·근태·급여·프로젝트 전 기능 무제한'
  ])
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  base_price = EXCLUDED.base_price,
  per_seat_price = EXCLUDED.per_seat_price,
  included_seats = EXCLUDED.included_seats,
  max_seats = EXCLUDED.max_seats,
  max_employees = EXCLUDED.max_employees,
  monthly_issue_limit = EXCLUDED.monthly_issue_limit,
  monthly_contract_limit = EXCLUDED.monthly_contract_limit,
  monthly_ai_call_limit = EXCLUDED.monthly_ai_call_limit,
  monthly_ai_token_limit = EXCLUDED.monthly_ai_token_limit,
  bank_sync_enabled = EXCLUDED.bank_sync_enabled,
  daily_sync_count = EXCLUDED.daily_sync_count,
  is_active = EXCLUDED.is_active,
  sort_order = EXCLUDED.sort_order,
  features = EXCLUDED.features;

-- 3) 구 플랜은 신규 노출만 중단 (기존 구독 행은 그대로 — 결제 중인 회사가 있다)
UPDATE public.subscription_plans SET is_active = false WHERE slug IN ('basic', 'ultra', 'enterprise');

-- 4) 이달 발행 사용량(합산) — 클라이언트·엣지가 같은 값을 보도록 단일 소스로 만든다.
--    KST 월경계 기준(기존 카운트와 동일). 취소분은 제외.
CREATE OR REPLACE FUNCTION public.get_monthly_issue_usage(p_company_id uuid)
RETURNS TABLE(tax_count integer, cash_count integer, total_count integer)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH m AS (
    SELECT (to_char((now() AT TIME ZONE 'Asia/Seoul'), 'YYYY-MM') || '-01')::date AS month_start
  ),
  t AS (
    SELECT count(*)::int AS c FROM public.tax_invoices ti, m
     WHERE ti.company_id = p_company_id
       AND ti.nts_issue_status = 'issued'
       AND ti.nts_issued_at >= (m.month_start::text || 'T00:00:00+09:00')::timestamptz
  ),
  c AS (
    SELECT count(*)::int AS c FROM public.cash_receipts cr, m
     WHERE cr.company_id = p_company_id
       AND cr.source = 'codef'
       AND cr.status <> 'cancelled'
       AND cr.issue_date >= m.month_start
  )
  SELECT t.c, c.c, (t.c + c.c) FROM t, c;
$function$;

GRANT EXECUTE ON FUNCTION public.get_monthly_issue_usage(uuid) TO authenticated;

-- 5) 무료 플랜도 '이용 가능' 이어야 한다 — 체험 만료/구독 종료는 차단이 아니라 무료로 강등.
--    (기존: 구독 없음·체험만료 = entitled false → 하드 페이월. 개편 후엔 무료 플랜으로 계속 사용)
CREATE OR REPLACE FUNCTION public.get_company_entitlement(p_company_id uuid)
 RETURNS TABLE(effective_plan_slug text, entitled boolean, cancel_at_period_end boolean, effective_until timestamp with time zone, display_status text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  s record;
  now_ts timestamptz := now();
  v_entitled boolean := true;   -- 개편: 무료도 이용 가능이 기본값
  v_plan text := 'free';
  v_until timestamptz := NULL;
  v_display text := 'free';
  v_cape boolean := false;
  v_slug text := 'free';
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.users WHERE auth_id = auth.uid() AND company_id = p_company_id) THEN
    RETURN QUERY SELECT 'free'::text, false, false, NULL::timestamptz, 'none'::text;
    RETURN;
  END IF;

  SELECT * INTO s FROM public.subscriptions
   WHERE company_id = p_company_id
   ORDER BY created_at DESC
   LIMIT 1;

  -- 구독 이력이 없으면 무료 플랜 (더 이상 차단하지 않는다)
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'free'::text, true, false, NULL::timestamptz, 'free'::text;
    RETURN;
  END IF;

  v_cape := COALESCE(s.cancel_at_period_end, false);
  v_slug := COALESCE((SELECT slug FROM public.subscription_plans WHERE id = s.plan_id), s.plan_slug, 'free');

  IF s.status = 'trialing' THEN
    IF s.trial_ends_at IS NOT NULL AND s.trial_ends_at > now_ts THEN
      v_entitled := true; v_plan := v_slug; v_until := s.trial_ends_at;
      v_display := CASE WHEN v_cape THEN 'cancel_scheduled' ELSE 'trialing' END;
    ELSE
      -- 체험 종료 → 차단이 아니라 무료 강등
      v_entitled := true; v_plan := 'free'; v_display := 'free';
    END IF;
  ELSIF s.status IN ('active', 'past_due', 'paused') THEN
    IF s.current_period_end IS NOT NULL AND s.current_period_end + interval '3 days' <= now_ts THEN
      v_entitled := true; v_plan := 'free'; v_display := 'free';   -- 결제 끊김 → 무료 강등
    ELSE
      v_entitled := true; v_plan := v_slug; v_until := s.current_period_end;
      v_display := CASE WHEN v_cape THEN 'cancel_scheduled' ELSE s.status END;
    END IF;
  ELSE
    -- canceled 등 → 무료
    v_entitled := true; v_plan := 'free'; v_display := 'free';
  END IF;

  RETURN QUERY SELECT v_plan, v_entitled, v_cape, v_until, v_display;
END;
$function$;
