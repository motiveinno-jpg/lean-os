"use client";

// ── 자재구성 — 품목 등록에서 편집, 생산 입력에서 소요 확인 (2026-08-26 사장님 지시) ──────
//   "자재구성은 입력(생산)보다 품목 등록에 있는 게 맞다. 체크박스로 체크하면 팝업. 지금 입력 화면은 너무 불편하다.
//    생산의 자재구성 버튼은 입력한 품목이 어떤 자재로 구성돼 있는지 보여 주는 기능으로."
//
//   ★ 편집(BomEditorDialog)은 격자 — 자재 칸에 치면 고르개(↑↓·Enter, 바코드·SKU 정확히 치면 바로), 1개당 수량, 단가·드는 값은 자동,
//     Enter 로 다음 칸/다음 줄. 저장 버튼 한 번에 전부 반영(줄마다 저장하던 것을 버림 — 고치다 말면 반쯤 저장된 채 남았다).
//   ★ 소요(BomNeedDialog)는 읽기 전용 — 생산 격자에 친 품목 × 수량으로 자재를 모아 현재고와 견주고 부족을 붉게 표시한다.
//   ★ 자재구성이 비어 있으면 완성해도 자재가 빠지지 않는다(결정 15) — 지어내지 않는다.

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import { PickList } from "@/components/pick-list";
import { listOnHand, type Product } from "@/lib/inventory";
import { listBoms, upsertBomLine, deleteBomLine, perUnit, materialShortages, type BomLine } from "@/lib/inventory-production";
import { docWon as won } from "./doc-editor";

type Row = { key: number; id?: string; component_id: string; label: string; qty: string; note: string };
let K = 1;
const blank = (): Row => ({ key: K++, component_id: "", label: "", qty: "", note: "" });
const num = (v: string) => { const n = Number(String(v).replace(/[,\s]/g, "")); return Number.isNaN(n) ? 0 : n; };

