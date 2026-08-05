-- 체험(trialing) 중 해지 예약이 display_status 에 반영되지 않던 버그 (2026-08-05 사장님 제보)
--   기존: trialing 분기가 'trialing' 고정 → 해지해도 화면이 해지 예약 상태를 못 보여줌.
--   수정: active 분기와 동일하게 cancel_at_period_end 면 'cancel_scheduled'.
--   (그 외 로직은 기존 정의 그대로 — 재정의 전 현재 정의 확인함)
CREATE OR REPLACE FUNCTION public.get_company_entitlement(p_company_id uuid)
 RETURNS TABLE(effective_plan_slug text, entitled boolean, cancel_at_period_end boolean, effective_until timestamp with time zone, display_status text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  v_slug := COALESCE((SELECT slug FROM public.subscription_plans WHERE id = s.plan_id), s.plan_slug, 'free');

  IF s.status = 'trialing' THEN
    IF s.trial_ends_at IS NOT NULL AND s.trial_ends_at > now_ts THEN
      v_entitled := true; v_plan := v_slug; v_until := s.trial_ends_at;
      -- 체험 중 해지 예약도 cancel_scheduled 로 표시 (2026-08-05)
      v_display := CASE WHEN v_cape THEN 'cancel_scheduled' ELSE 'trialing' END;
    ELSE
      v_entitled := false; v_plan := 'free'; v_display := 'trial_expired';
    END IF;
  ELSIF s.status IN ('active', 'past_due', 'paused') THEN
    IF s.current_period_end IS NOT NULL AND s.current_period_end + interval '3 days' <= now_ts THEN
      v_entitled := false; v_plan := 'free'; v_display := 'expired';
    ELSE
      v_entitled := true; v_plan := v_slug; v_until := s.current_period_end;
      v_display := CASE WHEN v_cape THEN 'cancel_scheduled' ELSE s.status END;
    END IF;
  ELSE
    v_entitled := false; v_plan := 'free'; v_display := s.status;
  END IF;

  RETURN QUERY SELECT v_plan, v_entitled, v_cape, v_until, v_display;
END;
$function$;
