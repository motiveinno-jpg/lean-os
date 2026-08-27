"use client";
//   A8 (2026-08-27 규칙형 자동화, docs/20260827_PLAN_inventory_rule_automation.md) — 스캔한 바코드·SKU 가 품목에 없으면
//   "새 품목 등록?" 팝업에 코드를 채워 묻는다. 등록은 사람이 누른다(결정 91). 등록 즉시 그 줄에 품목이 들어간다.
//   ★ 규칙: 숫자만 8~14자리(EAN/UPC)면 바코드 칸에, 그 밖의 코드는 SKU 칸에 미리 채운다.
import { useState } from "react";
import { upsertProduct, type Product } from "@/lib/inventory";
import { friendlyError } from "@/lib/friendly-error";

export const looksLikeCode = (s: string) => /^[A-Za-z0-9][A-Za-z0-9\-_.]{3,}$/.test(s.trim());
const isBarcode = (s: string) => /^\d{8,14}$/.test(s.trim());

export function QuickProductDialog({ companyId, userId, code, onClose, onSaved, toast }: {
  companyId: string; userId: string | null; code: string;
  onClose: () => void; onSaved: (p: Product) => void; toast: (m: string, t?: "success" | "error") => void;
}) {
  const bc = isBarcode(code);
  const [v, setV] = useState<Partial<Product>>({ sku: bc ? "" : code.trim(), barcode: bc ? code.trim() : null, name: "", spec: "", unit: "EA", sale_price: null, cost_price: null, track_stock: true, is_active: true });
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Product>(k: K, val: Product[K]) => setV((s) => ({ ...s, [k]: val }));
  const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(/,/g, "")));
  const ok = !!(v.sku || "").trim() && !!(v.name || "").trim();
  const save = async () => {
    if (!ok) return;
    setBusy(true);
    try {
      const id = await upsertProduct(companyId, v, userId);
      toast(`'${v.name}' 을 등록하고 이 줄에 넣었습니다`, "success");
      onSaved({ ...(v as Product), id, category: null, safety_stock: null, overhead_per_unit: 0, lead_time_days: 7, auto_suggest: true, memo: null } as Product);
    } catch (e) { toast(friendlyError(e, "품목을 등록하지 못했습니다"), "error"); }
    finally { setBusy(false); }
  };
  return (
    <div className="inv-modal" onClick={onClose}>
      <div className="inv-modal-box" onClick={(e) => e.stopPropagation()}>
        <h3 className="inv-modal-title">새 품목 등록?</h3>
        <p className="inv-modal-desc">
          <b className="mono-number">{code.trim()}</b> 은(는) 품목에 없습니다. {bc ? "바코드" : "SKU"} 칸에 채워 두었으니 이름만 적고 등록하면 이 줄에 바로 들어갑니다.
          잘못 찍은 것이면 닫으세요. 출처: 스캔 입력.
        </p>
        <div className="inv-form-grid">
          <label className="inv-field"><span>SKU *</span><input className="field-input" value={v.sku || ""} onChange={(e) => set("sku", e.target.value)} /></label>
          <label className="inv-field"><span>바코드</span><input className="field-input" value={v.barcode || ""} onChange={(e) => set("barcode", e.target.value || null)} /></label>
          <label className="inv-field"><span>품목명 *</span><input className="field-input" autoFocus value={v.name || ""} onChange={(e) => set("name", e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && ok) { e.preventDefault(); void save(); } }} /></label>
          <label className="inv-field"><span>규격</span><input className="field-input" value={v.spec || ""} onChange={(e) => set("spec", e.target.value || null)} placeholder="500ml · 블랙" /></label>
          <label className="inv-field"><span>단위</span><input className="field-input" value={v.unit || ""} onChange={(e) => set("unit", e.target.value)} placeholder="EA · BOX · kg" /></label>
          <label className="inv-field"><span>판매가</span><input className="field-input tr" inputMode="numeric" value={v.sale_price ?? ""} onChange={(e) => set("sale_price", num(e.target.value))} /></label>
          <label className="inv-field"><span>매입가</span><input className="field-input tr" inputMode="numeric" value={v.cost_price ?? ""} onChange={(e) => set("cost_price", num(e.target.value))} /></label>
        </div>
        <div className="inv-modal-actions">
          <span className="doc-sums-sp" />
          <button type="button" className="btn-secondary btn-sm" onClick={onClose}>닫기</button>
          <button type="button" className="btn-primary btn-sm" disabled={!ok || busy} onClick={save}>등록하고 줄에 넣기</button>
        </div>
      </div>
    </div>
  );
}
