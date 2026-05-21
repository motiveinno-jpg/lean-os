-- L 계약: quote_approvals 서명·도장·서명본 회수 컬럼 추가 + submit_quote_decision RPC 확장
--
-- 신규 컬럼 (멱등 ADD COLUMN IF NOT EXISTS):
--   signature_method     — draw|type|upload|seal|none (default 'none')
--   signature_data_url   — 서명 이미지 base64 또는 storage URL
--   signed_contract_url  — 최종 서명본 PDF storage URL (이번 라운드 NULL — 별건 후속)
--   signed_contract_html — 서명 합성된 HTML (회사 패널에서 새 탭 렌더 → print-to-pdf)
--   signer_ip            — 외부 서명자 IP (감사)
--   signer_user_agent    — 외부 서명자 UA (감사)
--   signed_at_external   — 외부 서명 완료 시각 (decided_at 와 별개 — 감사용)
--
-- submit_quote_decision RPC 확장 (옵션 파라미터):
--   p_signature_method / p_signature_data_url / p_signed_contract_url /
--   p_signed_contract_html / p_signer_ip / p_signer_user_agent
--   approved 케이스에서만 서명 컬럼 UPDATE + signed_at_external=now().
--
-- RLS 변경 0 (회사격리 정책 그대로 — 추가 컬럼이라 자동 적용).

SET lock_timeout = '4000';
SET statement_timeout = '60000';

-- ─────────────────────────────────────────────────────────────────────────
-- 1) 컬럼 추가 (멱등)
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.quote_approvals
  ADD COLUMN IF NOT EXISTS signature_method     text DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS signature_data_url   text,
  ADD COLUMN IF NOT EXISTS signed_contract_url  text,
  ADD COLUMN IF NOT EXISTS signed_contract_html text,
  ADD COLUMN IF NOT EXISTS signer_ip            text,
  ADD COLUMN IF NOT EXISTS signer_user_agent    text,
  ADD COLUMN IF NOT EXISTS signed_at_external   timestamptz;

-- CHECK constraint 멱등 추가 (이미 있으면 스킵)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'quote_approvals_signature_method_check'
      AND conrelid = 'public.quote_approvals'::regclass
  ) THEN
    ALTER TABLE public.quote_approvals
      ADD CONSTRAINT quote_approvals_signature_method_check
      CHECK (signature_method IN ('draw','type','upload','seal','none'));
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 2) submit_quote_decision RPC 확장 (시그니처 호환 — 옵션 파라미터)
--    기존 호출 (3-arg) 100% 동작 유지. 새 호출이 서명 메타 전달.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.submit_quote_decision(
  p_token              text,
  p_decision           text,
  p_note               text DEFAULT NULL,
  p_signature_method   text DEFAULT NULL,
  p_signature_data_url text DEFAULT NULL,
  p_signed_contract_url  text DEFAULT NULL,
  p_signed_contract_html text DEFAULT NULL,
  p_signer_ip          text DEFAULT NULL,
  p_signer_user_agent  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row quote_approvals%ROWTYPE;
  v_next_stage text;
  v_company_id uuid;
  v_sig_method text;
BEGIN
  IF p_decision NOT IN ('approved','rejected') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid');
  END IF;
  IF p_token IS NULL OR length(p_token) < 16 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid');
  END IF;

  SELECT * INTO v_row FROM quote_approvals WHERE approval_token = p_token LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid');
  END IF;

  IF v_row.status IN ('approved','rejected') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'already_decided', 'status', v_row.status);
  END IF;
  IF v_row.expires_at IS NOT NULL AND v_row.expires_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'code', 'expired');
  END IF;

  -- 서명 메타 정규화 (approved + valid method 만 저장)
  v_sig_method := COALESCE(p_signature_method, 'none');
  IF v_sig_method NOT IN ('draw','type','upload','seal','none') THEN
    v_sig_method := 'none';
  END IF;

  -- 결정 + 서명 메타 한 번에 UPDATE
  UPDATE quote_approvals
     SET status = p_decision,
         decided_at = now(),
         decision_note = p_note,
         signature_method     = CASE WHEN p_decision='approved' THEN v_sig_method ELSE signature_method END,
         signature_data_url   = CASE WHEN p_decision='approved' THEN p_signature_data_url ELSE signature_data_url END,
         signed_contract_url  = CASE WHEN p_decision='approved' THEN p_signed_contract_url ELSE signed_contract_url END,
         signed_contract_html = CASE WHEN p_decision='approved' THEN p_signed_contract_html ELSE signed_contract_html END,
         signer_ip            = CASE WHEN p_decision='approved' THEN p_signer_ip ELSE signer_ip END,
         signer_user_agent    = CASE WHEN p_decision='approved' THEN p_signer_user_agent ELSE signer_user_agent END,
         signed_at_external   = CASE WHEN p_decision='approved' THEN now() ELSE signed_at_external END
   WHERE id = v_row.id;

  v_company_id := v_row.company_id;

  -- 승인 → deals.stage 자동 전환 (기존 로직 그대로)
  IF p_decision = 'approved' THEN
    v_next_stage := CASE v_row.stage
      WHEN 'estimate'         THEN 'contract'
      WHEN 'contract'         THEN 'in_progress'
      WHEN 'progress_report'  THEN 'completed'
      WHEN 'completion'       THEN 'settlement'
      WHEN 'settlement'       THEN NULL
      ELSE NULL
    END;
    IF v_next_stage IS NOT NULL THEN
      UPDATE deals SET stage = v_next_stage WHERE id = v_row.deal_id;
    END IF;
  END IF;

  -- audit_logs (방어적, 기존 패턴 그대로)
  BEGIN
    INSERT INTO audit_logs(company_id, action, entity_type, entity_id, user_id, metadata)
    VALUES (
      v_company_id,
      CASE p_decision WHEN 'approved' THEN 'approve' ELSE 'reject' END,
      'quote_approval',
      v_row.id,
      NULL,
      jsonb_build_object(
        'stage', v_row.stage,
        'next_stage', v_next_stage,
        'note', p_note,
        'signature_method', v_sig_method,
        'signer_ip', p_signer_ip
      )
    );
  EXCEPTION
    WHEN undefined_table THEN NULL;
    WHEN undefined_column THEN NULL;
  END;

  -- 회사 owner/admin 에게 notifications (기존 그대로)
  BEGIN
    INSERT INTO notifications(company_id, user_id, type, title, message, entity_type, entity_id, is_read)
    SELECT v_company_id, u.id, 'approval',
           CASE p_decision
             WHEN 'approved' THEN '거래처 승인 — ' || v_row.stage
             ELSE '거래처 거절 — ' || v_row.stage
           END,
           COALESCE(p_note, ''),
           'quote_approval', v_row.id, false
      FROM users u
     WHERE u.company_id = v_company_id
       AND u.role IN ('owner','admin');
  EXCEPTION
    WHEN undefined_table THEN NULL;
    WHEN check_violation THEN NULL;
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'status', p_decision,
    'deal_stage_after', v_next_stage,
    'stage', v_row.stage,
    'signature_method', v_sig_method
  );
END;
$$;

-- 권한 보존
REVOKE ALL ON FUNCTION public.submit_quote_decision(text, text, text, text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_quote_decision(text, text, text, text, text, text, text, text, text) TO authenticated, anon, service_role;
-- anon 도 호출 가능 (외부 페이지 비로그인 결정 — 토큰으로 인증)

-- PostgREST 스키마 캐시 즉시 reload (시그니처 변경)
NOTIFY pgrst, 'reload schema';
