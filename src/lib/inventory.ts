"use client";

// ── 재고 1단계 — 품목 · 재고 (2026-08-25 사장님 지시) ─────────────────────────────
//   기획: https://claude.ai/code/artifact/afc625ae-c5b5-4b7b-9b51-fdcf3e93165a
//
//   ★ 결정 3 — **현재고를 저장하지 않는다.** 움직인 기록(stock_moves)만 쌓고 합으로 낸다(v_stock_onhand).
//     수량 칸을 직접 고치면 "왜 이 숫자가 됐는지" 아무도 설명할 수 없다 — 잔액을 고치지 않고 전표를 쌓는
//     오너뷰의 장부 방식과 같다.
//   ★ 결정 5 — 주문·발주(약속) 없이도 입·출고(사실)가 선다. 그래서 문서를 만드는 함수 하나가
//     '바로 입고'·'바로 출고'·'조정'·'이동'을 전부 받는다.
//   ★ 결정 8 — 지우지 않고 부호로 남긴다. 수량은 음수를 받는다(반품·정정).

import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";
import { todayKst } from "@/lib/kst";

export type Product = {
  id: string; sku: string; name: string;
  category: string | null; spec: string | null; unit: string; barcode: string | null;
  track_stock: boolean;
  sale_price: number | null; cost_price: number | null; safety_stock: number | null;
  is_active: boolean; memo: string | null;
};

export type Warehouse = { id: string; name: string; code: string | null; is_default: boolean; is_active: boolean };

/** 움직임 사유 — 나가는 것이 다 판매는 아니다(결정 5). 없으면 매출원가와 손실이 뒤섞인다. */
export const STOCK_REASONS = [
  { value: "purchase",   label: "매입 입고",  kind: "in"     as const, sign: +1 },
  { value: "sale",       label: "판매 출고",  kind: "out"    as const, sign: -1 },
  { value: "return_in",  label: "반품 입고",  kind: "in"     as const, sign: +1 },
  { value: "return_out", label: "반품 출고",  kind: "out"    as const, sign: -1 },
  { value: "sample",     label: "샘플",       kind: "out"    as const, sign: -1 },
  { value: "gift",       label: "증정",       kind: "out"    as const, sign: -1 },
  { value: "disposal",   label: "폐기",       kind: "out"    as const, sign: -1 },
  { value: "opening",    label: "기초 등록",  kind: "adjust" as const, sign: +1 },
  { value: "count",      label: "실사 조정",  kind: "adjust" as const, sign: +1 },
  { value: "fix",        label: "정정",       kind: "adjust" as const, sign: +1 },
  { value: "move",       label: "창고 이동",  kind: "move"   as const, sign: -1 },
] as const;
export type StockReason = (typeof STOCK_REASONS)[number]["value"];
export const reasonOf = (v: string) => STOCK_REASONS.find((r) => r.value === v);
export const reasonLabel = (v: string) => reasonOf(v)?.label ?? v;

// ── 품목 ─────────────────────────────────────────────────────────────────────
export async function listProducts(companyId: string): Promise<Product[]> {
  if (!companyId) return [];
  const data = logRead("inventory:products", await supabase
    .from("products")
    .select("id, sku, name, category, spec, unit, barcode, track_stock, sale_price, cost_price, safety_stock, is_active, memo")
    .eq("company_id", companyId)
    .order("sku"));
  return (data || []) as Product[];
}

export async function upsertProduct(companyId: string, p: Partial<Product> & { id?: string }, userId?: string | null) {
  const row = {
    company_id: companyId,
    sku: String(p.sku || "").trim(),
    name: String(p.name || "").trim(),
    category: p.category?.trim() || null,
    spec: p.spec?.trim() || null,
    unit: p.unit?.trim() || "EA",
    barcode: p.barcode?.trim() || null,
    track_stock: p.track_stock !== false,
    sale_price: p.sale_price ?? null,
    cost_price: p.cost_price ?? null,
    safety_stock: p.safety_stock ?? null,
    is_active: p.is_active !== false,
    memo: p.memo?.trim() || null,
    updated_at: new Date().toISOString(),
  };
  if (p.id) {
    const { error } = await supabase.from("products").update(row).eq("id", p.id);
    if (error) throw error;
    return p.id;
  }
  const { data, error } = await supabase.from("products")
    .insert({ ...row, created_by: userId ?? null }).select("id").single();
  if (error) throw error;
  return (data as { id: string }).id;
}

