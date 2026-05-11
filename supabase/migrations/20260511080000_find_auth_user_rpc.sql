-- 이메일로 auth.users 조회 RPC — admin.auth.admin.listUsers 의 pagination/장애 회피.
-- SECURITY DEFINER 로 service_role 만 호출 가능.
CREATE OR REPLACE FUNCTION public.find_auth_user_by_email(p_email text)
RETURNS TABLE (id uuid, email text, raw_user_meta_data jsonb)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT u.id, u.email::text, u.raw_user_meta_data
  FROM auth.users u
  WHERE lower(u.email) = lower(p_email)
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.find_auth_user_by_email(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_auth_user_by_email(text) TO service_role;

COMMENT ON FUNCTION public.find_auth_user_by_email(text) IS
  '이메일로 auth.users 조회 — service_role 만 호출. invite/quick-add 흐름에서 listUsers 대체.';
