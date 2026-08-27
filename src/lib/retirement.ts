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
export type Settlement = { retirement: number; eligible: boolean; totalDays: number; dailyWage: number; source: string; leaveRemain: number; leavePay: number; ordinaryDaily: number; lastMonthPay: number; lastMonthDays: number; monthDays: number; total: number };
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
  return { retirement, eligible: (est?.total_days || 0) >= 365, totalDays: est?.total_days || 0, dailyWage: est?.daily_wage || 0, source: est?.source || "약정 월급", leaveRemain, leavePay, ordinaryDaily, lastMonthPay, lastMonthDays, monthDays, total: retirement + leavePay + lastMonthPay };
}
