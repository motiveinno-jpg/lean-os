-- 직전 20260521040000 의 IS NOT NULL 버그 fix.
--   pl/pgsql 의 record IS NOT NULL 은 "모든 필드 not null" 시에만 true.
--   partner 의 일부 컬럼이 null 이어도 행은 존재 → name 기준 분기로 변경.

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
  v_company_found boolean := false;
  v_partner_found boolean := false;
BEGIN
  IF p_sign_token IS NULL OR length(trim(p_sign_token)) = 0 THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_sr
  FROM signature_requests
  WHERE sign_token = p_sign_token
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT name, business_number, representative, address
  INTO v_company
  FROM companies
  WHERE id = v_sr.company_id;
  v_company_found := FOUND;

  IF v_sr.partner_id IS NOT NULL THEN
    SELECT name, business_number, representative, contact_name,
           contact_email, contact_phone, address
    INTO v_partner
    FROM partners
    WHERE id = v_sr.partner_id;
    v_partner_found := FOUND;
  END IF;

  RETURN json_build_object(
    'company', CASE WHEN v_company_found
      THEN json_build_object(
        'name', v_company.name,
        'business_number', v_company.business_number,
        'representative', v_company.representative,
        'address', v_company.address
      )
      ELSE NULL END,
    'partner', CASE WHEN v_partner_found
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
