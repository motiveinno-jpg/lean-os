// ── 일용 근무 기록(daily_work_logs) · 기타/이자/배당 지급 기록(income_payments) (2026-10-14 세무 2차 4단계, 결정 262) ──
//   지급일(paid_on)이 속한 달 원천세 신고서에 들어간다(A03 · A42/A40 · A50 · A60). 세액은 저장 때 lib/tax-forms/wht-income 으로 계산해 같이 남긴다 —
//   나중에 세율이 바뀌어도 그때 낸 숫자가 남게. 읽기·쓰기 권한은 RLS(일용 = 급여 권한, 지급 기록 = 세무 신고 권한).

import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";
import type { DailyLog, IncomePayment } from "@/lib/tax-forms/wht-income";

const monthRange = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return { from: `${month}-01`, to: `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}` };
};

export async function listDailyLogs(companyId: string, month: string): Promise<DailyLog[]> {
  const { from, to } = monthRange(month);
  const data = logRead("wht-income:daily", await (supabase as any).from("daily_work_logs")
    .select("id, employee_id, employee_name, work_date, paid_on, daily_wage, non_taxable, income_tax, local_tax, memo")
    .eq("company_id", companyId).gte("paid_on", from).lte("paid_on", to).order("work_date").limit(5000));
  return ((data || []) as any[]).map((r) => ({ ...r, daily_wage: Number(r.daily_wage), non_taxable: Number(r.non_taxable), income_tax: Number(r.income_tax), local_tax: Number(r.local_tax) }));
}

/** 같은 사람·같은 날은 하나 — 있으면 덮어쓴다(unique employee_id, work_date) */
export async function saveDailyLogs(companyId: string, rows: Omit<DailyLog, "id" | "employee_name">[]): Promise<number> {
  const { data, error } = await (supabase as any).from("daily_work_logs")
    .upsert(rows.map((r) => ({ ...r, company_id: companyId })), { onConflict: "employee_id,work_date" }).select("id");
  if (error) throw error;
  return (data || []).length;
}
export async function updateDailyLog(id: string, patch: Partial<DailyLog>): Promise<void> {
  const { data, error } = await (supabase as any).from("daily_work_logs").update(patch).eq("id", id).select("id");
  if (error) throw error;
  if (!data?.length) throw new Error("고칠 기록을 찾지 못했습니다(권한 또는 이미 지워짐)");
}
export async function deleteDailyLog(id: string): Promise<void> {
  const { data, error } = await (supabase as any).from("daily_work_logs").delete().eq("id", id).select("id");
  if (error) throw error;
  if (!data?.length) throw new Error("지울 기록을 찾지 못했습니다(권한 또는 이미 지워짐)");
}

export async function listIncomePayments(companyId: string, month: string): Promise<IncomePayment[]> {
  const { from, to } = monthRange(month);
  const data = logRead("wht-income:pays", await (supabase as any).from("income_payments")
    .select("id, payee_name, payee_kind, income_kind, sub_kind, paid_on, amount, necessary_expense, tax_rate, income_tax, local_tax, memo")
    .eq("company_id", companyId).gte("paid_on", from).lte("paid_on", to).order("paid_on").limit(5000));
  return ((data || []) as any[]).map((r) => ({ ...r, amount: Number(r.amount), necessary_expense: Number(r.necessary_expense), tax_rate: Number(r.tax_rate), income_tax: Number(r.income_tax), local_tax: Number(r.local_tax) }));
}
export async function saveIncomePayment(companyId: string, row: Omit<IncomePayment, "id"> & { id?: string }): Promise<void> {
  const { id, ...rest } = row;
  const q = id
    ? (supabase as any).from("income_payments").update(rest).eq("id", id).select("id")
    : (supabase as any).from("income_payments").insert({ ...rest, company_id: companyId }).select("id");
  const { data, error } = await q;
  if (error) throw error;
  if (!data?.length) throw new Error("저장하지 못했습니다(권한 확인)");
}
export async function deleteIncomePayment(id: string): Promise<void> {
  const { data, error } = await (supabase as any).from("income_payments").delete().eq("id", id).select("id");
  if (error) throw error;
  if (!data?.length) throw new Error("지울 기록을 찾지 못했습니다(권한 또는 이미 지워짐)");
}
