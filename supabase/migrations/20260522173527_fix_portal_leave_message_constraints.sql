-- portal_leave_message 400 수정: comm_type/notifications.type CHECK 위반 + user_id NOT NULL 해소.
--   원인: 함수가 'portal_inquiry'를 comm_type/type에 INSERT(미허용값) + notifications.user_id 누락.
--   수정: comm_type='other'(허용값), notifications는 owner/admin 행별 INSERT(user_id 충족) + type='system'.

CREATE OR REPLACE FUNCTION public.portal_leave_message(p_token text, p_message text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_partner record;
  v_msg text;
BEGIN
  v_msg := trim(COALESCE(p_message, ''));
  IF p_token IS NULL OR length(trim(p_token)) < 16 OR length(v_msg) = 0 THEN
    RETURN false;
  END IF;
  IF length(v_msg) > 2000 THEN v_msg := left(v_msg, 2000); END IF;

  SELECT id, company_id, name INTO v_partner FROM partners WHERE portal_token = p_token LIMIT 1;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- comm_type: CHECK 허용값 'other' 사용. 포털 문의는 summary 프리픽스로 구분.
  INSERT INTO partner_communications (partner_id, company_id, comm_type, summary, notes, comm_date)
  VALUES (v_partner.id, v_partner.company_id, 'other', '[포털 문의] ' || left(v_msg, 80), v_msg, current_date);

  -- notifications: user_id NOT NULL → owner/admin 행별 INSERT. type 허용값 'system'.
  INSERT INTO notifications (company_id, user_id, type, title, message, entity_type, entity_id, is_read)
  SELECT v_partner.company_id, u.id, 'system',
         '포털 문의: ' || v_partner.name, left(v_msg, 120), 'partner', v_partner.id, false
  FROM users u
  WHERE u.company_id = v_partner.company_id AND u.role IN ('owner','admin');

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.portal_leave_message(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_leave_message(text, text) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
