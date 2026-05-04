-- Migration: phase0_fix_six_schema_bugs
-- Version: 20260410062547
-- Source: production schema_migrations (auto-extracted 2026-05-04)

-- Phase 0-A: Fix 6 schema bugs exposed by TS type check
-- 2026-04-10: CEO approved "add DB columns" over "remove code" approach

-- 1. closing_checklists: add lock columns referenced by src/lib/closing.ts
ALTER TABLE closing_checklists
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS locked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- 2. chat_channels: add invite_token for public invite links (used in chat/page.tsx:776)
ALTER TABLE chat_channels
  ADD COLUMN IF NOT EXISTS invite_token text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_channels_invite_token
  ON chat_channels(invite_token) WHERE invite_token IS NOT NULL;

-- 3. payment_queue: add approval_request_id for dedup (used in payment-queue.ts:31)
ALTER TABLE payment_queue
  ADD COLUMN IF NOT EXISTS approval_request_id uuid REFERENCES approval_requests(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_payment_queue_approval_request_id
  ON payment_queue(approval_request_id) WHERE approval_request_id IS NOT NULL;

-- 4. deal_cost_schedule: add company_id for direct RLS/filtering
--    (currently referenced in approval-center.ts:90,226 but missing from schema)
ALTER TABLE deal_cost_schedule
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id) ON DELETE CASCADE;

-- Backfill via deal_node -> deal -> company path (0 rows currently, safe)
UPDATE deal_cost_schedule dcs
SET company_id = d.company_id
FROM deal_nodes dn
JOIN deals d ON d.id = dn.deal_id
WHERE dcs.deal_node_id = dn.id AND dcs.company_id IS NULL;

-- Auto-populate company_id on future inserts/updates (removes burden from app code)
CREATE OR REPLACE FUNCTION set_deal_cost_schedule_company_id()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.company_id IS NULL AND NEW.deal_node_id IS NOT NULL THEN
    SELECT d.company_id INTO NEW.company_id
    FROM deal_nodes dn
    JOIN deals d ON d.id = dn.deal_id
    WHERE dn.id = NEW.deal_node_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_deal_cost_schedule_company_id ON deal_cost_schedule;
CREATE TRIGGER trg_deal_cost_schedule_company_id
BEFORE INSERT OR UPDATE OF deal_node_id ON deal_cost_schedule
FOR EACH ROW EXECUTE FUNCTION set_deal_cost_schedule_company_id();

CREATE INDEX IF NOT EXISTS idx_deal_cost_schedule_company_id
  ON deal_cost_schedule(company_id);

-- RLS policy for the new company_id path on deal_cost_schedule
-- (only add if RLS already enabled on this table)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='deal_cost_schedule' AND rowsecurity=true
  ) THEN
    DROP POLICY IF EXISTS deal_cost_schedule_company_isolation ON deal_cost_schedule;
    CREATE POLICY deal_cost_schedule_company_isolation ON deal_cost_schedule
      USING (
        company_id IN (SELECT company_id FROM users WHERE id = auth.uid())
      );
  END IF;
END $$;