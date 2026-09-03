"use client";

// ── 재고 › 이커머스 (2026-08-25 재고 5단계) ────────────────────────────────────────
//   ★ 결정 17 — 가장 무서운 것은 API 가 없는 것이 아니라 **같은 주문을 두 번 넣는 것**이다.
//     그래서 이 화면의 뼈대는 '무엇을 이미 가져왔는가'이고, 넣기 전에 걸리는 줄을 다 보여 준다.
//   ★ 결정 18 — 키가 없어도 오늘 쓸 수 있어야 한다. 주문 엑셀 붙여넣기가 1등 시민이다.
//   ★ 결정 19 — 채널 상품코드 ↔ SKU 는 사람이 한 번 이어 준다. 이름으로 맞히면 잘못이 곧 재고가 된다.

import { SimpleCond, SimpleApplied, condHit, type CondLive } from "../_components/simple-cond";
import { appConfirm } from "@/components/global-confirm";
import { ExcelPasteHelper } from "../_components/excel-paste-helper";
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
  Pager, usePager, QuickSearch, quickSearchHit, SelectionBar, HelperMenu } from "@/components/query-kit";
import { exportToExcel } from "@/lib/excel-export";
import { listProducts, listWarehouses, type Product, type Warehouse } from "@/lib/inventory";
import { useDocEditor, DocHead, DocGrid, FormDialog, blankRow, type DocCtl, type DocRow } from "../_components/doc-editor";
import { SortableTh, nextSort, cmp, type SortState } from "@/components/sortable-th";
import {
  CHANNELS, channelLabel, listChannelCodes, upsertChannelCode, deleteChannelCode,
  listImports, listSeenOrderNos, importChannelDoc, fetchChannelOrders, CHANNEL_HAS_API,
  updateShipping, listImportItems, CARRIERS, SHIP_STATUS_LABEL,
  CARRIER_SHEETS, SHEET_FIELDS, listSheetLayouts, saveSheetLayout, deleteSheetLayout, sheetRow, type SheetLayout, type SheetColumn,
  type ChannelValue, type RawOrderRow, type ChannelCode, type OrderImport,
} from "@/lib/inventory-channels";

const won = (n: number) => Math.round(n || 0).toLocaleString("ko-KR");
type Tab = "status" | "import" | "ship" | "codes" | "history";
type CodeKey = "code" | "cname" | "sku" | "pname";
type ImpKey = "no" | "date" | "buyer" | "amount" | "at";

