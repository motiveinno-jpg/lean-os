-- P2 보안 advisor: function_search_path_mutable 해소 (2026-07-22).
--   public 스키마의 앱 함수 중 search_path 미고정인 것에 SET search_path 를 고정(search_path injection 방어).
--   ⚠️ 확장(pg_trgm 등) 소유 함수는 제외 — 확장 관리 객체라 변경 금지.
--   로직 무변경(스키마 해석 경로만 고정) — public 객체만 참조하는 함수라 안전.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND (p.proconfig IS NULL OR NOT EXISTS (
            SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%'))
      -- 확장 소유 함수 제외
      AND NOT EXISTS (
            SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('ALTER FUNCTION public.%I(%s) SET search_path = public, pg_temp', r.proname, r.args);
  END LOOP;
END $$;
