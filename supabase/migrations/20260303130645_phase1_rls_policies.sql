-- Migration: phase1_rls_policies
-- Version: 20260303130645
-- Source: production schema_migrations (auto-extracted 2026-05-04)


-- ============================================
-- RLS Policies for Phase 1 tables
-- ============================================

-- bank_accounts
ALTER TABLE bank_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Company members can view bank accounts"
  ON bank_accounts FOR SELECT
  USING (company_id = get_my_company_id());
CREATE POLICY "Company members can manage bank accounts"
  ON bank_accounts FOR ALL
  USING (company_id = get_my_company_id())
  WITH CHECK (company_id = get_my_company_id());

-- routing_rules
ALTER TABLE routing_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Company members can view routing rules"
  ON routing_rules FOR SELECT
  USING (company_id = get_my_company_id());
CREATE POLICY "Company members can manage routing rules"
  ON routing_rules FOR ALL
  USING (company_id = get_my_company_id())
  WITH CHECK (company_id = get_my_company_id());

-- sub_deals
ALTER TABLE sub_deals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Company members can view sub deals"
  ON sub_deals FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM deals d
    WHERE d.id = sub_deals.parent_deal_id
    AND d.company_id = get_my_company_id()
  ));
CREATE POLICY "Company members can manage sub deals"
  ON sub_deals FOR ALL
  USING (EXISTS (
    SELECT 1 FROM deals d
    WHERE d.id = sub_deals.parent_deal_id
    AND d.company_id = get_my_company_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM deals d
    WHERE d.id = sub_deals.parent_deal_id
    AND d.company_id = get_my_company_id()
  ));

-- deal_milestones
ALTER TABLE deal_milestones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Company members can view milestones"
  ON deal_milestones FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM deals d
    WHERE d.id = deal_milestones.deal_id
    AND d.company_id = get_my_company_id()
  ));
CREATE POLICY "Company members can manage milestones"
  ON deal_milestones FOR ALL
  USING (EXISTS (
    SELECT 1 FROM deals d
    WHERE d.id = deal_milestones.deal_id
    AND d.company_id = get_my_company_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM deals d
    WHERE d.id = deal_milestones.deal_id
    AND d.company_id = get_my_company_id()
  ));

-- deal_assignments
ALTER TABLE deal_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Company members can view assignments"
  ON deal_assignments FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM deals d
    WHERE d.id = deal_assignments.deal_id
    AND d.company_id = get_my_company_id()
  ));
CREATE POLICY "Company members can manage assignments"
  ON deal_assignments FOR ALL
  USING (EXISTS (
    SELECT 1 FROM deals d
    WHERE d.id = deal_assignments.deal_id
    AND d.company_id = get_my_company_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM deals d
    WHERE d.id = deal_assignments.deal_id
    AND d.company_id = get_my_company_id()
  ));

-- payment_queue
ALTER TABLE payment_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Company members can view payment queue"
  ON payment_queue FOR SELECT
  USING (company_id = get_my_company_id());
CREATE POLICY "Company members can manage payment queue"
  ON payment_queue FOR ALL
  USING (company_id = get_my_company_id())
  WITH CHECK (company_id = get_my_company_id());
