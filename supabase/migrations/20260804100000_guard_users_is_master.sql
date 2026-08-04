-- SECURITY P0: public.users.is_master 셀프 승격(권한 상승) 차단
--
-- 취약점:
--   역할 폐지 개편(2026-07-30) 이후 관리 권한 판정은 users.is_master 하나뿐이다
--   (is_company_admin() 이 is_master 를 본다). 그런데 UPDATE 정책 "Users can update" 는
--     USING (auth_id = auth.uid() OR (company_id = get_my_company_id() AND is_company_owner()))
--   에 WITH CHECK 이 없어, 아무 멤버나 본인 행을 UPDATE 하면서 is_master=true 로
--   스스로를 마스터로 승격시킬 수 있다. (기존 트리거 enforce_users_self_no_privilege_change
--   는 email/role 만 막고 is_master 는 안 봤다.)
--
-- 봉합:
--   is_master 가 실제로 바뀌는 UPDATE 에서만 검사하는 BEFORE UPDATE 트리거.
--   허용 경로는 셋뿐 — (1) 서버(service_role), (2) 자기 회사 마스터,
--   (3) 회사 개설 limbo 경로(무소속 본인 행 → 방금 만든 빈 회사의 첫 구성원).
--
-- INSERT 는 건드리지 않는다: 신규 회사 개설자가 자기 행을 is_master=true 로 INSERT 하는 것은
--   정상 경로다 (src/lib/company-signup.ts createCompanyWithOwner).

CREATE OR REPLACE FUNCTION public.enforce_users_is_master_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_other_members integer;
BEGIN
  -- is_master 가 안 바뀌는 UPDATE 는 전부 통과 (이름·전화·프로필 등 일반 수정)
  IF NEW.is_master IS NOT DISTINCT FROM OLD.is_master THEN
    RETURN NEW;
  END IF;

  -- (1) 서버 경로: service_role 또는 admin client(auth.uid() 없음) — 정상 관리 흐름
  IF auth.role() = 'service_role' OR auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- (2) 호출자가 그 회사의 마스터 — 마스터가 구성원을 승격/강등
  --     RLS 가 이미 행 범위를 자기 회사로 제한하지만 방어적으로 회사 대조를 함께 요구한다.
  IF public.is_company_admin()
     AND NEW.company_id IS NOT NULL
     AND NEW.company_id = public.get_my_company_id() THEN
    RETURN NEW;
  END IF;

  -- (3) 회사 개설 limbo 경로: 무소속(company_id NULL) 본인 행을 방금 만든 회사로 연결하는
  --     UPDATE. 그 회사의 첫 구성원(= 개설자)일 때만 자기 마스터 지정을 허용한다.
  --     이미 구성원이 있는 회사면 차단 → 무소속 사용자가 남의 회사 마스터로 들어오는 악용 봉쇄.
  IF OLD.company_id IS NULL
     AND NEW.company_id IS NOT NULL
     AND OLD.auth_id = auth.uid() THEN
    SELECT count(*) INTO v_other_members
      FROM public.users u
     WHERE u.company_id = NEW.company_id
       AND u.id <> OLD.id;
    IF v_other_members = 0 THEN
      RETURN NEW;
    END IF;
  END IF;

  RAISE EXCEPTION 'is_master 는 마스터 또는 서버만 변경할 수 있습니다'
    USING ERRCODE = '42501';
END;
$$;

-- 트리거로만 실행되면 되므로 RPC 직접 호출 노출 차단
-- (Supabase 기본 권한이 anon/authenticated 에 EXECUTE 를 부여하므로 개별 REVOKE 필요)
REVOKE ALL ON FUNCTION public.enforce_users_is_master_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_users_is_master_change() FROM anon;
REVOKE ALL ON FUNCTION public.enforce_users_is_master_change() FROM authenticated;

DROP TRIGGER IF EXISTS enforce_users_is_master_change ON public.users;
CREATE TRIGGER enforce_users_is_master_change
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_users_is_master_change();
