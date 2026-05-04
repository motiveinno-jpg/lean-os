-- Migration: phase5_treasury_tables
-- Version: 20260303135102
-- Source: production schema_migrations (auto-extracted 2026-05-04)


-- Phase 5: Treasury + Archiving
-- 2 new tables: treasury_positions, treasury_transactions

-- treasury_positions: 투자 포지션
CREATE TABLE treasury_positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  asset_type TEXT NOT NULL, -- stock|bond|fund|crypto|deposit
  ticker TEXT,
  name TEXT NOT NULL,
  quantity NUMERIC DEFAULT 0,
  avg_price NUMERIC DEFAULT 0,
  current_price NUMERIC DEFAULT 0,
  currency TEXT DEFAULT 'KRW',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- treasury_transactions: 매수/매도/입출금
CREATE TABLE treasury_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  position_id UUID NOT NULL REFERENCES treasury_positions(id),
  type TEXT NOT NULL, -- buy|sell|deposit|withdraw|dividend
  amount NUMERIC NOT NULL,
  price NUMERIC,
  quantity NUMERIC,
  date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_treasury_positions_company ON treasury_positions(company_id);
CREATE INDEX idx_treasury_transactions_position ON treasury_transactions(position_id);
CREATE INDEX idx_treasury_transactions_date ON treasury_transactions(date);

-- Add archived_at to deals for archiving
ALTER TABLE deals ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- RLS
ALTER TABLE treasury_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE treasury_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "treasury_positions_company" ON treasury_positions
  FOR ALL USING (company_id = get_my_company_id());

CREATE POLICY "treasury_transactions_company" ON treasury_transactions
  FOR ALL USING (
    position_id IN (SELECT id FROM treasury_positions WHERE company_id = get_my_company_id())
  );
