// ── 재고 규칙형 자동화 — 제안 계산 (2026-08-27, docs/20260827_PLAN_inventory_rule_automation.md A1·A2·A10, 결정 88~92) ──
//   토큰(LLM) 없음. 이력·장부 대조만. 출처 라벨은 화면이 '규칙'/'장부 대조'로 적는다.
//   · 30일 평균 일 출고(판매·소비) → '곧 부족'(현재고 ÷ 일 출고 < 리드타임)
//   · 마지막 매입(거래처·단가·일자) → 발주 제안에 거래처·단가를 미리 채운다
//   · 90일 무출고 품목 · 불량 보류 30일 초과 → 월말 정리 목록

import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";
import { todayKst } from "@/lib/kst";

const daysAgo = (n: number) => { const d = new Date(todayKst()); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };

export type OutflowStat = { qty30: number; perDay: number; lastOutAt: string | null };
/** 품목별 최근 30일 출고(판매·소비, 음수 move) 합과 하루 평균, 마지막 출고일(90일 안) */
export async function fetchOutflowStats(companyId: string): Promise<Map<string, OutflowStat>> {
  const since90 = daysAgo(90), since30 = daysAgo(30);
  const data = logRead("inv-suggest:outflow", await (supabase as any).from("stock_moves")
    .select("product_id, qty, moved_at, stock_docs!inner(reason, status)")
    .eq("company_id", companyId).lt("qty", 0).gte("moved_at", since90)
    .in("stock_docs.reason", ["sale", "consume"]).eq("stock_docs.status", "active").limit(20000));
  const m = new Map<string, OutflowStat>();
  for (const r of ((data || []) as any[])) {
    const cur = m.get(r.product_id) || { qty30: 0, perDay: 0, lastOutAt: null };
    const d = String(r.moved_at).slice(0, 10);
    if (d >= since30) cur.qty30 += Math.abs(Number(r.qty || 0));
    if (!cur.lastOutAt || d > cur.lastOutAt) cur.lastOutAt = d;
    m.set(r.product_id, cur);
  }
  for (const v of m.values()) v.perDay = v.qty30 / 30;
  return m;
}

export type LastBuy = { partner_id: string | null; unit_price: number | null; doc_date: string };
/** 품목별 마지막 매입 — 거래처·단가·일자 (활성 매입 문서, 최근 것) */
export async function fetchLastPurchase(companyId: string): Promise<Map<string, LastBuy>> {
  const data = logRead("inv-suggest:lastbuy", await (supabase as any).from("stock_moves")
    .select("product_id, unit_price, moved_at, stock_docs!inner(partner_id, doc_date, reason, status)")
    .eq("company_id", companyId).gt("qty", 0).eq("stock_docs.reason", "purchase").eq("stock_docs.status", "active")
    .order("moved_at", { ascending: false }).limit(5000));
  const m = new Map<string, LastBuy>();
  for (const r of ((data || []) as any[])) {
    if (m.has(r.product_id)) continue;
    m.set(r.product_id, { partner_id: r.stock_docs?.partner_id || null, unit_price: r.unit_price == null ? null : Number(r.unit_price), doc_date: String(r.stock_docs?.doc_date || r.moved_at).slice(0, 10) });
  }
  return m;
}

/** '곧 부족' 판단 — 현재고 ÷ 일 출고 < 리드타임. 이력 없으면(30일 출고 0) 판단하지 않는다(결정 90). */
export function soonShort(have: number, stat: OutflowStat | undefined, leadDays: number): { days: number; need: number } | null {
  if (!stat || stat.perDay <= 0) return null;
  const days = have / stat.perDay;
  if (days >= leadDays) return null;
  //   제안 수량 = 리드타임 + 7일치 소진량 − 현재고 (최소 1)
  const need = Math.max(1, Math.ceil(stat.perDay * (leadDays + 7) - have));
  return { days: Math.max(0, Math.floor(days)), need };
}

/** 불량 보류 창고에 30일 넘게 있는 품목 — 마지막 입고일 기준 */
export async function fetchDefectAging(companyId: string, defectWarehouseId: string, minDays = 30): Promise<{ product_id: string; qty: number; since: string; days: number }[]> {
  const data = logRead("inv-suggest:defect", await (supabase as any).from("stock_moves")
    .select("product_id, qty, moved_at").eq("company_id", companyId).eq("warehouse_id", defectWarehouseId).limit(20000));
  const qty = new Map<string, number>(); const lastIn = new Map<string, string>();
  for (const r of ((data || []) as any[])) {
    qty.set(r.product_id, (qty.get(r.product_id) || 0) + Number(r.qty || 0));
    if (Number(r.qty) > 0) { const d = String(r.moved_at).slice(0, 10); if (!lastIn.has(r.product_id) || d > lastIn.get(r.product_id)!) lastIn.set(r.product_id, d); }
  }
  const today = new Date(todayKst()).getTime();
  const out: { product_id: string; qty: number; since: string; days: number }[] = [];
  for (const [pid, q] of qty) {
    if (q <= 0) continue;
    const since = lastIn.get(pid) || todayKst();
    const days = Math.floor((today - new Date(since).getTime()) / 86400000);
    if (days >= minDays) out.push({ product_id: pid, qty: q, since, days });
  }
  return out.sort((a, b) => b.days - a.days);
}
