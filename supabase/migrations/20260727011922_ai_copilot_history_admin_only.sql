-- AI 참모 대화기록 열람을 owner·admin 으로 제한 (A안)
--
-- 기존 정책은 company_id = get_my_company_id() 뿐이라, 같은 회사면 employee 역할도
-- 대표의 참모 대화를 전부 읽을 수 있었다. 사이드바(sidebar.tsx)가 /copilot 을 owner·admin 으로
-- 막지만 그건 화면 링크일 뿐이고 REST 를 직접 호출하면 RLS 만 남는다. 참모 답변에는
-- 현금흐름·미수금·경영리스크가 담기므로 실질적인 정보 노출이었다.
--
-- INSERT 도 같은 조건으로 맞춘다 — 쓰기는 되는데 읽기는 안 되는 비대칭 상태를 막고,
-- AI 참모가 owner·admin 전용 기능이라는 제품 정의와 일치시킨다.
--
-- (SELECT fn()) 래핑은 프로젝트 관례(20260605140000_rls_initplan_optimization) — initplan 최적화.

DROP POLICY IF EXISTS ai_copilot_history_select ON public.ai_copilot_history;

CREATE POLICY ai_copilot_history_select
  ON public.ai_copilot_history FOR SELECT TO authenticated
  USING (
    company_id = (SELECT get_my_company_id())
    AND (SELECT is_company_admin())
  );

DROP POLICY IF EXISTS ai_copilot_history_insert ON public.ai_copilot_history;

CREATE POLICY ai_copilot_history_insert
  ON public.ai_copilot_history FOR INSERT TO authenticated
  WITH CHECK (
    company_id = (SELECT get_my_company_id())
    AND (SELECT is_company_admin())
  );
