-- 보안 점검(2026-09-09) S04: 서명자가 제출한 계약서 HTML 을 그대로 믿지 않는다.
--   종전엔 브라우저가 합성한 signed_contract_html 을 토큰만 맞으면 최종본으로 저장했고, IP 도 클라이언트가 보냈다.
--   이제 합성은 서버(/api/sign/submit)가 보관된 원문 스냅샷으로 하고, 이 함수는 서버(service_role)만 부를 수 있다.
--   원문·최종본의 SHA-256 을 함께 보관해 나중에 위변조를 대조할 수 있게 한다.
create extension if not exists pgcrypto;

alter table public.signature_requests
  add column if not exists snapshot_sha256 text,
  add column if not exists signed_sha256 text,
  add column if not exists signed_user_agent text;

drop function if exists public.submit_signature_by_token(text, jsonb, text, text, text, text);
create or replace function public.submit_signature_by_token(
  p_token text,
  p_signature_data jsonb,
  p_signed_contract_html text default null,
  p_signature_method text default null,
  p_signature_data_url text default null,
  p_ip text default null,
  p_snapshot_sha256 text default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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
    where u.company_id = v_company_id and (u.role in ('owner', 'admin') or u.id = v_created_by);
  exception when others then null;
  end;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$function$;
revoke all on function public.submit_signature_by_token(text, jsonb, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.submit_signature_by_token(text, jsonb, text, text, text, text, text, text) to service_role;

-- 서명자 입력값 저장도 서버 전용
create or replace function public.save_signer_inputs_by_token(p_token text, p_inputs jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_id uuid;
begin
  if not public.is_service_request() then
    raise exception '서명 입력 저장은 서버를 통해서만 처리됩니다' using errcode = '42501';
  end if;
  if p_token is null or length(p_token) < 8 then raise exception '유효하지 않은 토큰' using errcode = '22023'; end if;
  if p_inputs is null then return jsonb_build_object('ok', true, 'noop', true); end if;
  select id into v_id from signature_requests where sign_token = p_token limit 1;
  if v_id is null then raise exception '서명 요청을 찾을 수 없습니다' using errcode = 'P0002'; end if;
  update signature_requests set signer_inputs = p_inputs where id = v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$function$;
revoke all on function public.save_signer_inputs_by_token(text, jsonb) from public, anon, authenticated;
grant execute on function public.save_signer_inputs_by_token(text, jsonb) to service_role;
