-- 보안 정비 ③ — 남은 항목.
--   1) 복호화 함수는 마스터·서버만   2) 세션·IP 제한을 서버가 판정하는 RPC   3) n8n 인입 키를 회사별 비밀키로
--   4) 통장·카드 원본 응답에 남은 계좌·카드번호 마스킹, 현금영수증 식별번호 마스킹
SET statement_timeout = '300000';

-- 1) decrypt_credential / decrypt_json_credentials — 같은 회사 구성원이면 누구나 회사 인증정보를 평문으로 받을 수 있었다
create or replace function public.decrypt_credential(p_ciphertext text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_key text;
begin
  if p_ciphertext is null or trim(p_ciphertext) = '' then return null; end if;
  if auth.role() is distinct from 'service_role' and not public.is_company_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  v_key := get_credential_key();
  if v_key is null then raise exception 'Encryption key not configured'; end if;
  return pgp_sym_decrypt(decode(p_ciphertext, 'base64'), v_key);
end;
$function$;
revoke all on function public.decrypt_credential(text) from public, anon;
grant execute on function public.decrypt_credential(text) to authenticated, service_role;

create or replace function public.decrypt_json_credentials(p_creds jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_result jsonb := p_creds; v_key text; v_field text; v_val text;
begin
  if p_creds is null then return null; end if;
  if auth.role() is distinct from 'service_role' and not public.is_company_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  v_key := get_credential_key();
  if v_key is null then raise exception 'Encryption key not configured'; end if;
  foreach v_field in array array['login_password','cert_password','password'] loop
    v_val := p_creds ->> v_field;
    if v_val is not null and trim(v_val) <> '' then
      begin
        v_result := jsonb_set(v_result, array[v_field], to_jsonb(pgp_sym_decrypt(decode(v_val, 'base64'), v_key)));
      exception when others then null;
      end;
    end if;
  end loop;
  return v_result;
end;
$function$;
revoke all on function public.decrypt_json_credentials(jsonb) from public, anon;
grant execute on function public.decrypt_json_credentials(jsonb) to authenticated, service_role;

-- 2) session_gate(p_ip): 미들웨어가 매 화면 이동 때 부른다. 중복 로그인·허용 IP 밖이면 이유를 돌려준다.
--    마스터는 IP 제한에서 제외(잠기면 풀 사람이 없다). 화면의 안내 장치와 별개로 서버가 강제한다.
create or replace function public.session_gate(p_ip text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare v_uid uuid := auth.uid(); v_sid text := coalesce(auth.jwt() ->> 'session_id', '');
        v_active text; v_row record; v_conf jsonb; v_ips text[]; v_master boolean := false;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'unauthenticated'); end if;
  select u.company_id, u.is_master into v_row from users u where u.auth_id = v_uid limit 1;
  v_master := coalesce(v_row.is_master, false);
  -- 중복 로그인: 이 계정의 활성 세션이 지금 세션과 다르면 밀려난 것
  select s.session_id into v_active from active_sessions s where s.auth_id = v_uid limit 1;
  if v_active is not null and v_sid <> '' and v_active <> v_sid then
    return jsonb_build_object('ok', false, 'reason', 'duplicate');
  end if;
  -- 회사 IP 제한
  if v_row.company_id is not null and not v_master then
    select cs.settings -> 'ip_restriction' into v_conf from company_settings cs where cs.company_id = v_row.company_id limit 1;
    if v_conf is not null and coalesce((v_conf ->> 'enabled')::boolean, false) then
      select coalesce(array_agg(trim(x)), '{}') into v_ips from jsonb_array_elements_text(coalesce(v_conf -> 'ips', '[]'::jsonb)) x;
      if array_length(v_ips, 1) > 0 and not (coalesce(p_ip, '') = any(v_ips)) then
        return jsonb_build_object('ok', false, 'reason', 'ip');
      end if;
    end if;
  end if;
  return jsonb_build_object('ok', true);
end;
$function$;
revoke all on function public.session_gate(text) from public, anon;
grant execute on function public.session_gate(text) to authenticated, service_role;

-- 3) 회사별 인입 키 — n8n 등 외부 자동화가 통장·계산서·급여 배치를 밀어 넣을 때 쓰는 비밀키.
--    종전엔 공유 시크릿 1개 + 회사 UUID(비밀 아님) 라 시크릿 하나가 새면 전 회사에 쓰기가 가능했다.
create table if not exists public.company_ingest_keys (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  key_hash text not null unique,
  key_hint text not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
alter table public.company_ingest_keys enable row level security;
drop policy if exists company_ingest_keys_master on public.company_ingest_keys;
create policy company_ingest_keys_master on public.company_ingest_keys
  for select to authenticated using (company_id = public.get_my_company_id() and public.is_company_admin());
revoke all on public.company_ingest_keys from anon;

-- 발급(회전): 마스터만. 평문은 이 응답에서 한 번만 보인다.
create or replace function public.rotate_ingest_key()
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_company uuid := public.get_my_company_id(); v_key text; v_uid uuid;
begin
  if v_company is null or not public.is_company_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  v_key := 'ovk_' || encode(extensions.gen_random_bytes(24), 'hex');
  update public.company_ingest_keys set revoked_at = now() where company_id = v_company and revoked_at is null;
  select id into v_uid from users where auth_id = auth.uid() limit 1;
  insert into public.company_ingest_keys (company_id, key_hash, key_hint, created_by)
  values (v_company, encode(extensions.digest(v_key, 'sha256'), 'hex'), right(v_key, 4), v_uid);
  return v_key;
end;
$function$;
revoke all on function public.rotate_ingest_key() from public, anon;
grant execute on function public.rotate_ingest_key() to authenticated;

-- 키 → 회사: 서버(service_role) 전용. 키를 발급한 적 없는 회사는 과도기 동안 UUID 방식 유지(발급하는 순간 UUID 는 막힌다).
create or replace function public.ingest_company_for_key(p_key text)
returns uuid
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare v_company uuid; v_uuid uuid;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'not authorized' using errcode = '42501'; end if;
  if p_key is null or p_key = '' then return null; end if;
  select company_id into v_company from public.company_ingest_keys
   where key_hash = encode(extensions.digest(p_key, 'sha256'), 'hex') and revoked_at is null limit 1;
  if v_company is not null then return v_company; end if;
  begin v_uuid := p_key::uuid; exception when others then return null; end;
  if exists (select 1 from public.company_ingest_keys where company_id = v_uuid) then return null; end if;
  if exists (select 1 from public.companies where id = v_uuid) then return v_uuid; end if;
  return null;
end;
$function$;
revoke all on function public.ingest_company_for_key(text) from public, anon, authenticated;
grant execute on function public.ingest_company_for_key(text) to service_role;

-- 4) 원본 응답 마스킹 — 계좌·카드번호는 뒤 4자리만 남긴다
create or replace function public.mask_number_tail(t text)
returns text language sql immutable as $$
  select case when t is null or t = '' then t
              when length(regexp_replace(t, '[^0-9]', '', 'g')) <= 4 then t
              else repeat('*', greatest(length(t) - 4, 0)) || right(t, 4) end
