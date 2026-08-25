"use client";

// ── 재고 › 판매 — 팝업 세 개 (2026-08-25 재고 2단계) ───────────────────────────
//   ① 주문 만들기   ② 주문에서 출고   ③ 주문 없이 바로 출고
//   ★ ③이 곁다리가 아니라는 점이 이 화면의 성격을 정한다(결정 5) —
//     현장·온라인은 주문을 안 적고 판다. 그래서 '바로 출고'는 주문과 같은 자리에 둔다.

import { useEffect, useMemo, useState } from "react";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import { todayKst } from "@/lib/kst";
import { createStockDoc, type Product, type Warehouse } from "@/lib/inventory";
import {
  createSalesOrder, shipSalesOrder,
  type SalesOrder, type SalesOrderLine, type ShippedRow, type Available,
} from "@/lib/inventory-sales";

const won = (n: number) => Math.round(n || 0).toLocaleString("ko-KR");
export type Partner = { id: string; name: string };

type LineDraft = { product_id: string; qty: string; unit_price: string };

/** 품목·수량·단가 세 칸짜리 줄 편집기 — 주문과 바로 출고가 같이 쓴다. */
function LineEditor({ lines, setLines, products, availableOf }: {
  lines: LineDraft[]; setLines: (f: (s: LineDraft[]) => LineDraft[]) => void;
  products: Product[]; availableOf?: (productId: string) => number | null;
}) {
  const tracked = useMemo(() => products.filter((p) => p.is_active), [products]);
  const set = (i: number, k: keyof LineDraft, v: string) =>
    setLines((s) => s.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  return (
    <div className="inv-lines">
      {lines.map((l, i) => {
        const p = products.find((x) => x.id === l.product_id);
        const avail = l.product_id && availableOf ? availableOf(l.product_id) : null;
        const qty = Number(l.qty);
        const short = avail != null && !Number.isNaN(qty) && qty > avail;
        return (
          <div key={i} className="inv-line">
            <select className="field-input" value={l.product_id}
              onChange={(e) => {
                const np = products.find((x) => x.id === e.target.value);
                set(i, "product_id", e.target.value);
                //   단가를 안 적었으면 품목의 판매가를 넣어 준다 — 채워만 주고 고치는 것은 사람이다.
                if (np?.sale_price != null && !l.unit_price) set(i, "unit_price", String(np.sale_price));
              }}>
              <option value="">품목 고르기</option>
              {tracked.map((x) => <option key={x.id} value={x.id}>{x.sku} · {x.name}{x.spec ? ` (${x.spec})` : ""}</option>)}
            </select>
            <input className="field-input" inputMode="numeric" placeholder="수량" value={l.qty}
              onChange={(e) => set(i, "qty", e.target.value)} />
            <input className="field-input" inputMode="numeric" placeholder="단가" value={l.unit_price}
              onChange={(e) => set(i, "unit_price", e.target.value)} />
            <span className={short ? "inv-line-eff inv-line-eff-out" : "inv-line-eff"}>
              {!l.qty || Number.isNaN(qty) ? "—" : `₩${won(qty * Number(l.unit_price || 0))}`}
              {p && !p.track_stock ? <b className="inv-line-undo">수량 없음</b> : null}
              {short ? <b className="inv-line-undo">가능 {won(avail!)}</b> : null}
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

/** 거래처 — 골라도 되고 그냥 적어도 된다(온라인 주문은 거래처를 안 만든다). */
function PartnerField({ partners, partnerId, setPartnerId, partnerName, setPartnerName }: {
  partners: Partner[]; partnerId: string; setPartnerId: (v: string) => void;
  partnerName: string; setPartnerName: (v: string) => void;
}) {
  return (
    <label className="inv-field"><span>거래처</span>
      <div className="inv-partner">
        <select className="field-input" value={partnerId}
          onChange={(e) => { setPartnerId(e.target.value); if (e.target.value) setPartnerName(""); }}>
          <option value="">— 등록된 거래처에서 고르기 —</option>
          {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <input className="field-input" placeholder="또는 이름만 적기 (온라인 주문 등)" value={partnerName}
          onChange={(e) => { setPartnerName(e.target.value); if (e.target.value) setPartnerId(""); }} />
      </div>
    </label>
  );
}

// ── ① 주문 만들기 ─────────────────────────────────────────────────────────────
export function OrderDialog({ companyId, userId, products, warehouses, partners, available, onClose, onSaved }: {
  companyId: string; userId: string | null; products: Product[]; warehouses: Warehouse[];
  partners: Partner[]; available: Available[]; onClose: () => void; onSaved: (msg: string) => void;
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

  const availableOf = (pid: string) => {
    const rows = available.filter((a) => a.product_id === pid && (!warehouseId || a.warehouse_id === warehouseId));
    return rows.length ? rows.reduce((n, a) => n + a.available_qty, 0) : 0;
  };
  const ready = lines.some((l) => l.product_id && Number(l.qty) > 0) && !!warehouseId;
  const total = lines.reduce((n, l) => n + (Number(l.qty) || 0) * (Number(l.unit_price) || 0), 0);

  return (
    <div className="inv-modal" onClick={onClose}>
      <div className="inv-modal-box inv-modal-wide" onClick={(e) => e.stopPropagation()}>
        <h3 className="inv-modal-title">주문 받기</h3>
        <p className="inv-modal-desc">
          주문은 <b>약속</b>입니다 — 받는 순간 재고가 줄지 않고 <b>판매가능수량</b>만 줄어듭니다.
          실제로 나가는 것은 <b>출고</b>할 때입니다.
        </p>
        <div className="inv-grid2">
          <label className="inv-field"><span>주문일 *</span>
            <input type="date" className="field-input" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} /></label>
          <label className="inv-field"><span>주기로 한 날</span>
            <input type="date" className="field-input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></label>
        </div>
        <PartnerField partners={partners} partnerId={partnerId} setPartnerId={setPartnerId}
          partnerName={partnerName} setPartnerName={setPartnerName} />
        <label className="inv-field"><span>나갈 창고 *</span>
          <select className="field-input" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
            {warehouses.length === 0 && <option value="">창고가 없습니다 — 재고 › 창고에서 먼저 만드세요</option>}
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select></label>

        <LineEditor lines={lines} setLines={setLines} products={products} availableOf={availableOf} />

        <label className="inv-field"><span>메모</span>
          <input className="field-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="배송 요청 등" /></label>

        <div className="inv-modal-foot">주문 금액 <b>₩{won(total)}</b></div>
        <div className="inv-modal-actions">
          <button type="button" className="btn-secondary btn-sm" onClick={onClose}>취소</button>
          <button type="button" className="btn-primary btn-sm" disabled={!ready || busy}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await createSalesOrder(companyId, {
                  orderDate, dueDate: dueDate || null, partnerId: partnerId || null,
                  partnerName: partnerName || null, warehouseId, note,
                  lines: lines.filter((l) => l.product_id && Number(l.qty) > 0)
                    .map((l) => ({ product_id: l.product_id, qty: Number(l.qty), unit_price: l.unit_price ? Number(l.unit_price) : null })),
                }, userId);
                onSaved(`${r.orderNo} 로 주문을 받았습니다`);
              } catch (e) { toast(friendlyError(e, "저장하지 못했습니다"), "error"); }
              finally { setBusy(false); }
            }}>주문 받기</button>
        </div>
      </div>
    </div>
  );
}

// ── ② 주문에서 출고 ───────────────────────────────────────────────────────────
export function ShipDialog({ companyId, userId, order, lines, shipped, products, onClose, onSaved }: {
  companyId: string; userId: string | null; order: SalesOrder;
  lines: SalesOrderLine[]; shipped: ShippedRow[]; products: Map<string, Product>;
  onClose: () => void; onSaved: (msg: string) => void;
}) {
  const { toast } = useToast();
  const shippedOf = useMemo(() => new Map(shipped.map((s) => [s.order_line_id, s.shipped_qty])), [shipped]);
  //   남은 수량을 기본값으로 넣는다 — 대부분은 남은 것을 그대로 내보낸다. 부분 출고면 줄이면 된다.
  const [qty, setQty] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = {};
    for (const l of lines) {
      const rest = l.qty - (shippedOf.get(l.id) ?? 0);
      o[l.id] = rest > 0 ? String(rest) : "";
    }
    return o;
  });
  const [docDate, setDocDate] = useState(todayKst);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const use = lines.map((l) => ({ l, n: Number(qty[l.id]) })).filter((x) => x.n && !Number.isNaN(x.n));
  const ready = use.length > 0;

  return (
    <div className="inv-modal" onClick={onClose}>
      <div className="inv-modal-box inv-modal-wide" onClick={(e) => e.stopPropagation()}>
        <h3 className="inv-modal-title">{order.status === "done" ? "반품 — " : "출고 — "}{order.order_no}</h3>
        <p className="inv-modal-desc">
          {order.status === "done" ? (
            <>이 주문은 <b>다 나갔습니다</b>. 되돌릴 수량을 <b>음수로</b> 적으세요 — 재고가 다시 늘고
              주문은 저절로 &lsquo;보낼 것&rsquo;으로 돌아갑니다.</>
          ) : (
            <>남은 수량을 미리 넣어 두었습니다. <b>일부만 보낼 때는 줄이세요</b> — 남은 것은 주문에 그대로 남습니다.
              되돌릴 때는 <b>음수</b>를 넣으면 반품으로 잡힙니다.</>
          )}
        </p>
        <label className="inv-field"><span>출고일 *</span>
          <input type="date" className="field-input" value={docDate} onChange={(e) => setDocDate(e.target.value)} /></label>

        <div className="inv-ship-table">
          <table className="ev-table ev-lined">
            <thead><tr><th>품목</th><th>주문</th><th>나감</th><th>남음</th><th>이번에</th></tr></thead>
            <tbody>
              {lines.map((l) => {
                const p = products.get(l.product_id);
                const done = shippedOf.get(l.id) ?? 0;
                const rest = l.qty - done;
                return (
                  <tr key={l.id}>
                    <td className="text-left"><b>{p?.name || "—"}</b> <span className="ev-dim">{p?.sku}</span></td>
                    <td className="tr mono-number">{won(l.qty)}</td>
                    <td className="tr mono-number ev-dim">{won(done)}</td>
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
          <input className="field-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="송장번호 등" /></label>

        <div className="inv-modal-actions">
          <button type="button" className="btn-secondary btn-sm" onClick={onClose}>취소</button>
          <button type="button" className="btn-primary btn-sm" disabled={!ready || busy}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await shipSalesOrder(companyId, order.id,
                  use.map((x) => ({ order_line_id: x.l.id, product_id: x.l.product_id, qty: x.n, unit_price: x.l.unit_price })),
                  { docDate, note }, userId);
                onSaved(use.some((x) => x.n < 0)
                  ? `${r.docNo} 로 되돌렸습니다`
                  : `${r.docNo} 로 내보냈습니다`);
              } catch (e) { toast(friendlyError(e, "내보내지 못했습니다"), "error"); }
              finally { setBusy(false); }
            }}>{order.status === "done" ? "반품 넣기" : "내보내기"}</button>
        </div>
      </div>
    </div>
  );
}

// ── ③ 주문 없이 바로 출고 ─────────────────────────────────────────────────────
export function DirectShipDialog({ companyId, userId, products, warehouses, partners, onClose, onSaved }: {
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
        <h3 className="inv-modal-title">바로 판매</h3>
        <p className="inv-modal-desc">
          주문을 적지 않고 <b>판 것만</b> 기록합니다 — 현장·온라인 판매가 이렇습니다.
          바로 재고가 줄고, 판매 이력에 남습니다.
        </p>
        <div className="inv-grid2">
          <label className="inv-field"><span>판매일 *</span>
            <input type="date" className="field-input" value={docDate} onChange={(e) => setDocDate(e.target.value)} /></label>
          <label className="inv-field"><span>나갈 창고 *</span>
            <select className="field-input" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              {warehouses.length === 0 && <option value="">창고가 없습니다</option>}
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select></label>
        </div>
        <PartnerField partners={partners} partnerId={partnerId} setPartnerId={setPartnerId}
          partnerName={partnerName} setPartnerName={setPartnerName} />

        <LineEditor lines={lines} setLines={setLines} products={products} />

        {hasMinus && (
          <p className="inv-warn">수량이 음수인 줄은 <b>판매 취소</b>로 읽습니다 — 재고가 다시 늘어납니다.</p>
        )}
        <label className="inv-field"><span>메모</span>
          <input className="field-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="주문번호 · 채널 등" /></label>

        <div className="inv-modal-foot">판매 금액 <b>₩{won(total)}</b></div>
        <div className="inv-modal-actions">
          <button type="button" className="btn-secondary btn-sm" onClick={onClose}>취소</button>
          <button type="button" className="btn-primary btn-sm" disabled={!use.length || !warehouseId || busy}
            onClick={async () => {
              setBusy(true);
              try {
                //   거래처를 이름으로만 적은 경우는 문서 메모에 남긴다 — 없는 거래처를 몰래 만들지 않는다.
                const memo = [note.trim(), partnerName.trim() ? `거래처: ${partnerName.trim()}` : ""].filter(Boolean).join(" · ");
                const r = await createStockDoc(companyId, {
                  reason: "sale", docDate, warehouseId, partnerId: partnerId || null, note: memo || null,
                  lines: use.map((l) => ({ product_id: l.product_id, qty: Number(l.qty), unit_price: l.unit_price ? Number(l.unit_price) : null })),
                }, userId);
                onSaved(r.skipped > 0
                  ? `${r.docNo} 로 기록했습니다 · 수량을 세지 않는 ${r.skipped}줄은 뺐습니다`
                  : `${r.docNo} 로 기록했습니다`);
              } catch (e) { toast(friendlyError(e, "기록하지 못했습니다"), "error"); }
              finally { setBusy(false); }
            }}>판매 기록</button>
        </div>
      </div>
    </div>
  );
}
