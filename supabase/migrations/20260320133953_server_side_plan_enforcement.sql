-- Migration: server_side_plan_enforcement
-- Version: 20260320133953
-- Source: production schema_migrations (auto-extracted 2026-05-04)

-- Helper: get current company's plan slug
CREATE OR REPLACE FUNCTION public.get_company_plan_slug()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT COALESCE(
    (
      SELECT s.plan_slug
      FROM public.subscriptions s
      WHERE s.company_id = public.get_my_company_id()
        AND s.status IN ('active', 'paused', 'past_due', 'cancelling')
        AND (
          s.cancel_at_period_end = false
          OR s.current_period_end IS NULL
          OR s.current_period_end >= now()
        )
      ORDER BY s.created_at DESC
      LIMIT 1
    ),
    'free'
  );
$$;

-- Helper: plan rank for comparison
CREATE OR REPLACE FUNCTION public.plan_rank(slug text)
RETURNS integer LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE slug
    WHEN 'free' THEN 0
    WHEN 'starter' THEN 1
    WHEN 'pro' THEN 2
    WHEN 'enterprise' THEN 3
    ELSE 0
  END;
$$;

-- Helper: check if current company meets minimum plan
CREATE OR REPLACE FUNCTION public.has_min_plan(min_plan text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT public.plan_rank(public.get_company_plan_slug()) >= public.plan_rank(min_plan);
$$;

-- deals: requires starter+
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Plan gate: deals require starter' AND tablename = 'deals') THEN
    CREATE POLICY "Plan gate: deals require starter"
      ON public.deals FOR INSERT
      WITH CHECK (
        public.has_min_plan('starter')
        OR auth.role() = 'service_role'
      );
  END IF;
END $$;

-- partners: requires starter+
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Plan gate: partners require starter' AND tablename = 'partners') THEN
    CREATE POLICY "Plan gate: partners require starter"
      ON public.partners FOR INSERT
      WITH CHECK (
        public.has_min_plan('starter')
        OR auth.role() = 'service_role'
      );
  END IF;
END $$;

-- tax_invoices: requires pro+
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Plan gate: tax_invoices require pro' AND tablename = 'tax_invoices') THEN
    CREATE POLICY "Plan gate: tax_invoices require pro"
      ON public.tax_invoices FOR INSERT
      WITH CHECK (
        public.has_min_plan('pro')
        OR auth.role() = 'service_role'
      );
  END IF;
END $$;

-- loans: requires pro+
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Plan gate: loans require pro' AND tablename = 'loans') THEN
    CREATE POLICY "Plan gate: loans require pro"
      ON public.loans FOR INSERT
      WITH CHECK (
        public.has_min_plan('pro')
        OR auth.role() = 'service_role'
      );
  END IF;
END $$;

-- billing_events RLS
ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can read own billing_events' AND tablename = 'billing_events') THEN
    CREATE POLICY "Users can read own billing_events"
      ON public.billing_events FOR SELECT
      USING (company_id = public.get_my_company_id() OR auth.role() = 'service_role');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Service role can manage billing_events' AND tablename = 'billing_events') THEN
    CREATE POLICY "Service role can manage billing_events"
      ON public.billing_events FOR ALL
      USING (auth.role() = 'service_role');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can insert own billing_events' AND tablename = 'billing_events') THEN
    CREATE POLICY "Users can insert own billing_events"
      ON public.billing_events FOR INSERT
      WITH CHECK (company_id = public.get_my_company_id());
  END IF;
END $$;