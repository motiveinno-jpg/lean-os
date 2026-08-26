"use client";

// ── 재고 5단계 — 채널(온라인 판매처) 연동 (2026-08-25 사장님 지시) ─────────────
//   ★ 결정 17 — 이 단계에서 가장 무서운 것은 API 가 없는 것이 아니라 **같은 주문을 두 번 넣는 것**이다.
//     두 번 넣으면 재고가 두 번 빠지고 아무도 모른다. 그래서 뼈대는 '무엇을 이미 가져왔는가' 표 하나다.
//   ★ 결정 18 — **키가 없어도 오늘 쓸 수 있어야 한다.** 스마트스토어·쿠팡 모두 주문 엑셀을 내려받는다.
//     엑셀 붙여넣기가 1등 시민이고, API 자동 수집은 키가 들어오면 같은 자리에 붙인다.
//   ★ 결정 19 — 채널 상품코드 ↔ SKU 는 **사람이 한 번 이어 준다.** 이름으로 알아서 맞히면
//     비슷한 이름끼리 잘못 붙고, 그 잘못이 곧바로 재고가 된다.

import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";
import { todayKst } from "@/lib/kst";
import { createStockDoc } from "@/lib/inventory";

//   채널 — 이름은 사장님이 부르는 대로. 없는 곳은 '기타'로 적고 나중에 늘린다.
export const CHANNELS = [
  { value: "smartstore", label: "스마트스토어" },
  { value: "coupang", label: "쿠팡" },
  { value: "eleven", label: "11번가" },
  { value: "gmarket", label: "G마켓·옥션" },
  { value: "own", label: "자사몰" },
  { value: "etc", label: "기타" },
] as const;
export type ChannelValue = (typeof CHANNELS)[number]["value"];
export const channelLabel = (v: string) => CHANNELS.find((c) => c.value === v)?.label ?? v;

export type ChannelCode = {
  id: string; product_id: string; channel: string;
  channel_product_id: string; channel_sku: string | null;
  channel_product_name: string | null; is_active: boolean;
};
export type OrderImport = {
  id: string; channel: string; channel_order_no: string; order_date: string | null;
  buyer_name: string | null; amount: number | null; doc_id: string | null; imported_at: string;
};

// ── 채널 상품 연결 ────────────────────────────────────────────────────────────
export async function listChannelCodes(companyId: string): Promise<ChannelCode[]> {
  if (!companyId) return [];
  const data = logRead("inventory:channel-codes", await supabase
    .from("product_channel_codes")
    .select("id, product_id, channel, channel_product_id, channel_sku, channel_product_name, is_active")
    .eq("company_id", companyId).limit(5000));
  return (data || []) as ChannelCode[];
}

export async function upsertChannelCode(companyId: string, c: {
  id?: string; product_id: string; channel: string;
  channel_product_id: string; channel_product_name?: string | null; channel_sku?: string | null;
}) {
  const code = c.channel_product_id.trim();
  if (!code) throw new Error("채널 상품코드를 입력하세요");
  const row = {
    company_id: companyId, product_id: c.product_id, channel: c.channel,
    channel_product_id: code, channel_sku: c.channel_sku?.trim() || null,
    channel_product_name: c.channel_product_name?.trim() || null,
    updated_at: new Date().toISOString(),
  };
  const { error } = c.id
    ? await supabase.from("product_channel_codes").update(row).eq("id", c.id)
    : await supabase.from("product_channel_codes").upsert(row, { onConflict: "company_id,channel,channel_product_id" });
  if (error) throw error;
}

export async function deleteChannelCode(id: string) {
  const { error } = await supabase.from("product_channel_codes").delete().eq("id", id);
  if (error) throw error;
}

// ── 이미 가져온 주문 ──────────────────────────────────────────────────────────
export async function listImports(companyId: string, limit = 500): Promise<OrderImport[]> {
  if (!companyId) return [];
  const data = logRead("inventory:channel-imports", await supabase
    .from("channel_order_imports")
    .select("id, channel, channel_order_no, order_date, buyer_name, amount, doc_id, imported_at")
    .eq("company_id", companyId).order("imported_at", { ascending: false }).limit(limit));
  return ((data || []) as any[]).map((r) => ({ ...r, amount: r.amount == null ? null : Number(r.amount) })) as OrderImport[];
}

/** 붙여넣은 줄 하나 — 채널이 준 그대로. 무엇이 SKU 로 이어지는지는 아래에서 판단한다. */
export type RawOrderRow = {
  channel_order_no: string;
  channel_product_id: string;
  qty: number;
  unit_price?: number | null;
  order_date?: string | null;
  buyer_name?: string | null;
};

export type ResolvedRow = RawOrderRow & {
  product_id: string | null;
  reason: "ok" | "no-code" | "already" | "no-track";
};

