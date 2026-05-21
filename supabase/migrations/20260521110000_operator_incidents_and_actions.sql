-- OP-F: 운영자 사고 기록 + 감사 로그 테이블
-- 게이트: is_platform_operator() (OP-A 헬퍼) 통과한 인증 사용자만.

-- ──────────────────────────────────────────────────────────────────
-- 1) operator_incidents — 사고 기록 타임라인
-- ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.operator_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  severity text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
  symptoms text,
  root_cause text,
  prevention text,
  related_commit text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS operator_incidents_occurred_idx
  ON public.operator_incidents (occurred_at DESC);

ALTER TABLE public.operator_incidents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS operator_incidents_select ON public.operator_incidents;
CREATE POLICY operator_incidents_select ON public.operator_incidents
  FOR SELECT TO authenticated
  USING (public.is_platform_operator());

DROP POLICY IF EXISTS operator_incidents_modify ON public.operator_incidents;
CREATE POLICY operator_incidents_modify ON public.operator_incidents
  FOR ALL TO authenticated
  USING (public.is_platform_operator())
  WITH CHECK (public.is_platform_operator());

-- ──────────────────────────────────────────────────────────────────
-- 2) operator_actions — 운영자 행동 감사 로그 (append-only)
-- ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.operator_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid NOT NULL,
  actor_email text,
  action text NOT NULL,
  target_type text,
  target_id text,
  context jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS operator_actions_created_idx
  ON public.operator_actions (created_at DESC);
CREATE INDEX IF NOT EXISTS operator_actions_actor_idx
  ON public.operator_actions (actor_user_id, created_at DESC);

ALTER TABLE public.operator_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS operator_actions_select ON public.operator_actions;
CREATE POLICY operator_actions_select ON public.operator_actions
  FOR SELECT TO authenticated
  USING (public.is_platform_operator());

-- INSERT는 RPC를 통해서만 (직접 클라이언트 INSERT 차단)
DROP POLICY IF EXISTS operator_actions_no_direct ON public.operator_actions;
CREATE POLICY operator_actions_no_direct ON public.operator_actions
  FOR INSERT TO authenticated
  WITH CHECK (false);

