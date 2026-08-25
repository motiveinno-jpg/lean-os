"use client";

// ── 재고 › 구매 — 팝업 세 개 (2026-08-25 재고 3단계) ───────────────────────────
//   ① 발주 만들기 (+ 부족한 품목 채우기)   ② 발주에서 입고   ③ 발주 없이 바로 매입
//   ★ '부족한 품목 채우기'가 이 화면에만 있는 이유 —
//     모자란 양은 (안전재고 − 현재고 − 들어올 것)이다. **이미 시킨 것을 빼지 않으면 두 번 시킨다.**

import { useEffect, useMemo, useState } from "react";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import { todayKst } from "@/lib/kst";
import { createStockDoc, type Product, type Warehouse, type OnHand } from "@/lib/inventory";
import {
  createPurchaseOrder, receivePurchaseOrder,
  type PurchaseOrder, type PurchaseOrderLine, type ReceivedRow, type Incoming,
} from "@/lib/inventory-purchase";
import { LineEditor, PartnerField, type Partner, type LineDraft } from "./line-editor";

const won = (n: number) => Math.round(n || 0).toLocaleString("ko-KR");

// ── ① 발주 만들기 ─────────────────────────────────────────────────────────────
export function PoDialog({ companyId, userId, products, warehouses, partners, onhand, incoming, onClose, onSaved }: {
  companyId: string; userId: string | null; products: Product[]; warehouses: Warehouse[];
  partners: Partner[]; onhand: OnHand[]; incoming: Incoming[];
  onClose: () => void; onSaved: (msg: string) => void;
}) {
  const { toast } = useToast();
  const [orderDate, setOrderDate] = useState(todayKst);
  const [dueDate, setDueDate] = useState("");
  const [partnerId, setPartnerId] = useState("");
  const [partnerName, setPartnerName] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([{ product_id: "", qty: "", unit_price: "" }]);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!warehouseId) setWarehouseId(warehouses.find((w) => w.is_default)?.id || warehouses[0]?.id || ""); }, [warehouses, warehouseId]);

  //   모자란 품목 — 안전재고를 정해 둔 것만 본다. 안 정했으면 얼마가 모자란지 알 길이 없다.
  const shortages = useMemo(() => {
    if (!warehouseId) return [];
    const have = new Map<string, number>();
    for (const r of onhand) if (r.warehouse_id === warehouseId) have.set(r.product_id, r.qty);
    const coming = new Map<string, number>();
    for (const r of incoming) if (r.warehouse_id === warehouseId) coming.set(r.product_id, r.incoming_qty);
    return products
      .filter((p) => p.is_active && p.track_stock && p.safety_stock != null)
      .map((p) => {
        const now = have.get(p.id) ?? 0;
        const inc = coming.get(p.id) ?? 0;
        return { p, now, inc, need: Number(p.safety_stock) - now - inc };
      })
      .filter((x) => x.need > 0);
  }, [products, onhand, incoming, warehouseId]);

  const fillShortages = () => {
    if (!shortages.length) { toast("안전재고보다 모자란 품목이 없습니다", "info"); return; }
    const already = new Set(lines.map((l) => l.product_id).filter(Boolean));
    const add = shortages.filter((x) => !already.has(x.p.id)).map((x) => ({
      product_id: x.p.id, qty: String(x.need), unit_price: x.p.cost_price != null ? String(x.p.cost_price) : "",
    }));
    if (!add.length) { toast("모자란 품목이 이미 다 들어 있습니다", "info"); return; }
    setLines((s) => [...s.filter((l) => l.product_id), ...add]);
    toast(`모자란 ${add.length}줄을 넣었습니다 — 수량은 고치셔도 됩니다`, "success");
  };

  const ready = lines.some((l) => l.product_id && Number(l.qty) > 0) && !!warehouseId;
  const total = lines.reduce((n, l) => n + (Number(l.qty) || 0) * (Number(l.unit_price) || 0), 0);

  return (
    <div className="inv-modal" onClick={onClose}>
      <div className="inv-modal-box inv-modal-wide" onClick={(e) => e.stopPropagation()}>
        <h3 className="inv-modal-title">발주하기</h3>
        <p className="inv-modal-desc">
          발주는 <b>약속</b>입니다 — 시킨다고 재고가 늘지 않고 <b>들어올 것</b>으로만 잡힙니다.
          실제로 느는 것은 <b>입고</b>할 때입니다.
        </p>
        <div className="inv-grid2">
          <label className="inv-field"><span>발주일 *</span>
            <input type="date" className="field-input" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} /></label>
          <label className="inv-field"><span>받기로 한 날</span>
            <input type="date" className="field-input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></label>
        </div>
        <PartnerField partners={partners} partnerId={partnerId} setPartnerId={setPartnerId}
          partnerName={partnerName} setPartnerName={setPartnerName} hint="또는 이름만 적기 (시장·일회성 매입 등)" />
        <label className="inv-field"><span>받을 창고 *</span>
          <select className="field-input" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
            {warehouses.length === 0 && <option value="">창고가 없습니다 — 재고 › 창고에서 먼저 만드세요</option>}
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select></label>

        <div className="inv-fill-row">
          <button type="button" className="btn-secondary btn-sm" onClick={fillShortages}>부족한 품목 채우기</button>
          <span className="inv-hint">
            {shortages.length > 0
              ? <>안전재고보다 모자란 <b>{shortages.length}품목</b>이 있습니다 — <b>이미 시킨 것을 빼고</b> 셉니다.</>
              : <>안전재고보다 모자란 품목이 없습니다. 안전재고를 정하지 않은 품목은 셀 수 없습니다.</>}
          </span>
        </div>

        <LineEditor lines={lines} setLines={setLines} products={products} priceOf={(p) => p.cost_price} />

        <label className="inv-field"><span>메모</span>
          <input className="field-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="납기 요청 등" /></label>

        <div className="inv-modal-foot">발주 금액 <b>₩{won(total)}</b></div>
        <div className="inv-modal-actions">
          <button type="button" className="btn-secondary btn-sm" onClick={onClose}>취소</button>
          <button type="button" className="btn-primary btn-sm" disabled={!ready || busy}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await createPurchaseOrder(companyId, {
                  orderDate, dueDate: dueDate || null, partnerId: partnerId || null,
                  partnerName: partnerName || null, warehouseId, note,
                  lines: lines.filter((l) => l.product_id && Number(l.qty) > 0)
                    .map((l) => ({ product_id: l.product_id, qty: Number(l.qty), unit_price: l.unit_price ? Number(l.unit_price) : null })),
                }, userId);
                onSaved(`${r.poNo} 로 발주했습니다`);
              } catch (e) { toast(friendlyError(e, "저장하지 못했습니다"), "error"); }
              finally { setBusy(false); }
            }}>발주하기</button>
        </div>
      </div>
    </div>
  );
}