/** 자재구성 편집 — 품목 하나의 "1개를 만들 때 드는 자재" */
export function BomEditorDialog({ companyId, product, products, onClose }: {
  companyId: string; product: Product; products: Product[]; onClose: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: boms = [], isLoading } = useQuery({ queryKey: ["inv-boms", companyId], queryFn: () => listBoms(companyId), enabled: !!companyId });
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const [rows, setRows] = useState<Row[]>([]);
  //   ★ 기준 수량 — "완제품 N개당" 소요량. 1개당으로 안 떨어지는 자재(10개당 3장)를 억지로 0.3 으로 적지 않게(2026-08-26 사장님).
  const [base, setBase] = useState("1");
  const [seeded, setSeeded] = useState(false);
  const [pick, setPick] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const pickTimer = useRef<number | null>(null);

  useEffect(() => {
    if (seeded || isLoading) return;
    const mine = boms.filter((b) => b.product_id === product.id);
    if (mine.length) setBase(String(mine[0].base_qty || 1));
    setRows([...mine.map((b) => { const c = byId.get(b.component_id); return { key: K++, id: b.id, component_id: b.component_id, label: c ? `${c.sku} ${c.name}` : "?", qty: String(b.qty), note: b.note || "" }; }), blank(), blank()]);
    setSeeded(true);
    setTimeout(() => focus(mine.length, "label"), 200);
  }, [boms, isLoading, seeded, product.id, byId]);   // eslint-disable-line react-hooks/exhaustive-deps

  const focus = (i: number, key: "label" | "qty" | "note") => {
    const el = gridRef.current?.querySelector<HTMLInputElement>(`[data-bom="${key}-${i}"]`);
    if (el) { el.focus(); el.select(); }
  };
  const setRow = (i: number, patch: Partial<Row>) => setRows((s) => s.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const candidates = (i: number) => {
    const q = (rows[i]?.label || "").trim().toLowerCase();
    return products.filter((p) => p.id !== product.id && p.is_active && (!q || `${p.sku} ${p.name} ${p.spec || ""} ${p.barcode || ""}`.toLowerCase().includes(q)))
      .sort((a, b) => ((a.barcode === q.toUpperCase() || a.sku.toLowerCase() === q) ? 0 : 1) - ((b.barcode === q.toUpperCase() || b.sku.toLowerCase() === q) ? 0 : 1))
      .map((p) => ({ id: p.id, code: p.sku, name: `${p.name}${p.spec ? ` (${p.spec})` : ""}` }));
  };
  const choose = (i: number, pid: string) => {
    const c = byId.get(pid); if (!c) return;
    setRows((s) => { const n = s.map((r, j) => (j === i ? { ...r, component_id: pid, label: `${c.sku} ${c.name}` } : r)); if (i === n.length - 1) n.push(blank()); return n; });
    setPick(null); setTimeout(() => focus(i, "qty"), 0);
  };

  const live = rows.filter((r) => r.component_id);
  const baseN = num(base) > 0 ? num(base) : 1;
  //   1개당 자재비 = Σ(소요량 ÷ 기준 수량 × 매입단가)
  const cost = live.reduce((n, r) => n + (num(r.qty) / baseN) * Number(byId.get(r.component_id)?.cost_price || 0), 0);
  const dupIds = new Set(live.map((r) => r.component_id).filter((id, k, a) => a.indexOf(id) !== k));
  const bad = live.filter((r) => !(num(r.qty) > 0));

  const save = async () => {
    if (dupIds.size) { toast("같은 자재가 두 줄 이상 있습니다 — 하나로 합치세요", "error"); return; }
    if (bad.length) { toast("소요량이 비었거나 0인 줄이 있습니다", "error"); return; }
    setBusy(true);
    try {
      const before = boms.filter((b) => b.product_id === product.id);
      for (const r of live) await upsertBomLine(companyId, { id: r.id, product_id: product.id, component_id: r.component_id, qty: num(r.qty), base_qty: baseN, note: r.note || null });
      for (const b of before) if (!live.some((r) => r.id === b.id)) await deleteBomLine(b.id);
      await qc.invalidateQueries({ queryKey: ["inv-boms", companyId] });
      toast(live.length ? `${product.name} 자재구성 ${live.length}줄을 저장했습니다 — 1개당 자재비 ₩${won(cost)}` : `${product.name} 자재구성을 비웠습니다 — 완성해도 자재가 빠지지 않습니다`, "success");
      onClose();
    } catch (e) { toast(friendlyError(e, "저장하지 못했습니다"), "error"); }
    finally { setBusy(false); }
  };

  return (
    <div className="inv-modal" onClick={onClose}>
      <div className="inv-modal-box inv-modal-wide" onClick={(e) => e.stopPropagation()}>
        <h3 className="inv-modal-title">자재구성 — {product.name} <span className="ev-dim">{product.sku}</span></h3>
        <p className="inv-modal-desc">
          완제품 <b>기준 수량당 소요 자재와 소요량</b>입니다. 완성 기록 시 <b>소요량 ÷ 기준 수량 × 완성 수량</b>만큼 자재가 출고됩니다. 비어 있으면 완제품만 입고되고 자재는 출고되지 않습니다.
          자재 칸에 품목명·SKU 를 입력하거나 바코드를 스캔하고, <b>Enter</b> 로 다음 칸·다음 줄로 이동합니다.
        </p>
        <div className="inv-bom-base">
          <span className="field-label">기준 수량</span>
          <span>완제품 <input className="field-input inv-count-input" inputMode="numeric" value={base} onChange={(e) => setBase(e.target.value)} /> {product.unit || "개"}당</span>
          <em className="inv-hint">1개당으로 나누어떨어지지 않으면 기준을 10·100 으로 두고 그 수량당 소요량을 적습니다. 예) 10개당 리본 3장</em>
        </div>
        <div className="stg-table-wrap ch-ship-list" ref={gridRef}>
          <table className="ev-table ev-lined table-doc table-inv-status-sm">
            <thead><tr><th className="doc-no"></th><th>자재</th><th>소요량({baseN === 1 ? "1개당" : `${won(baseN)}개당`})</th><th>매입단가</th><th>소요금액</th><th>비고</th><th className="doc-th-x"></th></tr></thead>
            <tbody>
              {rows.map((r, i) => {
                const c = r.component_id ? byId.get(r.component_id) : undefined;
                const unit = Number(c?.cost_price || 0);
                return (
                  <tr key={r.key} className={dupIds.has(r.component_id) ? "inv-row-fix" : undefined}>
                    <td className="doc-no">{i + 1}</td>
                    <td className="cell text-left">
                      <input className="doc-in" data-bom={`label-${i}`} placeholder="자재명 · SKU · 바코드" value={r.label}
                        onChange={(e) => { setRow(i, { label: e.target.value, component_id: "" }); if (pickTimer.current) window.clearTimeout(pickTimer.current); pickTimer.current = window.setTimeout(() => setPick(i), 180); }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            if (pickTimer.current) { window.clearTimeout(pickTimer.current); pickTimer.current = null; }
                            const q = r.label.trim();
                            const hit = products.find((p) => p.id !== product.id && p.is_active && ((p.barcode && p.barcode === q) || p.sku.toUpperCase() === q.toUpperCase()));
                            if (hit) { e.preventDefault(); choose(i, hit.id); return; }
                            if (r.component_id) { e.preventDefault(); focus(i, "qty"); return; }
                          }
                          if (pick === i && e.key !== "Escape") return;
                          if (e.key === "ArrowDown") { e.preventDefault(); setPick(i); }
                        }} />
                      {pick === i && (
                        <PickList items={candidates(i)} placeholder="자재 검색 (이름·SKU·규격·바코드)" empty="맞는 품목이 없습니다"
                          onPick={(sel) => choose(i, sel.id)} onClose={() => setPick(null)} />
                      )}
                    </td>
                    <td className="cell num">
                      <input className="doc-in" data-bom={`qty-${i}`} inputMode="numeric" placeholder="소요량" value={r.qty}
                        onChange={(e) => setRow(i, { qty: e.target.value })}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); focus(i, "note"); } }} />
                    </td>
                    <td className="tr mono-number ev-dim">{c ? `₩${won(unit)}` : "—"}</td>
                    <td className="tr mono-number">{c && num(r.qty) ? `₩${won(num(r.qty) * unit)}` : "—"}</td>
                    <td className="cell text-left">
                      <input className="doc-in" data-bom={`note-${i}`} placeholder="비고" value={r.note}
                        onChange={(e) => setRow(i, { note: e.target.value })}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); setRows((s) => (i === s.length - 1 ? [...s, blank()] : s)); setTimeout(() => focus(i + 1, "label"), 0); } }} />
                    </td>
                    <td className="tc"><button type="button" className="inv-line-x" aria-label="줄 삭제" onClick={() => setRows((s) => (s.length > 1 ? s.filter((_, j) => j !== i) : [blank()]))}>✕</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="doc-add"><button type="button" className="btn-secondary btn-sm" onClick={() => setRows((s) => [...s, blank()])}>+ 줄</button></div>
        <div className="inv-modal-foot">
          자재 {live.length}종 · 1개당 자재비 합계 <b>₩{won(cost)}</b>
          {product.cost_price != null && <span className="ev-dim"> · 등록된 매입가 ₩{won(Number(product.cost_price))}{cost && Number(product.cost_price) ? ` (차이 ₩${won(cost - Number(product.cost_price))})` : ""}</span>}
        </div>
        <div className="inv-modal-actions">
          <button type="button" className="btn-secondary btn-sm" onClick={onClose}>취소</button>
          <button type="button" className="btn-primary btn-sm" disabled={busy || isLoading} onClick={save}>저장</button>
        </div>
      </div>
    </div>
  );
}