-- ──────────────────────────────────────────────────────────────────
-- 3) RPC: log_action (자동 기록)
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.operator_log_action(
  p_action text,
  p_target_type text DEFAULT NULL,
  p_target_id text DEFAULT NULL,
  p_context jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
  v_email text;
BEGIN
  IF NOT public.is_platform_operator() THEN
    RAISE EXCEPTION 'platform operator only' USING ERRCODE = '42501';
  END IF;

  SELECT email INTO v_email FROM users WHERE id = auth.uid();

  INSERT INTO operator_actions (actor_user_id, actor_email, action, target_type, target_id, context)
  VALUES (auth.uid(), v_email, p_action, p_target_type, p_target_id, p_context)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.operator_log_action(text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.operator_log_action(text, text, text, jsonb) TO authenticated;

-- ──────────────────────────────────────────────────────────────────
-- 4) RPC: list_actions
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.operator_list_actions(p_limit integer DEFAULT 200, p_hours integer DEFAULT 168)
RETURNS TABLE (
  id uuid,
  actor_user_id uuid,
  actor_email text,
  action text,
  target_type text,
  target_id text,
  context jsonb,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_since timestamptz;
  v_limit integer;
BEGIN
  IF NOT public.is_platform_operator() THEN
    RAISE EXCEPTION 'platform operator only' USING ERRCODE = '42501';
  END IF;

  v_since := now() - (COALESCE(p_hours, 168) || ' hours')::interval;
  v_limit := LEAST(GREATEST(COALESCE(p_limit, 200), 1), 1000);

  RETURN QUERY
  SELECT a.id, a.actor_user_id, a.actor_email, a.action, a.target_type, a.target_id, a.context, a.created_at
  FROM operator_actions a
  WHERE a.created_at >= v_since
  ORDER BY a.created_at DESC
  LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.operator_list_actions(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.operator_list_actions(integer, integer) TO authenticated;

-- ──────────────────────────────────────────────────────────────────
-- 5) RPC: dependencies_health
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.operator_dependencies_health()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v jsonb;
  v_24h timestamptz := now() - interval '24 hours';
  v_1h  timestamptz := now() - interval '1 hour';
BEGIN
  IF NOT public.is_platform_operator() THEN
    RAISE EXCEPTION 'platform operator only' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'supabase', jsonb_build_object(
      'errors_24h', (SELECT count(*) FROM error_logs WHERE created_at >= v_24h),
      'errors_1h', (SELECT count(*) FROM error_logs WHERE created_at >= v_1h),
      'sample_query_ok', true
    ),
    'codef', jsonb_build_object(
      'bank_tx_24h', (SELECT count(*) FROM bank_transactions WHERE created_at >= v_24h),
      'card_tx_24h', (SELECT count(*) FROM card_transactions WHERE created_at >= v_24h),
      'note', 'BLOCKED: 홈택스/CODEF 일부 분기 (project_hometax_blocked)'
    ),
    'stripe', jsonb_build_object(
      'paid_invoices_24h', (SELECT count(*) FROM invoices WHERE status='paid' AND created_at >= v_24h),
      'failed_invoices_24h', (SELECT count(*) FROM invoices WHERE status IN ('failed','past_due') AND created_at >= v_24h)
    ),
    'signatures', jsonb_build_object(
      'approvals_24h', (SELECT count(*) FROM quote_approvals WHERE created_at >= v_24h),
      'fully_signed_24h', (SELECT count(*) FROM quote_approvals WHERE status='fully_signed' AND created_at >= v_24h)
    ),
    'at', now()
  ) INTO v;

  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION public.operator_dependencies_health() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.operator_dependencies_health() TO authenticated;

-- ──────────────────────────────────────────────────────────────────
-- 6) RPC: incidents CRUD (list / upsert / delete는 미구현 — 보존 우선)
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.operator_upsert_incident(
  p_id uuid DEFAULT NULL,
  p_title text DEFAULT NULL,
  p_occurred_at timestamptz DEFAULT NULL,
  p_resolved_at timestamptz DEFAULT NULL,
  p_severity text DEFAULT 'medium',
  p_symptoms text DEFAULT NULL,
  p_root_cause text DEFAULT NULL,
  p_prevention text DEFAULT NULL,
  p_related_commit text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
  v jsonb;
BEGIN
  IF NOT public.is_platform_operator() THEN
    RAISE EXCEPTION 'platform operator only' USING ERRCODE = '42501';
  END IF;

  IF p_title IS NULL OR btrim(p_title) = '' THEN
    RAISE EXCEPTION 'title required' USING ERRCODE = '22023';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO operator_incidents (title, occurred_at, resolved_at, severity, symptoms, root_cause, prevention, related_commit, created_by)
    VALUES (p_title, COALESCE(p_occurred_at, now()), p_resolved_at, COALESCE(p_severity,'medium'), p_symptoms, p_root_cause, p_prevention, p_related_commit, auth.uid())
    RETURNING id INTO v_id;
  ELSE
    UPDATE operator_incidents
    SET title = p_title,
        occurred_at = COALESCE(p_occurred_at, occurred_at),
        resolved_at = p_resolved_at,
        severity = COALESCE(p_severity, severity),
        symptoms = p_symptoms,
        root_cause = p_root_cause,
        prevention = p_prevention,
        related_commit = p_related_commit,
        updated_at = now()
    WHERE id = p_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'incident not found' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  SELECT to_jsonb(i.*) INTO v FROM operator_incidents i WHERE i.id = v_id;
  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION public.operator_upsert_incident(uuid, text, timestamptz, timestamptz, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.operator_upsert_incident(uuid, text, timestamptz, timestamptz, text, text, text, text, text) TO authenticated;

-- ──────────────────────────────────────────────────────────────────
-- 7) 초기 인시던트 시드 (기존 ownerview brain 기록 기반)
-- ──────────────────────────────────────────────────────────────────
INSERT INTO public.operator_incidents (title, occurred_at, resolved_at, severity, symptoms, root_cause, prevention, related_commit)
SELECT
  '로그인 504 전면 장애 — RLS 재귀',
  '2026-05-19 00:00:00+00'::timestamptz,
  '2026-05-19 04:30:00+00'::timestamptz,
  'critical',
  'authenticated 로그인 부트스트랩에서 SELECT users + employees 시 statement_timeout (504) 발생. 사이트 전면 차단.',
  '급여·카드 RLS 정책 본문에 users/employees 인라인 서브쿼리가 들어가 재귀 발생. SECURITY DEFINER 헬퍼 미사용.',
  'RLS 정책 본문에 users/employees 직접 서브쿼리 금지. is_company_admin/get_my_company_id 등 SECDEF 헬퍼만 사용. prod 적용 전 부트스트랩 재귀 시뮬레이션 필수. [[feedback_rls_recursion_gate]] 메모리 등재.',
  '9c7d403'
WHERE NOT EXISTS (
  SELECT 1 FROM public.operator_incidents WHERE title = '로그인 504 전면 장애 — RLS 재귀'
);

INSERT INTO public.operator_incidents (title, occurred_at, resolved_at, severity, symptoms, root_cause, prevention, related_commit)
SELECT
  'Realtime publication 누락 — WebSocket 재시도 폭증',
  '2026-05-21 00:00:00+00'::timestamptz,
  '2026-05-21 02:00:00+00'::timestamptz,
  'high',
  '신규 quote_approvals · chat 테이블에 .channel() 구독 추가했는데 supabase_realtime publication 미등록 → WebSocket retry 폭증 → auth 504 hang.',
  '신규 테이블 Realtime 구독 시 supabase_realtime publication ADD + REPLICA IDENTITY FULL 누락.',
  'feedback_realtime_publication_gate 메모리 등재. 신규 publication 추가 마이그레이션 PR 필수.',
  '20260521010000'
WHERE NOT EXISTS (
  SELECT 1 FROM public.operator_incidents WHERE title = 'Realtime publication 누락 — WebSocket 재시도 폭증'
);

NOTIFY pgrst, 'reload schema';
