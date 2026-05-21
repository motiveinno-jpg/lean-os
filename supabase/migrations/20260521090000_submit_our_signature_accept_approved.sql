-- Fix: submit_our_signature 가 status='approved' (구버전 흐름) 행도 받게 완화.
--   2026-05-21 사용자 호소: "상대방에서 승인 받은 계약서에 우리 싸인을 넣으려고 하니까 서명적용실패".
--   원인: 20260521060000 적용 직전에 결재된 stage='contract' + status='approved' 행 4건이 'pending_our_signature' 로 이행하지 못한 채 남음.
--   submit_our_signature 가 status<>'pending_our_signature' 면 wrong_status 반환 → 클라이언트 toast 폴백 "서명 적용 실패".
--
-- 변경:
--   1) 허용 status 를 ('approved','pending_our_signature') 둘 다로 확장 (이미 fully_signed 면 거절 유지).
--   2) deal.stage 자동 전환은 직전 status='pending_our_signature' 인 경우에만. 'approved' 경로는 구버전 submit_quote_decision 에서 이미 deal.stage 를 올렸으므로 재상승 금지(완료 단계 회귀 방지).

CREATE OR REPLACE FUNCTION public.submit_our_signature(
  p_approval_id              uuid,
  p_signature_method         text,
  p_signature_data_url       text,
  p_signed_contract_html     text DEFAULT NULL,
  p_fully_signed_contract_url text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row        quote_approvals%ROWTYPE;
  v_user_id    uuid;
  v_next_stage text;
  v_sig_method text;
  v_was_pending boolean;
BEGIN
  IF p_approval_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid');
  END IF;

  IF NOT public.is_company_admin() THEN
    RETURN jsonb_build_object('ok', false, 'code', 'forbidden');
  END IF;

  v_user_id := public.current_app_user_id();

  SELECT * INTO v_row FROM public.quote_approvals WHERE id = p_approval_id LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'not_found'); END IF;
  IF v_row.company_id <> public.get_my_company_id() THEN
    RETURN jsonb_build_object('ok', false, 'code', 'forbidden');
  END IF;
  IF v_row.status NOT IN ('approved','pending_our_signature') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'wrong_status', 'status', v_row.status);
  END IF;

  v_was_pending := v_row.status = 'pending_our_signature';

  v_sig_method := COALESCE(p_signature_method, 'none');
  IF v_sig_method NOT IN ('draw','type','upload','seal','none') THEN v_sig_method := 'none'; END IF;

  UPDATE public.quote_approvals
     SET our_signature_method      = v_sig_method,
         our_signature_data_url    = p_signature_data_url,
         our_signed_at             = now(),
         our_signer_user_id        = v_user_id,
         fully_signed_contract_url = COALESCE(p_fully_signed_contract_url, fully_signed_contract_url),
         signed_contract_html      = COALESCE(p_signed_contract_html, signed_contract_html),
         status                    = 'fully_signed',
         updated_at                = now()
   WHERE id = p_approval_id;

  -- deal.stage 자동 전환은 pending_our_signature 경로에서만 (approved 는 이미 구버전에서 상승됨)
  IF v_was_pending THEN
    v_next_stage := CASE v_row.stage
      WHEN 'estimate' THEN 'contract'
      WHEN 'contract' THEN 'in_progress'
      WHEN 'progress_report' THEN 'completed'
      WHEN 'completion' THEN 'settlement'
      ELSE NULL
    END;
    IF v_next_stage IS NOT NULL THEN
      UPDATE public.deals SET stage = v_next_stage WHERE id = v_row.deal_id;
    END IF;
  END IF;

  BEGIN
    INSERT INTO audit_logs(company_id, action, entity_type, entity_id, user_id, metadata)
    VALUES (v_row.company_id, 'our_sign', 'quote_approval', v_row.id, v_user_id,
      jsonb_build_object('stage', v_row.stage, 'next_stage', v_next_stage,
        'our_signature_method', v_sig_method,
        'prev_status', CASE WHEN v_was_pending THEN 'pending_our_signature' ELSE 'approved' END));
  EXCEPTION WHEN undefined_table THEN NULL; WHEN undefined_column THEN NULL; END;

  RETURN jsonb_build_object('ok', true, 'status', 'fully_signed',
    'deal_stage_after', v_next_stage, 'stage', v_row.stage);
END;
$$;

REVOKE ALL ON FUNCTION public.submit_our_signature(uuid, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_our_signature(uuid, text, text, text, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
