--   파일보관함 비밀번호를 볼 수 있는 사람을 화면 게이트와 맞춘다.
--
--   화면은 "마스터 또는 /vault 권한자" 로 들여보내는데(역할 폐지 후), 복호화 함수는
--   is_company_admin() = 마스터만 허용한다. 권한만 받은 사람이 행을 누르면 복호화가
--   42501 로 막히고, 화면은 그 오류를 빈 catch 로 삼켜 비밀번호 칸이 조용히 빈다.
--   그 상태로 저장하면 encrypted_password 가 null 로 덮여 **복구 불가로 지워진다**.
--
--   보관함 권한을 준다는 것은 그 계정 정보를 본다는 뜻이다 — 비밀번호만 못 보면
--   권한 자체가 무의미하다. 마스터 또는 /vault 권한 보유자로 넓힌다.
--   (지우는 쪽 방어는 앱에서 따로 막는다 — 복호화가 실패하면 저장 자체를 거부한다.)

create or replace function public.decrypt_credential(p_ciphertext text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_key text;
begin
  if p_ciphertext is null or trim(p_ciphertext) = '' then return null; end if;
  if auth.role() is distinct from 'service_role'
     and not (public.is_company_admin() or public.has_perm('/vault')) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  v_key := get_credential_key();
  if v_key is null then raise exception 'Encryption key not configured'; end if;
  return pgp_sym_decrypt(decode(p_ciphertext, 'base64'), v_key);
end;
$function$;