/**
 * 붙여넣은 줄을 우리 것으로 옮긴다 — **넣기 전에 무엇이 걸리는지 다 보여 준다.**
 *   ok        : 넣을 수 있다
 *   no-code   : 이 채널 상품코드를 아직 SKU 에 안 이었다(결정 19 — 사람이 이어야 한다)
 *   already   : 이미 가져온 주문번호다(결정 17 — 두 번 안 넣는다)
 *   no-track  : 이어진 품목이 수량을 세지 않는다(서비스 등)
 */
export async function resolveRows(
  companyId: string, channel: string, rows: RawOrderRow[],
): Promise<ResolvedRow[]> {
  const codes = (await listChannelCodes(companyId)).filter((c) => c.channel === channel && c.is_active);
  const byCode = new Map(codes.map((c) => [c.channel_product_id.trim().toUpperCase(), c.product_id]));

  const ids = [...new Set(codes.map((c) => c.product_id))];
  const tracked = new Set<string>();
  if (ids.length) {
    const data = logRead("inventory:channel-track", await supabase
      .from("products").select("id, track_stock").in("id", ids));
    for (const r of ((data || []) as any[])) if (r.track_stock) tracked.add(r.id);
  }

  //   이미 가져온 주문번호 — 붙여넣은 것만 확인한다(전부 읽지 않는다)
  const orderNos = [...new Set(rows.map((r) => r.channel_order_no).filter(Boolean))];
  const seen = new Set<string>();
  for (let i = 0; i < orderNos.length; i += 200) {
    const chunk = orderNos.slice(i, i + 200);
    const data = logRead("inventory:channel-seen", await supabase
      .from("channel_order_imports").select("channel_order_no")
      .eq("company_id", companyId).eq("channel", channel).in("channel_order_no", chunk));
    for (const r of ((data || []) as any[])) seen.add(r.channel_order_no);
  }

  return rows.map((r) => {
    const pid = byCode.get(r.channel_product_id.trim().toUpperCase()) ?? null;
    const reason: ResolvedRow["reason"] =
      seen.has(r.channel_order_no) ? "already"
      : !pid ? "no-code"
      : !tracked.has(pid) ? "no-track"
      : "ok";
    return { ...r, product_id: pid, reason };
  });
}

/**
 * 걸러진 줄을 **판매 출고 한 건**으로 넣고, 가져온 주문번호를 적어 둔다.
 *   주문 표(sales_orders)를 만들지 않는 이유 — 채널 주문은 이미 확정된 판매다.
 *   약속이 아니라 사실이므로 '바로 판매'와 같은 자리에 선다(결정 5).
 */
export async function importChannelOrders(
  companyId: string, channel: string, warehouseId: string,
  rows: ResolvedRow[], opts?: { docDate?: string }, userId?: string | null,
) {
  const use = rows.filter((r) => r.reason === "ok" && r.product_id && Number(r.qty) !== 0);
  if (!use.length) throw new Error("등록할 줄이 없습니다");
  const docDate = opts?.docDate || todayKst();

  const doc = await createStockDoc(companyId, {
    reason: "sale", docDate, warehouseId,
    note: `${channelLabel(channel)} 주문 ${new Set(use.map((r) => r.channel_order_no)).size}건`,
    lines: use.map((r) => ({
      product_id: r.product_id!, qty: Number(r.qty),
      unit_price: r.unit_price ?? null,
      note: `${channelLabel(channel)} ${r.channel_order_no}`,
    })),
  }, userId);

  //   주문번호를 적어 둔다 — 같은 주문번호가 여러 줄이면 한 번만 적는다.
  const seen = new Map<string, ResolvedRow>();
  for (const r of use) if (!seen.has(r.channel_order_no)) seen.set(r.channel_order_no, r);
  const { error } = await supabase.from("channel_order_imports").insert(
    [...seen.values()].map((r) => ({
      company_id: companyId, channel, channel_order_no: r.channel_order_no,
      order_date: r.order_date || docDate, buyer_name: r.buyer_name || null,
      amount: r.unit_price != null ? Number(r.unit_price) * Number(r.qty) : null,
      doc_id: doc.id, imported_by: userId ?? null,
    })),
  );
  //   기록이 실패하면 **다음에 또 넣을 수 있게 된다** — 그러면 재고가 두 번 빠진다.
  //   그래서 출고를 되돌리고 그대로 알린다(결정 17).
  if (error) {
    await supabase.from("stock_moves").delete().eq("doc_id", doc.id);
    await supabase.from("stock_docs").delete().eq("id", doc.id);
    throw error;
  }

  return { docNo: doc.docNo, lines: use.length, orders: seen.size };
}
