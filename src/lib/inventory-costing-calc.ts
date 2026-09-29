// ── 재고 원가 순수 계산 — 현황·이익관리·창고관리·품목이 같은 원가를 쓰게 ─────────────────
//   원가 계산 자체는 DB(rebuild_stock_costs)가 회사 원가 방법(선입선출/이동평균)으로 한 번 한다.
//   화면은 그 결과(입고 층·출고 원가)만 읽어 아래 함수로 푼다. 품목 매입가·매입 평균으로 따로 셈하지 않는다.
//   · 재고 단가 = 남은 입고 층의 Σ(남은 수량×단가) ÷ Σ남은 수량. 선입선출이면 아직 안 나간 입고분의 단가다.
//   · 출고 원가 = stock_move_costs 의 확정 원가. 되돌아온 줄(반품·취소 입고)은 그 층 단가로 원가를 뺀다.
//   · 층이 없어 못 정한 출고는 '미확정' 수량으로 따로 센다(0 원으로 잡지 않는다).

export type LayerLite = { product_id: string; move_id: string; qty_left: number; unit_cost: number | null };
export type MoveCostLite = { move_id: string; cost_amount: number; qty_uncosted: number };

/** 품목별 재고 단가 — 남은 층 기준. 남은 층이 없는 품목은 빠진다(부르는 쪽이 대체값을 정한다). */
export function unitCostFromLayers(layers: LayerLite[]): Map<string, number> {
  const sum = new Map<string, { qty: number; value: number }>();
  for (const l of layers) {
    if (!(l.qty_left > 0) || l.unit_cost == null) continue;
    const s = sum.get(l.product_id) || { qty: 0, value: 0 };
    s.qty += l.qty_left; s.value += l.qty_left * l.unit_cost;
    sum.set(l.product_id, s);
  }
  const out = new Map<string, number>();
  for (const [pid, s] of sum) if (s.qty > 0) out.set(pid, s.value / s.qty);
  return out;
}

/** 재고 단가 표 합치기 — 층 단가가 먼저, 없으면(다 팔려 층이 비었거나 아직 계산 전) 대체 단가 */
export function mergeUnitCost(fromLayers: Map<string, number>, fallback: Map<string, number>): Map<string, number> {
  const out = new Map(fallback);
  for (const [pid, c] of fromLayers) out.set(pid, c);
  return out;
}

/**
 * 한 줄의 원가 — 나간 줄(qty<0)은 확정 출고 원가, 되돌아온 줄(qty>0)은 그 층 단가만큼 음수.
 * 값은 '나간 쪽이 +' 로 맞춘다(판매 원가에 그대로 더하면 반품이 빠진다).
 */
export function costOfMove(
  m: { id: string; qty: number },
  costByMove: Map<string, MoveCostLite>,
  layerByMove: Map<string, LayerLite & { unit_cost: number | null }>,
): { cost: number; unc: number } {
  if (m.qty < 0) {
    const c = costByMove.get(m.id);
    return c ? { cost: c.cost_amount, unc: c.qty_uncosted } : { cost: 0, unc: -m.qty };
  }
  const l = layerByMove.get(m.id);
  return l && l.unit_cost != null ? { cost: -m.qty * l.unit_cost, unc: 0 } : { cost: 0, unc: m.qty };
}

export const costingMethodLabel = (m: string | null | undefined) => (m === "avg" ? "이동평균" : "선입선출");
