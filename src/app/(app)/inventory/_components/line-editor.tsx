"use client";

// ── 재고 — 판매·구매가 같이 쓰는 줄 편집기와 거래처 칸 ─────────────────────────
//   2단계(판매)에서 만들고 3단계(구매)가 그대로 쓴다. 파는 줄과 사는 줄은 칸이 같다 —
//   무엇을 · 몇 개 · 얼마에. 다른 것은 그 옆에 무엇을 되읽어 주느냐뿐이라 warn 으로 받는다.

import { useMemo } from "react";
import type { Product } from "@/lib/inventory";

const won = (n: number) => Math.round(n || 0).toLocaleString("ko-KR");

export type Partner = { id: string; name: string };
export type LineDraft = { product_id: string; qty: string; unit_price: string };

export function LineEditor({ lines, setLines, products, warn, priceOf }: {
  lines: LineDraft[];
  setLines: (f: (s: LineDraft[]) => LineDraft[]) => void;
  products: Product[];
  //   그 줄에 붙일 경고(판매는 '가능 N', 구매는 없음). 없으면 안 붙는다.
  warn?: (productId: string, qty: number) => string | null;
  //   품목을 고를 때 채워 줄 단가 — 판매는 판매가, 구매는 매입가. 채워만 주고 고치는 것은 사람이다.
  priceOf?: (p: Product) => number | null | undefined;
}) {
  const pickable = useMemo(() => products.filter((p) => p.is_active), [products]);
  const set = (i: number, k: keyof LineDraft, v: string) =>
    setLines((s) => s.map((l, j) => (j === i ? { ...l, [k]: v } : l)));

  return (
    <div className="inv-lines">
      {lines.map((l, i) => {
        const p = products.find((x) => x.id === l.product_id);
        const qty = Number(l.qty);
        const w = l.product_id && warn && !Number.isNaN(qty) ? warn(l.product_id, qty) : null;
        return (
          <div key={i} className="inv-line">
            <select className="field-input" value={l.product_id}
              onChange={(e) => {
                const np = products.find((x) => x.id === e.target.value);
                set(i, "product_id", e.target.value);
                const price = np && priceOf ? priceOf(np) : null;
                if (price != null && !l.unit_price) set(i, "unit_price", String(price));
              }}>
              <option value="">품목 고르기</option>
              {pickable.map((x) => <option key={x.id} value={x.id}>{x.sku} · {x.name}{x.spec ? ` (${x.spec})` : ""}</option>)}
            </select>
            <input className="field-input" inputMode="numeric" placeholder="수량" value={l.qty}
              onChange={(e) => set(i, "qty", e.target.value)} />
            <input className="field-input" inputMode="numeric" placeholder="단가" value={l.unit_price}
              onChange={(e) => set(i, "unit_price", e.target.value)} />
            <span className={w ? "inv-line-eff inv-line-eff-out" : "inv-line-eff"}>
              {!l.qty || Number.isNaN(qty) ? "—" : `₩${won(qty * Number(l.unit_price || 0))}`}
              {p && !p.track_stock ? <b className="inv-line-undo">수량 없음</b> : null}
              {w ? <b className="inv-line-undo">{w}</b> : null}
            </span>
            <button type="button" className="inv-line-x" aria-label="줄 지우기"
              onClick={() => setLines((s) => s.filter((_, j) => j !== i))}>✕</button>
          </div>
        );
      })}
      <button type="button" className="btn-secondary btn-sm"
        onClick={() => setLines((s) => [...s, { product_id: "", qty: "", unit_price: "" }])}>+ 줄 추가</button>
    </div>
  );
}

/** 거래처 — 골라도 되고 그냥 적어도 된다(온라인 주문·시장 매입은 거래처를 안 만든다). */
export function PartnerField({ partners, partnerId, setPartnerId, partnerName, setPartnerName, hint }: {
  partners: Partner[]; partnerId: string; setPartnerId: (v: string) => void;
  partnerName: string; setPartnerName: (v: string) => void; hint?: string;
}) {
  return (
    <label className="inv-field"><span>거래처</span>
      <div className="inv-partner">
        <select className="field-input" value={partnerId}
          onChange={(e) => { setPartnerId(e.target.value); if (e.target.value) setPartnerName(""); }}>
          <option value="">— 등록된 거래처에서 고르기 —</option>
          {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <input className="field-input" placeholder={hint || "또는 이름만 적기"} value={partnerName}
          onChange={(e) => { setPartnerName(e.target.value); if (e.target.value) setPartnerId(""); }} />
      </div>
    </label>
  );
}