// ── 창고 ─────────────────────────────────────────────────────────────────────
export async function listWarehouses(companyId: string): Promise<Warehouse[]> {
  if (!companyId) return [];
  const data = logRead("inventory:warehouses", await supabase
    .from("warehouses").select("id, name, code, is_default, is_active")
    .eq("company_id", companyId).order("is_default", { ascending: false }).order("name"));
  return (data || []) as Warehouse[];
}

/** 창고가 하나도 없으면 '본사창고'를 만들어 준다 — 첫 입고에서 고를 것이 없으면 진도가 안 나간다. */
export async function ensureDefaultWarehouse(companyId: string): Promise<Warehouse | null> {
  const list = await listWarehouses(companyId);
  if (list.length) return list.find((w) => w.is_default) ?? list[0];
  const { data, error } = await supabase.from("warehouses")
    .insert({ company_id: companyId, name: "본사창고", is_default: true })
    .select("id, name, code, is_default, is_active").single();
  if (error) throw error;
  return data as Warehouse;
}

export async function upsertWarehouse(companyId: string, w: { id?: string; name: string; code?: string; is_default?: boolean }) {
  const row = { company_id: companyId, name: w.name.trim(), code: w.code?.trim() || null, is_default: !!w.is_default };
  if (w.id) {
    const { error } = await supabase.from("warehouses").update(row).eq("id", w.id);
    if (error) throw error;
    return w.id;
  }
  const { data, error } = await supabase.from("warehouses").insert(row).select("id").single();
  if (error) throw error;
  return (data as { id: string }).id;
}

// ── 현재고 ───────────────────────────────────────────────────────────────────
export type OnHand = { product_id: string; warehouse_id: string; qty: number };

export async function listOnHand(companyId: string): Promise<OnHand[]> {
  if (!companyId) return [];
  const data = logRead("inventory:onhand", await supabase
    .from("v_stock_onhand").select("product_id, warehouse_id, qty").eq("company_id", companyId));
  return ((data || []) as any[])
    .filter((r) => r.product_id && r.warehouse_id)
    .map((r) => ({ product_id: r.product_id, warehouse_id: r.warehouse_id, qty: Number(r.qty || 0) }));
}

// ── 움직임 문서 ──────────────────────────────────────────────────────────────
export type MoveLine = {
  product_id: string; qty: number; unit_price?: number | null; note?: string | null;
  //   2단계 — 이 줄이 어느 주문 줄을 채우는가(결정 12). 비워 두면 '바로 출고'다.
  order_line_id?: string | null;
  //   3단계 — 이 줄이 어느 발주 줄을 채우는가. 비워 두면 '바로 입고'다.
  po_line_id?: string | null;
};

export type StockDocInput = {
  reason: StockReason;
  docDate?: string;
  warehouseId: string;
  toWarehouseId?: string | null;   // 창고 이동일 때만
  partnerId?: string | null;
  note?: string | null;
  originalDocId?: string | null;   // 반품·정정이 가리키는 원본(결정 8)
  salesOrderId?: string | null;    // 2단계 — 주문에서 넘어온 출고. 없어도 된다(결정 5)
  purchaseOrderId?: string | null; // 3단계 — 발주에서 넘어온 입고. 역시 없어도 된다
  lines: MoveLine[];
};

/**
 * 문서 하나를 만들고 그 줄을 stock_moves 에 쌓는다.
 *   ★ 수량 부호는 **사유가 정한다**(입고 +, 출고 −). 다만 사람이 음수를 직접 넣으면
 *     그 뜻을 존중한다(결정 8) — 출고에 −3 을 넣으면 재고가 +3 된다(반품·정정).
 *   ★ 창고 이동은 한 문서에서 **빼고 넣는 두 줄**을 만든다 — 총합은 0 이라 전체 재고가 안 변한다.
 *   ★ track_stock 이 꺼진 품목은 애초에 줄을 만들지 않는다(결정 6-④ · 7) — 서비스는 셀 물건이 없다.
 */
