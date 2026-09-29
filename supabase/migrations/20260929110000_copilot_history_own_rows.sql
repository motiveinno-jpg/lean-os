-- AI 참모 대화 기록은 물어본 사람 본인 것만
--
-- 지금까지는 같은 회사에서 /copilot 권한이 있으면 다른 사람의 질문·답까지 읽혔다.
-- 답에는 직원 명단·급여·미수금이 담기니 구성원에게 대표의 대화가 그대로 보였다.
-- 또 p4 가산 정책이 FOR ALL 이라 REST 로 남의 기록을 고치거나 지울 수도 있었다.
--
-- 참모 서버(owner-copilot)는 이미 user_id 로 본인 대화만 맥락으로 쓰고,
-- 기록은 트리거(set_copilot_history_company)가 company_id·user_id 를 채운다.
-- 화면의 '대화 초기화'는 화면만 비우므로 UPDATE·DELETE 정책은 두지 않는다.

DROP POLICY IF EXISTS p4_ai_copilot_history_perm ON public.ai_copilot_history;

DROP POLICY IF EXISTS ai_copilot_history_select ON public.ai_copilot_history;
CREATE POLICY ai_copilot_history_select
  ON public.ai_copilot_history FOR SELECT TO authenticated
  USING (
    company_id = (SELECT get_my_company_id())
    AND user_id = (SELECT current_app_user_id())
  );

DROP POLICY IF EXISTS ai_copilot_history_insert ON public.ai_copilot_history;
CREATE POLICY ai_copilot_history_insert
  ON public.ai_copilot_history FOR INSERT TO authenticated
  WITH CHECK (
    company_id = (SELECT get_my_company_id())
    AND user_id = (SELECT current_app_user_id())
    AND ((SELECT is_company_admin()) OR (SELECT has_perm('/copilot')))
  );
