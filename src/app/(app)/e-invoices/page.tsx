"use client";
// 전자계산서(면세) — 세금·증빙 하위 탭 (2026-08-10 사장님).
//   2026-08-11 사장님: "디자인을 세금계산서 탭과 아예 똑같게" — 세금계산서 화면의 디자인 언어를
//   그대로 사용: seg-bar 매출/매입 탭 + 오른쪽 [조회기간 팝오버][가져오기 팝오버] 한 줄 머리,
//   doc-summary-strip 요약, 홈택스식 결과 요약 바 + tax-invoice-list-table 격자 그리드.
//   발행·매칭·전표는 세금계산서 전용 기능이라 없음(계산서는 조회·수집 전용).
//   수집: 같은 홈택스 통합 API, inquiryType 03(전자계산서) — tax_invoices(doc_kind='exempt').
import { SortableTh, nextSort, cmp, type SortState } from "@/components/sortable-th";
import { todayKst } from "@/lib/kst";
import { logRead } from "@/lib/log-read";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DateRangeField } from "@/components/date-range-field";
import { friendlyError } from "@/lib/friendly-error";
import { supabase } from "@/lib/supabase";
import { invalidateTaxInvoiceReaders } from "@/lib/tax-invoice-invalidate";
import { getCurrentUser } from "@/lib/queries";
import { fetchPaged } from "@/lib/fetch-paged";
import { QueryErrorBanner } from "@/components/query-status";
import { ToolbarPopover, ToolbarPopoverItem } from "@/components/toolbar-popover";
import { useToast } from "@/components/toast";
import {
  QueryScreen, QueryHead, QueryBody, QueryBar, ResultStrip, Stat, ExcelMenu, SavedTabs, ConditionSave,
  ConditionPanel, ConditionRow, TokenField, AmountRange, AppliedChips, QuickSearch, quickSearchHit,
  quickTerms, amountHit, RowsPerPage, Pager, usePager, useSavedQueries,
  defaultRangeMonth, periodQuicksMonth, type ExcelItem, type AppliedChip,
} from "@/components/query-kit";
import { exportToExcel } from "@/lib/excel-export";

type Tab = "sales" | "purchase";

const SYNC_STORAGE_KEY = "einvoice-active-job-id";
const TERMINAL = new Set(["completed", "failed", "cancelled"]);

const fmt = (n: number) => `₩${Math.round(n).toLocaleString("ko")}`;

// 월 문자열(YYYY-MM) → 그 달 마지막 날짜(YYYY-MM-DD), 오늘 넘으면 오늘로 cap
function monthEndDate(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  const end = `${month}-${String(last).padStart(2, "0")}`;
  const today = todayKst();
  return end > today ? today : end;
}

/**
 * 검색조건 — 갖춰서 찾는 값들 (2026-08-13 조회 화면 표준).
 *   ★ 여기 있는 것은 '조회'를 눌러야 반영된다. 기간·빠른검색은 조회 줄에 있어 즉시다.
 */
type Cond = { partner: string[]; item: string; min: string; max: string; size: number };
const EMPTY: Cond = { partner: [], item: "", min: "", max: "", size: 50 };
const condCount = (c: Cond) => c.partner.length + (c.item ? 1 : 0) + ((c.min || c.max) ? 1 : 0);

/** 전자세금계산서 목록 정렬 열쇠 — 칸 하나에 하나씩 (2026-08-12) */
type EiSortKey = "issue_date" | "counterparty_name" | "item_name" | "supply_amount" | "tax_amount" | "total" | "status";