$$;
update public.bank_transactions
   set raw_data = raw_data
     || case when raw_data ? 'accountNo' then jsonb_build_object('accountNo', public.mask_number_tail(raw_data->>'accountNo')) else '{}'::jsonb end
     || case when raw_data ? 'counterAccount' then jsonb_build_object('counterAccount', public.mask_number_tail(raw_data->>'counterAccount')) else '{}'::jsonb end
 where raw_data is not null and (raw_data ? 'accountNo' or raw_data ? 'counterAccount')
   and (coalesce(raw_data->>'accountNo','') !~ '^\*' or coalesce(raw_data->>'counterAccount','') !~ '^\*');
update public.card_transactions
   set raw_data = raw_data
     || case when raw_data ? 'cardNo' then jsonb_build_object('cardNo', public.mask_number_tail(raw_data->>'cardNo')) else '{}'::jsonb end
     || case when raw_data ? 'charge' then jsonb_build_object('charge', (raw_data->'charge') - 'resCardNo' - 'resUsedCard' - 'resCardNumber') else '{}'::jsonb end
     || case when raw_data ? 'approval' then jsonb_build_object('approval', (raw_data->'approval') - 'resCardNo' - 'resUsedCard' - 'resCardNumber') else '{}'::jsonb end
 where raw_data is not null and (raw_data ? 'cardNo' or raw_data->'charge' ? 'resCardNo' or raw_data->'charge' ? 'resUsedCard' or raw_data->'approval' ? 'resCardNo');
update public.cash_receipts set identity_number = public.mask_number_tail(identity_number)
 where identity_number is not null and identity_number !~ '^\*' and length(regexp_replace(identity_number, '[^0-9]', '', 'g')) >= 8;
