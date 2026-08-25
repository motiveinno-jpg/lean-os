"use client";

// ── 재고 › 생산 — 팝업 셋 (2026-08-25 재고 4단계) ──────────────────────────────
//   ① 자재구성 고치기   ② 작업지시 내기   ③ 완성하기
//   ★ ③이 이 화면의 전부다 — 완성하면 **자재가 빠지고 완제품이 는다.** 둘은 같이 일어난다(결정 14).

import { useEffect, useMemo, useState } from "react";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import { todayKst } from "@/lib/kst";
import type { Product, Warehouse, OnHand } from "@/lib/inventory";
import {
  upsertBomLine, deleteBomLine, createWorkOrder, completeWorkOrder,
  type BomLine, type WorkOrder,
} from "@/lib/inventory-production";

const won = (n: number) => Math.round(n || 0).toLocaleString("ko-KR");

// ── ① 자재구성 고치기 ─────────────────────────────────────────────────────────
export function BomDialog({ companyId, product, products, boms, onClose, onSaved }: {
  companyId: string; product: Product; products: Product[]; boms: BomLine[];
  onClose: () => void; onSaved: () => void;
}) {
  const { toast } = useToast();
  const mine = useMemo(() => boms.filter((b) => b.product_id === product.id), [boms, product.id]);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const [addId, setAddId] = useState("");
  const [addQty, setAddQty] = useState("");
  const [busy, setBusy] = useState(false);

  const cost = mine.reduce((n, b) => n + b.qty * Number(byId.get(b.component_id)?.cost_price || 0), 0);

  const save = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); onSaved(); }
    catch (e) { toast(friendlyError(e, "저장하지 못했습니다"), "error"); }
    finally { setBusy(false); }
  };

  return (
    <div className="inv-modal" onClick={onClose}>
      <div className="inv-modal-box inv-modal-wide" onClick={(e) => e.stopPropagation()}>
        <h3 className="inv-modal-title">자재구성 — {product.name}</h3>
        <p className="inv-modal-desc">
          <b>{product.name} 1개</b>를 만들 때 무엇이 얼마나 드는지 적습니다.
          완성할 때 이 양 × 완성 수량만큼 자재가 빠집니다. <b>여기가 비어 있으면 자재는 빠지지 않습니다.</b>
        </p>

        <div className="inv-ship-table">
          <table className="ev-table ev-lined">
            <thead><tr><th>자재</th><th>1개당</th><th>단가</th><th>드는 값</th><th></th></tr></thead>
            <tbody>
              {mine.length === 0 && (
                <tr><td colSpan={5} className="tc ev-dim">아직 없습니다 — 아래에서 자재를 더하세요.</td></tr>
              )}
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
                          save(() => upsertBomLine(companyId, { id: b.id, product_id: product.id, component_id: b.component_id, qty: v }));
                        }} />
                    </td>
                    <td className="tr mono-number ev-dim">{c?.cost_price != null ? `₩${won(Number(c.cost_price))}` : "—"}</td>
                    <td className="tr mono-number">₩{won(b.qty * Number(c?.cost_price || 0))}</td>
                    <td className="tc">
                      <button type="button" className="inv-line-x" aria-label="빼기" disabled={busy}
                        onClick={() => save(() => deleteBomLine(b.id))}>✕</button>
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
            {products.filter((p) => p.id !== product.id && p.is_active && !mine.some((b) => b.component_id === p.id))
              .map((p) => <option key={p.id} value={p.id}>{p.sku} · {p.name}{p.spec ? ` (${p.spec})` : ""}</option>)}
          </select>
          <input className="field-input inv-count-input" inputMode="numeric" placeholder="1개당"
            value={addQty} onChange={(e) => setAddQty(e.target.value)} />
          <button type="button" className="btn-secondary btn-sm" disabled={!addId || !(Number(addQty) > 0) || busy}
            onClick={() => save(async () => {
              await upsertBomLine(companyId, { product_id: product.id, component_id: addId, qty: Number(addQty) });
              setAddId(""); setAddQty("");
            })}>더하기</button>
        </div>

        <div className="inv-modal-foot">1개 만드는 데 드는 값 <b>₩{won(cost)}</b></div>
        <div className="inv-modal-actions">
          <button type="button" className="btn-primary btn-sm" onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
}

