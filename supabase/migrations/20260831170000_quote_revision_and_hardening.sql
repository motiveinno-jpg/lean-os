-- 거래처 핑퐁 ①(수정 요청 왕복) + security-reviewer 후속 3건
--
-- History: 20260520180000_quote_approvals.sql 가 승인/거절 2지선다로 만들어졌다.
--   거래처가 "이 부분만 고쳐 주세요" 를 말할 자리가 없어 전부 '거절' 로 눌렀고,
--   거절은 단계 전진을 막을 뿐 아니라 재발송 이력이 '거절 → 재발송' 으로만 남아
--   왕복(핑퐁)인지 진짜 파투인지 구분되지 않았다. 기획 결정 6-2 로 세 번째 결정을 만든다.
--
-- 1) quote_approvals.status 에 'revision_requested' 추가 + submit_quote_decision 3지선다
-- 2) resend_quote_approval — 이전 행 상태 게이트가 없어 무변 (revision_requested 에서도 재발송 동작)
-- 3) W-1 deal_id 회사 소속 검증 트리거 8표 / W-6 트리거 함수 EXECUTE 회수 + 무음 실패 제거
--    (W-2 재무 4표 세무대리인 RESTRICTIVE 는 이미 적용돼 있어 생략)

-- ─────────────────────────────────────────────────────────────
-- 1. status 허용값 확장
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.quote_approvals DROP CONSTRAINT IF EXISTS quote_approvals_status_check;
ALTER TABLE public.quote_approvals ADD CONSTRAINT quote_approvals_status_check
  CHECK (status = ANY (ARRAY[
    'draft','sent','viewed','approved','rejected','expired',
    'pending_our_signature','fully_signed',
    'revision_requested'   -- 핑퐁: 상대가 수정을 요청 — 단계 전진 없음, 재결정 가능
  ]));

-- ─────────────────────────────────────────────────────────────
-- 2. submit_quote_decision — 'revision_requested' 추가
--    · p_note 필수(없으면 ok:false code:'note_required')
--    · status/decided_at/decision_note 만 갱신, deals.stage 전진 없음, 서명칸 무변
--    · 재결정: approved/rejected/fully_signed/pending_our_signature 만 already_decided.
--      revision_requested 는 막지 않으므로 이후 승인·거절 재제출, 수정요청 재발송 모두 가능
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
BEGIN
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
        'final_status', v_final_status));
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

-- ─────────────────────────────────────────────────────────────
-- 3-a. W-1 deal_id 회사 소속 검증 (BEFORE INSERT/UPDATE, 8표)
--   RLS 정책을 재작성하는 대신 트리거로 막는다 — 정책 재생성은 8표 × 4정책 파급이 크고
--   deal_id 는 자동링크 트리거(BEFORE)가 채우는 경로가 있어 정책만으론 늦게 잡힌다.
--   성능: deal_id 가 null 이거나 값이 안 바뀌면 즉시 return (은행·카드 대량 동기화 무영향).
--   트리거 이름을 zz_ 로 두어 기존 BEFORE 자동링크 트리거들 뒤에 돌게 한다(그 결과까지 검사).
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.check_deal_company_match()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER          -- deals 를 RLS 우회로 읽어야 '남의 회사 deal' 과 '없는 deal' 을 구분한다
 SET search_path TO 'public'
AS $function$
DECLARE
  v_deal_company uuid;
BEGIN
  IF NEW.deal_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.deal_id IS NOT DISTINCT FROM OLD.deal_id THEN
    RETURN NEW;   -- 연결이 안 바뀌면 검사 생략
  END IF;

  SELECT d.company_id INTO v_deal_company FROM public.deals d WHERE d.id = NEW.deal_id;

  IF v_deal_company IS NULL THEN
    RAISE EXCEPTION '존재하지 않는 프로젝트에는 연결할 수 없습니다 (%.%)', TG_TABLE_SCHEMA, TG_TABLE_NAME
      USING ERRCODE = '23503';
  END IF;
  IF NEW.company_id IS NULL OR v_deal_company <> NEW.company_id THEN
    RAISE EXCEPTION '다른 회사의 프로젝트에는 연결할 수 없습니다 (%.%)', TG_TABLE_SCHEMA, TG_TABLE_NAME
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.check_deal_company_match() FROM PUBLIC, anon, authenticated;

DO $do$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'bank_transactions','card_transactions','tax_invoices','approval_requests',
    'orders','work_orders','stock_docs','schedule_events'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS zz_deal_company_match ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER zz_deal_company_match BEFORE INSERT OR UPDATE ON public.%I '
      'FOR EACH ROW EXECUTE FUNCTION public.check_deal_company_match()', t);
  END LOOP;
END
$do$;

-- ─────────────────────────────────────────────────────────────
-- 3-c/d. W-6 project_items_notify_followers — 직접 호출 회수 + 무음 실패 제거
--   (본문은 20260831140000_project_items_v3 그대로, exception 에 raise warning 한 줄만 추가)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.project_items_notify_followers()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor    uuid;
  v_changes  text[] := '{}';
  v_deal     text;
  v_message  text;
begin
  if new.status      is distinct from old.status      then v_changes := v_changes || '상태'::text; end if;
  if new.assignee_id is distinct from old.assignee_id then v_changes := v_changes || '담당'::text; end if;
  if new.due_date    is distinct from old.due_date    then v_changes := v_changes || '기한'::text; end if;
  if new.name        is distinct from old.name        then v_changes := v_changes || '이름'::text; end if;
  if array_length(v_changes, 1) is null then
    return new;
  end if;

  select u.id into v_actor from public.users u where u.auth_id = auth.uid() limit 1;

  select d.name into v_deal from public.deals d where d.id = new.deal_id;

  v_message := coalesce(nullif(v_deal, ''), '프로젝트')
            || ' — ' || coalesce(nullif(new.name, ''), '(이름 없음)')
            || ' (' || array_to_string(v_changes, ', ') || ')';

  insert into public.notifications (company_id, user_id, type, title, message, entity_type, entity_id)
  select new.company_id, r.uid, 'deal_update', '프로젝트 할 일 변경', v_message, 'deal', new.deal_id
    from (
      select distinct t.uid
        from unnest(
               coalesce(new.followers, '{}'::uuid[])
               || case when new.assignee_id is null then '{}'::uuid[] else array[new.assignee_id] end
             ) as t(uid)
       where t.uid is not null
    ) r
    join public.users u on u.id = r.uid and u.company_id = new.company_id
   where v_actor is null or r.uid <> v_actor;

  return new;
exception when others then
  raise warning 'project_items_notify_followers 실패(item %): % / %', new.id, sqlstate, sqlerrm;
  return new;
end;
$function$;

REVOKE ALL ON FUNCTION public.project_items_notify_followers() FROM PUBLIC, anon, authenticated;
