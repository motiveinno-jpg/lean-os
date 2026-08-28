// ── 재고 원가 — 입고 층·출고 원가 읽기 (결정 36·42, 2026-08-26) ─────────────────────
//   계산은 DB(rebuild_stock_costs) 한 곳에서만 한다. 화면은 읽고, 필요하면 '다시 계산'만 부른다.
//   · stock_cost_layers: 입고 층(품목·일자·들어온 수량·남은 수량·단가·원천)
//   · stock_move_costs: 출고 줄의 확정 원가(원가·확정 수량·미확정 수량·어느 층에서 얼마)
//   · stock_cost_state: 마지막 계산 시각·방법·미확정 출고 수

import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";
import { fetchPaged } from "@/lib/fetch-paged";

export type CostLayer = { id: string; product_id: string; move_id: string; layer_date: string; seq: number; qty_in: number; qty_left: number; unit_cost: number | null; source: string };
export type MoveCost = { move_id: string; product_id: string; moved_at: string; reason: string; qty: number; cost_amount: number; qty_costed: number; qty_uncosted: number; unit_cost: number | null; method: string; layers: { layer_id: string; date: string; source: string; qty: number; unit_cost: number }[] };
export type CostState = { method: string; computed_at: string; layers: number; costs: number; uncosted_moves: number };
export type CostingMethod = "fifo" | "avg";
export const COSTING_METHODS: { value: CostingMethod; label: string; desc: string }[] = [
  { value: "fifo", label: "선입선출(FIFO)", desc: "먼저 들어온 것부터 나간다 — 어느 입고분이 나갔는지 눈으로 확인할 수 있다 (기본)" },
  { value: "avg", label: "이동평균", desc: "출고 시점까지 남은 층의 가중평균 단가로 나간다" },
];

const db = supabase as any;

export async function listMoveCosts(companyId: string, from: string, to: string): Promise<MoveCost[]> {
  const data = await fetchPaged<any>("inventory-cost:moves", () => db.from("stock_move_costs")
    .select("move_id, product_id, moved_at, reason, qty, cost_amount, qty_costed, qty_uncosted, unit_cost, method, layers")
    .eq("company_id", companyId).gte("moved_at", from).lte("moved_at", to).order("move_id"), 50000);
  return ((data || []) as any[]).map((r) => ({ ...r, qty: Number(r.qty), cost_amount: Number(r.cost_amount), qty_costed: Number(r.qty_costed), qty_uncosted: Number(r.qty_uncosted), unit_cost: r.unit_cost == null ? null : Number(r.unit_cost) })) as MoveCost[];
}
export async function listLayers(companyId: string, productId?: string | null): Promise<CostLayer[]> {
  const build = () => {
    let q = db.from("stock_cost_layers").select("id, product_id, move_id, layer_date, seq, qty_in, qty_left, unit_cost, source").eq("company_id", companyId).order("layer_date").order("seq").order("id");
    if (productId) q = q.eq("product_id", productId);
    return q;
  };
  const data = await fetchPaged<any>("inventory-cost:layers", build, 50000);
  return ((data || []) as any[]).map((r) => ({ ...r, qty_in: Number(r.qty_in), qty_left: Number(r.qty_left), unit_cost: r.unit_cost == null ? null : Number(r.unit_cost) })) as CostLayer[];
}
export async function getCostState(companyId: string): Promise<CostState | null> {
  const { data } = await db.from("stock_cost_state").select("method, computed_at, layers, costs, uncosted_moves").eq("company_id", companyId).maybeSingle();
  return (data as CostState | null) ?? null;
}
/** 다시 계산 — 회사 전체를 일자순으로. 문서 저장 때는 트리거가 알아서 돈다. */
export async function rebuildMyCosts(): Promise<{ layers: number; costs: number; method: string }> {
  const { data, error } = await db.rpc("rebuild_my_stock_costs");
  if (error) throw error;
  return data as { layers: number; costs: number; method: string };
}
export async function loadCostingMethod(companyId: string): Promise<CostingMethod> {
  const { data } = await supabase.from("company_settings").select("settings").eq("company_id", companyId).maybeSingle();
  const m = ((data as any)?.settings?.costing?.method || "fifo") as CostingMethod;
  return m === "avg" ? "avg" : "fifo";
}
export async function saveCostingMethod(companyId: string, method: CostingMethod) {
  const { data } = await supabase.from("company_settings").select("id, settings").eq("company_id", companyId).maybeSingle();
  const prev = ((data as any)?.settings as Record<string, unknown>) || {};
  const settings = { ...prev, costing: { ...((prev.costing as Record<string, unknown>) || {}), method, since: new Date().toISOString().slice(0, 10) } };
  if ((data as any)?.id) { const { error } = await supabase.from("company_settings").update({ settings } as never).eq("company_id", companyId); if (error) throw error; }
  else { const { error } = await supabase.from("company_settings").insert({ company_id: companyId, settings } as never); if (error) throw error; }
}

// ── 원가 재평가 (결정 39) — 특정 시점부터 남은 층의 단가를 바꾼다. 기초 원가 입력도 같은 표(옛 단가 없으면 차액 0). ──
export type Revaluation = { id: string; product_id: string; reval_date: string; unit_cost: number; reason: string; note: string | null; status: "active" | "cancelled"; effect_amount: number; effect_qty: number; created_at: string };
export const REVAL_REASONS: { value: string; label: string; desc: string }[] = [
  { value: "opening", label: "기초 원가 입력", desc: "단가 없는 층에 원가를 넣는다 — 평가손익 없음" },
  { value: "reval_market", label: "재평가 · 시세 하락", desc: "남은 재고를 시세로 낮춰 본다 — 차액은 평가손실" },
  { value: "reval_adjust", label: "재평가 · 원가 조정", desc: "잘못 들어간 단가를 이 날부터 바로잡는다" },
  { value: "other", label: "기타", desc: "사유는 비고에" },
];
export const revalReasonLabel = (v: string) => REVAL_REASONS.find((r) => r.value === v)?.label ?? v;
export async function listRevaluations(companyId: string): Promise<Revaluation[]> {
  const data = logRead("inventory-cost:revals", await db.from("stock_cost_revaluations")
    .select("id, product_id, reval_date, unit_cost, reason, note, status, effect_amount, effect_qty, created_at").eq("company_id", companyId).order("reval_date", { ascending: false }).limit(500));
  return ((data || []) as any[]).map((r) => ({ ...r, unit_cost: Number(r.unit_cost), effect_amount: Number(r.effect_amount || 0), effect_qty: Number(r.effect_qty || 0) })) as Revaluation[];
}
export async function addRevaluation(input: { product_id: string; reval_date: string; unit_cost: number; reason: string; note?: string | null }): Promise<string> {
  const { data, error } = await db.rpc("add_cost_revaluation", { p_product: input.product_id, p_date: input.reval_date, p_unit_cost: input.unit_cost, p_reason: input.reason, p_note: input.note ?? null });
  if (error) throw error;
  return data as string;
}
export async function cancelRevaluation(id: string) {
  const { error } = await db.rpc("cancel_cost_revaluation", { p_id: id });
  if (error) throw error;
}