// ── ② 작업지시 내기 ───────────────────────────────────────────────────────────
export function WoDialog({ companyId, userId, products, warehouses, boms, onhand, onClose, onSaved }: {
  companyId: string; userId: string | null; products: Product[]; warehouses: Warehouse[];
  boms: BomLine[]; onhand: OnHand[]; onClose: () => void; onSaved: (msg: string) => void;
}) {
  const { toast } = useToast();
  const [productId, setProductId] = useState("");
  const [qty, setQty] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [orderDate, setOrderDate] = useState(todayKst);
  const [dueDate, setDueDate] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!warehouseId) setWarehouseId(warehouses.find((w) => w.is_default)?.id || warehouses[0]?.id || ""); }, [warehouses, warehouseId]);

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const mine = useMemo(() => boms.filter((b) => b.product_id === productId), [boms, productId]);
  const have = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of onhand) if (r.warehouse_id === warehouseId) m.set(r.product_id, r.qty);
    return m;
  }, [onhand, warehouseId]);

  //   만들기 전에 보여 주는 것 — **모자라도 막지 않는다**(결정 16). 알고 만들라는 뜻이다.
  const need = useMemo(() => mine.map((b) => {
    const n = b.qty * (Number(qty) || 0);
    const has = have.get(b.component_id) ?? 0;
    return { b, c: byId.get(b.component_id), need: n, has, short: n - has };
  }), [mine, qty, have, byId]);
  const shortCount = need.filter((x) => x.short > 0).length;
  const cost = need.reduce((n, x) => n + x.need * Number(x.c?.cost_price || 0), 0);

  //   만들 수 있는 것 = BOM 이 있는 품목을 앞에. 없는 것도 고를 수 있다(자재 없이 완제품만 늘린다).
  const makeable = useMemo(() => {
    const withBom = new Set(boms.map((b) => b.product_id));
    const list = products.filter((p) => p.is_active && p.track_stock);
    return [...list.filter((p) => withBom.has(p.id)), ...list.filter((p) => !withBom.has(p.id))];
  }, [products, boms]);
  const hasBom = mine.length > 0;

  return (
    <div className="inv-modal" onClick={onClose}>
      <div className="inv-modal-box inv-modal-wide" onClick={(e) => e.stopPropagation()}>
        <h3 className="inv-modal-title">작업지시 내기</h3>
        <p className="inv-modal-desc">
          지시를 낸다고 재고가 움직이지 않습니다 — <b>완성할 때</b> 자재가 빠지고 완제품이 늡니다.
        </p>
        <div className="inv-grid2">
          <label className="inv-field"><span>만들 것 *</span>
            <select className="field-input" value={productId} onChange={(e) => setProductId(e.target.value)}>
              <option value="">품목 고르기</option>
              {makeable.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.sku} · {p.name}{p.spec ? ` (${p.spec})` : ""}{boms.some((b) => b.product_id === p.id) ? " — 자재구성 있음" : ""}
                </option>
              ))}
            </select></label>
          <label className="inv-field"><span>만들 수량 *</span>
            <input className="field-input" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} /></label>
        </div>
        <div className="inv-grid2">
          <label className="inv-field"><span>지시일 *</span>
            <input type="date" className="field-input" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} /></label>
          <label className="inv-field"><span>마치기로 한 날</span>
            <input type="date" className="field-input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></label>
        </div>
        <label className="inv-field"><span>창고 *</span>
          <select className="field-input" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
            {warehouses.length === 0 && <option value="">창고가 없습니다 — 재고 › 창고에서 먼저 만드세요</option>}
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select></label>

        {productId && (
          hasBom ? (
            <div className="inv-ship-table">
              <table className="ev-table ev-lined">
                <thead><tr><th>들어갈 자재</th><th>1개당</th><th>이만큼 필요</th><th>지금 있음</th><th>모자람</th></tr></thead>
                <tbody>
                  {need.map((x) => (
                    <tr key={x.b.id} className={x.short > 0 ? "inv-row-diff" : undefined}>
                      <td className="text-left"><b>{x.c?.name || "—"}</b> <span className="ev-dim">{x.c?.sku}</span></td>
                      <td className="tr mono-number ev-dim">{won(x.b.qty)}</td>
                      <td className="tr mono-number">{won(x.need)}</td>
                      <td className="tr mono-number ev-dim">{won(x.has)}</td>
                      <td className="tr mono-number">
                        {x.short > 0 ? <b className="inv-diff-minus">{won(x.short)}</b> : <span className="ev-dim">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="inv-warn">
              이 품목은 <b>자재구성이 없습니다</b> — 완성해도 자재가 빠지지 않고 <b>완제품만 늡니다</b>.
              자재를 세려면 <b>자재구성</b> 갈래에서 먼저 적으세요.
            </p>
          )
        )}
        {shortCount > 0 && (
          <p className="inv-warn">
            <b>{shortCount}가지가 모자랍니다.</b> 그래도 지시는 낼 수 있습니다 —
            모자란 채로 완성하면 그 자재는 <b>음수</b>가 되어 재고 화면의 &lsquo;맞춰야 할 것&rsquo;으로 섭니다.
            먼저 채우려면 <b>재고 › 구매</b>에서 발주하세요.
          </p>
        )}

        <label className="inv-field"><span>메모</span>
          <input className="field-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="작업 지시 사항 등" /></label>

        {productId && hasBom && <div className="inv-modal-foot">드는 자재 값 <b>₩{won(cost)}</b></div>}
        <div className="inv-modal-actions">
          <button type="button" className="btn-secondary btn-sm" onClick={onClose}>취소</button>
          <button type="button" className="btn-primary btn-sm" disabled={!productId || !(Number(qty) > 0) || !warehouseId || busy}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await createWorkOrder(companyId, {
                  productId, plannedQty: Number(qty), warehouseId, orderDate, dueDate: dueDate || null, note,
                }, userId);
                onSaved(`${r.woNo} 로 지시했습니다`);
              } catch (e) { toast(friendlyError(e, "저장하지 못했습니다"), "error"); }
              finally { setBusy(false); }
            }}>지시하기</button>
        </div>
      </div>
    </div>
  );
}

