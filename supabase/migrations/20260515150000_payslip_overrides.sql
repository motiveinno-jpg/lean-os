-- Migration: payslip_overrides
-- 급여명세서 월별 수정값 저장. employees.salary(연봉) 는 그대로 두고
-- 특정 월의 명세서만 다른 값으로 발급/저장할 수 있게 한다.

CREATE TABLE IF NOT EXISTS payslip_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  period_month text NOT NULL,                 -- 'YYYY-MM'
  base_salary numeric NOT NULL DEFAULT 0,     -- 해당 월 과세+비과세 합산 기준급
  non_taxable_amount numeric NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(employee_id, period_month)
);

ALTER TABLE payslip_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payslip_overrides_company" ON payslip_overrides
  FOR ALL
  USING (company_id = get_my_company_id())
  WITH CHECK (company_id = get_my_company_id());

CREATE INDEX IF NOT EXISTS idx_payslip_overrides_emp_month
  ON payslip_overrides(employee_id, period_month);
