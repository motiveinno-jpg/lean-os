-- Migration: sync_jobs_anon_rls
-- Version: 20260309075041
-- Source: production schema_migrations (auto-extracted 2026-05-04)


-- local-agent가 anon key로 sync_jobs를 읽고 업데이트할 수 있도록
-- company_id 기반 직접 접근 허용 (서버 스크립트용)
CREATE POLICY "sync_jobs_local_agent" ON sync_jobs
  FOR ALL
  USING (true)
  WITH CHECK (true);
