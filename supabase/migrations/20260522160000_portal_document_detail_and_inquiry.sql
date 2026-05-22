-- 2026-05-22 파트너 포털 강화 — 서류 상세(payload) + 거래처 문의 남기기.
--   거래처가 포털에서 서류 내용을 펼쳐보고, 문의/코멘트를 남기면 내부에 알림.

-- 1) 컨텍스트 RPC 에 각 서류 payload 포함 (상세 보기용). 나머지 동일.
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
      'deal_name', d.name,
      'payload', qa.payload
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

-- 2) 포털 문의 남기기 — 거래처가 메시지 작성 → partner_communications + 내부 알림.
CREATE OR REPLACE FUNCTION public.portal_leave_message(p_token text, p_message text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_partner record;
  v_msg text;
BEGIN
  v_msg := trim(COALESCE(p_message, ''));
  IF p_token IS NULL OR length(trim(p_token)) < 16 OR length(v_msg) = 0 THEN
    RETURN false;
  END IF;
  -- 과도한 길이 차단(악용 방지)
  IF length(v_msg) > 2000 THEN v_msg := left(v_msg, 2000); END IF;

  SELECT id, company_id, name INTO v_partner FROM partners WHERE portal_token = p_token LIMIT 1;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  INSERT INTO partner_communications (partner_id, company_id, comm_type, summary, notes, comm_date)
  VALUES (v_partner.id, v_partner.company_id, 'portal_inquiry', '[포털 문의] ' || left(v_msg, 80), v_msg, current_date);

  INSERT INTO notifications (company_id, type, title, message, entity_type, entity_id, is_read)
  VALUES (v_partner.company_id, 'portal_inquiry', '포털 문의: ' || v_partner.name, left(v_msg, 120), 'partner', v_partner.id, false);

  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.portal_leave_message(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_leave_message(text, text) TO anon, authenticated;

COMMENT ON FUNCTION public.portal_leave_message(text, text) IS
  '파트너 포털 — 거래처가 토큰으로 문의 남기기(anon). partner_communications + 내부 알림 생성. 토큰이 권한.';
