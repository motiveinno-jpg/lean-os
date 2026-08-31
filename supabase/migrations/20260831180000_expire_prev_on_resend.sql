-- security-reviewer C-1 (배포 차단) + W-1 겸수정
--
-- History: 20260520180000_quote_approvals.sql 는 "발송 = 새 행 INSERT" 로 설계됐고,
--   20260831170000_quote_revision_and_hardening.sql 이 수정 요청 왕복(핑퐁)을 열면서
--   `revision_requested → 고쳐서 재발송` 이 정상 경로가 됐다. 그런데 resend_quote_approval 은
--   새 행만 만들고 이전 행을 그대로 둔다 — 이전 행은 여전히 status='sent'/'viewed'/'revision_requested'
--   에 expires_at 도 살아 있어, 거래처 메일함에 남은 **옛 링크로 폐기된 옛 버전을 승인·서명**할 수 있었다.
--   (submit_quote_decision 은 토큰으로 행을 찾을 뿐 "이게 최신인가" 를 묻지 않는다.)
--
-- 자문자답
--   ① 무엇을 기준으로 막나 — '최신 여부' 를 새로 계산하지 않는다. 이미 있는 게이트
--      (expires_at < now() → code:'expired') 를 재사용해 재발송 순간 이전 행을 만료시킨다.
--      새 판단 기준을 만들면 화면·RLS·리포트가 다 같이 흔들린다.
--   ② 왜 status 는 안 바꾸나 — 프로젝트/계약 카드가 status='rejected'|'revision_requested' 로
--      "거래처 수정 요청 사유" 카드를 띄운다(project-quote-stages.tsx:458, contract-stage-card.tsx:289).
--      status 를 'expired' 로 덮으면 재발송하는 순간 사유가 화면에서 사라진다. → expires_at 만 건드린다.
--   ③ 반대 경우 — 이미 결론난 행(approved/rejected/fully_signed/pending_our_signature)은
--      already_decided 게이트가 이미 막고, 서명 완료본의 만료일을 지금으로 당기면 이력이 거짓이 된다. → 제외.
--   ④ 자동으로 못 푸는 것 — 거래처가 옛 링크를 눌렀을 때 "새 링크를 다시 받으세요" 를 대신 보내주지는 못한다.
--      화면은 기존 만료 안내 그대로. (별건)
--
-- 결정 1) 재발송 = 이전 행 즉시 만료 (expires_at := now(), status 무변)
--   AS_IS ▶ 옛 토큰으로 폐기 버전 승인·서명 가능  TO_BE ▶ code:'expired' 로 거부
--   적용 시점: 이 마이그레이션 이후 재발송분부터. 기존 데이터: 소급 만료 없음(이미 보낸 링크를
--   일괄로 죽이면 진행 중 건이 끊긴다 — 다음 재발송 때 자연히 정리된다).
-- 결정 2) W-1 p_note 서버측 2000자 절단 — 클라 maxLength 500 은 REST 직접 호출로 우회된다.
-- 결정 3) W-1 수정요청 알림 디바운스 30초 — 같은 행에 수정요청이 연달아 들어오면 알림만 생략(audit 은 남긴다).

-- ─────────────────────────────────────────────────────────────
-- 1. resend_quote_approval — 새 행 INSERT 전에 이전 행 만료
--    (본문은 20260731120000_rpc_perm_gates 판 그대로 + UPDATE 한 문단)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.resend_quote_approval(p_prev_id uuid, p_payload jsonb DEFAULT NULL::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_prev quote_approvals%ROWTYPE;
  v_new_id uuid;
  v_uid uuid := current_app_user_id();
  v_my_company uuid := get_my_company_id();
BEGIN
  IF v_uid IS NULL OR v_my_company IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;
  SELECT * INTO v_prev FROM quote_approvals WHERE id = p_prev_id LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not found';
  END IF;
  -- 권한: admin 또는 본인 created_by
  IF NOT ((public.is_company_admin() OR public.has_perm('/projecthub')) OR v_prev.created_by = v_uid) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF v_prev.company_id <> v_my_company THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- C-1: 옛 링크 무력화. 새 행을 만드는 순간 이전 버전은 폐기본이다.
  --      status 는 건드리지 않는다(수정요청·거절 사유 카드 조건이 status 를 본다).
  --      submit_quote_decision 의 expires_at 게이트가 code:'expired' 로 돌려보낸다.
  --      1초 앞: 그 게이트가 strict `expires_at < now()` 라 정확히 같은 타임스탬프면 통과한다.
  --      (실측: 같은 트랜잭션 안에서 now() 가 고정돼 옛 토큰이 승인됐다.) 경계값을 없앤다.
  UPDATE quote_approvals
     SET expires_at = now() - interval '1 second'
   WHERE id = v_prev.id
     AND status NOT IN ('approved','rejected','fully_signed','pending_our_signature');

  INSERT INTO quote_approvals(
    company_id, deal_id, stage, payload, approval_token, status,
    recipient_email, recipient_name, partner_id, expires_at, created_by
  ) VALUES (
    v_prev.company_id,
    v_prev.deal_id,
    v_prev.stage,
    COALESCE(p_payload, v_prev.payload),
    generate_approval_token(),
    'draft',
    v_prev.recipient_email,
    v_prev.recipient_name,
    v_prev.partner_id,
    NULL,  -- 발송 시점에 채움
    v_uid
  )
  RETURNING id INTO v_new_id;
  RETURN v_new_id;
END;
$function$;

-- ─────────────────────────────────────────────────────────────
-- 2. submit_quote_decision — W-1 2건만 추가
--    (본문은 20260831170000_quote_revision_and_hardening 판 그대로)
--    · p_note 서버측 2000자 절단
--    · 수정요청 알림 30초 디바운스 (audit 은 그대로 남긴다)
-- ─────────────────────────────────────────────────────────────
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
  p_signer_representative text DEFAULT NULL::text)
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
  v_skip_notify boolean := false;
