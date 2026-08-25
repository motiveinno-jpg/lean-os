"use client";

// ── 재고 › 구매 (2026-08-25 재고 3단계) ────────────────────────────────────────
//   답하는 것 두 가지 — **"뭐가 들어오나"**(안 받은 발주)와 **"얼마나 샀나"**(매입 이력).
//   ★ 결정 5 — 발주 없이도 산다. 그래서 '바로 매입'이 발주와 같은 자리에 있다.
//   ★ 들어올 것은 **판매가능수량에 넣지 않는다** — 아직 창고에 없는 물건이다.
//     보여 주는 쓸모는 하나, 부족한 품목을 채울 때 **이미 시킨 것을 빼는 것**이다.

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getCurrentUser } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import { useMyPermissions } from "@/lib/permissions";
import { AccessDenied } from "@/components/access-denied";
import { todayKst } from "@/lib/kst";
import {
  QueryScreen, QueryHead, QueryBody, QueryBar, ResultStrip, Stat, ChipGroup,
  Pager, usePager, QuickSearch, quickSearchHit,
} from "@/components/query-kit";
import { DateRangeField } from "@/components/date-range-field";
import { listProducts, listWarehouses, listOnHand, listMoves } from "@/lib/inventory";
import {
  listPurchaseOrders, listPoLines, listReceived, listIncoming,
  cancelPurchaseOrder, reopenPurchaseOrder,
} from "@/lib/inventory-purchase";
import { PoDialog, ReceiveDialog, DirectReceiveDialog } from "../_components/purchase-dialogs";
import type { Partner } from "../_components/line-editor";

const won = (n: number) => Math.round(n || 0).toLocaleString("ko-KR");
type Tab = "orders" | "history";
type Filter = "all" | "open" | "done" | "cancelled";

