"use client";

// ── 재고 3단계 — 구매(발주 · 입고) (2026-08-25 사장님 지시) ────────────────────
//   판매의 거울상이지만 **두 가지가 다르다.**
//     ① 판매는 팔 수 있는 양을 빼고, 구매는 들어올 것을 더한다.
//        들어올 것은 아직 창고에 없으므로 **판매가능수량에 넣지 않는다** — 넣으면 없는 걸 판다.
//        보여 주는 이유는 하나, **또 시키는 것을 막기 위해서**다.
//     ② 그래서 '부족한 품목 채우기'가 여기에만 있다. 모자란 양 = 안전재고 − 현재고 − 들어올 것.
//   ★ 결정 5 그대로 — 발주 없이도 입고가 선다(시장에서 사 온 것은 발주서가 없다).
//   ★ 결정 12 그대로 — 받은 수량은 발주에 적지 않고 움직임의 합으로 읽는다.
//   ★ 결정 13 그대로 — 받은 것이 있으면 발주 취소를 막는다.

import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";
import { todayKst } from "@/lib/kst";
import { createStockDoc } from "@/lib/inventory";

export type PurchaseOrder = {
  id: string; po_no: string; order_date: string; due_date: string | null;
  partner_id: string | null; partner_name: string | null; warehouse_id: string | null;
  status: "open" | "done" | "cancelled"; note: string | null; created_at: string;
};
export type PurchaseOrderLine = {
  id: string; order_id: string; product_id: string; qty: number; unit_price: number | null; note: string | null;
};
export type ReceivedRow = {
  order_id: string; po_line_id: string; product_id: string; ordered_qty: number; received_qty: number;
};
export type Incoming = { product_id: string; warehouse_id: string | null; incoming_qty: number };

export async function listIncoming(companyId: string): Promise<Incoming[]> {
  if (!companyId) return [];
  const data = logRead("inventory:incoming", await supabase
    .from("v_stock_incoming").select("product_id, warehouse_id, incoming_qty").eq("company_id", companyId));
  return ((data || []) as any[]).filter((r) => r.product_id).map((r) => ({
    product_id: r.product_id, warehouse_id: r.warehouse_id, incoming_qty: Number(r.incoming_qty || 0),
  }));
}

export async function listPurchaseOrders(companyId: string, from: string, to: string): Promise<PurchaseOrder[]> {
  if (!companyId) return [];
  const data = logRead("inventory:purchase-orders", await supabase
    .from("purchase_orders")
    .select("id, po_no, order_date, due_date, partner_id, partner_name, warehouse_id, status, note, created_at")
    .eq("company_id", companyId).gte("order_date", from).lte("order_date", to)
    .order("order_date", { ascending: false }).order("created_at", { ascending: false })
    .limit(1000));
  return (data || []) as PurchaseOrder[];
}

export async function listPoLines(orderId: string): Promise<PurchaseOrderLine[]> {
  if (!orderId) return [];
  const data = logRead("inventory:po-lines", await supabase
    .from("purchase_order_lines").select("id, order_id, product_id, qty, unit_price, note")
    .eq("order_id", orderId).order("created_at", { ascending: true }));
  return ((data || []) as any[]).map((r) => ({
    ...r, qty: Number(r.qty || 0), unit_price: r.unit_price == null ? null : Number(r.unit_price),
  })) as PurchaseOrderLine[];
}

export async function listReceived(companyId: string, orderIds?: string[]): Promise<ReceivedRow[]> {
  if (!companyId) return [];
  let qb = supabase.from("v_purchase_line_received")
    .select("order_id, po_line_id, product_id, ordered_qty, received_qty").eq("company_id", companyId);
  if (orderIds && orderIds.length) qb = qb.in("order_id", orderIds);
  const data = logRead("inventory:received", await qb);
  return ((data || []) as any[]).filter((r) => r.po_line_id).map((r) => ({
    order_id: r.order_id, po_line_id: r.po_line_id, product_id: r.product_id,
    ordered_qty: Number(r.ordered_qty || 0), received_qty: Number(r.received_qty || 0),
  }));
}

export type PoInput = {
  orderDate?: string; dueDate?: string | null;
  partnerId?: string | null; partnerName?: string | null;
  warehouseId: string; note?: string | null;
  lines: { product_id: string; qty: number; unit_price?: number | null; note?: string | null }[];
};

