-- Contract package: allow cancelling a sent package BEFORE the recipient views it.
--  1) hr_contract_packages.viewed_at - when the recipient first opened the /sign page
--  2) mark_contract_package_viewed(p_token) - anon-safe SECURITY DEFINER stamp,
--     mirrors mark_signature_viewed_by_token. Token is the shared secret.
-- Cancel itself is an app-level update (status='cancelled', sign_token=NULL):
--  nulling the token kills both the /sign lookup RPC and the complete-signing
--  edge function path, so a recipient with a stale page cannot sign afterwards.
-- (ASCII-only body to avoid encoding corruption.)

ALTER TABLE public.hr_contract_packages
  ADD COLUMN IF NOT EXISTS viewed_at timestamptz;

CREATE OR REPLACE FUNCTION public.mark_contract_package_viewed(p_token text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  UPDATE hr_contract_packages
     SET viewed_at = now()
   WHERE p_token IS NOT NULL
     AND length(p_token) >= 8
     AND sign_token = p_token
     AND status IN ('sent', 'partially_signed')
     AND viewed_at IS NULL;
$$;

REVOKE ALL ON FUNCTION public.mark_contract_package_viewed(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_contract_package_viewed(text) TO anon, authenticated;

COMMENT ON FUNCTION public.mark_contract_package_viewed(text) IS
  'External /sign page stamps first-view time on hr_contract_packages (token = secret). Enables cancel-before-viewed.';

NOTIFY pgrst, 'reload schema';
