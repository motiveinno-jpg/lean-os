"use client";

// ── 재고 — 주문서와 입력 양식 (2026-08-25 사장님 지시) ─────────────────────────
//   ★ 결정 20 — 주문서는 표가 하나다. 판매·구매·생산이 같은 문서를 불러간다.
//   ★ 결정 21 — **주문은 재고에 아무 영향이 없다.** 재고는 불러와 저장할 때만 움직인다.
//   ★ 결정 22 — 회사가 만든 칸의 값은 `custom` jsonb 에 **칸 열쇠(field_id)를 키로** 담는다.
//     이름을 바꿔도("현장" → "현장명") 값이 안 흔들리고, 열쇠로 찾을 수 있다.
//   ★ 결정 24 — 양식은 **회사 하나에 하나**(사장님 지시). 사람마다 다르면 같은 주문서를 둘이 다르게 본다.
//     행이 없으면 아래 기본 양식을 쓴다 — 손대는 순간 그 회사 행이 생긴다.

import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";
import { fetchPaged } from "@/lib/fetch-paged";
import { todayKst } from "@/lib/kst";

export type FormKey = "order" | "sale" | "buy" | "make" | "channel";
export type Section = "head" | "line";

export const FORM_LABEL: Record<FormKey, string> = {
  order: "주문서", sale: "판매", buy: "구매", make: "생산",
  channel: "채널 주문",
};

/** 칸 하나 — `lock` 은 끌 수 없는 칸(없으면 전표가 서지 않는다). */
export type Field = {
  field_id: string; name: string; on: boolean; custom: boolean;
  lock?: boolean; why?: string;
};

//   기본 양식 — 회사가 손대기 전까지 이걸 쓴다.
//   ★ 빈 칸을 미리 깔지 않는다(이카운트의 '문자형식1·2·3'). 쓰는 칸만 켜고, 만들 땐 이름부터 짓는다.
function baseHead(): Field[] {
  return [
    { field_id: "date",    name: "일자",   on: true,  custom: false, lock: true, why: "전표의 날짜" },
    { field_id: "partner", name: "거래처", on: true,  custom: false, why: "거래 상대 — 없어도 저장됩니다" },
    { field_id: "wh",      name: "창고",   on: true,  custom: false, why: "기본 창고가 자동으로 선택됩니다" },
    { field_id: "staff",   name: "담당자", on: false, custom: false, why: "담당 직원" },
    { field_id: "due",     name: "납기일", on: false, custom: false, why: "납품 예정일" },
    { field_id: "note",    name: "비고",   on: false, custom: false, why: "전표 전체에 대한 메모" },
  ];
}
function baseLine(): Field[] {
  return [
    { field_id: "sku",    name: "품목",     on: true,  custom: false, lock: true, why: "거래할 품목" },
    { field_id: "spec",   name: "규격",     on: true,  custom: false, why: "품목 정보에서 자동 입력" },
    { field_id: "qty",    name: "수량",     on: true,  custom: false, lock: true, why: "거래 수량" },
    //   생산 양식에만 — 만들었지만 팔 수 없는 수량. 불량 보류 창고로 들어간다(결정 28·30, 2026-08-26)
    { field_id: "defect", name: "불량",     on: true,  custom: false, why: "만들었지만 팔 수 없는 수량 — 불량 보류 창고로 들어갑니다. 자재는 양품+불량 기준으로 나갑니다" },
    { field_id: "price",  name: "단가",     on: false, custom: false, why: "수량과 공급가액으로 자동 계산" },
    { field_id: "supply", name: "공급가액", on: true,  custom: false, lock: true, why: "세금 전 금액" },
    { field_id: "vat",    name: "부가세",   on: true,  custom: false, why: "공급가액의 10% 자동 계산" },
    { field_id: "lnote",  name: "품목 비고", on: false, custom: false, why: "해당 품목에 대한 메모" },
    //   채널 주문 양식에만 쓰는 칸 — 다른 양식에서는 defaultLayout 이 빼 버린다
    { field_id: "ch",     name: "채널",         on: true,  custom: false, lock: true, why: "붙여넣기·가져오기가 정합니다 — 바꿀 수 없습니다" },
    { field_id: "ono",    name: "주문번호",     on: true,  custom: false, lock: true, why: "채널 주문번호 — 같은 번호는 두 번 등록되지 않습니다" },
    { field_id: "ccode",  name: "채널 상품코드", on: true,  custom: false, why: "상품 연결에 등록된 코드면 품목이 자동으로 채워집니다" },
    { field_id: "buyer",  name: "주문자",       on: true,  custom: false, why: "채널 주문자 이름" },
    { field_id: "rcv",    name: "수취인",       on: true,  custom: false, why: "받는 사람 — 송장에 찍힙니다" },
    { field_id: "tel",    name: "연락처",       on: true,  custom: false, why: "수취인 연락처" },
    { field_id: "zip",    name: "우편번호",     on: false, custom: false, why: "택배 양식에 우편번호 열이 있을 때 켭니다" },
    { field_id: "addr",   name: "주소",         on: true,  custom: false, why: "배송 주소" },
    { field_id: "memo",   name: "배송 요청",    on: true,  custom: false, why: "채널에서 온 배송 요청사항" },
  ];
}

