-- Migration: subscriptions_forgery_guard_trigger
-- Version: 20260716160000
-- Purpose (security incident): stop self-service plan forgery on subscriptions.
--
-- The subscriptions RLS keeps a FOR ALL policy for company owner/admin, so an
-- owner using the browser (anon/authenticated) client could directly UPDATE
-- their own subscription row and forge plan_id / plan_slug / status='active' /
-- trial_ends_at / current_period_end -> ultra upgrade without payment, defeating
-- every plan gate (tax-invoice quota, AI briefing, etc.).
--
-- Fix: KEEP the FOR ALL RLS, but add a BEFORE INSERT OR UPDATE trigger that
-- blocks forgery from non-trusted (browser) contexts. Trusted server contexts
-- (service_role via PostgREST, postgres/pg_cron, supabase_admin) pass through.
--
-- Trusted-context detection: current_user. PostgREST runs SET LOCAL ROLE only
-- AFTER validating the JWT, so browser clients execute as 'anon' or
-- 'authenticated' and cannot spoof current_user. Everything else (service_role,
-- postgres, pg_cron, supabase_admin, ...) is a trusted server/superuser context.
--
-- The only live client write is createTrialingSubscription (src/lib/billing.ts):
-- an INSERT at signup with status='trialing', plan_slug in ('free','starter'),
-- no stripe ids, trial_ends_at = now()+14d. That path must keep working. All
-- other subscription mutations (Stripe webhook, cancel API) run server-side
-- under service_role, so client UPDATE is fully blocked.
--
-- All function body comments are ASCII only.

CREATE OR REPLACE FUNCTION public.subscriptions_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Trusted server contexts bypass the guard. Browser clients authenticate as
  -- 'anon' or 'authenticated' (PostgREST SET LOCAL ROLE after JWT validation,
  -- so current_user cannot be spoofed by the client). service_role, postgres,
  -- pg_cron (postgres), supabase_admin, etc. are trusted and pass through.
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;

  -- Untrusted client path below.
  -- No live client UPDATE exists; every subscription mutation (Stripe webhook,
  -- cancel API) runs server-side under service_role. Block all client UPDATEs.
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'subscription changes must go through server';
  END IF;

  -- INSERT: only a fresh trialing signup row is permitted. Any paid marker,
  -- non-trial status, elevated plan, or long-lived trial is a forgery attempt.
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'trialing'
       OR NEW.stripe_subscription_id IS NOT NULL
       OR NEW.stripe_customer_id IS NOT NULL
       OR NEW.plan_slug IS NULL
       OR NEW.plan_slug NOT IN ('free', 'starter')
       OR (NEW.trial_ends_at IS NOT NULL AND NEW.trial_ends_at > now() + interval '31 days')
    THEN
      RAISE EXCEPTION 'invalid subscription insert: only trialing signup allowed';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS subscriptions_guard_trg ON public.subscriptions;
CREATE TRIGGER subscriptions_guard_trg
  BEFORE INSERT OR UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.subscriptions_guard();
