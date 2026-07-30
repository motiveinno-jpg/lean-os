-- Security fix (High / PII leak):
--   The anon SELECT policies on hr_contract_packages / hr_contract_package_items
--   only checked "sign_token IS NOT NULL" instead of matching the presented token.
--   => any anonymous client could enumerate EVERY company's contract packages
--      (birth_date, seal, contract_meta PII) via select('*').not('sign_token','is',null).
--
-- Fix:
--   1) Add a SECURITY DEFINER RPC get_contract_package_by_token(p_token) that
--      returns a single package (+ employee/company/items) ONLY when the exact
--      sign_token matches. Mirrors get_signature_request_by_token pattern.
--   2) Drop the two broken anon SELECT policies. The authenticated,
--      company-scoped policies (hr_contract_packages_company /
--      hr_contract_package_items_access, both using get_my_company_id())
--      remain untouched, so in-app access is unaffected.
--   After this, anon can reach these tables ONLY through the RPC below.
--
-- Note: ASCII-only body (no Korean comments) to avoid encoding corruption.

-- ============================================================
-- 1. Anon-safe token lookup RPC (SECURITY DEFINER)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_contract_package_by_token(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v jsonb;
BEGIN
  -- token is the shared secret; reject obviously invalid input to avoid probing
  IF p_token IS NULL OR length(p_token) < 8 THEN
    RETURN NULL;
  END IF;

  SELECT to_jsonb(p.*)
    || jsonb_build_object(
      'employees',
      CASE WHEN e.id IS NOT NULL THEN jsonb_build_object(
        'name', e.name,
        'email', e.email,
        'department', e.department,
        'position', e.position,
        'birth_date', e.birth_date,
        'saved_signature', e.saved_signature
      ) ELSE NULL END,
      'companies',
      CASE WHEN co.id IS NOT NULL THEN jsonb_build_object(
        'name', co.name,
        'seal_url', co.seal_url,
        'representative', co.representative,
        'business_number', co.business_number
      ) ELSE NULL END,
      'items',
      COALESCE((
        SELECT jsonb_agg(
          to_jsonb(it.*) || jsonb_build_object(
            'documents',
            CASE WHEN d.id IS NOT NULL THEN jsonb_build_object(
              'name', d.name,
              'content_json', d.content_json,
              'status', d.status
            ) ELSE NULL END
          )
          ORDER BY it.sort_order
        )
        FROM hr_contract_package_items it
        LEFT JOIN documents d ON d.id = it.document_id
        WHERE it.package_id = p.id
      ), '[]'::jsonb)
    )
  INTO v
  FROM hr_contract_packages p
  LEFT JOIN employees e ON e.id = p.employee_id
  LEFT JOIN companies co ON co.id = p.company_id
  WHERE p.sign_token = p_token
  LIMIT 1;

  RETURN v;  -- NULL when no exact token match
END;
$$;

REVOKE ALL ON FUNCTION public.get_contract_package_by_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_contract_package_by_token(text) TO anon, authenticated;

COMMENT ON FUNCTION public.get_contract_package_by_token(text) IS
  'External /sign page anon-safe lookup. Returns one hr_contract_package (+employee/company/items) only when sign_token matches exactly; NULL otherwise. Replaces the removed anon SELECT policies (token = secret).';

-- ============================================================
-- 2. Remove the broken anon SELECT policies (token not verified)
--    Authenticated company-scoped policies are left intact.
-- ============================================================
DROP POLICY IF EXISTS "hr_contract_packages_sign_token" ON hr_contract_packages;
DROP POLICY IF EXISTS "hr_contract_package_items_sign_token" ON hr_contract_package_items;

NOTIFY pgrst, 'reload schema';
