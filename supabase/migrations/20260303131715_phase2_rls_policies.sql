-- Migration: phase2_rls_policies
-- Version: 20260303131715
-- Source: production schema_migrations (auto-extracted 2026-05-04)


-- ============================================
-- RLS for Phase 2 tables
-- ============================================

-- doc_templates
ALTER TABLE doc_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Company members can view doc templates"
  ON doc_templates FOR SELECT USING (company_id = get_my_company_id());
CREATE POLICY "Company members can manage doc templates"
  ON doc_templates FOR ALL
  USING (company_id = get_my_company_id())
  WITH CHECK (company_id = get_my_company_id());

-- documents
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Company members can view documents"
  ON documents FOR SELECT USING (company_id = get_my_company_id());
CREATE POLICY "Company members can manage documents"
  ON documents FOR ALL
  USING (company_id = get_my_company_id())
  WITH CHECK (company_id = get_my_company_id());

-- doc_revisions
ALTER TABLE doc_revisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Company members can view revisions"
  ON doc_revisions FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM documents d
    WHERE d.id = doc_revisions.document_id
    AND d.company_id = get_my_company_id()
  ));
CREATE POLICY "Company members can manage revisions"
  ON doc_revisions FOR ALL
  USING (EXISTS (
    SELECT 1 FROM documents d
    WHERE d.id = doc_revisions.document_id
    AND d.company_id = get_my_company_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM documents d
    WHERE d.id = doc_revisions.document_id
    AND d.company_id = get_my_company_id()
  ));

-- doc_approvals
ALTER TABLE doc_approvals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Company members can view approvals"
  ON doc_approvals FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM documents d
    WHERE d.id = doc_approvals.document_id
    AND d.company_id = get_my_company_id()
  ));
CREATE POLICY "Company members can manage approvals"
  ON doc_approvals FOR ALL
  USING (EXISTS (
    SELECT 1 FROM documents d
    WHERE d.id = doc_approvals.document_id
    AND d.company_id = get_my_company_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM documents d
    WHERE d.id = doc_approvals.document_id
    AND d.company_id = get_my_company_id()
  ));

-- tax_invoices
ALTER TABLE tax_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Company members can view tax invoices"
  ON tax_invoices FOR SELECT USING (company_id = get_my_company_id());
CREATE POLICY "Company members can manage tax invoices"
  ON tax_invoices FOR ALL
  USING (company_id = get_my_company_id())
  WITH CHECK (company_id = get_my_company_id());
