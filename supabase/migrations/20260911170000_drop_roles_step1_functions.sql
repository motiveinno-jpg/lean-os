-- 역할(대표·관리자·직원)을 완전히 없앤다 — 1단계: 판정·알림을 마스터 + 권한으로 (2026-09-11 사장님).
--   이 제품의 계정은 **마스터와 멤버**뿐이고 나머지는 권한 부여다. 파트너·세무사는 역할이 아니라
--   계정 종류라 그대로 둔다. 아래 함수들은 운영 정의를 그대로 받아 role 을 보던 줄만 갈아 끼웠다.
begin;

--   알림을 받을 사람 고르기 — 회사 안에서 마스터이거나, 그 일에 해당하는 권한을 받은 사람.
create or replace function public.company_notify_users(p_company uuid, p_patterns text[])
returns setof uuid language sql stable security definer set search_path = 'public' as $$
  select u.id from public.users u
   where u.company_id = p_company
     and (coalesce(u.is_master, false)
          or exists (select 1 from public.member_permissions m
                      where m.user_id = u.id and m.perm_key like any (p_patterns)))
$$;
grant execute on function public.company_notify_users(uuid, text[]) to authenticated;

--   전표 서명 알림 — 받는 사람을 역할이 아니라 재무 권한으로
CREATE OR REPLACE FUNCTION public._notify_signed_voucher(p_company uuid, p_deal uuid, p_title text, p_message text, p_link text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  insert into public.notifications (company_id, user_id, type, title, message, entity_type, entity_id, is_read, created_at, link)
  select p_company, u.id, 'deal_update', p_title, p_message, 'deal', p_deal, false, now(), p_link
    from public.users u
   where u.id in (select public.company_notify_users(p_company, array['/bank%','/collect%','/finance%','/partners/reconciliation%','/reports%','/dashboard:finance']));
$function$
;

--   계약 계산서 초안 알림 — 세금·재무 권한자에게
CREATE OR REPLACE FUNCTION public.make_contract_invoice_drafts_for(p_company uuid, p_today date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare d record; ps jsonb; i int; t jsonb; n int := 0; total numeric; alloc numeric; amt numeric; tax_kind text; vat numeric; v_id uuid; pname text; pid uuid; bizno text; item text; new_ps jsonb;
begin
  for d in select id, deal_id, name, content_json from documents where company_id = p_company and status <> 'void' and content_json ? 'paymentSchedule' loop
    ps := d.content_json->'paymentSchedule'; if jsonb_typeof(ps) <> 'array' then continue; end if;
    if not exists (select 1 from jsonb_array_elements(ps) e where (e->>'dueDate') ~ '^\d{4}-\d{2}-\d{2}$' and (e->>'dueDate')::date <= p_today and coalesce(e->>'invoiceId', '') = '') then continue; end if;
    total := coalesce((select sum((x->>'supplyAmount')::numeric) from jsonb_array_elements(coalesce(d.content_json->'items', '[]'::jsonb)) x where (x->>'supplyAmount') ~ '^-?[0-9.]+$'), 0);
    if total <= 0 then total := coalesce((select amount from documents where id = d.id), 0); end if;
    if total <= 0 then continue; end if;
    tax_kind := case coalesce(d.content_json->'header'->>'taxType', 'taxable') when 'exempt' then 'exempt' when 'zero_rated' then 'zero_rated' when 'zero' then 'zero_rated' else 'taxable' end;
    pname := coalesce(d.content_json->'header'->>'partnerName', (select counterparty from documents where id = d.id), '거래처');
    pid := nullif(d.content_json->'header'->>'partnerId', '')::uuid;
    select business_number into bizno from partners where id = pid;
    item := coalesce((select x->>'name' from jsonb_array_elements(coalesce(d.content_json->'items', '[]'::jsonb)) x limit 1), d.name);
    alloc := 0; new_ps := '[]'::jsonb;
    for i in 0 .. jsonb_array_length(ps) - 1 loop
      t := ps->i;
      amt := case when i = jsonb_array_length(ps) - 1 then total - alloc
                  when (t->>'ratio') ~ '^[0-9.]+$' then round(total * (t->>'ratio')::numeric / 100)
                  else coalesce((t->>'amount')::numeric, 0) end;
      alloc := alloc + amt;
      if (t->>'dueDate') ~ '^\d{4}-\d{2}-\d{2}$' and (t->>'dueDate')::date <= p_today and coalesce(t->>'invoiceId', '') = '' and amt > 0 then
        vat := case when tax_kind = 'taxable' then round(amt * 0.1) else 0 end;
        insert into tax_invoices (company_id, deal_id, partner_id, type, counterparty_name, counterparty_bizno, supply_amount, tax_amount, total_amount, issue_date, status, label, item_name, tax_kind, source, auto_issued)
        values (p_company, d.deal_id, pid, 'sales', pname, bizno, amt, vat, amt + vat, (t->>'dueDate')::date, 'draft', regexp_replace(d.name, '\s*계약서$', '') || ' ' || (t->>'label'), item, tax_kind, 'auto', true)
        returning id into v_id;
        t := t || jsonb_build_object('invoiceId', v_id);
        n := n + 1;
      end if;
      new_ps := new_ps || jsonb_build_array(t);
    end loop;
    update documents set content_json = jsonb_set(content_json, '{paymentSchedule}', new_ps), updated_at = now() where id = d.id;
  end loop;
  if n > 0 then
    insert into notifications (company_id, user_id, type, title, message, entity_type, is_read, created_at, link)
    select p_company, u.id, 'system', format('계약 회차 도래 — 발행 대기 %s건', n), '예정일이 된 회차의 세금계산서 초안을 만들어 두었습니다. 세금·증빙에서 확인하고 발행하세요.', 'contract_invoice', false, now(), '/tax-invoices'
      from users u where u.id in (select public.company_notify_users(p_company, array['/tax-invoices%','/finance%','/reports%','/dashboard:finance']));
  end if;
  return n;
end $function$
;

--   파트너 포털 휴가 메시지 — 인사·근태 권한자에게
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

  INSERT INTO partner_communications (partner_id, company_id, comm_type, summary, notes, comm_date)
  VALUES (v_partner.id, v_partner.company_id, 'other', '[포털 문의] ' || left(v_msg, 80), v_msg, current_date);

  INSERT INTO notifications (company_id, user_id, type, title, message, entity_type, entity_id, is_read)
  SELECT v_partner.company_id, u.id, 'system',
         '포털 문의: ' || v_partner.name, left(v_msg, 120), 'partner', v_partner.id, false
  FROM users u
  WHERE u.id IN (select public.company_notify_users(v_partner.company_id, array['/employees%','/attendance%']));

  RETURN true;
END;
$function$
;

--   견적 결정 알림 — 프로젝트·재무 권한자에게
CREATE OR REPLACE FUNCTION public.submit_quote_decision(p_token text, p_decision text, p_note text DEFAULT NULL::text, p_signature_method text DEFAULT NULL::text, p_signature_data_url text DEFAULT NULL::text, p_signed_contract_url text DEFAULT NULL::text, p_signed_contract_html text DEFAULT NULL::text, p_signer_ip text DEFAULT NULL::text, p_signer_user_agent text DEFAULT NULL::text, p_signer_company_name text DEFAULT NULL::text, p_signer_business_number text DEFAULT NULL::text, p_signer_representative text DEFAULT NULL::text)
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
         AND u.id IN (select public.company_notify_users(u.company_id, array['/projecthub%','/documents%','/finance%','/reports%','/dashboard:finance']));
    EXCEPTION
      WHEN undefined_table THEN NULL;
      WHEN check_violation THEN NULL;
    END;
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'status', v_final_status, 'deal_stage_after', v_next_stage,
    'stage', v_row.stage, 'signature_method', v_sig_method);
END;
$function$
;

--   서명 완료 알림 — 전자계약·문서 권한자와 보낸 사람에게
CREATE OR REPLACE FUNCTION public.submit_signature_by_token(p_token text, p_signature_data jsonb, p_signed_contract_html text DEFAULT NULL::text, p_signature_method text DEFAULT NULL::text, p_signature_data_url text DEFAULT NULL::text, p_ip text DEFAULT NULL::text, p_snapshot_sha256 text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid; v_status text; v_expires timestamptz; v_company_id uuid; v_signer_name text; v_title text; v_created_by uuid;
  v_snapshot text; v_snapshot_hash text; v_signed_hash text;
begin
  if not public.is_service_request() then
    raise exception '서명 제출은 서버를 통해서만 처리됩니다' using errcode = '42501';
  end if;
  if p_token is null or length(p_token) < 8 then
    raise exception '유효하지 않은 토큰' using errcode = '22023';
  end if;

  select id, status, expires_at, company_id, signer_name, title, created_by, template_snapshot_html
    into v_id, v_status, v_expires, v_company_id, v_signer_name, v_title, v_created_by, v_snapshot
  from signature_requests where sign_token = p_token limit 1;

  if v_id is null then raise exception '서명 요청을 찾을 수 없습니다' using errcode = 'P0002'; end if;
  if v_status = 'signed' then raise exception '이미 서명 완료된 요청입니다' using errcode = 'P0001'; end if;
  if v_expires is not null and v_expires < now() then raise exception '서명 요청이 만료되었습니다' using errcode = 'P0001'; end if;

  -- 서버가 합성에 쓴 원문이 보관된 스냅샷과 같은지 대조 (스냅샷이 있을 때만)
  v_snapshot_hash := case when v_snapshot is null then null else encode(extensions.digest(v_snapshot, 'sha256'), 'hex') end;
  if v_snapshot_hash is not null and p_snapshot_sha256 is not null and p_snapshot_sha256 <> v_snapshot_hash then
    raise exception '계약 원문이 보관본과 다릅니다' using errcode = 'P0001';
  end if;
  v_signed_hash := case when p_signed_contract_html is null then null else encode(extensions.digest(p_signed_contract_html, 'sha256'), 'hex') end;

  update signature_requests
     set status = 'signed',
         signed_at = now(),
         signature_data = p_signature_data,
         signature_method = p_signature_method,
         signature_data_url = p_signature_data_url,
         signed_contract_html = coalesce(p_signed_contract_html, signed_contract_html),
         ip_address = p_ip,
         snapshot_sha256 = v_snapshot_hash,
         signed_sha256 = v_signed_hash,
         signed_user_agent = left(p_user_agent, 400)
   where id = v_id and status in ('sent', 'viewed');
  if not found then raise exception '서명 가능한 상태가 아닙니다' using errcode = 'P0001'; end if;

  begin
    insert into notifications (company_id, user_id, type, title, message, entity_type, entity_id, link)
    select v_company_id, u.id, 'signature_request',
           '계약서 서명 완료',
           coalesce(nullif(v_signer_name, ''), '거래처') || '님이 "' || coalesce(nullif(v_title, ''), '계약서') || '"에 서명했습니다',
           'signature', v_id, '/contracts/signed/' || v_id::text
    from users u
    where u.company_id = v_company_id and (u.id in (select public.company_notify_users(v_company_id, array['/signatures%','/documents%'])) or u.id = v_created_by);
  exception when others then null;
  end;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$function$
;

--   회사 주인 = 마스터. 역할 'owner' 는 없앤다
CREATE OR REPLACE FUNCTION public.is_company_owner()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS(
    SELECT 1 FROM users WHERE auth_id = auth.uid() AND coalesce(is_master, false)
  );
$function$
;

--   좌석 쿠폰 — 마스터 또는 결제 권한자
CREATE OR REPLACE FUNCTION public.redeem_seat_coupon(p_coupon_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user users%rowtype;
  v_coupon billing_seat_coupons%rowtype;
begin
  select * into v_user from users where auth_id = auth.uid() limit 1;
  if v_user.id is null then
    return json_build_object('ok', false, 'error', '로그인이 필요합니다');
  end if;
  if not (coalesce(v_user.is_master, false) or public.has_perm('/billing')) then
    return json_build_object('ok', false, 'error', '관리자/대표만 쿠폰을 사용할 수 있습니다');
  end if;
  select * into v_coupon from billing_seat_coupons
    where id = p_coupon_id and company_id = v_user.company_id for update;
  if v_coupon.id is null then
    return json_build_object('ok', false, 'error', '쿠폰을 찾을 수 없습니다');
  end if;
  if v_coupon.status <> 'issued' then
    return json_build_object('ok', false, 'error', '이미 사용되었거나 만료된 쿠폰입니다');
  end if;
  update billing_seat_coupons
    set status = 'redeemed', redeemed_at = now(), redeemed_by = v_user.id
    where id = v_coupon.id;
  return json_build_object('ok', true, 'free_seats', v_coupon.free_seats);
end $function$
;

--   휴가 적립 동기화 — 마스터 또는 인사 권한자
CREATE OR REPLACE FUNCTION public.sync_my_leave_accruals()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_company uuid;
  v_role    text;
  v_master  boolean;
BEGIN
  SELECT company_id, role, COALESCE(is_master, false)
    INTO v_company, v_role, v_master
    FROM users WHERE auth_id = auth.uid();
  IF v_company IS NULL OR NOT (v_master OR public.has_perm('/employees:leave') OR public.has_perm('/employees:employees')) THEN
    RAISE EXCEPTION '권한이 없습니다';
  END IF;
  RETURN public.generate_leave_accruals(v_company);
END;
$function$
;

--   운영자 화면의 '관리자 수' = 마스터 수
CREATE OR REPLACE FUNCTION public.get_company_overview(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
  v_24h timestamptz := now() - interval '24 hours';
BEGIN
  IF NOT public.is_platform_operator() THEN
    RAISE EXCEPTION 'platform operator only' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'company', to_jsonb(c.*),
    'user_count', COALESCE((SELECT count(*) FROM users WHERE company_id = c.id), 0),
    'admin_count', COALESCE((SELECT count(*) FROM users WHERE company_id = c.id AND coalesce(is_master, false)), 0),
    'employee_count', COALESCE((SELECT count(*) FROM employees WHERE company_id = c.id AND status NOT IN ('left','withdrawn')), 0),
    'subscription', (
      SELECT to_jsonb(s.*) || jsonb_build_object('plan', to_jsonb(sp.*))
      FROM subscriptions s
      LEFT JOIN subscription_plans sp ON sp.id = s.plan_id
      WHERE s.company_id = c.id
      ORDER BY s.created_at DESC
      LIMIT 1
    ),
    'paid_invoices_total', COALESCE((
      SELECT sum(total_amount) FROM invoices WHERE company_id = c.id AND status = 'paid'
    ), 0),
    'paid_invoices_count', COALESCE((
      SELECT count(*) FROM invoices WHERE company_id = c.id AND status = 'paid'
    ), 0),
    'bank_tx_count', COALESCE((
      SELECT count(*) FROM bank_transactions WHERE company_id = c.id
    ), 0),
    'card_tx_count', COALESCE((
      SELECT count(*) FROM card_transactions WHERE company_id = c.id
    ), 0),
    'deals_count', COALESCE((
      SELECT count(*) FROM deals WHERE company_id = c.id
    ), 0),
    'deals_active_count', COALESCE((
      SELECT count(*) FROM deals WHERE company_id = c.id AND stage NOT IN ('done','dropped','closed')
    ), 0),
    'errors_24h', COALESCE((
      SELECT count(*) FROM error_logs WHERE company_id = c.id AND created_at >= v_24h AND resolved = false
    ), 0),
    'last_login_at', (
      SELECT max(au.last_sign_in_at)
      FROM auth.users au
      WHERE au.id IN (SELECT id FROM public.users WHERE company_id = c.id)
    ),
    'created_at', c.created_at
  )
  INTO v_result
  FROM companies c
  WHERE c.id = p_company_id;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'company not found' USING ERRCODE = 'P0002';
  END IF;

  RETURN v_result;
END;
$function$
;

--   합류 요청 승인 — 마스터 또는 구성원 권한자. 승인해 들이는 사람의 역할은 언제나 'member'
CREATE OR REPLACE FUNCTION public.resolve_company_join_request(p_request_id uuid, p_action text, p_role text, p_reason text, p_resolver_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  r_company uuid; r_role text; r_master boolean; req record; v_role text; v_name text; v_target_company uuid; v_caller uuid;
begin
  -- 호출 주체 검증: 서버(service_role)가 아니면 로그인한 본인만, 그것도 승인자 ID 가 자기 자신일 때만.
  --   종전엔 승인자 ID 를 호출자가 지정했고 PUBLIC 실행 권한이 남아 익명도 함수에 들어올 수 있었다.
  if not public.is_service_request() then
    if auth.uid() is null then
      return jsonb_build_object('error', 'unauthenticated');
    end if;
    select id into v_caller from public.users where auth_id = auth.uid() limit 1;
    if v_caller is null or v_caller is distinct from p_resolver_user_id then
      return jsonb_build_object('error', 'forbidden_resolver_mismatch');
    end if;
  end if;
  if p_action not in ('approve', 'reject') then
    return jsonb_build_object('error', 'bad_action');
  end if;
  select company_id, role, coalesce(is_master, false) into r_company, r_role, r_master from public.users where id = p_resolver_user_id;
  if r_company is null then
    return jsonb_build_object('error', 'resolver_no_company');
  end if;
  if not (r_master or public.has_perm('/settings:team')) then
    return jsonb_build_object('error', 'forbidden_not_admin');
  end if;
  select * into req from public.company_join_requests where id = p_request_id for update;
  if not found then
    return jsonb_build_object('error', 'not_found');
  end if;
  if req.company_id <> r_company then
    return jsonb_build_object('error', 'forbidden_other_company');
  end if;
  if p_action = 'approve' and req.status = 'approved' then
    return jsonb_build_object('ok', true, 'status', 'approved', 'already', true,
      'requester_auth_id', req.requester_auth_id, 'granted_role', req.granted_role);
  end if;
  if p_action = 'reject' and req.status = 'rejected' then
    return jsonb_build_object('ok', true, 'status', 'rejected', 'already', true);
  end if;
  if req.status = 'pending' and req.expires_at is not null and req.expires_at < now() then
    update public.company_join_requests set status = 'expired' where id = req.id;
    return jsonb_build_object('error', 'expired');
  end if;
  if req.status <> 'pending' then
    return jsonb_build_object('error', 'already_resolved', 'status', req.status);
  end if;
  if p_action = 'reject' then
    update public.company_join_requests
      set status = 'rejected', resolved_by = p_resolver_user_id, resolved_at = now(),
          rejection_reason = nullif(btrim(coalesce(p_reason, '')), '')
      where id = req.id;
    insert into public.notifications (company_id, user_id, type, title, message, entity_type, entity_id, is_read)
      values (req.company_id, req.requester_auth_id, 'company_join_request',
              '회사 가입 요청 결과', '가입 요청이 거절되었습니다. 자세한 내용은 메일을 확인해주세요.',
              'company_join_request', req.id, false);
    return jsonb_build_object('ok', true, 'status', 'rejected', 'requester_auth_id', req.requester_auth_id);
  end if;
  select company_id into v_target_company from public.users where auth_id = req.requester_auth_id;
  if v_target_company is not null and v_target_company <> r_company then
    return jsonb_build_object('error', 'requester_in_other_company');
  end if;
  v_role := 'member';   --   역할은 하나뿐이다. 무엇을 할 수 있는지는 권한으로 준다.
  v_name := coalesce(req.requester_name, split_part(req.requester_email, '@', 1));
  insert into public.users (id, auth_id, email, name, company_id, role)
    values (req.requester_auth_id, req.requester_auth_id, req.requester_email, v_name, r_company, v_role)
    on conflict (id) do update set company_id = excluded.company_id, role = excluded.role, name = excluded.name;
  -- 2026-07-28: employees 연결/생성 — 승인된 직원이 구성원 목록·출퇴근에서 빠지던 결함 수정
  update public.employees
     set user_id = req.requester_auth_id,
         status = case when status = 'invited' then 'joined' else status end
   where company_id = r_company
     and (user_id = req.requester_auth_id or lower(email) = lower(req.requester_email));
  if not found then
    insert into public.employees (company_id, user_id, name, email, hire_date, status)
    values (r_company, req.requester_auth_id, v_name, req.requester_email,
            (now() at time zone 'Asia/Seoul')::date, 'joined');
  end if;
  update public.company_join_requests
    set status = 'approved', resolved_by = p_resolver_user_id, resolved_at = now(), granted_role = v_role
    where id = req.id;
  insert into public.notifications (company_id, user_id, type, title, message, entity_type, entity_id, is_read)
    values (r_company, req.requester_auth_id, 'company_join_request',
            '회사 가입이 승인되었습니다', '가입이 승인되었습니다. 이제 회사 페이지를 사용할 수 있습니다.',
            'company_join_request', req.id, false);
  return jsonb_build_object('ok', true, 'status', 'approved',
    'requester_auth_id', req.requester_auth_id, 'granted_role', v_role);
end;
$function$
;

--   새 멤버 기본 권한 시드 — 역할 목록 대신 'member'
CREATE OR REPLACE FUNCTION public._trg_users_seed_default_perms()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.company_id is not null and new.role = 'member' and coalesce(new.is_master, false) = false
     and (tg_op = 'INSERT' or old.company_id is distinct from new.company_id or old.role is distinct from new.role) then
    perform public._seed_member_default_perms(new.company_id, new.id);
  end if;
  return new;
end $function$
;

commit;
