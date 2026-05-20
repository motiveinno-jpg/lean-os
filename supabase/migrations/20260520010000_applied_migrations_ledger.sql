-- Migration: applied_migrations 자기-기록 ledger (P0-3 — DB 적용 누락 자동 탐지)
--
-- 배경: 우리 apply 경로(`scripts/apply-supabase-migration.mjs` = Management API
--   `database/query`)는 Supabase 내장 `supabase_migrations.schema_migrations`
--   를 채우지 않는다. → 코드 푸시 ↔ DB 적용 누락 반복(board poll·급여 RLS
--   "[L prod 미적용]" 전례). 본 ledger 는 우리 apply 경로 전용 자기-기록.
--
-- 사용:
--   · `apply-supabase-migration.mjs` 가 각 파일 성공 적용 후
--     `INSERT INTO applied_migrations(version) VALUES('<basename>')` 추가.
--   · `scripts/check-migrations.mjs` 가 `supabase/migrations/*.sql` 파일명 ↔
--     ledger 를 diff 해 미적용 식별. CI 게이트로 사용.
--
-- 베이스라인: 이 마이그 자체가 첫 row. 이전 파일들은 'pre-ledger' 로 간주
--   (check 스크립트가 파일명 > 이 마이그 version 인 것만 검사 → false-positive 0).

SET lock_timeout = '4000';
SET statement_timeout = '20000';

CREATE TABLE IF NOT EXISTS public.applied_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.applied_migrations IS
  'Self-recorded ledger of migrations applied via scripts/apply-supabase-migration.mjs (Management API). Used by check-migrations.mjs as the deploy-gate source-of-truth.';

ALTER TABLE public.applied_migrations ENABLE ROW LEVEL SECURITY;

-- 읽기: 운영자가 SQL 콘솔/대시보드에서 확인하기 위함. 민감 데이터 없음(파일명+시각만).
DROP POLICY IF EXISTS "applied_migrations_read_authenticated" ON public.applied_migrations;
CREATE POLICY "applied_migrations_read_authenticated"
  ON public.applied_migrations FOR SELECT
  USING (true);

-- INSERT/UPDATE/DELETE: 클라이언트 차단. 오직 service_role(또는 Management API
-- query — RLS 우회) 만 기록. RLS 정책 미생성 → 일반 클라이언트 mutate 0건 보장.

GRANT SELECT ON public.applied_migrations TO authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.applied_migrations FROM authenticated, anon, PUBLIC;

-- 베이스라인: 자기 자신 기록 (체크 스크립트가 이 시점 이전 파일은 검사 제외).
INSERT INTO public.applied_migrations(version)
VALUES ('20260520010000_applied_migrations_ledger')
ON CONFLICT (version) DO NOTHING;
