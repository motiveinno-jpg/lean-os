"use client";

// ── 재고 › 채널 (2026-08-25 재고 5단계) ────────────────────────────────────────
//   ★ 결정 17 — 가장 무서운 것은 API 가 없는 것이 아니라 **같은 주문을 두 번 넣는 것**이다.
//     그래서 이 화면의 뼈대는 '무엇을 이미 가져왔는가'이고, 넣기 전에 걸리는 줄을 다 보여 준다.
//   ★ 결정 18 — 키가 없어도 오늘 쓸 수 있어야 한다. 주문 엑셀 붙여넣기가 1등 시민이다.
//   ★ 결정 19 — 채널 상품코드 ↔ SKU 는 사람이 한 번 이어 준다. 이름으로 맞히면 잘못이 곧 재고가 된다.

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
import { listProducts, listWarehouses } from "@/lib/inventory";
import { SortableTh, nextSort, cmp, type SortState } from "@/components/sortable-th";
import {
  CHANNELS, channelLabel, listChannelCodes, upsertChannelCode, deleteChannelCode,
  listImports, resolveRows, importChannelOrders,
  type ChannelValue, type RawOrderRow, type ResolvedRow,
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
  const [channel, setChannel] = useState<ChannelValue>("smartstore");
  const [q, setQ] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [cSort, setCSort] = useState<SortState<CodeKey>>({ key: "code", dir: "asc" });
  const [iSort, setISort] = useState<SortState<ImpKey>>({ key: "at", dir: "desc" });

  const canWrite = isMaster || hasPerm("/inventory/channels");

  const { data: products = [] } = useQuery({ queryKey: ["inv-products", companyId], queryFn: () => listProducts(companyId!), enabled: !!companyId });
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

  const chChips = CHANNELS.map((c) => ({
    value: c.value, label: `${c.label}${codes.filter((x) => x.channel === c.value).length ? ` ${codes.filter((x) => x.channel === c.value).length}` : ""}`,
  }));

  return (
    <div className="qk-shell">
      <QueryScreen>
        <QueryHead>
          <div className="collect-tabs no-print">
            {([["import", "주문 가져오기"], ["codes", "채널 상품 연결"], ["history", "가져온 주문"]] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setTab(k as Tab)}
                className={tab === k ? "collect-tab collect-tab-on" : "collect-tab"}>
                {l}
                {k === "codes" && counts.allCodes === 0 && <span className="collect-tab-cnt inv-tab-warn">먼저 이어야 함</span>}
              </button>
            ))}
          </div>

          {tab === "import" && (
            <QueryBar>
              <ChipGroup value={channel} onChange={(v) => setChannel(v as ChannelValue)} options={chChips} />
              <span className="inv-hint">
                채널에서 받은 <b>주문 엑셀</b>을 그대로 붙여 넣으면 재고에서 빠집니다 —
                <b> 같은 주문번호는 두 번 들어가지 않습니다.</b>
              </span>
            </QueryBar>
          )}

          {tab === "codes" && (
            <>
              <QueryBar right={canWrite ? <button type="button" className="btn-primary btn-sm" onClick={() => setAddOpen(true)}>+ 상품 잇기</button> : undefined}>
                <ChipGroup value={channel} onChange={(v) => setChannel(v as ChannelValue)} options={chChips} />
                <QuickSearch value={q} onApply={setQ} placeholder="채널 상품코드 · 상품명 · SKU — 쉼표로 여러 개, Enter" />
              </QueryBar>
              <ResultStrip>
                <Stat label={channelLabel(channel)} value={`${won(counts.codes)}개 이음`} />
                <Stat label="전체 채널" value={`${won(counts.allCodes)}개`} />
              </ResultStrip>
            </>
          )}

          {tab === "history" && (
            <>
              <QueryBar>
                <ChipGroup value={channel} onChange={(v) => setChannel(v as ChannelValue)} options={chChips} />
                <QuickSearch value={q} onApply={setQ} placeholder="주문번호 · 주문자 — 쉼표로 여러 개, Enter" />
                <span className="inv-hint">여기 있는 주문번호는 <b>다시 넣어도 건너뜁니다</b> — 재고가 두 번 빠지지 않게.</span>
              </QueryBar>
              <ResultStrip>
                <Stat label="가져온 주문" value={`${won(shownImports.length)}건`} />
                <Stat label="금액" value={`₩${won(shownImports.reduce((n, i) => n + Number(i.amount || 0), 0))}`} />
              </ResultStrip>
            </>
          )}
        </QueryHead>

        <QueryBody>
          <div className="inv-scroll">
            {tab === "import" && (
              <ImportPanel companyId={companyId} userId={userId} channel={channel}
                warehouses={warehouses} codesCount={counts.codes} canWrite={canWrite}
                onDone={() => {
                  qc.invalidateQueries({ queryKey: ["ch-imports", companyId] });
                  qc.invalidateQueries({ queryKey: ["inv-onhand", companyId] });
                  qc.invalidateQueries({ queryKey: ["inv-available", companyId] });
                  qc.invalidateQueries({ queryKey: ["inv-moves", companyId] });
                }}
                goCodes={() => setTab("codes")} />
            )}

            {tab === "codes" && (
              shownCodes.length === 0 ? (
                <div className="collect-empty">
                  {channelLabel(channel)}에 이어 둔 상품이 없습니다 — <b>+ 상품 잇기</b>로
                  <b> 채널 상품코드</b>와 우리 <b>SKU</b>를 한 번 이어 주세요.<br />
                  이어 두면 주문 엑셀을 붙여 넣을 때 알아서 우리 품목을 찾습니다.
                  <span className="inv-soon-note">이름으로 알아서 맞히지 않는 이유 — 비슷한 이름끼리 잘못 붙으면 그 잘못이 곧바로 재고가 됩니다.</span>
                </div>
              ) : (
                <div className="stg-table-wrap">
                  <table className="ev-table ev-lined table-inv-ch-codes">
                    <thead><tr>
                      <SortableTh label="채널 상품코드" sortKey="code" sort={cSort} onSort={onCSort} />
                      <SortableTh label="채널 상품명" sortKey="cname" sort={cSort} onSort={onCSort} />
                      <SortableTh label="우리 SKU" sortKey="sku" sort={cSort} onSort={onCSort} />
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
                            <td className="text-left"><b>{p?.name || "— 지워진 품목"}</b></td>
                            <td className="tc ev-dim">{p?.spec || "—"}</td>
                            <td className="tc">
                              {canWrite && (
                                <button type="button" className="inv-line-x" title="연결 끊기"
                                  onClick={async () => {
                                    if (!window.confirm(`${c.channel_product_id} 연결을 끊을까요? 이미 가져온 주문은 그대로 남습니다.`)) return;
                                    try { await deleteChannelCode(c.id); qc.invalidateQueries({ queryKey: ["ch-codes", companyId] }); toast("끊었습니다", "success"); }
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
                  {channelLabel(channel)}에서 가져온 주문이 없습니다 — <b>주문 가져오기</b>에서 엑셀을 붙여 넣으세요.
                </div>
              ) : (
                <div className="stg-table-wrap">
                  <table className="ev-table ev-lined table-inv-ch-imports">
                    <thead><tr>
                      <SortableTh label="주문번호" sortKey="no" sort={iSort} onSort={onISort} />
                      <SortableTh label="주문일" sortKey="date" sort={iSort} onSort={onISort} />
                      <SortableTh label="주문자" sortKey="buyer" sort={iSort} onSort={onISort} />
                      <SortableTh label="금액" sortKey="amount" sort={iSort} onSort={onISort} />
                      <SortableTh label="가져온 때" sortKey="at" sort={iSort} onSort={onISort} />
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

      {addOpen && companyId && (
        <CodeDialog companyId={companyId} channel={channel} products={products}
          onClose={() => setAddOpen(false)}
          onSaved={() => { setAddOpen(false); qc.invalidateQueries({ queryKey: ["ch-codes", companyId] }); toast("이었습니다", "success"); }} />
      )}
    </div>
  );
}

// ── 주문 가져오기 ─────────────────────────────────────────────────────────────
//   갈래 안에서 바로 붙여 넣는다(팝업이 아니다) — 걸린 줄을 표로 길게 보여 줘야 하기 때문이다.
function ImportPanel({ companyId, userId, channel, warehouses, codesCount, canWrite, onDone, goCodes }: {
  companyId: string | null; userId: string | null; channel: ChannelValue;
  warehouses: { id: string; name: string; is_default: boolean }[];
  codesCount: number; canWrite: boolean; onDone: () => void; goCodes: () => void;
}) {
  const { toast } = useToast();
  const [text, setText] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [docDate, setDocDate] = useState(todayKst);
  const [rows, setRows] = useState<ResolvedRow[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!warehouseId) setWarehouseId(warehouses.find((w) => w.is_default)?.id || warehouses[0]?.id || ""); }, [warehouses, warehouseId]);
  useEffect(() => { setRows(null); }, [text, channel]);

  //   엑셀에서 그대로 복사한 줄 — 주문번호 · 상품코드 · 수량 [· 단가 · 주문일 · 주문자]
  const parsed = useMemo(() => {
    const out: RawOrderRow[] = [];
    const bad: string[] = [];
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const p = line.split(/\t|\s{2,}|,/).map((s) => s.trim()).filter(Boolean);
      if (p.length < 3) { bad.push(`${line} → 칸이 모자람(주문번호·상품코드·수량)`); continue; }
      const qty = Number((p[2] || "").replace(/,/g, ""));
      if (!qty || Number.isNaN(qty)) { bad.push(`${line} → 수량을 못 읽음`); continue; }
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

  const sum = useMemo(() => {
    if (!rows) return null;
    return {
      ok: rows.filter((r) => r.reason === "ok").length,
      already: rows.filter((r) => r.reason === "already").length,
      noCode: rows.filter((r) => r.reason === "no-code").length,
      noTrack: rows.filter((r) => r.reason === "no-track").length,
    };
  }, [rows]);

  return (
    <div className="ch-import">
      {codesCount === 0 && (
        <p className="inv-warn">
          {channelLabel(channel)}에 이어 둔 상품이 아직 <b>하나도 없습니다</b> —
          붙여 넣어도 전부 &lsquo;안 이어짐&rsquo;으로 걸립니다.
          <button type="button" className="bz-link ch-link" onClick={goCodes}>채널 상품 연결로 가기</button>
        </p>
      )}

      <div className="ch-grid">
        <label className="inv-field"><span>넣을 창고 *</span>
          <select className="field-input" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
            {warehouses.length === 0 && <option value="">창고가 없습니다 — 재고 › 창고에서 먼저 만드세요</option>}
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select></label>
        <label className="inv-field"><span>출고일 *</span>
          <input type="date" className="field-input" value={docDate} onChange={(e) => setDocDate(e.target.value)} /></label>
      </div>

      <label className="inv-field"><span>주문 붙여넣기</span>
        <textarea className="field-input inv-paste ch-paste" rows={8} value={text} onChange={(e) => setText(e.target.value)}
          placeholder={"주문번호\t채널상품코드\t수량\t단가\t주문일\t주문자\n2026082512345\tSS-1001\t2\t19000\t2026-08-25\t홍길동"} /></label>
      <p className="inv-hint">
        칸 차례는 <b>주문번호 · 채널상품코드 · 수량</b> (그 뒤 단가·주문일·주문자는 있으면 씁니다).
        엑셀에서 그 칸들만 골라 복사해 붙이면 됩니다.
      </p>

      <div className="ch-actions">
        <span className="inv-paste-sum">
          <b>{parsed.out.length}줄 읽었습니다</b>
          {parsed.bad.length > 0 && <span className="inv-paste-bad"> · 못 읽은 {parsed.bad.length}줄: {parsed.bad.slice(0, 2).join(" / ")}{parsed.bad.length > 2 ? " …" : ""}</span>}
        </span>
        <button type="button" className="btn-secondary btn-sm" disabled={!parsed.out.length || busy}
          onClick={async () => {
            setBusy(true);
            try { setRows(await resolveRows(companyId!, channel, parsed.out)); }
            catch (e) { toast(friendlyError(e), "error"); }
            finally { setBusy(false); }
          }}>먼저 맞춰 보기</button>
        <button type="button" className="btn-primary btn-sm"
          disabled={!canWrite || !rows || !sum?.ok || !warehouseId || busy}
          onClick={async () => {
            if (!window.confirm(`${sum!.ok}줄을 재고에서 빼고 판매로 기록합니다. 넣을까요?`)) return;
            setBusy(true);
            try {
              const r = await importChannelOrders(companyId!, channel, warehouseId, rows!, { docDate }, userId);
              toast(`${r.docNo} 로 주문 ${r.orders}건 · ${r.lines}줄을 넣었습니다`, "success");
              setText(""); setRows(null); onDone();
            } catch (e) { toast(friendlyError(e, "넣지 못했습니다"), "error"); }
            finally { setBusy(false); }
          }}>넣기</button>
      </div>

      {rows && sum && (
        <>
          <div className="ch-sum">
            <span className="ch-sum-ok">넣을 것 <b>{sum.ok}</b></span>
            {sum.already > 0 && <span className="ch-sum-skip">이미 가져옴 <b>{sum.already}</b></span>}
            {sum.noCode > 0 && <span className="ch-sum-bad">안 이어짐 <b>{sum.noCode}</b></span>}
            {sum.noTrack > 0 && <span className="ch-sum-skip">수량 안 셈 <b>{sum.noTrack}</b></span>}
          </div>
          <div className="stg-table-wrap">
            <table className="ev-table ev-lined table-inv-ch-check">
              <thead><tr><th>주문번호</th><th>채널 상품코드</th><th>수량</th><th>단가</th><th>어떻게 됩니까</th></tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.channel_order_no}-${i}`} className={r.reason === "no-code" ? "inv-row-fix" : undefined}>
                    <td className="mono-number text-left">{r.channel_order_no}</td>
                    <td className="mono-number text-left">{r.channel_product_id}</td>
                    <td className="tr mono-number">{won(r.qty)}</td>
                    <td className="tr mono-number ev-dim">{r.unit_price != null ? `₩${won(r.unit_price)}` : "—"}</td>
                    <td className="tc">
                      {r.reason === "ok" ? <span className="inv-pill inv-pill-ok">넣습니다</span>
                        : r.reason === "already" ? <span className="inv-pill inv-pill-warn">이미 가져온 주문 — 건너뜁니다</span>
                        : r.reason === "no-track" ? <span className="inv-pill inv-pill-warn">수량을 세지 않는 품목 — 건너뜁니다</span>
                        : <span className="inv-pill inv-pill-danger">이 상품코드를 아직 안 이었습니다</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {sum.noCode > 0 && (
            <p className="inv-foot inv-foot-warn">
              <b>안 이어진 상품코드가 {sum.noCode}줄 있습니다.</b> 그 줄은 넣지 않습니다 —
              <b> 채널 상품 연결</b>에서 그 코드를 우리 SKU 에 이은 뒤 다시 &lsquo;먼저 맞춰 보기&rsquo;를 누르세요.
              이름으로 알아서 맞히지 않는 이유는, 비슷한 이름끼리 잘못 붙으면 그 잘못이 곧바로 재고가 되기 때문입니다.
            </p>
          )}
        </>
      )}

      <p className="inv-foot">
        <b>API 자동 수집은 아직입니다.</b> 네이버 커머스API·쿠팡 윙 API 키는 <b>판매자 본인이 신청</b>해야 해서
        우리가 대신 만들 수 없습니다. 키를 받으시면 <b>회사 설정 › 연동·API 키</b>에 넣어 주세요 —
        그때 이 자리에 &lsquo;자동으로 가져오기&rsquo;가 붙습니다. 그때까지는 엑셀 붙여넣기로 같은 일을 할 수 있습니다.
      </p>
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
        <h3 className="inv-modal-title">{channelLabel(channel)} 상품 잇기</h3>
        <p className="inv-modal-desc">
          채널에 걸린 상품과 우리 품목을 <b>한 번</b> 이어 둡니다. 이어 두면 주문을 붙여 넣을 때 알아서 찾습니다.
        </p>
        <label className="inv-field"><span>채널 상품코드 *</span>
          <input className="field-input" value={code} onChange={(e) => setCode(e.target.value)}
            placeholder="스마트스토어 상품번호 · 쿠팡 옵션ID 등" /></label>
        <label className="inv-field"><span>채널 상품명</span>
          <input className="field-input" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="눈으로 확인하려고 적어 둡니다 (선택)" /></label>
        <label className="inv-field"><span>우리 품목 *</span>
          <select className="field-input" value={productId} onChange={(e) => setProductId(e.target.value)}>
            <option value="">품목 고르기</option>
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
              } catch (e) { toast(friendlyError(e, "잇지 못했습니다"), "error"); }
              finally { setBusy(false); }
            }}>잇기</button>
        </div>
      </div>
    </div>
  );
}
