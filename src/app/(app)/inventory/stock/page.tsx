"use client";

// ── 재고 › 재고 (2026-08-25 재고 1단계) ─────────────────────────────────────────
//   "이거 지금 몇 개 있어?" 한 가지를 위한 화면. 그래서 첫 줄이 목록이 아니라 **신호**다.
//   ★ 결정 3 — 수량을 저장하지 않는다. v_stock_onhand(움직인 기록의 합)를 읽는다.
//   ★ 결정 5 — 주문·발주 없이도 입·출고가 선다. 여기서 바로 넣는 것이 그것이다.
//   ★ 결정 7 — 음수는 에러가 아니라 '아직 안 맞춘 것'. 막지 않고 '맞춰야 할 것'으로 세운다.
//   ★ 결정 8 — 지우지 않고 부호로 남긴다. 수량 칸에 음수를 넣을 수 있고, 화면이 뜻을 되읽어 준다.

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
import { SortableTh, nextSort, cmp, type SortState } from "@/components/sortable-th";
import { useStockCount, CountBar, CountBody, NewCountDialog, CountPasteDialog } from "../_components/count";
import {
  listProducts, listOnHand, listWarehouses, listMoves, createStockDoc,
  ensureDefaultWarehouse, upsertWarehouse, STOCK_REASONS, reasonOf, reasonLabel,
  type Product, type Warehouse, type StockReason,
} from "@/lib/inventory";

const won = (n: number) => Math.round(n || 0).toLocaleString("ko-KR");
type Tab = "onhand" | "moves" | "count" | "warehouse";
type Signal = "all" | "low" | "zero" | "fix";
type StockKey = "sku" | "name" | "spec" | "wh" | "qty" | "safety" | "state";
type MoveKey = "date" | "doc" | "reason" | "sku" | "name" | "wh" | "qty" | "price" | "amount";
//   상태 정렬은 처리할 것이 위 (CLAUDE.md: 대기→승인→반려→취소와 같은 원칙)
const STATE_RANK: Record<Signal, number> = { fix: 0, zero: 1, low: 2, all: 3 };

