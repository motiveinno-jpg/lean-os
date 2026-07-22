-- P2 보안 advisor: (anon|authenticated)_security_definer_function_executable 중 내부 헬퍼만 안전 회수 (2026-07-22).
--   _seed_* 내부/트리거 함수는 앱이 직접 .rpc() 로 호출하지 않음(공개 래퍼·트리거 경유). SECURITY DEFINER 라
--   anon/authenticated 직접 실행 권한이 붙어 있으면 권한상승 표면이 되어 회수.
--   ⚠️ 트리거 함수는 테이블 owner 권한으로 실행되므로 execute 회수해도 트리거 동작엔 영향 없음.
--   ※ 그 외 122개 SECURITY DEFINER 함수는 앱의 정식 RPC(.rpc 호출)이며 이미 search_path 고정됨 → 회수 금지(회수 시 앱 붕괴).
revoke execute on function public._seed_chart_of_accounts_internal(uuid) from anon, authenticated, public;
revoke execute on function public._seed_chart_of_accounts_on_company_insert() from anon, authenticated, public;
revoke execute on function public._seed_allowances_on_company_insert() from anon, authenticated, public;
revoke execute on function public._seed_legal_allowances_internal(uuid) from anon, authenticated, public;
