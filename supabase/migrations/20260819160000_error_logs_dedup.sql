-- Error log dedup (2026-08-19): the same error, hit by several users or reloads,
-- piled up as separate rows ("8 errors" that were really 2 bugs). Collapse at the
-- source with a BEFORE INSERT trigger: if the same message+url arrived within the
-- last 24 hours, bump dup_count/last_seen_at on the existing row and skip the
-- insert. Works for every writer (browser boundary, manual logError, edge fns)
-- with zero app changes. (ASCII-only body.)

ALTER TABLE public.error_logs
  ADD COLUMN IF NOT EXISTS dup_count integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

CREATE OR REPLACE FUNCTION public.error_logs_dedup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  existing_id uuid;
BEGIN
  SELECT id INTO existing_id
    FROM error_logs
   WHERE message = NEW.message
     AND coalesce(url, '') = coalesce(NEW.url, '')
     AND created_at > now() - interval '24 hours'
   ORDER BY created_at DESC
   LIMIT 1;

  IF existing_id IS NOT NULL THEN
    UPDATE error_logs
       SET dup_count = dup_count + 1,
           last_seen_at = now()
     WHERE id = existing_id;
    RETURN NULL; -- swallow the duplicate row
  END IF;

  NEW.last_seen_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_error_logs_dedup ON public.error_logs;
CREATE TRIGGER trg_error_logs_dedup
  BEFORE INSERT ON public.error_logs
  FOR EACH ROW EXECUTE FUNCTION public.error_logs_dedup();

NOTIFY pgrst, 'reload schema';
