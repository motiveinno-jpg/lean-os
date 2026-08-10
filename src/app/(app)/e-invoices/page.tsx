"use client";
// 전자계산서(면세) — 세금·증빙 하위 탭 (2026-08-10 사장님: "전자계산서 탭 새로 만들어서 불러와줘").
//   홈택스 전자(세금)계산서 통합 API 를 같은 인증서로 searchType=02(계산서)로 조회해
//   tax_invoices(doc_kind='exempt') 에 저장한다. 동기화 흐름(백그라운드 잡·Realtime·폴링)은
//   현금영수증 화면과 동일 패턴, job_type 만 'exempt_invoice'.
import { todayKst } from "@/lib/kst";
import { logRead } from "@/lib/log-read";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DateField } from "@/components/date-field";
import { friendlyError } from "@/lib/friendly-error";
import { supabase } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/queries";
import { fetchPaged } from "@/lib/fetch-paged";
import { QueryErrorBanner } from "@/components/query-status";
import { useToast } from "@/components/toast";

type Tab = "sales" | "purchase";

const SYNC_STORAGE_KEY = "einvoice-active-job-id";
const TERMINAL = new Set(["completed", "failed", "cancelled"]);

const fmtWon = (n: number) => `₩${Math.round(n).toLocaleString("ko-KR")}`;

export default function EInvoicesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("sales");
  // 기본 조회기간 — 올해 1월 1일 ~ 오늘 (첫 동기화에서 연간 누락 없이 보이게)
  const [startDate, setStartDate] = useState(`${todayKst().slice(0, 4)}-01-01`);
  const [endDate, setEndDate] = useState(todayKst());
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [syncStarting, setSyncStarting] = useState(false);

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

  const rows = useMemo(
    () => (invoices as any[]).filter((i) => i.type === (tab === "sales" ? "sales" : "purchase")),
    [invoices, tab],
  );
  const summary = useMemo(() => {
    const sum = (list: any[]) => list.reduce((s, i) => s + Number(i.supply_amount || 0), 0);
    const sales = (invoices as any[]).filter((i) => i.type === "sales");
    const purchase = (invoices as any[]).filter((i) => i.type === "purchase");
    return { salesCnt: sales.length, salesSum: sum(sales), purchaseCnt: purchase.length, purchaseSum: sum(purchase) };
  }, [invoices]);

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

  // ─── 폴링으로 terminal 감지된 경우 정리 (Realtime 누락 백업) + 30분 hang 자동 해제 ───
  useEffect(() => {
    if (!activeJob || !activeJobId) return;
    if (TERMINAL.has((activeJob as any).status)) {
      setActiveJobId(null);
      queryClient.invalidateQueries({ queryKey: ["e-invoices"] });
      return;
    }
    const upd = (activeJob as any).updated_at ? new Date((activeJob as any).updated_at).getTime() : 0;
    if (upd && Date.now() - upd > 30 * 60 * 1000) {
      (async () => {
        await supabase.from("hometax_sync_jobs").update({ status: "failed", updated_at: new Date().toISOString() })
          .eq("id", activeJobId).in("status", ["pending", "running"]);
        setActiveJobId(null);
        toast("30분간 진척이 없어 동기화를 종료했습니다. 다시 시도하세요.", "info");
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeJob, activeJobId, queryClient]);

  // ─── 동기화 시작 (현금영수증과 동일 흐름, jobType 만 exempt_invoice) ───
  const startSync = async () => {
    if (!companyId || syncStarting || activeJobId) return;
    if (startDate > endDate) { toast("시작일이 종료일보다 이전이어야 합니다", "error"); return; }
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
        setActiveJobId(result.activeJobId);
        toast(`이미 진행 중인 홈택스 동기화가 있습니다 (${result.progress?.label || "진행 중"}) — 세금계산서와 전자계산서는 같은 인증서라 동시에 못 돌립니다.`, "info");
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

  return (
    <div className="einvoices-page">
      <QueryErrorBanner error={mainError as any} onRetry={() => mainRefetch()} />

      {/* 안내 + 기간 + 동기화 */}
      <div className="einvoices-toolbar glass-card">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-[var(--text)]">전자계산서 (면세)</div>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            부가세 면세 거래의 전자계산서를 홈택스에서 불러옵니다. 세금계산서와 같은 공동인증서를 사용합니다.
          </p>
        </div>
        <div className="einvoices-toolbar-controls">
          <DateField value={startDate} max={endDate || undefined} onChange={(e) => setStartDate(e.target.value)} className="einvoices-date-input" aria-label="조회 시작일" />
          <span className="text-[var(--text-dim)]">~</span>
          <DateField value={endDate} min={startDate || undefined} onChange={(e) => setEndDate(e.target.value)} className="einvoices-date-input" aria-label="조회 종료일" />
          <button onClick={startSync} disabled={syncStarting || !!activeJobId} className="btn-primary btn-sm shrink-0">
            {activeJobId
              ? `가져오는 중 ${progress?.done || 0}/${progress?.total || 0}`
              : syncStarting ? "시작 중..." : "홈택스에서 가져오기"}
          </button>
        </div>
      </div>

      {/* 요약 + 매출/매입 탭 */}
      <div className="einvoices-summary-row">
        <button onClick={() => setTab("sales")} className={`einvoices-summary-chip ${tab === "sales" ? "einvoices-chip-active" : ""}`}>
          <span className="text-xs font-semibold">매출 계산서</span>
          <span className="text-sm font-black tabular-nums">{summary.salesCnt}건 · {fmtWon(summary.salesSum)}</span>
        </button>
        <button onClick={() => setTab("purchase")} className={`einvoices-summary-chip ${tab === "purchase" ? "einvoices-chip-active" : ""}`}>
          <span className="text-xs font-semibold">매입 계산서</span>
          <span className="text-sm font-black tabular-nums">{summary.purchaseCnt}건 · {fmtWon(summary.purchaseSum)}</span>
        </button>
      </div>

      {/* 목록 */}
      <div className="glass-card overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-[var(--text-muted)]">불러오는 중...</div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center">
            <div className="text-sm font-semibold text-[var(--text)] mb-1">
              {tab === "sales" ? "매출" : "매입"} 전자계산서가 없습니다
            </div>
            <p className="text-xs text-[var(--text-muted)]">
              기간을 조정하거나 <b>홈택스에서 가져오기</b>를 눌러 동기화하세요. 면세 거래가 없는 회사는 비어있는 게 정상입니다.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="einvoices-table">
              <thead>
                <tr>
                  <th>작성일</th>
                  <th>거래처</th>
                  <th>사업자번호</th>
                  <th>품목</th>
                  <th className="text-right">공급가액</th>
                  <th className="text-right">합계</th>
                  <th>승인번호</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((inv: any) => (
                  <tr key={inv.id}>
                    <td className="whitespace-nowrap">{inv.issue_date}</td>
                    <td className="font-medium text-[var(--text)]">{inv.counterparty_name || "-"}</td>
                    <td className="whitespace-nowrap">{inv.counterparty_bizno || "-"}</td>
                    <td className="max-w-[220px] truncate" title={inv.item_name || ""}>{inv.item_name || "-"}</td>
                    <td className="text-right tabular-nums">{fmtWon(Number(inv.supply_amount || 0))}</td>
                    <td className="text-right tabular-nums font-semibold text-[var(--text)]">{fmtWon(Number(inv.total_amount || inv.supply_amount || 0))}</td>
                    <td className="whitespace-nowrap text-[var(--text-dim)]">{inv.nts_confirm_no || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