BEGIN
  -- W-1: 서버측 길이 제한. 클라(maxLength 500)는 REST 직접 호출로 우회된다.
  p_note := left(btrim(p_note), 2000);

  IF p_decision NOT IN ('approved','rejected','revision_requested') THEN RETURN jsonb_build_object('ok', false, 'code', 'invalid'); END IF;
  IF p_decision = 'revision_requested' AND (p_note IS NULL OR length(trim(p_note)) = 0) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'note_required');
  END IF;
  IF p_token IS NULL OR length(p_token) < 16 THEN RETURN jsonb_build_object('ok', false, 'code', 'invalid'); END IF;
  SELECT * INTO v_row FROM quote_approvals WHERE approval_token = p_token LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'invalid'); END IF;
  IF v_row.status IN ('approved','rejected','fully_signed','pending_our_signature') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'already_decided', 'status', v_row.status);
  END IF;
  IF v_row.expires_at IS NOT NULL AND v_row.expires_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'code', 'expired');
  END IF;

  -- W-1: 수정요청 연타 디바운스 — 같은 행에서 30초 안에 또 수정요청이면 알림만 생략.
  --   (결정·audit·decision_note 는 정상 반영된다. 관리자 알림함만 도배되지 않게.)
  v_skip_notify := (p_decision = 'revision_requested'
                    AND v_row.status = 'revision_requested'
                    AND v_row.decided_at IS NOT NULL
                    AND v_row.decided_at > now() - interval '30 seconds');

  v_sig_method := COALESCE(p_signature_method, 'none');
  IF v_sig_method NOT IN ('draw','type','upload','seal','none') THEN v_sig_method := 'none'; END IF;
  v_signer_patch := jsonb_strip_nulls(jsonb_build_object(
    'signer_company_name', p_signer_company_name,
    'signer_business_number', p_signer_business_number,
    'signer_representative', p_signer_representative));

  IF p_decision = 'approved' AND v_row.stage = 'contract' THEN
    v_final_status := 'pending_our_signature';
  ELSE
    v_final_status := p_decision;   -- rejected | revision_requested | approved
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

  -- 단계 전진은 '완전 승인' 일 때만 (수정 요청·거절·우리 서명 대기 는 그대로)
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
      CASE p_decision
        WHEN 'approved' THEN 'approve'
        WHEN 'revision_requested' THEN 'revision_request'
        ELSE 'reject' END,
      'quote_approval', v_row.id, NULL,
      jsonb_build_object(
        'stage', v_row.stage, 'next_stage', v_next_stage, 'note', p_note,
        'signature_method', v_sig_method, 'signer_ip', p_signer_ip,
        'signer_company_name', p_signer_company_name,
        'signer_representative', p_signer_representative,
        'final_status', v_final_status,
        'notify_debounced', v_skip_notify));
  EXCEPTION
    WHEN undefined_table THEN NULL;
    WHEN undefined_column THEN NULL;
  END;

  SELECT p.name, p.representative INTO v_partner_name, v_partner_rep
  FROM deals d
  LEFT JOIN partners p ON p.id = d.partner_id
  WHERE d.id = v_row.deal_id
  LIMIT 1;
  IF v_partner_name IS NULL OR length(trim(v_partner_name)) = 0 THEN
    v_partner_name := COALESCE(NULLIF(trim(p_signer_company_name), ''), '거래처');
  END IF;

  v_decider := COALESCE(
    NULLIF(trim(p_signer_representative), ''),
    NULLIF(trim(v_row.recipient_name), ''),
    NULLIF(trim(v_partner_rep), ''),
    '담당자'
  );

  v_stage_ko := public.stage_label_ko(v_row.stage);
  v_decided_at_ko := to_char((now() AT TIME ZONE 'Asia/Seoul'), 'YYYY-MM-DD HH24:MI');

  IF v_final_status = 'pending_our_signature' THEN
    v_title := v_stage_ko || ' 거래처 서명 완료 — 우리 서명 대기 · ' || v_partner_name;
  ELSIF p_decision = 'approved' THEN
    v_title := v_stage_ko || ' 승인 · ' || v_partner_name;
  ELSIF p_decision = 'revision_requested' THEN
    v_title := '거래처 수정 요청 — ' || v_stage_ko || ' · ' || v_partner_name;
  ELSE
    v_title := v_stage_ko || ' 거절 · ' || v_partner_name;
  END IF;
  IF v_decider <> '담당자' AND v_decider <> v_partner_name THEN
    v_title := v_title || ' (' || v_decider || ')';
  END IF;

  v_message := v_decider || ' · ' || v_decided_at_ko;
  IF p_note IS NOT NULL AND length(trim(p_note)) > 0 THEN
    IF p_decision = 'revision_requested' THEN
      v_message := v_message || ' · 요청: ' || trim(p_note);
    ELSIF p_decision = 'rejected' THEN
      v_message := v_message || ' · 사유: ' || trim(p_note);
    END IF;
  END IF;

  IF NOT v_skip_notify THEN
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
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'status', v_final_status, 'deal_stage_after', v_next_stage,
    'stage', v_row.stage, 'signature_method', v_sig_method);
END;
$function$;
