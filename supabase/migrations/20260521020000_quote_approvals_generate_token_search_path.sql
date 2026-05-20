-- L 견적: generate_approval_token search_path 픽스
--
-- 증상: 견적 발송 시 POST /rest/v1/rpc/generate_approval_token 404/422.
-- 원인: 함수 본문이 gen_random_bytes(32) 호출 (pgcrypto 함수). pgcrypto 는
--       extensions 스키마에 설치돼 있는데 함수가 search_path='public' 만
--       지정 → extensions 스키마 미참조 → 42883 (function does not exist).
-- 픽스:
--   1) ALTER FUNCTION search_path 에 extensions 추가
--   2) 본문도 extensions.gen_random_bytes 로 명시 (search_path 의존성 제거)
-- 멱등: CREATE OR REPLACE.

SET lock_timeout = '4000';
SET statement_timeout = '60000';

CREATE OR REPLACE FUNCTION public.generate_approval_token()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  -- extensions.gen_random_bytes 로 명시 — search_path 의존성 제거 (방어적 코딩)
  RETURN replace(replace(replace(
    encode(extensions.gen_random_bytes(32), 'base64'),
    '/', '_'), '+', '-'), '=', ''
  );
END;
$$;

-- 권한 보존 (직전과 동일)
REVOKE ALL ON FUNCTION public.generate_approval_token() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_approval_token() TO authenticated, service_role;

-- PostgREST 스키마 캐시 즉시 reload — 시그니처는 동일하지만 안전
NOTIFY pgrst, 'reload schema';
