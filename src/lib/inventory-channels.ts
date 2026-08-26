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
  recipient_name: string | null; recipient_phone: string | null; address: string | null; shipping_note: string | null; recipient_zip: string | null;
  ship_status: ShipStatus; carrier: string | null; tracking_no: string | null; shipped_at: string | null; delivered_at: string | null;
};
export type ShipStatus = "pending" | "shipped" | "done";
export const SHIP_STATUS_LABEL: Record<ShipStatus, string> = { pending: "출고 대기", shipped: "발송됨", done: "배송 완료" };
//   택배사 — 송장 파일 열 순서를 회사별 양식으로 맞출 때 여기에 양식을 붙인다
export const CARRIERS = [
  { value: "cj", label: "CJ대한통운" }, { value: "hanjin", label: "한진택배" }, { value: "lotte", label: "롯데택배" },
  { value: "post", label: "우체국택배" }, { value: "logen", label: "로젠택배" }, { value: "direct", label: "직접 배달·방문" }, { value: "etc", label: "기타" },
] as const;

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
    .select("id, channel, channel_order_no, order_date, buyer_name, amount, doc_id, imported_at, recipient_name, recipient_phone, address, shipping_note, recipient_zip, ship_status, carrier, tracking_no, shipped_at, delivered_at")
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
  recipient_name?: string | null;
  recipient_phone?: string | null;
  address?: string | null;
  shipping_note?: string | null;
  recipient_zip?: string | null;
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


// ── 격자 입력에서 바로 출고 등록 (2026-08-26 사장님 지시 — 입력 화면 형식) ─────────
//   붙여넣기·API 가 격자를 **채우기만** 하고, 출고는 사람이 [출고 등록]을 누른다.

/** 이미 등록된 채널 주문번호 — 물어본 것만 확인한다(전부 읽지 않는다). */
export async function listSeenOrderNos(companyId: string, channel: string, orderNos: string[]): Promise<Set<string>> {
  const nos = [...new Set(orderNos.map((n) => n.trim()).filter(Boolean))];
  const seen = new Set<string>();
  for (let i = 0; i < nos.length; i += 200) {
    const data = logRead("inventory:channel-seen", await supabase
      .from("channel_order_imports").select("channel_order_no")
      .eq("company_id", companyId).eq("channel", channel).in("channel_order_no", nos.slice(i, i + 200)));
    for (const r of ((data || []) as any[])) seen.add(r.channel_order_no);
  }
  return seen;
}

export type ChannelDocLine = {
  product_id: string; qty: number; unit_price: number | null; vat_amount: number | null;
  channel_order_no: string; channel_product_id: string; buyer_name: string | null; order_date?: string | null;
  recipient_name?: string | null; recipient_phone?: string | null; address?: string | null; shipping_note?: string | null; recipient_zip?: string | null;
};

/**
 * 격자의 줄을 판매 출고 한 건으로 등록하고 주문번호를 적어 둔다.
 *   ★ 저장 직전에 주문번호를 **다시** 확인한다 — 화면에 깔린 뒤 다른 사람이 같은 주문을 등록했을 수 있다(결정 17).
 *   이미 등록된 주문번호의 줄은 건너뛰고 몇 줄인지 돌려준다.
 */
