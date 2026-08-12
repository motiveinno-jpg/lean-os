"use client";
// 전자계산서(면세) — 세금·증빙 하위 탭 (2026-08-10 사장님).
//   2026-08-11 사장님: "디자인을 세금계산서 탭과 아예 똑같게" — 세금계산서 화면의 디자인 언어를
//   그대로 사용: seg-bar 매출/매입 탭 + 오른쪽 [조회기간 팝오버][가져오기 팝오버] 한 줄 머리,
//   doc-summary-strip 요약, 홈택스식 결과 요약 바 + tax-invoice-list-table 격자 그리드.
//   발행·매칭·전표는 세금계산서 전용 기능이라 없음(계산서는 조회·수집 전용).
//   수집: 같은 홈택스 통합 API, inquiryType 03(전자계산서) — tax_invoices(doc_kind='exempt').
import { SortableTh, nextSort, cmp, type SortState } from "@/components/sortable-th";
import { todayKst } from "@/lib/kst";
import { Ico } from "@/components/ui-icon";
import { logRead } from "@/lib/log-read";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DateRangeField } from "@/components/date-range-field";
import { friendlyError } from "@/lib/friendly-error";
import { supabase } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/queries";
import { fetchPaged } from "@/lib/fetch-paged";
import { QueryErrorBanner } from "@/components/query-status";
import { ToolbarPopover, ToolbarPopoverItem } from "@/components/toolbar-popover";
import { useToast } from "@/components/toast";

type Tab = "sales" | "purchase";

const SYNC_STORAGE_KEY = "einvoice-active-job-id";
const TERMINAL = new Set(["completed", "failed", "cancelled"]);

const fmt = (n: number) => `₩${Math.round(n).toLocaleString("ko")}`;
const getCurrentMonth = () => todayKst().slice(0, 7);

// 월 문자열(YYYY-MM) → 그 달 마지막 날짜(YYYY-MM-DD), 오늘 넘으면 오늘로 cap
function monthEndDate(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  const end = `${month}-${String(last).padStart(2, "0")}`;
  const today = todayKst();
  return end > today ? today : end;
}

/** 전자세금계산서 목록 정렬 열쇠 — 칸 하나에 하나씩 (2026-08-12) */
type EiSortKey = "issue_date" | "counterparty_name" | "item_name" | "supply_amount" | "tax_amount" | "total" | "status";

