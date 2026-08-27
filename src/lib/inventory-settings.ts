// ── 재고 설정 — 수율·로스 경고 임계값 (결정 32, 2026-08-27 사장님: "수율 임계값 설정할 수 있는 기능") ─────
//   company_settings.settings->inventory { yield_warn: 0.95, loss_warn: 0.05 } — 회사가 정한다. 없으면 기본값.
//   재고 › 현황 › 생산현황의 붉은 표시와 AI 브리핑 알림이 같은 값을 읽는다(엣지 함수도 같은 키).

import { supabase } from "@/lib/supabase";

export type InventorySettings = { yield_warn: number; loss_warn: number };
export const INVENTORY_DEFAULTS: InventorySettings = { yield_warn: 0.95, loss_warn: 0.05 };

export async function loadInventorySettings(companyId: string): Promise<InventorySettings> {
  const { data } = await supabase.from("company_settings").select("settings").eq("company_id", companyId).maybeSingle();
  const raw = ((data as any)?.settings?.inventory || {}) as Partial<InventorySettings>;
  const y = Number(raw.yield_warn), l = Number(raw.loss_warn);
  return { yield_warn: y > 0 && y <= 1 ? y : INVENTORY_DEFAULTS.yield_warn, loss_warn: l >= 0 && l < 1 ? l : INVENTORY_DEFAULTS.loss_warn };
}
export async function saveInventorySettings(companyId: string, s: InventorySettings) {
  const { data } = await supabase.from("company_settings").select("id, settings").eq("company_id", companyId).maybeSingle();
  const prev = ((data as any)?.settings as Record<string, unknown>) || {};
  const settings = { ...prev, inventory: { ...((prev.inventory as Record<string, unknown>) || {}), ...s } };
  if ((data as any)?.id) { const { error } = await supabase.from("company_settings").update({ settings } as never).eq("company_id", companyId); if (error) throw error; }
  else { const { error } = await supabase.from("company_settings").insert({ company_id: companyId, settings } as never); if (error) throw error; }
}
