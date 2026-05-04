-- Migration: add_employee_onboarding_columns
-- Version: 20260309065737
-- Source: production schema_migrations (auto-extracted 2026-05-04)


-- employees 테이블에 온보딩 관련 컬럼 추가
ALTER TABLE employees ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS birth_date date;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS bank_name text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS bank_account text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS bank_holder text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS emergency_contact text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS emergency_phone text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS saved_signature jsonb;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz;
