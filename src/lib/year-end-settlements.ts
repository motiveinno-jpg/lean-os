// ── 연말정산 신청·확정 (year_end_settlements) — 2026-10-14 연말정산 2·3단계 ──
//   직원: 공제 자료(input)를 넣고 제출 · 담당자(마스터·급여 권한): 급여 자료(payroll)와 합쳐 계산(result)해 확정 또는 반려.
//   권한·상태 전이는 DB 가드가 다시 막는다(직원은 draft/submitted 만, 확정본은 못 고침).
//   급여 자료 = 그 해 발송된 급여 명세(payroll_items, 근로만 — 프리랜서 제외). 해석은 원천세와 같은 lib/tax-forms/wht-rows.

import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";
import { toWhtRows, WHT_SELECT } from "@/lib/tax-forms/wht-rows";
import { computeYearEnd, type YearEndInput, type YearEndResult } from "@/lib/tax-forms/year-end";

export type YearEndStatus = "draft" | "submitted" | "returned" | "confirmed";
export type Deductions = Omit<YearEndInput, "totalPay" | "paidIncomeTax" | "paidLocalTax" | "pension" | "healthLtc" | "employment">;
export type PayrollSummary = { totalPay: number; paidIncomeTax: number; paidLocalTax: number; pension: number; healthLtc: number; employment: number; months: number };
export type Settlement = {
  id: string; company_id: string; employee_id: string; year: number; status: YearEndStatus;
  input: Deductions; payroll: PayrollSummary | Record<string, never>; result: YearEndResult | Record<string, never>;
  return_reason: string | null; submitted_at: string | null; confirmed_at: string | null; updated_at: string;
};
const SEL = "id, company_id, employee_id, year, status, input, payroll, result, return_reason, submitted_at, confirmed_at, updated_at";

export async function getMySettlement(employeeId: string, year: number): Promise<Settlement | null> {
  return (logRead("year-end:mine", await (supabase as any).from("year_end_settlements").select(SEL).eq("employee_id", employeeId).eq("year", year).maybeSingle()) || null) as Settlement | null;
}
export async function listSettlements(companyId: string, year: number): Promise<Settlement[]> {
  return (logRead("year-end:list", await (supabase as any).from("year_end_settlements").select(SEL).eq("company_id", companyId).eq("year", year).limit(2000)) || []) as Settlement[];
}

/** 직원 저장·제출 — 행이 없으면 만든다(employee_id+year 하나) */
export async function saveMyInput(companyId: string, employeeId: string, year: number, input: Deductions, submit: boolean): Promise<void> {
  const { data, error } = await (supabase as any).from("year_end_settlements")
    .upsert({ company_id: companyId, employee_id: employeeId, year, input, status: submit ? "submitted" : "draft" }, { onConflict: "employee_id,year" }).select("id");
  if (error) throw error;
  if (!data?.length) throw new Error("저장하지 못했습니다(권한 또는 확정된 정산)");
}

/** 담당자 확정 — 급여 자료·계산 결과를 같이 남긴다 */
export async function confirmSettlement(id: string, payroll: PayrollSummary, result: YearEndResult): Promise<void> {
  const { data, error } = await (supabase as any).from("year_end_settlements").update({ status: "confirmed", payroll, result, return_reason: null }).eq("id", id).select("id");
  if (error) throw error;
  if (!data?.length) throw new Error("확정하지 못했습니다(권한 확인)");
}
export async function returnSettlement(id: string, reason: string): Promise<void> {
  const { data, error } = await (supabase as any).from("year_end_settlements").update({ status: "returned", return_reason: reason || null }).eq("id", id).select("id");
  if (error) throw error;
  if (!data?.length) throw new Error("반려하지 못했습니다(권한 확인)");
}
/** 확정 취소 → 다시 검토 중(submitted) */
export async function reopenSettlement(id: string): Promise<void> {
  const { data, error } = await (supabase as any).from("year_end_settlements").update({ status: "submitted", payroll: {}, result: {} }).eq("id", id).select("id");
  if (error) throw error;
  if (!data?.length) throw new Error("확정을 풀지 못했습니다(권한 확인)");
}

/** 그 해 발송된 급여 명세 합계 — 사람별 */
export async function payrollSummaries(companyId: string, year: number, employeeIds?: string[]): Promise<Map<string, PayrollSummary>> {
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
  let q = (supabase as any).from("payroll_items").select(WHT_SELECT).eq("company_id", companyId).in("period_month", months).limit(20000);
  if (employeeIds?.length) q = q.in("employee_id", employeeIds);
  const rows = toWhtRows(logRead("year-end:payroll", await q) as any[]).filter((r) => !r.biz);
  const out = new Map<string, PayrollSummary>();
  for (const r of rows) {
    const cur = out.get(r.employee_id) || { totalPay: 0, paidIncomeTax: 0, paidLocalTax: 0, pension: 0, healthLtc: 0, employment: 0, months: 0 };
    cur.totalPay += r.taxable; cur.paidIncomeTax += r.incomeTax; cur.paidLocalTax += r.localIncomeTax;
    cur.pension += r.pension; cur.healthLtc += r.health + r.ltc; cur.employment += r.employment; cur.months += 1;
    out.set(r.employee_id, cur);
  }
  return out;
}

export const settle = (p: PayrollSummary | undefined, d: Deductions) => computeYearEnd({
  totalPay: p?.totalPay || 0, paidIncomeTax: p?.paidIncomeTax || 0, paidLocalTax: p?.paidLocalTax || 0,
  pension: p?.pension || 0, healthLtc: p?.healthLtc || 0, employment: p?.employment || 0, ...d,
});

export const STATUS_LABEL: Record<YearEndStatus, string> = { draft: "작성 중", submitted: "제출됨", returned: "반려", confirmed: "확정" };
