-- Migration: phase_g_hr_enhancement_v2
-- Version: 20260304055245
-- Source: production schema_migrations (auto-extracted 2026-05-04)


-- Phase G: HR 강화 (중복 방지)

-- 1) salary_history
CREATE TABLE IF NOT EXISTS public.salary_history (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  employee_id uuid NOT NULL REFERENCES public.employees(id),
  effective_date date NOT NULL,
  salary bigint NOT NULL,
  previous_salary bigint,
  change_reason text,
  change_type text DEFAULT 'adjustment',
  approved_by uuid REFERENCES public.users(id),
  notes text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.salary_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "salary_history_policy" ON public.salary_history;
CREATE POLICY "salary_history_policy" ON public.salary_history
  USING (company_id = public.get_my_company_id());
CREATE INDEX IF NOT EXISTS idx_salary_history_emp ON public.salary_history(employee_id);

-- 2) employee_contracts
CREATE TABLE IF NOT EXISTS public.employee_contracts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  employee_id uuid NOT NULL REFERENCES public.employees(id),
  contract_type text DEFAULT 'full_time',
  title text,
  start_date date NOT NULL,
  end_date date,
  salary bigint,
  work_hours_per_week integer DEFAULT 40,
  probation_end_date date,
  terms_json jsonb DEFAULT '{}',
  file_url text,
  status text DEFAULT 'active',
  signed_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.employee_contracts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "employee_contracts_policy" ON public.employee_contracts;
CREATE POLICY "employee_contracts_policy" ON public.employee_contracts
  USING (company_id = public.get_my_company_id());
CREATE INDEX IF NOT EXISTS idx_emp_contracts_emp ON public.employee_contracts(employee_id);

-- 3) expense_approvals (expense_requests already exists)
CREATE TABLE IF NOT EXISTS public.expense_approvals (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  expense_id uuid NOT NULL REFERENCES public.expense_requests(id) ON DELETE CASCADE,
  approver_id uuid NOT NULL REFERENCES public.users(id),
  level integer DEFAULT 1,
  status text DEFAULT 'pending',
  comment text,
  decided_at timestamptz,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.expense_approvals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "expense_approvals_policy" ON public.expense_approvals;
CREATE POLICY "expense_approvals_policy" ON public.expense_approvals
  USING (expense_id IN (SELECT id FROM public.expense_requests WHERE company_id = public.get_my_company_id()));

-- 4) ALTER employees
DO $$ BEGIN
  ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS department text;
  ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS position text;
  ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS email text;
  ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS phone text;
  ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS contract_type text DEFAULT 'full_time';
  ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES public.users(id);
  ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS bank_name text;
  ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS account_number text;
END $$;

-- 5) Add columns to expense_requests if missing
DO $$ BEGIN
  ALTER TABLE public.expense_requests ADD COLUMN IF NOT EXISTS employee_id uuid REFERENCES public.employees(id);
  ALTER TABLE public.expense_requests ADD COLUMN IF NOT EXISTS description text;
  ALTER TABLE public.expense_requests ADD COLUMN IF NOT EXISTS paid_at timestamptz;
END $$;
