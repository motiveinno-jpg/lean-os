-- Migration: create_employee_files_table
-- Version: 20260309065751
-- Source: production schema_migrations (auto-extracted 2026-05-04)


-- 입사서류 테이블
CREATE TABLE employee_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES companies(id) NOT NULL,
  employee_id uuid REFERENCES employees(id) NOT NULL,
  category text NOT NULL CHECK (category IN ('resume','id_copy','bank_copy','resident_reg','portfolio','other')),
  file_name text NOT NULL,
  file_url text NOT NULL,
  storage_path text NOT NULL,
  file_size bigint DEFAULT 0,
  mime_type text,
  verified boolean DEFAULT false,
  verified_by uuid REFERENCES users(id),
  verified_at timestamptz,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE employee_files ENABLE ROW LEVEL SECURITY;

-- 본인 조회
CREATE POLICY "employee_files_self_read" ON employee_files
  FOR SELECT USING (
    employee_id IN (
      SELECT id FROM employees WHERE user_id = auth.uid()
    )
  );

-- 본인 INSERT
CREATE POLICY "employee_files_self_insert" ON employee_files
  FOR INSERT WITH CHECK (
    employee_id IN (
      SELECT id FROM employees WHERE user_id = auth.uid()
    )
  );

-- 같은 회사 owner/admin 전체 접근
CREATE POLICY "employee_files_company_admin" ON employee_files
  FOR ALL USING (
    company_id IN (
      SELECT company_id FROM users WHERE id = auth.uid() AND role IN ('owner','admin')
    )
  );
