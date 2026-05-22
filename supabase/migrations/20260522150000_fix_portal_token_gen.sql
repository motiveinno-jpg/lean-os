-- 2026-05-22 포털 토큰 생성 fix — gen_random_bytes 는 pgcrypto 확장 함수(미설치) → 'does not exist'.
--   기본 제공 gen_random_uuid() 2개를 조합해 64자 hex 토큰 생성(추측 불가). pgcrypto 불요.

CREATE OR REPLACE FUNCTION public.generate_partner_portal_token(p_partner_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_company uuid;
  v_token text;
BEGIN
  SELECT company_id INTO v_company FROM partners WHERE id = p_partner_id;
  IF v_company IS NULL OR v_company <> get_my_company_id() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT portal_token INTO v_token FROM partners WHERE id = p_partner_id;
  IF v_token IS NULL OR length(v_token) = 0 THEN
    v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    UPDATE partners SET portal_token = v_token WHERE id = p_partner_id;
  END IF;
  RETURN v_token;
END;
$$;
REVOKE ALL ON FUNCTION public.generate_partner_portal_token(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_partner_portal_token(uuid) TO authenticated;
