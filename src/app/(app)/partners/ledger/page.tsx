"use client";
import { kstDateStr } from "@/lib/kst";
import { logRead } from "@/lib/log-read";

// 거래처 원장 — 매출처(받을 돈)/매입처(줄 돈) 잔액 조회 (2026-06-12 메뉴 분리 핸드오프).
//   대사 작업(확인 큐/수동 매칭/확정 내역)은 /partners/reconciliation (거래 대사)로 분리.
//   UX(§4): 세그먼트 탭(매출처=파랑 var(--info) / 매입처=주황 var(--warning), 빨강은 연체·마이너스 전용) +
//   요약 카드 + 좌 거래처 목록 / 우 타사 세무 서비스식 원장 시트. 탭 상태는 URL ?type= 에 반영.

import { useEffect, useMemo, useState } from "react";
import { DateRangeField } from "@/components/date-range-field";
import { EmptyState } from "@/components/empty-state";
import { PickList } from "@/components/pick-list";
import { SortableTh, nextSort, cmp, type SortState } from "@/components/sortable-th";
import {
  QueryScreen, QueryHead, QueryBody, QueryBar, ResultStrip, Stat, ExcelMenu, HelperMenu, SavedTabs, ConditionSave,
  ConditionPanel, ConditionRow, AppliedChips, QuickSearch, quickSearchHit, quickTerms, useSavedQueries, SelectionBar, AmountRange, amountHit,
  type ExcelItem, type HelperItem, type AppliedChip,
} from "@/components/query-kit";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";
import { useToast } from "@/components/toast";
import { exportPartnerLedgersXlsx } from "./export";
import {
  type LedgerRow, won, AR_AP, palette,
  PartnerLedgerSheet, PartnerDetailModal,
} from "./shared";

type ArApType = "sales" | "purchase";

/**
 * 검색조건 (조회 화면 표준, 2026-08-18 Wave 1). ★ '조회'를 눌러야 반영. 회계기간·빠른검색은 즉시.
 *   잔액: 전체 / 잔액 있는 곳만 / 마이너스만
 */
type Cond = { bal: "" | "pos" | "neg"; min: string; max: string; code: string };
const EMPTY_COND: Cond = { bal: "", min: "", max: "", code: "" };
const condCount = (c: Cond) => (c.bal ? 1 : 0) + ((c.min || c.max) ? 1 : 0) + (c.code ? 1 : 0);
const BAL_OPTS = [{ value: "", label: "전체" }, { value: "pos", label: "잔액 있는 곳만" }, { value: "neg", label: "마이너스만" }] as const;
const thisYear = () => new Date().getFullYear();
const yearRange = (y: number) => ({ from: `${y}-01-01`, to: `${y}-12-31` });
type LSortKey = "code" | "name" | "out";

// 초기 탭 — URL ?type= (새로고침/공유 유지). useSearchParams 의 Suspense 요구를 피해 window 직접 읽기.
function initialType(): ArApType {
  if (typeof window === "undefined") return "sales";
  const t = new URLSearchParams(window.location.search).get("type");
  return t === "purchase" ? "purchase" : "sales";
}

