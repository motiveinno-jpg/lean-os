-- 외부 서명 페이지(/sign, 비로그인 anon) 가 sign_token 으로 signature_requests 를 조회할 때
-- RLS(authenticated + company_id=get_my_company_id())가 차단해 "유효하지 않은 링크" 발생.
-- → sign_token 검증 후 행+문서를 반환하는 SECURITY DEFINER RPC (token = secret 이라 anon 허용 안전).

CREATE OR REPLACE FUNCTION public.get_signature_request_by_token(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v jsonb;
BEGIN
  IF p_token IS NULL OR length(p_token) < 8 THEN
    RETURN NULL;
  END IF;

  SELECT to_jsonb(sr.*) || jsonb_build_object(
    'documents',
    CASE WHEN d.id IS NOT NULL THEN jsonb_build_object(
      'name', d.name,
      'content_json', d.content_json,
      'status', d.status,
      'company_id', d.company_id
    ) ELSE NULL END
  )
  INTO v
  FROM signature_requests sr
  LEFT JOIN documents d ON d.id = sr.document_id
  WHERE sr.sign_token = p_token
  LIMIT 1;

  RETURN v;  -- 없으면 NULL
END;
$$;

REVOKE ALL ON FUNCTION public.get_signature_request_by_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_signature_request_by_token(text) TO anon, authenticated;

COMMENT ON FUNCTION public.get_signature_request_by_token(text) IS
  '외부 서명 페이지용 — sign_token 으로 signature_requests + documents 반환 (anon 허용, token secret).';

NOTIFY pgrst, 'reload schema';
