"use client";

// ── 재고 › 판매 (2026-08-25 재고 2단계) ────────────────────────────────────────
//   이 화면이 답하는 것은 두 가지다 — **"뭘 보내야 하나"**(안 나간 주문)와 **"얼마나 팔았나"**(판매 이력).
//   ★ 결정 5 — 주문 없이도 판다. 그래서 '바로 판매'가 주문과 같은 자리에 있다(곁다리가 아니다).
//   ★ 결정 12 — 나간 수량은 주문에 적어 두지 않는다. 움직인 기록의 합으로 읽는다.
//   ★ 결정 13 — 주문은 지우지 않고 취소한다. 나간 것이 있으면 취소도 막는다.

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
import { listProducts, listWarehouses, listMoves, type Product } from "@/lib/inventory";
import {
  listSalesOrders, listOrderLines, listShipped, listAvailable, cancelSalesOrder, reopenSalesOrder,
  type SalesOrder,
} from "@/lib/inventory-sales";
import { OrderDialog, ShipDialog, DirectShipDialog, type Partner } from "../_components/sales-dialogs";

const won = (n: number) => Math.round(n || 0).toLocaleString("ko-KR");
type Tab = "orders" | "history";
type Filter = "all" | "open" | "done" | "cancelled";

export default function SalesPage() {
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
  const [shipOpen, setShipOpen] = useState(false);

  const canWrite = isMaster || hasPerm("/inventory/sales");

  const { data: products = [] } = useQuery({ queryKey: ["inv-products", companyId], queryFn: () => listProducts(companyId!), enabled: !!companyId });
  const { data: warehouses = [] } = useQuery({ queryKey: ["inv-warehouses", companyId], queryFn: () => listWarehouses(companyId!), enabled: !!companyId });
  const { data: available = [] } = useQuery({ queryKey: ["inv-available", companyId], queryFn: () => listAvailable(companyId!), enabled: !!companyId });
  const { data: orders = [] } = useQuery({ queryKey: ["so-list", companyId, from, to], queryFn: () => listSalesOrders(companyId!, from, to), enabled: !!companyId });
  const { data: shipped = [] } = useQuery({ queryKey: ["so-shipped", companyId], queryFn: () => listShipped(companyId!), enabled: !!companyId });
  const { data: lines = [] } = useQuery({ queryKey: ["so-lines", openId], queryFn: () => listOrderLines(openId!), enabled: !!openId });
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
  const shippedByOrder = useMemo(() => {
    const m = new Map<string, { ordered: number; shipped: number }>();
    for (const s of shipped) {
      const cur = m.get(s.order_id) || { ordered: 0, shipped: 0 };
      m.set(s.order_id, { ordered: cur.ordered + s.ordered_qty, shipped: cur.shipped + s.shipped_qty });
    }
    return m;
  }, [shipped]);

  //   주문 목록 — 걸린 조건과 빠른검색으로 좁힌다
  const shownOrders = useMemo(() => orders.filter((o) =>
    (filter === "all" || o.status === filter) &&
    quickSearchHit(q, [o.order_no, o.partner_name, partners.find((p) => p.id === o.partner_id)?.name, o.note])
  ), [orders, filter, q, partners]);
  const orderPager = usePager(shownOrders, 50, `${q}|${filter}|${from}|${to}`);

  //   판매 이력 — 움직인 기록 중 '판매 출고'만. 재고 화면과 달리 **거래처·금액**을 본다.
  const sales = useMemo(() => moves.filter((m) => m.doc?.reason === "sale"), [moves]);
  const shownSales = useMemo(() => sales.filter((m) => {
    const p = productById.get(m.product_id);
    return quickSearchHit(q, [p?.sku, p?.name, m.doc?.doc_no, m.doc?.note]);
  }), [sales, q, productById]);
  const salesPager = usePager(shownSales, 50, `${q}|${from}|${to}`);

  const counts = useMemo(() => ({
    open: orders.filter((o) => o.status === "open").length,
    done: orders.filter((o) => o.status === "done").length,
    cancelled: orders.filter((o) => o.status === "cancelled").length,
    rest: orders.filter((o) => o.status === "open").reduce((n, o) => {
      const s = shippedByOrder.get(o.id); return n + Math.max((s?.ordered || 0) - (s?.shipped || 0), 0);
    }, 0),
  }), [orders, shippedByOrder]);

  const openOrder = useMemo(() => orders.find((o) => o.id === openId) || null, [orders, openId]);
  const openShipped = useMemo(() => shipped.filter((s) => s.order_id === openId), [shipped, openId]);

  if (!permLoading && !(isMaster || hasPerm("/inventory/sales"))) {
    return <AccessDenied detail="판매 화면에 대한 권한이 없습니다. 회사 마스터에게 요청하세요." />;
  }

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["so-list", companyId] });
    qc.invalidateQueries({ queryKey: ["so-shipped", companyId] });
    qc.invalidateQueries({ queryKey: ["so-lines", openId] });
    qc.invalidateQueries({ queryKey: ["inv-available", companyId] });
    qc.invalidateQueries({ queryKey: ["inv-onhand", companyId] });
    qc.invalidateQueries({ queryKey: ["inv-moves", companyId] });
  };

  return (
    <div className="qk-shell">
      <QueryScreen>
        <QueryHead>
          <div className="collect-tabs no-print">
            {([["orders", "주문"], ["history", "판매 이력"]] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => { setTab(k as Tab); setOpenId(null); }}
                className={tab === k ? "collect-tab collect-tab-on" : "collect-tab"}>
                {l}
                {k === "orders" && counts.open > 0 && <span className="collect-tab-cnt">보낼 것 {counts.open}</span>}
              </button>
            ))}
          </div>

          {tab === "orders" && !openId && (
            <>
              <QueryBar right={canWrite ? (
                <>
                  <button type="button" className="btn-secondary btn-sm" onClick={() => setDirectOpen(true)}>바로 판매</button>
                  <button type="button" className="btn-primary btn-sm" onClick={() => setNewOpen(true)}>+ 주문 받기</button>
                </>
              ) : undefined}>
                <DateRangeField from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
                <QuickSearch value={q} onApply={setQ} placeholder="주문번호 · 거래처 · 메모 — 쉼표로 여러 개, Enter" />
                <ChipGroup value={filter} onChange={setFilter} options={[
                  { value: "all", label: "전체" },
                  { value: "open", label: `보낼 것 ${counts.open}`, title: "아직 다 안 나간 주문" },
                  { value: "done", label: `다 나감 ${counts.done}` },
                  { value: "cancelled", label: `취소 ${counts.cancelled}` },
                ]} />
              </QueryBar>
              <ResultStrip>
                <Stat label="주문" value={`${won(shownOrders.length)}건`} />
                <Stat label="보낼 것" value={`${won(counts.open)}건`} tone={counts.open > 0 ? "minus" : undefined} />
                <Stat label="안 나간 수량" value={`${won(counts.rest)}개`} />
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
                        if (!window.confirm("이 주문을 취소할까요? 이미 나간 것이 있으면 취소되지 않습니다.")) return;
                        try { await cancelSalesOrder(companyId!, openOrder.id); invalidate(); toast("취소했습니다", "success"); }
                        catch (e) { toast(friendlyError(e), "error"); }
                      }}>주문 취소</button>
                  )}
                  {/*   다 나간 주문에서 누를 수 있는 것은 반품뿐이다 — 이름이 사실과 어긋나지 않게 바꾼다 */}
                  <button type="button" className="btn-primary btn-sm" onClick={() => setShipOpen(true)}>
                    {openOrder.status === "done" ? "반품 넣기" : "출고하기"}</button>
                </>
              ) : canWrite && openOrder.status === "cancelled" ? (
                <button type="button" className="btn-secondary btn-sm"
                  onClick={async () => { try { await reopenSalesOrder(openOrder.id); invalidate(); toast("되살렸습니다", "success"); } catch (e) { toast(friendlyError(e), "error"); } }}>되살리기</button>
              ) : undefined}>
                <button type="button" className="btn-secondary btn-sm" onClick={() => setOpenId(null)}>← 목록</button>
                <span className="inv-count-title">
                  <b>{openOrder.order_no}</b> · {openOrder.partner_name || partners.find((p) => p.id === openOrder.partner_id)?.name || "거래처 없음"}
                  {openOrder.status === "done" ? <span className="inv-pill inv-pill-ok">다 나감</span>
                    : openOrder.status === "cancelled" ? <span className="inv-pill inv-pill-danger">취소</span>
                    : <span className="inv-pill inv-pill-warn">보낼 것</span>}
                </span>
              </QueryBar>
              <ResultStrip>
                <Stat label="주문일" value={openOrder.order_date} />
                <Stat label="줄" value={`${won(lines.length)}개`} />
                <Stat label="주문 수량" value={`${won(lines.reduce((n, l) => n + l.qty, 0))}개`} />
                <Stat label="나간 수량" value={`${won(openShipped.reduce((n, s) => n + s.shipped_qty, 0))}개`} />
                <Stat label="주문 금액" value={`₩${won(lines.reduce((n, l) => n + l.qty * Number(l.unit_price || 0), 0))}`} />
              </ResultStrip>
            </>
          )}

          {tab === "history" && (
            <>
              <QueryBar right={canWrite ? <button type="button" className="btn-primary btn-sm" onClick={() => setDirectOpen(true)}>바로 판매</button> : undefined}>
                <DateRangeField from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
                <QuickSearch value={q} onApply={setQ} placeholder="품목 · SKU · 문서번호 — 쉼표로 여러 개, Enter" />
                <span className="inv-hint">계산서는 <b>세금 › 증빙</b>에서 따로 발행합니다 — 여기서는 물건이 나간 것만 셉니다.</span>
              </QueryBar>
              <ResultStrip>
                <Stat label="판매 줄" value={`${won(shownSales.length)}개`} />
                <Stat label="나간 수량" value={`${won(Math.abs(shownSales.filter((m) => m.qty < 0).reduce((n, m) => n + m.qty, 0)))}개`} />
                <Stat label="되돌아온 수량" value={`${won(shownSales.filter((m) => m.qty > 0).reduce((n, m) => n + m.qty, 0))}개`} />
                <Stat label="판매 금액" value={`₩${won(Math.abs(shownSales.reduce((n, m) => n + Number(m.amount || 0), 0)))}`} />
              </ResultStrip>
            </>
          )}
        </QueryHead>

        <QueryBody>
          <div className="inv-scroll">
            {tab === "orders" && !openId && (
              orders.length === 0 ? (
                <div className="collect-empty">
                  이 기간에 받은 주문이 없습니다 — <b>+ 주문 받기</b>로 팔기로 한 것을 먼저 적어 두면
                  <b> 판매가능수량</b>이 그만큼 줄어 이중 판매를 막습니다.<br />
                  주문을 안 적고 파는 곳이라면 <b>바로 판매</b>만 쓰셔도 됩니다.
                </div>
              ) : (
                <div className="stg-table-wrap">
                  <table className="ev-table ev-lined table-inv-orders">
                    <thead><tr><th>주문번호</th><th>주문일</th><th>거래처</th><th>창고</th><th>진행</th><th>상태</th><th>메모</th></tr></thead>
                    <tbody>
                      {orderPager.view.map((o) => {
                        const s = shippedByOrder.get(o.id);
                        const rate = s && s.ordered > 0 ? Math.round((s.shipped / s.ordered) * 100) : 0;
                        return (
                          <tr key={o.id} className="inv-row-click" onClick={() => setOpenId(o.id)}>
                            <td className="mono-number text-left"><b>{o.order_no}</b></td>
                            <td className="mono-number">{o.order_date}</td>
                            <td className="text-left">{o.partner_name || partners.find((p) => p.id === o.partner_id)?.name || "—"}</td>
                            <td className="tc ev-dim">{whById.get(o.warehouse_id || "")?.name || "—"}</td>
                            <td className="tc">
                              {s ? <span className="inv-rate"><b>{won(s.shipped)}</b> / {won(s.ordered)} <em>{rate}%</em></span> : "—"}
                            </td>
                            <td className="tc">
                              {o.status === "done" ? <span className="inv-pill inv-pill-ok">다 나감</span>
                                : o.status === "cancelled" ? <span className="inv-pill inv-pill-danger">취소</span>
                                : <span className="inv-pill inv-pill-warn">보낼 것</span>}
                            </td>
                            <td className="text-left ev-dim">{o.note || "—"}</td>
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
                    <thead><tr><th>SKU</th><th>품목명</th><th>규격</th><th>주문</th><th>나감</th><th>남음</th><th>단가</th><th>금액</th></tr></thead>
                    <tbody>
                      {lines.map((l) => {
                        const p = productById.get(l.product_id);
                        const done = openShipped.find((s) => s.order_line_id === l.id)?.shipped_qty ?? 0;
                        const rest = l.qty - done;
                        return (
                          <tr key={l.id}>
                            <td className="mono-number text-left">{p?.sku || "—"}</td>
                            <td className="text-left"><b>{p?.name || "—"}</b></td>
                            <td className="tc ev-dim">{p?.spec || "—"}</td>
                            <td className="tr mono-number">{won(l.qty)}</td>
                            <td className="tr mono-number ev-dim">{won(done)}</td>
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
                  나간 수량은 <b>주문에 적어 두지 않고</b> 출고 기록의 합으로 셉니다 —
                  그래서 반품이 붙으면 남은 수량이 저절로 되돌아옵니다.
                </p>
              </>
            )}

            {tab === "history" && (
              sales.length === 0 ? (
                <div className="collect-empty">
                  이 기간에 나간 판매가 없습니다 — <b>바로 판매</b>로 적거나, <b>주문</b>에서 출고하면 여기에 쌓입니다.
                </div>
              ) : (
                <div className="stg-table-wrap">
                  <table className="ev-table ev-lined table-inv-sales">
                    <thead><tr><th>일자</th><th>문서번호</th><th>SKU</th><th>품목명</th><th>수량</th><th>단가</th><th>금액</th><th>메모</th></tr></thead>
                    <tbody>
                      {salesPager.view.map((m) => {
                        const p = productById.get(m.product_id);
                        const out = -m.qty;      // 나간 것을 양수로 읽는다
                        return (
                          <tr key={m.id}>
                            <td className="mono-number">{m.moved_at.slice(5)}</td>
                            <td className="mono-number text-left">{m.doc?.doc_no || "—"}</td>
                            <td className="mono-number text-left">{p?.sku || "—"}</td>
                            <td className="text-left"><b>{p?.name || "—"}</b></td>
                            <td className="tr mono-number">
                              <b>{won(out)}</b>
                              {out < 0 ? <b className="inv-line-undo">되돌림</b> : null}
                            </td>
                            <td className="tr mono-number ev-dim">{m.unit_price != null ? `₩${won(Number(m.unit_price))}` : "—"}</td>
                            <td className="tr mono-number">{m.amount != null ? `₩${won(Math.abs(Number(m.amount)))}` : "—"}</td>
                            <td className="text-left ev-dim">{m.note || m.doc?.note || "—"}</td>
                          </tr>
                        );
                      })}
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
        {tab === "history" && sales.length > 0 && (
          <Pager page={salesPager.page} pages={salesPager.pages} total={shownSales.length} size={50}
            from={salesPager.from} to={salesPager.to} onPage={salesPager.setPage} />
        )}
      </QueryScreen>

      {newOpen && companyId && (
        <OrderDialog companyId={companyId} userId={userId} products={products} warehouses={warehouses}
          partners={partners} available={available}
          onClose={() => setNewOpen(false)}
          onSaved={(msg) => { setNewOpen(false); invalidate(); toast(msg, "success"); }} />
      )}
      {directOpen && companyId && (
        <DirectShipDialog companyId={companyId} userId={userId} products={products} warehouses={warehouses}
          partners={partners}
          onClose={() => setDirectOpen(false)}
          onSaved={(msg) => { setDirectOpen(false); invalidate(); toast(msg, "success"); }} />
      )}
      {shipOpen && companyId && openOrder && (
        <ShipDialog companyId={companyId} userId={userId} order={openOrder} lines={lines} shipped={openShipped}
          products={productById}
          onClose={() => setShipOpen(false)}
          onSaved={(msg) => { setShipOpen(false); invalidate(); toast(msg, "success"); }} />
      )}
    </div>
  );
}
