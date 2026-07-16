// 인원별 급여 집계 (2026-05-27 분리, 카드 사용액 제외 — 사용자 요청).
// /reports/by-person 과 대시보드 분석(인원 탭) 둘 다 동일 로직 재사용.
//   - payslip_overrides 가 있으면 그 값, 없으면 직원 기본 salary 를 해당 월 추정치로.
//   - 재직 기간(hire_date ~ contract_end_date) 밖의 달은 산입 제외.
//   - 미래 월(이번 달 이후) 산입 제외.

import { supabase } from "./supabase";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase;

export interface PersonSalaryRow {
  key: string;          // 직원명
  payroll: number;
  byMonth: Record<string, number>; // 'YYYY-MM' → 급여
}

export function monthRange(year: number): string[] {
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
}

export async function loadSalaryByPerson(companyId: string, year: number): Promise<PersonSalaryRow[]> {
  const months = monthRange(year);

  const [empRes, overrideRes] = await Promise.all([
    db.from("employees")
      .select("id, name, salary, status, hire_date, contract_end_date")
      .eq("company_id", companyId)
      .in("status", ["active", "joined", "invited"]),
    db.from("payslip_overrides")
      .select("employee_id, period_month, base_salary")
      .eq("company_id", companyId)
      .gte("period_month", months[0])
      .lte("period_month", months[11]),
  ]);

  const empById = new Map<string, { name: string; salary: number; hireMonth: string | null; endMonth: string | null }>();
  for (const e of empRes.data || []) {
    const hireMonth = e.hire_date ? String(e.hire_date).slice(0, 7) : null;
    const endMonth = e.contract_end_date ? String(e.contract_end_date).slice(0, 7) : null;
    empById.set(e.id, { name: String(e.name || "").trim(), salary: Number(e.salary || 0), hireMonth, endMonth });
  }

  const rows = new Map<string, PersonSalaryRow>();
  const ensure = (key: string): PersonSalaryRow => {
    let r = rows.get(key);
    if (!r) {
      r = { key, payroll: 0, byMonth: {} };
      rows.set(key, r);
    }
    return r;
  };

  // override 우선
  const overrideKey = new Set<string>();
  for (const o of overrideRes.data || []) {
    const m = String(o.period_month || "").slice(0, 7);
    if (!m) continue;
    const emp = empById.get(o.employee_id);
    if (!emp || !emp.name) continue;
    overrideKey.add(`${o.employee_id}|${m}`);
    const r = ensure(emp.name);
    const amt = Number(o.base_salary || 0);
    r.payroll += amt;
    r.byMonth[m] = (r.byMonth[m] || 0) + amt;
  }

  // override 없는 월: 직원 기본 월급여 추정 (미래월·재직기간 외 제외)
  const now = new Date();
  const nowYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  for (const [empId, emp] of empById) {
    if (!emp.name || emp.salary <= 0) continue;
    for (const m of months) {
      if (m > nowYM) continue;
      if (overrideKey.has(`${empId}|${m}`)) continue;
      if (emp.hireMonth && m < emp.hireMonth) continue;
      if (emp.endMonth && m > emp.endMonth) continue;
      const r = ensure(emp.name);
      r.payroll += emp.salary;
      r.byMonth[m] = (r.byMonth[m] || 0) + emp.salary;
    }
  }

  return Array.from(rows.values()).sort((a, b) => b.payroll - a.payroll);
}
