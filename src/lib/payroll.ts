import { logRead } from "@/lib/log-read";
/**
 * OwnerView Payroll Engine
 * 급여 명세서 + 이력 조회 + 4대보험 계산
 */

import { supabase } from './supabase';
import { calculatePayroll, type PayrollItem } from './payment-batch';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase;

// ── Get payroll items for a batch ──

export async function getPayrollItems(batchId: string): Promise<PayrollItem[]> {
  const data = logRead('lib/payroll:data', await db
    .from('payroll_items')
    .select('*, employees(name)')
    .eq('batch_id', batchId)
    .order('created_at'));

  // payroll_items 에는 비과세/사업주부담 컬럼이 없어 저장분에서는 0 으로 복원됨 (미사용 함수)
  return (data || []).map((item: any) => ({
    employeeId: item.employee_id,
    employeeName: item.employees?.name || '',
    baseSalary: Number(item.base_salary || 0),
    nonTaxableAmount: 0,
    taxableIncome: Number(item.base_salary || 0),
    nationalPension: Number(item.national_pension || 0),
    healthInsurance: Number(item.health_insurance || 0),
    employmentInsurance: Number(item.employment_insurance || 0),
    incomeTax: Number(item.income_tax || 0),
    localIncomeTax: Number(item.local_income_tax || 0),
    deductionsTotal: Number(item.deductions_total || 0),
    netPay: Number(item.net_pay || 0),
    employerCosts: { nationalPension: 0, healthInsurance: 0, employmentInsurance: 0, industrialAccident: 0, total: 0 },
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
    // long_term_care_insurance 는 payroll_items 에 없는 컬럼 — 넣으면 insert 전체가 400
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

export async function previewPayroll(
  companyId: string,
  monthKey?: string, // 'YYYY-MM' — 해당 월 말일 기준 입사한 직원만
): Promise<{
  items: PayrollItem[];
  totalGross: number;
  totalDeductions: number;
  totalNet: number;
  skippedNoBirth: string[]; // 생년월일 없는 직원 (비밀번호 못 거는 직원)
}> {
  const employees = logRead('lib/payroll:employees', await db
    .from('employees')
    .select('id, name, salary, status, meal_allowance_included, hire_date, birth_date, non_taxable_amount')
    .eq('company_id', companyId)
    .in('status', ['active', 'joined', 'invited']));

  if (!employees?.length) return { items: [], totalGross: 0, totalDeductions: 0, totalNet: 0, skippedNoBirth: [] };

  // 해당 월 명세서 수정값(override) — employees.salary 와 무관하게 월별로 다르게 적용
  // v4 H1: extras (임의 수당/공제) 도 함께 fetch
  const overrideMap: Record<string, { base_salary: number; non_taxable_amount: number; extras?: unknown; deduction_overrides?: unknown }> = {};
  if (monthKey) {
    const overrides = logRead('lib/payroll:overrides', await db
      .from('payslip_overrides')
      .select('employee_id, base_salary, non_taxable_amount, extras, deduction_overrides')
      .eq('company_id', companyId)
      .eq('period_month', monthKey));
    (overrides || []).forEach((o: any) => {
      overrideMap[o.employee_id] = {
        base_salary: Number(o.base_salary),
        non_taxable_amount: Number(o.non_taxable_amount),
        extras: o.extras,
        deduction_overrides: o.deduction_overrides,
      };
    });
  }

  // 해당월 말일 — 입사일 필터용
  let monthEnd: string | null = null;
  if (monthKey) {
    const [y, m] = monthKey.split('-').map(Number);
    const last = new Date(y, m, 0); // m 다음 달의 0일 = 해당 월 말일
    monthEnd = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`;
  }

  const items: PayrollItem[] = [];
  const skippedNoBirth: string[] = [];
  let totalGross = 0;
  let totalDeductions = 0;
  let totalNet = 0;

  for (const emp of employees as any[]) {
    const ov = overrideMap[emp.id];
    // 월별 override 가 있으면 그 값 사용, 없으면 employees.salary(연봉 ÷ 12 = 월급) 사용
    const salary = ov ? ov.base_salary : Number(emp.salary || 0);
    if (salary <= 0) continue;

    // 입사일 이후 월만 — 해당 월 말일까지 입사한 직원
    if (monthEnd && emp.hire_date && emp.hire_date > monthEnd) continue;

    // 비과세 — override 우선, 그 다음 non_taxable_amount, 없으면 meal_allowance 20만원 기본
    const nonTaxable = ov
      ? ov.non_taxable_amount
      : (emp.non_taxable_amount != null
          ? Number(emp.non_taxable_amount)
          : (emp.meal_allowance_included ? 200_000 : 0));

    // v4 H1: 임의 수당/공제 — calculatePayroll 호출 전에 먼저 합산해서
    //   과세 수당(allowance)을 과세소득에 반영(소득세·4대보험 자동 재계산)한다.
    const rawExtras = Array.isArray(ov?.extras) ? ov!.extras as Array<{ type?: string; name?: string; amount?: number }> : [];
    const valid = rawExtras
      .filter((e) => (e?.type === 'allowance' || e?.type === 'deduction') && typeof e?.name === 'string' && Number(e?.amount) > 0)
      .map((e) => ({ type: e.type as 'allowance' | 'deduction', name: String(e.name), amount: Math.max(0, Math.round(Number(e.amount))) }));
    const allowance = valid.filter((e) => e.type === 'allowance').reduce((s, e) => s + e.amount, 0);
    const deduction = valid.filter((e) => e.type === 'deduction').reduce((s, e) => s + e.amount, 0);

    const item = calculatePayroll(salary, emp.name, emp.id, {
      nonTaxableAmount: nonTaxable,
      dependents: 1,
      taxableAllowance: allowance, // 과세 수당 → 소득세·국민연금·건강·고용보험 자동 가산
    });
    // 수당/공제 항목 표시 + 실수령 가감 (세금은 calculatePayroll 이 이미 반영)
    if (valid.length > 0) {
      item.extras = valid;
      item.netPay = item.netPay + allowance - deduction;
      item.deductionsTotal = item.deductionsTotal + deduction;
    }
    // 공제액 수동 수정(deduction_overrides) — 관리자가 편집모드에서 바꾼 항목만 반영(델타).
    //   미수정 항목은 엔진 자동계산 유지. deductionsTotal/netPay 는 차액만큼 보정.
    const od = (ov?.deduction_overrides && typeof ov.deduction_overrides === 'object')
      ? ov.deduction_overrides as Record<string, unknown> : null;
    if (od) {
      const FIELDS: Array<keyof PayrollItem> = ['nationalPension', 'healthInsurance', 'longTermCareInsurance', 'employmentInsurance', 'incomeTax', 'localIncomeTax'];
      let delta = 0;
      for (const f of FIELDS) {
        const raw = od[f as string];
        if (raw == null || raw === '') continue;
        const nv = Math.max(0, Math.round(Number(raw)));
        if (!Number.isFinite(nv)) continue;
        const cur = Number((item as any)[f] || 0);
        delta += nv - cur;
        (item as any)[f] = nv;
      }
      if (delta !== 0) {
        item.deductionsTotal = item.deductionsTotal + delta;
        item.netPay = item.netPay - delta;
      }
    }
    items.push(item);
    // 세전 총급여 = 과세 기본급 + 비과세(식대) + 과세수당 (지급총액 기준)
    totalGross += item.baseSalary + nonTaxable + allowance;
    totalDeductions += item.deductionsTotal;
    totalNet += item.netPay;

    if (!emp.birth_date) skippedNoBirth.push(emp.name);
  }

  return { items, totalGross, totalDeductions, totalNet, skippedNoBirth };
}

// ── Get payroll history (all batches with payroll items) ──

export async function getPayrollHistory(companyId: string) {
  const batches = logRead('lib/payroll:batches', await db
    .from('payment_batches')
    .select('id, name, total_amount, item_count, status, created_at, approved_at')
    .eq('company_id', companyId)
    .eq('batch_type', 'payroll')
    .order('created_at', { ascending: false }));

  return batches || [];
}

// ── Get total monthly salary for burn calculation ──

export async function getMonthlyTotalSalary(companyId: string): Promise<number> {
  const employees = logRead('lib/payroll:employees', await db
    .from('employees')
    .select('salary')
    .eq('company_id', companyId)
    .in('status', ['active', 'joined', 'invited']));

  return (employees || []).reduce((sum: number, e: any) => sum + Number(e.salary || 0), 0);
}
