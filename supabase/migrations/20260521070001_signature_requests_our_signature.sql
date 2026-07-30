-- 단체일괄 갑(우리) 서명·일괄 도장 — signature_requests 보강 + 단건/일괄 RPC.
--   사용자 호소: "단체발송 했을 때 우리도 계약서에 도장을 찍어야 되는데 어디서?"
--   기존 자산 quote_approvals 의 our_signature_* 패턴 미러.
--
-- 데이터 무손실: 모든 ADD COLUMN IF NOT EXISTS, RPC 는 CREATE OR REPLACE.
-- 비재귀: SECURITY DEFINER + 헬퍼 (current_app_user_id, is_company_admin, get_my_company_id) 만.

-- ─── 1) 컬럼 보강 ───
ALTER TABLE public.signature_requests
  ADD COLUMN IF NOT EXISTS our_signature_method text,
  ADD COLUMN IF NOT EXISTS our_signature_data_url text,
  ADD COLUMN IF NOT EXISTS our_signed_at timestamptz,
  ADD COLUMN IF NOT EXISTS our_signer_user_id uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS fully_signed_contract_url text,
  ADD COLUMN IF NOT EXISTS our_signed_contract_html text;

-- 값 도메인 가드 (NULL 허용 — 미서명 상태)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'signature_requests_our_method_check'
  ) THEN
    ALTER TABLE public.signature_requests
      ADD CONSTRAINT signature_requests_our_method_check
      CHECK (our_signature_method IS NULL OR our_signature_method IN ('draw','type','upload','seal'));
  END IF;
END $$;

COMMENT ON COLUMN public.signature_requests.our_signature_method IS '갑(우리) 서명 방식: draw/type/upload/seal. NULL = 미서명.';
COMMENT ON COLUMN public.signature_requests.our_signature_data_url IS '갑 서명 이미지 data URL (base64).';
COMMENT ON COLUMN public.signature_requests.our_signed_at IS '갑 서명 완료 시각.';
COMMENT ON COLUMN public.signature_requests.our_signed_contract_html IS '갑+을 양측 서명 합성된 최종 HTML (있을 때만).';

-- ─── 2) 단건 RPC — /contracts/signed/[id] 갑 박스 "📝 우리 서명" 버튼용 ───
CREATE OR REPLACE FUNCTION public.submit_our_signature_for_request(
  p_signature_request_id uuid,
  p_signature_method text,
  p_signature_data_url text,
  p_fully_signed_contract_url text DEFAULT NULL,
  p_our_signed_contract_html text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid := current_app_user_id();
  v_company uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'unauthenticated');
  END IF;
  IF NOT is_company_admin() THEN
    RETURN jsonb_build_object('ok', false, 'code', 'forbidden');
  END IF;
  IF p_signature_method NOT IN ('draw','type','upload','seal') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_method');
  END IF;

  -- 회사격리: 본인 회사 행만
  SELECT company_id INTO v_company FROM signature_requests WHERE id = p_signature_request_id;
  IF v_company IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;
  IF v_company != get_my_company_id() THEN
    RETURN jsonb_build_object('ok', false, 'code', 'forbidden');
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
$$;

REVOKE ALL ON FUNCTION public.submit_our_signature_for_request(uuid, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_our_signature_for_request(uuid, text, text, text, text) TO authenticated;

-- ─── 3) 일괄 RPC — /signatures 일괄 우리 서명 마법사용 ───
CREATE OR REPLACE FUNCTION public.submit_our_signature_bulk(
  p_signature_request_ids uuid[],
  p_signature_method text,
  p_signature_data_url text,
  p_apply_to text DEFAULT 'partner_signed_only'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid := current_app_user_id();
  v_signed int := 0;
  v_total int := COALESCE(array_length(p_signature_request_ids, 1), 0);
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'unauthenticated');
  END IF;
  IF NOT is_company_admin() THEN
    RETURN jsonb_build_object('ok', false, 'code', 'forbidden');
  END IF;
  IF p_signature_method NOT IN ('draw','type','upload','seal') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_method');
  END IF;
  IF v_total = 0 THEN
    RETURN jsonb_build_object('ok', true, 'signed', 0, 'skipped', 0);
  END IF;
  IF p_apply_to NOT IN ('partner_signed_only', 'all') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_apply_to');
  END IF;

  -- 회사격리 + 이미 갑 서명 행 skip + (apply_to='partner_signed_only' 면 status='signed' 만)
  UPDATE signature_requests
  SET our_signature_method = p_signature_method,
      our_signature_data_url = p_signature_data_url,
      our_signed_at = now(),
      our_signer_user_id = v_user_id
  WHERE id = ANY(p_signature_request_ids)
    AND company_id = get_my_company_id()
    AND our_signed_at IS NULL
    AND (p_apply_to = 'all' OR status = 'signed');
  GET DIAGNOSTICS v_signed = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'signed', v_signed,
    'skipped', v_total - v_signed
  );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_our_signature_bulk(uuid[], text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_our_signature_bulk(uuid[], text, text, text) TO authenticated;

COMMENT ON FUNCTION public.submit_our_signature_bulk IS
  '단체일괄 갑 서명 일괄 적용. apply_to=partner_signed_only 기본 (거래처 서명 완료 행만), all 옵션도 지원. 회사 admin/owner 만, 회사격리, 이미 서명된 행 skip.';
