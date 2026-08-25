"use client";

// ── 재고 2단계 — 판매(주문 · 출고) (2026-08-25 사장님 지시) ────────────────────
//   ★ 결정 5(1단계 그대로) — **주문 없이도 출고가 선다.** 그건 재고 화면의 '+ 입·출고'가 이미 한다.
//     여기서는 그것을 막지 않고, 주문을 쓰는 회사에게 **판매가능수량**을 더해 준다.
//     "재고는 100인데 90은 이미 팔렸다" — 2단계가 주는 새 정보는 이것 하나다.
//   ★ 결정 12 — 나간 수량을 주문 줄에 적어 두지 않는다. v_sales_line_shipped(움직임의 합)로 읽는다.
//   ★ 결정 13 — 주문은 지우지 않고 취소한다. **나간 것이 있으면 취소도 막는다** —
//     물건은 나갔는데 약속만 사라지면 장부가 거짓말을 한다.

import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";
import { todayKst } from "@/lib/kst";
import { createStockDoc } from "@/lib/inventory";

export type SalesOrder = {
  id: string; order_no: string; order_date: string; due_date: string | null;
  partner_id: string | null; partner_name: string | null; warehouse_id: string | null;
  status: "open" | "done" | "cancelled"; note: string | null; created_at: string;
};
export type SalesOrderLine = {
  id: string; order_id: string; product_id: string; qty: number; unit_price: number | null; note: string | null;
};
export type ShippedRow = {
  order_id: string; order_line_id: string; product_id: string; ordered_qty: number; shipped_qty: number;
};
export type Available = {
  product_id: string; warehouse_id: string | null;
  onhand_qty: number; reserved_qty: number; available_qty: number;
};

export async function listAvailable(companyId: string): Promise<Available[]> {
  if (!companyId) return [];
  const data = logRead("inventory:available", await supabase
    .from("v_stock_available").select("product_id, warehouse_id, onhand_qty, reserved_qty, available_qty")
    .eq("company_id", companyId));
  return ((data || []) as any[]).filter((r) => r.product_id).map((r) => ({
    product_id: r.product_id, warehouse_id: r.warehouse_id,
    onhand_qty: Number(r.onhand_qty || 0), reserved_qty: Number(r.reserved_qty || 0),
    available_qty: Number(r.available_qty || 0),
  }));
}

export async function listSalesOrders(companyId: string, from: string, to: string): Promise<SalesOrder[]> {
  if (!companyId) return [];
  const data = logRead("inventory:sales-orders", await supabase
    .from("sales_orders")
    .select("id, order_no, order_date, due_date, partner_id, partner_name, warehouse_id, status, note, created_at")
    .eq("company_id", companyId).gte("order_date", from).lte("order_date", to)
    .order("order_date", { ascending: false }).order("created_at", { ascending: false })
    .limit(1000));
  return (data || []) as SalesOrder[];
}

export async function listOrderLines(orderId: string): Promise<SalesOrderLine[]> {
  if (!orderId) return [];
  const data = logRead("inventory:order-lines", await supabase
    .from("sales_order_lines").select("id, order_id, product_id, qty, unit_price, note")
    .eq("order_id", orderId).order("created_at", { ascending: true }));
  return ((data || []) as any[]).map((r) => ({
    ...r, qty: Number(r.qty || 0), unit_price: r.unit_price == null ? null : Number(r.unit_price),
  })) as SalesOrderLine[];
}

/** 주문 줄별로 이미 나간 수량 — 목록의 진행률도 이걸로 그린다(결정 12). */
export async function listShipped(companyId: string, orderIds?: string[]): Promise<ShippedRow[]> {
  if (!companyId) return [];
  let qb = supabase.from("v_sales_line_shipped")
    .select("order_id, order_line_id, product_id, ordered_qty, shipped_qty").eq("company_id", companyId);
  if (orderIds && orderIds.length) qb = qb.in("order_id", orderIds);
  const data = logRead("inventory:shipped", await qb);
  return ((data || []) as any[]).filter((r) => r.order_line_id).map((r) => ({
    order_id: r.order_id, order_line_id: r.order_line_id, product_id: r.product_id,
    ordered_qty: Number(r.ordered_qty || 0), shipped_qty: Number(r.shipped_qty || 0),
  }));
}

export type OrderInput = {
  orderDate?: string; dueDate?: string | null;
  partnerId?: string | null; partnerName?: string | null;
  warehouseId: string; note?: string | null;
  lines: { product_id: string; qty: number; unit_price?: number | null; note?: string | null }[];
};