export async function createStockDoc(
  companyId: string,
  input: StockDocInput,
  userId?: string | null,
): Promise<{ id: string; docNo: string; skipped: number }> {
  const def = reasonOf(input.reason);
  if (!def) throw new Error("알 수 없는 사유입니다");
  const docDate = input.docDate || todayKst();

  //   재고를 세지 않는 품목은 거른다 — 넣어 봐야 뜻이 없고, 음수만 쌓인다.
  const ids = [...new Set(input.lines.map((l) => l.product_id))];
  const tracked = new Set<string>();
  if (ids.length) {
    const data = logRead("inventory:trackcheck", await supabase
      .from("products").select("id, track_stock").in("id", ids));
    for (const r of ((data || []) as any[])) if (r.track_stock) tracked.add(r.id);
  }
  const lines = input.lines.filter((l) => tracked.has(l.product_id) && Number(l.qty) !== 0);
  const skipped = input.lines.length - lines.length;
  if (!lines.length) throw new Error("재고를 세는 품목이 한 줄도 없습니다");

  //   문서번호 — 사유 갈래 + 날짜 + 그 날 일련번호. 사람이 읽고 부를 수 있어야 한다.
  const prefix = def.kind === "in" ? "IN" : def.kind === "out" ? "OUT" : def.kind === "move" ? "MOV" : "ADJ";
  const ymd = docDate.replace(/-/g, "").slice(2);
  const { count } = await supabase.from("stock_docs")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId).eq("doc_date", docDate).eq("kind", def.kind);
  const docNo = `${prefix}-${ymd}-${String((count || 0) + 1).padStart(2, "0")}`;

  const { data: doc, error: docErr } = await supabase.from("stock_docs").insert({
    company_id: companyId,
    doc_no: docNo,
    kind: def.kind,
    reason: input.reason,
    doc_date: docDate,
    partner_id: input.partnerId || null,
    warehouse_id: input.warehouseId,
    to_warehouse_id: input.toWarehouseId || null,
    original_doc_id: input.originalDocId || null,
    sales_order_id: input.salesOrderId || null,
    purchase_order_id: input.purchaseOrderId || null,
    note: input.note?.trim() || null,
    created_by: userId ?? null,
  }).select("id").single();
  if (docErr) throw docErr;
  const docId = (doc as { id: string }).id;

  const rows: any[] = [];
  for (const l of lines) {
    const raw = Number(l.qty);
    //   ★ 결정 8 — 칸에 적는 것은 '재고 증감'이 아니라 **그 사유가 몇 개 일어났는가**다.
    //     그래서 부호는 언제나 사유의 부호를 곱한다: 판매 출고 50 → 재고 -50, 판매 출고 -50(취소) → 재고 +50.
    //     ('음수는 그대로 둔다'로 짰다가 검증에서 잡혔다 — 취소를 넣었는데 판매를 한 번 더 한 셈이 됐다.)
    const signed = raw * def.sign;
    rows.push({
      company_id: companyId, doc_id: docId, product_id: l.product_id,
      warehouse_id: input.warehouseId, qty: signed,
      order_line_id: l.order_line_id ?? null,
      po_line_id: l.po_line_id ?? null,
      unit_price: l.unit_price ?? null,
      amount: l.unit_price != null ? Number(l.unit_price) * signed : null,
      moved_at: docDate, note: l.note?.trim() || null,
    });
    //   창고 이동 — 받는 창고에 반대 부호로 한 줄 더. 한 문서 안에서 합이 0 이다.
    if (def.kind === "move" && input.toWarehouseId) {
      rows.push({
        company_id: companyId, doc_id: docId, product_id: l.product_id,
        warehouse_id: input.toWarehouseId, qty: -signed,
        unit_price: l.unit_price ?? null,
        amount: l.unit_price != null ? Number(l.unit_price) * -signed : null,
        moved_at: docDate, note: l.note?.trim() || null,
      });
    }
  }
  const { error: mvErr } = await supabase.from("stock_moves").insert(rows);
  if (mvErr) {
    //   줄이 하나도 안 들어갔으면 빈 문서를 남기지 않는다
    await supabase.from("stock_docs").delete().eq("id", docId);
    throw mvErr;
  }
  return { id: docId, docNo, skipped };
}

