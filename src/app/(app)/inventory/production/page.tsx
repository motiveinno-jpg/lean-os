"use client";

// ── 재고 › 생산 (2026-08-25 재고 4단계) ────────────────────────────────────────
//   앞의 셋과 다르다 — **거래처도 계산서도 없다.** 안에서 자재가 완제품이 되는 일이다.
//   ★ 결정 14 — 완성 한 번에 자재 출고(MTL) + 완제품 입고(PRD) 두 문서가 같이 선다.
//   ★ 결정 15 — 자재구성이 없으면 자재를 빼지 않는다(완제품만 는다). 없는 걸 지어내지 않는다.
//   ★ 결정 16 — 자재가 모자라도 막지 않는다. 알려 주고, 만든 뒤에는 음수가 '맞춰야 할 것'으로 선다.

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getCurrentUser } from "@/lib/queries";
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
import { listProducts, listWarehouses, listOnHand, listMoves, type Product } from "@/lib/inventory";
import {
  listBoms, listWorkOrders, listWoDone, cancelWorkOrder, reopenWorkOrder,
} from "@/lib/inventory-production";
import { BomDialog, WoDialog, CompleteDialog } from "../_components/production-dialogs";

const won = (n: number) => Math.round(n || 0).toLocaleString("ko-KR");
type Tab = "orders" | "bom" | "history";
type Filter = "all" | "open" | "done" | "cancelled";

