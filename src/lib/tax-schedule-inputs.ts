// ── 부속서류 입력값(tax_schedule_inputs) — 마감 전에도 남는 사람 입력 (2026-10-12 세무 2차 3단계) ──
//   기수(period_key = '2026-2p')·서류마다 jsonb 문서 하나. 마감하면 신고본 schedules 에 같이 복사된다(신고본이 원본, 이건 작업본).
//   쓰기 권한 = RLS(같은 회사 + /finance/tax-filing).

import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";

export type ScheduleInputDoc = "lease" | "deemed" | "baddebt" | "refund_claim";

export async function getScheduleInputs(companyId: string, periodKey: string): Promise<Partial<Record<ScheduleInputDoc, any>>> {
  const data = logRead("tax-schedule-inputs:get", await (supabase as any).from("tax_schedule_inputs")
    .select("doc, data").eq("company_id", companyId).eq("period_key", periodKey));
  const out: Partial<Record<ScheduleInputDoc, any>> = {};
  for (const r of (data || []) as { doc: ScheduleInputDoc; data: any }[]) out[r.doc] = r.data;
  return out;
}

export async function saveScheduleInput(companyId: string, periodKey: string, doc: ScheduleInputDoc, data: unknown): Promise<void> {
  const { error } = await (supabase as any).from("tax_schedule_inputs")
    .upsert({ company_id: companyId, period_key: periodKey, doc, data }, { onConflict: "company_id,doc,period_key" });
  if (error) throw error;
}