export async function importChannelDoc(
  companyId: string, channel: string, warehouseId: string, docDate: string, note: string | null,
  lines: ChannelDocLine[], userId?: string | null,
) {
  const seen = await listSeenOrderNos(companyId, channel, lines.map((l) => l.channel_order_no));
  const use = lines.filter((l) => l.product_id && Number(l.qty) !== 0 && !seen.has(l.channel_order_no.trim()));
  const skipped = lines.length - use.length;
  if (!use.length) throw new Error(skipped ? "모두 이미 등록된 주문번호입니다" : "등록할 줄이 없습니다");

  const orderNos = new Set(use.map((r) => r.channel_order_no.trim()));
  const doc = await createStockDoc(companyId, {
    reason: "sale", docDate, warehouseId,
    note: [note, `${channelLabel(channel)} 주문 ${orderNos.size}건`].filter(Boolean).join(" · "),
    lines: use.map((r) => ({
      product_id: r.product_id, qty: Number(r.qty),
      unit_price: r.unit_price ?? null, vat_amount: r.vat_amount ?? null,
      note: `${channelLabel(channel)} ${r.channel_order_no.trim()}`,
    })),
  }, userId);

  const first = new Map<string, ChannelDocLine>();
  const amount = new Map<string, number>();
  for (const r of use) {
    const no = r.channel_order_no.trim();
    if (!first.has(no)) first.set(no, r);
    amount.set(no, (amount.get(no) || 0) + (r.unit_price != null ? Number(r.unit_price) * Number(r.qty) : 0));
  }
  const { error } = await supabase.from("channel_order_imports").insert(
    [...first.entries()].map(([no, r]) => ({
      company_id: companyId, channel, channel_order_no: no,
      order_date: r.order_date || docDate, buyer_name: r.buyer_name || null,
      recipient_name: r.recipient_name || null, recipient_phone: r.recipient_phone || null,
      address: r.address || null, shipping_note: r.shipping_note || null, recipient_zip: r.recipient_zip || null,
      amount: amount.get(no) || null, doc_id: doc.id, imported_by: userId ?? null,
    })),
  );
  if (error) {
    //   기록이 실패하면 다음에 또 넣을 수 있게 된다 → 출고를 되돌린다(결정 17)
    await supabase.from("stock_moves").delete().eq("doc_id", doc.id);
    await supabase.from("stock_docs").delete().eq("id", doc.id);
    throw error;
  }
  return { docNo: doc.docNo, lines: use.length, orders: first.size, skipped };
}

/** 채널 API 에서 주문을 받아 온다 — 서버가 회사 키로 부른다. 재고에는 넣지 않는다. */
export async function fetchChannelOrders(channel: string, from: string, to: string): Promise<
  { ok: true; rows: (RawOrderRow & { product_name?: string | null })[] } | { ok: false; message: string; noKey?: boolean; noApi?: boolean }
> {
  const res = await fetch("/api/integrations/channel-orders", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ channel, from, to }),
  });
  const body = await res.json().catch(() => ({}));
  if (!body.ok) return { ok: false, message: String(body.message || "가져오지 못했습니다"), noKey: !!body.noKey, noApi: !!body.noApi };
  return { ok: true, rows: body.rows || [] };
}

export const CHANNEL_HAS_API = new Set(["smartstore", "coupang"]);


// ── 출고 처리 · 송장 (2026-08-26 사장님 지시 ②) ────────────────────────────────
/** 발송·완료·되돌리기 — 상태와 함께 시각·사람을 남긴다 */
export async function updateShipping(
  ids: string[], patch: { ship_status: ShipStatus; carrier?: string | null; tracking_no?: string | null }, userId?: string | null,
) {
  if (!ids.length) return;
  const now = new Date().toISOString();
  const row: Partial<{ ship_status: string; carrier: string | null; tracking_no: string | null; shipped_at: string | null; shipped_by: string | null; delivered_at: string | null }> = { ship_status: patch.ship_status };
  if ("carrier" in patch) row.carrier = patch.carrier ?? null;
  if ("tracking_no" in patch) row.tracking_no = patch.tracking_no?.trim() || null;
  if (patch.ship_status === "shipped") { row.shipped_at = now; row.shipped_by = userId ?? null; row.delivered_at = null; }
  if (patch.ship_status === "done") row.delivered_at = now;
  if (patch.ship_status === "pending") { row.shipped_at = null; row.shipped_by = null; row.delivered_at = null; }
  const { error } = await supabase.from("channel_order_imports").update(row).in("id", ids);
  if (error) throw error;
}