export default function EInvoicesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("sales");
  // 조회기간 — 세금계산서 화면과 같은 월 범위 방식. 기본: 올해 1월 ~ 이번 달.
  const [viewFromMonth, setViewFromMonth] = useState(`${todayKst().slice(0, 4)}-01`);
  const [viewToMonth, setViewToMonth] = useState(getCurrentMonth());
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
          queryClient.invalidateQueries({ queryKey: ["e-invoices"] });
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
      queryClient.invalidateQueries({ queryKey: ["e-invoices"] });
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
    queryClient.invalidateQueries({ queryKey: ["e-invoices"] });
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
    <div className="" data-print-area>
      <QueryErrorBanner error={mainError as Error | null} onRetry={() => mainRefetch()} />

      {/* 한 줄짜리 머리 — [탭] ·········· [기간 ▾] [가져오기 ▾]  (세금계산서 화면과 동일 구성) */}
      <div className="tax-invoice-tabs no-print">
        <div className="seg-bar flex-wrap">
          {[
            { key: "sales" as const, label: "매출", count: salesInvoices.length },
            { key: "purchase" as const, label: "매입", count: purchaseInvoices.length },
          ].map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)} className={`seg-item ${tab === t.key ? "seg-item-active" : ""}`}>
              {t.label}<span className="text-xs opacity-70 ml-1">({t.count})</span>
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-1.5 flex-wrap">
          {/* 조회기간 — 세금계산서와 같은 위젯(월 단위). 두 화면이 짝이라 같이 움직인다 (2026-08-11) */}
          <DateRangeField
            unit="month"
            from={viewFromMonth}
            to={viewToMonth}
            onChange={(f, t) => { setViewFromMonth(f); setViewToMonth(t); }}
          />

          {/* 가져오기 — 세금계산서 화면과 동일한 접힌 메뉴 */}
          <ToolbarPopover label="가져오기" title="가져오기" width={232}>
            {(close) => (
              <>
                <ToolbarPopoverItem
                  onClick={() => { close(); startSync(); }}
                  disabled={!!activeJobId || syncStarting}
                  hint={`조회기간(${viewFromMonth} ~ ${viewToMonth}) 범위로 홈택스에 발행·수취된 전자계산서(면세)를 가져옵니다`}>
                  <span aria-live="polite">
                    {activeJobId
                      ? `가져오는 중 ${progress?.done || 0}/${progress?.total || 0}`
                      : "홈택스에서 가져오기"}
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
        </div>
      </div>

      {/* 요약 스트립 — 세금계산서 화면과 동일. 계산서는 면세라 부가세 셀 대신 합산 공급가액 */}
      <div className="doc-summary-strip" data-print-area>
        <div className="doc-summary-cell">
          <span>매출 {salesInvoices.length.toLocaleString()}건</span>
          <b>{fmt(totalSales)}</b>
        </div>
        <div className="doc-summary-cell">
          <span>매입 {purchaseInvoices.length.toLocaleString()}건</span>
          <b>{fmt(totalPurchase)}</b>
        </div>
        <div className="doc-summary-cell" title="전자계산서는 면세 거래라 부가세가 없습니다">
          <span>면세 공급가액 합계</span>
          <b>{fmt(totalSales + totalPurchase)}</b>
        </div>
      </div>

      {/* 목록 — 세금계산서와 동일한 홈택스식 격자 그리드 */}
      <div className="tax-invoice-list-card glass-card">
        {isLoading ? (
          <div className="p-16 text-center text-sm text-[var(--text-muted)]">불러오는 중...</div>
        ) : currentList.length === 0 ? (
          <div className="py-16 px-6 text-center">
            <div className="empty-state-icon mx-auto"><Ico e="🧾" /></div>
            <div className="text-base font-semibold text-[var(--text)]">
              {tab === "sales" ? "매출" : "매입"} 전자계산서가 없습니다
            </div>
            <div className="text-xs text-[var(--text-muted)] mt-1.5">
              면세 거래의 계산서는 홈택스에서 불러올 수 있습니다 · 면세 거래가 없으면 비어있는 게 정상입니다
            </div>
            <button onClick={startSync} disabled={!!activeJobId || syncStarting} className="no-print mt-5 btn-primary">
              {activeJobId ? `가져오는 중 ${progress?.done || 0}/${progress?.total || 0}` : "홈택스에서 가져오기"}
            </button>
          </div>
        ) : (
          <div>
            {/* 홈택스식 결과 요약 바 — 총 N건 · 공급가액/세액/합계 합산 (세금계산서와 동일) */}
            <div className="px-4 py-2.5 border-b border-[var(--border)] bg-[var(--bg-surface)] flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
              <span className="font-bold text-[var(--text)]">총 {currentList.length}건</span>
              <span className="text-[var(--text-muted)]">공급가액 <b className="text-[var(--text)] mono-number">₩{currentList.reduce((s: number, inv: any) => s + Number(inv.supply_amount || 0), 0).toLocaleString("ko")}</b></span>
              <span className="text-[var(--text-muted)]">세액 <b className="text-[var(--text)] mono-number">₩{currentList.reduce((s: number, inv: any) => s + Number(inv.tax_amount || 0), 0).toLocaleString("ko")}</b></span>
              <span className="text-[var(--text-muted)]">합계금액 <b className="mono-number text-[var(--primary)]">₩{currentList.reduce((s: number, inv: any) => s + Number(inv.total_amount || 0), 0).toLocaleString("ko")}</b></span>
              <span className="ml-auto text-[10px] text-[var(--text-dim)]">면세 계산서는 세액이 0원입니다</span>
            </div>
            <div className="overflow-auto max-h-[600px]">
              <table className="tax-invoice-list-table">
                <thead className="sticky top-0 z-10">
                  <tr className="text-xs text-[var(--text-dim)] bg-[var(--bg-card)] border-b border-[var(--border)]">
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
                  {currentList.map((inv: any) => (
                    <tr key={inv.id} className="tax-invoice-row" title={inv.nts_confirm_no ? `국세청 승인번호 ${inv.nts_confirm_no}` : undefined}>
                      <td className="px-3 py-2 text-[var(--text-muted)] mono-number whitespace-nowrap">{inv.issue_date}</td>
                      <td className="px-3 py-2 border-l border-[var(--border)]/40 max-w-[200px]">
                        <span className="font-semibold text-[var(--text)] truncate block">{inv.counterparty_name || "-"}</span>
                      </td>
                      <td className="px-3 py-2 text-[var(--text-muted)] border-l border-[var(--border)]/40 whitespace-nowrap overflow-hidden text-ellipsis max-w-[180px]" title={inv.item_name || ""}>
                        {inv.item_name ? String(inv.item_name).replace(/\+/g, " ") : "—"}
                      </td>
                      <td className="px-3 py-2 text-right mono-number text-[var(--text)] border-l border-[var(--border)]/40">{Number(inv.supply_amount || 0).toLocaleString("ko")}</td>
                      <td className="px-3 py-2 text-right mono-number text-[var(--text-muted)] border-l border-[var(--border)]/40">{Number(inv.tax_amount || 0).toLocaleString("ko")}</td>
                      <td className="px-3 py-2 text-right mono-number font-semibold text-[var(--text)] border-l border-[var(--border)]/40">{Number(inv.total_amount || inv.supply_amount || 0).toLocaleString("ko")}</td>
                      <td className="px-3 py-2 text-center border-l border-[var(--border)]/40">
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap bg-emerald-500/10 text-emerald-500">발행</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