export async function createSalesOrder(companyId: string, input: OrderInput, userId?: string | null) {
  const orderDate = input.orderDate || todayKst();
  const lines = input.lines.filter((l) => l.product_id && Number(l.qty) > 0);
  if (!lines.length) throw new Error("주문할 줄이 한 줄도 없습니다");

  //   문서번호 — 사람이 읽고 부를 수 있어야 한다. 재고 문서(IN·OUT·ADJ)와 같은 규칙.
  const ymd = orderDate.replace(/-/g, "").slice(2);
  const { count } = await supabase.from("sales_orders")
    .select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("order_date", orderDate);
  const orderNo = `SO-${ymd}-${String((count || 0) + 1).padStart(2, "0")}`;

  const { data: head, error } = await supabase.from("sales_orders").insert({
    company_id: companyId, order_no: orderNo, order_date: orderDate,
    due_date: input.dueDate || null, partner_id: input.partnerId || null,
    partner_name: input.partnerName?.trim() || null, warehouse_id: input.warehouseId,
    status: "open", note: input.note?.trim() || null, created_by: userId ?? null,
  }).select("id").single();
  if (error) throw error;
  const orderId = (head as { id: string }).id;

  const { error: lineErr } = await supabase.from("sales_order_lines").insert(
    lines.map((l) => ({
      company_id: companyId, order_id: orderId, product_id: l.product_id,
      qty: Number(l.qty), unit_price: l.unit_price ?? null, note: l.note?.trim() || null,
    })),
  );
  if (lineErr) {
    await supabase.from("sales_orders").delete().eq("id", orderId);   // 줄 없는 주문을 남기지 않는다
    throw lineErr;
  }
  return { id: orderId, orderNo };
}

/**
 * 주문에서 출고한다 — 판매 출고 문서 한 건을 세우고 각 줄을 주문 줄에 붙인다(결정 12).
 *   **부분 출고가 기본**이다. 남은 것은 주문에 그대로 남고, 다 나가면 저절로 '다 나감'이 된다.
 */
export async function shipSalesOrder(
  companyId: string, orderId: string,
  lines: { order_line_id: string; product_id: string; qty: number; unit_price?: number | null }[],
  opts?: { docDate?: string; note?: string | null },
  userId?: string | null,
) {
  const { data: head } = await supabase.from("sales_orders")
    .select("id, warehouse_id, partner_id, status").eq("id", orderId).single();
  const h = head as { warehouse_id: string | null; partner_id: string | null; status: string } | null;
  if (!h) throw new Error("주문을 찾을 수 없습니다");
  if (h.status === "cancelled") throw new Error("취소한 주문입니다 — 되살린 뒤에 출고하세요");
  if (!h.warehouse_id) throw new Error("창고가 없는 주문입니다");

  const use = lines.filter((l) => Number(l.qty) !== 0);
  if (!use.length) throw new Error("내보낼 수량이 없습니다");

  const r = await createStockDoc(companyId, {
    reason: "sale", docDate: opts?.docDate, warehouseId: h.warehouse_id,
    partnerId: h.partner_id, salesOrderId: orderId, note: opts?.note ?? null,
    lines: use.map((l) => ({
      product_id: l.product_id, qty: Number(l.qty),
      unit_price: l.unit_price ?? null, order_line_id: l.order_line_id,
    })),
  }, userId);

  await syncOrderStatus(companyId, orderId);
  return r;
}

/** 다 나갔는지 다시 세어 상태를 맞춘다 — 상태도 '저장한 값'이 아니라 계산 결과여야 한다(결정 3의 뜻). */
export async function syncOrderStatus(companyId: string, orderId: string) {
  const rows = await listShipped(companyId, [orderId]);
  if (!rows.length) return;
  const { data: cur } = await supabase.from("sales_orders").select("status").eq("id", orderId).single();
  const now = (cur as { status: string } | null)?.status;
  if (now === "cancelled") return;
  const next = rows.every((r) => r.shipped_qty >= r.ordered_qty) ? "done" : "open";
  if (now !== next) {
    await supabase.from("sales_orders")
      .update({ status: next, updated_at: new Date().toISOString() }).eq("id", orderId);
  }
}

export async function cancelSalesOrder(companyId: string, orderId: string) {
  const rows = await listShipped(companyId, [orderId]);
  const shipped = rows.reduce((n, r) => n + r.shipped_qty, 0);
  //   결정 13 — 물건은 나갔는데 약속만 사라지면 장부가 거짓말을 한다.
  if (shipped !== 0) throw new Error("이미 나간 것이 있는 주문입니다 — 반품으로 되돌린 뒤에 취소하세요");
  const { error } = await supabase.from("sales_orders")
    .update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", orderId);
  if (error) throw error;
}

export async function reopenSalesOrder(orderId: string) {
  const { error } = await supabase.from("sales_orders")
    .update({ status: "open", updated_at: new Date().toISOString() })
    .eq("id", orderId).eq("status", "cancelled");
  if (error) throw error;
}
