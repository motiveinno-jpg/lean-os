-- ═══════════════════════════════════════════════════════════════════════
-- Cash Budget / Treasury Management Tables
-- 자금 예산 관리 테이블
-- ═══════════════════════════════════════════════════════════════════════

-- ── Fixed Costs (고정비) ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fixed_costs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies(id),
  name text NOT NULL,
  amount bigint NOT NULL DEFAULT 0,
  payment_day integer NOT NULL DEFAULT 1 CHECK (payment_day BETWEEN 1 AND 31),
  category text NOT NULL DEFAULT 'other'
    CHECK (category IN ('office', 'insurance', 'loan', 'salary', 'subscription', 'tax', 'other')),
  is_recurring boolean NOT NULL DEFAULT true,
  start_date date,
  end_date date,
  note text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_fixed_costs_company ON fixed_costs(company_id, category);
CREATE INDEX idx_fixed_costs_payment_day ON fixed_costs(company_id, payment_day);

ALTER TABLE fixed_costs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view fixed costs for their company"
  ON fixed_costs FOR SELECT
  USING (company_id IN (
    SELECT company_id FROM users WHERE auth_id = auth.uid()
  ));

CREATE POLICY "Users can insert fixed costs for their company"
  ON fixed_costs FOR INSERT
  WITH CHECK (company_id IN (
    SELECT company_id FROM users WHERE auth_id = auth.uid()
  ));

CREATE POLICY "Users can update fixed costs for their company"
  ON fixed_costs FOR UPDATE
  USING (company_id IN (
    SELECT company_id FROM users WHERE auth_id = auth.uid()
  ));

CREATE POLICY "Users can delete fixed costs for their company"
  ON fixed_costs FOR DELETE
  USING (company_id IN (
    SELECT company_id FROM users WHERE auth_id = auth.uid()
  ));

-- ── Owner Injections (대표 가수금) ────────────────────────────────────

CREATE TABLE IF NOT EXISTS owner_injections (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies(id),
  amount bigint NOT NULL DEFAULT 0,
  date date NOT NULL DEFAULT CURRENT_DATE,
  note text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_owner_injections_company ON owner_injections(company_id, date DESC);

ALTER TABLE owner_injections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view owner injections for their company"
  ON owner_injections FOR SELECT
  USING (company_id IN (
    SELECT company_id FROM users WHERE auth_id = auth.uid()
  ));

CREATE POLICY "Users can insert owner injections for their company"
  ON owner_injections FOR INSERT
  WITH CHECK (company_id IN (
    SELECT company_id FROM users WHERE auth_id = auth.uid()
  ));

CREATE POLICY "Users can update owner injections for their company"
  ON owner_injections FOR UPDATE
  USING (company_id IN (
    SELECT company_id FROM users WHERE auth_id = auth.uid()
  ));

CREATE POLICY "Users can delete owner injections for their company"
  ON owner_injections FOR DELETE
  USING (company_id IN (
    SELECT company_id FROM users WHERE auth_id = auth.uid()
  ));

-- ── Cash Projections (자금 예측 스냅샷) ─────────────────────────────

CREATE TABLE IF NOT EXISTS cash_projections (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies(id),
  month text NOT NULL,            -- '2026-03'
  projection_data jsonb NOT NULL DEFAULT '{}',
  generated_at timestamptz DEFAULT now(),
  generated_by uuid REFERENCES users(id)
);

CREATE INDEX idx_cash_projections_company ON cash_projections(company_id, month DESC);
CREATE UNIQUE INDEX idx_cash_projections_unique ON cash_projections(company_id, month);

ALTER TABLE cash_projections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view cash projections for their company"
  ON cash_projections FOR SELECT
  USING (company_id IN (
    SELECT company_id FROM users WHERE auth_id = auth.uid()
  ));

CREATE POLICY "Users can insert cash projections for their company"
  ON cash_projections FOR INSERT
  WITH CHECK (company_id IN (
    SELECT company_id FROM users WHERE auth_id = auth.uid()
  ));

CREATE POLICY "Users can update cash projections for their company"
  ON cash_projections FOR UPDATE
  USING (company_id IN (
    SELECT company_id FROM users WHERE auth_id = auth.uid()
  ));
