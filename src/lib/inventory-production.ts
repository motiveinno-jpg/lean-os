"use client";

// ── 재고 4단계 — 생산(자재구성 · 완성 기록) (2026-08-25 사장님 지시) ─────────────
//   ★ 결정 14 — 완성 한 번에 **두 문서**를 세운다: 자재 출고(MTL) + 완제품 입고(PRD).
//     둘 중 하나만 서면 그 순간 재고가 거짓말을 한다. 그래서 자재 문서가 실패하면 완제품도 되돌린다.
//   ★ 결정 15 — BOM 이 없으면 자재를 빼지 않는다. 없는 걸 지어내지 않는다.
//   ★ 결정 16 — 자재가 모자라도 막지 않는다(결정 7). 이미 만든 것을 못 적게 하면 장부를 포기한다.

import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";
import { todayKst } from "@/lib/kst";
import { createStockDoc, updateStockDoc, cancelStockDoc, type MoveLine, ensureDefectWarehouse } from "@/lib/inventory";

export type BomLine = {
  id: string; product_id: string; component_id: string; qty: number; note: string | null;
  /** 기준 수량 — 소요량(qty)은 완제품 base_qty 개당. 소비 = qty / base_qty × 완성 수량 */
  base_qty: number;
};
/** 자재 부족 — 완제품 줄(product_id·qty) × 자재구성 을 창고 현재고와 견준다. 부족한 자재만 돌려준다. */
export function materialShortages(
  lines: { product_id: string; qty: number }[], boms: BomLine[],
  onhand: { product_id: string; warehouse_id: string; qty: number }[], warehouseId: string | null,
): { component_id: string; need: number; have: number }[] {
  const need = new Map<string, number>();
  for (const l of lines) for (const b of boms) if (b.product_id === l.product_id && b.qty > 0) need.set(b.component_id, (need.get(b.component_id) || 0) + perUnit(b) * Number(l.qty));
  const have = new Map<string, number>();
  for (const o of onhand) if (!warehouseId || o.warehouse_id === warehouseId) have.set(o.product_id, (have.get(o.product_id) || 0) + Number(o.qty));
  return [...need.entries()].map(([id, n]) => ({ component_id: id, need: n, have: have.get(id) || 0 })).filter((x) => x.have < x.need);
}
/** 완제품 1개당 소요량 */
export const perUnit = (b: BomLine) => b.qty / (b.base_qty > 0 ? b.base_qty : 1);

// ── 로스·불량 (결정 28~31, 2026-08-26 사장님 "추천대로") ──────────────────────
//   ★ 완성 기록은 세 숫자 — 투입 기준(=양품+불량)·양품·불량. 자재 표준 = BOM × 투입 기준.
//   ★ 로스 = 실투입 − 표준. 별도 문서 없이 자재 투입 줄에 std_qty 로 남는다. 원인은 넷으로 고정.
//   ★ 불량은 '불량 보류' 창고로 입고(재고는 사실이다). 처분(재작업·폐기·B급 판매)은 나중에 사람이.
//   ★ 원가 제안 = 실투입 자재비 ÷ (양품+불량). 로스는 원가에, 불량은 폐기 때 손실로.
export const LOSS_REASONS = [
  { value: "spill", label: "흘림" }, { value: "scrap", label: "자투리" },
  { value: "bad_material", label: "불량 자재" }, { value: "other", label: "기타" },
] as const;
export const lossReasonLabel = (v: string | null | undefined) => LOSS_REASONS.find((r) => r.value === v)?.label ?? "";
/** 사람이 고친 실투입 — 완제품별·자재별. qty 가 실투입, std_qty 가 표준. */
export type MatInput = { product_id: string; component_id: string; qty: number; std_qty: number; loss_reason?: string | null };
export type ProduceLine = {
  product_id: string; qty: number; defect_qty?: number | null; unit_price?: number | null; vat_amount?: number | null;
  note?: string | null; order_line_id?: string | null;
};
const totalQty = (l: { qty: number; defect_qty?: number | null }) => Number(l.qty) + Number(l.defect_qty || 0);
/** 표준 자재 소요 — 완제품 줄(양품+불량) × 자재구성. 실투입 입력(materials)이 있으면 그것이 이긴다. */
export function standardMaterials(lines: ProduceLine[], bomLines: BomLine[]): MatInput[] {
  const out: MatInput[] = [];
  for (const l of lines) for (const b of bomLines) {
    if (b.product_id !== l.product_id || !(b.qty > 0)) continue;
    const std = perUnit(b) * totalQty(l);
    out.push({ product_id: l.product_id, component_id: b.component_id, qty: std, std_qty: std });
  }
  return out;
}
// ── 자재구성 ──────────────────────────────────────────────────────────────────
export async function listBoms(companyId: string): Promise<BomLine[]> {
  if (!companyId) return [];
  const data = logRead("inventory:boms", await supabase
    .from("product_boms").select("id, product_id, component_id, qty, note, base_qty")
    .eq("company_id", companyId).limit(5000));
  return ((data || []) as any[]).map((r) => ({ ...r, qty: Number(r.qty || 0), base_qty: Number(r.base_qty || 1) })) as BomLine[];
}