export default function PurchasePage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { isMaster, hasPerm, loading: permLoading } = useMyPermissions();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => { getCurrentUser().then((u) => { setCompanyId(u?.company_id ?? null); setUserId(u?.id ?? null); }); }, []);

  const [tab, setTab] = useState<Tab>("orders");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [from, setFrom] = useState(() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 10); });
  const [to, setTo] = useState(todayKst);
  const [openId, setOpenId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [directOpen, setDirectOpen] = useState(false);
  const [recvOpen, setRecvOpen] = useState(false);

  const canWrite = isMaster || hasPerm("/inventory/purchase");

  const { data: products = [] } = useQuery({ queryKey: ["inv-products", companyId], queryFn: () => listProducts(companyId!), enabled: !!companyId });
  const { data: warehouses = [] } = useQuery({ queryKey: ["inv-warehouses", companyId], queryFn: () => listWarehouses(companyId!), enabled: !!companyId });
  const { data: onhand = [] } = useQuery({ queryKey: ["inv-onhand", companyId], queryFn: () => listOnHand(companyId!), enabled: !!companyId });
  const { data: incoming = [] } = useQuery({ queryKey: ["inv-incoming", companyId], queryFn: () => listIncoming(companyId!), enabled: !!companyId });
  const { data: orders = [] } = useQuery({ queryKey: ["po-list", companyId, from, to], queryFn: () => listPurchaseOrders(companyId!, from, to), enabled: !!companyId });
  const { data: received = [] } = useQuery({ queryKey: ["po-received", companyId], queryFn: () => listReceived(companyId!), enabled: !!companyId });
  const { data: lines = [] } = useQuery({ queryKey: ["po-lines", openId], queryFn: () => listPoLines(openId!), enabled: !!openId });
  const { data: moves = [] } = useQuery({
    queryKey: ["inv-moves", companyId, from, to], queryFn: () => listMoves(companyId!, from, to),
    enabled: !!companyId && tab === "history",
  });
  const { data: partners = [] } = useQuery({
    queryKey: ["inv-partners", companyId],
    queryFn: async () => {
      const { data } = await supabase.from("partners").select("id, name")
        .eq("company_id", companyId!).eq("is_active", true).order("name").limit(500);
      return ((data || []) as any[]).map((p) => ({ id: p.id, name: p.name })) as Partner[];
    },
    enabled: !!companyId,
  });

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const whById = useMemo(() => new Map(warehouses.map((w) => [w.id, w])), [warehouses]);
  const receivedByOrder = useMemo(() => {
    const m = new Map<string, { ordered: number; received: number }>();
    for (const s of received) {
      const cur = m.get(s.order_id) || { ordered: 0, received: 0 };
      m.set(s.order_id, { ordered: cur.ordered + s.ordered_qty, received: cur.received + s.received_qty });
    }
    return m;
  }, [received]);

  const shownOrders = useMemo(() => orders.filter((o) =>
    (filter === "all" || o.status === filter) &&
    quickSearchHit(q, [o.po_no, o.partner_name, partners.find((p) => p.id === o.partner_id)?.name, o.note])
  ), [orders, filter, q, partners]);
  const orderPager = usePager(shownOrders, 50, `${q}|${filter}|${from}|${to}`);

  //   매입 이력 — 움직인 기록 중 '매입 입고'만
  const buys = useMemo(() => moves.filter((m) => m.doc?.reason === "purchase"), [moves]);
  const shownBuys = useMemo(() => buys.filter((m) => {
    const p = productById.get(m.product_id);
    return quickSearchHit(q, [p?.sku, p?.name, m.doc?.doc_no, m.doc?.note]);
  }), [buys, q, productById]);
  const buyPager = usePager(shownBuys, 50, `${q}|${from}|${to}`);

  const counts = useMemo(() => ({
    open: orders.filter((o) => o.status === "open").length,
    done: orders.filter((o) => o.status === "done").length,
    cancelled: orders.filter((o) => o.status === "cancelled").length,
    rest: orders.filter((o) => o.status === "open").reduce((n, o) => {
      const s = receivedByOrder.get(o.id); return n + Math.max((s?.ordered || 0) - (s?.received || 0), 0);
    }, 0),
    //   지난 날짜인데 아직 안 온 것 — 이 화면에서 가장 급한 줄이다
    late: orders.filter((o) => o.status === "open" && o.due_date && o.due_date < todayKst()).length,
  }), [orders, receivedByOrder]);

  const openOrder = useMemo(() => orders.find((o) => o.id === openId) || null, [orders, openId]);
  const openReceived = useMemo(() => received.filter((s) => s.order_id === openId), [received, openId]);

  if (!permLoading && !(isMaster || hasPerm("/inventory/purchase"))) {
    return <AccessDenied detail="구매 화면에 대한 권한이 없습니다. 회사 마스터에게 요청하세요." />;
  }

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["po-list", companyId] });
    qc.invalidateQueries({ queryKey: ["po-received", companyId] });
    qc.invalidateQueries({ queryKey: ["po-lines", openId] });
    qc.invalidateQueries({ queryKey: ["inv-incoming", companyId] });
    qc.invalidateQueries({ queryKey: ["inv-onhand", companyId] });
    qc.invalidateQueries({ queryKey: ["inv-available", companyId] });
    qc.invalidateQueries({ queryKey: ["inv-moves", companyId] });
  };

  return (
    <div className="qk-shell">
      <QueryScreen>
        <QueryHead>
          <div className="collect-tabs no-print">
            {([["orders", "발주"], ["history", "매입 이력"]] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => { setTab(k as Tab); setOpenId(null); }}
                className={tab === k ? "collect-tab collect-tab-on" : "collect-tab"}>
                {l}
                {k === "orders" && counts.late > 0 && <span className="collect-tab-cnt inv-tab-warn">늦음 {counts.late}</span>}
              </button>
            ))}
          </div>

          {tab === "orders" && !openId && (
            <>
              <QueryBar right={canWrite ? (
                <>
                  <button type="button" className="btn-secondary btn-sm" onClick={() => setDirectOpen(true)}>바로 매입</button>
                  <button type="button" className="btn-primary btn-sm" onClick={() => setNewOpen(true)}>+ 발주하기</button>
                </>
              ) : undefined}>
                <DateRangeField from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
                <QuickSearch value={q} onApply={setQ} placeholder="발주번호 · 거래처 · 메모 — 쉼표로 여러 개, Enter" />
                <ChipGroup value={filter} onChange={setFilter} options={[
                  { value: "all", label: "전체" },
                  { value: "open", label: `받을 것 ${counts.open}`, title: "아직 다 안 들어온 발주" },
                  { value: "done", label: `다 받음 ${counts.done}` },
                  { value: "cancelled", label: `취소 ${counts.cancelled}` },
                ]} />
              </QueryBar>
              <ResultStrip>
                <Stat label="발주" value={`${won(shownOrders.length)}건`} />
                <Stat label="받을 것" value={`${won(counts.open)}건`} />
                <Stat label="안 들어온 수량" value={`${won(counts.rest)}개`} />
                <Stat label="날짜 지남" value={`${won(counts.late)}건`} tone={counts.late > 0 ? "minus" : undefined} />
              </ResultStrip>
            </>
          )}

          {tab === "orders" && openId && openOrder && (
            <>
              <QueryBar right={canWrite && openOrder.status !== "cancelled" ? (
                <>
                  {openOrder.status === "open" && (
                    <button type="button" className="btn-secondary btn-sm"
                      onClick={async () => {
                        if (!window.confirm("이 발주를 취소할까요? 이미 받은 것이 있으면 취소되지 않습니다.")) return;
                        try { await cancelPurchaseOrder(companyId!, openOrder.id); invalidate(); toast("취소했습니다", "success"); }
                        catch (e) { toast(friendlyError(e), "error"); }
                      }}>발주 취소</button>
                  )}
                  <button type="button" className="btn-primary btn-sm" onClick={() => setRecvOpen(true)}>
                    {openOrder.status === "done" ? "반품 넣기" : "입고하기"}</button>
                </>
              ) : canWrite && openOrder.status === "cancelled" ? (
                <button type="button" className="btn-secondary btn-sm"
                  onClick={async () => { try { await reopenPurchaseOrder(openOrder.id); invalidate(); toast("되살렸습니다", "success"); } catch (e) { toast(friendlyError(e), "error"); } }}>되살리기</button>
              ) : undefined}>
                <button type="button" className="btn-secondary btn-sm" onClick={() => setOpenId(null)}>← 목록</button>
                <span className="inv-count-title">
                  <b>{openOrder.po_no}</b> · {openOrder.partner_name || partners.find((p) => p.id === openOrder.partner_id)?.name || "거래처 없음"}
                  {openOrder.status === "done" ? <span className="inv-pill inv-pill-ok">다 받음</span>
                    : openOrder.status === "cancelled" ? <span className="inv-pill inv-pill-danger">취소</span>
                    : <span className="inv-pill inv-pill-warn">받을 것</span>}
                </span>
              </QueryBar>
              <ResultStrip>
                <Stat label="발주일" value={openOrder.order_date} />
                <Stat label="받기로 한 날" value={openOrder.due_date || "—"}
                  tone={openOrder.status === "open" && openOrder.due_date && openOrder.due_date < todayKst() ? "minus" : undefined} />
                <Stat label="발주 수량" value={`${won(lines.reduce((n, l) => n + l.qty, 0))}개`} />
                <Stat label="받은 수량" value={`${won(openReceived.reduce((n, s) => n + s.received_qty, 0))}개`} />
                <Stat label="발주 금액" value={`₩${won(lines.reduce((n, l) => n + l.qty * Number(l.unit_price || 0), 0))}`} />
              </ResultStrip>
            </>
          )}

          {tab === "history" && (
            <>
              <QueryBar right={canWrite ? <button type="button" className="btn-primary btn-sm" onClick={() => setDirectOpen(true)}>바로 매입</button> : undefined}>
                <DateRangeField from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
                <QuickSearch value={q} onApply={setQ} placeholder="품목 · SKU · 문서번호 — 쉼표로 여러 개, Enter" />
                <span className="inv-hint">매입 전표는 <b>수집 › 전표</b>에서 따로 만듭니다 — 여기서는 물건이 들어온 것만 셉니다.</span>
              </QueryBar>
              <ResultStrip>
                <Stat label="매입 줄" value={`${won(shownBuys.length)}개`} />
                <Stat label="들어온 수량" value={`${won(shownBuys.filter((m) => m.qty > 0).reduce((n, m) => n + m.qty, 0))}개`} />
                <Stat label="돌려보낸 수량" value={`${won(Math.abs(shownBuys.filter((m) => m.qty < 0).reduce((n, m) => n + m.qty, 0)))}개`} />
                <Stat label="매입 금액" value={`₩${won(shownBuys.reduce((n, m) => n + Number(m.amount || 0), 0))}`} />
              </ResultStrip>
            </>
          )}
        </QueryHead>

        <QueryBody>
          <div className="inv-scroll">
            {tab === "orders" && !openId && (
              orders.length === 0 ? (
                <div className="collect-empty">
                  이 기간에 낸 발주가 없습니다 — <b>+ 발주하기</b>를 열면 <b>안전재고보다 모자란 품목</b>을
                  한 번에 채워 넣을 수 있습니다(이미 시킨 것은 빼고 셉니다).<br />
                  발주서를 안 쓰는 곳이라면 <b>바로 매입</b>만 쓰셔도 됩니다.
                </div>
              ) : (
                <div className="stg-table-wrap">
                  <table className="ev-table ev-lined table-inv-orders">
                    <thead><tr><th>발주번호</th><th>발주일</th><th>받기로 한 날</th><th>거래처</th><th>창고</th><th>진행</th><th>상태</th></tr></thead>
                    <tbody>
                      {orderPager.view.map((o) => {
                        const s = receivedByOrder.get(o.id);
                        const rate = s && s.ordered > 0 ? Math.round((s.received / s.ordered) * 100) : 0;
                        const late = o.status === "open" && o.due_date && o.due_date < todayKst();
                        return (
                          <tr key={o.id} className={late ? "inv-row-click inv-row-fix" : "inv-row-click"} onClick={() => setOpenId(o.id)}>
                            <td className="mono-number text-left"><b>{o.po_no}</b></td>
                            <td className="mono-number">{o.order_date}</td>
                            <td className="mono-number">
                              {o.due_date || "—"}
                              {late ? <b className="inv-line-undo">늦음</b> : null}
                            </td>
                            <td className="text-left">{o.partner_name || partners.find((p) => p.id === o.partner_id)?.name || "—"}</td>
                            <td className="tc ev-dim">{whById.get(o.warehouse_id || "")?.name || "—"}</td>
                            <td className="tc">
                              {s ? <span className="inv-rate"><b>{won(s.received)}</b> / {won(s.ordered)} <em>{rate}%</em></span> : "—"}
                            </td>
                            <td className="tc">
                              {o.status === "done" ? <span className="inv-pill inv-pill-ok">다 받음</span>
                                : o.status === "cancelled" ? <span className="inv-pill inv-pill-danger">취소</span>
                                : <span className="inv-pill inv-pill-warn">받을 것</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )
            )}

            {tab === "orders" && openId && (
              <>
                <div className="stg-table-wrap">
                  <table className="ev-table ev-lined table-inv-order-lines">
                    <thead><tr><th>SKU</th><th>품목명</th><th>규격</th><th>발주</th><th>받음</th><th>남음</th><th>단가</th><th>금액</th></tr></thead>
                    <tbody>
                      {lines.map((l) => {
                        const p = productById.get(l.product_id);
                        const got = openReceived.find((s) => s.po_line_id === l.id)?.received_qty ?? 0;
                        const rest = l.qty - got;
                        return (
                          <tr key={l.id}>
                            <td className="mono-number text-left">{p?.sku || "—"}</td>
                            <td className="text-left"><b>{p?.name || "—"}</b></td>
                            <td className="tc ev-dim">{p?.spec || "—"}</td>
                            <td className="tr mono-number">{won(l.qty)}</td>
                            <td className="tr mono-number ev-dim">{won(got)}</td>
                            <td className="tr mono-number"><b className={rest > 0 ? "inv-diff-minus" : "ev-dim"}>{won(rest)}</b></td>
                            <td className="tr mono-number ev-dim">{l.unit_price != null ? `₩${won(Number(l.unit_price))}` : "—"}</td>
                            <td className="tr mono-number">₩{won(l.qty * Number(l.unit_price || 0))}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="inv-foot">
                  받은 수량은 <b>발주에 적어 두지 않고</b> 입고 기록의 합으로 셉니다 —
                  그래서 반품이 붙으면 남은 수량이 저절로 되돌아옵니다.
                </p>
              </>
            )}

            {tab === "history" && (
              buys.length === 0 ? (
                <div className="collect-empty">
                  이 기간에 들어온 매입이 없습니다 — <b>바로 매입</b>으로 적거나, <b>발주</b>에서 입고하면 여기에 쌓입니다.
                </div>
              ) : (
                <div className="stg-table-wrap">
                  <table className="ev-table ev-lined table-inv-sales">
                    <thead><tr><th>일자</th><th>문서번호</th><th>SKU</th><th>품목명</th><th>수량</th><th>단가</th><th>금액</th><th>메모</th></tr></thead>
                    <tbody>
                      {buyPager.view.map((m) => (
                        <tr key={m.id}>
                          <td className="mono-number">{m.moved_at.slice(5)}</td>
                          <td className="mono-number text-left">{m.doc?.doc_no || "—"}</td>
                          <td className="mono-number text-left">{productById.get(m.product_id)?.sku || "—"}</td>
                          <td className="text-left"><b>{productById.get(m.product_id)?.name || "—"}</b></td>
                          <td className="tr mono-number">
                            <b>{won(m.qty)}</b>
                            {m.qty < 0 ? <b className="inv-line-undo">돌려보냄</b> : null}
                          </td>
                          <td className="tr mono-number ev-dim">{m.unit_price != null ? `₩${won(Number(m.unit_price))}` : "—"}</td>
                          {/*   돌려보낸 줄은 금액도 음수다 — ₩-25,000 이 아니라 -₩25,000 으로 적는다 */}
                          <td className="tr mono-number">
                            {m.amount == null ? "—"
                              : Number(m.amount) < 0 ? `-₩${won(Math.abs(Number(m.amount)))}`
                              : `₩${won(Number(m.amount))}`}
                          </td>
                          <td className="text-left ev-dim">{m.note || m.doc?.note || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}
          </div>
        </QueryBody>

        {tab === "orders" && !openId && orders.length > 0 && (
          <Pager page={orderPager.page} pages={orderPager.pages} total={shownOrders.length} size={50}
            from={orderPager.from} to={orderPager.to} onPage={orderPager.setPage} />
        )}
        {tab === "history" && buys.length > 0 && (
          <Pager page={buyPager.page} pages={buyPager.pages} total={shownBuys.length} size={50}
            from={buyPager.from} to={buyPager.to} onPage={buyPager.setPage} />
        )}
      </QueryScreen>

      {newOpen && companyId && (
        <PoDialog companyId={companyId} userId={userId} products={products} warehouses={warehouses}
          partners={partners} onhand={onhand} incoming={incoming}
          onClose={() => setNewOpen(false)}
          onSaved={(msg) => { setNewOpen(false); invalidate(); toast(msg, "success"); }} />
      )}
      {directOpen && companyId && (
        <DirectReceiveDialog companyId={companyId} userId={userId} products={products} warehouses={warehouses}
          partners={partners}
          onClose={() => setDirectOpen(false)}
          onSaved={(msg) => { setDirectOpen(false); invalidate(); toast(msg, "success"); }} />
      )}
      {recvOpen && companyId && openOrder && (
        <ReceiveDialog companyId={companyId} userId={userId} order={openOrder} lines={lines} received={openReceived}
          products={productById}
          onClose={() => setRecvOpen(false)}
          onSaved={(msg) => { setRecvOpen(false); invalidate(); toast(msg, "success"); }} />
      )}
    </div>
  );
}