// ── ② 발주에서 입고 ───────────────────────────────────────────────────────────
export function ReceiveDialog({ companyId, userId, order, lines, received, products, onClose, onSaved }: {
  companyId: string; userId: string | null; order: PurchaseOrder;
  lines: PurchaseOrderLine[]; received: ReceivedRow[]; products: Map<string, Product>;
  onClose: () => void; onSaved: (msg: string) => void;
}) {
  const { toast } = useToast();
  const gotOf = useMemo(() => new Map(received.map((s) => [s.po_line_id, s.received_qty])), [received]);
  //   남은 수량이 기본값. 덜 왔으면 줄이고, 잘못 받았으면 음수로 되돌린다.
  const [qty, setQty] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = {};
    for (const l of lines) {
      const rest = l.qty - (gotOf.get(l.id) ?? 0);
      o[l.id] = rest > 0 ? String(rest) : "";
    }
    return o;
  });
  const [docDate, setDocDate] = useState(todayKst);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const use = lines.map((l) => ({ l, n: Number(qty[l.id]) })).filter((x) => x.n && !Number.isNaN(x.n));
  const done = order.status === "done";

  return (
    <div className="inv-modal" onClick={onClose}>
      <div className="inv-modal-box inv-modal-wide" onClick={(e) => e.stopPropagation()}>
        <h3 className="inv-modal-title">{done ? "반품 — " : "입고 — "}{order.po_no}</h3>
        <p className="inv-modal-desc">
          {done ? (
            <>이 발주는 <b>다 받았습니다</b>. 돌려보낼 수량을 <b>음수로</b> 적으세요 — 재고가 줄고
              발주는 저절로 &lsquo;받을 것&rsquo;으로 돌아갑니다.</>
          ) : (
            <>남은 수량을 미리 넣어 두었습니다. <b>덜 왔으면 줄이세요</b> — 남은 것은 발주에 그대로 남습니다.
              잘못 받은 것은 <b>음수</b>로 돌려보냅니다.</>
          )}
        </p>
        <label className="inv-field"><span>입고일 *</span>
          <input type="date" className="field-input" value={docDate} onChange={(e) => setDocDate(e.target.value)} /></label>

        <div className="inv-ship-table">
          <table className="ev-table ev-lined">
            <thead><tr><th>품목</th><th>발주</th><th>받음</th><th>남음</th><th>이번에</th></tr></thead>
            <tbody>
              {lines.map((l) => {
                const p = products.get(l.product_id);
                const got = gotOf.get(l.id) ?? 0;
                const rest = l.qty - got;
                return (
                  <tr key={l.id}>
                    <td className="text-left"><b>{p?.name || "—"}</b> <span className="ev-dim">{p?.sku}</span></td>
                    <td className="tr mono-number">{won(l.qty)}</td>
                    <td className="tr mono-number ev-dim">{won(got)}</td>
                    <td className="tr mono-number"><b className={rest > 0 ? undefined : "ev-dim"}>{won(rest)}</b></td>
                    <td className="tc">
                      <input className="field-input inv-count-input" inputMode="numeric" placeholder="—"
                        value={qty[l.id] ?? ""} onChange={(e) => setQty((s) => ({ ...s, [l.id]: e.target.value }))} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <label className="inv-field"><span>메모</span>
          <input className="field-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="거래명세서 번호 등" /></label>

        <div className="inv-modal-actions">
          <button type="button" className="btn-secondary btn-sm" onClick={onClose}>취소</button>
          <button type="button" className="btn-primary btn-sm" disabled={!use.length || busy}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await receivePurchaseOrder(companyId, order.id,
                  use.map((x) => ({ po_line_id: x.l.id, product_id: x.l.product_id, qty: x.n, unit_price: x.l.unit_price })),
                  { docDate, note }, userId);
                onSaved(use.some((x) => x.n < 0) ? `${r.docNo} 로 돌려보냈습니다` : `${r.docNo} 로 받았습니다`);
              } catch (e) { toast(friendlyError(e, "받지 못했습니다"), "error"); }
              finally { setBusy(false); }
            }}>{done ? "반품 넣기" : "받기"}</button>
        </div>
      </div>
    </div>
  );
}

