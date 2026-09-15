//   상실사유 — 회사별 목록. 예전엔 코드 한 벌(DEFAULT)을 전 회사가 똑같이 썼다(하드코딩).
//   회사마다 문구·표시여부·추가 항목이 다를 수 있어 company_settings.settings.loss_reasons 에 저장한다.
//   저장이 없으면 표준(DEFAULT_LOSS_REASONS)을 그대로 쓴다 — 4대보험 요율(insurance-rates)과 같은 '법정 기본값' 방식.
//   ⚠️ code 는 고용보험 상실신고에 그대로 들어가는 값이다. 표준 코드는 되도록 유지한다.

import { supabase } from "@/lib/supabase";
import { DEFAULT_LOSS_REASONS, type LossReason } from "@/lib/insurance-edi";

export { DEFAULT_LOSS_REASONS };
export type { LossReason };

export type CompanyLossReasons = { reasons: LossReason[]; isDefault: boolean };

/** 회사 상실사유 목록. 저장이 없으면 표준 전체(모두 사용)로 돌려준다. */
export async function fetchLossReasons(companyId: string): Promise<CompanyLossReasons> {
  const { data } = await supabase.from("company_settings").select("settings").eq("company_id", companyId).maybeSingle();
  const v = (data?.settings as { loss_reasons?: unknown } | null)?.loss_reasons;
  if (Array.isArray(v) && v.length > 0) {
    const reasons = (v as Record<string, unknown>[]).map((r) => ({
      code: String(r.code ?? "").trim(),
      label: String(r.label ?? "").trim(),
      group: String(r.group ?? "기타").trim() || "기타",
      enabled: r.enabled !== false,
    }));
    return { reasons, isDefault: false };
  }
  return { reasons: DEFAULT_LOSS_REASONS.map((r) => ({ ...r, enabled: true })), isDefault: true };
}

/** 회사 상실사유 목록 저장(다른 설정은 건드리지 않는다). */
export async function saveLossReasons(companyId: string, reasons: LossReason[]): Promise<void> {
  const { data: existing } = await supabase.from("company_settings").select("settings").eq("company_id", companyId).maybeSingle();
  const nextSettings = {
    ...((existing?.settings as Record<string, unknown> | null) || {}),
    loss_reasons: reasons.map((r) => ({ code: r.code, label: r.label, group: r.group, enabled: r.enabled !== false })),
  };
  const { error } = await supabase.from("company_settings").upsert({ company_id: companyId, settings: nextSettings }, { onConflict: "company_id" });
  if (error) throw error;
}

/** 표준으로 되돌리기 = 저장된 loss_reasons 를 지운다(다시 DEFAULT 사용). */
export async function resetLossReasons(companyId: string): Promise<void> {
  const { data: existing } = await supabase.from("company_settings").select("settings").eq("company_id", companyId).maybeSingle();
  const s = { ...((existing?.settings as Record<string, unknown> | null) || {}) };
  delete (s as Record<string, unknown>).loss_reasons;
  const { error } = await supabase.from("company_settings").upsert({ company_id: companyId, settings: s as never }, { onConflict: "company_id" });
  if (error) throw error;
}

/** 퇴사 처리 창이 고르게 보여 줄 것 — 켜진 것만, 코드 있는 것만. */
export const enabledLossReasons = (list: LossReason[]) =>
  list.filter((r) => r.enabled !== false && r.code);

/** 코드로 라벨 찾기(기록·표시용). */
export const lossReasonLabel = (list: LossReason[], code: string) =>
  list.find((r) => r.code === code)?.label || "";