export async function createPurchaseOrder(companyId: string, input: PoInput, userId?: string | null) {
  const orderDate = input.orderDate || todayKst();
  const lines = input.lines.filter((l) => l.product_id && Number(l.qty) > 0);
  if (!lines.length) throw new Error("발주할 줄이 한 줄도 없습니다");

  const ymd = orderDate.replace(/-/g, "").slice(2);
  const { count } = await supabase.from("purchase_orders")
    .select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("order_date", orderDate);
  const poNo = `PO-${ymd}-${String((count || 0) + 1).padStart(2, "0")}`;

  const { data: head, error } = await supabase.from("purchase_orders").insert({
    company_id: companyId, po_no: poNo, order_date: orderDate,
    due_date: input.dueDate || null, partner_id: input.partnerId || null,
    partner_name: input.partnerName?.trim() || null, warehouse_id: input.warehouseId,
    status: "open", note: input.note?.trim() || null, created_by: userId ?? null,
  }).select("id").single();
  if (error) throw error;
  const orderId = (head as { id: string }).id;

  const { error: lineErr } = await supabase.from("purchase_order_lines").insert(
    lines.map((l) => ({
      company_id: companyId, order_id: orderId, product_id: l.product_id,
      qty: Number(l.qty), unit_price: l.unit_price ?? null, note: l.note?.trim() || null,
    })),
  );
  if (lineErr) {
    await supabase.from("purchase_orders").delete().eq("id", orderId);
    throw lineErr;
  }
  return { id: orderId, poNo };
}

/** 발주에서 입고한다 — 매입 입고 문서 한 건을 세우고 각 줄을 발주 줄에 붙인다. 부분 입고가 기본. */
export async function receivePurchaseOrder(
  companyId: string, orderId: string,
  lines: { po_line_id: string; product_id: string; qty: number; unit_price?: number | null }[],
  opts?: { docDate?: string; note?: string | null },
  userId?: string | null,
) {
  const { data: head } = await supabase.from("purchase_orders")
    .select("id, warehouse_id, partner_id, status").eq("id", orderId).single();
  const h = head as { warehouse_id: string | null; partner_id: string | null; status: string } | null;
  if (!h) throw new Error("발주를 찾을 수 없습니다");
  if (h.status === "cancelled") throw new Error("취소한 발주입니다 — 되살린 뒤에 입고하세요");
  if (!h.warehouse_id) throw new Error("창고가 없는 발주입니다");

  const use = lines.filter((l) => Number(l.qty) !== 0);
  if (!use.length) throw new Error("받을 수량이 없습니다");

  const r = await createStockDoc(companyId, {
    reason: "purchase", docDate: opts?.docDate, warehouseId: h.warehouse_id,
    partnerId: h.partner_id, purchaseOrderId: orderId, note: opts?.note ?? null,
    lines: use.map((l) => ({
      product_id: l.product_id, qty: Number(l.qty),
      unit_price: l.unit_price ?? null, po_line_id: l.po_line_id,
    })),
  }, userId);

  await syncPoStatus(companyId, orderId);
  return r;
}

export async function syncPoStatus(companyId: string, orderId: string) {
  const rows = await listReceived(companyId, [orderId]);
  if (!rows.length) return;
  const { data: cur } = await supabase.from("purchase_orders").select("status").eq("id", orderId).single();
  const now = (cur as { status: string } | null)?.status;
  if (now === "cancelled") return;
  const next = rows.every((r) => r.received_qty >= r.ordered_qty) ? "done" : "open";
  if (now !== next) {
    await supabase.from("purchase_orders")
      .update({ status: next, updated_at: new Date().toISOString() }).eq("id", orderId);
  }
}

export async function cancelPurchaseOrder(companyId: string, orderId: string) {
  const rows = await listReceived(companyId, [orderId]);
  const got = rows.reduce((n, r) => n + r.received_qty, 0);
  if (got !== 0) throw new Error("이미 받은 것이 있는 발주입니다 — 반품으로 되돌린 뒤에 취소하세요");
  const { error } = await supabase.from("purchase_orders")
    .update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", orderId);
  if (error) throw error;
}

export async function reopenPurchaseOrder(orderId: string) {
  const { error } = await supabase.from("purchase_orders")
    .update({ status: "open", updated_at: new Date().toISOString() })
    .eq("id", orderId).eq("status", "cancelled");
  if (error) throw error;
}
