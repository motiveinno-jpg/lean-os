// ── 발송된 급여 명세(payroll_items) → 원천세·지급명세서 한 줄 해석 (2026-10-14 세무 2차 5단계에서 세무 신고 화면에서 옮겨 옴) ──
//   원천세 신고서·급여대장·간이/연간 지급명세서가 같은 해석을 쓴다 — 두 곳에서 갈리면 신고서와 명세서 숫자가 어긋난다.
//   결정 101 — 과세 지급총액 = 과세 기본급 + 과세 수당(extras 의 allowance 는 전부 과세, 비과세 수당은 non_taxable 로 따로 든다).
//   결정 102 — 사업소득자 구분은 지금 고용형태('freelance') 기준(스냅샷엔 없다).

import { comparePeople } from "@/lib/people-sort";

export type WhtRow = {
  employee_id: string; name: string; employee_number: string | null;
  /** 사업소득자(프리랜서 3.3%) — 결정 102. 지금 고용형태 기준 */
  biz: boolean;
  period_month: string;
  taxable: number; nonTaxable: number; incomeTax: number; localIncomeTax: number; issuedAt: string | null;
  /** 급여대장 칸 (2026-10-14 4단계) — 4대보험 근로자 부담·공제 합계·실지급액 */
  pension: number; health: number; ltc: number; employment: number; deductions: number; net: number;
};

export const aggOf = (list: WhtRow[]) => ({
  n: list.length,
  taxable: list.reduce((s, r) => s + r.taxable, 0),
  nonTaxable: list.reduce((s, r) => s + r.nonTaxable, 0),
  incomeTax: list.reduce((s, r) => s + r.incomeTax, 0),
  localTax: list.reduce((s, r) => s + r.localIncomeTax, 0),
});

export function toWhtRows(data: any[]): WhtRow[] {
  return (data || []).map((r: any) => {
    const allowance = (Array.isArray(r.extras) ? r.extras : [])
      .filter((e: any) => e?.type === "allowance" && Number(e?.amount) > 0)
      .reduce((s: number, e: any) => s + Math.round(Number(e.amount)), 0);
    return {
      employee_id: r.employee_id,
      name: r.employees?.name || "(이름 없음)",
      employee_number: r.employees?.employee_number || null,
      biz: r.employees?.employment_type === "freelance",
      period_month: r.period_month,
      taxable: Number(r.base_salary || 0) + allowance,
      nonTaxable: Number(r.non_taxable_amount || 0),
      incomeTax: Number(r.income_tax || 0),
      localIncomeTax: Number(r.local_income_tax || 0),
      issuedAt: r.issued_at || null,
      pension: Number(r.national_pension || 0), health: Number(r.health_insurance || 0), ltc: Number(r.long_term_care_insurance || 0),
      employment: Number(r.employment_insurance || 0), deductions: Number(r.deductions_total || 0), net: Number(r.net_pay || 0),
    };
  }).sort((a: WhtRow, b: WhtRow) => comparePeople(a, b));
}

export const WHT_SELECT = "employee_id, period_month, base_salary, non_taxable_amount, income_tax, local_income_tax, extras, issued_at, national_pension, health_insurance, long_term_care_insurance, employment_insurance, deductions_total, net_pay, employees(name, employee_number, employment_type)";

/** 반기 여섯 달 YYYY-MM */
export const halfMonths = (y: number, h: 1 | 2) =>
  Array.from({ length: 6 }, (_, i) => `${y}-${String(h === 1 ? i + 1 : i + 7).padStart(2, "0")}`);
