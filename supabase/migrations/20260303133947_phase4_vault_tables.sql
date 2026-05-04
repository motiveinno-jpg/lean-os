-- Migration: phase4_vault_tables
-- Version: 20260303133947
-- Source: production schema_migrations (auto-extracted 2026-05-04)


-- ═══════════════════════════════════════════════
-- Phase 4: Vault + Auto-Discovery (4 신규 테이블)
-- ═══════════════════════════════════════════════

-- vault_accounts: SaaS 구독/계정 관리
CREATE TABLE vault_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  service_name TEXT NOT NULL,
  url TEXT,
  login_id TEXT,
  monthly_cost NUMERIC DEFAULT 0,
  payment_method TEXT,
  renewal_date DATE,
  owner_id UUID REFERENCES users(id),
  notes TEXT,
  status TEXT DEFAULT 'active',
  source TEXT DEFAULT 'manual',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- vault_assets: 유형/무형 자산
CREATE TABLE vault_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  purchase_date DATE,
  value NUMERIC DEFAULT 0,
  location TEXT,
  status TEXT DEFAULT 'in_use',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- vault_docs: 중요 문서 보관소
CREATE TABLE vault_docs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  file_url TEXT,
  tags TEXT[],
  linked_deal_id UUID REFERENCES deals(id),
  expiry_date DATE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- auto_discovery_results: AI 패턴 탐지 결과
CREATE TABLE auto_discovery_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  suggested_type TEXT NOT NULL,
  name TEXT NOT NULL,
  estimated_monthly_cost NUMERIC,
  pattern_description TEXT,
  source_transaction_ids UUID[],
  status TEXT DEFAULT 'pending',
  vault_account_id UUID REFERENCES vault_accounts(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── Indexes ──
CREATE INDEX idx_vault_accounts_company ON vault_accounts(company_id);
CREATE INDEX idx_vault_accounts_status ON vault_accounts(company_id, status);
CREATE INDEX idx_vault_assets_company ON vault_assets(company_id);
CREATE INDEX idx_vault_docs_company ON vault_docs(company_id);
CREATE INDEX idx_vault_docs_category ON vault_docs(company_id, category);
CREATE INDEX idx_auto_discovery_company ON auto_discovery_results(company_id);
CREATE INDEX idx_auto_discovery_status ON auto_discovery_results(company_id, status);

-- ── RLS ──
ALTER TABLE vault_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_docs ENABLE ROW LEVEL SECURITY;
ALTER TABLE auto_discovery_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vault_accounts_company" ON vault_accounts
  FOR ALL USING (company_id = get_my_company_id());

CREATE POLICY "vault_assets_company" ON vault_assets
  FOR ALL USING (company_id = get_my_company_id());

CREATE POLICY "vault_docs_company" ON vault_docs
  FOR ALL USING (company_id = get_my_company_id());

CREATE POLICY "auto_discovery_company" ON auto_discovery_results
  FOR ALL USING (company_id = get_my_company_id());
