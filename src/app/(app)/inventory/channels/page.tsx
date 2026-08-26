"use client";

// ── 재고 › 채널 (2026-08-25 재고 5단계) ────────────────────────────────────────
//   ★ 결정 17 — 가장 무서운 것은 API 가 없는 것이 아니라 **같은 주문을 두 번 넣는 것**이다.
//     그래서 이 화면의 뼈대는 '무엇을 이미 가져왔는가'이고, 넣기 전에 걸리는 줄을 다 보여 준다.
//   ★ 결정 18 — 키가 없어도 오늘 쓸 수 있어야 한다. 주문 엑셀 붙여넣기가 1등 시민이다.
//   ★ 결정 19 — 채널 상품코드 ↔ SKU 는 사람이 한 번 이어 준다. 이름으로 맞히면 잘못이 곧 재고가 된다.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getCurrentUser } from "@/lib/queries";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import { useMyPermissions } from "@/lib/permissions";
import { AccessDenied } from "@/components/access-denied";
import { todayKst } from "@/lib/kst";
import { DateRangeField } from "@/components/date-range-field";
import {
  QueryScreen, QueryHead, QueryBody, QueryBar, ResultStrip, Stat, ChipGroup,
  Pager, usePager, QuickSearch, quickSearchHit,
} from "@/components/query-kit";
import { listProducts, listWarehouses, type Product, type Warehouse } from "@/lib/inventory";
import { useDocEditor, DocHead, DocGrid, FormDialog, blankRow, type DocCtl, type DocRow } from "../_components/doc-editor";
import { SortableTh, nextSort, cmp, type SortState } from "@/components/sortable-th";
import {
  CHANNELS, channelLabel, listChannelCodes, upsertChannelCode, deleteChannelCode,
  listImports, listSeenOrderNos, importChannelDoc, fetchChannelOrders, CHANNEL_HAS_API,
  type ChannelValue, type RawOrderRow, type ChannelCode,
} from "@/lib/inventory-channels";

const won = (n: number) => Math.round(n || 0).toLocaleString("ko-KR");
type Tab = "import" | "codes" | "history";
type CodeKey = "code" | "cname" | "sku" | "pname";
type ImpKey = "no" | "date" | "buyer" | "amount" | "at";