//   양식마다 처음부터 조금 다르다 — 같은 화면이 아니라는 것이 눈에 보이게
/** 채널 주문 양식에만 있는 줄 칸 */
export const CH_ONLY = ["ch", "ono", "ccode", "buyer", "rcv", "tel", "zip", "addr", "memo"];
/** 생산 양식에만 있는 줄 칸 */
export const MAKE_ONLY = ["defect"];

export function defaultLayout(form: FormKey): { head: Field[]; line: Field[] } {
  const head = baseHead(), line = baseLine();
  if (form === "order") {
    head[4].on = true;                          // 주문서엔 납기일
    head[5].on = true;                          // 주문서엔 비고
    line[6].on = true;                          // 주문서엔 품목 비고
  }
  if (form === "buy") { head[4].name = "입고예정일"; head[4].on = true; }
  //   ★ 생산은 **안에서 만드는 일**이라 거래처도 계산서도 없다(4단계 결정) — 칸을 꺼 둔다.
  //     쓰고 싶은 회사는 양식 고치기에서 켜면 된다.
  if (form === "make") {
    head[1].on = false;
    const q = line.find((f) => f.field_id === "qty")!; q.name = "양품"; q.why = "팔 수 있게 완성된 수량 — 고른 창고로 들어갑니다";
  } else {
    for (const id of MAKE_ONLY) { const f = line.find((x) => x.field_id === id); if (f) f.on = false; }
  }
  //   ★ 채널 주문 — 주문번호·채널 상품코드·주문자가 앞뒤에 서고 거래처는 없다(채널이 거래처다). 창고·비고는 그대로.
  if (form === "channel") {
    head[1].on = false; head[5].on = true;
    const pick = (id: string) => line.find((f) => f.field_id === id)!;
    const rest = line.filter((f) => !CH_ONLY.includes(f.field_id) && !MAKE_ONLY.includes(f.field_id));
    rest.find((f) => f.field_id === "price")!.on = true;
    return { head, line: [pick("ch"), pick("ono"), pick("ccode"), ...rest, pick("buyer"), pick("rcv"), pick("tel"), pick("zip"), pick("addr"), pick("memo")] };
  }
  return { head, line: line.filter((f) => !CH_ONLY.includes(f.field_id) && (form === "make" || !MAKE_ONLY.includes(f.field_id))) };
}

export type Layout = { head: Field[]; line: Field[] };

/** 회사의 양식을 읽는다 — 저장된 행이 있으면 그것이, 없으면 기본값이 이긴다. */
export async function loadLayout(companyId: string, form: FormKey): Promise<Layout> {
  const def = defaultLayout(form);
  if (!companyId) return def;
  const data = logRead("inventory:form-layout", await supabase
    .from("form_layouts").select("section, field_id, name, sort_no, is_on, is_custom")
    .eq("company_id", companyId).eq("form_key", form).order("sort_no"));
  const rows = (data || []) as any[];
  if (!rows.length) return def;

  const apply = (base: Field[], section: Section): Field[] => {
    const mine = rows.filter((r) => r.section === section);
    const byId = new Map(mine.map((r) => [r.field_id, r]));
    //   기본 칸은 자리를 지키고, 저장된 값(이름·켜짐)만 덮어쓴다
    const out = base.map((f) => {
      const r = byId.get(f.field_id);
      return r ? { ...f, name: r.name, on: r.is_on } : f;
    });
    //   회사가 만든 칸은 뒤에 붙인다
    for (const r of mine) {
      if (base.some((f) => f.field_id === r.field_id)) continue;
      out.push({ field_id: r.field_id, name: r.name, on: r.is_on, custom: !!r.is_custom });
    }
    return out;
  };
  return { head: apply(def.head, "head"), line: apply(def.line, "line") };
}