export default function ChannelsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { isMaster, hasPerm, loading: permLoading } = useMyPermissions();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => { getCurrentUser().then((u) => { setCompanyId(u?.company_id ?? null); setUserId(u?.id ?? null); }); }, []);

  //   첫 갈래 = 현황(결정 148, 2026-09-02 사장님 승인) — 들어오면 수집·판매·배송이 먼저 보인다
  const [tab, setTab] = useState<Tab>("status");
  const { data: products = [] } = useQuery({ queryKey: ["inv-products", companyId], queryFn: () => listProducts(companyId!), enabled: !!companyId });
  const ctl = useDocEditor(companyId, userId, "channel", products);
  //   상품 연결·이력 갈래가 보는 채널(칩). 주문 가져오기 격자는 줄마다 채널 칸이 따로 있다.
  const [channel, setChannel] = useState<ChannelValue>("smartstore");   // 새 연결·붙여넣기 팝업의 기본 채널
  //   목록의 채널 필터는 검색조건(다중, 비우면 전체) — 조회 줄에 채널 칩을 늘어놓지 않는다 (2026-08-27 사장님 지적)
  const [cond, setCond] = useState<CondLive>({});
  const [q, setQ] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [cSort, setCSort] = useState<SortState<CodeKey>>({ key: "code", dir: "asc" });
  const [iSort, setISort] = useState<SortState<ImpKey>>({ key: "at", dir: "desc" });

  //   메뉴 권한 = 보기, `:write` = 가져오기·출고 등록·발송 처리·상품 연결 (2026-08-26 권한 세분화)
  const canWrite = isMaster || hasPerm("/inventory/channels:write");

  const { data: warehouses = [] } = useQuery({ queryKey: ["inv-warehouses", companyId], queryFn: () => listWarehouses(companyId!), enabled: !!companyId });
  const { data: codes = [] } = useQuery({ queryKey: ["ch-codes", companyId], queryFn: () => listChannelCodes(companyId!), enabled: !!companyId });
  const { data: imports = [] } = useQuery({ queryKey: ["ch-imports", companyId], queryFn: () => listImports(companyId!), enabled: !!companyId });

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const shownCodes = useMemo(() => codes.filter((c) =>
    condHit(cond, "channel", c.channel) &&
    quickSearchHit(q, [c.channel_product_id, c.channel_product_name, c.channel_sku,
      productById.get(c.product_id)?.sku, productById.get(c.product_id)?.name])
  ), [codes, cond, q, productById]);
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
    condHit(cond, "channel", i.channel) && quickSearchHit(q, [i.channel_order_no, i.buyer_name, i.recipient_name, i.recipient_phone, i.address])
  ), [imports, cond, q]);
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
    pending: imports.filter((i) => i.ship_status === "pending").length,
  }), [codes, imports, channel]);

  // ── 현황(결정 148) — 운영 콕핏: 수집·판매·배송을 첫 갈래에서 한눈에. 모든 숫자는 눌러서 갈래로 ──
  const [stRange, setStRange] = useState<"today" | "7d" | "30d" | "month">("7d");
  const [stCh, setStCh] = useState<string>("");   // "" = 전체
  const stData = useMemo(() => {
    const ymd = (t: Date) => `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
    const todayStr = ymd(new Date());
    const fromD = new Date();
    if (stRange === "7d") fromD.setDate(fromD.getDate() - 6);
    else if (stRange === "30d") fromD.setDate(fromD.getDate() - 29);
    else if (stRange === "month") fromD.setDate(1);
    const fromStr = ymd(fromD);
    const inRange = imports.filter((i) => (i.order_date || "") >= fromStr && (i.order_date || "") <= todayStr && (!stCh || i.channel === stCh));
    const amt = (list: OrderImport[]) => list.reduce((n, i) => n + Number(i.amount || 0), 0);
    const yestD = new Date(); yestD.setDate(yestD.getDate() - 1);
    const twoD = new Date(); twoD.setDate(twoD.getDate() - 2);
    const pendingList = inRange.filter((i) => i.ship_status === "pending");
    const byChannel = CHANNELS.map((c) => {
      const list = inRange.filter((i) => i.channel === c.value);
      return {
        ch: c.value, label: c.label, n: list.length, amount: amt(list),
        pending: list.filter((i) => i.ship_status === "pending").length,
        done: list.filter((i) => i.ship_status === "done").length,
      };
    }).filter((r) => r.n > 0).sort((a, b) => b.amount - a.amount);
    //   일별은 기간과 무관하게 최근 14일 — 흐름 감각용
    const days: { d: string; label: string; n: number }[] = [];
    for (let k = 13; k >= 0; k--) {
      const t = new Date(); t.setDate(t.getDate() - k); const s = ymd(t);
      days.push({ d: s, label: k === 0 ? "오늘" : String(Number(s.slice(8, 10))), n: 0 });
    }
    for (const i of imports) {
      if (stCh && i.channel !== stCh) continue;
      const hit = days.find((x) => x.d === i.order_date);
      if (hit) hit.n += 1;
    }
    //   수집 상태 — 채널별 마지막 등록 시각(전체 이력 기준). 3일+ 끊기면 빨간불
    const last = new Map<string, string>();
    for (const i of imports) { const cur = last.get(i.channel); if (!cur || i.imported_at > cur) last.set(i.channel, i.imported_at); }
    const sync = CHANNELS.filter((c) => last.has(c.value)).map((c) => {
      const at = last.get(c.value)!;
      return { ch: c.value, label: c.label, at, ageDays: Math.floor((Date.now() - new Date(at).getTime()) / 86400000), api: CHANNEL_HAS_API.has(c.value) };
    });
    return {
      fromStr, todayStr,
      total: inRange.length, amount: amt(inRange),
      todayN: inRange.filter((i) => i.order_date === todayStr).length,
      yestN: inRange.filter((i) => i.order_date === ymd(yestD)).length,
      pending: pendingList.length,
      pendingOld: pendingList.filter((i) => (i.order_date || "") <= ymd(twoD)).length,
      shipped: inRange.filter((i) => i.ship_status === "shipped").length,
      done: inRange.filter((i) => i.ship_status === "done").length,
      byChannel, days, sync,
    };
  }, [imports, stRange, stCh]);
  //   숫자 클릭 = 그 갈래로(주문 목록은 '가져오기 이력'이 목록 갈래다)
  const goList = (ch?: string) => { setCond(ch ? { channel: [ch] } : {}); setTab("history"); };

  //   훅은 권한 조기 return 앞에 (훅 순서 규칙)
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
  const ship = useShipPanel({ companyId, userId, imports, products, canWrite,
    onDone: () => qc.invalidateQueries({ queryKey: ["ch-imports", companyId] }) });
  //   들어오면 첫 칸에 커서(전표 화면과 같다)
  useEffect(() => { if (tab === "import") setTimeout(() => ctl.focusDate(), 250); }, [tab]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!permLoading && !(isMaster || hasPerm("/inventory/channels"))) {
    return <AccessDenied detail="이커머스 화면에 대한 권한이 없습니다. 회사 마스터에게 요청하세요." />;
  }

  const chChips = CHANNELS.map((c) => ({
    value: c.value, label: `${c.label}${codes.filter((x) => x.channel === c.value).length ? ` ${codes.filter((x) => x.channel === c.value).length}` : ""}`,
  }));

  return (
    <div className="qk-shell">
      <QueryScreen>
        <QueryHead>
          <div className="collect-tabs no-print">
            {([["status", "현황"], ["import", "주문 가져오기"], ["ship", "출고 처리"], ["codes", "상품 연결"], ["history", "가져오기 이력"]] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setTab(k as Tab)}
                className={tab === k ? "collect-tab collect-tab-on" : "collect-tab"}>
                {l}
                {k === "ship" && counts.pending > 0 && <span className="collect-tab-cnt inv-tab-warn">{counts.pending}</span>}
                {k === "codes" && counts.allCodes === 0 && <span className="collect-tab-cnt inv-tab-warn">연결 필요</span>}
              </button>
            ))}
          </div>

          {tab === "status" && (
            <QueryBar>
              <select className="ch-st-sel" value={stRange} onChange={(e) => setStRange(e.target.value as typeof stRange)} aria-label="기간">
                <option value="today">오늘</option>
                <option value="7d">최근 7일</option>
                <option value="30d">최근 30일</option>
                <option value="month">이번 달</option>
              </select>
              <select className="ch-st-sel" value={stCh} onChange={(e) => setStCh(e.target.value)} aria-label="채널">
                <option value="">채널 전체</option>
                {CHANNELS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
              <span className="inv-hint">숫자를 누르면 그 조건으로 해당 갈래가 열립니다 · 금액은 <b>주문 금액</b>(수수료 정산 전) · 취소·반품은 채널 API 연동 후 반영</span>
            </QueryBar>
          )}
          {tab === "import" && grid.head}
          {tab === "ship" && ship.head}

          {tab === "codes" && (
            <>
              <QueryBar right={canWrite ? (<>
                <button type="button" className="btn-secondary btn-sm" onClick={() => setBulkOpen(true)}>엑셀 붙여넣기</button>
                <button type="button" className="btn-primary btn-sm" onClick={() => setAddOpen(true)}>+ 상품 연결</button>
              </>) : undefined}>
                <SimpleCond groups={[{ key: "channel", label: "채널", hint: "비우면 전체", options: chChips.map((c) => ({ value: c.value, label: c.label })) }]} live={cond} onApply={setCond} />
                <QuickSearch value={q} onApply={setQ} placeholder="채널 상품코드 · 상품명 · SKU — 쉼표로 여러 개, Enter" />
              </QueryBar>
              <SimpleApplied groups={[{ key: "channel", label: "채널", options: chChips.map((c) => ({ value: c.value, label: c.label })) }]} live={cond} onApply={setCond} />
              <ResultStrip>
                <Stat label="연결" value={`${won(shownCodes.length)}개`} />
                <Stat label="전체 채널" value={`${won(counts.allCodes)}개`} />
              </ResultStrip>
            </>
          )}

          {tab === "history" && (
            <>
              <QueryBar right={
                <button type="button" className="btn-secondary btn-sm" disabled={!shownImports.length}
                  onClick={() => exportToExcel(sortedImports.map((i) => ({
                    "채널": channelLabel(i.channel), "주문번호": i.channel_order_no, "주문일": i.order_date || "", "주문자": i.buyer_name || "",
                    "수취인": i.recipient_name || "", "연락처": i.recipient_phone || "", "주소": i.address || "", "배송 요청": i.shipping_note || "",
                    "금액": i.amount ?? "", "출고 상태": SHIP_STATUS_LABEL[i.ship_status], "택배사": i.carrier || "", "송장번호": i.tracking_no || "",
                    "등록 시각": i.imported_at.slice(0, 16).replace("T", " "),
                  })), "가져오기 이력", `채널주문_${channelLabel(channel)}_${todayKst()}`)}>엑셀</button>
              }>
                <SimpleCond groups={[{ key: "channel", label: "채널", hint: "비우면 전체", options: chChips.map((c) => ({ value: c.value, label: c.label })) }]} live={cond} onApply={setCond} />
                <QuickSearch value={q} onApply={setQ} placeholder="주문번호 · 주문자 · 수취인 · 연락처 · 주소 — 쉼표로 여러 개, Enter" />
                <span className="inv-hint">등록된 주문번호는 <b>다시 가져와도 건너뜁니다</b> (재고 중복 차감 방지).</span>
              </QueryBar>
              <SimpleApplied groups={[{ key: "channel", label: "채널", options: chChips.map((c) => ({ value: c.value, label: c.label })) }]} live={cond} onApply={setCond} />
              <ResultStrip>
                <Stat label="등록 주문" value={`${won(shownImports.length)}건`} />
                <Stat label="금액" value={`₩${won(shownImports.reduce((n, i) => n + Number(i.amount || 0), 0))}`} />
              </ResultStrip>
            </>
          )}
        </QueryHead>

        <QueryBody>
          <div className="inv-scroll">
            {tab === "status" && (
              imports.length === 0 ? (
                <div className="collect-empty">
                  아직 채널 주문이 없습니다.<br />
                  <b>주문 가져오기</b>에서 판매채널 주문 엑셀을 붙여넣거나, 회사설정 › 연동·API 키에 스마트스토어·쿠팡 키를 등록하면 여기 현황이 채워집니다.
                </div>
              ) : (
              <div className="p-3">
                <div className="pjv3-strow">
                  <button type="button" className="pjv3-stcard" onClick={() => goList(stCh || undefined)}>
                    <span className="k">기간 주문</span><b className="v num">{won(stData.total)}건</b>
                    <span className="text-[10px] text-[var(--text-dim)]">어제 {stData.yestN} · 오늘 {stData.todayN}</span></button>
                  <button type="button" className="pjv3-stcard" title="주문 금액 합 — 채널 수수료 정산 전" onClick={() => goList(stCh || undefined)}>
                    <span className="k">주문 금액</span><b className="v num">{won(stData.amount)}</b>
                    <span className="text-[10px] text-[var(--text-dim)]">{stData.total ? `평균 ${won(stData.amount / stData.total)}원/건` : "—"}</span></button>
                  <button type="button" className={`pjv3-stcard ${stData.pending > 0 ? "warn" : ""}`}
                    onClick={() => { ship.setView("pending"); setTab("ship"); }}>
                    <span className="k">출고 대기</span><b className="v num">{won(stData.pending)}건</b>
                    <span className="text-[10px] text-[var(--text-dim)]">{stData.pendingOld > 0 ? <>2일+ 경과 <b className="text-[var(--danger)]">{stData.pendingOld}건</b></> : "밀린 것 없음"}</span></button>
                  <button type="button" className="pjv3-stcard good" onClick={() => { ship.setView("done"); setTab("ship"); }}>
                    <span className="k">배송 완료율</span><b className="v num">{stData.total ? Math.round(stData.done / stData.total * 100) : 0}%</b>
                    <span className="text-[10px] text-[var(--text-dim)]">기간 내 {won(stData.done)}/{won(stData.total)}</span></button>
                  <button type="button" className={`pjv3-stcard ${counts.allCodes === 0 ? "warn" : ""}`} onClick={() => setTab("codes")}>
                    <span className="k">상품 연결</span><b className="v num">{won(counts.allCodes)}종</b>
                    <span className="text-[10px] text-[var(--text-dim)]">{counts.allCodes === 0 ? "연결해야 이익 계산에 잡힙니다" : "채널 상품코드 ↔ SKU"}</span></button>
                </div>
                <div className="ch-st-grid">
                  <div className="pjv3-stpanel">
                    <h3>채널별 <small>막대 = 주문 금액 비중 — 줄을 누르면 그 채널 주문만</small></h3>
                    <div className="stg-table-wrap"><table className="ev-table ev-lined">
                      <thead><tr><th className="text-left">채널</th><th>주문</th><th>금액</th><th>평균</th><th>출고 대기</th><th>완료율</th></tr></thead>
                      <tbody>
                        {stData.byChannel.map((r) => {
                          const max = Math.max(1, ...stData.byChannel.map((x) => x.amount));
                          return (
                            <tr key={r.ch} className="cursor-pointer" onClick={() => goList(r.ch)}>
                              <td className="text-left"><span className="ch-st-mini" style={{ width: `${Math.max(8, r.amount / max * 70)}px` }} />{r.label}</td>
                              <td className="tr mono-number">{won(r.n)}</td>
                              <td className="tr mono-number">{won(r.amount)}</td>
                              <td className="tr mono-number">{r.n ? won(r.amount / r.n) : "—"}</td>
                              <td className={`tc mono-number ${r.pending > 0 ? "font-bold text-[var(--danger)]" : ""}`}>{r.pending || "—"}</td>
                              <td className="tc mono-number">{r.n ? Math.round(r.done / r.n * 100) : 0}%</td>
                            </tr>
                          );
                        })}
                        <tr className="font-bold"><td className="text-left">합계</td>
                          <td className="tr mono-number">{won(stData.total)}</td><td className="tr mono-number">{won(stData.amount)}</td>
                          <td className="tr mono-number">{stData.total ? won(stData.amount / stData.total) : "—"}</td>
                          <td className="tc mono-number">{stData.pending || "—"}</td>
                          <td className="tc mono-number">{stData.total ? Math.round(stData.done / stData.total * 100) : 0}%</td></tr>
                      </tbody>
                    </table></div>
                  </div>
                  <div className="pjv3-stpanel">
                    <h3>일별 주문 <small>최근 14일 — 주문일 기준</small></h3>
                    <div className="ch-st-flow">
                      {stData.days.map((d) => {
                        const max = Math.max(1, ...stData.days.map((x) => x.n));
                        return (
                          <div key={d.d} className="fcol">
                            <span className="cnt num">{d.n || ""}</span>
                            <div className="b" style={{ height: `${4 + d.n / max * 52}px`, opacity: d.n ? 0.85 : 0.25 }} />
                            <span className="wk num">{d.label}</span>
                          </div>
                        );
                      })}
                    </div>
                    <h3 className="!mt-4">배송 흐름 <small>기간 내 — 칸을 누르면 출고 처리로</small></h3>
                    <div className="pjv3-stmoney">
                      <button type="button" className={`mstep ${stData.pending > 0 ? "ch-st-warn" : ""}`}
                        onClick={() => { ship.setView("pending"); setTab("ship"); }}>
                        <span className="t">출고 대기</span><b className="n num">{won(stData.pending)}</b></button>
                      <span className="ar">→</span>
                      <button type="button" className="mstep" onClick={() => { ship.setView("shipped"); setTab("ship"); }}>
                        <span className="t">발송됨</span><b className="n num">{won(stData.shipped)}</b></button>
                      <span className="ar">→</span>
                      <button type="button" className="mstep hot" onClick={() => { ship.setView("done"); setTab("ship"); }}>
                        <span className="t">배송 완료</span><b className="n num">{won(stData.done)}</b></button>
                    </div>
                  </div>
                </div>
                <div className="pjv3-stpanel !mt-3">
                  <h3>수집 상태 <small>채널별 마지막으로 주문이 들어온 시각 — 오래 끊기면 빨간불</small></h3>
                  {stData.sync.map((s) => (
                    <div key={s.ch} className="ch-st-sync">
                      <b className="w-24">{s.label}</b>
                      <span className={`text-[11px] ${s.ageDays >= 3 ? "font-bold text-[var(--danger)]" : "text-[var(--text-dim)]"}`}>
                        마지막 등록 {s.at.slice(5, 16).replace("T", " ")}{s.ageDays >= 3 ? ` — ${s.ageDays}일 전` : ""}{s.api ? " · API 연동 가능 채널" : ""}
                      </span>
                      {/* API 채널은 가져오기 갈래로 오면서 API 팝업이 바로 열린다 — 클릭 한 번 절약 */}
                      {s.api ? (
                        <button type="button" className="btn-secondary btn-sm ml-auto" title="가져오기 갈래에서 API 수집 창이 바로 열립니다"
                          onClick={() => { setTab("import"); grid.openApiFetch(); }}>지금 수집</button>
                      ) : (
                        <button type="button" className="btn-secondary btn-sm ml-auto" onClick={() => setTab("import")}>가져오기로</button>
                      )}
                    </div>
                  ))}
                  {stData.sync.length === 0 && <div className="collect-empty">아직 등록된 채널이 없습니다</div>}
                </div>
              </div>
              )
            )}
            {tab === "import" && <div className="doc-editor">{grid.body}</div>}
            {tab === "ship" && ship.body}

            {tab === "codes" && (
              shownCodes.length === 0 ? (
                <div className="collect-empty">
                  연결된 상품이 없습니다. <b>+ 상품 연결</b>에서
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
                                    if (!(await appConfirm(`${c.channel_product_id} 연결을 해제할까요? 이미 등록된 주문은 유지됩니다.`, { danger: true, confirmLabel: "해제" }))) return;
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
                  등록한 주문이 없습니다. <b>주문 가져오기</b>에서 엑셀을 붙여 넣어 등록하세요.
                </div>
              ) : (
                <div className="stg-table-wrap">
                  <table className="ev-table ev-lined table-inv-ch-imports">
                    <thead><tr>
                      <SortableTh label="주문번호" sortKey="no" sort={iSort} onSort={onISort} />
                      <SortableTh label="주문일" sortKey="date" sort={iSort} onSort={onISort} />
                      <SortableTh label="주문자" sortKey="buyer" sort={iSort} onSort={onISort} />
                      <th>수취인</th><th>연락처</th><th>주소</th><th>배송 요청</th>
                      <SortableTh label="금액" sortKey="amount" sort={iSort} onSort={onISort} />
                      <SortableTh label="등록 시각" sortKey="at" sort={iSort} onSort={onISort} />
                    </tr></thead>
                    <tbody>
                      {importPager.view.map((i) => (
                        <tr key={i.id}>
                          <td className="mono-number text-left"><b>{i.channel_order_no}</b></td>
                          <td className="mono-number">{i.order_date || "—"}</td>
                          <td className="text-left">{i.buyer_name || "—"}</td>
                          <td className="text-left">{i.recipient_name || "—"}</td>
                          <td className="mono-number text-left">{i.recipient_phone || "—"}</td>
                          <td className="text-left ch-addr" title={i.address || undefined}>{i.address || "—"}</td>
                          <td className="text-left ev-dim">{i.shipping_note || "—"}</td>
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

        {tab === "ship" && ship.pagerEl}
        {tab === "codes" && shownCodes.length > 0 && (
          <Pager page={codePager.page} pages={codePager.pages} total={shownCodes.length} size={50}
            from={codePager.from} to={codePager.to} onPage={codePager.setPage} />
        )}
        {tab === "history" && shownImports.length > 0 && (
          <Pager page={importPager.page} pages={importPager.pages} total={shownImports.length} size={50}
            from={importPager.from} to={importPager.to} onPage={importPager.setPage} />
        )}
      </QueryScreen>

      {tab === "ship" && ship.selbar}
      {grid.dialogs}
      {ship.dialogs}
      {bulkOpen && companyId && (
        <BulkCodeDialog companyId={companyId} channel={channel} products={products} existing={codes}
          onClose={() => setBulkOpen(false)}
          onSaved={(n) => { setBulkOpen(false); qc.invalidateQueries({ queryKey: ["ch-codes", companyId] }); toast(`${n}건을 연결했습니다`, "success"); }} />
      )}
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
//   "각각 불러오는 것보다 한번에 가져와서 채널별로 정렬해서 보여주면. 좌측에 채널을 기입해서."
//   ★ 채널은 머리가 아니라 **줄 맨 왼쪽 칸**이다 — 여러 채널 주문이 한 격자에 섞여 서고, 채널순으로 정렬된다.
//   ★ 붙여넣기도 API 도 격자를 **채우기만** 한다. 출고 등록은 사람이 누른다(제안은 자동, 확정은 사람).
//   ★ 채널 상품코드를 치면 그 채널의 상품 연결(결정 19)로 품목이 저절로 온다. 없으면 줄이 표시되고 저장이 막힌다.
//     주문번호가 그 채널에 이미 등록된 줄은 줄 그어 두고 저장 때 건너뛴다.
//   ★ 저장은 채널마다 출고 전표 한 건 — 주문번호 기록(channel_order_imports)이 채널 단위라서다.
const CH_ORDER = new Map<string, number>(CHANNELS.map((c, i) => [c.value, i]));
const sortByChannel = (rows: DocRow[]) =>
  [...rows].sort((a, b) => (CH_ORDER.get(a.ch) ?? 99) - (CH_ORDER.get(b.ch) ?? 99) || a.ono.localeCompare(b.ono));

function useImportGrid({ ctl, products, warehouses, codes, canWrite, onDone, goCodes }: {
  ctl: DocCtl; products: Product[]; warehouses: Warehouse[]; codes: ChannelCode[];
  canWrite: boolean; onDone: () => void; goCodes: () => void;
}) {
  const { toast } = ctl;
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  //   조회 줄 버튼 정리(기획 §4) — '채널에서 가져오기'·'엑셀 붙여넣기' 두 버튼 → **주문 가져오기 하나**, 팝업 안 갈래 탭. 결정 18(붙여넣기가 1등 시민) — 기본 갈래는 붙여넣기.
  const [importOpen, setImportOpen] = useState<"paste" | "api" | null>(null);

  //   채널|상품코드 → 품목
  const codeMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of codes) if (c.is_active) m.set(`${c.channel}|${c.channel_product_id.trim().toUpperCase()}`, c.product_id);
    return m;
  }, [codes]);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  //   A9 (2026-08-27 규칙형 자동화) — 상품 연결이 없어도 채널 상품명 = 품목명, 또는 채널 상품코드 = SKU/바코드면 **제안**으로 채운다.
  //     유일하게 맞을 때만. 줄은 노랗게(suggest) 표시되고 저장하면 상품 연결로 학습된다(사람이 저장 = 확정, 결정 91).
  const norm = (s: string) => s.toLowerCase().replace(/[\s\-_()\[\]/·,.]/g, "");
  const suggestIdx = useMemo(() => {
    const byName = new Map<string, Product[]>(); const byCode = new Map<string, Product[]>();
    for (const p of products) {
      if (!p.is_active) continue;
      const n = norm(p.name); if (n) byName.set(n, [...(byName.get(n) || []), p]);
      for (const c of [p.sku, p.barcode]) { const k = (c || "").trim().toUpperCase(); if (k) byCode.set(k, [...(byCode.get(k) || []), p]); }
    }
    return { byName, byCode };
  }, [products]);
  const suggestFor = (code: string, name?: string | null): Product | undefined => {
    const c = suggestIdx.byCode.get(code.trim().toUpperCase());
    if (c?.length === 1) return c[0];
    const n = name ? suggestIdx.byName.get(norm(name)) : undefined;
    return n?.length === 1 ? n[0] : undefined;
  };

  //   ★ 채널 상품코드 → 품목 자동 채움. 코드가 있는데 품목이 없으면 nocode 표시, 품목이 오면 표시를 지운다.
  useEffect(() => {
    ctl.setRows((rows) => {
      let changed = false;
      const next = rows.map((r) => {
        const code = r.ccode.trim().toUpperCase();
        if (!code) { if (r.flag === "nocode") { changed = true; return { ...r, flag: null }; } return r; }
        if (r.product_id) { if (r.flag === "nocode") { changed = true; return { ...r, flag: null }; } return r; }
        if (!r.ch) { if (r.flag !== "nocode") { changed = true; return { ...r, flag: "nocode" as const }; } return r; }
        const pid = codeMap.get(`${r.ch}|${code}`);
        const p = pid ? byId.get(pid) : undefined;
        if (p) { const n = { ...r, custom: { ...r.custom }, flag: null as DocRow["flag"] }; ctl.fillFrom(n, p); changed = true; return n; }
        if (r.flag !== "nocode") { changed = true; return { ...r, flag: "nocode" as const }; }
        return r;
      });
      return changed ? next : rows;
    });
  }, [ctl.rows, codeMap, byId]);   // eslint-disable-line react-hooks/exhaustive-deps

  //   주문번호가 그 채널에 이미 등록됐는지 — 줄이 바뀔 때 물어본다(그 주문번호만).
  const nos = ctl.rows.map((r) => (r.ono.trim() && r.ch ? `${r.ch}|${r.ono.trim()}` : "")).filter(Boolean).join("\n");
  useEffect(() => {
    if (!ctl.companyId || !nos) return;
    let alive = true;
    const byCh = new Map<string, string[]>();
    for (const k of nos.split("\n")) { const [ch, no] = k.split("|"); byCh.set(ch, [...(byCh.get(ch) || []), no]); }
    Promise.all([...byCh.entries()].map(async ([ch, list]) => [ch, await listSeenOrderNos(ctl.companyId!, ch, list)] as const)).then((res) => {
      if (!alive) return;
      const seen = new Map(res);
      ctl.setRows((rows) => {
        let changed = false;
        const next = rows.map((r) => {
          const dup = !!r.ono.trim() && !!r.ch && !!seen.get(r.ch)?.has(r.ono.trim());
          if (dup && r.flag !== "dup" && r.flag !== "nocode") { changed = true; return { ...r, flag: "dup" as const }; }
          if (!dup && r.flag === "dup") { changed = true; return { ...r, flag: null }; }
          return r;
        });
        return changed ? next : rows;
      });
    }).catch(() => {});
    return () => { alive = false; };
  }, [nos, ctl.companyId]);   // eslint-disable-line react-hooks/exhaustive-deps

  const counts = useMemo(() => ({
    nocode: ctl.live.filter((r) => r.flag === "nocode").length,
    suggest: ctl.live.filter((r) => r.flag === "suggest" && r.product_id).length,
    dup: ctl.live.filter((r) => r.flag === "dup").length,
    noCh: ctl.live.filter((r) => !r.ch).length,
    channels: new Set(ctl.live.map((r) => r.ch).filter(Boolean)).size,
  }), [ctl.live]);

  /** 붙여넣기·API 가 준 줄을 격자에 깐다 — 이미 친 줄은 남기고, 전체를 채널순으로 정렬한다. */
  //   ★ 가져올 항목 = 입력 항목(회사 양식). 꺼 둔 칸은 채우지 않는다 — 회사마다 필요한 정보가 다르고, 다 깔면 오른쪽으로 끝없이 길어진다.
  const onIds = useMemo(() => new Set(ctl.onLine.map((f) => f.field_id)), [ctl.onLine]);
  const fieldPick = useMemo(() => ({
    on: ctl.layout.line.filter((f) => f.on).map((f) => f.name),
    off: ctl.layout.line.filter((f) => !f.on).map((f) => f.name),
  }), [ctl.layout]);
  const putRows = (raw: (RawOrderRow & { channel: string; product_name?: string | null })[]) => {
    ctl.setRows((s) => {
      const keep = s.filter((r) => r.product_id || r.sku.trim() || r.ono.trim() || r.ccode.trim());
      const add = raw.map((x) => {
        const r = blankRow();
        r.ch = x.channel; r.ono = x.channel_order_no; r.ccode = x.channel_product_id;
        if (onIds.has("buyer")) r.buyer = x.buyer_name || "";
        if (onIds.has("rcv")) r.rcv = x.recipient_name || "";
        if (onIds.has("tel")) r.tel = x.recipient_phone || "";
        if (onIds.has("addr")) r.addr = x.address || "";
        if (onIds.has("memo")) r.memo = x.shipping_note || "";
        if (onIds.has("zip")) r.zip = x.recipient_zip || "";
        r.qty = String(x.qty);
        const pid = codeMap.get(`${x.channel}|${x.channel_product_id.trim().toUpperCase()}`);
        const p = pid ? byId.get(pid) : undefined;
        if (p) ctl.fillFrom(r, p);
        if (x.unit_price != null) {
          r.price = String(x.unit_price);
          const sup = Number(x.unit_price) * Number(x.qty);
          r.supply = String(sup); r.vat = String(Math.round(sup * 0.1));
        }
        if (!p) {
          const sg = suggestFor(x.channel_product_id, x.product_name);
          if (sg) { ctl.fillFrom(r, sg); r.flag = "suggest"; r.lnote = x.product_name ? `연결 제안 · ${x.product_name}` : "연결 제안 (SKU 일치)"; }
          else { r.flag = "nocode"; if (x.product_name) r.lnote = x.product_name; }
        }
        return r;
      });
      return [...sortByChannel([...keep, ...add]), blankRow()];
    });
  };

  const save = async () => {
    const built = ctl.build();
    const wh = built.head.wh;
    if (!ctl.live.length) { toast("입력된 항목이 없습니다", "error"); return; }
    if (!wh) { toast("출고 창고를 선택하세요", "error"); return; }
    //   ★ 채널은 붙여넣기·가져오기만 정한다 — 손으로 친 줄은 채널이 없어 등록할 수 없다(어느 채널 주문인지 모른다)
    if (counts.noCh) { toast(`채널이 없는 줄 ${counts.noCh} — 채널은 엑셀 붙여넣기·채널에서 가져오기로만 정해집니다`, "error"); return; }
    if (counts.nocode) { toast(`미연결 상품코드 ${counts.nocode}줄 — 품목을 고르거나 상품 연결에서 등록하세요`, "error"); return; }
    const lines = built.lines.filter((l) => l.flag !== "dup");
    if (lines.some((l) => !l.product_id || !(l.qty > 0) || !l.ono)) { toast("주문번호·품목·수량을 확인하세요", "error"); return; }
    if (!lines.length) { toast("모두 이미 등록된 주문번호입니다", "error"); return; }
    //   채널별로 한 전표씩
    const groups = new Map<string, typeof lines>();
    for (const l of lines) { groups.set(l.ch, [...(groups.get(l.ch) || []), l]); }
    const msg = `${lines.length}줄을 출고(판매)로 등록합니다 — ${[...groups.entries()].map(([ch, ls]) => `${channelLabel(ch)} ${ls.length}줄`).join(" · ")}.`
      + `${counts.dup ? ` 이미 등록된 ${counts.dup}줄은 건너뜁니다.` : ""}`
      + `${counts.suggest ? ` 연결 제안 ${counts.suggest}줄은 상품 연결에 기억됩니다(다음부터 자동).` : ""} 진행할까요?`;
    if (!(await appConfirm(msg, { confirmLabel: "진행" }))) return;
    setBusy(true);
    try {
      //   A9 — 제안대로(또는 사람이 고친 대로) 저장하는 줄은 상품 연결로 학습한다. 같은 채널·코드는 한 번만.
      const learned = new Set<string>();
      for (const l of lines) {
        if (l.flag !== "suggest" || !l.product_id || !l.ccode || !l.ch) continue;
        const k = `${l.ch}|${l.ccode.trim().toUpperCase()}`; if (learned.has(k)) continue; learned.add(k);
        await upsertChannelCode(ctl.companyId!, { product_id: l.product_id, channel: l.ch, channel_product_id: l.ccode.trim(), channel_product_name: null });
      }
      if (learned.size) qc.invalidateQueries({ queryKey: ["ch-codes", ctl.companyId] });
      const done: string[] = [];
      for (const [ch, ls] of groups) {
        const r = await importChannelDoc(ctl.companyId!, ch, wh, built.date, built.head.note || null,
          ls.map((l) => ({
            product_id: l.product_id, qty: l.qty, unit_price: l.unit_price, vat_amount: l.vat_amount,
            channel_order_no: l.ono, channel_product_id: l.ccode, buyer_name: l.buyer || null,
            recipient_name: l.rcv || null, recipient_phone: l.tel || null, address: l.addr || null, shipping_note: l.memo || null, recipient_zip: l.zip || null,
          })), ctl.userId);
        done.push(`${channelLabel(ch)} ${r.docNo} · 주문 ${r.orders}건${r.skipped ? ` · ${r.skipped}줄 건너뜀` : ""}`);
      }
      toast(done.join(" / "), "success");
      ctl.reset(); onDone();
    } catch (e) { toast(friendlyError(e, "등록하지 못했습니다"), "error"); }
    finally { setBusy(false); }
  };

  const head = (
    <>
      <QueryBar right={canWrite ? (
        <>
          <button type="button" className="btn-secondary btn-sm" onClick={() => setImportOpen("paste")}>주문 가져오기</button>
          {/*   ★ 2026-08-27 — 보조 동작은 '도구 ▾' 하나로(조회 줄 버튼 정리) */}
          <HelperMenu label="도구" items={[
            { label: "채널순 정렬", source: "입력", hint: "줄을 채널별로 모아 전표가 채널마다 하나가 되게", disabled: ctl.live.length < 2, onClick: () => ctl.setRows((s) => [...sortByChannel(s.filter((r) => r.product_id || r.sku.trim() || r.ono.trim() || r.ccode.trim())), blankRow()]) },
            { label: "입력 항목", source: "양식", hint: "격자에 어떤 칸을 둘지", onClick: ctl.openForm },
          ]} />
          <button type="button" className="btn-primary btn-sm" disabled={busy} onClick={save}>출고 등록</button>
        </>
      ) : undefined}>
        <span className="inv-hint doc-note-move">저장하면 <b>재고가 즉시 차감</b>되고 주문번호가 기록됩니다 — 채널마다 전표 한 건, 같은 주문번호는 중복 등록되지 않습니다.</span>
      </QueryBar>
      <ResultStrip>
        <Stat label="줄" value={`${won(ctl.sums.lines)}개`} />
        {counts.channels > 1 && <Stat label="채널" value={`${counts.channels}개`} />}
        {counts.noCh > 0 && <Stat label="채널 없음" value={`${counts.noCh}줄`} tone="minus" />}
        {counts.nocode > 0 && <Stat label="미연결" value={`${counts.nocode}줄`} tone="minus" />}
        {counts.suggest > 0 && <Stat label="연결 제안" value={`${counts.suggest}줄`} />}
        {counts.dup > 0 && <Stat label="기존 등록" value={`${counts.dup}줄`} />}
        <Stat label="공급가액" value={`₩${won(ctl.sums.supply)}`} />
        <Stat label="합계" value={`₩${won(ctl.sums.total)}`} />
        <span className="spv-toolbar-hint">
          가져온 줄의 채널 값(주문번호·수량·금액·배송 정보)은 <b>고칠 수 없습니다</b> · 연결된 품목은 자동, 미연결이면 품목만 고릅니다
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
      {importOpen && (() => {
        const tabs = (
          <div className="collect-tabs ch-import-tabs">
            {([["paste", "엑셀 붙여넣기"], ["api", "채널 API"]] as const).map(([k, l]) => (
              <button key={k} type="button" className={importOpen === k ? "collect-tab collect-tab-on" : "collect-tab"} onClick={() => setImportOpen(k)}>{l}</button>
            ))}
          </div>
        );
        const done = (rows: (RawOrderRow & { channel: string })[]) => { putRows(rows); setImportOpen(null); };
        return importOpen === "paste"
          ? <PasteDialog tabs={tabs} pick={fieldPick} openForm={ctl.openForm} onClose={() => setImportOpen(null)} onRows={done} />
          : <FetchDialog tabs={tabs} pick={fieldPick} openForm={ctl.openForm} onClose={() => setImportOpen(null)} onRows={done} />;
      })()}
    </>
  );
  //   openApiFetch — 현황 갈래의 [지금 수집]이 가져오기 갈래로 오면서 API 팝업을 바로 연다(결정 148 후속)
  return { head, body, dialogs, openApiFetch: () => setImportOpen("api") };
}

type FieldPick = { on: string[]; off: string[] };
/** 가져올 항목 안내 — 회사 양식(입력 항목)이 곧 선택기다 */
function FieldPickLine({ pick, openForm }: { pick: FieldPick; openForm: () => void }) {
  return (
    <p className="inv-foot ch-pick">
      <b>가져올 항목</b> {pick.on.join(" · ")}
      {pick.off.length > 0 && <> <span className="ev-dim">· 안 가져옴: {pick.off.join(" · ")}</span></>}
      <button type="button" className="bz-link ch-link" onClick={openForm}>입력 항목에서 바꾸기</button>
    </p>
  );
}

// ── 엑셀 붙여넣기 — 채널을 고르고 격자에 깐다 ──────────────────────────────
function PasteDialog({ tabs, pick, openForm, onClose, onRows }: { tabs?: React.ReactNode; pick: FieldPick; openForm: () => void; onClose: () => void; onRows: (r: (RawOrderRow & { channel: string })[]) => void }) {
  const [channel, setChannel] = useState<ChannelValue>(CHANNELS[0].value);
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
        recipient_name: p[6] || null, recipient_phone: p[7] || null, address: p[8] || null, shipping_note: p[9] || null, recipient_zip: p[10] || null,
      });
    }
    return { out, bad };
  }, [text]);
  return (
    <div className="inv-modal" onClick={onClose}>
      <div className="inv-modal-box inv-modal-wide" onClick={(e) => e.stopPropagation()}>
        {tabs}
        <h3 className="inv-modal-title">주문 엑셀 붙여넣기</h3>
        <p className="inv-modal-desc">
          열 순서: <b>주문번호 · 채널 상품코드 · 수량</b> · 단가 · 주문일 · 주문자 · <b>수취인 · 연락처 · 주소 · 배송 요청 · 우편번호</b>
          (4열부터는 선택 — 비우려면 빈 칸으로 두세요). 엑셀에서 해당 열을 복사해 붙여 넣으세요. 격자에 채워지기만 하고, 출고 등록은 따로 누릅니다.
        </p>
        <FieldPickLine pick={pick} openForm={openForm} />
        <label className="inv-field"><span>채널 *</span>
          <select className="field-input" value={channel} onChange={(e) => setChannel(e.target.value as ChannelValue)}>
            {CHANNELS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select></label>
        <label className="inv-field"><span>주문 목록</span>
          <ExcelPasteHelper templateName="채널주문_양식" sheetName="채널 주문" onText={setText}
            cols={[
              { key: "ono", label: "주문번호", required: true, example: "2026082700001" }, { key: "code", label: "채널 상품코드", required: true, hint: "상품 연결에 등록된 코드면 품목이 자동으로", example: "SS-1001" },
              { key: "qty", label: "수량", required: true, kind: "number", example: 1 }, { key: "price", label: "단가", kind: "number", example: 25000 }, { key: "date", label: "주문일", kind: "date", example: "2026-08-27" },
              { key: "buyer", label: "주문자", example: "홍길동" }, { key: "rcv", label: "수취인", example: "홍길동" }, { key: "tel", label: "연락처", example: "010-0000-0000" }, { key: "addr", label: "주소", example: "서울시 …" }, { key: "memo", label: "배송 요청", example: "" }, { key: "zip", label: "우편번호", example: "04524" },
            ]} />
          <textarea className="field-input inv-paste ch-paste" rows={10} value={text} onChange={(e) => setText(e.target.value)} autoFocus
            placeholder={"주문번호\t채널상품코드\t수량\t단가\t주문일\t주문자\t수취인\t연락처\t주소\t배송요청\n2026082512345\tSS-1001\t2\t19000\t2026-08-25\t홍길동\t홍길동\t010-1234-5678\t서울 강남구 …\t부재 시 문 앞"} /></label>
        <p className="inv-foot">
          <b>{parsed.out.length}줄 인식</b>
          {parsed.bad.length > 0 && <span className="inv-paste-bad"> · 인식 실패 {parsed.bad.length}줄: {parsed.bad.slice(0, 2).join(" / ")}{parsed.bad.length > 2 ? " …" : ""}</span>}
        </p>
        <div className="inv-modal-actions">
          <button type="button" className="btn-secondary btn-sm" onClick={onClose}>취소</button>
          <button type="button" className="btn-primary btn-sm" disabled={!parsed.out.length}
            onClick={() => onRows(parsed.out.map((r) => ({ ...r, channel })))}>격자에 채우기</button>
        </div>
      </div>
    </div>
  );
}

// ── 채널 API 에서 한 번에 가져오기 — 키가 등록된 채널을 모두 부른다 ──────────
function FetchDialog({ tabs, pick, openForm, onClose, onRows }: { tabs?: React.ReactNode; pick: FieldPick; openForm: () => void; onClose: () => void; onRows: (r: (RawOrderRow & { channel: string })[]) => void }) {
  const [from, setFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().slice(0, 10); });
  const [to, setTo] = useState(todayKst);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<{ ch: string; text: string; noKey?: boolean; ok: boolean }[] | null>(null);
  const apiChannels = CHANNELS.filter((c) => CHANNEL_HAS_API.has(c.value));
  return (
    <div className="inv-modal" onClick={onClose}>
      <div className="inv-modal-box" onClick={(e) => e.stopPropagation()}>
        {tabs}
        <h3 className="inv-modal-title">채널에서 주문 가져오기</h3>
        <p className="inv-modal-desc">
          설정에 API 키가 등록된 채널({apiChannels.map((c) => c.label).join(" · ")})의 결제 완료 주문을 <b>한 번에</b> 받아
          채널순으로 격자에 채웁니다. 재고에는 아직 반영되지 않습니다 — 확인 후 <b>출고 등록</b>을 누르세요.
          나머지 채널은 엑셀 붙여넣기를 이용합니다.
        </p>
        <FieldPickLine pick={pick} openForm={openForm} />
        <div className="inv-field">
          <DateRangeField label="주문 기간" from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} /></div>
        {report && (
          <ul className="inv-foot ch-fetch-report">
            {report.map((r) => (
              <li key={r.ch} className={r.ok ? undefined : "ch-fetch-bad"}>
                <b>{channelLabel(r.ch)}</b> — {r.text}
                {r.noKey && <> <Link href="/settings/integration?tab=api-keys" className="bz-link ch-link">연동·API 키로 이동</Link></>}
              </li>
            ))}
          </ul>
        )}
        <div className="inv-modal-actions">
          <button type="button" className="btn-secondary btn-sm" onClick={onClose}>취소</button>
          <button type="button" className="btn-primary btn-sm" disabled={busy}
            onClick={async () => {
              setBusy(true); setReport(null);
              try {
                const res = await Promise.all(apiChannels.map(async (c) => ({ ch: c.value, r: await fetchChannelOrders(c.value, from, to) })));
                const rows = res.flatMap(({ ch, r }) => (r.ok ? r.rows.map((x) => ({ ...x, channel: ch })) : []));
                const rep = res.map(({ ch, r }) => r.ok
                  ? { ch, ok: true, text: r.rows.length ? `${r.rows.length}줄 받음` : "이 기간에 결제 완료 주문이 없습니다" }
                  : { ch, ok: false, text: r.message, noKey: r.noKey });
                if (rows.length) onRows(rows);
                else setReport(rep);
              } finally { setBusy(false); }
            }}>{busy ? "가져오는 중…" : "가져오기"}</button>
        </div>
      </div>
    </div>
  );
}

// ── 출고 처리 · 송장 (2026-08-26 사장님 지시 ②) ─────────────────────────────────
//   "이커머스는 출고 처리를 해야 한다 — 배송 요청사항·주문자 정보(연락처·주소)를 가져와야 의미가 있다."
//   ★ 기준 — 출고 등록(재고 차감)과 **발송(송장)** 은 다른 일이다. 재고는 등록 순간 빠지고, 여기서는 '실제로 보냈나'만 다룬다.
//     상태는 출고 대기 → 발송(송장 있음) → 배송 완료. 되돌리기는 발송 취소(송장 지움·대기로).
//   ★ 송장 파일은 택배사 공통 열(주문번호·수취인·연락처·주소·상품·수량·배송 메시지)로 낸다 —
//     CJ·한진 등 회사별 양식은 회사가 쓰는 택배사가 정해지면 그 열 순서로 맞춘다(지금은 '기타' 양식 하나).
//   ★ 송장번호 붙여넣기 = 택배사 프로그램이 돌려준 "주문번호 ⇥ 송장번호" 를 그대로 붙이면 줄이 맞춰진다.
//   ★ 채널로 발송 통보(역동기화)는 API 키 이후 — 지금은 이 화면이 사실을 갖고 있고, 채널엔 사람이 올린다.
const SHIP_VIEWS = [["pending", "출고 대기"], ["shipped", "발송됨"], ["done", "배송 완료"], ["all", "전체"]] as const;
type ShipView = (typeof SHIP_VIEWS)[number][0];

function useShipPanel({ companyId, userId, imports, products, canWrite, onDone }: {
  companyId: string | null; userId: string | null; imports: OrderImport[]; products: Product[]; canWrite: boolean; onDone: () => void;
}) {
  const { toast } = useToast();
  const [view, setView] = useState<ShipView>("pending");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [shipOpen, setShipOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sort, setSort] = useState<SortState<"ch" | "no" | "date" | "rcv" | "status" | "at">>({ key: "at", dir: "desc" });

  //   주문별 상품 — 출고 전표 줄의 비고("채널명 주문번호")로 맞춘다
  const docIds = useMemo(() => [...new Set(imports.map((i) => i.doc_id).filter(Boolean) as string[])], [imports]);
  const { data: items = new Map<string, { name: string; qty: number }[]>() } = useQuery({
    queryKey: ["ch-ship-items", companyId, docIds.join(",")],
    queryFn: () => listImportItems(companyId!, docIds, products),
    enabled: !!companyId && docIds.length > 0,
  });
  const itemsOf = (i: OrderImport) => items.get(`${i.channel}|${i.channel_order_no}`) || [];
  const itemText = (i: OrderImport) => itemsOf(i).map((x) => `${x.name} ×${x.qty}`).join(", ");

  const shown = useMemo(() => imports.filter((i) =>
    (view === "all" || i.ship_status === view) &&
    quickSearchHit(q, [i.channel_order_no, channelLabel(i.channel), i.buyer_name, i.recipient_name, i.recipient_phone, i.address, i.tracking_no, itemText(i)])
  ), [imports, view, q, items]);   // eslint-disable-line react-hooks/exhaustive-deps
  const sorted = useMemo(() => {
    const d = sort.dir === "asc" ? 1 : -1;
    const order: Record<string, number> = { pending: 0, shipped: 1, done: 2 };
    const val = (i: OrderImport) => sort.key === "ch" ? channelLabel(i.channel) : sort.key === "no" ? i.channel_order_no
      : sort.key === "date" ? (i.order_date || "") : sort.key === "rcv" ? (i.recipient_name || i.buyer_name || "")
      : sort.key === "status" ? order[i.ship_status] : i.imported_at;
    return [...shown].sort((a, b) => cmp(val(a), val(b)) * d);
  }, [shown, sort]);
  const onSort = (k: string) => setSort((s) => nextSort(s, k as typeof sort.key));
  const pager = usePager(sorted, 50, `${view}|${q}|${sort.key}${sort.dir}`);
  const counts = useMemo(() => ({
    pending: imports.filter((i) => i.ship_status === "pending").length,
    shipped: imports.filter((i) => i.ship_status === "shipped").length,
    done: imports.filter((i) => i.ship_status === "done").length,
  }), [imports]);

  const selected = useMemo(() => imports.filter((i) => sel.has(i.id)), [imports, sel]);
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const pageIds = pager.view.map((i) => i.id);
  const allOn = pageIds.length > 0 && pageIds.every((id) => sel.has(id));
  const toggleAll = () => setSel((s) => { const n = new Set(s); if (allOn) pageIds.forEach((id) => n.delete(id)); else pageIds.forEach((id) => n.add(id)); return n; });

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); toast(label, "success"); setSel(new Set()); onDone(); }
    catch (e) { toast(friendlyError(e), "error"); }
    finally { setBusy(false); }
  };

  /** 송장 파일 — 양식을 골라 내려받는다. 골라 둔 것이 있으면 그것만, 없으면 지금 보이는 줄 전부 */
  const downloadSheet = () => {
    if (!(selected.length ? selected : shown).length) { toast("내려받을 줄이 없습니다", "error"); return; }
    setSheetOpen(true);
  };
  const exportWith = (layout: SheetLayout) => {
    const target = selected.length ? selected : shown;
    const rows = target.map((i) => sheetRow(i, itemsOf(i), layout.columns));
    exportToExcel(rows, "송장", `송장_${layout.name.replace(/[\\/:*?"<>|]/g, "")}_${todayKst()}`);
    setSheetOpen(false);
    toast(`${rows.length}줄을 '${layout.name}' 양식으로 내려받았습니다 — 택배사 프로그램에 올리고, 돌려받은 송장번호를 '송장번호 붙여넣기'로 넣으세요`, "success");
  };

  const head = (
    <>
      <QueryBar right={canWrite ? (
        <button type="button" className="btn-secondary btn-sm" onClick={downloadSheet}>송장 파일 내려받기</button>
      ) : undefined}>
        <ChipGroup value={view} onChange={(v) => { setView(v as ShipView); setSel(new Set()); }}
          options={SHIP_VIEWS.map(([k, l]) => ({ value: k, label: k === "all" ? l : `${l} ${counts[k as keyof typeof counts]}` }))} />
        <QuickSearch value={q} onApply={setQ} placeholder="주문번호 · 수취인 · 연락처 · 주소 · 상품 · 송장번호 — 쉼표로 여러 개, Enter" />
      </QueryBar>
      <ResultStrip>
        <Stat label="출고 대기" value={`${counts.pending}건`} tone={counts.pending ? "minus" : undefined} />
        <Stat label="발송됨" value={`${counts.shipped}건`} />
        <Stat label="배송 완료" value={`${counts.done}건`} />
        <span className="spv-toolbar-hint">줄을 고르면 아래에 <b>발송 처리</b>가 뜹니다 · 재고는 출고 등록 때 이미 차감됐고 여기서는 <b>실제 발송</b>만 기록합니다</span>
      </ResultStrip>
    </>
  );

  const body = imports.length === 0 ? (
    <div className="collect-empty">출고 등록한 채널 주문이 없습니다 — <b>주문 가져오기</b>에서 출고 등록하면 여기에 출고 대기로 쌓입니다.</div>
  ) : shown.length === 0 ? (
    <div className="collect-empty">{SHIP_VIEWS.find(([k]) => k === view)?.[1]} 주문이 없습니다.</div>
  ) : (
    <div className="stg-table-wrap">
      <table className="ev-table ev-lined table-inv-ch-ship">
        <thead><tr>
          <th className="w-8"><input type="checkbox" checked={allOn} onChange={toggleAll} aria-label="이 쪽 전부 선택" /></th>
          <SortableTh label="채널" sortKey="ch" sort={sort} onSort={onSort} />
          <SortableTh label="주문번호" sortKey="no" sort={sort} onSort={onSort} />
          <SortableTh label="주문일" sortKey="date" sort={sort} onSort={onSort} />
          <SortableTh label="수취인" sortKey="rcv" sort={sort} onSort={onSort} />
          <th>연락처</th><th>주소</th><th>상품</th><th>배송 요청</th><th>택배사</th><th>송장번호</th>
          <SortableTh label="상태" sortKey="status" sort={sort} onSort={onSort} />
        </tr></thead>
        <tbody>
          {pager.view.map((i) => (
            <tr key={i.id} className={sel.has(i.id) ? "inv-row-sel" : undefined} onClick={() => toggle(i.id)}>
              <td className="tc" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={sel.has(i.id)} onChange={() => toggle(i.id)} /></td>
              <td className="tc">{channelLabel(i.channel)}</td>
              <td className="mono-number text-left"><b>{i.channel_order_no}</b></td>
              <td className="mono-number">{i.order_date || "—"}</td>
              <td className="text-left">{i.recipient_name || i.buyer_name || "—"}</td>
              <td className="mono-number text-left">{i.recipient_phone || "—"}</td>
              <td className="text-left ch-addr" title={i.address || undefined}>{i.address || "—"}</td>
              <td className="text-left ch-addr" title={itemText(i) || undefined}>{itemText(i) || "—"}</td>
              <td className="text-left ev-dim ch-addr" title={i.shipping_note || undefined}>{i.shipping_note || "—"}</td>
              <td className="tc">{i.carrier ? (CARRIERS.find((c) => c.value === i.carrier)?.label || i.carrier) : "—"}</td>
              <td className="mono-number text-left">{i.tracking_no || "—"}</td>
              <td className="tc"><span className={i.ship_status === "done" ? "inv-pill inv-pill-ok" : i.ship_status === "shipped" ? "inv-pill inv-pill-warn" : "inv-pill inv-pill-danger"}>{SHIP_STATUS_LABEL[i.ship_status]}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const pagerEl = shown.length > 0 ? (
    <Pager page={pager.page} pages={pager.pages} total={shown.length} size={50} from={pager.from} to={pager.to} onPage={pager.setPage} />
  ) : null;

  const selbar = canWrite ? (
    <SelectionBar count={sel.size} onClear={() => setSel(new Set())}
      summary={<>{selected.filter((i) => i.ship_status === "pending").length}건 대기 · {selected.filter((i) => i.ship_status === "shipped").length}건 발송됨</>}>
      <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={downloadSheet}>송장 파일</button>
      <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={() => setPasteOpen(true)}>송장번호 붙여넣기</button>
      {selected.some((i) => i.ship_status === "shipped") && (
        <button type="button" className="btn-secondary btn-sm" disabled={busy}
          onClick={() => run("배송 완료로 기록했습니다", () => updateShipping(selected.filter((i) => i.ship_status === "shipped").map((i) => i.id), { ship_status: "done" }, userId))}>배송 완료</button>
      )}
      {selected.some((i) => i.ship_status !== "pending") && (
        <button type="button" className="btn-secondary btn-sm doc-del" disabled={busy}
          onClick={async () => { if ((await appConfirm("발송을 취소하고 출고 대기로 되돌릴까요? 송장번호가 지워집니다.", { danger: true, confirmLabel: "되돌리기" }))) run("출고 대기로 되돌렸습니다", () => updateShipping(selected.filter((i) => i.ship_status !== "pending").map((i) => i.id), { ship_status: "pending", carrier: null, tracking_no: null }, userId)); }}>발송 취소</button>
      )}
      <button type="button" className="btn-primary btn-sm" disabled={busy || !selected.some((i) => i.ship_status === "pending")} onClick={() => setShipOpen(true)}>발송 처리</button>
    </SelectionBar>
  ) : null;

  const dialogs = (
    <>
      {shipOpen && (
        <ShipDialog rows={selected.filter((i) => i.ship_status === "pending")} itemText={itemText} onClose={() => setShipOpen(false)}
          onSave={(carrier, tracking) => { setShipOpen(false); run("발송 처리했습니다", async () => {
            for (const [id, no] of Object.entries(tracking)) await updateShipping([id], { ship_status: "shipped", carrier, tracking_no: no || null }, userId);
          }); }} />
      )}
      {sheetOpen && companyId && (
        <SheetDialog companyId={companyId} userId={userId} count={(selected.length ? selected : shown).length}
          onClose={() => setSheetOpen(false)} onExport={exportWith} />
      )}
      {pasteOpen && (
        <PasteTrackingDialog imports={imports} onClose={() => setPasteOpen(false)}
          onSave={(carrier, pairs) => { setPasteOpen(false); run(`${pairs.length}건에 송장번호를 넣고 발송 처리했습니다`, async () => {
            for (const p of pairs) await updateShipping([p.id], { ship_status: "shipped", carrier, tracking_no: p.no }, userId);
          }); }} />
      )}
    </>
  );
  //   setView — 현황 갈래의 배송 숫자가 그 상태 보기로 바로 열게(결정 148 후속)
  return { head, body, pagerEl, selbar, dialogs, setView };
}

/** 송장 양식 고르기 — 표준 택배사 양식 + 내 양식. 미리보기(열 머리글)와 [양식 만들기/고치기] */
function SheetDialog({ companyId, userId, count, onClose, onExport }: {
  companyId: string; userId: string | null; count: number; onClose: () => void; onExport: (l: SheetLayout) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: mine = [] } = useQuery({ queryKey: ["sheet-layouts", companyId], queryFn: () => listSheetLayouts(companyId), enabled: !!companyId });
  const all = useMemo(() => [...mine, ...CARRIER_SHEETS], [mine]);
  const [pick, setPick] = useState<string>(() => {
    try { return localStorage.getItem("ov.sheet.layout") || "std"; } catch { return "std"; }
  });
  const cur = all.find((l) => l.id === pick) || CARRIER_SHEETS[0];
  const [editing, setEditing] = useState<SheetLayout | null>(null);
  useEffect(() => { try { localStorage.setItem("ov.sheet.layout", pick); } catch { /* 저장 못 해도 동작엔 지장 없다 */ } }, [pick]);
  return (
    <div className="inv-modal" onClick={onClose}>
      <div className="inv-modal-box inv-modal-wide" onClick={(e) => e.stopPropagation()}>
        <h3 className="inv-modal-title">송장 파일 내려받기 — {count}건</h3>
        <p className="inv-modal-desc">
          택배사 양식을 고르면 그 열 순서·머리글로 엑셀이 만들어집니다. 택배사가 양식을 바꾸기도 하니 처음 한 번 올려 보고,
          안 맞으면 <b>내 양식으로 복사</b>해 열을 고쳐 두세요. 고른 양식은 이 컴퓨터에 기억됩니다.
        </p>
        <label className="inv-field"><span>양식</span>
          <select className="field-input" value={pick} onChange={(e) => setPick(e.target.value)}>
            {mine.length > 0 && <optgroup label="내 양식">{mine.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</optgroup>}
            <optgroup label="택배사 표준">{CARRIER_SHEETS.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</optgroup>
          </select></label>
        <div className="ch-sheet-preview">
          {cur.columns.map((c, i) => <span key={i} className="ch-sheet-col"><em>{i + 1}</em>{c.label}<i>{SHEET_FIELDS.find((f) => f.key === c.key)?.label}</i></span>)}
        </div>
        <div className="inv-modal-actions">
          <button type="button" className="btn-secondary btn-sm" onClick={() => setEditing({ id: "", name: `${cur.name.replace(/ \(.*\)$/, "")} 내 양식`, columns: cur.columns.map((c) => ({ ...c })) })}>내 양식으로 복사</button>
          {!cur.builtin && <button type="button" className="btn-secondary btn-sm" onClick={() => setEditing({ ...cur, columns: cur.columns.map((c) => ({ ...c })) })}>양식 고치기</button>}
          {!cur.builtin && <button type="button" className="btn-secondary btn-sm doc-del" onClick={async () => {
            if (!(await appConfirm(`'${cur.name}' 양식을 지울까요?`, { danger: true, confirmLabel: "지우기" }))) return;
            try { await deleteSheetLayout(cur.id); qc.invalidateQueries({ queryKey: ["sheet-layouts", companyId] }); setPick("std"); toast("지웠습니다", "success"); }
            catch (e) { toast(friendlyError(e), "error"); }
          }}>지우기</button>}
          <span className="doc-sums-sp" />
          <button type="button" className="btn-secondary btn-sm" onClick={onClose}>취소</button>
          <button type="button" className="btn-primary btn-sm" onClick={() => onExport(cur)}>내려받기</button>
        </div>
        {editing && (
          <SheetLayoutEditor layout={editing} onClose={() => setEditing(null)}
            onSave={async (l) => {
              try {
                await saveSheetLayout(companyId, { id: l.id || undefined, name: l.name, columns: l.columns }, userId);
                await qc.invalidateQueries({ queryKey: ["sheet-layouts", companyId] });
                const saved = (await listSheetLayouts(companyId)).find((x) => x.name === l.name.trim());
                if (saved) setPick(saved.id);
                setEditing(null); toast("양식을 저장했습니다 — 회사 전체에서 쓸 수 있습니다", "success");
              } catch (e) { toast(friendlyError(e, "양식을 저장하지 못했습니다"), "error"); }
            }} />
        )}
      </div>
    </div>
  );
}

/** 양식 편집 — 열 추가·순서·머리글 이름. 값은 SHEET_FIELDS 중에서 고른다 */
function SheetLayoutEditor({ layout, onClose, onSave }: { layout: SheetLayout; onClose: () => void; onSave: (l: SheetLayout) => void }) {
  const [name, setName] = useState(layout.name);
  const [cols, setCols] = useState<SheetColumn[]>(layout.columns);
  const [add, setAdd] = useState<string>(SHEET_FIELDS[0].key);
  const move = (i: number, d: -1 | 1) => setCols((s) => { const n = [...s]; const j = i + d; if (j < 0 || j >= n.length) return s; [n[i], n[j]] = [n[j], n[i]]; return n; });
  return (
    <div className="inv-modal" onClick={onClose}>
      <div className="inv-modal-box inv-modal-wide" onClick={(e) => e.stopPropagation()}>
        <h3 className="inv-modal-title">{layout.id ? "양식 고치기" : "내 양식 만들기"}</h3>
        <p className="inv-modal-desc">택배사 프로그램이 요구하는 열 순서대로 놓고, 머리글은 그 프로그램의 이름 그대로 적습니다. 자리 맞춤이 필요하면 (빈 칸)을 넣습니다.</p>
        <label className="inv-field"><span>양식 이름 *</span>
          <input className="field-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="예: CJ 우리회사용" /></label>
        <div className="ch-sheet-edit">
          {cols.map((c, i) => (
            <div key={i} className="ch-sheet-row">
              <em>{i + 1}</em>
              <select className="field-input" value={c.key} onChange={(e) => setCols((s) => s.map((x, j) => j === i ? { ...x, key: e.target.value as SheetColumn["key"] } : x))}>
                {SHEET_FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              </select>
              <input className="field-input" value={c.label} placeholder="머리글" onChange={(e) => setCols((s) => s.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} />
              <button type="button" className="btn-secondary btn-sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label="위로">↑</button>
              <button type="button" className="btn-secondary btn-sm" onClick={() => move(i, 1)} disabled={i === cols.length - 1} aria-label="아래로">↓</button>
              <button type="button" className="inv-line-x" onClick={() => setCols((s) => s.filter((_, j) => j !== i))} aria-label="열 지우기">✕</button>
            </div>
          ))}
          <div className="ch-sheet-row ch-sheet-add">
            <em>+</em>
            <select className="field-input" value={add} onChange={(e) => setAdd(e.target.value)}>
              {SHEET_FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}{f.desc ? ` — ${f.desc}` : ""}</option>)}
            </select>
            <button type="button" className="btn-secondary btn-sm" onClick={() => { const f = SHEET_FIELDS.find((x) => x.key === add)!; setCols((s) => [...s, { key: f.key, label: f.key === "blank" ? "" : f.label }]); }}>열 추가</button>
          </div>
        </div>
        <div className="inv-modal-actions">
          <button type="button" className="btn-secondary btn-sm" onClick={onClose}>취소</button>
          <button type="button" className="btn-primary btn-sm" disabled={!name.trim() || !cols.length} onClick={() => onSave({ ...layout, name, columns: cols })}>저장</button>
        </div>
      </div>
    </div>
  );
}

/** 발송 처리 — 택배사 하나 + 줄마다 송장번호(없어도 발송으로 기록할 수 있다: 직접 배달·방문 수령) */
function ShipDialog({ rows, itemText, onClose, onSave }: {
  rows: OrderImport[]; itemText: (i: OrderImport) => string; onClose: () => void;
  onSave: (carrier: string, tracking: Record<string, string>) => void;
}) {
  const [carrier, setCarrier] = useState<string>(CARRIERS[0].value);
  const [tracking, setTracking] = useState<Record<string, string>>({});
  return (
    <div className="inv-modal" onClick={onClose}>
      <div className="inv-modal-box inv-modal-wide" onClick={(e) => e.stopPropagation()}>
        <h3 className="inv-modal-title">발송 처리 — {rows.length}건</h3>
        <p className="inv-modal-desc">택배사를 고르고 송장번호를 적습니다. 송장번호 없이도 발송으로 기록할 수 있습니다(직접 배달·방문 수령). 재고는 이미 차감돼 있어 변하지 않습니다.</p>
        <label className="inv-field"><span>택배사 *</span>
          <select className="field-input" value={carrier} onChange={(e) => setCarrier(e.target.value)}>
            {CARRIERS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select></label>
        <div className="stg-table-wrap ch-ship-list">
          <table className="ev-table ev-lined table-inv-status-sm">
            <thead><tr><th>주문번호</th><th>수취인</th><th>상품</th><th>송장번호</th></tr></thead>
            <tbody>{rows.map((i) => (
              <tr key={i.id}>
                <td className="mono-number text-left"><b>{i.channel_order_no}</b></td>
                <td className="text-left">{i.recipient_name || i.buyer_name || "—"}</td>
                <td className="text-left ch-addr">{itemText(i) || "—"}</td>
                <td><input className="field-input doc-in" placeholder="송장번호" value={tracking[i.id] || ""} onChange={(e) => setTracking((t) => ({ ...t, [i.id]: e.target.value }))} /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <div className="inv-modal-actions">
          <button type="button" className="btn-secondary btn-sm" onClick={onClose}>취소</button>
          <button type="button" className="btn-primary btn-sm" onClick={() => onSave(carrier, Object.fromEntries(rows.map((i) => [i.id, (tracking[i.id] || "").trim()])))}>발송 처리</button>
        </div>
      </div>
    </div>
  );
}

/** 송장번호 붙여넣기 — 택배사 프로그램이 준 "주문번호 ⇥ 송장번호" */
function PasteTrackingDialog({ imports, onClose, onSave }: {
  imports: OrderImport[]; onClose: () => void; onSave: (carrier: string, pairs: { id: string; no: string }[]) => void;
}) {
  const [carrier, setCarrier] = useState<string>(CARRIERS[0].value);
  const [text, setText] = useState("");
  const parsed = useMemo(() => {
    const byNo = new Map(imports.map((i) => [i.channel_order_no.trim(), i]));
    const ok: { id: string; no: string; orderNo: string }[] = []; const miss: string[] = [];
    for (const raw of text.split(/\r?\n/)) {
      const p = raw.split(/\t|,|\s{2,}/).map((s) => s.trim()).filter(Boolean);
      if (p.length < 2) continue;
      const i = byNo.get(p[0]);
      if (i) ok.push({ id: i.id, no: p[1], orderNo: p[0] }); else miss.push(p[0]);
    }
    return { ok, miss };
  }, [text, imports]);
  return (
    <div className="inv-modal" onClick={onClose}>
      <div className="inv-modal-box inv-modal-wide" onClick={(e) => e.stopPropagation()}>
        <h3 className="inv-modal-title">송장번호 붙여넣기</h3>
        <p className="inv-modal-desc">택배사 프로그램에서 받은 <b>주문번호 · 송장번호</b> 두 열을 붙여 넣으면 주문번호로 맞춰 발송 처리됩니다.</p>
        <label className="inv-field"><span>택배사 *</span>
          <select className="field-input" value={carrier} onChange={(e) => setCarrier(e.target.value)}>
            {CARRIERS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select></label>
        <label className="inv-field"><span>주문번호 · 송장번호</span>
          <textarea className="field-input inv-paste ch-paste" rows={8} value={text} onChange={(e) => setText(e.target.value)} autoFocus
            placeholder={"주문번호\t송장번호\n2026082512345\t123456789012"} /></label>
        <p className="inv-foot">
          <b>{parsed.ok.length}건 맞춤</b>
          {parsed.miss.length > 0 && <span className="inv-paste-bad"> · 못 찾은 주문번호 {parsed.miss.length}건: {parsed.miss.slice(0, 3).join(", ")}{parsed.miss.length > 3 ? " …" : ""}</span>}
        </p>
        <div className="inv-modal-actions">
          <button type="button" className="btn-secondary btn-sm" onClick={onClose}>취소</button>
          <button type="button" className="btn-primary btn-sm" disabled={!parsed.ok.length} onClick={() => onSave(carrier, parsed.ok)}>발송 처리</button>
        </div>
      </div>
    </div>
  );
}

// ── 상품 연결 대량 등록 — 엑셀 두세 열 붙여넣기 (2026-08-26 사장님 지시 ④) ──────
//   열: 채널 상품코드 · SKU · 채널 상품명(선택). SKU 는 품목 마스터와 대소문자 없이 맞춘다. 못 찾은 SKU 는 넣지 않고 적어 준다.
//   같은 코드가 이미 연결돼 있으면 **덮어쓴다**(upsert) — 바뀐 연결을 다시 붙여 넣는 것이 흔한 일이다.
function BulkCodeDialog({ companyId, channel: init, products, existing, onClose, onSaved }: {
  companyId: string; channel: ChannelValue; products: Product[]; existing: ChannelCode[];
  onClose: () => void; onSaved: (n: number) => void;
}) {
  const { toast } = useToast();
  const [channel, setChannel] = useState<ChannelValue>(init);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const parsed = useMemo(() => {
    const bySku = new Map(products.filter((p) => p.is_active).map((p) => [p.sku.trim().toUpperCase(), p]));
    const have = new Set(existing.filter((c) => c.channel === channel).map((c) => c.channel_product_id.trim().toUpperCase()));
    const ok: { code: string; sku: string; name: string; product_id: string; replace: boolean }[] = []; const miss: string[] = [];
    for (const raw of text.split(/\r?\n/)) {
      const p = raw.includes("\t") ? raw.split("\t").map((x) => x.trim()) : raw.split(/,|\s{2,}/).map((x) => x.trim());
      if (!p[0] || !p[1]) continue;
      const prod = bySku.get(p[1].toUpperCase());
      if (!prod) { miss.push(`${p[0]} → ${p[1]}`); continue; }
      ok.push({ code: p[0], sku: prod.sku, name: p[2] || "", product_id: prod.id, replace: have.has(p[0].toUpperCase()) });
    }
    return { ok, miss };
  }, [text, products, existing, channel]);
  return (
    <div className="inv-modal" onClick={onClose}>
      <div className="inv-modal-box inv-modal-wide" onClick={(e) => e.stopPropagation()}>
        <h3 className="inv-modal-title">상품 연결 엑셀 붙여넣기</h3>
        <p className="inv-modal-desc">열 순서: <b>채널 상품코드 · SKU</b> · 채널 상품명(선택). 같은 코드가 이미 있으면 새 연결로 바뀝니다.</p>
        <label className="inv-field"><span>채널 *</span>
          <select className="field-input" value={channel} onChange={(e) => setChannel(e.target.value as ChannelValue)}>
            {CHANNELS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select></label>
        <label className="inv-field"><span>목록</span>
          <ExcelPasteHelper templateName="상품연결_양식" sheetName="상품 연결" onText={setText}
            cols={[{ key: "code", label: "채널 상품코드", required: true, example: "SS-1001" }, { key: "sku", label: "SKU", required: true, hint: "오너뷰 품목 SKU", example: "DM-A100" }, { key: "name", label: "채널 상품명", example: "프리미엄 텀블러 500ml" }]} />
          <textarea className="field-input inv-paste ch-paste" rows={8} value={text} onChange={(e) => setText(e.target.value)} autoFocus
            placeholder={"채널상품코드\tSKU\t채널상품명\nSS-1001\tA-001\t프리미엄 세트"} /></label>
        <p className="inv-foot">
          <b>{parsed.ok.length}건 맞춤</b>{parsed.ok.some((x) => x.replace) && <> · 기존 연결 바뀜 {parsed.ok.filter((x) => x.replace).length}건</>}
          {parsed.miss.length > 0 && <span className="inv-paste-bad"> · SKU 못 찾음 {parsed.miss.length}건: {parsed.miss.slice(0, 3).join(" / ")}{parsed.miss.length > 3 ? " …" : ""}</span>}
        </p>
        <div className="inv-modal-actions">
          <button type="button" className="btn-secondary btn-sm" onClick={onClose}>취소</button>
          <button type="button" className="btn-primary btn-sm" disabled={!parsed.ok.length || busy}
            onClick={async () => {
              setBusy(true);
              try {
                for (const x of parsed.ok) await upsertChannelCode(companyId, { product_id: x.product_id, channel, channel_product_id: x.code, channel_product_name: x.name || null });
                onSaved(parsed.ok.length);
              } catch (e) { toast(friendlyError(e, "연결하지 못했습니다"), "error"); }
              finally { setBusy(false); }
            }}>연결</button>
        </div>
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
