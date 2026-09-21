// ── 재고 설정 — 수율·로스 경고 임계값 (결정 32, 2026-08-27 대표: "수율 임계값 설정할 수 있는 기능") ─────
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

// ── 채널 수수료·배송비 (2026-09-21, 랜딩 문구 대조 → "판매가에서 원가·수수료·배송비를 빼는 계산을 채널마다 자동으로") ──
//   company_settings.settings->inventory.channel_fees { [channel]: { fee_rate: 0.058, ship_per_order: 3000 } }
//   · fee_rate = 매출 × 비율(채널 판매수수료). ship_per_order = 주문 1건당 배송비(택배·포장). 둘 다 회사가 채널별로 정한다.
//   · 이익관리 › 거래처·채널별이 읽어 이익에서 뺀 '순이익'을 만든다. 채널 정산 내역이 아니라 **회사가 정한 비율의 추정**이다 — 화면에 그렇게 적는다.
//   · 값이 없는 채널은 0 으로 본다(종전과 같은 숫자). 정산 후 실제 수수료를 아는 회사는 비율을 고쳐 맞춘다.
export type ChannelFee = { fee_rate: number; ship_per_order: number };
export type ChannelFees = Record<string, ChannelFee>;

export async function loadChannelFees(companyId: string): Promise<ChannelFees> {
  const { data } = await supabase.from("company_settings").select("settings").eq("company_id", companyId).maybeSingle();
  const raw = ((data as any)?.settings?.inventory?.channel_fees ?? {}) as Record<string, Partial<ChannelFee>>;
  const out: ChannelFees = {};
  for (const [k, v] of Object.entries(raw)) {
    const rate = Number(v?.fee_rate ?? 0), ship = Number(v?.ship_per_order ?? 0);
    out[k] = { fee_rate: rate >= 0 && rate < 1 ? rate : 0, ship_per_order: ship >= 0 ? ship : 0 };
  }
  return out;
}

export async function saveChannelFees(companyId: string, fees: ChannelFees) {
  const { data } = await supabase.from("company_settings").select("id, settings").eq("company_id", companyId).maybeSingle();
  const prev = (((data as any)?.settings as Record<string, unknown>) || {});
  const settings = { ...prev, inventory: { ...((prev.inventory as Record<string, unknown>) || {}), channel_fees: fees } };
  if ((data as any)?.id) { const { error } = await supabase.from("company_settings").update({ settings } as never).eq("company_id", companyId); if (error) throw error; }
  else { const { error } = await supabase.from("company_settings").insert({ company_id: companyId, settings } as never); if (error) throw error; }
}
