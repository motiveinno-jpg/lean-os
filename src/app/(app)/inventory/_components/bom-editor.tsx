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
import { listBoms, upsertBomLine, deleteBomLine, type BomLine } from "@/lib/inventory-production";
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
  const [seeded, setSeeded] = useState(false);
  const [pick, setPick] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const pickTimer = useRef<number | null>(null);

  useEffect(() => {
    if (seeded || isLoading) return;
    const mine = boms.filter((b) => b.product_id === product.id);
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
  const cost = live.reduce((n, r) => n + num(r.qty) * Number(byId.get(r.component_id)?.cost_price || 0), 0);
  const dupIds = new Set(live.map((r) => r.component_id).filter((id, k, a) => a.indexOf(id) !== k));
  const bad = live.filter((r) => !(num(r.qty) > 0));

  const save = async () => {
    if (dupIds.size) { toast("같은 자재가 두 줄 이상 있습니다 — 하나로 합치세요", "error"); return; }
    if (bad.length) { toast("1개당 수량이 비었거나 0인 줄이 있습니다", "error"); return; }
    setBusy(true);
    try {
      const before = boms.filter((b) => b.product_id === product.id);
      for (const r of live) await upsertBomLine(companyId, { id: r.id, product_id: product.id, component_id: r.component_id, qty: num(r.qty), note: r.note || null });
      for (const b of before) if (!live.some((r) => r.id === b.id)) await deleteBomLine(b.id);
      await qc.invalidateQueries({ queryKey: ["inv-boms", companyId] });
      toast(live.length ? `${product.name} 자재구성 ${live.length}줄을 저장했습니다 — 1개당 원가 ₩${won(cost)}` : `${product.name} 자재구성을 비웠습니다 — 완성해도 자재가 빠지지 않습니다`, "success");
      onClose();
    } catch (e) { toast(friendlyError(e, "저장하지 못했습니다"), "error"); }
    finally { setBusy(false); }
  };

  return (
    <div className="inv-modal" onClick={onClose}>
      <div className="inv-modal-box inv-modal-wide" onClick={(e) => e.stopPropagation()}>
        <h3 className="inv-modal-title">자재구성 — {product.name} <span className="ev-dim">{product.sku}</span></h3>
        <p className="inv-modal-desc">
          <b>1개를 만들 때</b> 드는 자재와 수량입니다. 완성 기록 때 <b>이 수량 × 완성 수량</b>만큼 자재가 빠집니다. 비워 두면 완제품만 늘고 자재는 빠지지 않습니다.
          자재 칸에 이름·SKU 를 치거나 바코드를 찍고, <b>Enter</b> 로 다음 칸·다음 줄로 갑니다.
        </p>
        <div className="stg-table-wrap ch-ship-list" ref={gridRef}>
          <table className="ev-table ev-lined table-doc table-inv-status-sm">
            <thead><tr><th className="doc-no"></th><th>자재</th><th>1개당</th><th>단가</th><th>드는 값</th><th>현재 매입가 기준</th><th>비고</th><th className="doc-th-x"></th></tr></thead>
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
                      <input className="doc-in" data-bom={`qty-${i}`} inputMode="numeric" placeholder="수량" value={r.qty}
                        onChange={(e) => setRow(i, { qty: e.target.value })}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); focus(i, "note"); } }} />
                    </td>
                    <td className="tr mono-number ev-dim">{c ? `₩${won(unit)}` : "—"}</td>
                    <td className="tr mono-number">{c && num(r.qty) ? `₩${won(num(r.qty) * unit)}` : "—"}</td>
                    <td className="tc ev-dim">{c ? (c.track_stock ? "수량 관리" : "수량 안 셈") : "—"}</td>
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
          자재 {live.length}종 · 1개당 자재 원가 <b>₩{won(cost)}</b>
          {product.cost_price != null && <span className="ev-dim"> · 품목 매입가 ₩{won(Number(product.cost_price))}{cost && Number(product.cost_price) ? ` (차이 ₩${won(cost - Number(product.cost_price))})` : ""}</span>}
        </div>
        <div className="inv-modal-actions">
          <button type="button" className="btn-secondary btn-sm" onClick={onClose}>취소</button>
          <button type="button" className="btn-primary btn-sm" disabled={busy || isLoading} onClick={save}>저장</button>
        </div>
      </div>
    </div>
  );
}

/** 자재 소요 — 생산 격자에 친 품목 × 수량으로 자재를 모아 현재고와 견준다(읽기 전용) */
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
  const need = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of grouped) for (const b of g.lines) m.set(b.component_id, (m.get(b.component_id) || 0) + b.qty * g.qty);
    return [...m.entries()].map(([id, n]) => ({ c: byId.get(id), need: n, have: have.get(id) || 0 })).sort((a, b) => (a.have - a.need) - (b.have - b.need));
  }, [grouped, byId, have]);
  const shortCount = need.filter((x) => x.have < x.need).length;
  return (
    <div className="inv-modal" onClick={onClose}>
      <div className="inv-modal-box inv-modal-wide" onClick={(e) => e.stopPropagation()}>
        <h3 className="inv-modal-title">자재 소요 — 지금 친 완제품 기준</h3>
        <p className="inv-modal-desc">격자에 친 <b>완제품 × 수량</b>으로 드는 자재를 모았습니다. 현재고는 {warehouseId ? "고른 창고" : "전체 창고"} 기준. 자재구성은 재고 › 품목에서 고칩니다.</p>
        {grouped.length === 0 ? <div className="inv-status-empty">격자에 완제품과 수량을 먼저 치세요</div> : (
          <>
            <div className="inv-bom-groups">
              {grouped.map((g) => (
                <div key={g.product.id} className="inv-bom-group">
                  <b>{g.product.name}</b> <span className="ev-dim">{g.product.sku} · {won(g.qty)}개</span>
                  {g.lines.length === 0
                    ? <em className="inv-field-warn"> — 자재구성 없음: 완성해도 자재가 빠지지 않습니다{onEdit && <> · <button type="button" className="bz-link" onClick={() => onEdit(g.product)}>지금 등록</button></>}</em>
                    : <span> — {g.lines.map((b) => `${byId.get(b.component_id)?.name || "?"} ×${won(b.qty)}`).join(", ")}</span>}
                </div>
              ))}
            </div>
            {need.length > 0 && (
              <div className="stg-table-wrap ch-ship-list">
                <table className="ev-table ev-lined table-inv-status-sm">
                  <thead><tr><th>자재</th><th>필요</th><th>현재고</th><th>남음/부족</th><th>상태</th></tr></thead>
                  <tbody>{need.map((x) => (
                    <tr key={x.c?.id || "?"} className={x.have < x.need ? "inv-row-fix" : undefined}>
                      <td className="text-left"><b>{x.c?.name || "?"}</b> <span className="ev-dim">{x.c?.sku}</span></td>
                      <td className="tr mono-number">{won(x.need)}</td>
                      <td className="tr mono-number">{won(x.have)}</td>
                      <td className="tr mono-number">{x.have - x.need >= 0 ? `+${won(x.have - x.need)}` : won(x.have - x.need)}</td>
                      <td className="tc">{x.have < x.need ? <span className="inv-pill inv-pill-danger">부족</span> : <span className="inv-pill inv-pill-ok">충분</span>}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
            <div className="inv-modal-foot">자재 {need.length}종{shortCount ? <> · <b className="inv-diff-minus">부족 {shortCount}종</b></> : <> · 모두 충분</>}</div>
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
