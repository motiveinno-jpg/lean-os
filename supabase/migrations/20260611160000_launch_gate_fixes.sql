-- Migration: launch_gate_fixes
-- Version: 20260611160000
-- Purpose: 4 pre-launch DB hardening fixes (paid release blockers).
--   FIX 1 (P0): plan enforcement recognizes 'trialing' + 'business' slug.
--   FIX 2 (P0): sync_jobs anon/public wide-open RLS removed (company isolation kept).
--   FIX 3 (P1): quote_tracking USING(true) SELECT/UPDATE removed (orphaned table).
--   FIX 4 (P1): partnership_inquiries authenticated SELECT USING(true) removed (PII leak).
-- Note: all function bodies are ASCII only (comments in English) to avoid encoding issues.
-- Reuses existing SECURITY DEFINER helpers (get_my_company_id, get_company_plan_slug, plan_rank).

-- ============================================================
-- FIX 1 (P0): plan enforcement
-- ============================================================

-- get_company_plan_slug: include 'trialing' so trial customers can use
-- plan-gated INSERTs (deals/partners/tax_invoices/loans). Guard with
-- now() < trial_ends_at so an EXPIRED trial falls back to 'free'.
CREATE OR REPLACE FUNCTION public.get_company_plan_slug()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT COALESCE(
    (
      SELECT s.plan_slug
      FROM public.subscriptions s
      WHERE s.company_id = public.get_my_company_id()
        AND (
          -- active-equivalent statuses: period-end still valid (or open-ended)
          (
            s.status IN ('active', 'paused', 'past_due', 'cancelling')
            AND (
              s.cancel_at_period_end = false
              OR s.current_period_end IS NULL
              OR s.current_period_end >= now()
            )
          )
          -- trialing: only while the trial window is still open
          OR (
            s.status = 'trialing'
            AND s.trial_ends_at IS NOT NULL
            AND now() < s.trial_ends_at
          )
        )
      ORDER BY s.created_at DESC
      LIMIT 1
    ),
    'free'
  );
$$;

-- plan_rank: add 'business' as a pro-equivalent tier so plan gating works
-- regardless of which seed slug is live (production uses 'pro'; some seeds
-- used 'business'). Both map to rank 2.
CREATE OR REPLACE FUNCTION public.plan_rank(slug text)
RETURNS integer LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE slug
    WHEN 'free' THEN 0
    WHEN 'starter' THEN 1
    WHEN 'pro' THEN 2
    WHEN 'business' THEN 2
    WHEN 'enterprise' THEN 3
    ELSE 0
  END;
$$;

-- ============================================================
-- FIX 2 (P0): sync_jobs wide-open RLS removed
-- The "sync_jobs_local_agent" policy granted FOR ALL to public with
-- USING(true)/WITH CHECK(true) -> any anon key holder could read/write/delete
-- every company's sync_jobs. No app/edge code reads the plain sync_jobs table
-- (only hometax_sync_jobs is used); edge functions use service_role (RLS bypass).
-- The company-isolated "sync_jobs_company" policy already exists and remains.
-- ============================================================
DROP POLICY IF EXISTS "sync_jobs_local_agent" ON public.sync_jobs;

-- ============================================================
-- FIX 3 (P1): quote_tracking token-based USING(true) policies removed
-- The orphaned quote_tracking table is not read or written by any client/edge
-- code (the public /quote/[token] flow uses quote_approvals via SECURITY DEFINER
-- RPCs, a different table). The "Anyone can view/update by token" USING(true)
-- policies allowed any client to read/overwrite all rows. Company-isolated
-- SELECT/INSERT/UPDATE/DELETE policies remain for the in-app path.
-- ============================================================
DROP POLICY IF EXISTS "Anyone can view by token" ON public.quote_tracking;
DROP POLICY IF EXISTS "Anyone can update by token" ON public.quote_tracking;

-- ============================================================
-- FIX 4 (P1): partnership_inquiries authenticated SELECT USING(true) removed
-- Any logged-in user could read every company's partnership inquiry PII.
-- No in-app screen reads this table; operator/edge access uses service_role
-- (RLS bypass), so dropping the authenticated SELECT policy keeps admin reads
-- working while closing the leak. The anon/authenticated INSERT (landing form)
-- is unaffected.
-- ============================================================
DROP POLICY IF EXISTS "Authenticated users can read inquiries" ON public.partnership_inquiries;
