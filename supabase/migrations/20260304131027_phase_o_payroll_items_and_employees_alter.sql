-- Migration: phase_o_payroll_items_and_employees_alter
-- Version: 20260304131027
-- Source: production schema_migrations (auto-extracted 2026-05-04)


-- Phase O: 급여 상세 명세 테이블 + 직원 급여 계좌

-- 1) payroll_items: 급여 상세
CREATE TABLE IF NOT EXISTS public.payroll_items (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES payment_batches(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id),
  base_salary numeric NOT NULL DEFAULT 0,
  national_pension numeric DEFAULT 0,
  health_insurance numeric DEFAULT 0,
  employment_insurance numeric DEFAULT 0,
  income_tax numeric DEFAULT 0,
  local_income_tax numeric DEFAULT 0,
  deductions_total numeric DEFAULT 0,
  net_pay numeric NOT NULL DEFAULT 0,
  bank_account text,
  bank_name text,
  status text DEFAULT 'pending',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.payroll_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payroll_items_company_policy" ON public.payroll_items
  FOR ALL USING (
    batch_id IN (SELECT id FROM payment_batches WHERE company_id = get_my_company_id())
  );

CREATE INDEX IF NOT EXISTS idx_payroll_items_batch ON public.payroll_items(batch_id);
CREATE INDEX IF NOT EXISTS idx_payroll_items_employee ON public.payroll_items(employee_id);

-- 2) ALTER employees: 급여 계좌 + 4대보험
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS bank_account text,
  ADD COLUMN IF NOT EXISTS bank_name text,
  ADD COLUMN IF NOT EXISTS is_4_insurance boolean DEFAULT true;
