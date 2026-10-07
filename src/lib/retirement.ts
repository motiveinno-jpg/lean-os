//   퇴직금 추계·정산 (2026-08-27 인사 4차 G1·H3·H7, 결정 97). 계산은 DB estimate_retirement 한 곳.
import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";

export type RetirementEstimate = { employee_id: string; name: string; hire_date: string; total_days: number; gross3m: number; days3m: number; daily_wage: number; estimate: number; source: string; manual: number };

export async function fetchRetirementEstimates(companyId: string, asof: string, employeeId?: string): Promise<RetirementEstimate[]> {
  const data = logRead("lib/retirement:estimate", await (supabase as any).rpc("estimate_retirement", { p_company: companyId, p_asof: asof, p_employee: employeeId || null }));
  return ((data || []) as any[]).map((r) => ({ ...r, total_days: Number(r.total_days), gross3m: Number(r.gross3m), days3m: Number(r.days3m), daily_wage: Number(r.daily_wage), estimate: Number(r.estimate), manual: Number(r.manual || 0) }));
}
export async function makeRetirementVoucherDraft(companyId: string, asof: string): Promise<string | null> {
  const { data, error } = await (supabase as any).rpc("make_retirement_voucher_draft", { p_company: companyId, p_asof: asof });
  if (error) throw error;
  return (data as string | null) || null;
}

/** 퇴사 정산 초안 — 퇴직금 + 미사용 연차 수당 + 마지막 달 일할 (H7). 확정은 사람. */
export type Settlement = { retirement: number; eligible: boolean; totalDays: number; hireDate: string | null; dailyWage: number; source: string; leaveRemain: number; leavePay: number; ordinaryDaily: number; lastMonthPay: number; lastMonthDays: number; monthDays: number; total: number };
export async function buildSettlement(companyId: string, employeeId: string, monthlySalary: number, endDate: string): Promise<Settlement> {
  const [est] = await fetchRetirementEstimates(companyId, endDate, employeeId);
  const year = Number(endDate.slice(0, 4));
  const bal = logRead("lib/retirement:leave", await (supabase as any).from("leave_balances").select("total_days, used_days").eq("employee_id", employeeId).eq("year", year).maybeSingle());
  const leaveRemain = Math.max(0, Number(bal?.total_days || 0) - Number(bal?.used_days || 0));
  //   통상임금 일급 = 월급 ÷ 209h × 8h (주 40시간 기준). 회사 기준시간이 다르면 근무 기준의 월 소정근로시간을 쓴다
  const stdHours = 209;
  const ordinaryDaily = Math.round((monthlySalary / stdHours) * 8);
  const leavePay = Math.round(leaveRemain * ordinaryDaily);
  const d = new Date(endDate); const monthDays = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); const lastMonthDays = d.getDate();
  const lastMonthPay = Math.round((monthlySalary * lastMonthDays) / monthDays);
  const retirement = est?.estimate || 0;
  return { retirement, eligible: (est?.total_days || 0) >= 365, totalDays: est?.total_days || 0, hireDate: est?.hire_date || null, dailyWage: est?.daily_wage || 0, source: est?.source || "약정 월급", leaveRemain, leavePay, ordinaryDaily, lastMonthPay, lastMonthDays, monthDays, total: retirement + leavePay + lastMonthPay };
}

/** 퇴직금 지급 기록 (2026-10-07 ERP 3차 A) — 원천세 신고서 A22·A20 의 원천. 세액은 저장 시점 계산값을 그대로 쓴다 */
export type RetirementPayment = {
  id: string; employee_id: string | null; employee_name: string; paid_on: string;
  service_start: string; service_end: string; service_years: number;
  retirement_pay: number; income_tax: number; local_tax: number; irp_deferred: boolean; note: string | null;
};
export type RetirementPaymentInput = Omit<RetirementPayment, "id" | "employee_name">;
const RP_SELECT = "id, employee_id, employee_name, paid_on, service_start, service_end, service_years, retirement_pay, income_tax, local_tax, irp_deferred, note";
const toRp = (r: any): RetirementPayment => ({ ...r, retirement_pay: Number(r.retirement_pay), income_tax: Number(r.income_tax), local_tax: Number(r.local_tax), service_years: Number(r.service_years) });

/** 지급일 기준 [from, to] (YYYY-MM-DD) */
export async function listRetirementPayments(companyId: string, from: string, to: string): Promise<RetirementPayment[]> {
  const data = logRead("lib/retirement:payments", await (supabase as any).from("retirement_payments").select(RP_SELECT)
    .eq("company_id", companyId).gte("paid_on", from).lte("paid_on", to).order("paid_on").order("employee_name"));
  return ((data || []) as any[]).map(toRp);
}
export async function saveRetirementPayment(companyId: string, input: RetirementPaymentInput, id?: string): Promise<void> {
  const row = { ...input, note: input.note?.trim() || null };
  const q = id
    ? (supabase as any).from("retirement_payments").update(row).eq("id", id).eq("company_id", companyId).select("id")
    : (supabase as any).from("retirement_payments").insert({ ...row, company_id: companyId }).select("id");
  const { data, error } = await q;
  if (error) throw error;
  //   막힌 UPDATE 는 오류 없이 0행 — 저장된 것처럼 보이지 않게
  if (!data?.length) throw new Error("저장 권한이 없거나 이미 지워진 기록입니다");
}
export async function deleteRetirementPayment(companyId: string, id: string): Promise<void> {
  const { data, error } = await (supabase as any).from("retirement_payments").delete().eq("id", id).eq("company_id", companyId).select("id");
  if (error) throw error;
  if (!data?.length) throw new Error("지울 권한이 없거나 이미 지워진 기록입니다");
}
