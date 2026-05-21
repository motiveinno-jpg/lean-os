-- L 계약: 갑(우리) 서명·도장 단계 추가 — 양방향 서명 완성
--
-- 새 흐름:
--   1. 갑(우리) 계약서 발송 → status='sent'
--   2. 을(거래처) 외부 서명·승인 → status='pending_our_signature' (직전 'approved' 대신)
--      · deal.stage 미전환 (우리 서명 대기)
--   3. 갑(우리) 패널에서 우리 서명·도장 추가 → submit_our_signature RPC
--      · status='fully_signed' + deal.stage 자동 전환 (estimate→contract / contract→in_progress)
--      · signed_contract_html 갱신 (양측 서명 합성)
--
-- 적용 범위: stage='contract' 만 양방향 (estimate/progress/completion/settlement 기존 그대로)
-- 사유: 견적서는 거래처 단방향 승인이 표준. 계약서만 양측 서명이 법적 형식.

SET lock_timeout = '4000';
SET statement_timeout = '60000';

-- ─────────────────────────────────────────────────────────────────────────
-- 1) 컬럼 5개 추가 (멱등)
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.quote_approvals
  ADD COLUMN IF NOT EXISTS our_signature_method      text DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS our_signature_data_url    text,
  ADD COLUMN IF NOT EXISTS our_signed_at             timestamptz,
  ADD COLUMN IF NOT EXISTS our_signer_user_id        uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS fully_signed_contract_url text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'quote_approvals_our_signature_method_check'
      AND conrelid = 'public.quote_approvals'::regclass
  ) THEN
    ALTER TABLE public.quote_approvals
      ADD CONSTRAINT quote_approvals_our_signature_method_check
      CHECK (our_signature_method IN ('draw','type','upload','seal','none'));
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 2) status CHECK 확장 — 기존 값 무손실, 신규 값 2개 추가
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.quote_approvals DROP CONSTRAINT IF EXISTS quote_approvals_status_check;
ALTER TABLE public.quote_approvals
  ADD CONSTRAINT quote_approvals_status_check
  CHECK (status IN ('draft','sent','viewed','approved','rejected','expired','pending_our_signature','fully_signed'));

