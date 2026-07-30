-- 갭필: 자격증명 암복호화 함수 5종 — 레거시 20260312_encrypt_credentials.sql 이 저장소에 없어
--   마이그레이션 이력이 비어 있었다(2026-07-30 로컬 부트스트랩 중 발견 — 직후 20260728050000 revoke 가 실패).
--   prod 실정의(pg_get_functiondef)를 그대로 옮김. 전부 CREATE OR REPLACE — prod 에선 동일 정의라 no-op.
--   키는 vault.decrypted_secrets 의 'credential_encryption_key' — 로컬엔 없으므로 호출 시
--   'Encryption key not configured' 로 명시 실패한다(생성 자체는 문제 없음).

create extension if not exists pgcrypto with schema extensions;

CREATE OR REPLACE FUNCTION public.get_credential_key()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT decrypted_secret FROM vault.decrypted_secrets
  WHERE name = 'credential_encryption_key' LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.encrypt_credential(p_plaintext text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_key text;
BEGIN
  IF p_plaintext IS NULL OR trim(p_plaintext) = '' THEN
    RETURN NULL;
  END IF;
  v_key := get_credential_key();
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'Encryption key not configured';
  END IF;
  RETURN encode(pgp_sym_encrypt(p_plaintext, v_key), 'base64');
END;
$function$;

CREATE OR REPLACE FUNCTION public.decrypt_credential(p_ciphertext text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_key text;
BEGIN
  IF p_ciphertext IS NULL OR trim(p_ciphertext) = '' THEN
    RETURN NULL;
  END IF;
  v_key := get_credential_key();
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'Encryption key not configured';
  END IF;
  RETURN pgp_sym_decrypt(decode(p_ciphertext, 'base64'), v_key);
END;
$function$;

CREATE OR REPLACE FUNCTION public.encrypt_json_credentials(p_creds jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_result jsonb := p_creds;
  v_key text;
  v_field text;
  v_val text;
BEGIN
  IF p_creds IS NULL THEN RETURN NULL; END IF;
  v_key := get_credential_key();
  IF v_key IS NULL THEN RAISE EXCEPTION 'Encryption key not configured'; END IF;

  FOREACH v_field IN ARRAY ARRAY['login_password','cert_password','password'] LOOP
    v_val := p_creds ->> v_field;
    IF v_val IS NOT NULL AND trim(v_val) <> '' THEN
      v_result := jsonb_set(v_result, ARRAY[v_field],
        to_jsonb(encode(pgp_sym_encrypt(v_val, v_key), 'base64')));
    END IF;
  END LOOP;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.decrypt_json_credentials(p_creds jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_result jsonb := p_creds;
  v_key text;
  v_field text;
  v_val text;
BEGIN
  IF p_creds IS NULL THEN RETURN NULL; END IF;
  v_key := get_credential_key();
  IF v_key IS NULL THEN RAISE EXCEPTION 'Encryption key not configured'; END IF;

  FOREACH v_field IN ARRAY ARRAY['login_password','cert_password','password'] LOOP
    v_val := p_creds ->> v_field;
    IF v_val IS NOT NULL AND trim(v_val) <> '' THEN
      BEGIN
        v_result := jsonb_set(v_result, ARRAY[v_field],
          to_jsonb(pgp_sym_decrypt(decode(v_val, 'base64'), v_key)));
      EXCEPTION WHEN OTHERS THEN
        NULL; -- field was not encrypted, leave as-is
      END;
    END IF;
  END LOOP;

  RETURN v_result;
END;
$function$;
