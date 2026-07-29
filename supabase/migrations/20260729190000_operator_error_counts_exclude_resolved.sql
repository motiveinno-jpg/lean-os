-- 운영자 화면 오류 집계에서 처리완료(resolved) 제외 (2026-07-29, 이미 MCP 로 prod 적용 — 기록용)
--   사장님: "시스템 상태에 오류 9건, 처리된 건 안 나타나게" — 최근 24시간 9건이 전부
--   resolved=true 인데도 카운트에 잡히던 것. 오류를 참조하는 운영자용 함수 3개 모두
--   pg_get_functiondef 전문을 읽어 조건만 부분 치환(타 블록 무변경 — 두 PC 규칙):
--
--   1) platform_activity_feed  — errors_24h · 결제실패(failures) 카운트 · 피드 error 행
--        + and resolved = false  (전문 재정의는 MCP 마이그레이션 activity_feed_exclude_resolved 참조)
--   2) get_company_overview    — 회사 상세 errors_24h
--   3) operator_dependencies_health — supabase errors_24h · errors_1h
do $$
declare r record; d text;
begin
  for r in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('get_company_overview', 'operator_dependencies_health')
  loop
    d := pg_get_functiondef(r.oid);
    d := replace(d, 'FROM error_logs WHERE company_id = c.id AND created_at >= v_24h',
                    'FROM error_logs WHERE company_id = c.id AND created_at >= v_24h AND resolved = false');
    d := replace(d, 'FROM error_logs WHERE created_at >= v_24h',
                    'FROM error_logs WHERE created_at >= v_24h AND resolved = false');
    d := replace(d, 'FROM error_logs WHERE created_at >= v_1h',
                    'FROM error_logs WHERE created_at >= v_1h AND resolved = false');
    execute d;
  end loop;
end $$;
