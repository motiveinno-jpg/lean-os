-- 전자계약 요청(signature_requests)에 우리(갑) 서명을 더하는 RPC 에 상태 검사를 넣는다.
--   종전엔 상태를 보지 않아 만료·취소(expired)·거절·서명 전 요청에도 우리 서명이 박혔다.
--   상대가 서명을 마친(signed) 요청에만, 그리고 한 번만 받는다 — 단건 계약용 submit_our_signature 와 같은 규칙.

CREATE OR REPLACE FUNCTION public.submit_our_signature_for_request(p_signature_request_id uuid, p_signature_method text, p_signature_data_url text, p_fully_signed_contract_url text DEFAULT NULL::text, p_our_signed_contract_html text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := current_app_user_id();
  v_company uuid;
  v_status text;
  v_our_signed_at timestamptz;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'unauthenticated');
  END IF;
  IF NOT (public.is_company_admin() OR public.has_perm('/signatures')) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'forbidden');
  END IF;
  IF p_signature_method NOT IN ('draw','type','upload','seal') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_method');
  END IF;

  -- 회사격리: 본인 회사 행만
  SELECT company_id, status, our_signed_at INTO v_company, v_status, v_our_signed_at
    FROM signature_requests WHERE id = p_signature_request_id;
  IF v_company IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;
  IF v_company != get_my_company_id() THEN
    RETURN jsonb_build_object('ok', false, 'code', 'forbidden');
  END IF;
  -- 상대 서명이 끝난 요청만 — 만료·취소·거절·서명 전은 받지 않는다.
  IF v_status IS DISTINCT FROM 'signed' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'wrong_status', 'status', v_status);
  END IF;
  IF v_our_signed_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'already_signed');
  END IF;

  UPDATE signature_requests
  SET our_signature_method = p_signature_method,
      our_signature_data_url = p_signature_data_url,
      our_signed_at = now(),
      our_signer_user_id = v_user_id,
      fully_signed_contract_url = COALESCE(p_fully_signed_contract_url, fully_signed_contract_url),
      our_signed_contract_html = COALESCE(p_our_signed_contract_html, our_signed_contract_html)
  WHERE id = p_signature_request_id;

  RETURN jsonb_build_object('ok', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.submit_our_signature_for_request(uuid, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_our_signature_for_request(uuid, text, text, text, text) TO authenticated;
