/**
 * Reflect Payroll Engine
 * 급여 명세서 + 이력 조회 + 4대보험 계산
 */

import { supabase } from './supabase';
import { calculatePayroll, type PayrollItem } from './payment-batch';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

// ── Get payroll items for a batch ──

export async function getPayrollItems(batchId: string): Promise<PayrollItem[]> {
  const { data } = await db
    .from('payroll_items')
    .select('*, employees(name)')
    .eq('batch_id', batchId)
    .order('created_at');

  return (data || []).map((item: any) => ({
    employeeId: item.employee_id,
    employeeName: item.employees?.name || '',
    baseSalary: Number(item.base_salary || 0),
    nationalPension: Number(item.national_pension || 0),
    healthInsurance: Number(item.health_insurance || 0),
    employmentInsurance: Number(item.employment_insurance || 0),
    incomeTax: Number(item.income_tax || 0),
    localIncomeTax: Number(item.local_income_tax || 0),
    deductionsTotal: Number(item.deductions_total || 0),
    netPay: Number(item.net_pay || 0),
  }));
}

// ── Save payroll items to DB ──

export async function savePayrollItems(batchId: string, items: PayrollItem[]): Promise<void> {
  const rows = items.map((item) => ({
    batch_id: batchId,
    employee_id: item.employeeId,
    base_salary: item.baseSalary,
    national_pension: item.nationalPension,
    health_insurance: item.healthInsurance,
    employment_insurance: item.employmentInsurance,
    income_tax: item.incomeTax,
    local_income_tax: item.localIncomeTax,
    deductions_total: item.deductionsTotal,
    net_pay: item.netPay,
    status: 'pending',
  }));

  await db.from('payroll_items').insert(rows);
}

// ── Generate payroll preview (no DB write) ──

export async function previewPayroll(companyId: string): Promise<{
  items: PayrollItem[];
  totalGross: number;
  totalDeductions: number;
  totalNet: number;
}> {
  const { data: employees } = await db
    .from('employees')
    .select('id, name, salary, status')
    .eq('company_id', companyId)
    .eq('status', 'active');

  if (!employees?.length) return { items: [], totalGross: 0, totalDeductions: 0, totalNet: 0 };

  const items: PayrollItem[] = [];
  let totalGross = 0;
  let totalDeductions = 0;
  let totalNet = 0;

  for (const emp of employees) {
    const salary = Number(emp.salary || 0);
    if (salary <= 0) continue;

    const item = calculatePayroll(salary, emp.name, emp.id);
    items.push(item);
    totalGross += item.baseSalary;
    totalDeductions += item.deductionsTotal;
    totalNet += item.netPay;
  }

  return { items, totalGross, totalDeductions, totalNet };
}

// ── Get payroll history (all batches with payroll items) ──

export async function getPayrollHistory(companyId: string) {
  const { data: batches } = await db
    .from('payment_batches')
    .select('id, name, total_amount, item_count, status, created_at, approved_at')
    .eq('company_id', companyId)
    .eq('batch_type', 'payroll')
    .order('created_at', { ascending: false });

  return batches || [];
}

// ── Get total monthly salary for burn calculation ──

export async function getMonthlyTotalSalary(companyId: string): Promise<number> {
  const { data: employees } = await db
    .from('employees')
    .select('salary')
    .eq('company_id', companyId)
    .eq('status', 'active');

  return (employees || []).reduce((sum: number, e: any) => sum + Number(e.salary || 0), 0);
}
