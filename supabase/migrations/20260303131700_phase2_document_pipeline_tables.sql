-- Migration: phase2_document_pipeline_tables
-- Version: 20260303131700
-- Source: production schema_migrations (auto-extracted 2026-05-04)


-- ============================================
-- Phase 2: 문서 파이프라인 + 세금계산서
-- ============================================

-- 1. doc_templates: 계약서/견적서 템플릿
CREATE TABLE doc_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  content_json JSONB NOT NULL DEFAULT '{}',
  variables JSONB DEFAULT '[]',
  version INTEGER DEFAULT 1,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. documents: 생성된 문서
CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  template_id UUID REFERENCES doc_templates(id),
  deal_id UUID REFERENCES deals(id),
  name TEXT NOT NULL,
  status TEXT DEFAULT 'draft',
  content_json JSONB NOT NULL DEFAULT '{}',
  version INTEGER DEFAULT 1,
  locked_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. doc_revisions: 수정 이력
CREATE TABLE doc_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id),
  author_id UUID REFERENCES users(id),
  changes_json JSONB NOT NULL,
  comment TEXT,
  version INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. doc_approvals: 승인
CREATE TABLE doc_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id),
  approver_id UUID NOT NULL REFERENCES users(id),
  status TEXT DEFAULT 'pending',
  comment TEXT,
  signed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 5. tax_invoices: 세금계산서
CREATE TABLE tax_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  deal_id UUID REFERENCES deals(id),
  type TEXT NOT NULL,
  counterparty_name TEXT NOT NULL,
  counterparty_bizno TEXT,
  supply_amount NUMERIC NOT NULL,
  tax_amount NUMERIC NOT NULL,
  total_amount NUMERIC NOT NULL,
  issue_date DATE NOT NULL,
  status TEXT DEFAULT 'draft',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_doc_templates_company ON doc_templates(company_id);
CREATE INDEX idx_documents_company ON documents(company_id);
CREATE INDEX idx_documents_deal ON documents(deal_id);
CREATE INDEX idx_documents_status ON documents(status);
CREATE INDEX idx_doc_revisions_document ON doc_revisions(document_id);
CREATE INDEX idx_doc_approvals_document ON doc_approvals(document_id);
CREATE INDEX idx_tax_invoices_company ON tax_invoices(company_id);
CREATE INDEX idx_tax_invoices_deal ON tax_invoices(deal_id);
CREATE INDEX idx_tax_invoices_status ON tax_invoices(status);