/** 주문별 상품 — 출고 전표 줄의 비고("채널명 주문번호")로 주문번호를 되찾는다. 열쇠 `채널|주문번호` */
export async function listImportItems(
  companyId: string, docIds: string[], products: { id: string; name: string }[],
): Promise<Map<string, { name: string; qty: number }[]>> {
  const out = new Map<string, { name: string; qty: number }[]>();
  if (!companyId || !docIds.length) return out;
  const nameOf = new Map(products.map((p) => [p.id, p.name]));
  const labelToValue = new Map<string, string>(CHANNELS.map((c) => [c.label, c.value]));
  for (let i = 0; i < docIds.length; i += 200) {
    const data = logRead("inventory:channel-items", await supabase
      .from("stock_moves").select("product_id, qty, note").eq("company_id", companyId).in("doc_id", docIds.slice(i, i + 200)));
    for (const m of ((data || []) as any[])) {
      const note = String(m.note || "");
      const sp = note.indexOf(" ");
      if (sp < 0) continue;
      const ch = labelToValue.get(note.slice(0, sp));
      if (!ch) continue;
      const key = `${ch}|${note.slice(sp + 1).trim()}`;
      out.set(key, [...(out.get(key) || []), { name: nameOf.get(m.product_id) || "?", qty: Math.abs(Number(m.qty || 0)) }]);
    }
  }
  return out;
}


// ── 택배 송장 양식 (2026-08-26 사장님 지시 — "택배사가 다양하니 모든 택배사 양식을 고를 수 있게") ─────
//   ① 표준 양식: 주요 택배사 일괄등록 엑셀의 열 순서를 시작점으로 둔다. ⚠ 택배사가 양식을 바꾸기도 하므로
//      처음 한 번 택배사 프로그램에 올려 보고, 안 맞으면 '내 양식'으로 복사해 열을 고친다.
//   ② 내 양식: 회사가 열을 고르고 순서·머리글을 정해 저장(shipping_sheet_layouts). 어느 택배사든 대응.
export type SheetKey = "order_no" | "channel" | "recipient" | "phone" | "phone2" | "zip" | "address" | "product" | "qty"
  | "memo" | "buyer" | "buyer_phone" | "order_date" | "amount" | "box" | "blank";
export const SHEET_FIELDS: { key: SheetKey; label: string; desc?: string }[] = [
  { key: "order_no", label: "주문번호" }, { key: "channel", label: "채널" },
  { key: "recipient", label: "수취인" }, { key: "phone", label: "수취인 연락처" }, { key: "phone2", label: "기타 연락처", desc: "없으면 수취인 연락처를 다시 씁니다" },
  { key: "zip", label: "우편번호" }, { key: "address", label: "주소" },
  { key: "product", label: "상품", desc: "여러 상품이면 쉼표로 이어 씁니다" }, { key: "qty", label: "수량", desc: "상품 수량 합" }, { key: "box", label: "박스 수량", desc: "항상 1" },
  { key: "memo", label: "배송 메시지" }, { key: "buyer", label: "주문자" }, { key: "buyer_phone", label: "주문자 연락처", desc: "채널이 안 주면 수취인 연락처" },
  { key: "order_date", label: "주문일" }, { key: "amount", label: "금액" }, { key: "blank", label: "(빈 칸)", desc: "양식의 자리 맞춤용" },
];
export type SheetColumn = { key: SheetKey; label: string };
export type SheetLayout = { id: string; name: string; columns: SheetColumn[]; builtin?: boolean };
const C = (key: SheetKey, label: string): SheetColumn => ({ key, label });
export const CARRIER_SHEETS: SheetLayout[] = [
  { id: "std", name: "공통 (오너뷰 기본)", builtin: true, columns: [C("order_no", "주문번호"), C("channel", "채널"), C("recipient", "수취인"), C("phone", "연락처"), C("zip", "우편번호"), C("address", "주소"), C("product", "상품"), C("qty", "수량"), C("memo", "배송 메시지"), C("buyer", "주문자"), C("order_date", "주문일")] },
  { id: "cj", name: "CJ대한통운 (일괄등록)", builtin: true, columns: [C("recipient", "받는분성명"), C("phone", "받는분전화번호"), C("phone2", "받는분기타연락처"), C("zip", "받는분우편번호"), C("address", "받는분주소(전체, 분할)"), C("product", "품목명"), C("box", "박스수량"), C("memo", "배송메세지1"), C("order_no", "주문번호")] },
  { id: "hanjin", name: "한진택배 (엑셀 업로드)", builtin: true, columns: [C("order_no", "주문번호"), C("recipient", "수하인명"), C("phone", "수하인전화"), C("phone2", "수하인핸드폰"), C("zip", "수하인우편번호"), C("address", "수하인주소"), C("product", "상품명"), C("qty", "수량"), C("memo", "배송메세지")] },
  { id: "lotte", name: "롯데택배 (엑셀 업로드)", builtin: true, columns: [C("order_no", "주문번호"), C("recipient", "받는분"), C("phone", "받는분 전화"), C("phone2", "받는분 핸드폰"), C("zip", "받는분 우편번호"), C("address", "받는분 주소"), C("product", "품목명"), C("qty", "수량"), C("memo", "배송 메시지")] },
  { id: "post", name: "우체국택배 (계약소포 엑셀)", builtin: true, columns: [C("recipient", "받는분 성명"), C("zip", "받는분 우편번호"), C("address", "받는분 주소"), C("phone", "받는분 전화번호"), C("phone2", "받는분 휴대전화"), C("memo", "배송 메시지"), C("product", "내용품"), C("qty", "수량"), C("order_no", "주문번호")] },
  { id: "logen", name: "로젠택배 (엑셀 등록)", builtin: true, columns: [C("order_no", "주문번호"), C("recipient", "수하인"), C("phone", "수하인 전화"), C("phone2", "수하인 휴대폰"), C("zip", "우편번호"), C("address", "수하인 주소"), C("product", "품목"), C("qty", "수량"), C("memo", "배송 메시지")] },
  { id: "kd", name: "경동택배 (엑셀 등록)", builtin: true, columns: [C("recipient", "수하인명"), C("phone", "수하인 전화"), C("zip", "우편번호"), C("address", "수하인 주소"), C("product", "품목"), C("qty", "수량"), C("memo", "메모"), C("order_no", "주문번호")] },
];