export default function StockPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { isMaster, hasPerm, loading: permLoading } = useMyPermissions();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => { getCurrentUser().then((u) => { setCompanyId(u?.company_id ?? null); setUserId(u?.id ?? null); }); }, []);

  const [tab, setTab] = useState<Tab>("onhand");
  const [q, setQ] = useState("");
  const [signal, setSignal] = useState<Signal>("all");
  const [sort, setSort] = useState<SortState<StockKey>>({ key: "state", dir: "asc" });
  const [mSort, setMSort] = useState<SortState<MoveKey>>({ key: "date", dir: "desc" });
  const [from, setFrom] = useState(() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 10); });
  const [to, setTo] = useState(todayKst);
  const [docOpen, setDocOpen] = useState(false);
  const [openingOpen, setOpeningOpen] = useState(false);

  //   재고를 '움직일' 권한 — 없으면 보기만 (창고 담당이 아닌 사람이 수량을 바꾸면 안 된다)
  const canMove = isMaster || hasPerm("/inventory/stock:adjust");

  const { data: products = [] } = useQuery({ queryKey: ["inv-products", companyId], queryFn: () => listProducts(companyId!), enabled: !!companyId });
  const { data: warehouses = [] } = useQuery({ queryKey: ["inv-warehouses", companyId], queryFn: () => listWarehouses(companyId!), enabled: !!companyId });
  const { data: onhand = [] } = useQuery({ queryKey: ["inv-onhand", companyId], queryFn: () => listOnHand(companyId!), enabled: !!companyId });
  const { data: moves = [] } = useQuery({
    queryKey: ["inv-moves", companyId, from, to],
    queryFn: () => listMoves(companyId!, from, to),
    enabled: !!companyId && tab === "moves",
  });

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const whById = useMemo(() => new Map(warehouses.map((w) => [w.id, w])), [warehouses]);

  //   실사 — 상태가 여러 곳(조회 줄·표·팝업)에 걸려 훅 하나로 모은다. 훅은 조기 return 앞이어야 한다.
  const count = useStockCount(companyId, userId, canMove, productById);

  //   현재고 줄 — 품목 × 창고. 수량을 세지 않는 품목은 애초에 나오지 않는다(결정 6-④).
  const rows = useMemo(() => {
    const out = onhand
      .map((r) => ({ ...r, product: productById.get(r.product_id), wh: whById.get(r.warehouse_id) }))
      .filter((r) => r.product && r.product.track_stock);
    return out.map((r) => {
      const safety = r.product!.safety_stock;
      const state: Signal = r.qty < 0 ? "fix" : r.qty === 0 ? "zero"
        : (safety != null && r.qty <= Number(safety)) ? "low" : "all";
      return { ...r, state };
    });
  }, [onhand, productById, whById]);

  const shown = useMemo(() => rows.filter((r) =>
    (signal === "all" || r.state === signal) &&
    quickSearchHit(q, [r.product?.sku, r.product?.name, r.product?.spec, r.wh?.name])
  ), [rows, signal, q]);

  const sorted = useMemo(() => {
    const d = sort.dir === "asc" ? 1 : -1;
    const val = (r: (typeof shown)[number]) => {
      switch (sort.key) {
        case "sku": return r.product?.sku || "";
        case "name": return r.product?.name || "";
        case "spec": return r.product?.spec || "";
        case "wh": return r.wh?.name || "";
        case "qty": return r.qty;
        case "safety": return r.product?.safety_stock == null ? -Infinity : Number(r.product.safety_stock);
        default: return STATE_RANK[r.state];
      }
    };
    return [...shown].sort((a, b) => cmp(val(a), val(b)) * d);
  }, [shown, sort]);
  const onSort = (k: string) => setSort((s) => nextSort(s, k as StockKey));
  const pager = usePager(sorted, 50, `${q}|${signal}|${sort.key}${sort.dir}`);
  const counts = useMemo(() => ({
    low: rows.filter((r) => r.state === "low").length,
    zero: rows.filter((r) => r.state === "zero").length,
    fix: rows.filter((r) => r.state === "fix").length,
    value: rows.reduce((n, r) => n + r.qty * Number(r.product?.cost_price || 0), 0),
  }), [rows]);

  const sortedMoves = useMemo(() => {
    const d = mSort.dir === "asc" ? 1 : -1;
    const val = (m: (typeof moves)[number]) => {
      const p = productById.get(m.product_id);
      switch (mSort.key) {
        case "doc": return m.doc?.doc_no || "";
        case "reason": return reasonLabel(m.doc?.reason || "");
        case "sku": return p?.sku || "";
        case "name": return p?.name || "";
        case "wh": return whById.get(m.warehouse_id)?.name || "";
        case "qty": return m.qty;
        case "price": return m.unit_price ?? -Infinity;
        case "amount": return m.amount ?? -Infinity;
        default: return m.moved_at;
      }
    };
    return [...moves].sort((a, b) => cmp(val(a), val(b)) * d);
  }, [moves, mSort, productById, whById]);
  const onMSort = (k: string) => setMSort((s) => nextSort(s, k as MoveKey));
  const movePager = usePager(sortedMoves, 50, `${from}|${to}|${mSort.key}${mSort.dir}`);

  if (!permLoading && !(isMaster || hasPerm("/inventory/stock"))) {
    return <AccessDenied detail="재고 화면에 대한 권한이 없습니다. 회사 마스터에게 요청하세요." />;
  }

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["inv-onhand", companyId] });
    qc.invalidateQueries({ queryKey: ["inv-moves", companyId] });
    qc.invalidateQueries({ queryKey: ["inv-warehouses", companyId] });
  };

  return (
    <div className="qk-shell">
      <QueryScreen>
        <QueryHead>
          <div className="collect-tabs no-print">
            {([["onhand", "현재고"], ["moves", "움직인 이력"], ["count", "실사"], ["warehouse", "창고"]] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setTab(k as Tab)}
                className={tab === k ? "collect-tab collect-tab-on" : "collect-tab"}>
                {l}
                {k === "onhand" && counts.fix > 0 && <span className="collect-tab-cnt inv-tab-warn">맞춰야 할 것 {counts.fix}</span>}
              </button>
            ))}
          </div>

          {tab === "onhand" && (
            <>
              <QueryBar right={canMove ? (
                <>
                  <button type="button" className="btn-secondary btn-sm" onClick={() => setOpeningOpen(true)}>기초 재고 올리기</button>
                  <button type="button" className="btn-primary btn-sm" onClick={() => setDocOpen(true)}>+ 입·출고</button>
                </>
              ) : undefined}>
                <QuickSearch value={q} onApply={setQ} placeholder="품목명 · SKU · 규격 · 창고 — 쉼표로 여러 개, Enter" />
                <ChipGroup value={signal} onChange={setSignal} options={[
                  { value: "all", label: "전체" },
                  { value: "low", label: `부족 ${counts.low}` },
                  { value: "zero", label: `품절 ${counts.zero}` },
                  { value: "fix", label: `맞춰야 할 것 ${counts.fix}`, title: "장부가 실물을 못 따라간 줄(음수) — 지우지 않고 맞춥니다" },
                ]} />
              </QueryBar>
              <ResultStrip>
                <Stat label="줄" value={`${won(shown.length)}개`} />
                <Stat label="부족" value={`${won(counts.low)}개`} tone={counts.low > 0 ? "minus" : undefined} />
                <Stat label="품절" value={`${won(counts.zero)}개`} tone={counts.zero > 0 ? "minus" : undefined} />
                <Stat label="재고금액" value={`₩${won(counts.value)}`} />
              </ResultStrip>
            </>
          )}

          {tab === "moves" && (
            <>
              <QueryBar>
                <DateRangeField from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
                <span className="text-[11px] text-[var(--text-dim)]">움직인 기록만 쌓고 현재고는 그 합입니다 — 지우지 않고 반대 기록으로 되돌립니다.</span>
              </QueryBar>
              <ResultStrip>
                <Stat label="움직임" value={`${won(moves.length)}줄`} />
                <Stat label="들어옴" value={`${won(moves.filter((m) => m.qty > 0).reduce((n, m) => n + m.qty, 0))}개`} />
                <Stat label="나감" value={`${won(Math.abs(moves.filter((m) => m.qty < 0).reduce((n, m) => n + m.qty, 0)))}개`} />
              </ResultStrip>
            </>
          )}

          {tab === "count" && <CountBar ctl={count} warehouses={warehouses} onhand={onhand} />}

          {tab === "warehouse" && (
            <>
              <QueryBar right={canMove ? <WarehouseAdd companyId={companyId} onDone={invalidate} /> : undefined}>
                <span className="inv-hint">재고는 창고마다 따로 셉니다. 창고가 없으면 첫 입·출고에서 &lsquo;본사창고&rsquo;가 자동으로 만들어집니다.</span>
              </QueryBar>
              <ResultStrip>
                <Stat label="창고" value={`${won(warehouses.length)}개`} />
                <Stat label="재고 있는 품목" value={`${won(new Set(onhand.filter((r) => r.qty !== 0).map((r) => r.product_id)).size)}개`} />
                <Stat label="재고 수량" value={`${won(onhand.reduce((n, r) => n + r.qty, 0))}개`} />
              </ResultStrip>
            </>
          )}
        </QueryHead>

        <QueryBody>
          <div className="inv-scroll">
            {tab === "onhand" && (
              rows.length === 0 ? (
                <div className="collect-empty">
                  아직 움직인 기록이 없습니다 — <b>기초 재고 올리기</b>로 지금 있는 수량을 한 번에 넣거나, <b>+ 입·출고</b>로 한 줄씩 넣으세요.<br />
                  품목이 없다면 <b>재고 › 품목</b>에서 먼저 등록합니다.
                </div>
              ) : (
                <>
                  <div className="stg-table-wrap">
                    <table className="ev-table ev-lined table-inv-stock">
                      <thead><tr>
                        <SortableTh label="SKU" sortKey="sku" sort={sort} onSort={onSort} />
                        <SortableTh label="품목명" sortKey="name" sort={sort} onSort={onSort} />
                        <SortableTh label="규격" sortKey="spec" sort={sort} onSort={onSort} />
                        <SortableTh label="창고" sortKey="wh" sort={sort} onSort={onSort} />
                        <SortableTh label="현재고" sortKey="qty" sort={sort} onSort={onSort} />
                        <SortableTh label="안전재고" sortKey="safety" sort={sort} onSort={onSort} />
                        <SortableTh label="상태" sortKey="state" sort={sort} onSort={onSort} />
                      </tr></thead>
                      <tbody>
                        {pager.view.map((r) => (
                          <tr key={`${r.product_id}-${r.warehouse_id}`} className={r.state === "fix" ? "inv-row-fix" : undefined}>
                            <td className="mono-number text-left">{r.product?.sku}</td>
                            <td className="text-left"><b>{r.product?.name}</b></td>
                            <td className="tc ev-dim">{r.product?.spec || "—"}</td>
                            <td className="tc">{r.wh?.name || "—"}</td>
                            <td className="tr mono-number"><b className={r.qty < 0 ? "text-[var(--danger)]" : undefined}>{won(r.qty)}</b></td>
                            <td className="tr mono-number ev-dim">{r.product?.safety_stock != null ? won(Number(r.product.safety_stock)) : "—"}</td>
                            <td className="tc">
                              {r.state === "fix" ? <span className="inv-pill inv-pill-danger">맞춰야 함</span>
                                : r.state === "zero" ? <span className="inv-pill inv-pill-danger">품절</span>
                                : r.state === "low" ? <span className="inv-pill inv-pill-warn">부족</span>
                                : <span className="inv-pill inv-pill-ok">정상</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {counts.fix > 0 && (
                    <p className="inv-foot inv-foot-warn">
                      <b>음수가 {counts.fix}줄 있습니다.</b> 이건 잘못 누른 것이 아니라 <b>장부가 실물을 못 따라간 것</b>입니다 —
                      대개 <b>입고를 안 적은 것</b>이니 &lsquo;+ 입·출고&rsquo;에서 <b>매입 입고</b>로 채우거나, 실제 수량으로 <b>실사 조정</b>하세요.
                      맞출 때까지 이 줄은 내려가지 않습니다.
                    </p>
                  )}
                </>
              )
            )}

            {tab === "moves" && (
              moves.length === 0 ? (
                <div className="collect-empty">이 기간에 움직인 기록이 없습니다.</div>
              ) : (
                <div className="stg-table-wrap">
                  <table className="ev-table ev-lined table-inv-moves">
                    <thead><tr>
                      <SortableTh label="일자" sortKey="date" sort={mSort} onSort={onMSort} />
                      <SortableTh label="문서번호" sortKey="doc" sort={mSort} onSort={onMSort} />
                      <SortableTh label="사유" sortKey="reason" sort={mSort} onSort={onMSort} />
                      <SortableTh label="SKU" sortKey="sku" sort={mSort} onSort={onMSort} />
                      <SortableTh label="품목명" sortKey="name" sort={mSort} onSort={onMSort} />
                      <SortableTh label="창고" sortKey="wh" sort={mSort} onSort={onMSort} />
                      <SortableTh label="수량" sortKey="qty" sort={mSort} onSort={onMSort} />
                      <SortableTh label="단가" sortKey="price" sort={mSort} onSort={onMSort} />
                      <SortableTh label="금액" sortKey="amount" sort={mSort} onSort={onMSort} />
                      <th>메모</th>
                    </tr></thead>
                    <tbody>
                      {movePager.view.map((m) => {
                        const p = productById.get(m.product_id);
                        return (
                          <tr key={m.id}>
                            <td className="mono-number">{m.moved_at.slice(5)}</td>
                            <td className="mono-number text-left">{m.doc?.doc_no || "—"}</td>
                            {/*   부호가 사유와 반대면 취소된 줄이다 — 적지 않으면 '판매 출고 +50' 이 무슨 뜻인지 알 수 없다 */}
                            <td className="tc">
                              <span className={m.qty > 0 ? "inv-pill inv-pill-in" : "inv-pill inv-pill-out"}>{reasonLabel(m.doc?.reason || "")}</span>
                              {(() => {
                                //   입·출고에서만 따진다 — 조정(기초·실사·정정)은 음수가 원래 정상이고,
                                //     창고 이동은 한 문서에 +− 두 줄이라 받는 쪽이 항상 반대 부호다.
                                const rd = reasonOf(m.doc?.reason || "");
                                if (!rd || rd.kind === "adjust" || rd.kind === "move") return null;
                                return rd.sign === (m.qty > 0 ? -1 : 1) ? <b className="inv-line-undo">취소</b> : null;
                              })()}
                            </td>
                            <td className="mono-number text-left">{p?.sku || "—"}</td>
                            <td className="text-left">{p?.name || "—"}</td>
                            <td className="tc">{whById.get(m.warehouse_id)?.name || "—"}</td>
                            <td className="tr mono-number"><b className={m.qty < 0 ? "text-[var(--flow-out,inherit)]" : undefined}>{m.qty > 0 ? `+${won(m.qty)}` : won(m.qty)}</b></td>
                            <td className="tr mono-number ev-dim">{m.unit_price != null ? won(m.unit_price) : "—"}</td>
                            <td className="tr mono-number">{m.amount != null ? won(m.amount) : "—"}</td>
                            <td className="text-left ev-dim">{m.note || m.doc?.note || "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )
            )}

            {tab === "count" && <CountBody ctl={count} warehouses={warehouses} onhand={onhand} productById={productById} />}

            {tab === "warehouse" && (
              warehouses.length === 0 ? (
                <div className="collect-empty">창고가 없습니다 — 첫 입·출고에서 &lsquo;본사창고&rsquo;가 자동으로 만들어집니다.</div>
              ) : (
                <div className="stg-table-wrap">
                  <table className="ev-table ev-lined table-inv-wh">
                    <thead><tr><th>창고</th><th>코드</th><th>기본</th><th>품목 수</th><th>재고 수량</th></tr></thead>
                    <tbody>
                      {warehouses.map((w) => {
                        const mine = onhand.filter((r) => r.warehouse_id === w.id);
                        return (
                          <tr key={w.id}>
                            <td className="text-left"><b>{w.name}</b></td>
                            <td className="tc ev-dim">{w.code || "—"}</td>
                            <td className="tc">{w.is_default ? "✅" : "—"}</td>
                            <td className="tr mono-number">{won(mine.filter((r) => r.qty !== 0).length)}</td>
                            <td className="tr mono-number">{won(mine.reduce((n, r) => n + r.qty, 0))}</td>
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

        {tab === "onhand" && <Pager page={pager.page} pages={pager.pages} total={shown.length} size={50} from={pager.from} to={pager.to} onPage={pager.setPage} />}
        {tab === "count" && !count.openId && count.counts.data && count.counts.data.length > 0 && (
          <Pager page={count.listPager.page} pages={count.listPager.pages} total={count.counts.data.length} size={50}
            from={count.listPager.from} to={count.listPager.to} onPage={count.listPager.setPage} />
        )}
        {tab === "count" && count.openId && (
          <Pager page={count.linePager.page} pages={count.linePager.pages} total={count.shown.length} size={50}
            from={count.linePager.from} to={count.linePager.to} onPage={count.linePager.setPage} />
        )}
        {tab === "moves" && <Pager page={movePager.page} pages={movePager.pages} total={moves.length} size={50} from={movePager.from} to={movePager.to} onPage={movePager.setPage} />}
      </QueryScreen>

      {docOpen && companyId && (
        <StockDocDialog companyId={companyId} userId={userId} products={products} warehouses={warehouses}
          onClose={() => setDocOpen(false)}
          onSaved={(msg) => { setDocOpen(false); invalidate(); toast(msg, "success"); }}
          onError={(e) => toast(friendlyError(e, "저장하지 못했습니다"), "error")} />
      )}
      <NewCountDialog ctl={count} warehouses={warehouses} />
      <CountPasteDialog ctl={count} productById={productById} />
      {openingOpen && companyId && (
        <OpeningDialog companyId={companyId} userId={userId} products={products} warehouses={warehouses}
          onClose={() => setOpeningOpen(false)}
          onSaved={(msg) => { setOpeningOpen(false); invalidate(); toast(msg, "success"); }}
          onError={(e) => toast(friendlyError(e, "저장하지 못했습니다"), "error")} />
      )}
    </div>
  );
}

/** 창고 추가 — 한 줄 폼 */
function WarehouseAdd({ companyId, onDone }: { companyId: string | null; onDone: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  return (
    <span className="inv-wh-add">
      <input className="field-input" placeholder="창고 이름" value={name} onChange={(e) => setName(e.target.value)} />
      <button type="button" className="btn-primary btn-sm" disabled={!name.trim()}
        onClick={async () => {
          if (!companyId) return;
          try { await upsertWarehouse(companyId, { name }); setName(""); onDone(); toast("창고를 만들었습니다", "success"); }
          catch (e) { toast(friendlyError(e, "만들지 못했습니다"), "error"); }
        }}>+ 창고</button>
    </span>
  );
}

/** 입·출고·조정·이동 — 주문·발주 없이도 선다(결정 5) */
function StockDocDialog({ companyId, userId, products, warehouses, onClose, onSaved, onError }: {
  companyId: string; userId: string | null; products: Product[]; warehouses: Warehouse[];
  onClose: () => void; onSaved: (msg: string) => void; onError: (e: unknown) => void;
}) {
  const tracked = useMemo(() => products.filter((p) => p.track_stock && p.is_active), [products]);
  const [reason, setReason] = useState<StockReason>("purchase");
  const [docDate, setDocDate] = useState(todayKst);
  const [whId, setWhId] = useState(warehouses.find((w) => w.is_default)?.id || warehouses[0]?.id || "");
  const [toWhId, setToWhId] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<{ product_id: string; qty: string; unit_price: string }[]>([{ product_id: "", qty: "", unit_price: "" }]);
  const [busy, setBusy] = useState(false);

  const def = reasonOf(reason);
  const isMove = def?.kind === "move";
  const ready = !!whId && (!isMove || (!!toWhId && toWhId !== whId)) &&
    lines.some((l) => l.product_id && Number(l.qty) !== 0);

  const setLine = (i: number, k: "product_id" | "qty" | "unit_price", v: string) =>
    setLines((s) => s.map((l, j) => (j === i ? { ...l, [k]: v } : l)));

  return (
    <div className="inv-modal" role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="inv-modal-box inv-modal-wide">
        <div className="inv-modal-head">
          <b>재고 움직이기</b>
          <button type="button" className="inv-modal-x" onClick={onClose} aria-label="닫기">✕</button>
        </div>

        <div className="inv-form-grid">
          <label className="inv-field"><span>사유 *</span>
            <select className="field-input" value={reason} onChange={(e) => setReason(e.target.value as StockReason)}>
              {STOCK_REASONS.filter((r) => r.value !== "opening" && r.value !== "count").map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select></label>
          <label className="inv-field"><span>일자</span>
            <input type="date" className="field-input" value={docDate} onChange={(e) => setDocDate(e.target.value)} /></label>
          <label className="inv-field"><span>{isMove ? "보내는 창고 *" : "창고 *"}</span>
            <select className="field-input" value={whId} onChange={(e) => setWhId(e.target.value)}>
              {warehouses.length === 0 && <option value="">(첫 저장 때 본사창고가 만들어집니다)</option>}
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select></label>
          {isMove && (
            <label className="inv-field"><span>받는 창고 *</span>
              <select className="field-input" value={toWhId} onChange={(e) => setToWhId(e.target.value)}>
                <option value="">고르세요</option>
                {warehouses.filter((w) => w.id !== whId).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select></label>
          )}
        </div>

        <div className="inv-lines">
          {lines.map((l, i) => {
            const raw = Number(l.qty);
            const signed = !l.qty || Number.isNaN(raw) ? 0 : raw * (def?.sign ?? 1);
            return (
              <div key={i} className="inv-line">
                <select className="field-input" value={l.product_id} onChange={(e) => setLine(i, "product_id", e.target.value)}>
                  <option value="">품목 고르기</option>
                  {tracked.map((p) => <option key={p.id} value={p.id}>{p.sku} · {p.name}{p.spec ? ` (${p.spec})` : ""}</option>)}
                </select>
                <input className="field-input" inputMode="numeric" placeholder="수량" value={l.qty} onChange={(e) => setLine(i, "qty", e.target.value)} />
                <input className="field-input" inputMode="numeric" placeholder="단가(선택)" value={l.unit_price} onChange={(e) => setLine(i, "unit_price", e.target.value)} />
                {/*   ★ 결정 8 — 음수는 '취소·되돌림'이다. 지우는 대신 반대로 한 줄 쌓는 것이니,
                        **재고가 어느 쪽으로 움직이는지**를 되읽어 준다 */}
                <span className={signed < 0 ? "inv-line-eff inv-line-eff-out" : "inv-line-eff inv-line-eff-in"}>
                  {signed === 0 ? "—" : signed > 0 ? `재고 +${won(signed)}` : `재고 ${won(signed)}`}
                  {raw < 0 ? <b className="inv-line-undo">취소</b> : null}
                </span>
                <button type="button" className="inv-line-x" onClick={() => setLines((s) => s.filter((_, j) => j !== i))} aria-label="줄 지우기">✕</button>
              </div>
            );
          })}
          <button type="button" className="btn-secondary btn-sm" onClick={() => setLines((s) => [...s, { product_id: "", qty: "", unit_price: "" }])}>+ 줄 추가</button>
        </div>

        {/*   음수를 막지 않는다 — 다만 재고가 어느 쪽으로 가는지를 적어 되묻는다(제안은 자동, 확정은 사람) */}
        {def && lines.some((l) => Number(l.qty) < 0) && (
          <p className="inv-warn">
            수량이 음수인 줄은 <b>{def.label} 취소</b>로 읽습니다 — 재고가 {def.sign < 0 ? <b>다시 늘어납니다</b> : <b>다시 줄어듭니다</b>}.
            되돌리는 것이 아니라 새로 샀거나 되돌려받은 것이라면 <b>반품 입고</b>·<b>반품 출고</b>를 고르세요.
          </p>
        )}

        <label className="inv-field"><span>메모</span>
          <input className="field-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="왜 움직였는지 한 줄" /></label>

        <div className="inv-modal-actions">
          <button type="button" className="btn-secondary btn-sm" onClick={onClose}>취소</button>
          <button type="button" className="btn-primary btn-sm" disabled={!ready || busy}
            onClick={async () => {
              setBusy(true);
              try {
                let wid = whId;
                if (!wid) { const w = await ensureDefaultWarehouse(companyId); wid = w?.id || ""; }
                const res = await createStockDoc(companyId, {
                  reason, docDate, warehouseId: wid, toWarehouseId: isMove ? toWhId : null, note,
                  lines: lines.filter((l) => l.product_id && Number(l.qty) !== 0).map((l) => ({
                    product_id: l.product_id, qty: Number(l.qty),
                    unit_price: l.unit_price === "" ? null : Number(l.unit_price),
                  })),
                }, userId);
                onSaved(`${res.docNo} 로 기록했습니다${res.skipped ? ` (수량을 세지 않는 품목 ${res.skipped}줄은 뺐습니다)` : ""}`);
              } catch (e) { onError(e); } finally { setBusy(false); }
            }}>{busy ? "저장 중…" : "기록하기"}</button>
        </div>
      </div>
    </div>
  );
}

/** 기초 재고 올리기 — 엑셀에서 복사해 붙여넣는다(SKU · 수량). 판매를 먼저 켜므로 이게 필수 조건이다. */
function OpeningDialog({ companyId, userId, products, warehouses, onClose, onSaved, onError }: {
  companyId: string; userId: string | null; products: Product[]; warehouses: Warehouse[];
  onClose: () => void; onSaved: (msg: string) => void; onError: (e: unknown) => void;
}) {
  const [text, setText] = useState("");
  const [whId, setWhId] = useState(warehouses.find((w) => w.is_default)?.id || warehouses[0]?.id || "");
  const [busy, setBusy] = useState(false);
  const bySku = useMemo(() => new Map(products.map((p) => [p.sku.trim().toLowerCase(), p])), [products]);

  const parsed = useMemo(() => {
    const ok: { product: Product; qty: number }[] = [];
    const bad: string[] = [];
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim();
      if (!t) continue;
      const cells = t.split(/\t|,|\s{2,}/).map((c) => c.trim()).filter(Boolean);
      if (cells.length < 2) { bad.push(t); continue; }
      const p = bySku.get(cells[0].toLowerCase());
      const qty = Number(cells[cells.length - 1].replace(/[^0-9.-]/g, ""));
      if (!p) { bad.push(`${t}  → SKU 없음`); continue; }
      if (!p.track_stock) { bad.push(`${t}  → 수량을 세지 않는 품목`); continue; }
      if (!qty) { bad.push(`${t}  → 수량 없음`); continue; }
      ok.push({ product: p, qty });
    }
    return { ok, bad };
  }, [text, bySku]);

  return (
    <div className="inv-modal" role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="inv-modal-box inv-modal-wide">
        <div className="inv-modal-head">
          <b>기초 재고 올리기</b>
          <button type="button" className="inv-modal-x" onClick={onClose} aria-label="닫기">✕</button>
        </div>
        <p className="inv-modal-desc">
          엑셀에서 <b>SKU 와 수량</b> 두 칸을 복사해 그대로 붙여넣으세요. 지금 있는 수량을 <b>기초 등록</b> 기록으로 넣습니다 —
          수량 칸을 고치는 것이 아니라 <b>움직인 기록</b>으로 남으므로 나중에 되짚을 수 있습니다.
        </p>
        <label className="inv-field"><span>창고 *</span>
          <select className="field-input" value={whId} onChange={(e) => setWhId(e.target.value)}>
            {warehouses.length === 0 && <option value="">(첫 저장 때 본사창고가 만들어집니다)</option>}
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select></label>
        <textarea className="field-input inv-paste" rows={8} value={text} onChange={(e) => setText(e.target.value)}
          placeholder={"TS-BLK-M\t124\nTS-BLK-L\t8\nMG-CER-01\t30"} />
        <div className="inv-paste-sum">
          <b>{parsed.ok.length}줄</b> 읽었습니다
          {parsed.bad.length > 0 && <span className="inv-paste-bad"> · 못 읽은 {parsed.bad.length}줄: {parsed.bad.slice(0, 3).join(" / ")}{parsed.bad.length > 3 ? " …" : ""}</span>}
        </div>
        <div className="inv-modal-actions">
          <button type="button" className="btn-secondary btn-sm" onClick={onClose}>취소</button>
          <button type="button" className="btn-primary btn-sm" disabled={!parsed.ok.length || busy}
            onClick={async () => {
              setBusy(true);
              try {
                let wid = whId;
                if (!wid) { const w = await ensureDefaultWarehouse(companyId); wid = w?.id || ""; }
                const res = await createStockDoc(companyId, {
                  reason: "opening", warehouseId: wid, note: "기초 재고 등록",
                  lines: parsed.ok.map((r) => ({ product_id: r.product.id, qty: r.qty })),
                }, userId);
                onSaved(`${res.docNo} 로 기초 재고 ${parsed.ok.length}줄을 넣었습니다`);
              } catch (e) { onError(e); } finally { setBusy(false); }
            }}>{busy ? "넣는 중…" : `${parsed.ok.length}줄 넣기`}</button>
        </div>
      </div>
    </div>
  );
}
