-- Migration: create_automation_logs
-- Version: 20260320134916
-- Source: production schema_migrations (auto-extracted 2026-05-04)

CREATE TABLE IF NOT EXISTS public.automation_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id text NOT NULL,
  service text NOT NULL,
  action text NOT NULL,
  status text NOT NULL DEFAULT 'success',
  details jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.automation_logs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Service role manages automation_logs') THEN
    CREATE POLICY "Service role manages automation_logs"
      ON public.automation_logs FOR ALL
      USING ((auth.jwt() ->> 'role') = 'service_role');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can view own company automation_logs') THEN
    CREATE POLICY "Users can view own company automation_logs"
      ON public.automation_logs FOR SELECT
      USING (
        company_id IN (
          SELECT users.company_id::text FROM users WHERE users.auth_id = auth.uid()
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_automation_logs_company
  ON public.automation_logs(company_id, created_at DESC);