-- Migration: company_assets_storage_policies
-- Version: 20260518180100
-- Security hardening (additive, non-destructive): codify storage RLS for
-- the `company-assets` bucket so that a user can only write objects under
-- their OWN company folder.
--
-- Defect: company seal / logo are uploaded to
--   company-assets/{companyId}/seal_auto_*.png   (upsert: true)
-- (src/app/(app)/settings/page.tsx). No storage.objects policy for this
-- bucket existed in source control. If write was open, any authenticated
-- user could overwrite another company's {companyId}/ path (seal forgery).
--
-- Design decisions:
--  * Bucket stays PUBLIC (seal_url is consumed via getPublicUrl and rendered
--    inside generated documents / PDFs). Restricting SELECT would break
--    existing seal rendering, so SELECT is intentionally NOT scoped here —
--    public read is preserved by the bucket's public flag.
--  * WRITE (INSERT / UPDATE / DELETE) is forced so the first folder segment
--    of the object name equals the caller's own company_id. upsert:true in
--    the app performs INSERT and (on overwrite) UPDATE — both are covered
--    with identical predicates so the existing seal auto-generate flow keeps
--    working for the user's own company while foreign-folder writes are
--    rejected.
--  * Idempotent: bucket insert is ON CONFLICT DO NOTHING; every policy is
--    DROP POLICY IF EXISTS + CREATE POLICY (non-destructive replacement) so
--    this is safe even if equivalent policies were already created via the
--    Supabase dashboard. No object/data is removed.

-- Ensure the bucket exists and is public (no-op if it already exists; the
-- ON CONFLICT clause means an existing bucket's public flag is left as-is).
INSERT INTO storage.buckets (id, name, public)
VALUES ('company-assets', 'company-assets', true)
ON CONFLICT (id) DO NOTHING;

-- INSERT: caller may only create objects under their own company folder.
DROP POLICY IF EXISTS "company_assets_insert" ON storage.objects;
CREATE POLICY "company_assets_insert" ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'company-assets'
    AND (storage.foldername(name))[1] = public.get_my_company_id()::text
  );

-- UPDATE: covers upsert overwrite; both the existing and the resulting row
-- must stay inside the caller's company folder.
DROP POLICY IF EXISTS "company_assets_update" ON storage.objects;
CREATE POLICY "company_assets_update" ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'company-assets'
    AND (storage.foldername(name))[1] = public.get_my_company_id()::text
  )
  WITH CHECK (
    bucket_id = 'company-assets'
    AND (storage.foldername(name))[1] = public.get_my_company_id()::text
  );

-- DELETE: caller may only delete objects under their own company folder.
DROP POLICY IF EXISTS "company_assets_delete" ON storage.objects;
CREATE POLICY "company_assets_delete" ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'company-assets'
    AND (storage.foldername(name))[1] = public.get_my_company_id()::text
  );

-- SELECT: read is intentionally left to the bucket's public flag (seal_url
-- is rendered in public document/PDF context). No SELECT policy is created
-- here to avoid over-restricting and breaking existing seal rendering.
