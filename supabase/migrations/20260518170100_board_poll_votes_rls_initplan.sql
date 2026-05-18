-- board_poll_votes RLS initplan 최적화
-- get_advisors(performance) auth_rls_initplan WARN 해소:
--   auth.uid() / get_my_company_id() 를 (SELECT ...) 로 감싸 행마다 재평가 방지.
-- 기능/보안 의미는 동일 (1인1표 + 회사 격리), 평가 비용만 쿼리당 1회로 감소.

DROP POLICY IF EXISTS board_poll_votes_select ON board_poll_votes;
CREATE POLICY board_poll_votes_select ON board_poll_votes
  FOR SELECT TO authenticated
  USING (company_id = (SELECT get_my_company_id()));

DROP POLICY IF EXISTS board_poll_votes_insert ON board_poll_votes;
CREATE POLICY board_poll_votes_insert ON board_poll_votes
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = (SELECT get_my_company_id())
    AND user_id = (SELECT id FROM users WHERE auth_id = (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS board_poll_votes_update ON board_poll_votes;
CREATE POLICY board_poll_votes_update ON board_poll_votes
  FOR UPDATE TO authenticated
  USING (
    company_id = (SELECT get_my_company_id())
    AND user_id = (SELECT id FROM users WHERE auth_id = (SELECT auth.uid()))
  )
  WITH CHECK (
    company_id = (SELECT get_my_company_id())
    AND user_id = (SELECT id FROM users WHERE auth_id = (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS board_poll_votes_delete ON board_poll_votes;
CREATE POLICY board_poll_votes_delete ON board_poll_votes
  FOR DELETE TO authenticated
  USING (
    company_id = (SELECT get_my_company_id())
    AND user_id = (SELECT id FROM users WHERE auth_id = (SELECT auth.uid()))
  );