export async function upsertBomLine(companyId: string, line: { id?: string; product_id: string; component_id: string; qty: number; base_qty?: number; note?: string | null }) {
  if (line.product_id === line.component_id) throw new Error("자기 자신을 자재로 넣을 수 없습니다");
  if (!(Number(line.qty) > 0)) throw new Error("소요량은 0보다 커야 합니다");
  if (line.base_qty != null && !(Number(line.base_qty) > 0)) throw new Error("기준 수량은 0보다 커야 합니다");
  const row = {
    company_id: companyId, product_id: line.product_id, component_id: line.component_id,
    qty: Number(line.qty), base_qty: Number(line.base_qty || 1), note: line.note?.trim() || null, updated_at: new Date().toISOString(),
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

// ── 격자에서 바로 완성 기록 (2026-08-25 사장님 지시) ──────────────────────────
//   작업지시를 따로 두지 않는다 — **주문서가 그 자리**다. 격자에 완제품 줄을 치고 저장하면
//   ★ 완제품 입고(PRD) + 자재 출고(MTL) **두 문서가 같이** 선다(결정 14).
//     자재 문서가 실패하면 완제품도 지운다 — 반쪽만 남으면 재고가 거짓말을 한다.
export async function produceLines(
  companyId: string,
  input: {
    docDate?: string; warehouseId: string; note?: string | null; orderId?: string | null;
    lines: ProduceLine[];
    /** 사람이 고친 실투입(자재 소요 팝업). 없으면 표준(BOM × 양품+불량) */
    materials?: MatInput[] | null;
  },
  bomLines: BomLine[],
  userId?: string | null,
) {
  const use = input.lines.filter((l) => l.product_id && totalQty(l) !== 0);
  if (!use.length) throw new Error("완성 수량이 입력되지 않았습니다");
  const docDate = input.docDate || todayKst();

  //   ① 완제품 — 이게 결과다. 양품은 고른 창고, 불량은 불량 보류 창고(결정 30). 단가는 둘 다 같다(결정 31).
  const prod = await createStockDoc(companyId, {
    reason: "produce", docDate, warehouseId: input.warehouseId,
    orderId: input.orderId || null, note: input.note ?? null,
    lines: await prodLinesOf(companyId, use),
  }, userId);

  //   ② 자재 — 자재구성이 있는 줄만. 완제품이 음수(되돌림)면 자재도 반대로 돌아온다.
  const mats = matLinesOf(use, bomLines, input.materials);

  let matDocNo: string | null = null;
  if (mats.length) {
    try {
      const mat = await createStockDoc(companyId, {
        reason: "consume", docDate, warehouseId: input.warehouseId,
        //   ★ 완제품 문서를 가리켜 둔다 — 수정·취소할 때 짝을 찾아 같이 움직인다(3순위)
        orderId: input.orderId || null, originalDocId: prod.id, note: `${prod.docNo} 자재 투입`, lines: mats,
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


//   완제품 문서의 짝(자재 투입 문서) — original_doc_id 로 찾는다. 살아 있는 것만.
async function findMatDoc(prodDocId: string): Promise<string | null> {
  const { data } = await supabase.from("stock_docs").select("id")
    .eq("original_doc_id", prodDocId).eq("reason", "consume").eq("status", "active").limit(1).maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

function matLinesOf(lines: ProduceLine[], bomLines: BomLine[], materials?: MatInput[] | null): MoveLine[] {
  //   실투입이 들어왔으면 격자에 남아 있는 완제품의 것만 쓴다(지운 줄의 자재는 버린다). 표준은 언제나 다시 센다 — 수량이 바뀌었을 수 있다.
  const std = standardMaterials(lines, bomLines);
  const alive = new Set(lines.map((l) => l.product_id));
  const edited = new Map((materials || []).filter((m) => alive.has(m.product_id)).map((m) => [`${m.product_id}|${m.component_id}`, m]));
  return std.map((s) => {
    const e = edited.get(`${s.product_id}|${s.component_id}`);
    const qty = e ? Number(e.qty) : s.std_qty;
    const loss = qty - s.std_qty;
    return {
      product_id: s.component_id, qty, std_qty: s.std_qty, loss_reason: loss !== 0 ? (e?.loss_reason || "other") : null,
      note: loss !== 0 ? `자재 투입 · 로스 ${loss > 0 ? "+" : ""}${Math.round(loss * 1000) / 1000}${e?.loss_reason ? ` (${lossReasonLabel(e.loss_reason)})` : ""}` : "자재 투입",
    };
  }).filter((m) => m.qty !== 0);
}

/** 완제품 줄 → 문서 줄. 불량이 있으면 그 수량은 불량 보류 창고로 한 줄 더(같은 단가). */
async function prodLinesOf(companyId: string, lines: ProduceLine[]): Promise<MoveLine[]> {
  const anyDefect = lines.some((l) => Number(l.defect_qty || 0) !== 0);
  const defectWh = anyDefect ? (await ensureDefectWarehouse(companyId)).id : null;
  const out: MoveLine[] = [];
  for (const l of lines) {
    const base = { product_id: l.product_id, unit_price: l.unit_price ?? null, vat_amount: l.vat_amount ?? null, order_line_id: l.order_line_id ?? null };
    if (Number(l.qty) !== 0) out.push({ ...base, qty: Number(l.qty), note: l.note ?? null });
    if (Number(l.defect_qty || 0) !== 0) out.push({ ...base, qty: Number(l.defect_qty), warehouseId: defectWh, note: `불량${l.note ? ` · ${l.note}` : ""}` });
  }
  return out;
}

/** 저장된 완제품 문서의 자재 투입 줄(실투입·표준·원인) — 고칠 때 팝업 초기값 */
export async function getProduceMaterials(prodDocId: string): Promise<MatInput[]> {
  const matId = await findMatDoc(prodDocId);
  if (!matId) return [];
  const { data } = await supabase.from("stock_moves").select("product_id, qty, std_qty, loss_reason, note").eq("doc_id", matId);
  //   자재 줄에는 완제품이 안 적혀 있다 — 같은 자재를 여러 완제품이 쓰는 경우는 첫 완제품에 붙인다(Phase 1 한계, 팝업에서 다시 고칠 수 있다)
  return ((data || []) as any[]).map((m) => ({ product_id: "", component_id: m.product_id, qty: Math.abs(Number(m.qty || 0)), std_qty: m.std_qty == null ? Math.abs(Number(m.qty || 0)) : Math.abs(Number(m.std_qty)), loss_reason: m.loss_reason || null }));
}

/**
 * 완제품 문서를 고친다 — **자재 문서도 같이**(3순위). 둘 중 하나만 고치면 재고가 거짓말을 한다(결정 14).
 *   자재구성 × 새 수량으로 자재를 다시 내서: 짝이 있으면 그 문서를 갈아끼우고, 없으면 새로 세우고,
 *   자재가 0이 됐으면 짝을 취소한다(지우지 않는다).
 */
export async function updateProduceDoc(
  companyId: string, prodDocId: string,
  input: { docDate?: string; warehouseId: string; note?: string | null; lines: ProduceLine[]; materials?: MatInput[] | null },
  bomLines: BomLine[], userId?: string | null,
) {
  const docDate = input.docDate || todayKst();
  const r = await updateStockDoc(companyId, prodDocId, {
    reason: "produce", docDate, warehouseId: input.warehouseId, note: input.note ?? null,
    lines: await prodLinesOf(companyId, input.lines),
  }, userId);

  const mats = matLinesOf(input.lines, bomLines, input.materials);
  const matId = await findMatDoc(prodDocId);
  let matDocNo: string | null = null;
  if (mats.length) {
    if (matId) {
      const m = await updateStockDoc(companyId, matId, {
        reason: "consume", docDate, warehouseId: input.warehouseId, note: `${r.docNo} 자재 투입`, lines: mats,
      }, userId);
      matDocNo = m.docNo;
    } else {
      const m = await createStockDoc(companyId, {
        reason: "consume", docDate, warehouseId: input.warehouseId,
        originalDocId: prodDocId, note: `${r.docNo} 자재 투입`, lines: mats,
      }, userId);
      matDocNo = m.docNo;
    }
  } else if (matId) {
    await cancelStockDoc(matId, "완제품 수정으로 자재 없음", userId);
  }
  return { prodDocNo: r.docNo, matDocNo };
}

/** 완제품 문서를 취소하면 자재 문서도 같이 취소한다 — 자재만 빠진 채 남으면 재고가 거짓말을 한다. */
export async function cancelProduceDoc(prodDocId: string, reason: string, userId?: string | null) {
  await cancelStockDoc(prodDocId, reason, userId);
  const matId = await findMatDoc(prodDocId);
  if (matId) await cancelStockDoc(matId, `완제품 취소 · ${reason}`, userId);
}
