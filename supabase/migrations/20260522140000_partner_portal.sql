-- 2026-05-22 파트너 포털(⑥) — 외부 거래처가 로그인 없이 토큰 링크로 견적·계약 서류 확인.
--   quote/[token] 외부 서명 패턴 미러: SECURITY DEFINER + 토큰이 권한(RLS 우회), 회사격리는 발급 RPC에서.

-- 1) 포털 토큰 컬럼 (거래처별 1개, 추측 불가 48자 hex)
ALTER TABLE partners ADD COLUMN IF NOT EXISTS portal_token text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_partners_portal_token ON partners(portal_token) WHERE portal_token IS NOT NULL;

-- 2) 토큰 발급 — 호출자 회사의 거래처만(회사격리). 이미 있으면 기존 토큰 반환(멱등).
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
    v_token := encode(gen_random_bytes(24), 'hex');
    UPDATE partners SET portal_token = v_token WHERE id = p_partner_id;
  END IF;
  RETURN v_token;
END;
$$;
REVOKE ALL ON FUNCTION public.generate_partner_portal_token(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_partner_portal_token(uuid) TO authenticated;

-- 3) 토큰으로 포털 컨텍스트 조회 — 외부(anon) 접근. 토큰이 유일한 권한.
--   거래처 정보(최소) + 회사 정보(최소) + 그 거래처 deal 들의 견적·계약 목록(민감 payload 전체 미노출).
CREATE OR REPLACE FUNCTION public.get_partner_portal_context(p_token text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_partner record;
  v_company record;
  v_docs json;
BEGIN
  IF p_token IS NULL OR length(trim(p_token)) < 16 THEN
    RETURN NULL;
  END IF;
  SELECT id, company_id, name, contact_name INTO v_partner
  FROM partners WHERE portal_token = p_token LIMIT 1;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT name, representative INTO v_company FROM companies WHERE id = v_partner.company_id;

  SELECT json_agg(doc ORDER BY doc->>'created_at' DESC) INTO v_docs
  FROM (
    SELECT json_build_object(
      'id', qa.id,
      'type', COALESCE(qa.payload->>'type', 'document'),
      'title', COALESCE(qa.payload->>'title', qa.payload->>'name', d.name),
      'status', qa.status,
      'created_at', qa.created_at,
      'deal_name', d.name
    ) AS doc
    FROM quote_approvals qa
    JOIN deals d ON d.id = qa.deal_id
    WHERE d.partner_id = v_partner.id
  ) sub;

  RETURN json_build_object(
    'partner', json_build_object('name', v_partner.name, 'contact_name', v_partner.contact_name),
    'company', json_build_object('name', v_company.name, 'representative', v_company.representative),
    'documents', COALESCE(v_docs, '[]'::json)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_partner_portal_context(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_partner_portal_context(text) TO anon, authenticated;

COMMENT ON FUNCTION public.get_partner_portal_context(text) IS
  '파트너 포털 — 토큰으로 거래처 견적·계약 목록 조회(외부 비로그인 anon). SECDEF, 토큰이 권한. payload 전체 미노출.';
