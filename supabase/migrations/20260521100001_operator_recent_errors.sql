-- OP-E: 운영자 최근 에러 조회 RPC
-- 게이트: is_platform_operator() (OP-A).

CREATE OR REPLACE FUNCTION public.operator_recent_errors(p_limit integer DEFAULT 100, p_hours integer DEFAULT 72)
RETURNS TABLE (
  id uuid,
  company_id uuid,
  company_name text,
  user_email text,
  user_name text,
  source text,
  error_type text,
  message text,
  stack text,
  url text,
  context jsonb,
  resolved boolean,
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

  v_since := now() - (COALESCE(p_hours, 72) || ' hours')::interval;
  v_limit := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);

  RETURN QUERY
  SELECT
    e.id, e.company_id, c.name AS company_name,
    e.user_email, e.user_name,
    e.source, e.error_type, e.message, e.stack, e.url,
    e.context, e.resolved, e.created_at
  FROM error_logs e
  LEFT JOIN companies c ON c.id = e.company_id
  WHERE e.created_at >= v_since
  ORDER BY e.created_at DESC
  LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.operator_recent_errors(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.operator_recent_errors(integer, integer) TO authenticated;

-- 해결 처리
CREATE OR REPLACE FUNCTION public.operator_resolve_error(p_id uuid, p_resolved boolean DEFAULT true)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_platform_operator() THEN
    RAISE EXCEPTION 'platform operator only' USING ERRCODE = '42501';
  END IF;

  UPDATE error_logs SET resolved = p_resolved WHERE id = p_id;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.operator_resolve_error(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.operator_resolve_error(uuid, boolean) TO authenticated;

COMMENT ON FUNCTION public.operator_recent_errors(integer, integer) IS 'OP-E: 운영자 최근 에러 (회사명 join, 최대 500건).';
COMMENT ON FUNCTION public.operator_resolve_error(uuid, boolean) IS 'OP-E: 운영자가 에러 resolved 토글.';

NOTIFY pgrst, 'reload schema';