export async function listSheetLayouts(companyId: string): Promise<SheetLayout[]> {
  if (!companyId) return [];
  const data = logRead("inventory:sheet-layouts", await supabase
    .from("shipping_sheet_layouts").select("id, name, columns").eq("company_id", companyId).order("name"));
  return ((data || []) as any[]).map((r) => ({ id: r.id, name: r.name, columns: (r.columns || []) as SheetColumn[] }));
}
export async function saveSheetLayout(companyId: string, layout: { id?: string; name: string; columns: SheetColumn[] }, userId?: string | null) {
  const name = layout.name.trim();
  if (!name) throw new Error("양식 이름을 입력하세요");
  if (!layout.columns.length) throw new Error("열을 하나 이상 넣으세요");
  const row = { company_id: companyId, name, columns: layout.columns, updated_at: new Date().toISOString() };
  const { error } = layout.id
    ? await supabase.from("shipping_sheet_layouts").update(row).eq("id", layout.id)
    : await supabase.from("shipping_sheet_layouts").insert({ ...row, created_by: userId ?? null });
  if (error) throw error;
}
export async function deleteSheetLayout(id: string) {
  const { error } = await supabase.from("shipping_sheet_layouts").delete().eq("id", id);
  if (error) throw error;
}

/** 주문 한 건을 양식 열에 맞춰 한 줄로 */
export function sheetRow(i: OrderImport, items: { name: string; qty: number }[], columns: SheetColumn[]): Record<string, unknown> {
  const val = (k: SheetKey): unknown => {
    switch (k) {
      case "order_no": return i.channel_order_no;
      case "channel": return channelLabel(i.channel);
      case "recipient": return i.recipient_name || i.buyer_name || "";
      case "phone": return i.recipient_phone || "";
      case "phone2": return i.recipient_phone || "";
      case "zip": return i.recipient_zip || "";
      case "address": return i.address || "";
      case "product": return items.map((x) => `${x.name} ×${x.qty}`).join(", ");
      case "qty": return items.reduce((n, x) => n + x.qty, 0);
      case "box": return 1;
      case "memo": return i.shipping_note || "";
      case "buyer": return i.buyer_name || "";
      case "buyer_phone": return i.recipient_phone || "";
      case "order_date": return i.order_date || "";
      case "amount": return i.amount ?? "";
      default: return "";
    }
  };
  const out: Record<string, unknown> = {};
  columns.forEach((c, n) => { out[c.label || `열${n + 1}`] = val(c.key); });
  return out;
}