export default function ChannelsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { isMaster, hasPerm, loading: permLoading } = useMyPermissions();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => { getCurrentUser().then((u) => { setCompanyId(u?.company_id ?? null); setUserId(u?.id ?? null); }); }, []);

  const [tab, setTab] = useState<Tab>("import");
  const { data: products = [] } = useQuery({ queryKey: ["inv-products", companyId], queryFn: () => listProducts(companyId!), enabled: !!companyId });
  //   채널은 격자 머리(head.channel)가 주인 — 상품 연결·이력 갈래의 칩도 같은 값을 쓴다
  const ctl = useDocEditor(companyId, userId, "channel", products);
  const channel = (ctl.head.channel || "smartstore") as ChannelValue;
  const setChannel = (v: ChannelValue) => ctl.setHead((h) => ({ ...h, channel: v }));
  const [q, setQ] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [cSort, setCSort] = useState<SortState<CodeKey>>({ key: "code", dir: "asc" });
  const [iSort, setISort] = useState<SortState<ImpKey>>({ key: "at", dir: "desc" });

  const canWrite = isMaster || hasPerm("/inventory/channels");

  const { data: warehouses = [] } = useQuery({ queryKey: ["inv-warehouses", companyId], queryFn: () => listWarehouses(companyId!), enabled: !!companyId });
  const { data: codes = [] } = useQuery({ queryKey: ["ch-codes", companyId], queryFn: () => listChannelCodes(companyId!), enabled: !!companyId });
  const { data: imports = [] } = useQuery({ queryKey: ["ch-imports", companyId], queryFn: () => listImports(companyId!), enabled: !!companyId });

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const shownCodes = useMemo(() => codes.filter((c) =>
    c.channel === channel &&
    quickSearchHit(q, [c.channel_product_id, c.channel_product_name, c.channel_sku,
      productById.get(c.product_id)?.sku, productById.get(c.product_id)?.name])
  ), [codes, channel, q, productById]);
  const sortedCodes = useMemo(() => {
    const d = cSort.dir === "asc" ? 1 : -1;
    const val = (c: (typeof shownCodes)[number]) => cSort.key === "code" ? c.channel_product_id
      : cSort.key === "cname" ? (c.channel_product_name || "")
      : cSort.key === "sku" ? (productById.get(c.product_id)?.sku || "")
      : (productById.get(c.product_id)?.name || "");
    return [...shownCodes].sort((a, b) => cmp(val(a), val(b)) * d);
  }, [shownCodes, cSort, productById]);
  const onCSort = (k: string) => setCSort((s) => nextSort(s, k as CodeKey));
  const codePager = usePager(sortedCodes, 50, `${channel}|${q}|${cSort.key}${cSort.dir}`);

  const shownImports = useMemo(() => imports.filter((i) =>
    i.channel === channel && quickSearchHit(q, [i.channel_order_no, i.buyer_name])
  ), [imports, channel, q]);
  const sortedImports = useMemo(() => {
    const d = iSort.dir === "asc" ? 1 : -1;
    const val = (i: (typeof shownImports)[number]) => iSort.key === "no" ? i.channel_order_no
      : iSort.key === "date" ? (i.order_date || "") : iSort.key === "buyer" ? (i.buyer_name || "")
      : iSort.key === "amount" ? (i.amount ?? -Infinity) : i.imported_at;
    return [...shownImports].sort((a, b) => cmp(val(a), val(b)) * d);
  }, [shownImports, iSort]);
  const onISort = (k: string) => setISort((s) => nextSort(s, k as ImpKey));
  const importPager = usePager(sortedImports, 50, `${channel}|${q}|${iSort.key}${iSort.dir}`);

  const counts = useMemo(() => ({
    codes: codes.filter((c) => c.channel === channel).length,
    allCodes: codes.length,
    imports: imports.filter((i) => i.channel === channel).length,
  }), [codes, imports, channel]);

  if (!permLoading && !(isMaster || hasPerm("/inventory/channels"))) {
    return <AccessDenied detail="채널 화면에 대한 권한이 없습니다. 회사 마스터에게 요청하세요." />;
  }

  const grid = useImportGrid({
    ctl, products, warehouses, codes, canWrite,
    onDone: () => {
      qc.invalidateQueries({ queryKey: ["ch-imports", companyId] });
      qc.invalidateQueries({ queryKey: ["inv-onhand", companyId] });
      qc.invalidateQueries({ queryKey: ["inv-available", companyId] });
      qc.invalidateQueries({ queryKey: ["inv-moves", companyId] });
    },
    goCodes: () => setTab("codes"),
  });
  //   들어오면 첫 칸에 커서(전표 화면과 같다)
  useEffect(() => { if (tab === "import") setTimeout(() => ctl.focusCell(0, ctl.cells[0]), 250); }, [tab]);   // eslint-disable-line react-hooks/exhaustive-deps

  const chChips = CHANNELS.map((c) => ({
    value: c.value, label: `${c.label}${codes.filter((x) => x.channel === c.value).length ? ` ${codes.filter((x) => x.channel === c.value).length}` : ""}`,
  }));

  return (
    <div className="qk-shell">
      <QueryScreen>
        <QueryHead>
          <div className="collect-tabs no-print">
            {([["import", "주문 가져오기"], ["codes", "상품 연결"], ["history", "가져오기 이력"]] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setTab(k as Tab)}
                className={tab === k ? "collect-tab collect-tab-on" : "collect-tab"}>
                {l}
                {k === "codes" && counts.allCodes === 0 && <span className="collect-tab-cnt inv-tab-warn">연결 필요</span>}
              </button>
            ))}
          </div>

          {tab === "import" && grid.head}

          {tab === "codes" && (
            <>
              <QueryBar right={canWrite ? <button type="button" className="btn-primary btn-sm" onClick={() => setAddOpen(true)}>+ 상품 연결</button> : undefined}>
                <ChipGroup value={channel} onChange={(v) => setChannel(v as ChannelValue)} options={chChips} />
                <QuickSearch value={q} onApply={setQ} placeholder="채널 상품코드 · 상품명 · SKU — 쉼표로 여러 개, Enter" />
              </QueryBar>
              <ResultStrip>
                <Stat label={channelLabel(channel)} value={`연결 ${won(counts.codes)}개`} />
                <Stat label="전체 채널" value={`${won(counts.allCodes)}개`} />
              </ResultStrip>
            </>
          )}

          {tab === "history" && (
            <>
              <QueryBar>
                <ChipGroup value={channel} onChange={(v) => setChannel(v as ChannelValue)} options={chChips} />
                <QuickSearch value={q} onApply={setQ} placeholder="주문번호 · 주문자 — 쉼표로 여러 개, Enter" />
                <span className="inv-hint">등록된 주문번호는 <b>다시 가져와도 건너뜁니다</b> (재고 중복 차감 방지).</span>
              </QueryBar>
              <ResultStrip>
                <Stat label="등록 주문" value={`${won(shownImports.length)}건`} />
                <Stat label="금액" value={`₩${won(shownImports.reduce((n, i) => n + Number(i.amount || 0), 0))}`} />
              </ResultStrip>
            </>
          )}
        </QueryHead>

        <QueryBody>
          <div className="inv-scroll">
            {tab === "import" && grid.body}

            {tab === "codes" && (
              shownCodes.length === 0 ? (
                <div className="collect-empty">
                  {channelLabel(channel)}에 연결된 상품이 없습니다. <b>+ 상품 연결</b>에서
                  <b> 채널 상품코드</b>와 <b>SKU</b>를 연결하세요.<br />
                  연결된 상품코드는 주문 가져오기에서 자동으로 품목에 대응됩니다.
                  <span className="inv-soon-note">상품명으로 자동 대응하지 않는 이유 — 유사한 상품명이 잘못 대응되면 재고 오류로 이어집니다.</span>
                </div>
              ) : (
                <div className="stg-table-wrap">
                  <table className="ev-table ev-lined table-inv-ch-codes">
                    <thead><tr>
                      <SortableTh label="채널 상품코드" sortKey="code" sort={cSort} onSort={onCSort} />
                      <SortableTh label="채널 상품명" sortKey="cname" sort={cSort} onSort={onCSort} />
                      <SortableTh label="SKU" sortKey="sku" sort={cSort} onSort={onCSort} />
                      <SortableTh label="품목명" sortKey="pname" sort={cSort} onSort={onCSort} />
                      <th>규격</th><th></th>
                    </tr></thead>
                    <tbody>
                      {codePager.view.map((c) => {
                        const p = productById.get(c.product_id);
                        return (
                          <tr key={c.id}>
                            <td className="mono-number text-left"><b>{c.channel_product_id}</b></td>
                            <td className="text-left ev-dim">{c.channel_product_name || "—"}</td>
                            <td className="mono-number text-left">{p?.sku || "—"}</td>
                            <td className="text-left"><b>{p?.name || "삭제된 품목"}</b></td>
                            <td className="tc ev-dim">{p?.spec || "—"}</td>
                            <td className="tc">
                              {canWrite && (
                                <button type="button" className="inv-line-x" title="연결 해제"
                                  onClick={async () => {
                                    if (!window.confirm(`${c.channel_product_id} 연결을 해제할까요? 이미 등록된 주문은 유지됩니다.`)) return;
                                    try { await deleteChannelCode(c.id); qc.invalidateQueries({ queryKey: ["ch-codes", companyId] }); toast("연결을 해제했습니다", "success"); }
                                    catch (e) { toast(friendlyError(e), "error"); }
                                  }}>✕</button>
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

            {tab === "history" && (
              shownImports.length === 0 ? (
                <div className="collect-empty">
                  {channelLabel(channel)}에서 등록한 주문이 없습니다. <b>주문 가져오기</b>에서 엑셀을 붙여 넣어 등록하세요.
                </div>
              ) : (
                <div className="stg-table-wrap">
                  <table className="ev-table ev-lined table-inv-ch-imports">
                    <thead><tr>
                      <SortableTh label="주문번호" sortKey="no" sort={iSort} onSort={onISort} />
                      <SortableTh label="주문일" sortKey="date" sort={iSort} onSort={onISort} />
                      <SortableTh label="주문자" sortKey="buyer" sort={iSort} onSort={onISort} />
                      <SortableTh label="금액" sortKey="amount" sort={iSort} onSort={onISort} />
                      <SortableTh label="등록 시각" sortKey="at" sort={iSort} onSort={onISort} />
                    </tr></thead>
                    <tbody>
                      {importPager.view.map((i) => (
                        <tr key={i.id}>
                          <td className="mono-number text-left"><b>{i.channel_order_no}</b></td>
                          <td className="mono-number">{i.order_date || "—"}</td>
                          <td className="text-left">{i.buyer_name || "—"}</td>
                          <td className="tr mono-number">{i.amount != null ? `₩${won(i.amount)}` : "—"}</td>
                          <td className="tc ev-dim">{i.imported_at.slice(5, 16).replace("T", " ")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}
          </div>
        </QueryBody>

        {tab === "codes" && shownCodes.length > 0 && (
          <Pager page={codePager.page} pages={codePager.pages} total={shownCodes.length} size={50}
            from={codePager.from} to={codePager.to} onPage={codePager.setPage} />
        )}
        {tab === "history" && shownImports.length > 0 && (
          <Pager page={importPager.page} pages={importPager.pages} total={shownImports.length} size={50}
            from={importPager.from} to={importPager.to} onPage={importPager.setPage} />
        )}
      </QueryScreen>

      {grid.dialogs}
      {addOpen && companyId && (
        <CodeDialog companyId={companyId} channel={channel} products={products}
          onClose={() => setAddOpen(false)}
          onSaved={() => { setAddOpen(false); qc.invalidateQueries({ queryKey: ["ch-codes", companyId] }); toast("연결했습니다", "success"); }} />
      )}
    </div>
  );
}

// ── 주문 가져오기 — 판매와 같은 격자 입력 (2026-08-26 사장님 지시) ──────────────
//   "여기도 입력화면 형식으로 하고, 채널별로 API 연결해서 끌고 오면 자동으로 채워지게."
//   ★ 붙여넣기도 API 도 격자를 **채우기만** 한다. 출고 등록은 사람이 누른다(제안은 자동, 확정은 사람).
//   ★ 채널 상품코드를 치면 상품 연결(결정 19)로 품목이 저절로 온다. 없으면 줄이 표시되고 저장이 막힌다 —
//     품목을 직접 고르거나 상품 연결에서 등록한다. 주문번호가 이미 등록된 줄은 줄 그어 두고 저장 때 건너뛴다.
function useImportGrid({ ctl, products, warehouses, codes, canWrite, onDone, goCodes }: {
  ctl: DocCtl; products: Product[]; warehouses: Warehouse[]; codes: ChannelCode[];
  canWrite: boolean; onDone: () => void; goCodes: () => void;
}) {
  const { toast } = ctl;
  const [busy, setBusy] = useState(false);
  const [paste, setPaste] = useState(false);
  const [fetchOpen, setFetchOpen] = useState(false);
  const channel = (ctl.head.channel || CHANNELS[0].value) as ChannelValue;

  const codeMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of codes) if (c.channel === channel && c.is_active) m.set(c.channel_product_id.trim().toUpperCase(), c.product_id);
    return m;
  }, [codes, channel]);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  //   ★ 채널 상품코드 → 품목 자동 채움. 코드가 있는데 품목이 없으면 nocode 표시, 품목이 오면 표시를 지운다.
  useEffect(() => {
    ctl.setRows((rows) => {
      let changed = false;
      const next = rows.map((r) => {
        const code = r.ccode.trim().toUpperCase();
        if (!code) { if (r.flag === "nocode") { changed = true; return { ...r, flag: null }; } return r; }
        if (r.product_id) { if (r.flag === "nocode") { changed = true; return { ...r, flag: null }; } return r; }
        const pid = codeMap.get(code);
        const p = pid ? byId.get(pid) : undefined;
        if (p) { const n = { ...r, custom: { ...r.custom }, flag: null as DocRow["flag"] }; ctl.fillFrom(n, p); changed = true; return n; }
        if (r.flag !== "nocode") { changed = true; return { ...r, flag: "nocode" as const }; }
        return r;
      });
      return changed ? next : rows;
    });
  }, [ctl.rows, codeMap, byId]);   // eslint-disable-line react-hooks/exhaustive-deps

  //   주문번호가 이미 등록됐는지 — 줄이 바뀔 때 물어본다(그 주문번호만).
  const nos = ctl.rows.map((r) => r.ono.trim()).filter(Boolean).join("|");
  useEffect(() => {
    if (!ctl.companyId || !nos) return;
    let alive = true;
    listSeenOrderNos(ctl.companyId, channel, nos.split("|")).then((seen) => {
      if (!alive) return;
      ctl.setRows((rows) => {
        let changed = false;
        const next = rows.map((r) => {
          const dup = !!r.ono.trim() && seen.has(r.ono.trim());
          if (dup && r.flag !== "dup" && r.flag !== "nocode") { changed = true; return { ...r, flag: "dup" as const }; }
          if (!dup && r.flag === "dup") { changed = true; return { ...r, flag: null }; }
          return r;
        });
        return changed ? next : rows;
      });
    }).catch(() => {});
    return () => { alive = false; };
  }, [nos, channel, ctl.companyId]);   // eslint-disable-line react-hooks/exhaustive-deps

  const counts = useMemo(() => ({
    nocode: ctl.live.filter((r) => r.flag === "nocode").length,
    dup: ctl.live.filter((r) => r.flag === "dup").length,
  }), [ctl.live]);

  /** 붙여넣기·API 가 준 줄을 격자에 깐다 — 이미 친 줄은 남기고 뒤에 붙인다. */
  const putRows = (raw: (RawOrderRow & { product_name?: string | null })[]) => {
    ctl.setRows((s) => {
      const keep = s.filter((r) => r.product_id || r.sku.trim() || r.ono.trim() || r.ccode.trim());
      const add = raw.map((x) => {
        const r = blankRow();
        r.ono = x.channel_order_no; r.ccode = x.channel_product_id; r.buyer = x.buyer_name || "";
        r.qty = String(x.qty);
        const pid = codeMap.get(x.channel_product_id.trim().toUpperCase());
        const p = pid ? byId.get(pid) : undefined;
        if (p) ctl.fillFrom(r, p);
        else if (x.product_name) r.sku = "";
        if (x.unit_price != null) {
          r.price = String(x.unit_price);
          const sup = Number(x.unit_price) * Number(x.qty);
          r.supply = String(sup); r.vat = String(Math.round(sup * 0.1));
        }
        if (!p) r.flag = "nocode";
        if (x.product_name && !p) r.lnote = x.product_name;
        return r;
      });
      return [...keep, ...add, blankRow()];
    });
  };

  const save = async () => {
    const built = ctl.build();
    const wh = built.head.wh;
    if (!ctl.live.length) { toast("입력된 항목이 없습니다", "error"); return; }
    if (!wh) { toast("출고 창고를 선택하세요", "error"); return; }
    if (counts.nocode) { toast(`미연결 상품코드 ${counts.nocode}줄 — 품목을 고르거나 상품 연결에서 등록하세요`, "error"); return; }
    const lines = built.lines.filter((l) => l.flag !== "dup");
    if (lines.some((l) => !l.product_id || !(l.qty > 0) || !l.ono)) { toast("주문번호·품목·수량을 확인하세요", "error"); return; }
    if (!lines.length) { toast("모두 이미 등록된 주문번호입니다", "error"); return; }
    if (!window.confirm(`${lines.length}줄을 출고(판매)로 등록합니다.${counts.dup ? ` 이미 등록된 ${counts.dup}줄은 건너뜁니다.` : ""} 진행할까요?`)) return;
    setBusy(true);
    try {
      const r = await importChannelDoc(ctl.companyId!, channel, wh, built.date, built.head.note || null,
        lines.map((l) => ({
          product_id: l.product_id, qty: l.qty, unit_price: l.unit_price, vat_amount: l.vat_amount,
          channel_order_no: l.ono, channel_product_id: l.ccode, buyer_name: l.buyer || null,
        })), ctl.userId);
      toast(`${r.docNo} · 주문 ${r.orders}건 · ${r.lines}줄 등록${r.skipped ? ` · ${r.skipped}줄 건너뜀` : ""}`, "success");
      const ch = channel;
      ctl.reset(); ctl.setHead((h) => ({ ...h, channel: ch }));
      onDone();
    } catch (e) { toast(friendlyError(e, "등록하지 못했습니다"), "error"); }
    finally { setBusy(false); }
  };

  const head = (
    <>
      <QueryBar right={canWrite ? (
        <>
          <button type="button" className="btn-secondary btn-sm" onClick={() => setFetchOpen(true)}>채널에서 가져오기</button>
          <button type="button" className="btn-secondary btn-sm" onClick={() => setPaste(true)}>엑셀 붙여넣기</button>
          <button type="button" className="btn-secondary btn-sm" onClick={ctl.openForm}>입력 항목</button>
          <button type="button" className="btn-primary btn-sm" disabled={busy} onClick={save}>출고 등록</button>
        </>
      ) : undefined}>
        <span className="inv-hint doc-note-move">저장하면 <b>재고가 즉시 차감</b>되고 주문번호가 기록됩니다 — 같은 주문번호는 중복 등록되지 않습니다.</span>
      </QueryBar>
      <ResultStrip>
        <Stat label="줄" value={`${won(ctl.sums.lines)}개`} />
        {counts.nocode > 0 && <Stat label="미연결" value={`${counts.nocode}줄`} tone="minus" />}
        {counts.dup > 0 && <Stat label="기존 등록" value={`${counts.dup}줄`} />}
        <Stat label="공급가액" value={`₩${won(ctl.sums.supply)}`} />
        <Stat label="합계" value={`₩${won(ctl.sums.total)}`} />
        <span className="spv-toolbar-hint">
          채널 상품코드를 입력하면 <b>연결된 품목이 자동으로</b> 채워집니다 · <b>Enter</b> 는 윗줄 값 입력 후 다음 칸
          {counts.nocode > 0 && <> · <button type="button" className="bz-link" onClick={goCodes}>상품 연결로 이동</button></>}
        </span>
      </ResultStrip>
    </>
  );
  const body = (
    <>
      <DocHead ctl={ctl} warehouses={warehouses} partners={[]} />
      <DocGrid ctl={ctl} products={products} />
      <div className="doc-add">
        <button type="button" className="btn-secondary btn-sm" onClick={() => ctl.setRows((s) => [...s, blankRow()])}>+ 줄</button>
      </div>
    </>
  );
  const dialogs = (
    <>
      <FormDialog ctl={ctl} />
      {paste && <PasteDialog channel={channel} onClose={() => setPaste(false)} onRows={(rows) => { putRows(rows); setPaste(false); }} />}
      {fetchOpen && <FetchDialog channel={channel} onClose={() => setFetchOpen(false)} onRows={(rows) => { putRows(rows); setFetchOpen(false); }} />}
    </>
  );
  return { head, body, dialogs };
}

// ── 엑셀 붙여넣기 — 격자에 깐다 ──────────────────────────────────────────────
function PasteDialog({ channel, onClose, onRows }: { channel: ChannelValue; onClose: () => void; onRows: (r: RawOrderRow[]) => void }) {
  const [text, setText] = useState("");
  const parsed = useMemo(() => {
    const out: RawOrderRow[] = []; const bad: string[] = [];
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      //   탭으로 온 줄(엑셀)은 빈 칸도 자리로 센다 — 주문일이 비어도 주문자가 밀리지 않게
      const p = line.includes("\t") ? line.split("\t").map((s) => s.trim()) : line.split(/\s{2,}|,/).map((s) => s.trim()).filter(Boolean);
      if (p.length < 3) { bad.push(`${line} → 필수 열 부족(주문번호·상품코드·수량)`); continue; }
      const qty = Number((p[2] || "").replace(/,/g, ""));
      if (!qty || Number.isNaN(qty)) { bad.push(`${line} → 수량 인식 실패`); continue; }
      const price = p[3] ? Number(p[3].replace(/[,₩원]/g, "")) : null;
      out.push({
        channel_order_no: p[0], channel_product_id: p[1], qty,
        unit_price: price != null && !Number.isNaN(price) ? price : null,
        order_date: p[4] && /^\d{4}-\d{2}-\d{2}$/.test(p[4]) ? p[4] : null,
        buyer_name: p[5] || null,
      });
    }
    return { out, bad };
  }, [text]);
  return (
    <div className="inv-modal" onClick={onClose}>
      <div className="inv-modal-box inv-modal-wide" onClick={(e) => e.stopPropagation()}>
        <h3 className="inv-modal-title">{channelLabel(channel)} 주문 엑셀 붙여넣기</h3>
        <p className="inv-modal-desc">
          열 순서: <b>주문번호 · 채널 상품코드 · 수량</b> (단가·주문일·주문자는 선택). 엑셀에서 해당 열을 복사해 붙여 넣으세요.
          격자에 채워지기만 하고, 출고 등록은 따로 누릅니다.
        </p>
        <textarea className="field-input inv-paste ch-paste" rows={10} value={text} onChange={(e) => setText(e.target.value)} autoFocus
          placeholder={"주문번호\t채널상품코드\t수량\t단가\t주문일\t주문자\n2026082512345\tSS-1001\t2\t19000\t2026-08-25\t홍길동"} />
        <p className="inv-foot">
          <b>{parsed.out.length}줄 인식</b>
          {parsed.bad.length > 0 && <span className="inv-paste-bad"> · 인식 실패 {parsed.bad.length}줄: {parsed.bad.slice(0, 2).join(" / ")}{parsed.bad.length > 2 ? " …" : ""}</span>}
        </p>
        <div className="inv-modal-actions">
          <button type="button" className="btn-secondary btn-sm" onClick={onClose}>취소</button>
          <button type="button" className="btn-primary btn-sm" disabled={!parsed.out.length} onClick={() => onRows(parsed.out)}>격자에 채우기</button>
        </div>
      </div>
    </div>
  );
}

// ── 채널 API 에서 가져오기 — 회사 키로 서버가 부른다 ──────────────────────────
function FetchDialog({ channel, onClose, onRows }: { channel: ChannelValue; onClose: () => void; onRows: (r: RawOrderRow[]) => void }) {
  const [from, setFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().slice(0, 10); });
  const [to, setTo] = useState(todayKst);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ message: string; noKey?: boolean; noApi?: boolean } | null>(null);
  const hasApi = CHANNEL_HAS_API.has(channel);
  return (
    <div className="inv-modal" onClick={onClose}>
      <div className="inv-modal-box" onClick={(e) => e.stopPropagation()}>
        <h3 className="inv-modal-title">{channelLabel(channel)}에서 주문 가져오기</h3>
        {hasApi ? (
          <>
            <p className="inv-modal-desc">
              회사 설정에 등록한 <b>{channelLabel(channel)} API 키</b>로 결제 완료 주문을 받아 격자에 채웁니다.
              재고에는 아직 반영되지 않습니다 — 확인 후 <b>출고 등록</b>을 누르세요.
            </p>
            <div className="inv-field">
              <DateRangeField label="주문 기간" from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} /></div>
            {err && (
              <p className="inv-foot inv-foot-warn">
                {err.message}
                {err.noKey && <> <Link href="/settings/integration?tab=api-keys" className="bz-link ch-link">연동·API 키로 이동</Link></>}
              </p>
            )}
            <div className="inv-modal-actions">
              <button type="button" className="btn-secondary btn-sm" onClick={onClose}>취소</button>
              <button type="button" className="btn-primary btn-sm" disabled={busy}
                onClick={async () => {
                  setBusy(true); setErr(null);
                  try {
                    const r = await fetchChannelOrders(channel, from, to);
                    if (!r.ok) { setErr(r); return; }
                    if (!r.rows.length) { setErr({ message: "이 기간에 결제 완료 주문이 없습니다." }); return; }
                    onRows(r.rows);
                  } finally { setBusy(false); }
                }}>{busy ? "가져오는 중…" : "가져오기"}</button>
            </div>
          </>
        ) : (
          <>
            <p className="inv-modal-desc">
              <b>{channelLabel(channel)}</b>은 아직 API 자동 수집을 지원하지 않습니다 — <b>엑셀 붙여넣기</b>로 같은 격자에 채울 수 있습니다.
              스마트스토어·쿠팡은 회사 설정 › 연동·API 키에 키를 등록하면 여기서 바로 가져옵니다.
            </p>
            <div className="inv-modal-actions">
              <button type="button" className="btn-secondary btn-sm" onClick={onClose}>닫기</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── 채널 상품 잇기 ────────────────────────────────────────────────────────────
function CodeDialog({ companyId, channel, products, onClose, onSaved }: {
  companyId: string; channel: ChannelValue; products: { id: string; sku: string; name: string; spec: string | null; is_active: boolean }[];
  onClose: () => void; onSaved: () => void;
}) {
  const { toast } = useToast();
  const [productId, setProductId] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <div className="inv-modal" onClick={onClose}>
      <div className="inv-modal-box" onClick={(e) => e.stopPropagation()}>
        <h3 className="inv-modal-title">{channelLabel(channel)} 상품 연결</h3>
        <p className="inv-modal-desc">
          채널 상품코드와 품목을 <b>한 번</b> 연결합니다. 이후 주문 가져오기에서 자동으로 품목에 대응됩니다.
        </p>
        <label className="inv-field"><span>채널 상품코드 *</span>
          <input className="field-input" value={code} onChange={(e) => setCode(e.target.value)}
            placeholder="스마트스토어 상품번호 · 쿠팡 옵션ID" /></label>
        <label className="inv-field"><span>채널 상품명</span>
          <input className="field-input" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="확인용 (선택)" /></label>
        <label className="inv-field"><span>품목 *</span>
          <select className="field-input" value={productId} onChange={(e) => setProductId(e.target.value)}>
            <option value="">품목 선택</option>
            {products.filter((p) => p.is_active).map((p) => (
              <option key={p.id} value={p.id}>{p.sku} · {p.name}{p.spec ? ` (${p.spec})` : ""}</option>
            ))}
          </select></label>
        <div className="inv-modal-actions">
          <button type="button" className="btn-secondary btn-sm" onClick={onClose}>취소</button>
          <button type="button" className="btn-primary btn-sm" disabled={!productId || !code.trim() || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await upsertChannelCode(companyId, { product_id: productId, channel, channel_product_id: code, channel_product_name: name });
                onSaved();
              } catch (e) { toast(friendlyError(e, "연결하지 못했습니다"), "error"); }
              finally { setBusy(false); }
            }}>연결</button>
        </div>
      </div>
    </div>
  );
}
