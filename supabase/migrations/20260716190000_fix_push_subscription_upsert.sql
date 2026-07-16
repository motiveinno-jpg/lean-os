-- Migration: fix_push_subscription_upsert
-- Version: 20260716190000
--
-- Web push subscribe was failing with "권한은 허용됐지만 구독에 실패했습니다" on any
-- re-subscribe because the client upsert(onConflict: endpoint) takes the UPDATE
-- path when the browser endpoint already exists, and push_subscriptions has no
-- UPDATE RLS policy -> RLS violation -> silent false.
--
-- Additional latent bugs fixed here:
--  1. user_id FK referenced auth.users(id) while the send path
--     (notifications trigger -> send-web-push edge) queries by public.users.id.
--     For legacy accounts where users.id <> users.auth_id, subscribe could never
--     work (FK violation). Re-point FK to public.users(id).
--  2. Same browser endpoint switching accounts: the old owner's row blocks the
--     new owner's upsert under RLS. Solved by a SECURITY DEFINER RPC that
--     upserts atomically and reassigns endpoint ownership to the caller.
--
-- Function body comments are ASCII only (Management API transport safety).

-- 1) Remove rows whose user_id has no matching public.users row (dead rows:
--    the send path matches on users.id, so these could never receive a push).
DELETE FROM public.push_subscriptions ps
WHERE NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = ps.user_id);

-- 2) Re-point FK: auth.users(id) -> public.users(id).
ALTER TABLE public.push_subscriptions
  DROP CONSTRAINT IF EXISTS push_subscriptions_user_id_fkey;
ALTER TABLE public.push_subscriptions
  ADD CONSTRAINT push_subscriptions_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

-- 3) Atomic upsert RPC. SECURITY DEFINER so it can reassign an endpoint row
--    previously owned by another account (same browser, different login).
--    Caller identity is resolved server-side from auth.uid() -> users.id,
--    so the client can no longer write someone else's user_id.
CREATE OR REPLACE FUNCTION public.upsert_push_subscription(
  p_endpoint  text,
  p_p256dh    text,
  p_auth      text,
  p_user_agent text DEFAULT NULL,
  p_company_id uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  SELECT id INTO v_user_id FROM users WHERE auth_id = auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'no user row for caller';
  END IF;
  INSERT INTO push_subscriptions (user_id, company_id, endpoint, p256dh, auth, user_agent)
  VALUES (v_user_id, p_company_id, p_endpoint, p_p256dh, p_auth, p_user_agent)
  ON CONFLICT (endpoint) DO UPDATE
    SET user_id    = EXCLUDED.user_id,
        company_id = EXCLUDED.company_id,
        p256dh     = EXCLUDED.p256dh,
        auth       = EXCLUDED.auth,
        user_agent = EXCLUDED.user_agent;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_push_subscription(text, text, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_push_subscription(text, text, text, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.upsert_push_subscription(text, text, text, text, uuid) TO authenticated;

COMMENT ON FUNCTION public.upsert_push_subscription(text, text, text, text, uuid) IS
  'Web push subscription upsert. Resolves caller users.id from auth.uid(), reassigns endpoint ownership on account switch. Used by src/lib/web-push.ts subscribeWebPush.';

-- 4) Defense-in-depth: own-row UPDATE policy (matches modern accounts where
--    users.id = auth.uid(); the RPC above is the primary write path).
DROP POLICY IF EXISTS push_sub_update ON public.push_subscriptions;
CREATE POLICY push_sub_update ON public.push_subscriptions FOR UPDATE
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
