-- Migration: phase_g_hr_module
-- Version: 20260304032800
-- Source: production schema_migrations (auto-extracted 2026-05-04)


-- Phase G: HR Module (salary_history + employee_contracts + expense_requests + expense_approvals + employees ALTER)

-- 1) Extend employees table
ALTER TABLE public.employees 
  ADD COLUMN IF NOT EXISTS department text,
  ADD COLUMN IF NOT EXISTS position text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS contract_type text DEFAULT 'full_time',
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES public.users(id);

-- 2) salary_history
CREATE TABLE IF NOT EXISTS public.salary_history (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  effective_date date NOT NULL,
  salary numeric NOT NULL,
  previous_salary numeric,
  change_reason text,
  approved_by uuid REFERENCES public.users(id),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.salary_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "salary_history_company" ON public.salary_history
  FOR ALL USING (company_id = public.get_my_company_id());

CREATE INDEX IF NOT EXISTS idx_salary_history_employee ON public.salary_history(employee_id);
CREATE INDEX IF NOT EXISTS idx_salary_history_company ON public.salary_history(company_id);

-- 3) employee_contracts
CREATE TABLE IF NOT EXISTS public.employee_contracts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  contract_type text NOT NULL DEFAULT 'full_time',
  start_date date NOT NULL,
  end_date date,
  salary numeric,
  work_hours_per_week numeric DEFAULT 40,
  probation_end_date date,
  terms_json jsonb DEFAULT '{}',
  file_url text,
  status text DEFAULT 'active',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.employee_contracts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "employee_contracts_company" ON public.employee_contracts
  FOR ALL USING (company_id = public.get_my_company_id());

CREATE INDEX IF NOT EXISTS idx_employee_contracts_employee ON public.employee_contracts(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_contracts_company ON public.employee_contracts(company_id);

-- 4) expense_requests
CREATE TABLE IF NOT EXISTS public.expense_requests (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  requester_id uuid NOT NULL REFERENCES public.users(id),
  deal_id uuid REFERENCES public.deals(id),
  title text NOT NULL,
  description text,
  amount numeric NOT NULL,
  category text DEFAULT 'general',
  receipt_urls text[] DEFAULT '{}',
  status text DEFAULT 'pending',
  card_transaction_id uuid,
  bank_transaction_id uuid,
  tax_invoice_id uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.expense_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "expense_requests_company" ON public.expense_requests
  FOR ALL USING (company_id = public.get_my_company_id());

CREATE INDEX IF NOT EXISTS idx_expense_requests_company ON public.expense_requests(company_id);
CREATE INDEX IF NOT EXISTS idx_expense_requests_requester ON public.expense_requests(requester_id);
CREATE INDEX IF NOT EXISTS idx_expense_requests_status ON public.expense_requests(status);

-- 5) expense_approvals
CREATE TABLE IF NOT EXISTS public.expense_approvals (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  expense_id uuid NOT NULL REFERENCES public.expense_requests(id) ON DELETE CASCADE,
  approver_id uuid NOT NULL REFERENCES public.users(id),
  level integer DEFAULT 1,
  status text DEFAULT 'pending',
  comment text,
  decided_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.expense_approvals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "expense_approvals_company" ON public.expense_approvals
  FOR ALL USING (company_id = public.get_my_company_id());

CREATE INDEX IF NOT EXISTS idx_expense_approvals_expense ON public.expense_approvals(expense_id);
