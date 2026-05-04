-- Migration: create_onboarding_checklist_table
-- Version: 20260309065801
-- Source: production schema_migrations (auto-extracted 2026-05-04)


-- 온보딩 체크리스트
CREATE TABLE onboarding_checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES companies(id) NOT NULL,
  employee_id uuid REFERENCES employees(id) NOT NULL,
  item_key text NOT NULL,
  label text NOT NULL,
  completed boolean DEFAULT false,
  completed_at timestamptz,
  UNIQUE(employee_id, item_key)
);

ALTER TABLE onboarding_checklist_items ENABLE ROW LEVEL SECURITY;

-- 본인 읽기/쓰기
CREATE POLICY "onboarding_self" ON onboarding_checklist_items
  FOR ALL USING (
    employee_id IN (
      SELECT id FROM employees WHERE user_id = auth.uid()
    )
  );

-- 회사 관리자
CREATE POLICY "onboarding_admin" ON onboarding_checklist_items
  FOR ALL USING (
    company_id IN (
      SELECT company_id FROM users WHERE id = auth.uid() AND role IN ('owner','admin')
    )
  );