// ── ③ 발주 없이 바로 매입 ─────────────────────────────────────────────────────
export function DirectReceiveDialog({ companyId, userId, products, warehouses, partners, onClose, onSaved }: {
  companyId: string; userId: string | null; products: Product[]; warehouses: Warehouse[];
  partners: Partner[]; onClose: () => void; onSaved: (msg: string) => void;
}) {
  const { toast } = useToast();
  const [docDate, setDocDate] = useState(todayKst);
  const [partnerId, setPartnerId] = useState("");
  const [partnerName, setPartnerName] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([{ product_id: "", qty: "", unit_price: "" }]);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!warehouseId) setWarehouseId(warehouses.find((w) => w.is_default)?.id || warehouses[0]?.id || ""); }, [warehouses, warehouseId]);

  const use = lines.filter((l) => l.product_id && Number(l.qty) && !Number.isNaN(Number(l.qty)));
  const total = use.reduce((n, l) => n + Number(l.qty) * (Number(l.unit_price) || 0), 0);
  const hasMinus = use.some((l) => Number(l.qty) < 0);

  return (
    <div className="inv-modal" onClick={onClose}>
      <div className="inv-modal-box inv-modal-wide" onClick={(e) => e.stopPropagation()}>
        <h3 className="inv-modal-title">바로 매입</h3>
        <p className="inv-modal-desc">
          발주서를 적지 않고 <b>사 온 것만</b> 기록합니다 — 시장 매입·급한 보충이 이렇습니다.
          바로 재고가 늘고, 매입 이력에 남습니다.
        </p>
        <div className="inv-grid2">
          <label className="inv-field"><span>매입일 *</span>
            <input type="date" className="field-input" value={docDate} onChange={(e) => setDocDate(e.target.value)} /></label>
          <label className="inv-field"><span>받을 창고 *</span>
            <select className="field-input" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              {warehouses.length === 0 && <option value="">창고가 없습니다</option>}
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select></label>
        </div>
        <PartnerField partners={partners} partnerId={partnerId} setPartnerId={setPartnerId}
          partnerName={partnerName} setPartnerName={setPartnerName} hint="또는 이름만 적기 (시장·일회성 매입 등)" />

        <LineEditor lines={lines} setLines={setLines} products={products} priceOf={(p) => p.cost_price} />

        {hasMinus && (
          <p className="inv-warn">수량이 음수인 줄은 <b>매입 취소</b>로 읽습니다 — 재고가 다시 줄어듭니다.</p>
        )}
        <label className="inv-field"><span>메모</span>
          <input className="field-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="거래명세서 번호 등" /></label>

        <div className="inv-modal-foot">매입 금액 <b>₩{won(total)}</b></div>
        <div className="inv-modal-actions">
          <button type="button" className="btn-secondary btn-sm" onClick={onClose}>취소</button>
          <button type="button" className="btn-primary btn-sm" disabled={!use.length || !warehouseId || busy}
            onClick={async () => {
              setBusy(true);
              try {
                const memo = [note.trim(), partnerName.trim() ? `거래처: ${partnerName.trim()}` : ""].filter(Boolean).join(" · ");
                const r = await createStockDoc(companyId, {
                  reason: "purchase", docDate, warehouseId, partnerId: partnerId || null, note: memo || null,
                  lines: use.map((l) => ({ product_id: l.product_id, qty: Number(l.qty), unit_price: l.unit_price ? Number(l.unit_price) : null })),
                }, userId);
                onSaved(r.skipped > 0
                  ? `${r.docNo} 로 기록했습니다 · 수량을 세지 않는 ${r.skipped}줄은 뺐습니다`
                  : `${r.docNo} 로 기록했습니다`);
              } catch (e) { toast(friendlyError(e, "기록하지 못했습니다"), "error"); }
              finally { setBusy(false); }
            }}>매입 기록</button>
        </div>
      </div>
    </div>
  );
}
