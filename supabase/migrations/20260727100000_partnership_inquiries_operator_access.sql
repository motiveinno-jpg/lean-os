-- 랜딩 제휴·도입 문의 실동작화 (2026-07-27)
--   배경: partnership_inquiries 테이블은 2026-03 부터 존재했으나
--     (1) 랜딩 폼이 실제로는 전송하지 않는 더미였고(버튼이 상태만 토글)
--     (2) 20260611160000_launch_gate_fixes 에서 PII 유출 차단으로 SELECT 정책을 제거해
--         적재되더라도 조회할 수단이 없었다.
--   조치: 쓰기는 서버 API(service_role)로만, 읽기/상태변경은 운영자 RPC로만.
--
--   FIX 1: anon/authenticated 직접 INSERT 정책 제거 — 공개 anon 키로 무제한 스팸 적재 가능했음.
--          랜딩 폼은 /api/partnership (service_role + rate limit + 허니팟) 경유로 전환.
--   FIX 2: 운영자 조회·상태변경 RPC 추가 (기존 operator_* SECURITY DEFINER 게이트 패턴 재사용).

-- ============================================================
-- FIX 1: 공개 INSERT 정책 제거
-- ============================================================
DROP POLICY IF EXISTS "Anyone can insert partnership inquiries" ON public.partnership_inquiries;

-- 목록 정렬용 인덱스
CREATE INDEX IF NOT EXISTS partnership_inquiries_created_idx
  ON public.partnership_inquiries (created_at DESC);

-- ============================================================
-- FIX 2: 운영자 조회 RPC
-- ============================================================
CREATE OR REPLACE FUNCTION public.operator_list_partnership_inquiries(
  p_limit integer DEFAULT 100,
  p_status text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  company_name text,
  contact_name text,
  email text,
  phone text,
  message text,
  status text,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_limit integer;
BEGIN
  IF NOT public.is_platform_operator() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  v_limit := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);

  RETURN QUERY
  SELECT pi.id, pi.company_name, pi.contact_name, pi.email, pi.phone,
         pi.message, pi.status, pi.created_at
  FROM partnership_inquiries pi
  WHERE p_status IS NULL OR pi.status = p_status
  ORDER BY pi.created_at DESC
  LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.operator_list_partnership_inquiries(integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.operator_list_partnership_inquiries(integer, text) TO authenticated;

-- ============================================================
-- FIX 2b: 운영자 상태 변경 RPC (new → contacted → closed)
-- ============================================================
CREATE OR REPLACE FUNCTION public.operator_set_partnership_inquiry_status(
  p_id uuid,
  p_status text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_platform_operator() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  IF p_status NOT IN ('new', 'contacted', 'closed') THEN
    RAISE EXCEPTION 'invalid status';
  END IF;

  UPDATE partnership_inquiries SET status = p_status WHERE id = p_id;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.operator_set_partnership_inquiry_status(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.operator_set_partnership_inquiry_status(uuid, text) TO authenticated;

COMMENT ON TABLE public.partnership_inquiries IS
  '랜딩 제휴/도입 문의. 쓰기는 /api/partnership (service_role) 만, 읽기는 operator_* RPC 만.';
