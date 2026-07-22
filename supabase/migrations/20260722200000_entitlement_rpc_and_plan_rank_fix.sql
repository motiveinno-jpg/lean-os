-- P0 구독 해지 정합성 STEP 4·7 — 단일 entitlement 판정 RPC + plan_rank 수정.
--   함수 추가/교체만(구독 데이터 변경 없음). 'cancelling' 잔존 행 0 확인(CHECK 로 애초에 못 들어감).

-- STEP 7) plan_rank 수정: 현재 상품 기준. 기존엔 basic·ultra 누락 → ELSE=0(free 와 동일) 버그.
CREATE OR REPLACE FUNCTION public.plan_rank(slug text)
RETURNS integer LANGUAGE sql IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE slug
    WHEN 'free' THEN 0
    WHEN 'starter' THEN 1     -- 레거시
    WHEN 'basic' THEN 2       -- 프로
    WHEN 'pro' THEN 2
    WHEN 'business' THEN 2
    WHEN 'ultra' THEN 3
    WHEN 'enterprise' THEN 4
    ELSE 0
  END;
$$;

-- STEP 4) 단일 entitlement 진실원천. 상태모델: 'cancelling' 미사용 — active + cancel_at_period_end 로 해지예약 표현.
--   반환: effective_plan_slug / entitled / cancel_at_period_end / effective_until / display_status.
--   판정: trialing(만료 전만) · active/past_due/paused(기간 유효 시, cape=true 면 해지예약) · canceled/기간만료 → free.
CREATE OR REPLACE FUNCTION public.get_company_entitlement(p_company_id uuid)
RETURNS TABLE(
  effective_plan_slug text,
  entitled boolean,
  cancel_at_period_end boolean,
  effective_until timestamptz,
  display_status text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  s record;
  now_ts timestamptz := now();
  v_entitled boolean := false;
  v_plan text := 'free';
  v_until timestamptz := NULL;
  v_display text := 'none';
  v_cape boolean := false;
  v_slug text := 'free';
BEGIN
  -- IDOR 방지: 인증 사용자는 자기 회사만 조회 가능. service_role(서버, auth.uid() IS NULL)은 임의 회사 허용.
  --   타 회사 요청 시 에러 대신 비권한/free 튜플 반환(존재 여부·플랜 비노출).
  IF auth.uid() IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.users WHERE auth_id = auth.uid() AND company_id = p_company_id) THEN
    RETURN QUERY SELECT 'free'::text, false, false, NULL::timestamptz, 'none'::text;
    RETURN;
  END IF;

  SELECT * INTO s FROM public.subscriptions
   WHERE company_id = p_company_id
   ORDER BY created_at DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'free'::text, false, false, NULL::timestamptz, 'none'::text;
    RETURN;
  END IF;

  v_cape := COALESCE(s.cancel_at_period_end, false);
  -- 플랜 slug: plan_id(FK) 우선 해석, 낡을 수 있는 plan_slug 는 폴백(checkout webhook 이 plan_id 만 갱신).
  v_slug := COALESCE((SELECT slug FROM public.subscription_plans WHERE id = s.plan_id), s.plan_slug, 'free');

  IF s.status = 'trialing' THEN
    IF s.trial_ends_at IS NOT NULL AND s.trial_ends_at > now_ts THEN
      v_entitled := true; v_plan := v_slug; v_until := s.trial_ends_at; v_display := 'trialing';
    ELSE
      v_entitled := false; v_plan := 'free'; v_display := 'trial_expired';
    END IF;
  ELSIF s.status IN ('active', 'past_due', 'paused') THEN
    -- 기간 만료 방어(수동 유료·webhook 지연): current_period_end + 3일 유예 지나면 free.
    --   유예는 정상 갱신(webhook 지연)·해지 종료(subscription.deleted 지연) 오차단 흡수용(fail-open).
    --   effective_until 은 유예 없는 실제 종료일을 노출.
    IF s.current_period_end IS NOT NULL AND s.current_period_end + interval '3 days' <= now_ts THEN
      v_entitled := false; v_plan := 'free'; v_display := 'expired';
    ELSE
      v_entitled := true; v_plan := v_slug; v_until := s.current_period_end;
      v_display := CASE WHEN v_cape THEN 'cancel_scheduled' ELSE s.status END;
    END IF;
  ELSE
    -- canceled 등 → 유료 권한 종료, Free.
    v_entitled := false; v_plan := 'free'; v_display := s.status;
  END IF;

  RETURN QUERY SELECT v_plan, v_entitled, v_cape, v_until, v_display;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_company_entitlement(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_company_entitlement(uuid) TO authenticated;
