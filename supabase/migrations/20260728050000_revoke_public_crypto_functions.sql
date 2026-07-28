-- Migration: revoke_public_crypto_functions (2026-07-28, 출시일 보안 하드닝)
-- 어드바이저 발견: 자격증명 암복호화 함수 4개가 anon(비로그인)에게 실행 가능.
--   원인: 명시적 anon grant 가 아니라 함수 생성 시 자동 부여되는 PUBLIC 기본 EXECUTE 가
--   한 번도 회수되지 않았음 (레거시 20260312_encrypt_credentials.sql).
--
-- 호출부 전수 확인(2026-07-28):
--   - src/lib/crypto.ts → settings·vault 페이지가 로그인 세션(authenticated)으로 RPC 호출 → 유지 필수
--   - supabase/functions/codef-sync → service_role → 유지
--   - anon 이 쓸 정당한 경로 0개 → PUBLIC(및 anon) 회수
--
-- RLS 로 암호문 자체는 못 읽지만, 유출 시 비로그인 상태로 복호화가 가능했던
-- 심층방어 구멍을 봉인. authenticated·service_role 의 기존 동작은 변화 없음.

revoke execute on function public.encrypt_credential(p_plaintext text) from public, anon;
revoke execute on function public.decrypt_credential(p_ciphertext text) from public, anon;
revoke execute on function public.encrypt_json_credentials(p_creds jsonb) from public, anon;
revoke execute on function public.decrypt_json_credentials(p_creds jsonb) from public, anon;
