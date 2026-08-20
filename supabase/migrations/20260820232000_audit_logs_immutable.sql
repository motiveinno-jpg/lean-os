-- 감사 로그를 지울 수 없게 (2026-08-20)
--
-- AS_IS — audit_logs_company_access 가 `FOR ALL (company_id = get_my_company_id())` 하나뿐이라
--   **같은 회사 구성원 누구나 감사 로그를 지우거나 고칠 수 있었다.** 권한 0 계정으로 실측: 🔓 삭제됨.
--   감사 로그의 존재 이유가 "누가 무엇을 했는지 남기는 것"인데, 한 짓을 스스로 지울 수 있으면
--   기록이 아니라 장식이다. finance_access_logs(재무 열람 이력)도 정책 모양이 같다.
--
-- TO_BE — 앱 사용자(authenticated)의 DELETE·UPDATE 를 전면 차단(append-only).
--   조회·기록은 그대로. RESTRICTIVE 라 기존 회사격리와 AND 로 묶인다.
--
-- 서버는 막히지 않는다
--   · 엣지 함수·관리 API 는 service_role / superuser 라 RLS 를 우회한다.
--   · QA 정리(scripts/qa-seed.mjs teardown)는 Management API(database/query)로 도는 SQL 이라 영향 없음
--     (실제로 audit_logs 를 지우는 유일한 코드다 — 앱 코드에는 삭제 경로가 없음을 grep 으로 확인).
--   · 회사 삭제(master_delete_company)는 SECURITY DEFINER RPC 라 그대로 동작한다.
--
-- 되돌리기: 아래 두 정책을 drop 하면 종전 동작.

drop policy if exists audit_logs_no_tamper_del on public.audit_logs;
create policy audit_logs_no_tamper_del on public.audit_logs
  as restrictive for delete to authenticated using (false);

drop policy if exists audit_logs_no_tamper_upd on public.audit_logs;
create policy audit_logs_no_tamper_upd on public.audit_logs
  as restrictive for update to authenticated using (false);

drop policy if exists finance_access_logs_no_tamper_del on public.finance_access_logs;
create policy finance_access_logs_no_tamper_del on public.finance_access_logs
  as restrictive for delete to authenticated using (false);

drop policy if exists finance_access_logs_no_tamper_upd on public.finance_access_logs;
create policy finance_access_logs_no_tamper_upd on public.finance_access_logs
  as restrictive for update to authenticated using (false);
