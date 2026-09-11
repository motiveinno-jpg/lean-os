--   복호화가 2026-09-07 부터 통째로 실패하고 있었다.
--
--   그날 보안 강화(20260907120000)에서 decrypt_credential·decrypt_json_credentials 를
--   다시 만들며 search_path 를 'public' 으로만 고정했다. 그런데 pgcrypto 는 extensions
--   스키마에 있어서 pgp_sym_decrypt 를 찾지 못한다 — 권한 검사를 통과한 뒤 42883 으로 죽는다.
--   짝인 encrypt_credential·encrypt_json_credentials 는 'public, extensions' 라 저장은 됐다.
--   즉 **암호는 저장되는데 어디서도 못 읽는** 상태였다.
--
--   영향: 연동 API 키 테스트, 이커머스 채널 주문 가져오기, 지원사업 인증키,
--   현금영수증 매입 수집, 홈택스 수집, codef-sync 의 비밀번호 복호화 2곳,
--   파일보관함 비밀번호 보기. 파일보관함은 빈 catch 로 오류를 삼켜
--   비밀번호 칸이 조용히 비고, 그대로 저장하면 저장된 암호가 지워졌다.
--
--   권한 조건은 바로 앞 마이그레이션(20260911190000)에서 정한 그대로 둔다.

create or replace function public.decrypt_credential(p_ciphertext text)
returns text
language plpgsql
security definer
set search_path to 'public', 'extensions'
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

--   decrypt_json_credentials 는 본문을 그대로 두고 search_path 만 바로잡는다.
alter function public.decrypt_json_credentials(jsonb) set search_path to 'public', 'extensions';