/** 양식을 통째로 저장한다 — 회사 하나에 하나라 사람 구분이 없다(결정 24). */
export async function saveLayout(companyId: string, form: FormKey, layout: Layout, userId?: string | null) {
  const rows: any[] = [];
  (["head", "line"] as Section[]).forEach((section) => {
    layout[section].forEach((f, i) => {
      rows.push({
        company_id: companyId, form_key: form, section, field_id: f.field_id,
        name: f.name, sort_no: i, is_on: f.on, is_custom: f.custom,
        updated_by: userId ?? null, updated_at: new Date().toISOString(),
      });
    });
  });
  const { error } = await supabase.from("form_layouts")
    .upsert(rows, { onConflict: "company_id,form_key,section,field_id" });
  if (error) throw error;

  //   지운 칸은 행도 지운다 — 안 그러면 다음에 읽을 때 되살아난다
  const keep = rows.map((r) => r.field_id);
  const { error: delErr } = await supabase.from("form_layouts")
    .delete().eq("company_id", companyId).eq("form_key", form).not("field_id", "in", `(${keep.map((k) => `"${k}"`).join(",")})`);
  if (delErr) throw delErr;
}

export async function resetLayout(companyId: string, form: FormKey) {
  const { error } = await supabase.from("form_layouts")
    .delete().eq("company_id", companyId).eq("form_key", form);
  if (error) throw error;
}

/** 새 칸의 열쇠 — 이름과 따로 둬야 이름을 바꿔도 값이 안 흔들린다(결정 22). */
export function newFieldId() {
  return "f_" + Math.random().toString(36).slice(2, 8);
}

// ── 주문서 ────────────────────────────────────────────────────────────────────
export type Order = {
  id: string; order_no: string; order_date: string; due_date: string | null;
  partner_id: string | null; partner_name: string | null; warehouse_id: string | null;
  status: "open" | "closed" | "cancelled"; note: string | null;
  custom: Record<string, string>; created_at: string;
};
export type OrderLine = {
  id: string; order_id: string; product_id: string; qty: number;
  unit_price: number | null; supply_amount: number; vat_amount: number;
  note: string | null; custom: Record<string, string>; sort_no: number;
};
export type LineUsed = { order_id: string; order_line_id: string; ordered_qty: number; used_qty: number };

export async function listOrders(companyId: string, from: string, to: string): Promise<Order[]> {
  if (!companyId) return [];
  const data = await fetchPaged<any>("inventory:orders", () => supabase
    .from("orders")
    .select("id, order_no, order_date, due_date, partner_id, partner_name, warehouse_id, status, note, custom, created_at")
    .eq("company_id", companyId).gte("order_date", from).lte("order_date", to)
    .order("order_date", { ascending: false }).order("created_at", { ascending: false })
    .order("id"), 50000);
  return ((data || []) as any[]).map((r) => ({ ...r, custom: r.custom || {} })) as Order[];
}

export async function listOrderLines(orderId: string): Promise<OrderLine[]> {
  if (!orderId) return [];
  const data = logRead("inventory:order-lines", await supabase
    .from("order_lines").select("id, order_id, product_id, qty, unit_price, supply_amount, vat_amount, note, custom, sort_no")
    .eq("order_id", orderId).order("sort_no").order("created_at"));
  return ((data || []) as any[]).map((r) => ({
    ...r, qty: Number(r.qty || 0),
    unit_price: r.unit_price == null ? null : Number(r.unit_price),
    supply_amount: Number(r.supply_amount || 0), vat_amount: Number(r.vat_amount || 0),
    custom: r.custom || {},
  })) as OrderLine[];
}

/** 여러 주문서의 줄을 한 번에 — 현황 집계용(주문서마다 따로 부르면 N번 왕복) */
export async function listOrderLinesAll(companyId: string, orderIds: string[]): Promise<OrderLine[]> {
  if (!companyId || !orderIds.length) return [];
  const out: OrderLine[] = [];
  for (let i = 0; i < orderIds.length; i += 200) {
    const data = logRead("inventory:order-lines-all", await supabase
      .from("order_lines").select("id, order_id, product_id, qty, unit_price, supply_amount, vat_amount, note, custom, sort_no")
      .eq("company_id", companyId).in("order_id", orderIds.slice(i, i + 200)));
    for (const r of ((data || []) as any[])) out.push({
      ...r, qty: Number(r.qty || 0), unit_price: r.unit_price == null ? null : Number(r.unit_price),
      supply_amount: Number(r.supply_amount || 0), vat_amount: Number(r.vat_amount || 0), custom: r.custom || {},
    });
  }
  return out;
}

