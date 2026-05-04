-- Migration: add_employee_hr_fields_and_deal_contract_templates
-- Version: 20260310072822
-- Source: production schema_migrations (auto-extracted 2026-05-04)


-- 1. New employee fields for HR contract auto-fill
ALTER TABLE employees ADD COLUMN IF NOT EXISTS job_role text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS working_hours text DEFAULT '09:00~18:00';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS meal_allowance_included boolean DEFAULT false;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS employee_number text;

-- 2. Deal files tracking table
CREATE TABLE IF NOT EXISTS deal_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id),
  file_name text NOT NULL,
  file_url text,
  file_type text,
  file_size bigint DEFAULT 0,
  category text DEFAULT 'general',
  sequence_number int,
  uploaded_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);

-- RLS for deal_files
ALTER TABLE deal_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deal_files_company" ON deal_files
  FOR ALL USING (
    company_id IN (SELECT company_id FROM users WHERE id = auth.uid())
  );

-- Index
CREATE INDEX IF NOT EXISTS idx_deal_files_deal ON deal_files(deal_id);
CREATE INDEX IF NOT EXISTS idx_deal_files_company ON deal_files(company_id);

-- 3. Add contract_template_id to documents for deal contract template tracking
ALTER TABLE documents ADD COLUMN IF NOT EXISTS contract_template_type text;

-- 4. Add document_sequence to deals for numbering
ALTER TABLE deals ADD COLUMN IF NOT EXISTS document_sequence int DEFAULT 0;