export default function PartnerLedgerPage() {
  const { user } = useUser();
  const companyId = user?.company_id ?? null;
  const qc = useQueryClient();
  const { toast } = useToast();
  const db = supabase;

  const [ledgerType, setLedgerTypeRaw] = useState<ArApType>(initialType);
  //   2026-08-11 — 회계기간이 '연도 드롭다운 / 연도 직접입력 / 기간 직접선택' 세 갈래로 갈려 있었다.
  //   값의 출처를 **기간 하나(customFrom~customTo)** 로 합치고, 연도 프리셋은 그 값을 채우는 지름길로 둔다.
  const [customFrom, setCustomFrom] = useState(`${new Date().getFullYear()}-01-01`);
  const [customTo, setCustomTo] = useState(`${new Date().getFullYear()}-12-31`);
  const periodStart = customFrom;
  const periodEnd = customTo;
  //   좌측 목록 RPC 는 연도 기준이라 시작일의 연도를 쓴다
  const rpcYear = Number(customFrom.slice(0, 4)) || new Date().getFullYear();
  //   그 해 전체(1/1~12/31)면 '2026년'으로, 아니면 날짜 그대로 보여 준다
  const isWholeYear = customFrom.endsWith("-01-01") && customTo === `${customFrom.slice(0, 4)}-12-31`;
  const periodLabel = isWholeYear ? `${customFrom.slice(0, 4)}년` : `${customFrom} ~ ${customTo}`;
  //   ── 조회 화면 표준 — 수집·전표에서 확정한 뼈대. 새로 만들지 않는다 ──
  //   회계기간은 이 화면의 뜻이 '한 해 원장'이라 기본값이 **올해 1/1~12/31**이다(표준의 '최근 1개월' 예외 — 잔액은 연도로 본다).
  const [q, setQ] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [draft, setDraft] = useState<Cond>(EMPTY_COND);
  const [live, setLive] = useState<Cond>(EMPTY_COND);
  //   목록 정렬 — 기본 잔액 큰 순(관리 우선순위). 머리단 정렬 부품으로.
  const [sort, setSort] = useState<SortState<LSortKey>>({ key: "out", dir: "desc" });
  const onSort = (k: LSortKey) => setSort((c) => nextSort(c, k, k === "out" ? "desc" : "asc"));
  const [selLedger, setSelLedger] = useState<string | null>(null); // 좌측 목록 선택 (partner_id, null 거래처는 "none")
  const [detail, setDetail] = useState<{ partnerId: string | null; type: string; focus: "all" | "prior" } | null>(null);
  //   2026-08-19 원장 칸 확대(docs/20260819_PLAN_partner_ledger_layout.md): ↔ 넓게 = 목록을 접고 원장만 전폭.
  //   화면 안 상태(기억 안 함). 넓게일 때 거래처는 원장 머리의 피커 + ‹ › 로 바꾼다.
  const [wide, setWide] = useState(false);
  const [pickOpen, setPickOpen] = useState(false);
  //   미수 경과 칩 필터 — 요약 줄의 경과 칩을 누르면 그 경과 구간에 미결 계산서가 있는 거래처만 (재클릭 해제)
  const [ageFilter, setAgeFilter] = useState<number | null>(null);
  // 일괄 엑셀 내보내기 — 목록 체크 선택(키=partner_id ?? "none"), 거래처마다 시트 분리
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  useEffect(() => { setCheckedIds(new Set()); }, [ledgerType, periodStart, periodEnd]);
  const toggleChecked = (key: string) => setCheckedIds((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  const setLedgerType = (t: ArApType) => {
    setLedgerTypeRaw(t);
    setSelLedger(null);
    try { window.history.replaceState({}, "", `/partners/ledger?type=${t}`); } catch { /* noop */ }
  };

  const { data: rows = [], isLoading: lLoading } = useQuery<LedgerRow[]>({
    queryKey: ["partner-ledger", companyId, rpcYear],
    queryFn: async () => {
      const data = logRead('ledger/page:data', await db.rpc("get_partner_ledger_by_year", { p_year: rpcYear }));
      return (data || []) as LedgerRow[];
    },
    enabled: !!companyId,
  });

  const { data: partnerInfo = { names: {}, codes: {} } } = useQuery<{ names: Record<string, string>; codes: Record<string, number> }>({
    queryKey: ["partner-ledger-names", companyId],
    queryFn: async () => {
      const data = logRead('ledger/page:data', await db.from("partners").select("id, name, code").eq("company_id", companyId ?? ""));
      const names: Record<string, string> = {};
      const codes: Record<string, number> = {};
      for (const p of (data || []) as any[]) { names[p.id] = p.name; if (p.code != null) codes[p.id] = p.code; }
      return { names, codes };
    },
    enabled: !!companyId,
  });
  const partnerMap = partnerInfo.names;
  const partnerCodeMap = partnerInfo.codes;

  // 수동 전표만 있는 거래처(세금계산서 없음)도 해당 탭에 노출하기 위한 분류
  //   외상매출금(108) 라인 → 매출처, 외상매입금(251) 라인 → 매입처. (매입처에서 전표 도달 불가하던 버그 해소)
  //   + 수동 전표의 AR/AP 라인이 잔액에 미치는 영향(단수차 등)도 합산 — 좌측 목록 잔액이 우측 시트와 일치.
  const { data: voucherPartnerTypes = {} } = useQuery<Record<string, { sales?: boolean; purchase?: boolean; salesAdj?: number; purchaseAdj?: number }>>({
    queryKey: ["ledger-voucher-partners", companyId, periodStart, periodEnd],
    queryFn: async () => {
      const data = logRead('ledger/page:data', await db.from("journal_entries")
        .select("journal_lines(partner_id, debit, credit, chart_of_accounts(code))")
        .eq("company_id", companyId ?? "").eq("source", "manual").eq("status", "confirmed")
        .gte("entry_date", periodStart).lte("entry_date", periodEnd));
      const m: Record<string, { sales?: boolean; purchase?: boolean; salesAdj?: number; purchaseAdj?: number }> = {};
      for (const e of (data || []) as any[]) {
        for (const l of (e.journal_lines || [])) {
          if (!l.partner_id) continue;
          const code = l.chart_of_accounts?.code;
          const d = Number(l.debit || 0), c = Number(l.credit || 0);
          if (code === "108") { (m[l.partner_id] ||= {}).sales = true; m[l.partner_id].salesAdj = (m[l.partner_id].salesAdj || 0) + (d - c); }   // 매출(AR): 차변 증가
          if (code === "251") { (m[l.partner_id] ||= {}).purchase = true; m[l.partner_id].purchaseAdj = (m[l.partner_id].purchaseAdj || 0) + (c - d); } // 매입(AP): 대변 증가
        }
      }
      return m;
    },
    enabled: !!companyId,
  });

  // 미수 경과(에이징) — 세금계산서 발행분 기준 잔액을 발행일 경과일로 버킷팅(매출처 뷰 전용, 표시만).
  //   ⚠️ 원장 '총 미수금'(RPC)은 전표·이월 포함이라 이 에이징 합계와 다를 수 있음 → 라벨로 구분.
  const { data: aging } = useQuery<{ buckets: { label: string; amount: number; count: number }[]; total: number; byPartner: Record<string, number[]> } | null>({
    queryKey: ["ledger-ar-aging", companyId],
    enabled: !!companyId && ledgerType === "sales",
    staleTime: 60_000,
    queryFn: async () => {
      const since = new Date(); since.setDate(since.getDate() - 730);
      const inv = logRead('ledger/page:inv', await db.from("tax_invoices")
        .select("total_amount, supply_amount, settled_amount, issue_date, status, partner_id")
        .eq("company_id", companyId ?? "").eq("type", "sales").neq("status", "void")
        // 전표처리된 건만 — 원장 집계와 동일 기준 (2026-08-26 사장님)
        .not("journal_entry_id", "is", null)
        .gte("issue_date", kstDateStr(since)).limit(5000));
      const buckets = [
        { label: "0–30일", min: 0, max: 30, amount: 0, count: 0 },
        { label: "31–60일", min: 31, max: 60, amount: 0, count: 0 },
        { label: "61–90일", min: 61, max: 90, amount: 0, count: 0 },
        { label: "90일+", min: 91, max: Infinity, amount: 0, count: 0 },
      ];
      const now = new Date();
      const todayMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      //   거래처별로 어느 구간에 미결 계산서가 있는지 — 요약 줄 경과 칩을 눌러 목록을 거를 때 쓴다 (미지정 = "none")
      const byPartner: Record<string, number[]> = {};
      for (const r of (inv || []) as any[]) {
        if (r.status === "draft") continue;
        const bal = Number(r.total_amount || r.supply_amount || 0) - Number(r.settled_amount || 0);
        if (bal <= 1) continue;
        const days = r.issue_date ? Math.floor((todayMs - new Date(String(r.issue_date).slice(0, 10)).getTime()) / 86400000) : 0;
        const bi = Math.max(0, buckets.findIndex((x) => days >= x.min && days <= x.max));
        const b = buckets[bi] || buckets[3];
        b.amount += bal; b.count += 1;
        const pk = r.partner_id || "none";
        if (!byPartner[pk]) byPartner[pk] = [];
        if (!byPartner[pk].includes(bi)) byPartner[pk].push(bi);
      }
      return { buckets: buckets.map(({ label, amount, count }) => ({ label, amount, count })), total: buckets.reduce((s, b) => s + b.amount, 0), byPartner };
    },
  });

  // 홈택스 거래처 연결 — 세금계산서↔거래처 사업자번호 자동 연결 (원장의 전제 데이터)
  const linkMut = useMutation({
    mutationFn: async () => {
      const { data, error } = await db.rpc("link_invoice_partners");
      if (error) throw new Error(error.message); return data as { created: number; linked: number };
    },
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["partner-ledger"] }); qc.invalidateQueries({ queryKey: ["partner-ledger-names"] }); qc.invalidateQueries({ queryKey: ["partners"] }); toast(`거래처 ${r?.created ?? 0}곳 등록 · 세금계산서 ${r?.linked ?? 0}건 연결`, "success"); },
    onError: (e: any) => toast(e?.message || "연결 실패", "error"),
  });

  const nameOf = (pid: string | null) => (pid && partnerMap[pid]) || "미지정 거래처";

  // 잔액 = 전기이월 + 당기 잔액 + 수동 전표 AR/AP 보정(단수차 등 — 우측 시트와 일치)
  const voucherAdj = (r: LedgerRow) => {
    const v = r.partner_id ? voucherPartnerTypes[r.partner_id] : undefined;
    if (!v) return 0;
    return r.type === "sales" ? (v.salesAdj || 0) : (v.purchaseAdj || 0);
  };
  const ledgerOut = (r: LedgerRow) => Number(r.prior_outstanding || 0) + Number(r.period_outstanding || 0) + voucherAdj(r);
  const { receivables, payables, totalAr, totalAp } = useMemo(() => {
    const has = (r: LedgerRow) => ledgerOut(r) > 0 || Number(r.period_billed || 0) > 0;
    const recv = rows.filter((r) => r.type === "sales" && has(r));
    const pay = rows.filter((r) => r.type === "purchase" && has(r));
    // 세금계산서 없이 수동 전표만 있는 거래처도 해당 탭에 추가 노출(잔액 0) — 양쪽 탭에서 전표 수정 가능
    const synth = (pid: string, t: ArApType): LedgerRow => ({ partner_id: pid, type: t, invoice_count: 0, prior_outstanding: 0, period_billed: 0, period_settled: 0, period_outstanding: 0 });
    const recvIds = new Set(recv.map((r) => r.partner_id));
    const payIds = new Set(pay.map((r) => r.partner_id));
    for (const [pid, t] of Object.entries(voucherPartnerTypes)) {
      if (t.sales && !recvIds.has(pid)) recv.push(synth(pid, "sales"));
      if (t.purchase && !payIds.has(pid)) pay.push(synth(pid, "purchase"));
    }
    return { receivables: recv, payables: pay,
      totalAr: recv.reduce((s, r) => s + ledgerOut(r), 0),
      totalAp: pay.reduce((s, r) => s + ledgerOut(r), 0) };
  }, [rows, voucherPartnerTypes]);

  const pal = palette(ledgerType);
  const data = ledgerType === "sales" ? receivables : payables;
  const total = ledgerType === "sales" ? totalAr : totalAp;
  const other = ledgerType === "sales" ? AR_AP.purchase : AR_AP.sales;
  const otherTotal = ledgerType === "sales" ? totalAp : totalAr;

  const codeOf = (r: LedgerRow) => (r.partner_id && partnerCodeMap[r.partner_id]) || null;
  const codeStr = (r: LedgerRow) => { const c = codeOf(r); return c != null ? String(c).padStart(4, "0") : ""; };
  const sq = q.trim();
  const balHit = (r: LedgerRow, c: Cond) => (c.bal === "" || (c.bal === "pos" ? ledgerOut(r) > 0 : ledgerOut(r) < 0))
    && amountHit(Math.abs(ledgerOut(r)), c.min, c.max)
    && (!c.code || codeStr(r).includes(c.code.trim()));
  const shown = useMemo(() => {
    //   빠른검색 — 거래처명·코드·잔액을 한꺼번에 (쉼표 = 또는, Enter 로 반영)
    const ageHit = (r: LedgerRow) => ageFilter === null || ledgerType !== "sales" || !!aging?.byPartner[r.partner_id ?? "none"]?.includes(ageFilter);
    const filtered = data.filter((r) => quickSearchHit(q, [nameOf(r.partner_id), codeStr(r)], [ledgerOut(r)]) && balHit(r, live) && ageHit(r));
    const val = (r: LedgerRow) => sort.key === "name" ? nameOf(r.partner_id) : sort.key === "code" ? (codeOf(r) ?? null) : ledgerOut(r);
    filtered.sort((a, b) => { const c = cmp(val(a), val(b)); return (sort.dir === "asc" ? c : -c) || nameOf(a.partner_id).localeCompare(nameOf(b.partner_id), "ko"); });
    return filtered;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, q, live, sort, partnerMap, partnerCodeMap, ageFilter, aging, ledgerType]);
  const previewCount = data.filter((r) => balHit(r, draft)).length;

  //   내 조건 — ★ 하나가 이 화면의 기본값
  const saved = useSavedQueries("partner-ledger", companyId);
  const paramsNow = { type: ledgerType, from: customFrom, to: customTo, q, cond: live };
  const paramsBasic = { type: "sales", ...yearRange(thisYear()), q: "", cond: EMPTY_COND };
  const applySaved = (p: Record<string, unknown>) => {
    if (p.type === "sales" || p.type === "purchase") setLedgerType(p.type);
    if (typeof p.from === "string" && typeof p.to === "string") { setCustomFrom(p.from); setCustomTo(p.to); }
    if (typeof p.q === "string") setQ(p.q);
    const c = { ...EMPTY_COND, ...(p.cond as Partial<Cond> | undefined) };
    setDraft(c); setLive(c);
  };
  const [defDone, setDefDone] = useState(false);
  useEffect(() => {
    if (defDone || !saved.isFetched) return;
    setDefDone(true);
    if (saved.def) applySaved(saved.def.params || {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved.isFetched, saved.def, defDone]);
  const suggestName = () => [draft.bal ? BAL_OPTS.find((o) => o.value === draft.bal)?.label : "", (draft.min || draft.max) ? "잔액 금액" : "", periodLabel, pal.label].filter(Boolean).slice(0, 3).join(" · ");
  const drop = (patch: Partial<Cond>) => { const c = { ...live, ...patch }; setLive(c); setDraft(c); };
  const chips: AppliedChip[] = [
    ...quickTerms(q).map((t, i) => ({ group: "빠른검색", label: t, onRemove: () => setQ(quickTerms(q).filter((_, j) => j !== i).join(", ")) })),
    ...(live.bal ? [{ group: "잔액", label: BAL_OPTS.find((o) => o.value === live.bal)?.label || live.bal, onRemove: () => drop({ bal: "" }) }] : []),
    ...((live.min || live.max) ? [{ group: "잔액 금액", label: `${Number(live.min || 0).toLocaleString("ko")} ~ ${live.max ? Number(live.max).toLocaleString("ko") : "제한없음"}`, onRemove: () => drop({ min: "", max: "" }) }] : []),
    ...(live.code ? [{ group: "코드", label: live.code, onRemove: () => drop({ code: "" }) }] : []),
    ...(ageFilter !== null && aging ? [{ group: "미수 경과", label: aging.buckets[ageFilter]?.label || "", onRemove: () => setAgeFilter(null) }] : []),
  ];
  const clearAll = () => { setQ(""); setLive(EMPTY_COND); setDraft(EMPTY_COND); setAgeFilter(null); };

  //   (2026-08-19) '미수금이 큰 거래처' 막대는 뺐다 — 목록이 잔액순이라 같은 정보였고, 원장 칸을 먹었다.
  const selKey = selLedger ?? (shown[0] ? (shown[0].partner_id ?? "none") : null);
  const selRow = shown.find((r) => (r.partner_id ?? "none") === selKey) || null;
  //   ‹ › — 목록 순서대로 이전·다음 거래처 (넓게에서 목록이 없을 때의 이동 수단, 펼친 상태에서도 쓴다)
  const selIdx = shown.findIndex((r) => (r.partner_id ?? "none") === selKey);
  const gotoIdx = (i: number) => { const r = shown[i]; if (r) setSelLedger(r.partner_id ?? "none"); };
  const pickItems = shown.map((r) => ({ id: r.partner_id ?? "none", code: codeStr(r) || null, name: nameOf(r.partner_id), out: ledgerOut(r) }));

  //   엑셀 그릇 — 거래처마다 시트 하나로 (선택한 곳 / 보이는 전체)
  const runExport = async (targetsRows: LedgerRow[]) => {
    if (exporting || !companyId || targetsRows.length === 0) return;
    setExporting(true);
    try {
      const targets = targetsRows.map((r) => ({ partnerId: r.partner_id, type: r.type, name: nameOf(r.partner_id) }));
      await exportPartnerLedgersXlsx(companyId, targets, periodStart, periodEnd, pal.label);
      toast(`${targets.length}곳 원장을 엑셀로 내보냈습니다 (거래처별 시트)`, "success");
    } catch (e: any) {
      toast(e?.message || "엑셀 내보내기 실패", "error");
    } finally { setExporting(false); }
  };
  const checkedRows = shown.filter((r) => checkedIds.has(r.partner_id ?? "none"));
  const excelItems: ExcelItem[] = [
    { label: "선택한 거래처 원장 내려받기", count: checkedRows.length, hint: "거래처마다 시트 하나 · 회계기간 그대로", disabled: exporting || checkedRows.length === 0, onClick: () => runExport(checkedRows) },
    { label: "보이는 거래처 전부 내려받기", count: shown.length, hint: "걸린 조건 그대로 · 많으면 시간이 걸립니다", disabled: exporting || shown.length === 0, onClick: () => runExport(shown) },
  ];
  const helperItems: HelperItem[] = [
    { label: linkMut.isPending ? "연결 중…" : "홈택스 거래처 연결", source: "국세청 조회", disabled: linkMut.isPending,
      hint: "홈택스 세금계산서의 상대를 사업자번호로 거래처에 자동 등록·연결합니다 — 원장의 전제 데이터", onClick: () => linkMut.mutate() },
  ];
  const yearQuicks = [thisYear(), thisYear() - 1, thisYear() - 2].map((y) => ({ y, ...yearRange(y) }));

  return (
    <div className="qk-shell">
      {/* ── 조회 화면 표준 — 탭 · 조회 줄 · 걸린 조건 · 결과 요약 · (통계) · 목록+원장 · 확정 줄 (2026-08-18 Wave 1) ── */}
      <QueryScreen>
        <QueryHead>
          <div className="collect-tabs no-print">
            {(["sales", "purchase"] as const).map((t) => (
              <button key={t} type="button" onClick={() => setLedgerType(t)}
                className={ledgerType === t ? "collect-tab collect-tab-on" : "collect-tab"}>
                {AR_AP[t].label}<span className="collect-tab-cnt">{(t === "sales" ? receivables : payables).length.toLocaleString()}</span>
              </button>
            ))}
          </div>

          <QueryBar right={<>
            <ExcelMenu items={excelItems} />
            <HelperMenu items={helperItems} />
          </>}>
            <DateRangeField label={null} parts="segments" from={customFrom} to={customTo}
              onChange={(f, t) => { setCustomFrom(f); setCustomTo(t); }}
              trailing={
                <ConditionPanel open={panelOpen} onOpenChange={setPanelOpen} activeCount={condCount(live)} anchorSel=".drf"
                  tabs={<SavedTabs list={saved.list} current={paramsNow} basic={paramsBasic}
                    onApply={(sv) => { applySaved(sv.params || {}); setPanelOpen(false); }}
                    onBasic={() => { const b = yearRange(thisYear()); setCustomFrom(b.from); setCustomTo(b.to); clearAll(); }}
                    onRemove={saved.remove} onSetDefault={saved.setDefault} />}
                  foot={<>
                    <button type="button" className="btn-secondary btn-sm" disabled={condCount(draft) === 0} onClick={() => setDraft(EMPTY_COND)}>조건 지우기</button>
                    <ConditionSave suggest={suggestName}
                      onSave={(name, asDefault) => { saved.save(name, { type: ledgerType, from: customFrom, to: customTo, q, cond: draft }, asDefault); setLive(draft); setPanelOpen(false); }} />
                    <span className="ml-auto text-[11px] text-[var(--text-dim)]">{previewCount.toLocaleString("ko")}곳</span>
                    <button type="button" className="btn-primary btn-sm" onClick={() => { setLive(draft); setPanelOpen(false); }}>조회</button>
                  </>}>
                  <ConditionRow label="회계기간" hint="잔액 = 전기이월 + 이 기간 잔액">
                    <span className="qk-range-txt">{periodLabel}</span>
                    <DateRangeField label={null} parts="calendar" confirm from={customFrom} to={customTo}
                      onChange={(f, t) => { setCustomFrom(f); setCustomTo(t); }} />
                    <span className="qk-quicks">
                      {yearQuicks.map((yq) => (
                        <button key={yq.y} type="button" onClick={() => { setCustomFrom(yq.from); setCustomTo(yq.to); }}
                          className={customFrom === yq.from && customTo === yq.to ? "qk-quick qk-quick-on" : "qk-quick"}>{yq.y}년</button>
                      ))}
                    </span>
                  </ConditionRow>
                  <ConditionRow label="잔액">
                    <span className="qk-quicks">
                      {BAL_OPTS.map((o) => (
                        <button key={o.value} type="button" onClick={() => setDraft((c) => ({ ...c, bal: o.value }))}
                          className={draft.bal === o.value ? "qk-quick qk-quick-on" : "qk-quick"}>{o.label}</button>
                      ))}
                    </span>
                  </ConditionRow>
                  <ConditionRow label="잔액 금액" hint="절대값 · 한쪽만 적어도 됩니다">
                    <AmountRange min={draft.min} max={draft.max} onMin={(v) => setDraft((c) => ({ ...c, min: v }))} onMax={(v) => setDraft((c) => ({ ...c, max: v }))} />
                  </ConditionRow>
                  <ConditionRow label="거래처 코드" hint="일부만 쳐도 됩니다">
                    <input className="qk-input w-32" value={draft.code} placeholder="예: 04" onChange={(e) => setDraft((c) => ({ ...c, code: e.target.value }))} />
                  </ConditionRow>
                </ConditionPanel>
              } />
            <QuickSearch value={q} onApply={setQ} placeholder="거래처명 · 코드 · 잔액 — 쉼표로 여러 개, Enter" />
          </QueryBar>

          <AppliedChips chips={chips} onClearAll={clearAll} />

          <ResultStrip right={
            <button type="button" className="btn-secondary btn-sm" onClick={() => setLedgerType(ledgerType === "sales" ? "purchase" : "sales")}
              title="반대편으로 전환">{other.arrow} {other.label} {ledgerType === "sales" ? "총 미지급금" : "총 미수금"} <b className="mono-number">{won(otherTotal)}</b> →</button>
          }>
            <Stat label={ledgerType === "sales" ? "총 미수금" : "총 미지급금"} value={won(total)} tone={ledgerType === "sales" ? "plus" : "minus"} />
            <Stat label={pal.label} value={`${shown.length.toLocaleString("ko")}곳${(sq || live.bal || ageFilter !== null) && data.length !== shown.length ? ` / ${data.length.toLocaleString("ko")}` : ""}`} />
            {/* 미수 경과 — 예전 카드 4칸을 칩으로 (2026-08-19). 누르면 그 구간에 미결 계산서가 있는 거래처만 목록에 남는다 */}
            {ledgerType === "sales" && aging && aging.total > 0 && (
              <span className="ledger-age-chips" title={`합계 ${won(aging.total)} · 세금계산서 발행 기준 — 원장 총 미수금은 전표·이월 포함(차이 정상)`}>
                <span className="ledger-age-lbl">미수 경과</span>
                {aging.buckets.map((b, i) => (
                  <button key={b.label} type="button" onClick={() => setAgeFilter(ageFilter === i ? null : i)}
                    className={`ledger-age-chip ledger-age-${i} ${ageFilter === i ? "ledger-age-chip-on" : ""}`}
                    title={ageFilter === i ? "누르면 조건을 풉니다" : "누르면 이 구간 거래처만 봅니다"}>
                    {b.label} <b className="mono-number">{won(b.amount)}</b> · {b.count}건
                  </button>
                ))}
              </span>
            )}

          </ResultStrip>
        </QueryHead>

        <QueryBody>
         {/* ── 좌 목록 300px · 우 원장 나머지 전부, 상자 끝선까지. 각자 스크롤 (2026-08-19 사장님: "원장 칸이 작아 보기 어렵다") ── */}
         <div className={`ledger-body ${wide ? "ledger-body-wide" : ""}`}>
          {lLoading ? (
            <div className="collect-empty">불러오는 중…</div>
          ) : (
            <>
              {/* ── 좌: 거래처 목록 — 조회 표준 표. 줄을 누르면 오른쪽 원장이 바뀐다. ↔ 넓게면 접힌다 ── */}
              <div className="ledger-list-pane">
                {shown.length === 0 ? (
                  <div className="collect-empty">
                    {sq || live.bal || ageFilter !== null ? "이 조건에 맞는 거래처가 없습니다 — 검색조건을 풀어 보세요" : `${periodLabel} ${pal.label} 거래가 없습니다 — AI 제안 ▾ 「홈택스 거래처 연결」을 먼저 실행해 보세요`}
                  </div>
                ) : (
                  <div className="ev-scroll ledger-list-scroll">
                    <table className="ev-table ev-lined ledger-list-table">
                      <thead>
                        <tr>
                          <th className="w-9">
                            <button type="button" aria-label="전체 선택" title="선택한 거래처를 엑셀 한 파일(거래처별 시트)로 내보냅니다"
                              onClick={() => setCheckedIds(shown.every((r) => checkedIds.has(r.partner_id ?? "none")) ? new Set() : new Set(shown.map((r) => r.partner_id ?? "none")))}
                              className={shown.length > 0 && shown.every((r) => checkedIds.has(r.partner_id ?? "none")) ? "collect-chk collect-chk-on" : "collect-chk"}>
                              {shown.length > 0 && shown.every((r) => checkedIds.has(r.partner_id ?? "none")) ? "✓" : ""}
                            </button>
                          </th>
                          <SortableTh label="코드" sortKey="code" sort={sort} onSort={onSort} style={{ width: 56 }} />
                          <SortableTh label={pal.label} sortKey="name" sort={sort} onSort={onSort} />
                          <SortableTh label="잔액" sortKey="out" sort={sort} onSort={onSort} style={{ width: 104 }} />
                        </tr>
                      </thead>
                      <tbody>
                        {shown.map((r) => {
                          const key = r.partner_id ?? "none";
                          const active = key === selKey;
                          const out = ledgerOut(r);
                          const on = checkedIds.has(key);
                          return (
                            <tr key={`${key}-${r.type}`} onClick={() => setSelLedger(key)}
                              className={active ? "ledger-row ledger-row-on" : "ledger-row"}
                              style={active ? { background: `color-mix(in srgb, ${pal.main} 9%, transparent)` } : undefined}>
                              <td onClick={(e) => e.stopPropagation()}>
                                <button type="button" aria-label="선택" onClick={() => toggleChecked(key)}
                                  className={on ? "collect-chk collect-chk-on" : "collect-chk"}>{on ? "✓" : ""}</button>
                              </td>
                              <td className="tc mono-number ev-dim">{codeStr(r) || "—"}</td>
                              <td className={active ? "ev-ell font-bold" : "ev-ell font-medium"} style={active ? { color: pal.main } : undefined} title={nameOf(r.partner_id)}>{nameOf(r.partner_id)}</td>
                              <td className={`tr mono-number font-semibold ${out > 0 ? pal.tintText : out < 0 ? "text-[var(--danger)]" : "text-[var(--text-dim)]"}`}>{Math.round(out).toLocaleString()}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* ── 우: 일자별 원장 (차변/대변/잔액) — 상자 나머지 전부, 머리단·합계 고정에 몸통만 스크롤 ── */}
              <div className="ledger-sheet-pane">
              {selRow ? (
                <PartnerLedgerSheet
                  key={`${selKey}-${selRow.type}-${periodStart}-${periodEnd}`}
                  companyId={companyId!}
                  partnerId={selRow.partner_id}
                  type={selRow.type}
                  year={rpcYear}
                  periodStart={periodStart}
                  periodEnd={periodEnd}
                  partnerName={nameOf(selRow.partner_id)}
                  openingFromRpc={Number(selRow.prior_outstanding || 0)}
                  onOpenDetail={() => setDetail({ partnerId: selRow.partner_id, type: selRow.type, focus: "all" })}
                  headLead={
                    <span className="ledger-nav">
                      <button type="button" className="ledger-nav-btn" disabled={selIdx <= 0} onClick={() => gotoIdx(selIdx - 1)} title="이전 거래처 (목록 순서)" aria-label="이전 거래처">‹</button>
                      <button type="button" className="ledger-nav-btn" disabled={selIdx < 0 || selIdx >= shown.length - 1} onClick={() => gotoIdx(selIdx + 1)} title="다음 거래처 (목록 순서)" aria-label="다음 거래처">›</button>
                      {wide && (
                        <span className="relative inline-block">
                          <button type="button" className="btn-secondary btn-sm" onClick={() => setPickOpen((v) => !v)} title="거래처 바꾸기 — 이름·코드로 찾습니다">
                            {nameOf(selRow.partner_id)} <span className="text-[var(--text-dim)]">▾</span>
                          </button>
                          {pickOpen && (
                            <PickList items={pickItems} placeholder="거래처 검색 (이름·코드)" empty="이 조건에 맞는 거래처가 없습니다"
                              onPick={(it) => { setSelLedger(it.id); setPickOpen(false); }} onClose={() => setPickOpen(false)} />
                          )}
                        </span>
                      )}
                    </span>
                  }
                  headTail={
                    <button type="button" className={wide ? "btn-secondary btn-sm ledger-wide-on" : "btn-secondary btn-sm"} onClick={() => { setWide((v) => !v); setPickOpen(false); }}
                      title={wide ? "왼쪽 거래처 목록을 다시 보입니다" : "목록을 접고 원장만 넓게 봅니다"}>↔ {wide ? "목록 보기" : "넓게"}</button>
                  }
                  hideName={wide}
                />
              ) : (
                <EmptyState card icon="📒" title="왼쪽에서 거래처를 고르세요." desc="고른 거래처의 일자별 원장(차변·대변·잔액)이 표시됩니다" />
              )}
              </div>
            </>
          )}
         </div>
          {/* ── 3줄 · 고른 거래처로 하는 일 ── */}
          <SelectionBar count={checkedIds.size} onClear={() => setCheckedIds(new Set())}
            summary={<>거래처마다 시트 하나 · 회계기간 {periodLabel}</>}>
            <button type="button" className="btn-primary btn-sm" disabled={exporting || checkedRows.length === 0} onClick={() => runExport(checkedRows)}>
              {exporting ? "내보내는 중…" : `엑셀 내보내기 (${checkedRows.length})`}
            </button>
          </SelectionBar>
        </QueryBody>
      </QueryScreen>

      {/* 거래처 상세 팝업 (차액 마감 포함) */}
      {detail && companyId && (
        <PartnerDetailModal
          companyId={companyId}
          partnerId={detail.partnerId}
          type={detail.type}
          year={rpcYear}
          partnerName={nameOf(detail.partnerId)}
          focus={detail.focus}
          onClose={() => setDetail(null)}
        />
      )}

    </div>
  );
}
