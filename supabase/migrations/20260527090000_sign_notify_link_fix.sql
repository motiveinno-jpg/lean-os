-- 서명 완료 알림 클릭 → 서명된 계약서 직접 보기로 (2026-05-26 "유효하지 않은 링크" 수정).
--   기존 link='/signatures' + entity_type='signature' 라우팅이 모호해 /sign(invalid) 으로 빠지던 문제.
--   link = /contracts/signed/<signature_request_id> 로 변경 → notification-center 가 link 우선 사용.
--   /contracts/signed 의 ContractViewer 가 dual-mode 로 signature_requests 조회 → 서명본 표시.
CREATE OR REPLACE FUNCTION public.submit_signature_by_token(p_token text, p_signature_data jsonb, p_signed_contract_html text DEFAULT NULL::text, p_signature_method text DEFAULT NULL::text, p_signature_data_url text DEFAULT NULL::text, p_ip text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_status text;
  v_expires timestamptz;
  v_company_id uuid;
  v_signer_name text;
  v_title text;
  v_created_by uuid;
BEGIN
  IF p_token IS NULL OR length(p_token) < 8 THEN
    RAISE EXCEPTION '유효하지 않은 토큰' USING ERRCODE = '22023';
  END IF;

  SELECT id, status, expires_at, company_id, signer_name, title, created_by
    INTO v_id, v_status, v_expires, v_company_id, v_signer_name, v_title, v_created_by
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

  -- 서명 완료 알림 (best-effort) — 클릭 시 서명된 계약서 직접 보기
  BEGIN
    INSERT INTO notifications (company_id, user_id, type, title, message, entity_type, entity_id, link)
    SELECT v_company_id, u.id, 'signature_request',
           '계약서 서명 완료',
           COALESCE(NULLIF(v_signer_name, ''), '거래처') || '님이 "' || COALESCE(NULLIF(v_title, ''), '계약서') || '"에 서명했습니다',
           'signature', v_id, '/contracts/signed/' || v_id::text
    FROM users u
    WHERE u.company_id = v_company_id
      AND (u.role IN ('owner', 'admin') OR u.id = v_created_by);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$function$;

-- 기존 서명 완료 알림 link 보정 (이미 발송된 것)
UPDATE notifications
SET link = '/contracts/signed/' || entity_id::text
WHERE type = 'signature_request' AND entity_type = 'signature' AND entity_id IS NOT NULL;
