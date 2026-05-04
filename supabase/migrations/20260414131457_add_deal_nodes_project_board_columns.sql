-- Migration: add_deal_nodes_project_board_columns
-- Version: 20260414131457
-- Source: production schema_migrations (auto-extracted 2026-05-04)


-- Add columns for Monday-style project board
ALTER TABLE deal_nodes ADD COLUMN IF NOT EXISTS assignee_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE deal_nodes ADD COLUMN IF NOT EXISTS priority text DEFAULT 'medium' CHECK (priority IN ('high', 'medium', 'low'));
ALTER TABLE deal_nodes ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE deal_nodes ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 0;
ALTER TABLE deal_nodes ADD COLUMN IF NOT EXISTS start_date date;
ALTER TABLE deal_nodes ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE deal_nodes ADD COLUMN IF NOT EXISTS group_name text;

-- Index for board queries
CREATE INDEX IF NOT EXISTS idx_deal_nodes_assignee ON deal_nodes(assignee_id) WHERE assignee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deal_nodes_status ON deal_nodes(deal_id, status);
CREATE INDEX IF NOT EXISTS idx_deal_nodes_sort ON deal_nodes(deal_id, sort_order);
