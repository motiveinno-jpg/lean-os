-- 알림 제목/본문에 "누가 승인/거절했는지" 명시 (사장님 호소 2026-05-22).
-- 거래처 측 결정자(서명자/대표자/수신자) 우선순위로 라벨 산출.
--
-- 변경: notifications INSERT 부분만 교체.
--   title: '<한글stage> 승인 · <거래처명>[ <결정자명>]'
--          예: '계약서 승인 · (주)희일커뮤니케이션 김대표'
--   message: '<결정자명> — 시각 [· 사유: ...]'
--
-- 결정자명 우선순위:
--   1) p_signer_representative (외부 승인 페이지에서 직접 입력한 대표자)
--   2) v_row.recipient_name (발송 시 우리가 지정한 수신자)
--   3) partners.representative (DB 등록 대표자)
--   4) '담당자' fallback

CREATE OR REPLACE FUNCTION public.submit_quote_decision(
  p_token text,
  p_decision text,
  p_note text DEFAULT NULL::text,
  p_signature_method text DEFAULT NULL::text,
  p_signature_data_url text DEFAULT NULL::text,
  p_signed_contract_url text DEFAULT NULL::text,
  p_signed_contract_html text DEFAULT NULL::text,
  p_signer_ip text DEFAULT NULL::text,
  p_signer_user_agent text DEFAULT NULL::text,
  p_signer_company_name text DEFAULT NULL::text,
  p_signer_business_number text DEFAULT NULL::text,
  p_signer_representative text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row quote_approvals%ROWTYPE;
  v_next_stage text;
  v_final_status text;
  v_company_id uuid;
  v_sig_method text;
  v_signer_patch jsonb;
  v_partner_name text;
  v_partner_rep text;
  v_stage_ko text;
  v_decided_at_ko text;
  v_decider text;
  v_title text;
  v_message text;
BEGIN
  IF p_decision NOT IN ('approved','rejected') THEN RETURN jsonb_build_object('ok', false, 'code', 'invalid'); END IF;
  IF p_token IS NULL OR length(p_token) < 16 THEN RETURN jsonb_build_object('ok', false, 'code', 'invalid'); END IF;
  SELECT * INTO v_row FROM quote_approvals WHERE approval_token = p_token LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'invalid'); END IF;
  IF v_row.status IN ('approved','rejected','fully_signed','pending_our_signature') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'already_decided', 'status', v_row.status);
  END IF;
  IF v_row.expires_at IS NOT NULL AND v_row.expires_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'code', 'expired');
  END IF;

  v_sig_method := COALESCE(p_signature_method, 'none');
  IF v_sig_method NOT IN ('draw','type','upload','seal','none') THEN v_sig_method := 'none'; END IF;
  v_signer_patch := jsonb_strip_nulls(jsonb_build_object(
    'signer_company_name', p_signer_company_name,
    'signer_business_number', p_signer_business_number,
    'signer_representative', p_signer_representative));

  IF p_decision = 'approved' AND v_row.stage = 'contract' THEN
    v_final_status := 'pending_our_signature';
  ELSE
    v_final_status := p_decision;
  END IF;

  UPDATE quote_approvals
     SET status = v_final_status, decided_at = now(), decision_note = p_note,
         signature_method     = CASE WHEN p_decision='approved' THEN v_sig_method ELSE signature_method END,
         signature_data_url   = CASE WHEN p_decision='approved' THEN p_signature_data_url ELSE signature_data_url END,
         signed_contract_url  = CASE WHEN p_decision='approved' THEN p_signed_contract_url ELSE signed_contract_url END,
         signed_contract_html = CASE WHEN p_decision='approved' THEN p_signed_contract_html ELSE signed_contract_html END,
         signer_ip            = CASE WHEN p_decision='approved' THEN p_signer_ip ELSE signer_ip END,
         signer_user_agent    = CASE WHEN p_decision='approved' THEN p_signer_user_agent ELSE signer_user_agent END,
         signed_at_external   = CASE WHEN p_decision='approved' THEN now() ELSE signed_at_external END,
         payload              = CASE WHEN p_decision='approved' AND v_signer_patch <> '{}'::jsonb
                                     THEN COALESCE(payload, '{}'::jsonb) || v_signer_patch ELSE payload END
   WHERE id = v_row.id;

  v_company_id := v_row.company_id;

  IF p_decision = 'approved' AND v_final_status = 'approved' THEN
    v_next_stage := CASE v_row.stage
      WHEN 'estimate' THEN 'contract'
      WHEN 'contract' THEN 'in_progress'
      WHEN 'progress_report' THEN 'completed'
      WHEN 'completion' THEN 'settlement'
      WHEN 'settlement' THEN NULL
      ELSE NULL END;
    IF v_next_stage IS NOT NULL THEN
      UPDATE deals SET stage = v_next_stage WHERE id = v_row.deal_id;
    END IF;
  END IF;

  BEGIN
    INSERT INTO audit_logs(company_id, action, entity_type, entity_id, user_id, metadata)
    VALUES (v_company_id,
      CASE p_decision WHEN 'approved' THEN 'approve' ELSE 'reject' END,
      'quote_approval', v_row.id, NULL,
      jsonb_build_object(
        'stage', v_row.stage, 'next_stage', v_next_stage, 'note', p_note,
        'signature_method', v_sig_method, 'signer_ip', p_signer_ip,
        'signer_company_name', p_signer_company_name,
        'signer_representative', p_signer_representative,
        'final_status', v_final_status));
  EXCEPTION
    WHEN undefined_table THEN NULL;
    WHEN undefined_column THEN NULL;
  END;

  -- 거래처 회사명·DB 등록 대표자 조회
  SELECT p.name, p.representative INTO v_partner_name, v_partner_rep
  FROM deals d
  LEFT JOIN partners p ON p.id = d.partner_id
  WHERE d.id = v_row.deal_id
  LIMIT 1;
  IF v_partner_name IS NULL OR length(trim(v_partner_name)) = 0 THEN
    v_partner_name := COALESCE(NULLIF(trim(p_signer_company_name), ''), '거래처');
  END IF;

  -- 결정자명 우선순위:
  --   1) 외부 페이지에서 직접 입력한 서명자(p_signer_representative)
  --   2) 발송 시 우리가 지정한 수신자(v_row.recipient_name)
  --   3) DB 에 등록된 거래처 대표자(partners.representative)
  --   4) '담당자' fallback
  v_decider := COALESCE(
    NULLIF(trim(p_signer_representative), ''),
    NULLIF(trim(v_row.recipient_name), ''),
    NULLIF(trim(v_partner_rep), ''),
    '담당자'
  );

  v_stage_ko := public.stage_label_ko(v_row.stage);
  v_decided_at_ko := to_char((now() AT TIME ZONE 'Asia/Seoul'), 'YYYY-MM-DD HH24:MI');

  -- title — 거래처명 + 결정자명 (둘 다 노출)
  IF v_final_status = 'pending_our_signature' THEN
    v_title := v_stage_ko || ' 거래처 서명 완료 — 우리 서명 대기 · ' || v_partner_name;
  ELSIF p_decision = 'approved' THEN
    v_title := v_stage_ko || ' 승인 · ' || v_partner_name;
  ELSE
    v_title := v_stage_ko || ' 거절 · ' || v_partner_name;
  END IF;
  -- 결정자명이 '담당자' fallback 이 아니고 거래처명과 다르면 title 끝에 추가
  IF v_decider <> '담당자' AND v_decider <> v_partner_name THEN
    v_title := v_title || ' (' || v_decider || ')';
  END IF;

  -- message — 결정자 · 시각 (+ 사유)
  v_message := v_decider || ' · ' || v_decided_at_ko;
  IF p_decision = 'rejected' AND p_note IS NOT NULL AND length(trim(p_note)) > 0 THEN
    v_message := v_message || ' · 사유: ' || trim(p_note);
  END IF;

  BEGIN
    INSERT INTO notifications(company_id, user_id, type, title, message, entity_type, entity_id, is_read)
    SELECT v_company_id, u.id, 'approval',
           v_title, v_message,
           'quote_approval', v_row.id, false
      FROM users u
     WHERE u.company_id = v_company_id
       AND u.role IN ('owner','admin');
  EXCEPTION
    WHEN undefined_table THEN NULL;
    WHEN check_violation THEN NULL;
  END;

  RETURN jsonb_build_object(
    'ok', true, 'status', v_final_status, 'deal_stage_after', v_next_stage,
    'stage', v_row.stage, 'signature_method', v_sig_method);
END;
$function$;

COMMENT ON FUNCTION public.submit_quote_decision(text, text, text, text, text, text, text, text, text, text, text, text) IS
  '거래처 결정 RPC. 2026-05-22 알림 title 에 결정자명, message 에 결정자 · 시각 명시.';

NOTIFY pgrst, 'reload schema';
