"use client";

// 품목 › 라벨 인쇄 팝업 (2026-09-22 재고 점검 F) — 조회된 품목을 골라 바코드 라벨 PDF. 바코드가 없는 품목은 SKU 로 찍는다.

import { useMemo, useState } from "react";
import type { Product } from "@/lib/inventory";
import { LABEL_LAYOUTS, buildLabelPdf, type LabelItem } from "@/lib/barcode-labels";
import { downloadBlob } from "@/lib/trade-docs-pdf";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import { todayKst } from "@/lib/kst";

export function LabelPrintDialog({ products, onClose }: { products: Product[]; onClose: () => void }) {
  const { toast } = useToast();
  const [checked, setChecked] = useState<Set<string>>(() => new Set(products.slice(0, 500).map((p) => p.id)));
  const [copies, setCopies] = useState<Record<string, string>>({});
  const [layoutKey, setLayoutKey] = useState(LABEL_LAYOUTS[0].key);
  const [showName, setShowName] = useState(true);
  const [showSub, setShowSub] = useState(true);
  const [showPrice, setShowPrice] = useState(false);
  const [busy, setBusy] = useState(false);
  const layout = LABEL_LAYOUTS.find((l) => l.key === layoutKey) || LABEL_LAYOUTS[0];
  const list = useMemo(() => products.slice(0, 500), [products]);
  const total = useMemo(() => list.filter((p) => checked.has(p.id)).reduce((s, p) => s + Math.max(1, Number(copies[p.id] || 1)), 0), [list, checked, copies]);
  const toggle = (id: string) => setChecked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const run = async () => {
    const items: LabelItem[] = list.filter((p) => checked.has(p.id)).map((p) => ({ code: (p.barcode || p.sku || "").trim(), name: p.name, sub: p.spec, price: p.sale_price, copies: Math.max(1, Number(copies[p.id] || 1)) })).filter((i) => i.code);
    if (!items.length) { toast("찍을 품목이 없습니다 (바코드나 SKU 가 있어야 합니다)", "error"); return; }
    setBusy(true);
    try {
      const blob = await buildLabelPdf(items, layout, { showName, showSub, showPrice });
      downloadBlob(blob, `품목라벨_${layout.key}_${todayKst()}.pdf`);
      toast(`라벨 ${total}장 PDF 를 내려받았습니다`, "success");
    } catch (e) { toast(friendlyError(e, "라벨을 만들지 못했습니다"), "error"); }
    finally { setBusy(false); }
  };

  return (
    <div className="inv-modal" onClick={onClose}>
      <div className="inv-modal-box inv-modal-wide" onClick={(e) => e.stopPropagation()}>
        <h3 className="inv-modal-title">바코드 라벨 인쇄</h3>
        <p className="inv-modal-desc">조회된 품목 {list.length}개{products.length > 500 ? " (앞 500개)" : ""} 중 고른 것을 Code 128 바코드 라벨로 만듭니다. 바코드가 비어 있으면 SKU 를 찍습니다 — 스캔 입력이 같은 값을 읽습니다.</p>
        <div className="lbl-bar">
          <label className="lbl-field"><span>라벨지</span>
            <select className="qk-input h-8 px-2 text-xs" value={layoutKey} onChange={(e) => setLayoutKey(e.target.value)}>{LABEL_LAYOUTS.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}</select></label>
          <label className="lbl-check"><input type="checkbox" checked={showName} onChange={(e) => setShowName(e.target.checked)} /> 품목명</label>
          <label className="lbl-check"><input type="checkbox" checked={showSub} onChange={(e) => setShowSub(e.target.checked)} /> 규격</label>
          <label className="lbl-check"><input type="checkbox" checked={showPrice} onChange={(e) => setShowPrice(e.target.checked)} /> 판매가</label>
          <span className="doc-sums-sp" />
          <span className="ev-dim">고른 {checked.size}개 · 총 {total}장 · 한 장 {layout.cols * layout.rows}칸</span>
        </div>
        <div className="stg-table-wrap lbl-scroll">
          <table className="ev-table ev-lined table-lbl">
            <thead><tr><th><input type="checkbox" checked={checked.size === list.length && list.length > 0} onChange={(e) => setChecked(e.target.checked ? new Set(list.map((p) => p.id)) : new Set())} aria-label="전체 선택" /></th><th className="text-left">SKU</th><th className="text-left">품목명</th><th className="text-left">바코드(찍힐 값)</th><th>장수</th></tr></thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id} className={checked.has(p.id) ? undefined : "ins-edi-off"}>
                  <td className="tc"><input type="checkbox" checked={checked.has(p.id)} onChange={() => toggle(p.id)} /></td>
                  <td className="text-left mono-number">{p.sku}</td>
                  <td className="text-left"><b>{p.name}</b>{p.spec ? <span className="ev-dim"> {p.spec}</span> : null}</td>
                  <td className="text-left mono-number">{p.barcode || <span title="바코드가 없어 SKU 를 찍습니다">{p.sku} <span className="ev-dim">(SKU)</span></span>}</td>
                  <td className="tc"><input className="qk-input lbl-copies" inputMode="numeric" value={copies[p.id] ?? "1"} onChange={(e) => setCopies((c) => ({ ...c, [p.id]: e.target.value.replace(/\D/g, "") }))} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="inv-modal-actions">
          <span className="doc-sums-sp" />
          <button type="button" className="btn-secondary btn-sm" onClick={onClose}>닫기</button>
          <button type="button" className="btn-primary btn-sm" disabled={busy || !checked.size} onClick={() => void run()}>{busy ? "만드는 중…" : `라벨 PDF (${total}장)`}</button>
        </div>
      </div>
    </div>
  );
}