// ── 움직인 이력 ──────────────────────────────────────────────────────────────
export type MoveRow = {
  id: string; moved_at: string; qty: number; unit_price: number | null; amount: number | null; note: string | null;
  product_id: string; warehouse_id: string;
  doc: { id: string; doc_no: string; kind: string; reason: string; note: string | null; partner_id: string | null } | null;
};

export async function listMoves(companyId: string, from: string, to: string): Promise<MoveRow[]> {
  if (!companyId) return [];
  const data = logRead("inventory:moves", await supabase
    .from("stock_moves")
    .select("id, moved_at, qty, unit_price, amount, note, product_id, warehouse_id, stock_docs(id, doc_no, kind, reason, note, partner_id)")
    .eq("company_id", companyId)
    .gte("moved_at", from).lte("moved_at", to)
    .order("moved_at", { ascending: false })
    .limit(2000));
  return ((data || []) as any[]).map((r) => ({ ...r, doc: r.stock_docs ?? null })) as MoveRow[];
}

// ── 재고조사(실사) — 2026-08-25 사장님 지시 ───────────────────────────────────
//   ★ 결정 9 — **실사는 숫자를 덮어쓰는 일이 아니라, 차이를 기록으로 남기는 일이다.**
//     장부 100 · 실제 97 이면 97로 고치는 게 아니라 '실사 조정 −3' 한 줄을 쌓는다.
//     그래야 나중에 "언제 3개가 비었나"를 물어볼 데가 있다(결정 3과 같은 이유).
//   ★ 결정 10 — **안 센 줄은 건드리지 않는다.** 센 수량이 비어 있는 것과 0을 적은 것은 다르다.
//     비었으면 조정에서 빠지고, 0을 적었으면 '0개였다'로 읽어 재고를 0으로 맞춘다.
//     (이걸 안 가르면 반쯤 세다 만 실사가 창고 전체를 0으로 만든다.)
//   ★ 결정 11 — **차이는 반영하는 순간의 장부와 견준다.** 세는 동안에도 판매는 일어난다.
//     시작할 때 찍어 둔 수량(system_qty)으로 조정하면 그 사이 판매가 지워진다.
//     대신 그 사이 움직인 줄이 있으면 **반영 전에 화면이 알린다** — 고르는 것은 사람이다.

export type StockCount = {
  id: string; count_date: string; status: "draft" | "done";
  warehouse_id: string | null; adjust_doc_id: string | null; note: string | null; created_at: string;
};
export type CountLine = { id: string; product_id: string; system_qty: number; counted_qty: number | null };

export async function listCounts(companyId: string): Promise<StockCount[]> {
  if (!companyId) return [];
  const data = logRead("inventory:counts", await supabase
    .from("stock_counts").select("id, count_date, status, warehouse_id, adjust_doc_id, note, created_at")
    .eq("company_id", companyId).order("count_date", { ascending: false }).order("created_at", { ascending: false })
    .limit(300));
  return (data || []) as StockCount[];
}

export async function listCountLines(countId: string): Promise<CountLine[]> {
  if (!countId) return [];
  const data = logRead("inventory:countlines", await supabase
    .from("stock_count_lines").select("id, product_id, system_qty, counted_qty")
    .eq("count_id", countId).limit(5000));
  return ((data || []) as any[]).map((r) => ({
    ...r, system_qty: Number(r.system_qty || 0),
    counted_qty: r.counted_qty == null ? null : Number(r.counted_qty),
  })) as CountLine[];
}

/**
 * 실사를 연다 — 그 시점 장부 수량을 줄로 찍어 둔다.
 *   `includeAll` 이면 재고가 0인 품목까지 깐다(창고를 통째로 세는 경우).
 *   꺼져 있으면 **지금 그 창고에 잡혀 있는 품목만** — 안 쓰는 품목 수백 개를 세게 하지 않는다.
 */