-- ─────────────────────────────────────────────────────────────────────────
-- 3) submit_quote_decision 본문 수정 — stage='contract' + approved 일 때 'pending_our_signature'
--    시그니처 12-arg 그대로, 본문만 수정.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.submit_quote_decision(
  p_token                  text,
  p_decision               text,
  p_note                   text DEFAULT NULL,
  p_signature_method       text DEFAULT NULL,
  p_signature_data_url     text DEFAULT NULL,
  p_signed_contract_url    text DEFAULT NULL,
  p_signed_contract_html   text DEFAULT NULL,
  p_signer_ip              text DEFAULT NULL,
  p_signer_user_agent      text DEFAULT NULL,
  p_signer_company_name    text DEFAULT NULL,
  p_signer_business_number text DEFAULT NULL,
  p_signer_representative  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row quote_approvals%ROWTYPE;
  v_next_stage text;
  v_final_status text;
  v_company_id uuid;
  v_sig_method text;
  v_signer_patch jsonb;
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

  -- 최종 status 결정:
  --   stage='contract' + approved → 'pending_our_signature' (deal.stage 미전환)
  --   그 외 approved → 'approved' (기존 흐름)
  --   rejected → 'rejected'
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

  -- deal.stage 전환 — pending_our_signature 면 미전환 (우리 서명 대기), 그 외 approved 면 전환
  IF p_decision = 'approved' AND v_final_status = 'approved' THEN
    v_next_stage := CASE v_row.stage
      WHEN 'estimate' THEN 'contract' WHEN 'contract' THEN 'in_progress'
      WHEN 'progress_report' THEN 'completed' WHEN 'completion' THEN 'settlement'
      WHEN 'settlement' THEN NULL ELSE NULL END;
    IF v_next_stage IS NOT NULL THEN UPDATE deals SET stage = v_next_stage WHERE id = v_row.deal_id; END IF;
  END IF;

  BEGIN
    INSERT INTO audit_logs(company_id, action, entity_type, entity_id, user_id, metadata)
    VALUES (v_company_id, CASE p_decision WHEN 'approved' THEN 'approve' ELSE 'reject' END,
      'quote_approval', v_row.id, NULL,
      jsonb_build_object('stage', v_row.stage, 'next_stage', v_next_stage, 'note', p_note,
        'signature_method', v_sig_method, 'signer_ip', p_signer_ip,
        'signer_company_name', p_signer_company_name,
        'final_status', v_final_status));
  EXCEPTION WHEN undefined_table THEN NULL; WHEN undefined_column THEN NULL; END;

  BEGIN
    INSERT INTO notifications(company_id, user_id, type, title, message, entity_type, entity_id, is_read)
    SELECT v_company_id, u.id, 'approval',
           CASE
             WHEN v_final_status = 'pending_our_signature' THEN '거래처 서명 완료 — 우리 서명 대기 (' || v_row.stage || ')'
             WHEN p_decision = 'approved' THEN '거래처 승인 — ' || v_row.stage
             ELSE '거래처 거절 — ' || v_row.stage
           END,
           COALESCE(p_note, ''), 'quote_approval', v_row.id, false
      FROM users u WHERE u.company_id = v_company_id AND u.role IN ('owner','admin');
  EXCEPTION WHEN undefined_table THEN NULL; WHEN check_violation THEN NULL; END;

  RETURN jsonb_build_object('ok', true, 'status', v_final_status, 'deal_stage_after', v_next_stage,
    'stage', v_row.stage, 'signature_method', v_sig_method);
END;
$$;

REVOKE ALL ON FUNCTION public.submit_quote_decision(text, text, text, text, text, text, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_quote_decision(text, text, text, text, text, text, text, text, text, text, text, text) TO authenticated, anon, service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 4) submit_our_signature RPC — 갑(우리) 서명 저장 + stage 전환
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.submit_our_signature(
  p_approval_id              uuid,
  p_signature_method         text,
  p_signature_data_url       text,
  p_signed_contract_html     text DEFAULT NULL,   -- 양측 서명 합성된 HTML (UPDATE signed_contract_html)
  p_fully_signed_contract_url text DEFAULT NULL   -- PDF Storage URL (이번 라운드 NULL)
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
BEGIN
  IF p_approval_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid');
  END IF;

  -- 권한: 회사 admin/owner 만 + 본인 회사
  IF NOT public.is_company_admin() THEN
    RETURN jsonb_build_object('ok', false, 'code', 'forbidden');
  END IF;

  v_user_id := public.current_app_user_id();

  SELECT * INTO v_row FROM public.quote_approvals WHERE id = p_approval_id LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'not_found'); END IF;
  IF v_row.company_id <> public.get_my_company_id() THEN
    RETURN jsonb_build_object('ok', false, 'code', 'forbidden');
  END IF;
  IF v_row.status <> 'pending_our_signature' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'wrong_status', 'status', v_row.status);
  END IF;

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

  -- deal.stage 자동 전환 (지연된 전환을 여기서 수행)
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

  BEGIN
    INSERT INTO audit_logs(company_id, action, entity_type, entity_id, user_id, metadata)
    VALUES (v_row.company_id, 'our_sign', 'quote_approval', v_row.id, v_user_id,
      jsonb_build_object('stage', v_row.stage, 'next_stage', v_next_stage,
        'our_signature_method', v_sig_method));
  EXCEPTION WHEN undefined_table THEN NULL; WHEN undefined_column THEN NULL; END;

  RETURN jsonb_build_object('ok', true, 'status', 'fully_signed',
    'deal_stage_after', v_next_stage, 'stage', v_row.stage);
END;
$$;

REVOKE ALL ON FUNCTION public.submit_our_signature(uuid, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_our_signature(uuid, text, text, text, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
