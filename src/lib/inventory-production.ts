"use client";

// ── 재고 4단계 — 생산(자재구성 · 작업지시) (2026-08-25 사장님 지시) ────────────
//   ★ 결정 14 — 완성 한 번에 **두 문서**를 세운다: 자재 출고(MTL) + 완제품 입고(PRD).
//     둘 중 하나만 서면 그 순간 재고가 거짓말을 한다. 그래서 자재 문서가 실패하면 완제품도 되돌린다.
//   ★ 결정 15 — BOM 이 없으면 자재를 빼지 않는다. 없는 걸 지어내지 않는다.
//   ★ 결정 16 — 자재가 모자라도 막지 않는다(결정 7). 이미 만든 것을 못 적게 하면 장부를 포기한다.

import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";
import { todayKst } from "@/lib/kst";
import { createStockDoc, type MoveLine } from "@/lib/inventory";

export type BomLine = {
  id: string; product_id: string; component_id: string; qty: number; note: string | null;
};
export type WorkOrder = {
  id: string; wo_no: string; product_id: string; planned_qty: number;
  warehouse_id: string | null; order_date: string; due_date: string | null;
  status: "open" | "done" | "cancelled"; note: string | null; created_at: string;
};
export type WoDone = { work_order_id: string; product_id: string; planned_qty: number; done_qty: number };

// ── 자재구성 ──────────────────────────────────────────────────────────────────
export async function listBoms(companyId: string): Promise<BomLine[]> {
  if (!companyId) return [];
  const data = logRead("inventory:boms", await supabase
    .from("product_boms").select("id, product_id, component_id, qty, note")
    .eq("company_id", companyId).limit(5000));
  return ((data || []) as any[]).map((r) => ({ ...r, qty: Number(r.qty || 0) })) as BomLine[];
}

export async function upsertBomLine(companyId: string, line: { id?: string; product_id: string; component_id: string; qty: number; note?: string | null }) {
  if (line.product_id === line.component_id) throw new Error("자기 자신을 자재로 넣을 수 없습니다");
  if (!(Number(line.qty) > 0)) throw new Error("드는 양은 0보다 커야 합니다");
  const row = {
    company_id: companyId, product_id: line.product_id, component_id: line.component_id,
    qty: Number(line.qty), note: line.note?.trim() || null, updated_at: new Date().toISOString(),
  };
  const { error } = line.id
    ? await supabase.from("product_boms").update(row).eq("id", line.id)
    : await supabase.from("product_boms").upsert(row, { onConflict: "product_id,component_id" });
  if (error) throw error;
}

export async function deleteBomLine(id: string) {
  const { error } = await supabase.from("product_boms").delete().eq("id", id);
  if (error) throw error;
}

// ── 작업지시 ──────────────────────────────────────────────────────────────────
export async function listWorkOrders(companyId: string, from: string, to: string): Promise<WorkOrder[]> {
  if (!companyId) return [];
  const data = logRead("inventory:work-orders", await supabase
    .from("work_orders")
    .select("id, wo_no, product_id, planned_qty, warehouse_id, order_date, due_date, status, note, created_at")
    .eq("company_id", companyId).gte("order_date", from).lte("order_date", to)
    .order("order_date", { ascending: false }).order("created_at", { ascending: false })
    .limit(1000));
  return ((data || []) as any[]).map((r) => ({ ...r, planned_qty: Number(r.planned_qty || 0) })) as WorkOrder[];
}

export async function listWoDone(companyId: string, ids?: string[]): Promise<WoDone[]> {
  if (!companyId) return [];
  let qb = supabase.from("v_work_order_done")
    .select("work_order_id, product_id, planned_qty, done_qty").eq("company_id", companyId);
  if (ids && ids.length) qb = qb.in("work_order_id", ids);
  const data = logRead("inventory:wo-done", await qb);
  return ((data || []) as any[]).filter((r) => r.work_order_id).map((r) => ({
    work_order_id: r.work_order_id, product_id: r.product_id,
    planned_qty: Number(r.planned_qty || 0), done_qty: Number(r.done_qty || 0),
  }));
}