// ── ③ 완성하기 ───────────────────────────────────────────────────────────────
export function CompleteDialog({ companyId, userId, wo, done, products, boms, onhand, onClose, onSaved }: {
  companyId: string; userId: string | null; wo: WorkOrder; done: number;
  products: Map<string, Product>; boms: BomLine[]; onhand: OnHand[];
  onClose: () => void; onSaved: (msg: string) => void;
}) {
  const { toast } = useToast();
  const rest = wo.planned_qty - done;
  const [qty, setQty] = useState(rest > 0 ? String(rest) : "");
  const [docDate, setDocDate] = useState(todayKst);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [saveCost, setSaveCost] = useState(true);

  const mine = useMemo(() => boms.filter((b) => b.product_id === wo.product_id), [boms, wo.product_id]);
  const have = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of onhand) if (r.warehouse_id === wo.warehouse_id) m.set(r.product_id, r.qty);
    return m;
  }, [onhand, wo.warehouse_id]);

  const n = Number(qty);
  const valid = !!qty && !Number.isNaN(n) && n !== 0;
  const rows = mine.map((b) => {
    const use = b.qty * (valid ? n : 0);
    const has = have.get(b.component_id) ?? 0;
    return { b, c: products.get(b.component_id), use, has, after: has - use };
  });
  const willMinus = rows.filter((r) => r.after < 0).length;
  //   1개 만드는 데 드는 값 — 새로 생긴 물건의 원가는 이것말고 재줄 것이 없다.
  const made = products.get(wo.product_id);
  const unitCost = mine.reduce((n2, b) => n2 + b.qty * Number(products.get(b.component_id)?.cost_price || 0), 0);
  const costEmpty = made?.cost_price == null;

  return (
    <div className="inv-modal" onClick={onClose}>
      <div className="inv-modal-box inv-modal-wide" onClick={(e) => e.stopPropagation()}>
        <h3 className="inv-modal-title">완성 — {wo.wo_no}</h3>
        <p className="inv-modal-desc">
          완성하면 <b>자재가 빠지고 완제품이 늡니다</b> — 두 기록이 같이 섭니다.
          <b> 되돌릴 때는 음수</b>를 적으세요(자재가 돌아오고 완제품이 빠집니다).
        </p>
        <div className="inv-grid2">
          <label className="inv-field"><span>완성 수량 *</span>
            <input className="field-input" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} /></label>
          <label className="inv-field"><span>완성일 *</span>
            <input type="date" className="field-input" value={docDate} onChange={(e) => setDocDate(e.target.value)} /></label>
        </div>
        <p className="inv-hint">지시 {won(wo.planned_qty)}개 중 <b>{won(done)}개</b> 완성 · 남은 것 <b>{won(Math.max(rest, 0))}개</b></p>

        {mine.length > 0 ? (
          <div className="inv-ship-table">
            <table className="ev-table ev-lined">
              <thead><tr><th>빠질 자재</th><th>이만큼</th><th>지금</th><th>빠진 뒤</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.b.id} className={r.after < 0 ? "inv-row-fix" : undefined}>
                    <td className="text-left"><b>{r.c?.name || "—"}</b> <span className="ev-dim">{r.c?.sku}</span></td>
                    <td className="tr mono-number">{won(r.use)}</td>
                    <td className="tr mono-number ev-dim">{won(r.has)}</td>
                    <td className="tr mono-number"><b className={r.after < 0 ? "inv-diff-minus" : undefined}>{won(r.after)}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="inv-warn">자재구성이 없어 <b>완제품만 늡니다</b> — 자재는 빠지지 않습니다.</p>
        )}
        {willMinus > 0 && (
          <p className="inv-warn">
            <b>{willMinus}가지가 음수가 됩니다.</b> 막지 않습니다 — 이미 만든 것을 못 적게 하는 편이 더 나쁩니다.
            음수는 재고 화면의 <b>&lsquo;맞춰야 할 것&rsquo;</b>으로 서니 나중에 입고를 적어 맞추세요.
          </p>
        )}

        {unitCost > 0 && costEmpty && n > 0 && (
          <label className="inv-check">
            <input type="checkbox" checked={saveCost} onChange={(e) => setSaveCost(e.target.checked)} />
            <span><b>1개 드는 값 ₩{won(unitCost)}</b> 을 품목 원가로 적어 두기
              <em>— 이 품목은 원가가 비어 있어 재고금액이 0 으로 잡힙니다. 이미 적힌 값은 건드리지 않습니다.</em></span>
          </label>
        )}
        <label className="inv-field"><span>메모</span>
          <input className="field-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="작업자 · 불량 수량 등" /></label>

        <div className="inv-modal-actions">
          <button type="button" className="btn-secondary btn-sm" onClick={onClose}>취소</button>
          <button type="button" className="btn-primary btn-sm" disabled={!valid || busy}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await completeWorkOrder(companyId, wo, n, boms, {
                  docDate, note,
                  unitCost: unitCost > 0 ? unitCost : null,
                  saveCost: saveCost && costEmpty && n > 0,
                }, userId);
                onSaved(r.matDocNo
                  ? `${r.prodDocNo} · 자재 ${r.matDocNo} 로 기록했습니다`
                  : `${r.prodDocNo} 로 기록했습니다 (자재구성이 없어 자재는 안 뺐습니다)`);
              } catch (e) { toast(friendlyError(e, "기록하지 못했습니다"), "error"); }
              finally { setBusy(false); }
            }}>{n < 0 ? "되돌리기" : "완성 기록"}</button>
        </div>
      </div>
    </div>
  );
}