export default function ProductionPage() {
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
  const [newOpen, setNewOpen] = useState(false);
  const [bomFor, setBomFor] = useState<Product | null>(null);
  const [doneFor, setDoneFor] = useState<string | null>(null);

  const canWrite = isMaster || hasPerm("/inventory/production");

  const { data: products = [] } = useQuery({ queryKey: ["inv-products", companyId], queryFn: () => listProducts(companyId!), enabled: !!companyId });
  const { data: warehouses = [] } = useQuery({ queryKey: ["inv-warehouses", companyId], queryFn: () => listWarehouses(companyId!), enabled: !!companyId });
  const { data: onhand = [] } = useQuery({ queryKey: ["inv-onhand", companyId], queryFn: () => listOnHand(companyId!), enabled: !!companyId });
  const { data: boms = [] } = useQuery({ queryKey: ["inv-boms", companyId], queryFn: () => listBoms(companyId!), enabled: !!companyId });
  const { data: orders = [] } = useQuery({ queryKey: ["wo-list", companyId, from, to], queryFn: () => listWorkOrders(companyId!, from, to), enabled: !!companyId });
  const { data: dones = [] } = useQuery({ queryKey: ["wo-done", companyId], queryFn: () => listWoDone(companyId!), enabled: !!companyId });
  const { data: moves = [] } = useQuery({
    queryKey: ["inv-moves", companyId, from, to], queryFn: () => listMoves(companyId!, from, to),
    enabled: !!companyId && tab === "history",
  });

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const whById = useMemo(() => new Map(warehouses.map((w) => [w.id, w])), [warehouses]);
  const doneById = useMemo(() => new Map(dones.map((d) => [d.work_order_id, d.done_qty])), [dones]);

  const shownOrders = useMemo(() => orders.filter((o) =>
    (filter === "all" || o.status === filter) &&
    quickSearchHit(q, [o.wo_no, productById.get(o.product_id)?.name, productById.get(o.product_id)?.sku, o.note])
  ), [orders, filter, q, productById]);
  const orderPager = usePager(shownOrders, 50, `${q}|${filter}|${from}|${to}`);

  //   자재구성 갈래 — 자재가 있는 품목을 앞에, 그 다음 나머지(아직 안 적은 것)
  const bomProducts = useMemo(() => {
    const withBom = new Set(boms.map((b) => b.product_id));
    const list = products.filter((p) => p.is_active && p.track_stock &&
      quickSearchHit(q, [p.sku, p.name, p.spec]));
    return [...list.filter((p) => withBom.has(p.id)), ...list.filter((p) => !withBom.has(p.id))];
  }, [products, boms, q]);
  const bomPager = usePager(bomProducts, 50, `bom|${q}`);

  //   생산 이력 — 완제품이 들어온 줄만 센다(자재 줄은 그 아래 문서로 따로 남는다)
  const prods = useMemo(() => moves.filter((m) => m.doc?.reason === "produce" || m.doc?.reason === "consume"), [moves]);
  const shownProds = useMemo(() => prods.filter((m) => {
    const p = productById.get(m.product_id);
    return quickSearchHit(q, [p?.sku, p?.name, m.doc?.doc_no, m.doc?.note]);
  }), [prods, q, productById]);
  const prodPager = usePager(shownProds, 50, `${q}|${from}|${to}`);

  const counts = useMemo(() => ({
    open: orders.filter((o) => o.status === "open").length,
    done: orders.filter((o) => o.status === "done").length,
    cancelled: orders.filter((o) => o.status === "cancelled").length,
    rest: orders.filter((o) => o.status === "open")
      .reduce((n, o) => n + Math.max(o.planned_qty - (doneById.get(o.id) ?? 0), 0), 0),
    late: orders.filter((o) => o.status === "open" && o.due_date && o.due_date < todayKst()).length,
    withBom: new Set(boms.map((b) => b.product_id)).size,
  }), [orders, doneById, boms]);

  const openWo = useMemo(() => orders.find((o) => o.id === doneFor) || null, [orders, doneFor]);

  if (!permLoading && !(isMaster || hasPerm("/inventory/production"))) {
    return <AccessDenied detail="생산 화면에 대한 권한이 없습니다. 회사 마스터에게 요청하세요." />;
  }

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["wo-list", companyId] });
    qc.invalidateQueries({ queryKey: ["wo-done", companyId] });
    qc.invalidateQueries({ queryKey: ["inv-boms", companyId] });
    qc.invalidateQueries({ queryKey: ["inv-onhand", companyId] });
    qc.invalidateQueries({ queryKey: ["inv-available", companyId] });
    qc.invalidateQueries({ queryKey: ["inv-moves", companyId] });
  };

  return (
    <div className="qk-shell">
      <QueryScreen>
        <QueryHead>
          <div className="collect-tabs no-print">
            {([["orders", "작업지시"], ["bom", "자재구성"], ["history", "생산 이력"]] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setTab(k as Tab)}
                className={tab === k ? "collect-tab collect-tab-on" : "collect-tab"}>
                {l}
                {k === "orders" && counts.late > 0 && <span className="collect-tab-cnt inv-tab-warn">늦음 {counts.late}</span>}
              </button>
            ))}
          </div>

          {tab === "orders" && (
            <>
              <QueryBar right={canWrite ? <button type="button" className="btn-primary btn-sm" onClick={() => setNewOpen(true)}>+ 작업지시</button> : undefined}>
                <DateRangeField from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
                <QuickSearch value={q} onApply={setQ} placeholder="지시번호 · 품목 · 메모 — 쉼표로 여러 개, Enter" />
                <ChipGroup value={filter} onChange={setFilter} options={[
                  { value: "all", label: "전체" },
                  { value: "open", label: `만들 것 ${counts.open}` },
                  { value: "done", label: `다 만듦 ${counts.done}` },
                  { value: "cancelled", label: `취소 ${counts.cancelled}` },
                ]} />
              </QueryBar>
              <ResultStrip>
                <Stat label="지시" value={`${won(shownOrders.length)}건`} />
                <Stat label="만들 것" value={`${won(counts.open)}건`} />
                <Stat label="안 만든 수량" value={`${won(counts.rest)}개`} />
                <Stat label="날짜 지남" value={`${won(counts.late)}건`} tone={counts.late > 0 ? "minus" : undefined} />
              </ResultStrip>
            </>
          )}

          {tab === "bom" && (
            <>
              <QueryBar>
                <QuickSearch value={q} onApply={setQ} placeholder="품목명 · SKU · 규격 — 쉼표로 여러 개, Enter" />
                <span className="inv-hint">
                  <b>1개를 만들 때 무엇이 얼마나 드는지</b>를 적어 둡니다 — 줄을 눌러 고치세요.
                  안 적어도 생산은 되지만, 그때는 자재가 빠지지 않습니다.
                </span>
              </QueryBar>
              <ResultStrip>
                <Stat label="품목" value={`${won(bomProducts.length)}개`} />
                <Stat label="자재구성 있음" value={`${won(counts.withBom)}개`} />
              </ResultStrip>
            </>
          )}

          {tab === "history" && (
            <>
              <QueryBar>
                <DateRangeField from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
                <QuickSearch value={q} onApply={setQ} placeholder="품목 · SKU · 문서번호 — 쉼표로 여러 개, Enter" />
                <span className="inv-hint">완성 한 번에 <b>자재(MTL)</b>와 <b>완제품(PRD)</b> 두 기록이 같이 섭니다.</span>
              </QueryBar>
              <ResultStrip>
                <Stat label="줄" value={`${won(shownProds.length)}개`} />
                <Stat label="만든 수량" value={`${won(shownProds.filter((m) => m.doc?.reason === "produce").reduce((n, m) => n + m.qty, 0))}개`} />
                <Stat label="쓴 자재" value={`${won(Math.abs(shownProds.filter((m) => m.doc?.reason === "consume").reduce((n, m) => n + m.qty, 0)))}개`} />
              </ResultStrip>
            </>
          )}
        </QueryHead>

        <QueryBody>
          <div className="inv-scroll">
            {tab === "orders" && (
              orders.length === 0 ? (
                <div className="collect-empty">
                  이 기간에 낸 작업지시가 없습니다 — <b>+ 작업지시</b>로 무엇을 몇 개 만들지 적으면
                  <b> 들어갈 자재와 모자란 양</b>을 먼저 보여 줍니다.<br />
                  자재를 세려면 <b>자재구성</b> 갈래에서 1개당 드는 양을 먼저 적으세요.
                </div>
              ) : (
                <div className="stg-table-wrap">
                  <table className="ev-table ev-lined table-inv-wo">
                    <thead><tr><th>지시번호</th><th>지시일</th><th>마치기로 한 날</th><th>만들 것</th><th>창고</th><th>진행</th><th>상태</th><th></th></tr></thead>
                    <tbody>
                      {orderPager.view.map((o) => {
                        const p = productById.get(o.product_id);
                        const d = doneById.get(o.id) ?? 0;
                        const rate = o.planned_qty > 0 ? Math.round((d / o.planned_qty) * 100) : 0;
                        const late = o.status === "open" && o.due_date && o.due_date < todayKst();
                        return (
                          <tr key={o.id} className={late ? "inv-row-fix" : undefined}>
                            <td className="mono-number text-left"><b>{o.wo_no}</b></td>
                            <td className="mono-number">{o.order_date}</td>
                            <td className="mono-number">
                              {o.due_date || "—"}
                              {late ? <b className="inv-line-undo">늦음</b> : null}
                            </td>
                            <td className="text-left"><b>{p?.name || "—"}</b> <span className="ev-dim">{p?.sku}</span></td>
                            <td className="tc ev-dim">{whById.get(o.warehouse_id || "")?.name || "—"}</td>
                            <td className="tc"><span className="inv-rate"><b>{won(d)}</b> / {won(o.planned_qty)} <em>{rate}%</em></span></td>
                            <td className="tc">
                              {o.status === "done" ? <span className="inv-pill inv-pill-ok">다 만듦</span>
                                : o.status === "cancelled" ? <span className="inv-pill inv-pill-danger">취소</span>
                                : <span className="inv-pill inv-pill-warn">만들 것</span>}
                            </td>
                            <td className="tc">
                              {canWrite && o.status !== "cancelled" && (
                                <button type="button" className="btn-secondary btn-sm" onClick={() => setDoneFor(o.id)}>
                                  {o.status === "done" ? "되돌리기" : "완성"}</button>
                              )}
                              {canWrite && o.status === "open" && (
                                <button type="button" className="inv-line-x" title="지시 취소"
                                  onClick={async () => {
                                    if (!window.confirm("이 지시를 취소할까요? 이미 만든 것이 있으면 취소되지 않습니다.")) return;
                                    try { await cancelWorkOrder(companyId!, o.id); invalidate(); toast("취소했습니다", "success"); }
                                    catch (e) { toast(friendlyError(e), "error"); }
                                  }}>✕</button>
                              )}
                              {canWrite && o.status === "cancelled" && (
                                <button type="button" className="btn-secondary btn-sm"
                                  onClick={async () => { try { await reopenWorkOrder(o.id); invalidate(); toast("되살렸습니다", "success"); } catch (e) { toast(friendlyError(e), "error"); } }}>되살리기</button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )
            )}

            {tab === "bom" && (
              products.length === 0 ? (
                <div className="collect-empty">
                  품목이 없습니다 — <b>재고 › 품목</b>에서 먼저 등록하세요.
                </div>
              ) : (
                <div className="stg-table-wrap">
                  <table className="ev-table ev-lined table-inv-bom">
                    <thead><tr><th>SKU</th><th>품목명</th><th>규격</th><th>들어가는 자재</th><th>1개 드는 값</th><th></th></tr></thead>
                    <tbody>
                      {bomPager.view.map((p) => {
                        const mine = boms.filter((b) => b.product_id === p.id);
                        const cost = mine.reduce((n, b) => n + b.qty * Number(productById.get(b.component_id)?.cost_price || 0), 0);
                        return (
                          <tr key={p.id} className="inv-row-click" onClick={() => canWrite && setBomFor(p)}>
                            <td className="mono-number text-left">{p.sku}</td>
                            <td className="text-left"><b>{p.name}</b></td>
                            <td className="tc ev-dim">{p.spec || "—"}</td>
                            <td className="text-left">
                              {mine.length === 0 ? <span className="ev-dim">— 아직 없음</span>
                                : mine.slice(0, 4).map((b) => (
                                  <span key={b.id} className="inv-bom-chip">
                                    {productById.get(b.component_id)?.name || "?"} <em>×{won(b.qty)}</em>
                                  </span>
                                ))}
                              {mine.length > 4 && <span className="ev-dim"> 외 {mine.length - 4}가지</span>}
                            </td>
                            <td className="tr mono-number">{mine.length ? `₩${won(cost)}` : "—"}</td>
                            <td className="tc">{canWrite && <span className="ev-dim">고치기</span>}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )
            )}

            {tab === "history" && (
              prods.length === 0 ? (
                <div className="collect-empty">
                  이 기간에 만든 것이 없습니다 — <b>작업지시</b>에서 <b>완성</b>을 누르면 여기에 쌓입니다.
                </div>
              ) : (
                <div className="stg-table-wrap">
                  <table className="ev-table ev-lined table-inv-sales">
                    <thead><tr><th>일자</th><th>문서번호</th><th>갈래</th><th>SKU</th><th>품목명</th><th>수량</th><th>메모</th></tr></thead>
                    <tbody>
                      {prodPager.view.map((m) => (
                        <tr key={m.id}>
                          <td className="mono-number">{m.moved_at.slice(5)}</td>
                          <td className="mono-number text-left">{m.doc?.doc_no || "—"}</td>
                          <td className="tc">
                            <span className={m.doc?.reason === "produce" ? "inv-pill inv-pill-in" : "inv-pill inv-pill-out"}>
                              {m.doc?.reason === "produce" ? "완제품" : "자재"}</span>
                          </td>
                          <td className="mono-number text-left">{productById.get(m.product_id)?.sku || "—"}</td>
                          <td className="text-left"><b>{productById.get(m.product_id)?.name || "—"}</b></td>
                          <td className="tr mono-number"><b>{m.qty > 0 ? `+${won(m.qty)}` : won(m.qty)}</b></td>
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

        {tab === "orders" && orders.length > 0 && (
          <Pager page={orderPager.page} pages={orderPager.pages} total={shownOrders.length} size={50}
            from={orderPager.from} to={orderPager.to} onPage={orderPager.setPage} />
        )}
        {tab === "bom" && bomProducts.length > 0 && (
          <Pager page={bomPager.page} pages={bomPager.pages} total={bomProducts.length} size={50}
            from={bomPager.from} to={bomPager.to} onPage={bomPager.setPage} />
        )}
        {tab === "history" && prods.length > 0 && (
          <Pager page={prodPager.page} pages={prodPager.pages} total={shownProds.length} size={50}
            from={prodPager.from} to={prodPager.to} onPage={prodPager.setPage} />
        )}
      </QueryScreen>

      {newOpen && companyId && (
        <WoDialog companyId={companyId} userId={userId} products={products} warehouses={warehouses}
          boms={boms} onhand={onhand}
          onClose={() => setNewOpen(false)}
          onSaved={(msg) => { setNewOpen(false); invalidate(); toast(msg, "success"); }} />
      )}
      {bomFor && companyId && (
        <BomDialog companyId={companyId} product={bomFor} products={products} boms={boms}
          onClose={() => setBomFor(null)}
          onSaved={() => qc.invalidateQueries({ queryKey: ["inv-boms", companyId] })} />
      )}
      {doneFor && openWo && companyId && (
        <CompleteDialog companyId={companyId} userId={userId} wo={openWo} done={doneById.get(openWo.id) ?? 0}
          products={productById} boms={boms} onhand={onhand}
          onClose={() => setDoneFor(null)}
          onSaved={(msg) => { setDoneFor(null); invalidate(); toast(msg, "success"); }} />
      )}
    </div>
  );
}