export default function EInvoicesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("sales");
  //   조회기간 — 월 단위. 기본은 **지난달 ~ 이번 달** (2026-08-13 조회 화면 표준).
  //   ★ 조회값은 기억하지 않는다 — 나갔다 오면 기본값. 편의는 '내 조건'(★)이 맡는다.
  const [viewFromMonth, setViewFromMonth] = useState(() => defaultRangeMonth().from);
  const [viewToMonth, setViewToMonth] = useState(() => defaultRangeMonth().to);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [syncStarting, setSyncStarting] = useState(false);

  const startDate = `${viewFromMonth}-01`;
  const endDate = monthEndDate(viewToMonth);

  useEffect(() => {
    getCurrentUser().then((u) => setCompanyId(u?.company_id ?? null));
    try { const j = localStorage.getItem(SYNC_STORAGE_KEY); if (j) setActiveJobId(j); } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    try {
      if (activeJobId) localStorage.setItem(SYNC_STORAGE_KEY, activeJobId);
      else localStorage.removeItem(SYNC_STORAGE_KEY);
    } catch { /* ignore */ }
  }, [activeJobId]);

  // ─── 목록 ───
  const { data: invoices = [], isLoading, error: mainError, refetch: mainRefetch } = useQuery({
    queryKey: ["e-invoices", companyId, startDate, endDate],
    queryFn: async () => {
      return fetchPaged("eInvoices.list", () => supabase
        .from("tax_invoices")
        .select("*")
        .eq("company_id", companyId!)
        .eq("doc_kind", "exempt")
        .gte("issue_date", startDate)
        .lte("issue_date", endDate)
        .order("issue_date", { ascending: false })
        .order("id", { ascending: false }), 10000);
    },
    enabled: !!companyId,
  });

  const salesInvoices = useMemo(() => (invoices as any[]).filter((i) => i.type === "sales"), [invoices]);
  const purchaseInvoices = useMemo(() => (invoices as any[]).filter((i) => i.type === "purchase"), [invoices]);
  const listBase = tab === "sales" ? salesInvoices : purchaseInvoices;
  //   머리단 정렬 — 앱 전 메뉴 같은 규칙 (2026-08-12 사장님 지시). 기본은 작성일자 내림차순.
  const [sort, setSort] = useState<SortState<EiSortKey>>({ key: "issue_date", dir: "desc" });
  const onSort = (k: EiSortKey) => setSort((c) => nextSort(c, k, k === "issue_date" ? "desc" : "asc"));
  const currentList = useMemo(() => {
    const val = (r: any) => {
      switch (sort.key) {
        case "counterparty_name": return r.counterparty_name ?? "";
        case "item_name":         return r.item_name ?? "";
        case "supply_amount":     return Number(r.supply_amount || 0);
        case "tax_amount":        return Number(r.tax_amount || 0);
        case "total":             return Number(r.supply_amount || 0) + Number(r.tax_amount || 0);
        case "status":            return r.status ?? "";
        default:                  return r.issue_date ?? "";
      }
    };
    const arr = [...(listBase as any[])];
    arr.sort((a, b) => {
      const c = cmp(val(a), val(b));
      //   같은 값이면 늘 작성일자로 갈라 순서가 흔들리지 않게 한다
      return (sort.dir === "asc" ? c : -c) || String(a.issue_date ?? "").localeCompare(String(b.issue_date ?? ""));
    });
    return arr;
  }, [listBase, sort]);
  //   ── 조회 화면 표준 (2026-08-13 CLAUDE.md 「조회 화면 표준」) ──────────────
  //   수집·전표에서 확정한 뼈대를 그대로 가져온다. 새로 만들지 않는다.
  const [q, setQ] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [draft, setDraft] = useState<Cond>(EMPTY);
  const [live, setLive] = useState<Cond>(EMPTY);
  const setD = <K extends keyof Cond>(k: K) => (v: Cond[K]) => setDraft((c) => ({ ...c, [k]: v }));

  //   고를 수 있는 값들 — **이 기간에 실제로 나온 것만** (고르고도 0건이면 헷갈린다)
  const partnerOpts = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of (listBase as any[])) {
      const n = r.counterparty_name || "";
      if (n && !m.has(n)) m.set(n, r.counterparty_bizno || "");
    }
    return [...m].sort((x, y) => x[0].localeCompare(y[0], "ko")).map(([v, sub]) => ({ value: v, label: v, sub }));
  }, [listBase]);

  const filtered = useMemo(() => (currentList as any[]).filter((r) => {
    const total = Number(r.total_amount || r.supply_amount || 0);
    if (!quickSearchHit(q, [r.counterparty_name, r.counterparty_bizno, r.item_name], [total])) return false;
    if (live.partner.length && !live.partner.includes(r.counterparty_name || "")) return false;
    if (live.item && !String(r.item_name || "").toLowerCase().includes(live.item.toLowerCase())) return false;
    if (!amountHit(total, live.min, live.max)) return false;
    return true;
  }), [currentList, q, live]);

  const pager = usePager(filtered, live.size, `${tab}|${startDate}|${endDate}|${q}|${JSON.stringify(live)}`);

  //   내 조건 — ★ 하나가 이 화면의 기본값 (DB 라 PC 를 바꿔도 따라온다)
  const saved = useSavedQueries("e-invoices", companyId);
  const paramsNow = { from: viewFromMonth, to: viewToMonth, q, cond: live };
  const paramsBasic = { ...defaultRangeMonth(), q: "", cond: EMPTY };
  const applySaved = (p: Record<string, unknown>) => {
    if (typeof p.from === "string" && typeof p.to === "string") { setViewFromMonth(p.from); setViewToMonth(p.to); }
    if (typeof p.q === "string") setQ(p.q);
    const c = { ...EMPTY, ...(p.cond as Partial<Cond> | undefined) };
    setDraft(c); setLive(c);
  };
  const [defDone, setDefDone] = useState(false);
  useEffect(() => {
    if (defDone || !saved.isFetched) return;
    setDefDone(true);
    if (saved.def) applySaved(saved.def.params || {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved.isFetched, saved.def, defDone]);
  const suggestName = () => {
    const p: string[] = [];
    if (draft.partner.length) p.push(draft.partner[0] + (draft.partner.length > 1 ? ` 외 ${draft.partner.length - 1}` : ""));
    if (draft.item) p.push(draft.item);
    if (draft.min || draft.max) p.push("금액");
    p.push(tab === "sales" ? "매출" : "매입");
    return p.slice(0, 3).join(" · ") || "내 조건";
  };

  //   '조회'를 누르기 전에 몇 건 나올지만 미리 알려 준다
  const previewCount = useMemo(() => (currentList as any[]).filter((r) => {
    const total = Number(r.total_amount || r.supply_amount || 0);
    if (!quickSearchHit(q, [r.counterparty_name, r.counterparty_bizno, r.item_name], [total])) return false;
    if (draft.partner.length && !draft.partner.includes(r.counterparty_name || "")) return false;
    if (draft.item && !String(r.item_name || "").toLowerCase().includes(draft.item.toLowerCase())) return false;
    if (!amountHit(total, draft.min, draft.max)) return false;
    return true;
  }).length, [currentList, q, draft]);

  //   걸린 조건 — 조회 줄에 칩으로 남는다
  const drop = (patch: Partial<Cond>) => { const c = { ...live, ...patch }; setLive(c); setDraft(c); };
  const chips: AppliedChip[] = [
    ...quickTerms(q).map((t, i) => ({
      group: "빠른검색", label: t,
      onRemove: () => setQ(quickTerms(q).filter((_, j) => j !== i).join(", ")),
    })),
    ...live.partner.map((v) => ({ group: "거래처", label: v, onRemove: () => drop({ partner: live.partner.filter((x) => x !== v) }) })),
    ...(live.item ? [{ group: "품목", label: live.item, onRemove: () => drop({ item: "" }) }] : []),
    ...((live.min || live.max) ? [{
      group: "금액", label: `${Number(live.min || 0).toLocaleString("ko")} ~ ${live.max ? Number(live.max).toLocaleString("ko") : "제한없음"}`,
      onRemove: () => drop({ min: "", max: "" }),
    }] : []),
  ];

  //   엑셀 — 지금 조건 그대로, 표에 보이는 칸 그대로
  const xlsRows = (list: any[]) => list.map((r) => ({
    "작성일자": r.issue_date,
    "구분": tab === "sales" ? "매출" : "매입",
    "상호(거래처)": r.counterparty_name || "",
    "사업자등록번호": r.counterparty_bizno || "",
    "품목": r.item_name ? String(r.item_name).replace(/\+/g, " ") : "",
    "공급가액": Number(r.supply_amount || 0),
    "세액": Number(r.tax_amount || 0),
    "합계금액": Number(r.total_amount || r.supply_amount || 0),
    "국세청 승인번호": r.nts_confirm_no || "",
  }));
  const download = (list: any[], tag: string) =>
    exportToExcel(xlsRows(list), "전자계산서", `전자계산서_${viewFromMonth}~${viewToMonth}${tag}`);
  const excelItems: ExcelItem[] = [
    { label: "조회 결과 전부 내려받기", count: filtered.length,
      hint: "지금 걸린 조건 그대로 · 표에 보이는 칸 그대로", onClick: () => download(filtered, "") },
    { label: "지금 쪽만 내려받기", count: pager.view.length,
      hint: `${pager.from}–${pager.to}번째 줄만`, onClick: () => download(pager.view, `_${pager.page}쪽`) },
  ];

  const totalSales = salesInvoices.reduce((s, i) => s + Number(i.supply_amount || 0), 0);
  const totalPurchase = purchaseInvoices.reduce((s, i) => s + Number(i.supply_amount || 0), 0);

  // ─── mount 시 진행 중 job 감지 ───
  useEffect(() => {
    if (!companyId || activeJobId) return;
    (async () => {
      const data = logRead('e-invoices/page:data', await supabase
        .from("hometax_sync_jobs")
        .select("id, status, updated_at")
        .eq("company_id", companyId ?? "")
        .eq("job_type", "exempt_invoice")
        .in("status", ["pending", "running"])
        .gt("updated_at", new Date(Date.now() - 30 * 60 * 1000).toISOString())
        .order("created_at", { ascending: false })
        .limit(1));
      if (data && data[0]) setActiveJobId(data[0].id);
    })();
  }, [companyId, activeJobId]);

  // ─── active job 폴링 (Realtime 보조) ───
  const { data: activeJob } = useQuery({
    queryKey: ["einvoice-sync-job", activeJobId],
    queryFn: async () => {
      if (!activeJobId) return null;
      const data = logRead('e-invoices/page:data', await supabase
        .from("hometax_sync_jobs")
        .select("*")
        .eq("id", activeJobId)
        .maybeSingle());
      return data;
    },
    enabled: !!activeJobId,
    refetchInterval: activeJobId ? 2000 : false,
  });

  // ─── Realtime 구독 ───
  useEffect(() => {
    if (!activeJobId || !companyId) return;
    const ch = supabase.channel(`einvoice_sync_jobs:${activeJobId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "hometax_sync_jobs", filter: `id=eq.${activeJobId}` }, (payload: any) => {
        queryClient.setQueryData(["einvoice-sync-job", activeJobId], payload.new);
        if (TERMINAL.has(payload.new.status)) {
          setActiveJobId(null);
          invalidateTaxInvoiceReaders(queryClient);   //   전자계산서도 tax_invoices — 원장·요약 일괄 (2026-08-31)
          if (payload.new.status === "completed") {
            const synced = payload.new.total_synced || 0;
            const errs = payload.new.errors || [];
            const errSummary = errs.length > 0 ? ` (오류 ${errs.length}건: ${errs[0]?.hint || errs[0]?.message || ""})` : "";
            if (synced === 0 && errs.length === 0) {
              toast("동기화 완료 — 해당 기간에 발행·수취한 전자계산서(면세)가 없습니다.", "info");
            } else {
              toast(`전자계산서 ${synced}건 동기화${errSummary}`, synced > 0 ? "success" : "info");
            }
          } else {
            const e = payload.new.errors?.[0];
            toast(`동기화 실패: ${e?.hint || friendlyError(e, "알 수 없는 오류")}`, "error");
          }
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [activeJobId, companyId, queryClient, toast]);

  // ─── 폴링으로 terminal 감지 백업 + 30분 hang 자동 해제 ───
  useEffect(() => {
    if (!activeJob || !activeJobId) return;
    if (TERMINAL.has((activeJob as any).status)) {
      setActiveJobId(null);
      invalidateTaxInvoiceReaders(queryClient);   //   전자계산서도 tax_invoices — 원장·요약 일괄 (2026-08-31)
      return;
    }
    const upd = (activeJob as any).updated_at ? new Date((activeJob as any).updated_at).getTime() : 0;
    if (upd && Date.now() - upd > 30 * 60 * 1000) { void forceClearStuckJob(activeJobId); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeJob, activeJobId, queryClient]);

  const forceClearStuckJob = async (jid: string) => {
    await supabase.from("hometax_sync_jobs").update({ status: "failed", updated_at: new Date().toISOString() })
      .eq("id", jid).in("status", ["pending", "running"]);
    setActiveJobId(null);
    invalidateTaxInvoiceReaders(queryClient);   //   전자계산서도 tax_invoices — 원장·요약 일괄 (2026-08-31)
  };

  // ─── 동기화 시작 (백그라운드 잡, jobType=exempt_invoice) ───
  const startSync = async () => {
    if (!companyId || syncStarting || activeJobId) return;
    const { getHometaxPausedUntil } = await import("@/lib/data-sync");
    const hometaxPaused = await getHometaxPausedUntil(companyId);
    if (hometaxPaused) {
      const t = new Date(hometaxPaused).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
      toast(`홈택스 연동 일시정지 중 (${t}까지) — 세금계산서 화면의 정지 해제 후 다시 시도하세요.`, "info");
      return;
    }
    setSyncStarting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { toast("세션이 만료되었습니다. 다시 로그인하세요.", "error"); return; }
      const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/codef-sync`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session.access_token}` },
        body: JSON.stringify({ companyId, action: "hometax-sync-async", startDate, endDate, jobType: "exempt_invoice" }),
      });
      const result = await res.json();
      if (res.status === 409 && result.activeJobId) {
        // 같은 종류(전자계산서) 잡만 진행표시를 넘겨받는다 — 세금계산서 잡을 넘겨받으면
        //   이 탭이 남의 진행률을 "전자계산서 동기화 중"처럼 보여줘 혼동 (2026-08-11 사장님).
        if (result.activeJobType === "exempt_invoice") setActiveJobId(result.activeJobId);
        toast(result.error || `이미 진행 중인 홈택스 동기화가 있습니다 (${result.progress?.label || "진행 중"})`, "info");
        return;
      }
      if (!res.ok || !result.jobId) { toast(`동기화 시작 실패: ${result.error || "응답 없음"}`, "error"); return; }
      setActiveJobId(result.jobId);
      toast("백그라운드 동기화 시작됨. 페이지 떠나도 됩니다.", "success");
    } catch (err: any) {
      toast(`동기화 실패: ${err.message}`, "error");
    } finally {
      setSyncStarting(false);
    }
  };

  const progress = (activeJob as any)?.current_progress as { done?: number; total?: number; label?: string } | null;

  if (mainError) {
    return <div className="p-6 text-center text-red-400">데이터를 불러올 수 없습니다. 새로고침해 주세요.</div>;
  }

  return (
    <div className="qk-shell" data-print-area>
      <QueryErrorBanner error={mainError as Error | null} onRetry={() => mainRefetch()} />

      {/* ── 조회 화면 표준 — 탭·조회 줄·걸린 조건·결과 요약·표·쪽 넘김을 한 상자에 ── */}
      <QueryScreen>
        <QueryHead>
          <div className="collect-tabs no-print">
            {[
              { key: "sales" as const, label: "매출", count: salesInvoices.length },
              { key: "purchase" as const, label: "매입", count: purchaseInvoices.length },
            ].map((t) => (
              <button key={t.key} type="button" onClick={() => setTab(t.key)}
                className={tab === t.key ? "collect-tab collect-tab-on" : "collect-tab"}>
                {t.label}<span className="collect-tab-cnt">{t.count.toLocaleString()}</span>
              </button>
            ))}
          </div>

          <QueryBar right={<>
            <ExcelMenu items={excelItems} />
            {/* 가져오기 — 조회 조건이 아니라 '실행'이라 오른쪽 무리에 둔다 */}
            <ToolbarPopover label="가져오기" title="가져오기" width={232}>
              {(close) => (
                <>
                  <ToolbarPopoverItem
                    onClick={() => { close(); startSync(); }}
                    disabled={!!activeJobId || syncStarting}
                    hint={`조회기간(${viewFromMonth} ~ ${viewToMonth}) 범위로 홈택스에 발행·수취된 전자계산서(면세)를 가져옵니다`}>
                    <span aria-live="polite">
                      {activeJobId ? `가져오는 중 ${progress?.done || 0}/${progress?.total || 0}` : "홈택스에서 가져오기"}
                    </span>
                  </ToolbarPopoverItem>
                  {activeJobId && (
                    <ToolbarPopoverItem danger onClick={() => { close(); forceClearStuckJob(activeJobId); }}
                      hint="백그라운드 동기화가 멈췄을 때 눌러 초기화 — 다시 시도할 수 있습니다">
                      동기화 취소
                    </ToolbarPopoverItem>
                  )}
                </>
              )}
            </ToolbarPopover>
          </>}>
            {/*   기간을 치는 칸은 화면에 하나뿐. 달력은 검색조건 안에 있고,
                  오른쪽 끝에 '검색조건'이 붙어 한 덩어리로 보인다. */}
            <DateRangeField unit="month" label={null} parts="segments"
              from={viewFromMonth} to={viewToMonth}
              onChange={(f, t) => { setViewFromMonth(f); setViewToMonth(t); }}
              trailing={
                <ConditionPanel open={panelOpen} onOpenChange={setPanelOpen}
                  activeCount={condCount(live)} anchorSel=".drf"
                  tabs={<SavedTabs list={saved.list} current={paramsNow} basic={paramsBasic}
                    onApply={(s) => { applySaved(s.params || {}); setPanelOpen(false); }}
                    onBasic={() => {
                      const b = defaultRangeMonth();
                      setViewFromMonth(b.from); setViewToMonth(b.to);
                      setQ(""); setDraft(EMPTY); setLive(EMPTY);
                    }}
                    onRemove={saved.remove} onSetDefault={saved.setDefault} />}
                  foot={<>
                    <button type="button" className="btn-secondary btn-sm" disabled={condCount(draft) === 0}
                      onClick={() => setDraft({ ...EMPTY, size: draft.size })}>조건 지우기</button>
                    <ConditionSave suggest={suggestName}
                      onSave={(name, asDefault) => {
                        saved.save(name, { from: viewFromMonth, to: viewToMonth, q, cond: draft }, asDefault);
                        setLive(draft); setPanelOpen(false);
                      }} />
                    <span className="ml-auto text-[11px] text-[var(--text-dim)]">{previewCount.toLocaleString("ko")}건</span>
                    <RowsPerPage value={draft.size} onChange={setD("size")} />
                    <button type="button" className="btn-primary btn-sm"
                      onClick={() => { setLive(draft); setPanelOpen(false); }}>조회</button>
                  </>}>
                  <ConditionRow label="조회기간" hint="월 단위">
                    <span className="qk-range-txt">{viewFromMonth} ~ {viewToMonth}</span>
                    <DateRangeField unit="month" label={null} parts="calendar" confirm
                      from={viewFromMonth} to={viewToMonth}
                      onChange={(f, t) => { setViewFromMonth(f); setViewToMonth(t); }} />
                    <span className="qk-quicks">
                      {periodQuicksMonth().map((p) => (
                        <button key={p.key} type="button"
                          onClick={() => { setViewFromMonth(p.from); setViewToMonth(p.to); }}
                          className={viewFromMonth === p.from && viewToMonth === p.to ? "qk-quick qk-quick-on" : "qk-quick"}>
                          {p.label}
                        </button>
                      ))}
                    </span>
                  </ConditionRow>

                  <ConditionRow label="거래처" hint="여러 곳">
                    <TokenField items={partnerOpts} value={draft.partner} onChange={setD("partner")}
                      placeholder="거래처 이름 일부 (예: 모티)" />
                  </ConditionRow>

                  <ConditionRow label="품목">
                    <input className="qk-input w-full" value={draft.item} placeholder="예: 임대료"
                      onChange={(e) => setD("item")(e.target.value)} />
                  </ConditionRow>

                  <ConditionRow label="합계 금액" hint="한쪽만 적어도 됩니다">
                    <AmountRange min={draft.min} max={draft.max} onMin={setD("min")} onMax={setD("max")} />
                  </ConditionRow>
                </ConditionPanel>
              } />

            <QuickSearch value={q} onApply={setQ}
              placeholder="거래처 · 품목 · 금액 — 쉼표로 여러 개, Enter" />
          </QueryBar>

          <AppliedChips chips={chips} onClearAll={() => { setQ(""); setLive(EMPTY); setDraft(EMPTY); }} />

          <ResultStrip>
            <Stat label="건수" value={`${filtered.length.toLocaleString("ko")}건`} />
            <Stat label="공급가액" value={fmt(filtered.reduce((s: number, r: any) => s + Number(r.supply_amount || 0), 0))} />
            <Stat label="세액" value={fmt(filtered.reduce((s: number, r: any) => s + Number(r.tax_amount || 0), 0))} />
            <Stat label="합계" value={fmt(filtered.reduce((s: number, r: any) => s + Number(r.total_amount || r.supply_amount || 0), 0))} />
            <span className="text-[10.5px] text-[var(--text-dim)]">면세 계산서는 세액이 0원입니다</span>
          </ResultStrip>
        </QueryHead>

        <QueryBody>
          {isLoading ? (
            <div className="collect-empty">불러오는 중…</div>
          ) : filtered.length === 0 ? (
            <div className="collect-empty">
              {(currentList as any[]).length === 0
                ? `${tab === "sales" ? "매출" : "매입"} 전자계산서가 없습니다 — 면세 거래가 없으면 비어있는 게 정상입니다`
                : "이 조건에 맞는 계산서가 없습니다 — 조건을 넓혀 보세요"}
            </div>
          ) : (
            <div className="ev-scroll">
              <table className="ev-table ei-table">
                <thead>
                  <tr>
                    <SortableTh label="작성일자" sortKey="issue_date" sort={sort} onSort={onSort} />
                    <SortableTh label="상호(거래처)" sortKey="counterparty_name" sort={sort} onSort={onSort} />
                    <SortableTh label="품목" sortKey="item_name" sort={sort} onSort={onSort} />
                    <SortableTh label="공급가액" sortKey="supply_amount" sort={sort} onSort={onSort} />
                    <SortableTh label="세액" sortKey="tax_amount" sort={sort} onSort={onSort} />
                    <SortableTh label="합계금액" sortKey="total" sort={sort} onSort={onSort} />
                    <SortableTh label="상태" sortKey="status" sort={sort} onSort={onSort} />
                  </tr>
                </thead>
                <tbody>
                  {pager.view.map((inv: any) => (
                    <tr key={inv.id} title={inv.nts_confirm_no ? `국세청 승인번호 ${inv.nts_confirm_no}` : undefined}>
                      <td className="tc mono-number ev-dim">{inv.issue_date}</td>
                      <td className="ev-ell">{inv.counterparty_name || "—"}</td>
                      <td className="ev-ell ev-dim" title={inv.item_name || ""}>
                        {inv.item_name ? String(inv.item_name).replace(/\+/g, " ") : "—"}
                      </td>
                      <td className="tr mono-number">{Number(inv.supply_amount || 0).toLocaleString("ko")}</td>
                      <td className="tr mono-number ev-dim">{Number(inv.tax_amount || 0).toLocaleString("ko")}</td>
                      <td className="tr mono-number ev-total">{Number(inv.total_amount || inv.supply_amount || 0).toLocaleString("ko")}</td>
                      <td className="tc"><span className="collect-pill collect-pill-done">발행</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </QueryBody>

        <Pager page={pager.page} pages={pager.pages} total={filtered.length} size={live.size}
          from={pager.from} to={pager.to} onPage={pager.setPage} />
      </QueryScreen>
    </div>
  );
}
