-- 단체일괄 외부 서명 페이지 본문 변수 치환용 anon 컨텍스트 조회 RPC.
--   sign_token (외부 거래처가 메일로 받은 비밀 토큰) 으로만 1행 lookup.
--   anon RLS 가 partners/companies 차단 → 토큰 검증 후 SECURITY DEFINER 로 우회.
--
-- 보안:
--   - 입력: sign_token (UUID 또는 secret) 만. 클라이언트가 token 갖고 있으면 발송된 거래처임이 입증
--   - 출력: company 4 컬럼 + partner 7 컬럼 (재무·민감 PII 제외)
--   - 토큰 없으면 NULL (열거 공격 방지 — 일관된 응답)
--   - GRANT anon, authenticated EXECUTE — 외부 서명 페이지가 비로그인 호출 가능

CREATE OR REPLACE FUNCTION public.get_signature_context_by_token(
  p_sign_token text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_sr public.signature_requests%ROWTYPE;
  v_company record;
  v_partner record;
BEGIN
  IF p_sign_token IS NULL OR length(trim(p_sign_token)) = 0 THEN
    RETURN NULL;
  END IF;

  -- 1) signature_requests 매칭 (만료/취소 무관 — 표시 단에서 별도 처리)
  SELECT * INTO v_sr
  FROM signature_requests
  WHERE sign_token = p_sign_token
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- 2) company (갑) 정보 — 재무 컬럼 제외, 본문 변수 치환에 필요한 4가지만
  SELECT name, business_number, representative, address
  INTO v_company
  FROM companies
  WHERE id = v_sr.company_id;

  -- 3) partner (을) 정보 — 7컬럼 (재무·계좌 제외)
  IF v_sr.partner_id IS NOT NULL THEN
    SELECT name, business_number, representative, contact_name,
           contact_email, contact_phone, address
    INTO v_partner
    FROM partners
    WHERE id = v_sr.partner_id;
  END IF;

  RETURN json_build_object(
    'company', CASE WHEN v_company IS NOT NULL
      THEN json_build_object(
        'name', v_company.name,
        'business_number', v_company.business_number,
        'representative', v_company.representative,
        'address', v_company.address
      )
      ELSE NULL END,
    'partner', CASE WHEN v_partner IS NOT NULL
      THEN json_build_object(
        'name', v_partner.name,
        'business_number', v_partner.business_number,
        'representative', v_partner.representative,
        'contact_name', v_partner.contact_name,
        'contact_email', v_partner.contact_email,
        'contact_phone', v_partner.contact_phone,
        'address', v_partner.address
      )
      ELSE NULL END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_signature_context_by_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_signature_context_by_token(text) TO anon, authenticated;

COMMENT ON FUNCTION public.get_signature_context_by_token IS
  '외부 서명 페이지 본문 변수 치환용 anon-safe context. sign_token 으로만 1행 lookup, RLS 우회는 토큰 검증으로 정당화.';
