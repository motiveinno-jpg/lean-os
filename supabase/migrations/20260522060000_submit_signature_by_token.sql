-- 외부 서명 페이지(anon)에서 일반 문서 서명 제출 시 signature_requests UPDATE 가
-- RLS(authenticated 전용)에 막혀 "서명 요청을 찾을 수 없습니다" 발생.
-- → sign_token 검증 후 서명 데이터 저장하는 SECURITY DEFINER RPC.
--   합성 HTML(signed_contract_html)은 클라이언트가 만들어 전달(서명 이미지 합성 로직 JS 유지).

CREATE OR REPLACE FUNCTION public.submit_signature_by_token(
  p_token text,
  p_signature_data jsonb,
  p_signed_contract_html text DEFAULT NULL,
  p_signature_method text DEFAULT NULL,
  p_signature_data_url text DEFAULT NULL,
  p_ip text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
  v_status text;
  v_expires timestamptz;
BEGIN
  IF p_token IS NULL OR length(p_token) < 8 THEN
    RAISE EXCEPTION '유효하지 않은 토큰' USING ERRCODE = '22023';
  END IF;

  SELECT id, status, expires_at INTO v_id, v_status, v_expires
  FROM signature_requests WHERE sign_token = p_token LIMIT 1;

  IF v_id IS NULL THEN
    RAISE EXCEPTION '서명 요청을 찾을 수 없습니다' USING ERRCODE = 'P0002';
  END IF;
  IF v_status = 'signed' THEN
    RAISE EXCEPTION '이미 서명 완료된 요청입니다' USING ERRCODE = 'P0001';
  END IF;
  IF v_expires IS NOT NULL AND v_expires < now() THEN
    RAISE EXCEPTION '서명 요청이 만료되었습니다' USING ERRCODE = 'P0001';
  END IF;

  UPDATE signature_requests
  SET status = 'signed',
      signed_at = now(),
      signature_data = p_signature_data,
      signature_method = p_signature_method,
      signature_data_url = p_signature_data_url,
      signed_contract_html = COALESCE(p_signed_contract_html, signed_contract_html),
      ip_address = p_ip
  WHERE id = v_id AND status IN ('sent', 'viewed');

  IF NOT FOUND THEN
    RAISE EXCEPTION '서명 가능한 상태가 아닙니다' USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;

REVOKE ALL ON FUNCTION public.submit_signature_by_token(text, jsonb, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_signature_by_token(text, jsonb, text, text, text, text) TO anon, authenticated;

-- 열람 기록(viewed)도 anon 에서 가능하게 — 서명 전 본문 열람 시각 기록 (실패해도 비차단이지만 정합 위해).
CREATE OR REPLACE FUNCTION public.mark_signature_viewed_by_token(p_token text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF p_token IS NULL OR length(p_token) < 8 THEN RETURN; END IF;
  UPDATE signature_requests
  SET status = 'viewed', viewed_at = COALESCE(viewed_at, now())
  WHERE sign_token = p_token AND status = 'sent';
END;
$$;

REVOKE ALL ON FUNCTION public.mark_signature_viewed_by_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_signature_viewed_by_token(text) TO anon, authenticated;

COMMENT ON FUNCTION public.submit_signature_by_token(text, jsonb, text, text, text, text) IS
  '외부 서명 페이지용 — sign_token 검증 후 서명 데이터 저장 (anon 허용).';

NOTIFY pgrst, 'reload schema';
