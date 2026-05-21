-- 알림 title 한글화 + 거래처명 명시 (사장님 요청).
-- 기존 RPC submit_quote_decision 의 notifications INSERT 부분만 교체.
-- 다른 분기(상태전환·deal stage 자동진입·audit_logs·서명 patch 등) 그대로 보존.
--
-- 변경:
--   title: '거래처 승인 — contract' → '계약서 승인 · (주)희일커뮤니케이션'
--   title: '거래처 거절 — estimate' → '견적서 거절 · (주)희일커뮤니케이션'
--   title: '거래처 서명 완료 — 우리 서명 대기 (contract)' → '계약서 거래처 서명 완료 — 우리 서명 대기 · (주)희일커뮤니케이션'
--   message: COALESCE(p_note,'') → 담당자명 + 시각 + (사유 있으면 첨부)

-- 1) 한글 stage 라벨 헬퍼 (재사용 가능)
CREATE OR REPLACE FUNCTION public.stage_label_ko(p_stage text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE p_stage
    WHEN 'estimate' THEN '견적서'
    WHEN 'contract' THEN '계약서'
    WHEN 'progress_report' THEN '진척보고서'
    WHEN 'completion' THEN '완료확인서'
    WHEN 'settlement' THEN '정산서'
    ELSE p_stage
  END;
$$;
REVOKE EXECUTE ON FUNCTION public.stage_label_ko(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.stage_label_ko(text) TO authenticated;

-- 2) submit_quote_decision RPC 재정의 — notifications INSERT 만 교체
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
  v_stage_ko text;
  v_decided_at_ko text;
  v_signer_label text;
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
        'signer_company_name', p_signer_company_name, 'final_status', v_final_status));
  EXCEPTION
    WHEN undefined_table THEN NULL;
    WHEN undefined_column THEN NULL;
  END;

  -- 거래처명 조회 (deals.partner_id → partners.name)
  SELECT p.name INTO v_partner_name
  FROM deals d
  LEFT JOIN partners p ON p.id = d.partner_id
  WHERE d.id = v_row.deal_id
  LIMIT 1;
  IF v_partner_name IS NULL OR length(trim(v_partner_name)) = 0 THEN
    v_partner_name := COALESCE(p_signer_company_name, '거래처');
  END IF;

  v_stage_ko := public.stage_label_ko(v_row.stage);
  v_decided_at_ko := to_char((now() AT TIME ZONE 'Asia/Seoul'), 'YYYY-MM-DD HH24:MI');
  v_signer_label := COALESCE(NULLIF(trim(v_row.recipient_name), ''), '담당자');

  IF v_final_status = 'pending_our_signature' THEN
    v_title := v_stage_ko || ' 거래처 서명 완료 — 우리 서명 대기 · ' || v_partner_name;
  ELSIF p_decision = 'approved' THEN
    v_title := v_stage_ko || ' 승인 · ' || v_partner_name;
  ELSE
    v_title := v_stage_ko || ' 거절 · ' || v_partner_name;
  END IF;

  v_message := v_signer_label || ' — ' || v_decided_at_ko;
  IF p_note IS NOT NULL AND length(trim(p_note)) > 0 THEN
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
  '거래처 견적/계약/진척/완료/정산 결정 RPC. 2026-05-21 한글화 + 거래처명 명시.';

-- 3) 과거 알림 한글 백필 (멱등) — 거래처명은 사후 못 붙이므로 stage 만 한글로
UPDATE notifications
SET title = '견적서 승인'
WHERE title = '거래처 승인 — estimate';
UPDATE notifications
SET title = '계약서 승인'
WHERE title = '거래처 승인 — contract';
UPDATE notifications
SET title = '진척보고서 승인'
WHERE title = '거래처 승인 — progress_report';
UPDATE notifications
SET title = '완료확인서 승인'
WHERE title = '거래처 승인 — completion';
UPDATE notifications
SET title = '정산서 승인'
WHERE title = '거래처 승인 — settlement';

UPDATE notifications
SET title = '견적서 거절'
WHERE title = '거래처 거절 — estimate';
UPDATE notifications
SET title = '계약서 거절'
WHERE title = '거래처 거절 — contract';
UPDATE notifications
SET title = '진척보고서 거절'
WHERE title = '거래처 거절 — progress_report';
UPDATE notifications
SET title = '완료확인서 거절'
WHERE title = '거래처 거절 — completion';
UPDATE notifications
SET title = '정산서 거절'
WHERE title = '거래처 거절 — settlement';

-- pending_our_signature 알림 한글화 (괄호 형식)
UPDATE notifications
SET title = '견적서 거래처 서명 완료 — 우리 서명 대기'
WHERE title = '거래처 서명 완료 — 우리 서명 대기 (estimate)';
UPDATE notifications
SET title = '계약서 거래처 서명 완료 — 우리 서명 대기'
WHERE title = '거래처 서명 완료 — 우리 서명 대기 (contract)';
UPDATE notifications
SET title = '진척보고서 거래처 서명 완료 — 우리 서명 대기'
WHERE title = '거래처 서명 완료 — 우리 서명 대기 (progress_report)';
UPDATE notifications
SET title = '완료확인서 거래처 서명 완료 — 우리 서명 대기'
WHERE title = '거래처 서명 완료 — 우리 서명 대기 (completion)';
UPDATE notifications
SET title = '정산서 거래처 서명 완료 — 우리 서명 대기'
WHERE title = '거래처 서명 완료 — 우리 서명 대기 (settlement)';

NOTIFY pgrst, 'reload schema';
