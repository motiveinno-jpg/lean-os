"use client";

// ── 재고 › 생산 › 자재구성 (2026-08-25) ───────────────────────────────────────
//   "이걸 1개 만들 때 무엇이 얼마나 드는가". 줄이 하나라도 있으면 그 품목은 자재구성이 있는 것이다.
//   ★ 여기가 비어 있으면 완성해도 **자재가 빠지지 않는다**(결정 15) — 없는 걸 지어내지 않는다.

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getCurrentUser } from "@/lib/queries";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import { QuickSearch, quickSearchHit } from "@/components/query-kit";
import { listProducts, type Product } from "@/lib/inventory";
import { listBoms, upsertBomLine, deleteBomLine } from "@/lib/inventory-production";
import { docWon as won } from "./doc-editor";
import { useEffect } from "react";

export function BomPanel({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [companyId, setCompanyId] = useState<string | null>(null);
  useEffect(() => { getCurrentUser().then((u) => setCompanyId(u?.company_id ?? null)); }, []);

  const [q, setQ] = useState("");
  const [pick, setPick] = useState<Product | null>(null);
  const [addId, setAddId] = useState(""); const [addQty, setAddQty] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: products = [] } = useQuery({ queryKey: ["inv-products", companyId], queryFn: () => listProducts(companyId!), enabled: !!companyId });
  const { data: boms = [] } = useQuery({ queryKey: ["inv-boms", companyId], queryFn: () => listBoms(companyId!), enabled: !!companyId });

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const withBom = useMemo(() => new Set(boms.map((b) => b.product_id)), [boms]);
  const list = useMemo(() => {
    const l = products.filter((p) => p.is_active && p.track_stock && quickSearchHit(q, [p.sku, p.name, p.spec]));
    return [...l.filter((p) => withBom.has(p.id)), ...l.filter((p) => !withBom.has(p.id))];
  }, [products, withBom, q]);
  const mine = useMemo(() => (pick ? boms.filter((b) => b.product_id === pick.id) : []), [boms, pick]);
  const cost = mine.reduce((n, b) => n + b.qty * Number(byId.get(b.component_id)?.cost_price || 0), 0);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); await qc.invalidateQueries({ queryKey: ["inv-boms", companyId] }); }
    catch (e) { toast(friendlyError(e, "저장하지 못했습니다"), "error"); }
    finally { setBusy(false); }
  };

  return (
    <div className="inv-modal" onClick={onClose}>
      <div className="inv-modal-box inv-modal-wide" onClick={(e) => e.stopPropagation()}>
        <h3 className="inv-modal-title">자재구성{pick ? ` — ${pick.name}` : ""}</h3>
        <p className="inv-modal-desc">
          <b>1개를 만들 때</b> 무엇이 얼마나 드는지 적습니다. 완성할 때 <b>이 양 × 완성 수량</b>만큼 자재가 빠집니다.
          비워 두면 자재는 빠지지 않고 완제품만 늡니다.
        </p>

        {!pick ? (
          <>
            <QuickSearch value={q} onApply={setQ} placeholder="품목명 · SKU · 규격 — 쉼표로 여러 개, Enter" />
            <div className="inv-ship-table">
              <table className="ev-table ev-lined">
                <thead><tr><th>SKU</th><th>품목명</th><th>들어가는 자재</th><th>1개 드는 값</th></tr></thead>
                <tbody>
                  {list.map((p) => {
                    const ls = boms.filter((b) => b.product_id === p.id);
                    const c = ls.reduce((n, b) => n + b.qty * Number(byId.get(b.component_id)?.cost_price || 0), 0);
                    return (
                      <tr key={p.id} className="inv-row-click" onClick={() => setPick(p)}>
                        <td className="mono-number text-left">{p.sku}</td>
                        <td className="text-left"><b>{p.name}</b> <span className="ev-dim">{p.spec || ""}</span></td>
                        <td className="text-left">
                          {ls.length === 0 ? <span className="ev-dim">— 아직 없음</span>
                            : ls.slice(0, 4).map((b) => (
                              <span key={b.id} className="inv-bom-chip">{byId.get(b.component_id)?.name || "?"} <em>×{won(b.qty)}</em></span>
                            ))}
                          {ls.length > 4 && <span className="ev-dim"> 외 {ls.length - 4}</span>}
                        </td>
                        <td className="tr mono-number">{ls.length ? `₩${won(c)}` : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <>
            <div className="inv-ship-table">
              <table className="ev-table ev-lined">
                <thead><tr><th>자재</th><th>1개당</th><th>단가</th><th>드는 값</th><th></th></tr></thead>
                <tbody>
                  {mine.length === 0 && <tr><td colSpan={5} className="tc ev-dim">아직 없습니다 — 아래에서 더하세요</td></tr>}
                  {mine.map((b) => {
                    const c = byId.get(b.component_id);
                    return (
                      <tr key={b.id}>
                        <td className="text-left"><b>{c?.name || "—"}</b> <span className="ev-dim">{c?.sku}</span></td>
                        <td className="tc">
                          <input className="field-input inv-count-input" inputMode="numeric" defaultValue={String(b.qty)}
                            onBlur={(e) => {
                              const v = Number(e.target.value);
                              if (!v || v === b.qty || Number.isNaN(v)) return;
                              run(() => upsertBomLine(companyId!, { id: b.id, product_id: pick.id, component_id: b.component_id, qty: v }));
                            }} />
                        </td>
                        <td className="tr mono-number ev-dim">{c?.cost_price != null ? `₩${won(Number(c.cost_price))}` : "—"}</td>
                        <td className="tr mono-number">₩{won(b.qty * Number(c?.cost_price || 0))}</td>
                        <td className="tc">
                          <button type="button" className="inv-line-x" disabled={busy}
                            onClick={() => run(() => deleteBomLine(b.id))}>✕</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="inv-fill-row">
              <select className="field-input" value={addId} onChange={(e) => setAddId(e.target.value)}>
                <option value="">자재 고르기</option>
                {products.filter((p) => p.id !== pick.id && p.is_active && !mine.some((b) => b.component_id === p.id))
                  .map((p) => <option key={p.id} value={p.id}>{p.sku} · {p.name}{p.spec ? ` (${p.spec})` : ""}</option>)}
              </select>
              <input className="field-input inv-count-input" inputMode="numeric" placeholder="1개당"
                value={addQty} onChange={(e) => setAddQty(e.target.value)} />
              <button type="button" className="btn-secondary btn-sm" disabled={!addId || !(Number(addQty) > 0) || busy}
                onClick={() => run(async () => {
                  await upsertBomLine(companyId!, { product_id: pick.id, component_id: addId, qty: Number(addQty) });
                  setAddId(""); setAddQty("");
                })}>더하기</button>
            </div>
            <div className="inv-modal-foot">1개 만드는 데 드는 값 <b>₩{won(cost)}</b></div>
          </>
        )}

        <div className="inv-modal-actions">
          {pick && <button type="button" className="btn-secondary btn-sm" onClick={() => setPick(null)}>← 품목 목록</button>}
          <span className="doc-sums-sp" />
          <button type="button" className="btn-primary btn-sm" onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
}