export async function createWorkOrder(
  companyId: string,
  input: { productId: string; plannedQty: number; warehouseId: string; orderDate?: string; dueDate?: string | null; note?: string | null },
  userId?: string | null,
) {
  const orderDate = input.orderDate || todayKst();
  if (!(Number(input.plannedQty) > 0)) throw new Error("만들 수량을 적으세요");

  const ymd = orderDate.replace(/-/g, "").slice(2);
  const { count } = await supabase.from("work_orders")
    .select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("order_date", orderDate);
  const woNo = `WO-${ymd}-${String((count || 0) + 1).padStart(2, "0")}`;

  const { data, error } = await supabase.from("work_orders").insert({
    company_id: companyId, wo_no: woNo, product_id: input.productId,
    planned_qty: Number(input.plannedQty), warehouse_id: input.warehouseId,
    order_date: orderDate, due_date: input.dueDate || null,
    status: "open", note: input.note?.trim() || null, created_by: userId ?? null,
  }).select("id").single();
  if (error) throw error;
  return { id: (data as { id: string }).id, woNo };
}

/**
 * 완성한다 — **두 문서를 같이 세운다**(결정 14).
 *   ① 자재 출고(MTL): BOM × 완성수량. BOM 이 없으면 이 문서는 서지 않는다(결정 15).
 *   ② 완제품 입고(PRD): 완성수량.
 *   자재 문서가 실패하면 완제품 문서도 지운다 — 반쪽만 남으면 재고가 거짓말을 한다.
 *   완성수량에 음수를 넣으면 되돌린다(자재가 돌아오고 완제품이 빠진다).
 */
export async function completeWorkOrder(
  companyId: string, wo: WorkOrder, qty: number,
  bomLines: BomLine[],
  opts?: { docDate?: string; note?: string | null; unitCost?: number | null; saveCost?: boolean },
  userId?: string | null,
) {
  const n = Number(qty);
  if (!n || Number.isNaN(n)) throw new Error("완성 수량을 적으세요");
  if (!wo.warehouse_id) throw new Error("창고가 없는 지시입니다");
  const docDate = opts?.docDate || todayKst();

  //   ① 완제품 먼저 — 이게 이 지시의 결과다.
  //     단가는 **들어간 자재 값**이다 — 새로 생긴 물건의 값은 그것말고 재줄 것이 없다.
  const prod = await createStockDoc(companyId, {
    reason: "produce", docDate, warehouseId: wo.warehouse_id, workOrderId: wo.id,
    note: opts?.note ?? null,
    lines: [{ product_id: wo.product_id, qty: n, unit_price: opts?.unitCost ?? null }],
  }, userId);

  //   ② 자재 — BOM 이 있을 때만. 완제품이 음수(되돌림)면 자재도 반대로 돌아온다.
  const mats: MoveLine[] = bomLines
    .filter((b) => b.product_id === wo.product_id && b.qty > 0)
    .map((b) => ({ product_id: b.component_id, qty: b.qty * n, note: `${wo.wo_no} 자재` }));

  let matDocNo: string | null = null;
  if (mats.length) {
    try {
      const mat = await createStockDoc(companyId, {
        reason: "consume", docDate, warehouseId: wo.warehouse_id, workOrderId: wo.id,
        note: `${wo.wo_no} 자재 투입`, lines: mats,
      }, userId);
      matDocNo = mat.docNo;
    } catch (e) {
      //   반쪽만 남기지 않는다 — 완제품 문서를 되돌리고 그대로 알린다.
      await supabase.from("stock_moves").delete().eq("doc_id", prod.id);
      await supabase.from("stock_docs").delete().eq("id", prod.id);
      throw e;
    }
  }

  //   품목 원가는 **사람이 켜 둔 때만** 적는다(제안은 자동, 확정은 사람).
  //     안 그러면 만들 때마다 원가가 조용히 바뀌어 "왜 이 숫자가 됐는지"를 다시 설명할 수 없다.
  if (opts?.saveCost && opts.unitCost != null && opts.unitCost > 0) {
    await supabase.from("products")
      .update({ cost_price: opts.unitCost, updated_at: new Date().toISOString() })
      .eq("id", wo.product_id).is("cost_price", null);
  }

  await syncWoStatus(companyId, wo.id);
  return { prodDocNo: prod.docNo, matDocNo, materials: mats.length };
}

