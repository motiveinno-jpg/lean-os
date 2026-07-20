-- SECURITY P0: 플랫폼 운영자 게이트 권한상승 봉합
--
-- 취약점:
--  1) public.users "Users can update" RLS 정책이 WITH CHECK/컬럼 제한 없이
--     자기 행의 email·role 임의 변경을 허용.
--  2) is_platform_operator() 가 자가수정 가능한 public.users.email / role+회사명 으로
--     운영자를 판정 → 고객이 자기 users.email 을 x@mo-tive.com 으로 바꾸면 운영자 승격.
--
-- 봉합:
--  (A) is_platform_operator() 를 위조 불가능한 auth.jwt() 검증 이메일 기준으로 재정의.
--  (B) users.email / role 클라이언트 자가변경을 BEFORE UPDATE 트리거로 원천 차단.
--      (service_role/admin client 는 auth.uid()=null 이라 우회 허용 → 정상 관리 흐름 유지)

-- (A) 운영자 판정 = Supabase Auth 로 검증된 로그인 이메일만 신뢰.
--     users.email(자가수정 가능) 및 role='owner'+회사명 레거시 분기 전면 제거.
CREATE OR REPLACE FUNCTION public.is_platform_operator()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(auth.jwt() ->> 'email', '') ~* '@mo-tive\.com$';
$$;

REVOKE ALL ON FUNCTION public.is_platform_operator() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_platform_operator() TO authenticated;

-- (B) 근본 봉합: 클라이언트(로그인 사용자)가 본인 행의 email/role 을 스스로 못 바꾸게 차단.
CREATE OR REPLACE FUNCTION public.enforce_users_self_no_privilege_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- service_role / admin client 는 auth.uid() 가 null → 정상 관리 흐름이므로 통과.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- 본인 행에 대한 자가수정에서 email/role 변경만 차단.
  -- (오너가 다른 멤버 role 변경: NEW.auth_id <> auth.uid() → 통과)
  IF (NEW.auth_id = auth.uid() OR OLD.auth_id = auth.uid())
     AND (NEW.email IS DISTINCT FROM OLD.email
          OR NEW.role IS DISTINCT FROM OLD.role) THEN
    RAISE EXCEPTION 'self email/role change is not allowed'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

-- 트리거 함수는 트리거로만 실행되면 되므로 RPC 직접 호출 노출 차단.
-- (Supabase 기본 권한이 anon/authenticated 에 EXECUTE 를 명시 부여하므로 개별 REVOKE 필요)
REVOKE ALL ON FUNCTION public.enforce_users_self_no_privilege_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_users_self_no_privilege_change() FROM anon;
REVOKE ALL ON FUNCTION public.enforce_users_self_no_privilege_change() FROM authenticated;

DROP TRIGGER IF EXISTS enforce_users_self_no_privilege_change ON public.users;
CREATE TRIGGER enforce_users_self_no_privilege_change
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_users_self_no_privilege_change();
