-- 보안 정비 ① DB 함수 권한.
--   Supabase 보안 진단: SECURITY DEFINER 함수 191개가 익명(anon)으로, 252개가 로그인 사용자로 호출 가능했다.
--   실제 위험: ad_account_secrets_read(광고 API 비밀키 복호화)·apply_credit_purchase(결제 없이 크레딧 적립)·
--   fn_process_invoice_queue(전 회사 계산서 발행)·mark_dormant_deals(전 회사 딜 상태 변경)·consume_*(타사 크레딧 차감)이
--   로그인 없이 REST 로 불렸다. 초대 표는 익명 SELECT 정책으로 invite_token 이 통째로 읽혔다.
SET statement_timeout = '120000';

-- 1) 익명 EXECUTE 는 토큰 기반 공개 함수 + RLS 판정 도우미만 남기고 전부 회수
do $$
declare r record;
  keep text[] := array[
    -- 공개 토큰 흐름(서명·견적·공유·거래처 포털·계약 패키지)
    'get_signature_context_by_token','get_signature_request_by_token','mark_signature_viewed_by_token',
    'save_signer_inputs_by_token','submit_signature_by_token','get_quote_approval_by_token','mark_quote_approval_viewed',
    'submit_quote_decision','get_share_by_token','increment_share_view_count','get_contract_package_by_token',
    'mark_contract_package_viewed','get_partner_portal_context','portal_leave_message','validate_invite_token',
    -- 가입·계정 찾기
    'find_masked_emails_by_name','sales_code_bonus_days',
    -- RLS·스토리지 정책이 부르는 판정 도우미
    'get_my_company_id','current_app_user_id','current_app_user_email','current_employee_id','current_app_employee_id',
    'is_advisor_session','is_platform_operator','is_company_owner','is_company_admin','is_company_master','is_partner_user',
    'has_perm','has_menu_perm','has_min_plan','is_channel_member','storage_object_company','get_my_email','get_my_department',
    'get_company_plan_slug','current_plan_slug','feature_on','leave_accrual_enabled'
  ];
begin
  for r in
    select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) args
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prosecdef
      and pg_get_function_result(p.oid) <> 'trigger'
      and not (p.proname = any(keep))
  loop
    execute format('revoke execute on function public.%I(%s) from anon', r.proname, r.args);
  end loop;
end $$;

-- 2) 서버(service_role)·크론 전용 함수는 로그인 사용자에게서도 회수
do $$
declare f text;
begin
  foreach f in array array[
    'apply_credit_purchase(uuid)','fn_process_invoice_queue()','consume_ai_tokens(uuid,bigint)','consume_issue_credit(uuid)',
    'ad_account_secrets_read(uuid)','run_stock_cost_rebuild_all()','run_production_voucher_cycles()','collect_infra_errors()',
    'auto_clock_out_at_work_end()','find_account(uuid,text,text)','_acct_by(uuid,jsonb,text,text)','_can_write_profit()'
  ] loop
    begin
      execute format('revoke execute on function public.%s from authenticated, anon, public', f);
    exception when undefined_function then null;
    end;
  end loop;
end $$;

-- 3) mark_dormant_deals: 전 회사가 아니라 호출자 회사만. 크론(service_role)은 전체.
create or replace function public.mark_dormant_deals()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare cnt integer; v_company uuid;
begin
  if auth.role() = 'service_role' then
    v_company := null;
  else
    v_company := public.get_my_company_id();
    if v_company is null then raise exception 'forbidden' using errcode = '42501'; end if;
  end if;
  update public.deals
     set is_dormant = true, updated_at = now()
   where is_dormant = false
     and last_activity_at < now() - interval '30 days'
     and status not in ('closed', 'cancelled')
     and (v_company is null or company_id = v_company);
  get diagnostics cnt = row_count;
  return cnt;
end;
$function$;

-- 4) recompute_monthly_financials: 로그인 없는 호출은 service_role 만
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'recompute_monthly_financials';
  if v_def is null then return; end if;
  v_def := replace(v_def,
    '  IF auth.uid() IS NOT NULL THEN',
    '  IF auth.uid() IS NULL AND auth.role() IS DISTINCT FROM ''service_role'' THEN' || chr(10) ||
    '    RAISE EXCEPTION ''forbidden'' USING ERRCODE = ''42501'';' || chr(10) ||
    '  END IF;' || chr(10) ||
    '  IF auth.uid() IS NOT NULL THEN');
  execute v_def;
end $$;

-- 5) 저장공간 팩: 브라우저가 RPC 를 직접 불러 결제 없이 수량을 올릴 수 있었다 → 서버 전용 서명으로 교체
drop function if exists public.set_storage_packs(integer);
create or replace function public.set_storage_packs(p_company uuid, p_count integer)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare q record;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'not authorized'; end if;
  if p_company is null then raise exception 'invalid company'; end if;
  if p_count is null or p_count < 0 or p_count > 10000 then raise exception 'invalid count'; end if;
  select * into q from public.storage_quota_params(p_company);
  if not q.effective_paid then raise exception 'no subscription'; end if;
  update public.subscriptions set storage_pack_count = p_count, updated_at = now()
    where company_id = p_company;
  if not found then raise exception 'no subscription'; end if;
  return p_count;
end $function$;
revoke all on function public.set_storage_packs(uuid, integer) from public, anon, authenticated;
grant execute on function public.set_storage_packs(uuid, integer) to service_role;

-- 6) 초대: 익명이 표를 통째로 읽던 정책 제거 → 토큰으로 한 건만 돌려주는 RPC
drop policy if exists employee_invitations_token_read on public.employee_invitations;
drop policy if exists partner_invitations_token_read on public.partner_invitations;

create or replace function public.validate_invite_token(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare v jsonb;
begin
  if p_token is null or length(p_token) < 16 then return null; end if;
  select jsonb_build_object('type','partner','data', jsonb_build_object(
           'id', pi.id, 'email', pi.email, 'name', pi.name, 'role', pi.role, 'status', pi.status,
           'expires_at', pi.expires_at, 'company_id', pi.company_id,
           'company_name', (select c.name from companies c where c.id = pi.company_id)))
    into v
  from partner_invitations pi
  where pi.invite_token = p_token and pi.status = 'pending'
    and (pi.expires_at is null or pi.expires_at > now())
  limit 1;
  if v is not null then return v; end if;
  select jsonb_build_object('type','employee','data', jsonb_build_object(
           'id', ei.id, 'email', ei.email, 'name', ei.name, 'role', ei.role, 'status', ei.status,
           'expires_at', ei.expires_at, 'company_id', ei.company_id,
           'company_name', (select c.name from companies c where c.id = ei.company_id)))
    into v
  from employee_invitations ei
  where ei.invite_token = p_token and ei.status = 'pending'
    and (ei.expires_at is null or ei.expires_at > now())
  limit 1;
  return v;
end $function$;
revoke all on function public.validate_invite_token(text) from public;
grant execute on function public.validate_invite_token(text) to anon, authenticated, service_role;
