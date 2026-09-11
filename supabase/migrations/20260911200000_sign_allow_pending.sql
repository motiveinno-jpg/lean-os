--   "생성 즉시 이메일 발송" 을 끄면 그 계약은 링크로 영원히 서명할 수 없었다.
--
--   체크를 끄면 signature_requests.status 가 'pending' 으로 남는다. 그런데 서명 제출 RPC 의
--   UPDATE 가 status in ('sent','viewed') 라 0행이 맞고 '서명 가능한 상태가 아닙니다' 로 끝난다.
--   목록의 서명 링크 버튼은 signed 가 아니면 다 뜨므로, 서명자는 계약서를 다 읽고 서명까지
--   그린 뒤에야 막혔다. 사내 서명 경로는 2026-08-21 에 이미 pending 을 허용했는데
--   토큰 RPC 만 빠져 있었다.
--
--   ⚠️ 운영 함수 정의를 그대로 받아 where 절 한 줄만 바꿨다(본문을 새로 쓰면 그동안의
--      해시 대조·알림 분기가 조용히 사라진다 — 지난 사고의 형태).

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
   where id = v_id and status in ('sent', 'viewed', 'pending');
  --   pending = '생성 즉시 발송' 을 끈 요청. 링크(token)가 비밀값이므로 발송 방식과
  --   서명 가능 여부는 별개다. 취소·만료(expired)는 위 검사와 이 목록에서 계속 막힌다.
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
