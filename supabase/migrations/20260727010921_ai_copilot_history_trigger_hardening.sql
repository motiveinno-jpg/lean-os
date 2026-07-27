-- ai_copilot_history 트리거 하드닝
-- 20260724151900_ai_copilot_history_auto_company.sql 이 도입한 set_copilot_history_company() 가
-- 프로젝트 표준(20260706092211_secdef_search_path_hardening, 20260722081857_pin_function_search_path)을
-- 어겨 Supabase advisor 경고 4건을 유발했다:
--   · function_search_path_mutable (DB 전체에서 유일한 잔여 1건)
--   · anon_security_definer_function_executable / authenticated_... (트리거 함수가 /rest/v1/rpc 로 호출 가능)
--   · rls_policy_always_true (INSERT 정책 WITH CHECK (true))
-- 기능(클라이언트가 company_id 를 보내지 않고 서버가 채움)은 그대로 두고 위 4건만 해소한다.

-- 1) SECURITY DEFINER → INVOKER + search_path 고정.
--    get_my_company_id()/current_app_user_id() 가 이미 SECURITY DEFINER 라 여기서 승격할 필요가 없다.
--    user_id 도 함께 채운다 — 기존엔 아무도 안 채워 항상 NULL 이라 작성자 추적이 불가능했다.
CREATE OR REPLACE FUNCTION public.set_copilot_history_company()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
BEGIN
  NEW.company_id := get_my_company_id();
  NEW.user_id := current_app_user_id();
  RETURN NEW;
END;
$$;

-- 2) RPC 직접 호출 차단. 트리거 실행은 호출자의 EXECUTE 권한을 검사하지 않으므로 회수해도 동작한다.
REVOKE ALL ON FUNCTION public.set_copilot_history_company() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_copilot_history_company() FROM anon;
REVOKE ALL ON FUNCTION public.set_copilot_history_company() FROM authenticated;

-- 3) INSERT 정책을 always-true 에서 원래 의도(자기 회사)로 복원.
--    RLS WITH CHECK 는 BEFORE INSERT 트리거가 행을 고친 "뒤"에 평가되므로, 트리거가 채운
--    company_id 로 검사된다 → 클라이언트가 무엇을 보내든 결과가 올바르다.
--    회사 미배정 계정은 get_my_company_id() 가 NULL → NOT NULL 위반으로 fail-closed.
DROP POLICY IF EXISTS ai_copilot_history_insert ON public.ai_copilot_history;

CREATE POLICY ai_copilot_history_insert
  ON public.ai_copilot_history FOR INSERT TO authenticated
  WITH CHECK (company_id = (SELECT get_my_company_id()));