export async function createCount(
  companyId: string,
  input: { warehouseId: string; countDate?: string; note?: string | null; includeAll?: boolean },
  userId?: string | null,
): Promise<{ id: string; lines: number }> {
  const countDate = input.countDate || todayKst();
  const products = (await listProducts(companyId)).filter((p) => p.track_stock && p.is_active);
  const onhand = (await listOnHand(companyId)).filter((r) => r.warehouse_id === input.warehouseId);
  const qtyOf = new Map(onhand.map((r) => [r.product_id, r.qty]));

  const targets = input.includeAll ? products : products.filter((p) => qtyOf.has(p.id));
  if (!targets.length) throw new Error("셀 품목이 없습니다 — 품목을 먼저 등록하거나 '재고 0인 품목까지'를 켜세요");

  const { data: head, error } = await supabase.from("stock_counts").insert({
    company_id: companyId, warehouse_id: input.warehouseId, count_date: countDate,
    status: "draft", note: input.note?.trim() || null, created_by: userId ?? null,
  }).select("id").single();
  if (error) throw error;
  const countId = (head as { id: string }).id;

  const { error: lineErr } = await supabase.from("stock_count_lines").insert(
    targets.map((p) => ({
      company_id: companyId, count_id: countId, product_id: p.id,
      system_qty: qtyOf.get(p.id) ?? 0, counted_qty: null,
    })),
  );
  if (lineErr) {
    await supabase.from("stock_counts").delete().eq("id", countId);   // 줄 없는 실사를 남기지 않는다
    throw lineErr;
  }
  return { id: countId, lines: targets.length };
}

export async function saveCountedQty(countId: string, edits: { id: string; counted_qty: number | null }[]) {
  for (const e of edits) {
    const { error } = await supabase.from("stock_count_lines")
      .update({ counted_qty: e.counted_qty }).eq("id", e.id).eq("count_id", countId);
    if (error) throw error;
  }
}

export async function deleteCount(countId: string) {
  const { error } = await supabase.from("stock_counts").delete().eq("id", countId).eq("status", "draft");
  if (error) throw error;
}

/**
 * 실사를 반영한다 — 차이가 있는 줄만 모아 **'실사 조정' 문서 한 건**을 세운다(결정 9).
 *   ★ 견주는 대상은 반영 시점의 현재고다(결정 11). 스냅샷이 아니다.
 *   ★ 센 수량이 비어 있으면 아예 빠진다(결정 10).
 *   차이가 하나도 없으면 문서를 만들지 않고 '맞았다'로 닫는다 — 빈 문서를 남기지 않는다.
 */
export async function applyCount(
  companyId: string, countId: string, userId?: string | null,
): Promise<{ docNo: string | null; changed: number; counted: number; drifted: number }> {
  const { data: head } = await supabase.from("stock_counts")
    .select("id, warehouse_id, count_date, status").eq("id", countId).single();
  const h = head as { warehouse_id: string | null; count_date: string; status: string } | null;
  if (!h) throw new Error("실사를 찾을 수 없습니다");
  if (h.status === "done") throw new Error("이미 반영한 실사입니다 — 다시 맞추려면 새 실사를 여세요");
  if (!h.warehouse_id) throw new Error("창고가 없는 실사입니다");

  const lines = (await listCountLines(countId)).filter((l) => l.counted_qty != null);
  const onhand = (await listOnHand(companyId)).filter((r) => r.warehouse_id === h.warehouse_id);
  const nowOf = new Map(onhand.map((r) => [r.product_id, r.qty]));

  let drifted = 0;
  const moveLines: MoveLine[] = [];
  for (const l of lines) {
    const now = nowOf.get(l.product_id) ?? 0;
    if (now !== l.system_qty) drifted++;                       // 세는 동안 움직인 줄
    const diff = Number(l.counted_qty) - now;
    if (diff !== 0) moveLines.push({ product_id: l.product_id, qty: diff, note: `실사 ${h.count_date}` });
  }

  let docNo: string | null = null;
  let docId: string | null = null;
  if (moveLines.length) {
    const r = await createStockDoc(companyId, {
      reason: "count", docDate: h.count_date, warehouseId: h.warehouse_id,
      note: `실사 반영 (${moveLines.length}줄)`, lines: moveLines,
    }, userId);
    docNo = r.docNo; docId = r.id;
  }

  const { error } = await supabase.from("stock_counts")
    .update({ status: "done", adjust_doc_id: docId, updated_at: new Date().toISOString() })
    .eq("id", countId);
  if (error) throw error;
  return { docNo, changed: moveLines.length, counted: lines.length, drifted };
}
