-- Migration: add_share_view_rpc
-- Version: 20260307080522
-- Source: production schema_migrations (auto-extracted 2026-05-04)


CREATE OR REPLACE FUNCTION increment_share_view_count(share_id_param uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE document_shares
  SET view_count = view_count + 1, last_viewed_at = now()
  WHERE id = share_id_param AND is_active = true;
$$;