/** 주문 줄이 얼마나 쓰였나 — 판매·구매·생산이 가져간 만큼(붙은 재고 기록의 절대값 합). */
export async function listUsed(companyId: string, orderIds?: string[]): Promise<LineUsed[]> {
  if (!companyId) return [];
  let qb = supabase.from("v_order_line_used")
    .select("order_id, order_line_id, ordered_qty, used_qty").eq("company_id", companyId);
  if (orderIds && orderIds.length) qb = qb.in("order_id", orderIds);
  const data = logRead("inventory:order-used", await qb);
  return ((data || []) as any[]).filter((r) => r.order_line_id).map((r) => ({
    order_id: r.order_id, order_line_id: r.order_line_id,
    ordered_qty: Number(r.ordered_qty || 0), used_qty: Number(r.used_qty || 0),
  }));
}

export type OrderInput = {
  orderDate?: string; dueDate?: string | null;
  partnerId?: string | null; partnerName?: string | null;
  warehouseId?: string | null; note?: string | null;
  custom?: Record<string, string>;
  lines: {
    product_id: string; qty: number; unit_price?: number | null;
    supply_amount?: number; vat_amount?: number; note?: string | null;
    custom?: Record<string, string>;
  }[];
};

export async function saveOrder(
  companyId: string, input: OrderInput, userId?: string | null, orderId?: string | null,
): Promise<{ id: string; orderNo: string }> {
  const orderDate = input.orderDate || todayKst();
  const lines = input.lines.filter((l) => l.product_id && Number(l.qty) > 0);
  if (!lines.length) throw new Error("입력된 항목이 없습니다");

  const head = {
    company_id: companyId, order_date: orderDate, due_date: input.dueDate || null,
    partner_id: input.partnerId || null, partner_name: input.partnerName?.trim() || null,
    warehouse_id: input.warehouseId || null, note: input.note?.trim() || null,
    custom: input.custom || {}, updated_at: new Date().toISOString(),
  };

  let id = orderId || null, orderNo = "";
  if (id) {
    const { error } = await supabase.from("orders").update(head).eq("id", id);
    if (error) throw error;
    const { data } = await supabase.from("orders").select("order_no").eq("id", id).single();
    orderNo = (data as { order_no: string } | null)?.order_no || "";
    //   줄은 지우고 다시 넣는다 — 다만 **재고가 붙은 줄은 지우지 않는다**(붙은 기록이 끊긴다).
    const used = (await listUsed(companyId, [id])).filter((u) => u.used_qty !== 0).map((u) => u.order_line_id);
    let del = supabase.from("order_lines").delete().eq("order_id", id);
    if (used.length) del = del.not("id", "in", `(${used.map((u) => `"${u}"`).join(",")})`);
    const { error: dErr } = await del;
    if (dErr) throw dErr;
  } else {
    const ymd = orderDate.replace(/-/g, "").slice(2);
    const { count } = await supabase.from("orders")
      .select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("order_date", orderDate);
    orderNo = `SO-${ymd}-${String((count || 0) + 1).padStart(2, "0")}`;
    const { data, error } = await supabase.from("orders")
      .insert({ ...head, order_no: orderNo, status: "open", created_by: userId ?? null })
      .select("id").single();
    if (error) throw error;
    id = (data as { id: string }).id;
  }

  const { error: lErr } = await supabase.from("order_lines").insert(
    lines.map((l, i) => ({
      company_id: companyId, order_id: id!, product_id: l.product_id,
      qty: Number(l.qty), unit_price: l.unit_price ?? null,
      supply_amount: Number(l.supply_amount || 0), vat_amount: Number(l.vat_amount || 0),
      note: l.note?.trim() || null, custom: l.custom || {}, sort_no: i,
    })),
  );
  if (lErr) throw lErr;
  return { id: id!, orderNo };
}

export async function deleteOrder(companyId: string, orderId: string) {
  //   가져간 것이 있으면 못 지운다 — 재고는 움직였는데 근거만 사라지면 장부가 거짓말을 한다.
  const used = (await listUsed(companyId, [orderId])).reduce((n, u) => n + u.used_qty, 0);
  if (used !== 0) throw new Error("판매·구매·생산에서 이미 사용한 항목이 있습니다 — 해당 전표를 먼저 삭제하세요");
  const { error } = await supabase.from("orders").delete().eq("id", orderId);
  if (error) throw error;
}
