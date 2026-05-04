-- Migration: extend_plan_rls_employees_signatures
-- Version: 20260320134957
-- Source: production schema_migrations (auto-extracted 2026-05-04)


-- employees: requires starter+ (free plan limited to 3 via client check,
-- but server-side enforcement ensures no bypass)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Plan gate: employees require starter' AND tablename = 'employees') THEN
    CREATE POLICY "Plan gate: employees require starter"
      ON public.employees FOR INSERT
      WITH CHECK (
        public.has_min_plan('starter')
        OR auth.role() = 'service_role'
      );
  END IF;
END $$;

-- signature_requests: requires starter+ (free plan limited to 3/month)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Plan gate: signature_requests require starter' AND tablename = 'signature_requests') THEN
    CREATE POLICY "Plan gate: signature_requests require starter"
      ON public.signature_requests FOR INSERT
      WITH CHECK (
        public.has_min_plan('starter')
        OR auth.role() = 'service_role'
      );
  END IF;
END $$;
