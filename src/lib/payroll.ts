import type { PayrollExtra } from './payment-batch';
import { fetchInsuranceRates, type InsuranceRates } from './insurance-rates';
import { comparePeople } from './people-sort';
import { logRead } from "@/lib/log-read";
/**
 * OwnerView Payroll Engine
 * 급여 명세서 + 이력 조회 + 4대보험 계산
 */

import { supabase } from './supabase';
import { calculatePayroll, type PayrollItem } from './payment-batch';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase;

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
  /** 2026-08-27 G3 — 회사 부담 4대보험 합계(국민·건강+장기요양·고용·산재) */
  totalEmployer: number;
  rates: InsuranceRates;
}> {
  //   결정 96 — 요율은 그 달이 속한 해의 회사 요율표(없으면 법정 기본값)
  const rateYear = monthKey ? Number(monthKey.slice(0, 4)) : new Date().getFullYear();
  const rates = await fetchInsuranceRates(companyId, rateYear);
  const employees = logRead('lib/payroll:employees', await db
    .from('employees')
    .select('id, name, salary, status, meal_allowance_included, hire_date, birth_date, non_taxable_amount, is_4_insurance, employee_number')
    .eq('company_id', companyId)
    .in('status', ['active', 'joined', 'invited']));

  if (!employees?.length) return { items: [], totalGross: 0, totalDeductions: 0, totalNet: 0, skippedNoBirth: [], totalEmployer: 0, rates };

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

  //   H1 (2026-08-27 인사 자동화, 결정 95) — 근태 집계로 산정된 수당(allowance_entries, 근태 저장 시 자동 chain)을
  //   미리보기에 **자동으로 얹는다**. 사람이 '수당 불러오기'를 누르던 것을 없앤다. 같은 이름의 수당을 이미 명세 수정값(extras)에
  //   적어 두었으면 그것이 이기고(중복 없음), 자동 줄은 auto=true 로 표시해 화면·PDF 가 '근태 집계' 출처를 적을 수 있게 한다.
  const autoAllow: Record<string, { name: string; amount: number }[]> = {};
  if (monthKey) {
    const rows = logRead('lib/payroll:allowances', await db
      .from('allowance_entries')
      .select('employee_id, amount, allowance_types!inner(name, code, display_order, is_active)')
      .eq('company_id', companyId)
      .eq('payroll_month', monthKey));
    const legal: Record<string, string> = { overtime: '연장수당', night: '야간수당', holiday: '휴일수당', holiday_over_8h: '휴일수당(8h초과)', on_duty: '당직비' };
    const tmp: Record<string, { name: string; amount: number; order: number }[]> = {};
    for (const r of ((rows || []) as any[])) {
      const t = r.allowance_types;
      if (!t?.is_active || Number(r.amount || 0) <= 0) continue;
      (tmp[r.employee_id] ||= []).push({ name: legal[t.code] || t.name, amount: Math.round(Number(r.amount)), order: Number(t.display_order || 100) });
    }
    for (const k of Object.keys(tmp)) autoAllow[k] = tmp[k].sort((a, b) => a.order - b.order).map(({ name, amount }) => ({ name, amount }));
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

  //   표 순서 = 사번 순 → 가나다 → ABC (2026-08-27 사장님, 디렉토리와 같은 규칙)
  for (const emp of [...(employees as any[])].sort(comparePeople)) {
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
    const valid: PayrollExtra[] = rawExtras
      .filter((e) => (e?.type === 'allowance' || e?.type === 'deduction') && typeof e?.name === 'string' && Number(e?.amount) > 0)
      .map((e) => ({ type: e.type as 'allowance' | 'deduction', name: String(e.name), amount: Math.max(0, Math.round(Number(e.amount))) }));
    for (const a of (autoAllow[emp.id] || [])) {
      if (valid.some((e) => e.type === 'allowance' && e.name === a.name)) continue;   // 사람이 적은 값이 이긴다
      valid.push({ type: 'allowance', name: a.name, amount: a.amount, auto: true });
    }
    const allowance = valid.filter((e) => e.type === 'allowance').reduce((s, e) => s + e.amount, 0);
    const deduction = valid.filter((e) => e.type === 'deduction').reduce((s, e) => s + e.amount, 0);

    const item = calculatePayroll(salary, emp.name, emp.id, {
      rates, insured: emp.is_4_insurance !== false,
      nonTaxableAmount: nonTaxable,
      dependents: 1,
      taxableAllowance: allowance, // 과세 수당 → 소득세·국민연금·건강·고용보험 자동 가산
    });
    item.employeeNumber = emp.employee_number || undefined;
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

  //   H9 (2026-08-27 인사 6차) — 전월 **발급** 명세와 비교해 총급여가 ±20% 넘게 다르면 줄에 경고(표시만, 출처: 장부 대조).
  if (monthKey) {
    const [y, m] = monthKey.split('-').map(Number); const prev = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, '0')}`;
    const prevRows = logRead('lib/payroll:prev', await db.from('payroll_items').select('employee_id, net_pay, deductions_total').eq('company_id', companyId).eq('period_month', prev).eq('status', 'issued'));
    const prevGross = new Map<string, number>();
    for (const r of ((prevRows || []) as any[])) prevGross.set(r.employee_id, Number(r.net_pay || 0) + Number(r.deductions_total || 0));
    for (const it of items) {
      const pg = prevGross.get(it.employeeId); if (!pg) continue;
      const cur = it.baseSalary + it.nonTaxableAmount + (it.extras || []).filter((e) => e.type === 'allowance').reduce((s, e) => s + e.amount, 0);
      const diff = (cur - pg) / pg;
      if (Math.abs(diff) >= 0.2) it.warn = `전월(${prev}) 총급여 ₩${Math.round(pg).toLocaleString('ko-KR')} 대비 ${diff > 0 ? '+' : ''}${Math.round(diff * 100)}%`;
    }
  }
  return { items, totalGross, totalDeductions, totalNet, skippedNoBirth, totalEmployer: items.reduce((s, it) => s + Number(it.employerCosts?.total || 0), 0), rates };
}

// ── Get total monthly salary for burn calculation ──

export async function getMonthlyTotalSalary(companyId: string): Promise<number> {
  const employees = logRead('lib/payroll:employees', await db
    .from('employees')
    .select('salary')
    .eq('company_id', companyId)
    //   'invited' = 초대만 하고 아직 합류 안 한 사람 — 급여가 나가지 않는데 비용으로 잡히던 것을 뺐다
    //   (2026-08-10). 손익계산서 급여도 같은 기준(active·joined)으로 맞췄다.
    .in('status', ['active', 'joined']));

  return (employees || []).reduce((sum: number, e: any) => sum + Number(e.salary || 0), 0);
}
