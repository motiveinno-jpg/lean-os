-- Migration: phase1_new_tables_and_alters
-- Version: 20260303130629
-- Source: production schema_migrations (auto-extracted 2026-05-04)


-- ============================================
-- Phase 1: 딜 구조 강화 + 다중통장 + 결제큐
-- ============================================

-- 1. bank_accounts: 법인 통장 관리
CREATE TABLE bank_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  bank_name TEXT NOT NULL,
  account_number TEXT NOT NULL,
  alias TEXT,
  role TEXT NOT NULL DEFAULT 'OPERATING',
  balance NUMERIC DEFAULT 0,
  is_primary BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. routing_rules: 비용 유형별 통장 매칭
CREATE TABLE routing_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  cost_type TEXT NOT NULL,
  bank_account_id UUID NOT NULL REFERENCES bank_accounts(id),
  priority INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. sub_deals: 외주/파트너 서브딜
CREATE TABLE sub_deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_deal_id UUID NOT NULL REFERENCES deals(id),
  vendor_id UUID REFERENCES vendors(id),
  name TEXT NOT NULL,
  type TEXT DEFAULT 'vendor',
  contract_amount NUMERIC DEFAULT 0,
  status TEXT DEFAULT 'active',
  start_date DATE,
  end_date DATE,
  bank_account_id UUID REFERENCES bank_accounts(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. deal_milestones: D-day / 마일스톤
CREATE TABLE deal_milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES deals(id),
  name TEXT NOT NULL,
  due_date DATE NOT NULL,
  completed_at TIMESTAMPTZ,
  status TEXT DEFAULT 'pending',
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 5. deal_assignments: 담당자 배정/교체 이력
CREATE TABLE deal_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES deals(id),
  user_id UUID NOT NULL REFERENCES users(id),
  role TEXT DEFAULT 'manager',
  assigned_at TIMESTAMPTZ DEFAULT now(),
  removed_at TIMESTAMPTZ,
  handover_notes TEXT,
  is_active BOOLEAN DEFAULT true
);

-- 6. payment_queue: 지급 실행 큐
CREATE TABLE payment_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  cost_schedule_id UUID REFERENCES deal_cost_schedule(id),
  bank_account_id UUID REFERENCES bank_accounts(id),
  amount NUMERIC NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'pending',
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  executed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- ALTER existing tables
-- ============================================

-- deals 확장
ALTER TABLE deals ADD COLUMN IF NOT EXISTS deal_number TEXT;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS internal_manager_id UUID REFERENCES users(id);
ALTER TABLE deals ADD COLUMN IF NOT EXISTS bank_account_id UUID REFERENCES bank_accounts(id);

-- deal_revenue_schedule 확장
ALTER TABLE deal_revenue_schedule ADD COLUMN IF NOT EXISTS condition_text TEXT;
ALTER TABLE deal_revenue_schedule ADD COLUMN IF NOT EXISTS split_group TEXT;

-- deal_cost_schedule 확장
ALTER TABLE deal_cost_schedule ADD COLUMN IF NOT EXISTS condition_text TEXT;
ALTER TABLE deal_cost_schedule ADD COLUMN IF NOT EXISTS split_group TEXT;
ALTER TABLE deal_cost_schedule ADD COLUMN IF NOT EXISTS sub_deal_id UUID REFERENCES sub_deals(id);

-- ============================================
-- Indexes
-- ============================================
CREATE INDEX idx_bank_accounts_company ON bank_accounts(company_id);
CREATE INDEX idx_routing_rules_company ON routing_rules(company_id);
CREATE INDEX idx_sub_deals_parent ON sub_deals(parent_deal_id);
CREATE INDEX idx_deal_milestones_deal ON deal_milestones(deal_id);
CREATE INDEX idx_deal_assignments_deal ON deal_assignments(deal_id);
CREATE INDEX idx_deal_assignments_user ON deal_assignments(user_id);
CREATE INDEX idx_payment_queue_company ON payment_queue(company_id);
CREATE INDEX idx_payment_queue_status ON payment_queue(status);
CREATE INDEX idx_deals_deal_number ON deals(deal_number);
