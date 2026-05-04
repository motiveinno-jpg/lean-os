-- Migration: fix_deal_nodes_assignee_fk_to_public_users
-- Version: 20260414132341
-- Source: production schema_migrations (auto-extracted 2026-05-04)

ALTER TABLE public.deal_nodes DROP CONSTRAINT deal_nodes_assignee_id_fkey;
ALTER TABLE public.deal_nodes
  ADD CONSTRAINT deal_nodes_assignee_id_fkey
  FOREIGN KEY (assignee_id) REFERENCES public.users(id) ON DELETE SET NULL;