/** 자재 소요 — 완제품 목록에서 하나를 누르면 그 품목의 자재만 아래에(2026-08-26 사장님: "혼재되어 보기 불편"). 과부족은 격자 전체 소요 기준. */
export function BomNeedDialog({ companyId, warehouseId, items, products, onClose, onEdit }: {
  companyId: string; warehouseId: string | null;
  items: { product_id: string; qty: number }[]; products: Product[];
  onClose: () => void; onEdit?: (p: Product) => void;
}) {
  const { data: boms = [] } = useQuery({ queryKey: ["inv-boms", companyId], queryFn: () => listBoms(companyId), enabled: !!companyId });
  const { data: onhand = [] } = useQuery({ queryKey: ["inv-onhand", companyId], queryFn: () => listOnHand(companyId), enabled: !!companyId });
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const have = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of onhand) if (!warehouseId || o.warehouse_id === warehouseId) m.set(o.product_id, (m.get(o.product_id) || 0) + Number(o.qty));
    return m;
  }, [onhand, warehouseId]);
  const grouped = useMemo(() => {
    const per = new Map<string, { product: Product; qty: number; lines: BomLine[] }>();
    for (const it of items) {
      const p = byId.get(it.product_id); if (!p || !(it.qty > 0)) continue;
      const cur = per.get(p.id) || { product: p, qty: 0, lines: boms.filter((b) => b.product_id === p.id) };
      cur.qty += it.qty; per.set(p.id, cur);
    }
    return [...per.values()];
  }, [items, byId, boms]);
  //   전체 소요(격자에 친 완제품 전부) — 같은 자재를 여러 완제품이 쓰면 합쳐서 견줘야 '충분'이 거짓말을 안 한다
  const totalNeed = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of grouped) for (const b of g.lines) m.set(b.component_id, (m.get(b.component_id) || 0) + perUnit(b) * g.qty);
    return m;
  }, [grouped]);
  const shortOf = (g: { lines: BomLine[] }) => g.lines.filter((b) => (have.get(b.component_id) || 0) < (totalNeed.get(b.component_id) || 0)).length;
  const [sel, setSel] = useState<string | null>(null);
  const cur = grouped.find((g) => g.product.id === sel) || grouped[0];
  const rows = cur ? cur.lines.map((b) => {
    const c = byId.get(b.component_id); const mine = perUnit(b) * cur.qty; const all = totalNeed.get(b.component_id) || 0; const h = have.get(b.component_id) || 0;
    return { c, b, mine, all, have: h, short: h < all };
  }).sort((a, b) => (a.have - a.all) - (b.have - b.all)) : [];
  const totalShort = [...totalNeed.entries()].filter(([id, n]) => (have.get(id) || 0) < n).length;
  return (
    <div className="inv-modal" onClick={onClose}>
      <div className="inv-modal-box inv-modal-wide" onClick={(e) => e.stopPropagation()}>
        <h3 className="inv-modal-title">자재 소요</h3>
        <p className="inv-modal-desc">완제품을 누르면 그 품목의 소요 자재가 아래에 나옵니다. 현재고는 {warehouseId ? "선택한 창고" : "전체 창고"} 기준, 과부족은 <b>입력한 완제품 전체 소요</b> 기준입니다.</p>
        {grouped.length === 0 ? <div className="inv-status-empty">완제품과 완성 수량을 먼저 입력하세요</div> : (
          <>
            <div className="inv-bom-list">
              {grouped.map((g) => {
                const n = shortOf(g);
                return (
                  <button key={g.product.id} type="button" className={`inv-bom-item${cur?.product.id === g.product.id ? " inv-bom-item-on" : ""}`} onClick={() => setSel(g.product.id)}>
                    <b>{g.product.name}</b><span className="ev-dim">{g.product.sku} · {won(g.qty)}{g.product.unit || "개"}</span>
                    {g.lines.length === 0 ? <em className="inv-pill inv-pill-warn">자재구성 없음</em>
                      : n > 0 ? <em className="inv-pill inv-pill-danger">부족 {n}종</em> : <em className="inv-pill inv-pill-ok">자재 {g.lines.length}종 충분</em>}
                  </button>
                );
              })}
            </div>
            {cur && (cur.lines.length === 0 ? (
              <div className="inv-status-empty">{cur.product.name}은(는) 자재구성이 없습니다 — 완성 기록 시 자재가 출고되지 않습니다.{onEdit && <> <button type="button" className="bz-link" onClick={() => onEdit(cur.product)}>자재구성 등록</button></>}</div>
            ) : (
              <div className="stg-table-wrap ch-ship-list">
                <table className="ev-table ev-lined table-inv-status-sm">
                  <thead><tr><th>자재</th><th>{cur.lines[0].base_qty !== 1 ? `${won(cur.lines[0].base_qty)}개당` : "1개당"}</th><th>이 품목 소요량</th><th>전체 소요량</th><th>현재고</th><th>과부족</th><th>상태</th></tr></thead>
                  <tbody>{rows.map((x) => (
                    <tr key={x.b.id} className={x.short ? "inv-row-fix" : undefined}>
                      <td className="text-left"><b>{x.c?.name || "?"}</b> <span className="ev-dim">{x.c?.sku}</span></td>
                      <td className="tr mono-number ev-dim">{won(x.b.qty)}</td>
                      <td className="tr mono-number">{won(x.mine)}</td>
                      <td className="tr mono-number">{won(x.all)}</td>
                      <td className="tr mono-number">{won(x.have)}</td>
                      <td className="tr mono-number">{x.have - x.all >= 0 ? `+${won(x.have - x.all)}` : won(x.have - x.all)}</td>
                      <td className="tc">{x.short ? <span className="inv-pill inv-pill-danger">부족</span> : <span className="inv-pill inv-pill-ok">충분</span>}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            ))}
            <div className="inv-modal-foot">완제품 {grouped.length}종{totalShort ? <> · <b className="inv-diff-minus">자재 부족 {totalShort}종</b> — 완성 기록 시 자재 재고가 음수가 됩니다</> : <> · 자재 모두 충분</>}</div>
          </>
        )}
        <div className="inv-modal-actions">
          <span className="doc-sums-sp" />
          <button type="button" className="btn-primary btn-sm" onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
}

/** 생산 조회 줄의 자재 부족 배지 — 치는 동안 계속 센다. 부족이 없으면 아무것도 안 그린다. */
export function MaterialShortBadge({ ctl, onOpen }: { ctl: { companyId: string | null; live: { product_id?: string | null; qty: string }[]; head: Record<string, string> }; onOpen: () => void }) {
  const companyId = ctl.companyId;
  const { data: boms = [] } = useQuery({ queryKey: ["inv-boms", companyId], queryFn: () => listBoms(companyId!), enabled: !!companyId });
  const { data: onhand = [] } = useQuery({ queryKey: ["inv-onhand", companyId], queryFn: () => listOnHand(companyId!), enabled: !!companyId });
  const short = useMemo(() => materialShortages(
    ctl.live.filter((r) => r.product_id).map((r) => ({ product_id: r.product_id!, qty: num(r.qty) })), boms, onhand, ctl.head.wh || null,
  ), [ctl.live, boms, onhand, ctl.head.wh]);
  if (!short.length) return null;
  return <button type="button" className="btn-secondary btn-sm inv-short-badge" onClick={onOpen} title="누르면 어떤 자재가 얼마나 모자라는지 보입니다">자재 부족 {short.length}종</button>;
}