export async function syncWoStatus(companyId: string, woId: string) {
  const rows = await listWoDone(companyId, [woId]);
  const r = rows[0];
  if (!r) return;
  const { data: cur } = await supabase.from("work_orders").select("status").eq("id", woId).single();
  const now = (cur as { status: string } | null)?.status;
  if (now === "cancelled") return;
  const next = r.done_qty >= r.planned_qty ? "done" : "open";
  if (now !== next) {
    await supabase.from("work_orders")
      .update({ status: next, updated_at: new Date().toISOString() }).eq("id", woId);
  }
}

export async function cancelWorkOrder(companyId: string, woId: string) {
  const rows = await listWoDone(companyId, [woId]);
  if ((rows[0]?.done_qty ?? 0) !== 0) throw new Error("이미 만든 것이 있는 지시입니다 — 되돌린 뒤에 취소하세요");
  const { error } = await supabase.from("work_orders")
    .update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", woId);
  if (error) throw error;
}

export async function reopenWorkOrder(woId: string) {
  const { error } = await supabase.from("work_orders")
    .update({ status: "open", updated_at: new Date().toISOString() })
    .eq("id", woId).eq("status", "cancelled");
  if (error) throw error;
}


// ── 격자에서 바로 완성 기록 (2026-08-25 사장님 지시) ──────────────────────────
//   작업지시를 따로 두지 않는다 — **주문서가 그 자리**다. 격자에 완제품 줄을 치고 저장하면
//   ★ 완제품 입고(PRD) + 자재 출고(MTL) **두 문서가 같이** 선다(결정 14).
//     자재 문서가 실패하면 완제품도 지운다 — 반쪽만 남으면 재고가 거짓말을 한다.
export async function produceLines(
  companyId: string,
  input: {
    docDate?: string; warehouseId: string; note?: string | null; orderId?: string | null;
    lines: { product_id: string; qty: number; unit_price?: number | null; vat_amount?: number | null;
             note?: string | null; order_line_id?: string | null }[];
  },
  bomLines: BomLine[],
  userId?: string | null,
) {
  const use = input.lines.filter((l) => l.product_id && Number(l.qty) !== 0);
  if (!use.length) throw new Error("완성 수량이 입력되지 않았습니다");
  const docDate = input.docDate || todayKst();

  //   ① 완제품 — 이게 결과다
  const prod = await createStockDoc(companyId, {
    reason: "produce", docDate, warehouseId: input.warehouseId,
    orderId: input.orderId || null, note: input.note ?? null,
    lines: use.map((l) => ({
      product_id: l.product_id, qty: Number(l.qty),
      unit_price: l.unit_price ?? null, vat_amount: l.vat_amount ?? null,
      note: l.note ?? null, order_line_id: l.order_line_id ?? null,
    })),
  }, userId);

  //   ② 자재 — 자재구성이 있는 줄만. 완제품이 음수(되돌림)면 자재도 반대로 돌아온다.
  const mats: MoveLine[] = [];
  for (const l of use) {
    for (const b of bomLines) {
      if (b.product_id !== l.product_id || !(b.qty > 0)) continue;
      mats.push({ product_id: b.component_id, qty: b.qty * Number(l.qty), note: "자재 투입" });
    }
  }

  let matDocNo: string | null = null;
  if (mats.length) {
    try {
      const mat = await createStockDoc(companyId, {
        reason: "consume", docDate, warehouseId: input.warehouseId,
        orderId: input.orderId || null, note: `${prod.docNo} 자재 투입`, lines: mats,
      }, userId);
      matDocNo = mat.docNo;
    } catch (e) {
      await supabase.from("stock_moves").delete().eq("doc_id", prod.id);
      await supabase.from("stock_docs").delete().eq("id", prod.id);
      throw e;
    }
  }
  return { prodDocNo: prod.docNo, matDocNo, materials: mats.length };
}
