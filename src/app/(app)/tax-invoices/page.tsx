"use client";

import Link from "next/link";
import { MonthField } from "@/components/month-field";
import { DateField } from "@/components/date-field";
import { useSearchParams } from "next/navigation";
import { friendlyError } from "@/lib/friendly-error";
import { useEffect, useState, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSyncCooldown } from "@/lib/sync-cooldown";
import { getCurrentUser } from "@/lib/queries";
import {
  createTaxInvoice,
  markInvoiceMatched,
  getTaxInvoiceSummary,
  getVATPreview,
  bulkImportTaxInvoices,
  parseHomeTaxExcel,
  syncHomeTaxInvoices,
  modifyTaxInvoice,
  getInvoiceQueue,
  approveQueueItem,
  getHomeTaxSyncLogs,
  INVOICE_TYPES,
  INVOICE_STATUS,
  invoiceStatusMeta,
  issueTaxInvoice,
  registerHometaxIssuer,
} from "@/lib/tax-invoice";
import type { PeriodType } from "@/lib/tax-invoice";
import { getCardDeductionSummary } from "@/lib/card-transactions";
import * as XLSX from "xlsx";
import { QueryErrorBanner } from "@/components/query-status";
import { CurrencyInput } from "@/components/currency-input";
import { useToast } from "@/components/toast";
import { useUser } from "@/components/user-context";
import { AccessDenied } from "@/components/access-denied";
import { useCanAccessTab } from "@/lib/tab-access";
import { generateTaxInvoicePdf } from "@/lib/document-generator";
import type { TaxInvoicePdfParams } from "@/lib/document-generator";
import { SortToolbar } from "@/components/sort-toolbar";

// ── Print Styles ──
const PRINT_STYLE_ID = "tax-invoice-print-style";
function ensurePrintStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById(PRINT_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = PRINT_STYLE_ID;
  style.textContent = `
    @media print {
      body { background: white !important; color: black !important; }
      body * { visibility: hidden; }
      [data-print-area], [data-print-area] * { visibility: visible !important; color: black !important; }
      [data-print-area] {
        position: fixed !important;
        left: 0 !important;
        top: 0 !important;
        width: 100% !important;
        z-index: 99999 !important;
        background: #fff !important;
        color: #000 !important;
        padding: 10mm !important;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      nav, .sidebar, .no-print, button { display: none !important; }
      .fixed:not(:has([data-print-area])), [class*="backdrop"]:not(:has([data-print-area])) { display: none !important; }
      .fixed:has([data-print-area]) { position: fixed !important; inset: 0 !important; background: #fff !important; overflow: visible !important; z-index: 99999 !important; }
      .fixed:has([data-print-area]) > div { max-height: none !important; overflow: visible !important; }
      table { border-collapse: collapse; width: 100%; }
      th, td { border: 1px solid #ddd; padding: 4px 8px; }
      .print\\:border-black { border-color: #000 !important; }
      @page { margin: 10mm; }
    }
  `;
  document.head.appendChild(style);
}

// ── Duplicate Invoice Detection ──
interface DuplicateGroup {
  key: string;
  counterpartyName: string;
  amount: number;
  date: string;
  count: number;
  ids: string[];
}

function detectDuplicateInvoices(invoices: any[]): DuplicateGroup[] {
  const groups = new Map<string, { invoices: any[]; count: number }>();
  for (const inv of invoices) {
    const key = `${inv.counterparty_name}|${Number(inv.total_amount)}|${inv.issue_date}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count++;
      existing.invoices.push(inv);
    } else {
      groups.set(key, { count: 1, invoices: [inv] });
    }
  }
  const duplicates: DuplicateGroup[] = [];
  Array.from(groups.entries()).forEach(([key, group]) => {
    if (group.count > 1) {
      const first = group.invoices[0];
      duplicates.push({
        key,
        counterpartyName: first.counterparty_name,
        amount: Number(first.total_amount),
        date: first.issue_date,
        count: group.count,
        ids: group.invoices.map((i: any) => i.id),
      });
    }
  });
  return duplicates;
}

// ── 3-Way Matching Visualization ──
function ThreeWayMatchVisual({ result }: { result: any }) {
  const r = result;
  const hasPO = r.contractAmount > 0;
  const hasPayment = r.receivedAmount > 0;
  const poToInvoice = r.amountMatch;
  const invoiceToPayment = r.paymentMatch;

  return (
    <div className="flex items-center gap-1.5 text-xs">
      {/* PO */}
      <div className={`flex items-center gap-1 px-2 py-1 rounded-lg border ${
        hasPO ? "border-[var(--border)] bg-[var(--bg-surface)]" : "border-dashed border-[var(--border)] opacity-50"
      }`}>
        <span className="font-medium">PO</span>
        {hasPO && <span className="text-[10px] text-[var(--text-muted)]">{fmt(r.contractAmount)}</span>}
      </div>
      {/* Arrow PO -> Invoice */}
      <span className={`text-sm font-bold ${
        !hasPO ? "text-[var(--text-dim)]" : poToInvoice ? "text-green-400" : "text-red-400"
      }`}>
        {!hasPO ? "—" : poToInvoice ? "✓" : "✗"}
      </span>
      {/* Invoice */}
      <div className="flex items-center gap-1 px-2 py-1 rounded-lg border border-[var(--primary)]/30 bg-[var(--primary)]/5">
        <span className="font-medium text-[var(--primary)]">계산서</span>
        <span className="text-[10px] text-[var(--text-muted)]">{fmt(r.invoiceSupplyAmount)}(공급가)</span>
      </div>
      {hasPO && !poToInvoice && (
        <span className="px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-400 text-[9px] font-bold whitespace-nowrap">차액 {fmt(Math.abs(r.contractAmount - r.invoiceSupplyAmount))}</span>
      )}
      {r.suggestedDeal && poToInvoice && (
        <span className="px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-500 text-[9px] font-bold whitespace-nowrap">추천</span>
      )}
      {/* Arrow Invoice -> Payment */}
      <span className={`text-sm font-bold ${
        !hasPayment ? "text-[var(--text-dim)]" : invoiceToPayment ? "text-green-400" : "text-red-400"
      }`}>
        {!hasPayment ? "—" : invoiceToPayment ? "✓" : "✗"}
      </span>
      {/* Payment */}
      <div className={`flex items-center gap-1 px-2 py-1 rounded-lg border ${
        hasPayment ? "border-[var(--border)] bg-[var(--bg-surface)]" : "border-dashed border-[var(--border)] opacity-50"
      }`}>
        <span className="font-medium">결제</span>
        {hasPayment && <span className="text-[10px] text-[var(--text-muted)]">{fmt(r.receivedAmount)}</span>}
      </div>
      {hasPayment && !invoiceToPayment && (
        <span className="px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-400 text-[9px] font-bold whitespace-nowrap">차액 {fmt(Math.abs(r.gap))}</span>
      )}
    </div>
  );
}

// ── Excel export ──
function exportToExcel(invoices: any[], filename: string) {
  const ws = XLSX.utils.json_to_sheet(
    invoices.map((inv) => ({
      거래처: inv.counterparty_name,
      사업자번호: inv.counterparty_bizno || "",
      공급가액: Number(inv.supply_amount),
      세액: Number(inv.tax_amount),
      합계: Number(inv.total_amount),
      발행일: inv.issue_date,
      상태: invoiceStatusMeta(inv.status, inv.type).label,
    }))
  );
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "세금계산서");
  XLSX.writeFile(wb, filename);
}

// ── Helpers ──
function getCurrentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function fmt(n: number) {
  return "₩" + Math.round(n).toLocaleString("ko");
}

// ── 비목 (Expense Categories) ──
const EXPENSE_CATEGORIES = [
  { value: "", label: "선택하세요" },
  { value: "goods", label: "상품매출/매입" },
  { value: "service", label: "용역/서비스" },
  { value: "rent", label: "임대료" },
  { value: "commission", label: "수수료" },
  { value: "advertising", label: "광고선전비" },
  { value: "consumables", label: "소모품비" },
  { value: "transport", label: "운반비" },
  { value: "maintenance", label: "수선유지비" },
  { value: "insurance", label: "보험료" },
  { value: "utilities", label: "수도광열비" },
  { value: "communication", label: "통신비" },
  { value: "travel", label: "여비교통비" },
  { value: "education", label: "교육훈련비" },
  { value: "other", label: "기타" },
];

// ── 수정세금계산서 사유 ──
const MODIFICATION_REASONS = [
  { value: "error_correction", label: "기재사항 착오정정", desc: "필요적 기재사항(공급가액, 세액 등)의 착오 정정" },
  { value: "contract_cancel", label: "계약의 해제", desc: "공급 후 계약이 해제된 경우" },
  { value: "return", label: "환입", desc: "공급한 재화가 환입(반품)된 경우" },
  { value: "price_change", label: "공급가액 변동", desc: "계약 조건 변경 등으로 공급가액이 변동된 경우" },
  { value: "inland_lc", label: "내국신용장 사후개설", desc: "내국신용장이 사후에 개설된 경우" },
  { value: "duplicate", label: "착오에 의한 이중발급", desc: "동일 거래에 대해 이중으로 발급된 경우" },
];

export default function TaxInvoicesPage() {
  const { role } = useUser();
  const { allowed: tabAllowed, loading: tabLoading } = useCanAccessTab("/tax-invoices");
  void role;
  if (tabLoading) return null;
  if (!tabAllowed) {
    return <AccessDenied detail="세금계산서 접근 권한이 없습니다. 관리자/대표에게 권한을 요청하세요." />;
  }
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const hometaxCd = useSyncCooldown(companyId, "hometax");
  // 2026-05-21 사장님 요청: "matching" 탭 통째 제거. ?tab=matching 딥링크는 분석 허브로 리다이렉트(별건 — 우선 sales 폴백).
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<"sales" | "purchase" | "vat" | "summary" | "queue" | "sync">(() => {
    const t = searchParams?.get("tab");
    if (t === "sales" || t === "purchase" || t === "vat" || t === "summary" || t === "queue" || t === "sync") {
      return t;
    }
    return "sales";
  });
  // 보기 범위 — localStorage 에 저장해 새로고침해도 유지. default 는 1년 전 ~ 현재 월.
  const [viewFromMonth, setViewFromMonth] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("tax-invoices-viewFromMonth");
      if (saved) return saved;
    }
    const d = new Date();
    d.setMonth(d.getMonth() - 11);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [viewToMonth, setViewToMonth] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("tax-invoices-viewToMonth");
      if (saved) return saved;
    }
    return getCurrentMonth();
  });
  // 새로고침 후에도 유지
  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem("tax-invoices-viewFromMonth", viewFromMonth);
  }, [viewFromMonth]);
  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem("tax-invoices-viewToMonth", viewToMonth);
  }, [viewToMonth]);
  const [periodType, setPeriodType] = useState<PeriodType>("monthly");
  const [showForm, setShowForm] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<any>(null);
  const [showModifyModal, setShowModifyModal] = useState(false);
  const [modifyTarget, setModifyTarget] = useState<any>(null);
  const [modifyReason, setModifyReason] = useState("");
  const [modifyAmount, setModifyAmount] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{ done: number; total: number; label: string } | null>(null);
  // 동기화 기간 = 상단 조회기간(viewFromMonth~viewToMonth) 공용 — 별도 월 피커 이원화 제거 (기준 통일)
  // Incremental sync 토글 — ON 이면 last_hometax_sync_at - 30일 ~ today 자동 사용 (picker 무시).
  const [incrementalMode, setIncrementalMode] = useState(false);
  // Background sync 토글 — ON 이면 hometax-sync-async 호출 (백그라운드).
  const [backgroundMode, setBackgroundMode] = useState(false);
  // 백그라운드 진행 중인 job ID (Realtime 구독용) — localStorage 와 동기화하여 페이지 무관 chain.
  const [activeJobId, setActiveJobIdRaw] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem("hometax-active-job-id");
  });
  const setActiveJobId = (id: string | null) => {
    setActiveJobIdRaw(id);
    if (typeof window !== "undefined") {
      if (id) localStorage.setItem("hometax-active-job-id", id);
      else localStorage.removeItem("hometax-active-job-id");
    }
  };
  // 월별 동기화 결과 — 완료 후 사용자에게 명확히 표시 (누락 N건 식)
  type MonthSyncResult = { month: string; responseCount: number; synced: number; status: "ok" | "partial" | "error"; errorMsg?: string };
  const [syncResultDetail, setSyncResultDetail] = useState<MonthSyncResult[] | null>(null);

  // sync 헬퍼 — timeout 발생 시 한 번만 반으로 분할 시도 (depth=1 한도).
  // 더 깊은 재귀는 시간만 소비하고 답답 → 거기서도 실패하면 결과 패널의 "재시도" 버튼으로 사용자 결정.
  async function syncRangeWithSplit(
    companyId: string, startYmd: string, endYmd: string, depth = 0,
  ): Promise<{ synced: number; responseCount: number; errors: any[] }> {
    const startISO = `${startYmd.slice(0, 4)}-${startYmd.slice(4, 6)}-${startYmd.slice(6, 8)}`;
    const endISO = `${endYmd.slice(0, 4)}-${endYmd.slice(4, 6)}-${endYmd.slice(6, 8)}`;
    const r = await syncHomeTaxInvoices({ companyId, startDate: startISO, endDate: endISO });
    const timedOut = (r.notes || []).some((n: any) => n.code === "CF-TIMEOUT");
    const startDate = new Date(parseInt(startYmd.slice(0, 4)), parseInt(startYmd.slice(4, 6)) - 1, parseInt(startYmd.slice(6, 8)));
    const endDate = new Date(parseInt(endYmd.slice(0, 4)), parseInt(endYmd.slice(4, 6)) - 1, parseInt(endYmd.slice(6, 8)));
    const days = Math.round((endDate.getTime() - startDate.getTime()) / 86400000) + 1;
    // depth 3 — 1달 → 16일 → 8일 → 4일까지 분할 시도. 매출 130건+ 같은 거래 폭증 방어.
    // 1월 매출 149건 같은 케이스 잡으려면 4일 단위까지 가야 함. 시간 오래 걸리지만 정확성 우선.
    // 4일도 timeout 이면 결과 패널 + 재시도 버튼 (사용자 결정).
    if (timedOut && depth < 3 && days >= 4) {
      const midOffset = Math.floor(days / 2) - 1;
      const mid = new Date(startDate.getTime() + midOffset * 86400000);
      const midNext = new Date(mid.getTime() + 86400000);
      const fmt = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
      const r1 = await syncRangeWithSplit(companyId, startYmd, fmt(mid), depth + 1);
      const r2 = await syncRangeWithSplit(companyId, fmt(midNext), endYmd, depth + 1);
      return {
        synced: r1.synced + r2.synced,
        responseCount: r1.responseCount + r2.responseCount,
        errors: [...r1.errors, ...r2.errors],
      };
    }
    return {
      synced: r.synced || 0,
      responseCount: r.responseCount || 0,
      errors: [...(r.errors || []), ...(timedOut ? r.notes : [])],
    };
  }

  // Background sync 시작 — 즉시 응답 받고 사용자는 페이지 떠나도 됨.
  async function runHometaxSyncBackground(fromMonth: string, toMonth: string) {
    if (!companyId) { toast('회사 정보를 불러올 수 없습니다', 'error'); return; }
    if (!isHometaxConnected) { toast('먼저 설정 > 은행연동에서 홈택스를 연결하세요', 'error'); return; }
    if (fromMonth > toMonth) { toast('시작 월이 종료 월보다 늦을 수 없습니다', 'error'); return; }
    const [fy, fm] = fromMonth.split('-').map(Number);
    const [ty, tm] = toMonth.split('-').map(Number);
    const lastDay = new Date(ty, tm, 0).getDate();
    const startDate = `${fromMonth}-01`;
    const endDate = `${toMonth}-${String(lastDay).padStart(2, '0')}`;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('로그인 필요');
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const res = await fetch(`${supabaseUrl}/functions/v1/codef-sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({ companyId, action: 'hometax-sync-async', startDate, endDate }),
      });
      const result = await res.json();
      if (res.status === 409 && result.activeJobId) {
        setActiveJobId(result.activeJobId);
        toast(`이미 진행 중인 백그라운드 동기화가 있습니다 (${result.progress?.label || '진행 중'}). 완료 후 재시도.`, 'info');
        return;
      }
      if (!res.ok || !result.jobId) throw new Error(result.error || '백그라운드 시작 실패');
      setActiveJobId(result.jobId);
      toast(`백그라운드 동기화 시작됨 (${fromMonth} ~ ${toMonth}). 페이지 떠나도 됩니다.`, 'success');
      // 동기화 범위로 보기 자동 세팅
      setViewFromMonth(fromMonth);
      setViewToMonth(toMonth);
      void fy; void fm;
    } catch (err: any) {
      toast(`백그라운드 동기화 시작 실패: ${err.message}`, 'error');
    }
  }

  // 사용자가 선택한 시작~종료 월 범위로 sequential 동기화. 진행 상황 syncProgress 로 표시.
  // CODEF 가 동시 호출 거부(CF-00016/CF-TIMEOUT) 라 매월/매출/매입 모두 sequential 필수.
  async function runHometaxSync(fromMonth: string, toMonth: string) {
    if (syncing) return;
    if (!isHometaxConnected) { toast('먼저 설정 > 은행연동에서 홈택스를 연결하세요', 'error'); return; }
    if (!companyId) { toast('회사 정보를 불러올 수 없습니다', 'error'); return; }
    if (fromMonth > toMonth) { toast('시작 월이 종료 월보다 늦을 수 없습니다', 'error'); return; }

    const months: string[] = [];
    let cur = new Date(parseInt(fromMonth.slice(0, 4)), parseInt(fromMonth.slice(5, 7)) - 1, 1);
    const endD = new Date(parseInt(toMonth.slice(0, 4)), parseInt(toMonth.slice(5, 7)) - 1, 1);
    while (cur <= endD) {
      months.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`);
      cur.setMonth(cur.getMonth() + 1);
    }

    setSyncing(true);
    setSyncProgress({ done: 0, total: months.length, label: '시작' });
    setSyncResultDetail(null);
    const monthResults: MonthSyncResult[] = [];
    try {
      for (let i = 0; i < months.length; i++) {
        const ml = months[i];
        setSyncProgress({ done: i + 1, total: months.length, label: ml });
        const [my, mm] = ml.split('-').map(Number);
        const lastDay = new Date(my, mm, 0).getDate();
        const startYmd = `${my}${String(mm).padStart(2, '0')}01`;
        const endYmd = `${my}${String(mm).padStart(2, '0')}${String(lastDay).padStart(2, '0')}`;
        try {
          const r = await syncRangeWithSplit(companyId, startYmd, endYmd);
          const responseCount = r.responseCount;
          const hasErrors = r.errors.length > 0;
          const status: "ok" | "partial" | "error" =
            hasErrors && r.synced === 0 ? "error"
            : (hasErrors || responseCount > r.synced) ? "partial"
            : "ok";
          monthResults.push({
            month: ml,
            responseCount,
            synced: r.synced || 0,
            status,
            errorMsg: r.errors[0]?.hint || r.errors[0]?.message,
          });
        } catch (e: any) {
          monthResults.push({ month: ml, responseCount: 0, synced: 0, status: "error", errorMsg: e.message });
        }
      }
      setSyncResultDetail(monthResults);
      const totalSynced = monthResults.reduce((s, m) => s + m.synced, 0);
      const failedMonths = monthResults.filter(m => m.status !== "ok");
      const periodLabel = months.length === 1 ? months[0] : `${months[0]} ~ ${months[months.length - 1]}`;
      if (failedMonths.length === 0) {
        toast(`홈택스 동기화 완료 (${periodLabel}): ${totalSynced}건`, 'success');
      } else if (totalSynced > 0) {
        toast(`부분 동기화: ${totalSynced}건 · ${failedMonths.length}개 월 누락 (아래 결과에서 재시도)`, 'info');
      } else {
        toast(`동기화 실패: ${monthResults[0]?.errorMsg || ''}`, 'error');
      }
      // 보기 범위를 동기화 범위로 자동 세팅 → 사용자가 동기화 직후 그 데이터를 바로 봄
      setViewFromMonth(fromMonth);
      setViewToMonth(toMonth);
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["last-sync-time"] });
      queryClient.invalidateQueries({ queryKey: ["hometax-sync-logs"] });
      queryClient.invalidateQueries({ queryKey: ["invoice-queue"] });
    } finally {
      setSyncing(false);
      setSyncProgress(null);
    }
  }

  // 단일 월만 다시 sync — 결과 패널의 "재시도" 버튼에서 사용.
  async function retryMonthSync(month: string) {
    if (syncing || !companyId) return;
    setSyncing(true);
    setSyncProgress({ done: 1, total: 1, label: month });
    try {
      const [my, mm] = month.split('-').map(Number);
      const lastDay = new Date(my, mm, 0).getDate();
      const startYmd = `${my}${String(mm).padStart(2, '0')}01`;
      const endYmd = `${my}${String(mm).padStart(2, '0')}${String(lastDay).padStart(2, '0')}`;
      const r = await syncRangeWithSplit(companyId, startYmd, endYmd);
      const responseCount = r.responseCount;
      const hasErrors = r.errors.length > 0;
      const status: "ok" | "partial" | "error" =
        hasErrors && r.synced === 0 ? "error"
        : (hasErrors || responseCount > r.synced) ? "partial"
        : "ok";
      setSyncResultDetail((prev) => (prev || []).map((m) =>
        m.month === month ? { month, responseCount, synced: r.synced || 0, status, errorMsg: r.errors[0]?.hint || r.errors[0]?.message } : m
      ));
      if (status === "ok") toast(`${month} 재동기화 완료: ${r.synced}건`, 'success');
      else toast(`${month} 재시도: ${r.synced}건 동기화 (누락 남음)`, 'info');
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["last-sync-time"] });
      queryClient.invalidateQueries({ queryKey: ["hometax-sync-logs"] });
    } catch (e: any) {
      toast(`${month} 재시도 실패: ${e.message}`, 'error');
    } finally {
      setSyncing(false);
      setSyncProgress(null);
    }
  }
  // matchFilter state 는 3-way 매칭 페이지(/reports/three-way-match)로 이전됨 (2026-05-21).
  const [matchDealPopup, setMatchDealPopup] = useState<any>(null);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [expandedDupKey, setExpandedDupKey] = useState<string | null>(null);
  const [dismissedDups, setDismissedDups] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchIssuing, setBatchIssuing] = useState(false);
  // 일괄 전표처리 (post_invoice_voucher) — 매출/매입 방향은 RPC 가 자동 분기.
  const [showBulkVoucher, setShowBulkVoucher] = useState(false);
  const [bulkVoucherAccountId, setBulkVoucherAccountId] = useState("");
  const [bulkVoucherPosting, setBulkVoucherPosting] = useState(false);

  // ── 멀티 등록(다행) 폼 — 한 줄(row)이 세금계산서 1건. [+ 항목 추가]로 행 누적, [등록]에서 일괄 전송 ──
  type FormRow = {
    key: string;
    type: "sales" | "purchase";
    counterpartyName: string;
    counterpartyBizno: string;
    counterpartyBusinessType: string;
    counterpartyBusinessItem: string;
    partnerId: string;
    supplyAmount: string;
    issueDate: string;
    preferredDate: string;
    expenseCategory: string;
    dealId: string;
    purpose: "영수" | "청구";
    itemName: string;
    itemSpec: string;
    itemQty: string;
    itemUnitPrice: string;
  };
  const rowKeyRef = useRef(0);
  const blankRow = (): FormRow => ({
    key: `r${rowKeyRef.current++}`,
    type: "sales",
    counterpartyName: "",
    counterpartyBizno: "",
    counterpartyBusinessType: "",
    counterpartyBusinessItem: "",
    partnerId: "",
    supplyAmount: "",
    issueDate: "",
    preferredDate: "",
    expenseCategory: "",
    dealId: "",
    purpose: "청구",
    itemName: "",
    itemSpec: "",
    itemQty: "1",
    itemUnitPrice: "",
  });
  const [rows, setRows] = useState<FormRow[]>(() => [blankRow()]);
  const [dropdownRowKey, setDropdownRowKey] = useState<string | null>(null);
  const patchRow = (key: string, patch: Partial<FormRow>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const removeRow = (key: string) =>
    setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.key !== key) : [blankRow()]));
  const isRowValid = (r: FormRow) =>
    !!r.counterpartyName.trim() && !!r.supplyAmount && !!r.issueDate && Number(r.supplyAmount) > 0;

  useEffect(() => {
    getCurrentUser().then((u) => {
      if (u) {
        setCompanyId(u.company_id);
        setUserId(u.id);
      }
    });
    ensurePrintStyles();
  }, []);

  // 중복 '중복아님' 처리 영구 유지 — 새로고침 후에도 숨김 유지 (localStorage, 회사별)
  useEffect(() => {
    if (!companyId || typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(`tax-dup-dismissed-${companyId}`);
      if (raw) setDismissedDups(new Set(JSON.parse(raw) as string[]));
    } catch { /* noop */ }
  }, [companyId]);

  // 보기 기간 계산 — viewFromMonth ~ viewToMonth 전체. 단일 월 보고 싶으면 from=to 로 설정.
  const { startDate, endDate } = useMemo(() => {
    const [ty, tm] = viewToMonth.split('-').map(Number);
    const lastDay = new Date(ty, tm, 0).getDate();
    return { startDate: `${viewFromMonth}-01`, endDate: `${viewToMonth}-${String(lastDay).padStart(2, '0')}` };
  }, [viewFromMonth, viewToMonth]);

  // 탭/보기기간 변경 시 선택 초기화
  useEffect(() => { setSelectedIds(new Set()); }, [tab, startDate, endDate]);

  // Fetch all invoices in view range
  const { data: invoices = [], isLoading, error: mainError, refetch: mainRefetch } = useQuery({
    queryKey: ["tax-invoices-full", companyId, startDate, endDate],
    queryFn: async () => {
      const { data } = await supabase
        .from("tax_invoices")
        .select("*, deals(name), label, revenue_schedule_id, partners(business_type, business_item)")
        .eq("company_id", companyId!)
        .gte("issue_date", startDate)
        .lte("issue_date", endDate)
        .order("issue_date", { ascending: false });
      return data || [];
    },
    enabled: !!companyId,
  });

  // Partners for counterparty selection
  const { data: partners = [] } = useQuery({
    queryKey: ["partners-for-invoice", companyId],
    queryFn: async () => {
      const { data } = await supabase
        .from("partners")
        .select("id, name, business_number, contact_email, business_type, business_item")
        .eq("company_id", companyId!)
        .eq("is_active", true)
        .order("name");
      return data || [];
    },
    enabled: !!companyId,
  });

  // 전표처리용 계정과목 (일괄 전표 모달)
  const { data: coaAccounts = [] } = useQuery({
    queryKey: ["tax-invoice-coa-accounts", companyId],
    queryFn: async () => {
      const { data } = await (supabase as any).from("chart_of_accounts").select("id, code, name, account_type").eq("company_id", companyId!).order("code");
      return (data || []) as any[];
    },
    enabled: !!companyId, staleTime: 300_000,
  });

  // Deals for linking
  const { data: dealsForLink = [] } = useQuery({
    queryKey: ["deals-for-invoice", companyId],
    queryFn: async () => {
      const { data } = await supabase
        .from("deals")
        .select("id, name, contract_total")
        .eq("company_id", companyId!)
        .neq("status", "archived")
        .order("name");
      return data || [];
    },
    enabled: !!companyId,
  });

  const filterPartners = (search: string) =>
    partners.filter((p: any) =>
      !search || p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.business_number || "").includes(search)
    );

  // 3-way 매칭 fetch + matchFilter UI 는 새 페이지(/reports/three-way-match)로 이전됨 (2026-05-21).
  //   matching 탭은 안내 메시지로 유지 (?tab=matching 옛 딥링크 호환).

  // VAT Preview
  const currentYear = Number(viewToMonth.split("-")[0]);
  const { data: vatPreview = [] } = useQuery({
    queryKey: ["vat-preview", companyId, currentYear],
    queryFn: () => getVATPreview(companyId!, currentYear),
    enabled: !!companyId && tab === "vat",
  });

  // Period Summary
  const { data: periodSummary = [] } = useQuery({
    queryKey: ["tax-period-summary", companyId, currentYear, periodType],
    queryFn: () => getTaxInvoiceSummary(companyId!, currentYear, periodType),
    enabled: !!companyId && tab === "summary",
  });

  // Card deduction summary
  const { data: cardDeductions = [] } = useQuery({
    queryKey: ["card-deductions", companyId, currentYear],
    queryFn: () => getCardDeductionSummary(companyId!, currentYear),
    enabled: !!companyId && (tab === "vat" || tab === "summary"),
  });

  // Company info for PDF/display
  const { data: companyInfo } = useQuery({
    queryKey: ["company-info", companyId],
    queryFn: async () => {
      const { data } = await (supabase as any).from('companies').select('name, business_number, representative, address, business_type, business_category').eq('id', companyId!).maybeSingle();
      return data;
    },
    enabled: !!companyId,
  });

  // Invoice queue (자동발행 대기)
  const { data: queueItems = [], isLoading: queueLoading } = useQuery({
    queryKey: ["invoice-queue", companyId],
    queryFn: () => getInvoiceQueue(companyId!),
    enabled: !!companyId && tab === "queue",
  });

  // Sync logs
  const { data: syncLogs = [] } = useQuery({
    queryKey: ["hometax-sync-logs", companyId],
    queryFn: () => getHomeTaxSyncLogs(companyId!),
    enabled: !!companyId && tab === "sync",
  });

  // Last sync time (항상 조회)
  const { data: lastSyncData } = useQuery({
    queryKey: ["last-sync-time", companyId],
    queryFn: async () => {
      const db = supabase as any;
      const { data } = await db
        .from('hometax_sync_log')
        .select('completed_at')
        .eq('company_id', companyId!)
        .eq('status', 'completed')
        .order('completed_at', { ascending: false })
        .limit(1);
      return data?.[0]?.completed_at || null;
    },
    enabled: !!companyId,
  });

  // Incremental sync 기준 시각 — company_settings.last_hometax_sync_at
  const { data: lastHometaxSyncAt } = useQuery({
    queryKey: ["last-hometax-sync-at", companyId],
    queryFn: async () => {
      const db = supabase as any;
      const { data } = await db
        .from('company_settings')
        .select('last_hometax_sync_at')
        .eq('company_id', companyId!)
        .maybeSingle();
      return data?.last_hometax_sync_at as string | null;
    },
    enabled: !!companyId,
  });

  // 페이지 mount 시 — 진행 중인 background job 감지 (사용자가 페이지 떠났다 다시 와도 진행 표시).
  useEffect(() => {
    if (!companyId || activeJobId) return;
    (async () => {
      const db = supabase as any;
      const { data } = await db
        .from('hometax_sync_jobs')
        .select('id, status, updated_at')
        .eq('company_id', companyId)
        .in('status', ['pending', 'running'])
        .gt('updated_at', new Date(Date.now() - 30 * 60 * 1000).toISOString())
        .order('created_at', { ascending: false })
        .limit(1);
      if (data && data[0]) setActiveJobId(data[0].id);
    })();
  }, [companyId, activeJobId]);

  // Background sync job — Realtime 구독해서 진행 상황 표시.
  const { data: activeJob } = useQuery({
    queryKey: ["hometax-sync-job", activeJobId],
    queryFn: async () => {
      if (!activeJobId) return null;
      const db = supabase as any;
      const { data } = await db
        .from('hometax_sync_jobs')
        .select('*')
        .eq('id', activeJobId)
        .maybeSingle();
      return data;
    },
    enabled: !!activeJobId,
    refetchInterval: activeJobId ? 2000 : false,  // 2초 polling (Realtime 보조)
  });

  useEffect(() => {
    if (!activeJobId || !companyId) return;
    const db = supabase as any;
    const ch = db.channel(`hometax_sync_jobs:${activeJobId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'hometax_sync_jobs', filter: `id=eq.${activeJobId}` }, (payload: any) => {
        queryClient.setQueryData(["hometax-sync-job", activeJobId], payload.new);
        if (payload.new.status === 'completed' || payload.new.status === 'failed') {
          // 완료 시 invalidate
          queryClient.invalidateQueries({ queryKey: ["tax-invoices-full"] });
          queryClient.invalidateQueries({ queryKey: ["last-hometax-sync-at"] });
          if (payload.new.status === 'completed') {
            toast(`백그라운드 동기화 완료: ${payload.new.total_synced}건`, 'success');
          } else {
            toast(`백그라운드 동기화 실패`, 'error');
          }
          setActiveJobId(null);
        }
      })
      .subscribe();
    return () => { db.removeChannel(ch); };
  }, [activeJobId, companyId, queryClient]);

  // (page chain 제거 — layout 의 HometaxBackgroundChain 만 단독으로 chain 추진. 이중 호출 시 CF-00016 발생.)

  // 홈택스 연결 상태 — automation_credentials.hometax 존재 여부 (codef-sync edge function이 실제로 사용하는 자격증명)
  const { data: hometaxConnection } = useQuery({
    queryKey: ["hometax-connection", companyId],
    queryFn: async () => {
      const db = supabase as any;
      const { data } = await db
        .from('automation_credentials')
        .select('id, updated_at, credentials')
        .eq('company_id', companyId!)
        .eq('service', 'hometax')
        .maybeSingle();
      return data ? {
        connected: true,
        method: data.credentials?.login_method as 'certificate' | 'id_pw' | undefined,
        connectedAt: data.updated_at as string | undefined,
      } : { connected: false };
    },
    enabled: !!companyId,
  });
  const isHometaxConnected = !!hometaxConnection?.connected;

  // Excel import handler
  const handleExcelImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !companyId) return;
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws);
    const parsed = parseHomeTaxExcel(rows);
    if (parsed.length === 0) {
      toast("유효한 세금계산서 데이터가 없습니다", "error");
      return;
    }
    if (confirm(`${parsed.length}건의 세금계산서를 가져올까요?`)) {
      await bulkImportTaxInvoices(companyId, parsed);
      invalidate();
    }
    e.target.value = "";
  };

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["tax-invoices-full"] });
  };

  const createMut = useMutation({
    // 유효한 모든 행을 일괄 등록
    mutationFn: async () => {
      const valid = rows.filter(isRowValid);
      for (const r of valid) {
        await createTaxInvoice({
          companyId: companyId!,
          type: r.type,
          counterpartyName: r.counterpartyName,
          counterpartyBizno: r.counterpartyBizno || undefined,
          counterpartyBusinessType: r.counterpartyBusinessType || undefined,
          counterpartyBusinessItem: r.counterpartyBusinessItem || undefined,
          supplyAmount: Number(r.supplyAmount),
          issueDate: r.issueDate,
          preferredDate: r.preferredDate || undefined,
          expenseCategory: r.expenseCategory || undefined,
          dealId: r.dealId || undefined,
          partnerId: r.partnerId || undefined,
          label: [r.purpose, r.itemName].filter(Boolean).join(' | ') || undefined,
        });
      }
      return valid.length;
    },
    onSuccess: (count: number) => {
      toast(`세금계산서 ${count}건이 등록되었습니다. 홈택스 전자발행은 목록에서 해당 건을 눌러 별도로 진행하세요.`, "success");
      invalidate();
      setShowForm(false);
      setRows([blankRow()]);
      setDropdownRowKey(null);
    },
    onError: (err: any) => toast("세금계산서 등록 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
  });

  const markMatchedMut = useMutation({
    mutationFn: (id: string) => markInvoiceMatched(id),
    onSuccess: invalidate,
    onError: (err: any) => toast("매칭 처리 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
  });

  // Derived data
  const salesInvoices = invoices.filter((inv: any) => inv.type === "sales");
  const purchaseInvoices = invoices.filter((inv: any) => inv.type === "purchase");

  const totalSales = salesInvoices.reduce(
    (s: number, inv: any) => s + Number(inv.total_amount || 0),
    0
  );
  const totalPurchase = purchaseInvoices.reduce(
    (s: number, inv: any) => s + Number(inv.total_amount || 0),
    0
  );
  const unmatched = invoices.filter(
    (inv: any) => inv.status !== "matched" && inv.status !== "void"
  ).length;
  const vatEstimate =
    salesInvoices.reduce(
      (s: number, inv: any) => s + Number(inv.tax_amount || 0),
      0
    ) -
    purchaseInvoices.reduce(
      (s: number, inv: any) => s + Number(inv.tax_amount || 0),
      0
    );

  // Duplicate detection
  const duplicateInvoices = useMemo(() => detectDuplicateInvoices(invoices), [invoices]);

  const currentList = tab === "sales" ? salesInvoices : tab === "purchase" ? purchaseInvoices : [];

  // 헤더 클릭 정렬 (표시용) — 합계/선택/내보내기는 currentList(원본) 사용, 렌더만 정렬
  type InvSortKey = "issue_date" | "counterparty_name" | "label" | "supply_amount" | "tax_amount" | "total_amount" | "status";
  const [invSortKey, setInvSortKey] = useState<InvSortKey>("issue_date");
  const [invSortDir, setInvSortDir] = useState<"asc" | "desc">("desc");
  const toggleInvSort = (k: InvSortKey) => {
    if (k === invSortKey) setInvSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setInvSortKey(k); setInvSortDir(k === "issue_date" ? "desc" : "asc"); }
  };
  const invSortTh = (k: InvSortKey, label: string, cls: string) => (
    <th className={`px-3 py-2.5 font-semibold whitespace-nowrap border-l border-[var(--border)]/50 ${cls} cursor-pointer select-none hover:text-[var(--text)] transition`} onClick={() => toggleInvSort(k)}>
      <span className={`inline-flex items-center gap-1 ${cls.includes("text-right") ? "justify-end w-full" : cls.includes("text-center") ? "justify-center w-full" : ""}`}>
        {label}
        <span className={`text-[9px] ${invSortKey === k ? "text-[var(--primary)]" : "text-[var(--text-dim)]/40"}`}>{invSortKey === k ? (invSortDir === "asc" ? "▲" : "▼") : "↕"}</span>
      </span>
    </th>
  );
  const displayList = useMemo(() => {
    const arr = [...currentList];
    arr.sort((a: any, b: any) => {
      let c = 0;
      switch (invSortKey) {
        case "counterparty_name": c = (a.counterparty_name || "").localeCompare(b.counterparty_name || "", "ko"); break;
        case "label": c = (a.label || a.deals?.name || "").localeCompare(b.label || b.deals?.name || "", "ko"); break;
        case "supply_amount": c = Number(a.supply_amount || 0) - Number(b.supply_amount || 0); break;
        case "tax_amount": c = Number(a.tax_amount || 0) - Number(b.tax_amount || 0); break;
        case "total_amount": c = Number(a.total_amount || 0) - Number(b.total_amount || 0); break;
        case "status": c = (a.status || "").localeCompare(b.status || "", "ko"); break;
        default: c = (a.issue_date || "").localeCompare(b.issue_date || "");
      }
      if (c === 0 && invSortKey !== "issue_date") c = (a.issue_date || "").localeCompare(b.issue_date || "");
      return invSortDir === "asc" ? c : -c;
    });
    return arr;
  }, [currentList, invSortKey, invSortDir]);

  const validRowCount = rows.filter(isRowValid).length;
  const canSubmit = validRowCount > 0;
  const rowsTotal = rows.reduce(
    (a, r) => {
      const s = Number(r.supplyAmount) || 0;
      a.supply += s;
      a.tax += Math.round(s * 0.1);
      return a;
    },
    { supply: 0, tax: 0 },
  );

  // 미발행 = 홈택스 승인번호 없음 + 무효 아님 (일괄 발행/삭제 대상 — 발행완료 건은 보호)
  const isUnissued = (inv: any) => !inv.nts_confirm_no && inv.status !== 'void';
  // 전표처리 대상: 무효 아님 + 아직 전표 미생성. 발행 여부와 무관(발행완료 건도 기장 필요).
  const isVoucherable = (inv: any) => inv.status !== 'void' && !inv.journal_entry_id;
  // 체크박스 선택 가능 = 일괄 발행/삭제 또는 전표처리 중 하나라도 가능한 행
  const selectableInList = currentList.filter((inv: any) => isUnissued(inv) || isVoucherable(inv));
  const selectedRows = selectableInList.filter((inv: any) => selectedIds.has(inv.id));
  const selectedIssuable = selectedRows.filter((inv: any) => inv.type === 'sales' && isUnissued(inv)); // 발행 가능(매출 미발행)
  const selectedDeletable = selectedRows.filter((inv: any) => isUnissued(inv)); // 삭제 가능(미발행만)
  const selectedVoucherable = selectedRows.filter(isVoucherable); // 전표처리 가능

  function toggleSelectAll() {
    if (selectedRows.length === selectableInList.length && selectableInList.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(selectableInList.map((inv: any) => inv.id)));
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleBatchIssue() {
    if (selectedIssuable.length === 0) {
      toast("발행할 미발행 매출 세금계산서를 선택하세요", "error");
      return;
    }
    setBatchIssuing(true);
    let successCount = 0;
    let failCount = 0;
    let firstHint = "";
    for (const inv of selectedIssuable) {
      try {
        await issueTaxInvoice(inv.id);
        successCount++;
      } catch (err: any) {
        failCount++;
        if (!firstHint && err?.hint) firstHint = err.hint;
      }
    }
    setBatchIssuing(false);
    setSelectedIds(new Set());
    queryClient.invalidateQueries({ queryKey: ["tax-invoices-full"] });
    if (failCount === 0) {
      toast(`${successCount}건 일괄 발행 완료 (홈택스)`, "success");
    } else {
      toast(`${successCount}건 발행, ${failCount}건 실패${firstHint ? ' — ' + firstHint : ''}`, "error");
    }
  }

  // 선택 일괄 삭제 — 미발행(홈택스 승인번호 없음) 건만 대상. 파괴적이라 확인 후 진행.
  async function handleBatchDelete() {
    if (selectedDeletable.length === 0) { toast("삭제 가능한 미발행 건이 없습니다", "error"); return; }
    if (!confirm(`선택한 ${selectedDeletable.length}건을 삭제합니다.\n홈택스 미발행 건만 삭제되며, 되돌릴 수 없습니다. 계속할까요?`)) return;
    setBatchIssuing(true);
    let ok = 0, fail = 0;
    for (const inv of selectedDeletable) {
      try {
        const { error } = await supabase.from("tax_invoices").delete().eq("id", inv.id);
        if (error) throw error;
        ok++;
      } catch { fail++; }
    }
    setBatchIssuing(false);
    setSelectedIds(new Set());
    queryClient.invalidateQueries({ queryKey: ["tax-invoices-full"] });
    toast(fail === 0 ? `${ok}건 삭제 완료` : `${ok}건 삭제, ${fail}건 실패`, fail === 0 ? "success" : "error");
  }

  // 선택 일괄 전표처리 — post_invoice_voucher(매출/매입 방향 자동). 이미 전표 있는 건/무효 건은 건너뜀.
  async function handleBulkVoucher() {
    if (!bulkVoucherAccountId || bulkVoucherPosting) { if (!bulkVoucherAccountId) toast("계정과목을 선택하세요", "error"); return; }
    setBulkVoucherPosting(true);
    const db = supabase as any;
    let ok = 0, fail = 0, skip = 0;
    try {
      for (const inv of selectedVoucherable) {
        if (!isVoucherable(inv)) { skip++; continue; }
        const { error } = await db.rpc("post_invoice_voucher", { p_tax_invoice_id: inv.id, p_account_id: bulkVoucherAccountId, p_remember: false });
        if (error) fail++; else ok++;
      }
      toast(`${ok}건 전표처리 완료${fail > 0 ? ` · ${fail}건 실패` : ""}${skip > 0 ? ` · ${skip}건 건너뜀` : ""}`, fail > 0 ? "info" : "success");
      setShowBulkVoucher(false); setBulkVoucherAccountId(""); setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["tax-invoices-full"] });
    } finally { setBulkVoucherPosting(false); }
  }

  async function handleSingleIssue(id: string) {
    try {
      await issueTaxInvoice(id);
      queryClient.invalidateQueries({ queryKey: ["tax-invoices-full"] });
      toast("홈택스 발행 완료 (승인번호 저장됨)", "success");
    } catch (err: any) {
      const hint = err?.hint ? `\n→ ${err.hint}` : "";
      toast(`발행 실패: ${err.message || err}${hint}`, "error");
    }
  }

  if (isLoading && invoices.length === 0) {
    return <div className="p-6 text-center text-[var(--text-muted)]">불러오는 중...</div>;
  }

  if (mainError) {
    return <div className="p-6 text-center text-red-400">데이터를 불러올 수 없습니다. 새로고침해 주세요.</div>;
  }

  return (
    <div className="" data-print-area>
      <QueryErrorBanner error={mainError as Error | null} onRetry={mainRefetch} />
      {/* Header */}
      <div className="page-sticky-header flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-[var(--text)]">세금계산서</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            매출/매입 세금계산서 관리 및 3-Way 매칭
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => window.print()}
            className="no-print btn-secondary cursor-pointer"
            title="현재 페이지 인쇄"
            aria-label="인쇄"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
            </svg>
            인쇄
          </button>
          <button
            onClick={() => setShowForm(!showForm)}
            className="no-print btn-primary"
          >
            + 세금계산서 등록
          </button>
        </div>
      </div>

      {/* 기간설정 — 제일 상단(제목 헤더 아래) 통일 위치 */}
      <div className="mb-6 no-print rounded-lg overflow-hidden border border-[var(--border)]" style={{ borderTop: "3px solid var(--primary)" }}>
        <div className="px-4 py-2 text-[12px] font-bold text-[var(--text)] border-b border-[var(--border)]" style={{ background: "color-mix(in srgb, var(--primary) 8%, var(--bg-surface))" }}>
          전자(세금)계산서 조회
        </div>
        <div className="bg-[var(--bg-card)] p-3 flex flex-wrap items-stretch gap-x-0 gap-y-2">
          <div className="flex items-stretch border border-[var(--border)] rounded-md overflow-hidden">
            <div className="px-3 flex items-center text-[11px] font-bold text-[var(--text-muted)]" style={{ background: "color-mix(in srgb, var(--primary) 6%, var(--bg-surface))" }}>조회기간</div>
            <div className="px-3 py-2 flex items-center gap-2 flex-wrap">
              <MonthField
                value={viewFromMonth}
                onChange={(e) => {
                  const v = e.target.value;
                  if (!v) return;
                  setViewFromMonth(v);
                  if (v > viewToMonth) setViewToMonth(v);  // from > to 면 to 도 맞춤
                }}
                className="px-2 py-1 text-xs bg-[var(--bg-surface)] border border-[var(--border)] rounded text-[var(--text)]"
                aria-label="조회 시작 월"
              />
              <span className="text-xs text-[var(--text-muted)]">~</span>
              <MonthField
                value={viewToMonth}
                onChange={(e) => {
                  const v = e.target.value;
                  if (!v) return;
                  setViewToMonth(v);
                  if (v < viewFromMonth) setViewFromMonth(v);
                }}
                className="px-2 py-1 text-xs bg-[var(--bg-surface)] border border-[var(--border)] rounded text-[var(--text)]"
                aria-label="조회 종료 월"
              />
              {/* 홈택스식 빠른 기간 */}
              {([["이번달", 0], ["3개월", 2], ["6개월", 5], ["1년", 11]] as const).map(([l, back]) => (
                <button key={l}
                  onClick={() => {
                    const d = new Date();
                    d.setMonth(d.getMonth() - back);
                    setViewFromMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
                    setViewToMonth(getCurrentMonth());
                  }}
                  className="px-2.5 py-1 rounded text-[11px] font-semibold bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text)] border border-[var(--border)] transition">
                  {l}
                </button>
              ))}
            </div>
          </div>
          <button
            onClick={() => queryClient.invalidateQueries({ queryKey: ["tax-invoices-full"] })}
            className="ml-auto self-center btn-primary"
            title="현재 조건으로 다시 조회합니다"
          >
            조회하기
          </button>
        </div>
      </div>

      {/* Sync bar */}
      <div className="flex items-center justify-between glass-card px-4 py-2.5 mb-6">
        <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          {lastSyncData ? (
            <span>
              마지막 업데이트: <strong className="text-[var(--text)]">{new Date(lastSyncData).toLocaleString('ko', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</strong>
            </span>
          ) : isHometaxConnected ? (
            <span>홈택스 연결됨</span>
          ) : (
            <span>
              홈택스 미연결 —{" "}
              <Link href="/settings?tab=bank" className="text-[var(--primary)] font-semibold hover:underline">
                설정 &gt; 은행연동
              </Link>
              에서 연결하세요
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Incremental — last_sync 이후만 (빠름) */}
          <label className="flex items-center gap-1 text-[10px] text-[var(--text-muted)] cursor-pointer hover:text-[var(--text)]" title="마지막 sync 이후 데이터만 가져옵니다 (30일 buffer). picker 무시.">
            <input type="checkbox" checked={incrementalMode} onChange={(e) => setIncrementalMode(e.target.checked)} disabled={syncing || !!activeJobId} />
            최신만
          </label>
          {/* Background — 페이지 떠나도 진행 */}
          <label className="flex items-center gap-1 text-[10px] text-[var(--text-muted)] cursor-pointer hover:text-[var(--text)]" title="백그라운드에서 처리. 페이지 떠나도 됨. 완료 시 알림.">
            <input type="checkbox" checked={backgroundMode} onChange={(e) => setBackgroundMode(e.target.checked)} disabled={syncing || !!activeJobId} />
            백그라운드
          </label>
          <span
            className={`px-2 py-1 text-[11px] rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-muted)] ${incrementalMode ? "opacity-50" : ""}`}
            title="동기화 기간은 상단 '조회기간'과 동일합니다 — 기간을 바꾸려면 위의 조회기간을 수정하세요.">
            조회기간 <b className="text-[var(--text)] mono-number">{viewFromMonth} ~ {viewToMonth}</b> 기준
          </span>
          <button
            onClick={() => hometaxCd.run(async () => {
              // Incremental — last_sync_at - 30일 ~ today. 기본은 상단 조회기간과 동일(기준 통일).
              let from = viewFromMonth, to = viewToMonth;
              if (incrementalMode) {
                if (!lastHometaxSyncAt) {
                  toast('마지막 동기화 기록이 없습니다. 먼저 일반 동기화 한 번 진행하세요.', 'info');
                  return;
                }
                const last = new Date(lastHometaxSyncAt);
                last.setDate(last.getDate() - 30);  // 30일 buffer
                const today = new Date();
                from = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}`;
                to = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
              }
              if (backgroundMode) {
                await runHometaxSyncBackground(from, to);
              } else {
                await runHometaxSync(from, to);
              }
            })}
            disabled={syncing || !!activeJobId || !isHometaxConnected || hometaxCd.disabled}
            className={`flex items-center gap-1.5 px-3 py-1.5 bg-[var(--primary)]/10 text-[var(--primary)] hover:bg-[var(--primary)]/20 rounded-lg text-xs font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed ${hometaxCd.disabled ? "!opacity-40 cursor-not-allowed" : ""}`}
            title={hometaxCd.disabled ? `30분 쿨타임 — ${hometaxCd.label}` : !isHometaxConnected ? "홈택스 연결 후 사용 가능합니다" : "상단 조회기간 범위로 동기화"}
          >
            <svg className={`w-3.5 h-3.5 ${(syncing || activeJobId) ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {syncing ? (syncProgress ? `${syncProgress.done}/${syncProgress.total} (${syncProgress.label})` : "동기화 중...")
              : activeJobId ? `백그라운드 ${activeJob?.current_progress?.done || 0}/${activeJob?.current_progress?.total || 0} (${activeJob?.current_progress?.label || ''})`
              : hometaxCd.disabled ? `⏳ ${hometaxCd.label}`
              : "홈택스에서 가져오기"}
          </button>
        </div>
      </div>
      <p className="-mt-4 mb-6 text-[10px] text-[var(--text-muted)]">
        ※ 이 버튼은 홈택스에 <b>이미 발행된</b> 세금계산서를 가져오는 조회 동작입니다. 새 세금계산서 발행은 매출 탭에서 "발행" 버튼 또는 매출 스케줄 자동 발행으로 진행됩니다.
      </p>

      {/* 동기화 결과 패널 — 월별 응답 수 vs 저장 수 비교, 누락 월에 재시도 버튼 */}
      {syncResultDetail && syncResultDetail.length > 0 && (
        <div className="glass-card p-5 mb-6 no-print">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs font-bold text-[var(--text)]">
              동기화 결과
              {(() => {
                const okCount = syncResultDetail.filter(m => m.status === "ok").length;
                const failCount = syncResultDetail.length - okCount;
                const totalSynced = syncResultDetail.reduce((s, m) => s + m.synced, 0);
                const totalResp = syncResultDetail.reduce((s, m) => s + m.responseCount, 0);
                const missing = totalResp - totalSynced;
                return (
                  <span className="ml-2 font-normal text-[var(--text-muted)]">
                    · 총 {totalSynced}건 동기화
                    {missing > 0 && <span className="ml-1 text-orange-400">· {missing}건 응답 받았으나 저장 누락</span>}
                    {failCount > 0 && <span className="ml-1 text-red-400">· {failCount}개 월 누락</span>}
                  </span>
                );
              })()}
            </div>
            <button
              onClick={() => setSyncResultDetail(null)}
              className="text-[10px] text-[var(--text-dim)] hover:text-[var(--text)]"
            >
              닫기
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
            {syncResultDetail.map((m) => (
              <div
                key={m.month}
                className={`rounded-lg p-2 text-[11px] ${
                  m.status === "ok" ? "bg-green-500/10 border border-green-500/30"
                  : m.status === "partial" ? "bg-yellow-500/10 border border-yellow-500/30"
                  : "bg-red-500/10 border border-red-500/30"
                }`}
              >
                <div className="font-semibold text-[var(--text)]">{m.month}</div>
                <div className={
                  m.status === "ok" ? "text-green-400"
                  : m.status === "partial" ? "text-yellow-400"
                  : "text-red-400"
                }>
                  {m.status === "ok" && `✓ ${m.synced}건`}
                  {m.status === "partial" && `⚠ ${m.synced}/${m.responseCount}건`}
                  {m.status === "error" && `✗ 0건 — ${m.errorMsg?.slice(0, 30) || '실패'}`}
                </div>
                {m.status !== "ok" && (
                  <button
                    onClick={() => retryMonthSync(m.month)}
                    disabled={syncing}
                    className="mt-1 text-[10px] underline text-[var(--primary)] hover:text-[var(--primary-hover)] disabled:opacity-50"
                  >
                    재시도
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}


      {/* Duplicate Invoice Warning Banner */}
      {duplicateInvoices.filter(d => !dismissedDups.has(d.key)).length > 0 && (
        <div className="no-print mb-6 bg-[var(--warning)]/10 border border-[var(--warning)]/30 rounded-xl px-5 py-4">
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 text-[var(--warning)] shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            <div className="flex-1">
              <div className="text-sm font-bold text-[var(--warning)]">중복 의심 세금계산서 감지</div>
              <div className="text-xs text-[var(--text-muted)] mt-1 space-y-1">
                {duplicateInvoices.filter(d => !dismissedDups.has(d.key)).map((dup) => (
                  <div key={dup.key}>
                    <button type="button" onClick={() => setExpandedDupKey(expandedDupKey === dup.key ? null : dup.key)}
                      className="text-left hover:underline">
                      <span className="font-medium text-[var(--text)]">{dup.counterpartyName}</span>
                      {" / "}
                      {fmt(dup.amount)}
                      {" / "}
                      {dup.date}
                      {" — "}
                      <span className="text-[var(--warning)] font-semibold">{dup.count}건 동일</span>
                      <span className="text-[var(--primary)] ml-1 text-[10px]">(클릭하여 확인)</span>
                    </button>
                  </div>
                ))}
              </div>
              <div className="caption mt-1.5">
                클릭하면 해당 세금계산서를 확인할 수 있습니다. 중복이 아닌 경우 &quot;확인&quot;을 눌러주세요.
              </div>
            </div>
          </div>
          {expandedDupKey && (() => {
            const dup = duplicateInvoices.find(d => d.key === expandedDupKey);
            if (!dup) return null;
            const dupInvs = invoices.filter((inv: any) => dup.ids.includes(inv.id));
            return (
              <div className="mt-3 border-t border-[var(--warning)]/20 pt-3">
                <div className="text-xs font-semibold text-[var(--text)] mb-2">
                  {dup.counterpartyName} — {fmt(dup.amount)} — {dup.date} ({dup.count}건)
                </div>
                <div className="space-y-2">
                  {dupInvs.map((inv: any) => (
                    <div key={inv.id} className="flex items-center gap-3 bg-[var(--bg-card)] rounded-lg px-3 py-2 border border-[var(--border)]">
                      <div className="flex-1 text-xs">
                        <span className="font-medium">{inv.counterparty_name}</span>
                        <span className="text-[var(--text-muted)] mx-2">|</span>
                        <span className="font-mono">₩{Number(inv.supply_amount).toLocaleString("ko-KR")}</span>
                        <span className="text-[var(--text-dim)] ml-2">{inv.issue_date}</span>
                        <span className="text-[var(--text-dim)] ml-2">({invoiceStatusMeta(inv.status, inv.type).label})</span>
                      </div>
                      <button type="button" onClick={() => setSelectedInvoice(inv)}
                        className="text-[10px] px-2 py-1 rounded bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition">
                        상세
                      </button>
                      <button type="button" onClick={async () => {
                        if (!confirm(`이 세금계산서를 삭제하시겠습니까?\n${inv.counterparty_name} / ₩${Number(inv.total_amount).toLocaleString()}`)) return;
                        await supabase.from("tax_invoices").delete().eq("id", inv.id);
                        invalidate();
                        toast("세금계산서가 삭제되었습니다", "success");
                      }}
                        className="text-[10px] px-2 py-1 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 transition">
                        삭제
                      </button>
                    </div>
                  ))}
                </div>
                <button type="button" onClick={() => {
                  setDismissedDups(prev => {
                    const next = new Set([...prev, expandedDupKey!]);
                    try { localStorage.setItem(`tax-dup-dismissed-${companyId}`, JSON.stringify([...next])); } catch { /* noop */ }
                    return next;
                  });
                  setExpandedDupKey(null);
                }}
                  className="mt-2 text-[10px] px-3 py-1.5 rounded-lg bg-green-500/10 text-green-400 hover:bg-green-500/20 transition font-semibold">
                  ✓ 확인 완료 (중복 아님 — 이 경고 숨기기)
                </button>
              </div>
            );
          })()}
        </div>
      )}

      {/* Summary Cards — TeamHub KPI 카드 패턴: [라벨 + kpi-icon] / [큰 값] / [실데이터 보조행] */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6" data-print-area>
        <div className="glass-card p-5 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-semibold text-[var(--text-muted)]">이번 달 매출</span>
            <span className="kpi-icon success text-base leading-none">📈</span>
          </div>
          <div className="flex items-end gap-2">
            <span className="text-[26px] leading-8 font-extrabold mono-number text-[var(--text)]">{fmt(totalSales)}</span>
          </div>
          <div className="text-xs text-[var(--text-muted)]">
            {salesInvoices.length}건
            {salesInvoices.length > 0 && (
              <span className="ml-1 text-[var(--text-dim)]">
                (공급가 {fmt(salesInvoices.reduce((s: number, inv: any) => s + Number(inv.supply_amount || 0), 0))})
              </span>
            )}
          </div>
        </div>
        <div className="glass-card p-5 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-semibold text-[var(--text-muted)]">이번 달 매입</span>
            <span className="kpi-icon warning text-base leading-none">📉</span>
          </div>
          <div className="flex items-end gap-2">
            <span className="text-[26px] leading-8 font-extrabold mono-number text-[var(--text)]">{fmt(totalPurchase)}</span>
          </div>
          <div className="text-xs text-[var(--text-muted)]">
            {purchaseInvoices.length}건
            {purchaseInvoices.length > 0 && (
              <span className="ml-1 text-[var(--text-dim)]">
                (공급가 {fmt(purchaseInvoices.reduce((s: number, inv: any) => s + Number(inv.supply_amount || 0), 0))})
              </span>
            )}
          </div>
        </div>
        <div className="glass-card p-5 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-semibold text-[var(--text-muted)]">딜 미연결 건수</span>
            <span className={`kpi-icon text-base leading-none ${unmatched > 0 ? "danger" : "success"}`}>🔗</span>
          </div>
          <div className="flex items-end gap-2">
            <span className={`text-[26px] leading-8 font-extrabold mono-number ${unmatched > 0 ? "text-[var(--danger)]" : "text-[var(--text)]"}`}>{unmatched}건</span>
          </div>
          <div className="text-xs text-[var(--text-muted)]">
            {unmatched > 0 ? `전체 ${invoices.length}건 중 딜 자동연결 안 됨` : "모든 계산서 딜 연결 완료"}
          </div>
        </div>
        <div className="glass-card p-5 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-semibold text-[var(--text-muted)]">예상 부가세 납부액</span>
            <span className="kpi-icon text-base leading-none">🧾</span>
          </div>
          <div className="flex items-end gap-2">
            <span className="text-[26px] leading-8 font-extrabold mono-number text-[var(--text)]">{fmt(Math.abs(vatEstimate))}</span>
          </div>
          <div className="text-xs text-[var(--text-muted)]">
            {vatEstimate >= 0 ? "납부 예정" : "환급 예정"}
            <span className="text-[var(--text-dim)] ml-1">
              (매출세액 {fmt(salesInvoices.reduce((s: number, inv: any) => s + Number(inv.tax_amount || 0), 0))}
              {" - "}매입세액 {fmt(purchaseInvoices.reduce((s: number, inv: any) => s + Number(inv.tax_amount || 0), 0))})
            </span>
          </div>
        </div>
      </div>

      {/* 시안 알림 2박스 — 실데이터 파생(가짜 텍스트 없음) */}
      {(() => {
        const draftCount = invoices.filter((i: any) => i.status === "draft").length;
        const unissued = invoices.filter((i: any) => i.type === "sales" && i.status !== "draft" && !i.nts_confirm_no).length;
        const warn: string[] = [];
        if (unmatched > 0) warn.push(`미매칭 ${unmatched}건 — 거래/입금 매칭 필요`);
        if (draftCount > 0) warn.push(`작성 중(미발행) ${draftCount}건 — 발행 권장`);
        if (unissued > 0) warn.push(`홈택스 미발행 ${unissued}건 — 국세청 승인번호 없음`);
        const must: string[] = [`예상 부가세 ${vatEstimate >= 0 ? "납부" : "환급"}액 ${fmt(Math.abs(vatEstimate))}`];
        if (unmatched > 0) must.push(`미매칭 ${unmatched}건 회수·매칭 확인`);
        return (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6 no-print">
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5">
              <div className="flex items-start gap-3">
                <span className="p-2 rounded-lg bg-amber-500/15 text-amber-500 shrink-0 text-base leading-none">⚠️</span>
                <div className="min-w-0">
                  <p className="font-bold text-[var(--text)] mb-1.5">주의할 계산서</p>
                  <ul className="space-y-1 text-sm text-[var(--text-muted)]">
                    {warn.length > 0 ? warn.map((w, i) => <li key={i} className="flex gap-2"><span className="text-amber-500 shrink-0">•</span><span>{w}</span></li>) : <li className="text-[var(--text-dim)]">주의 항목 없음 — 이상 없음</li>}
                  </ul>
                </div>
              </div>
            </div>
            <div className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-5">
              <div className="flex items-start gap-3">
                <span className="p-2 rounded-lg bg-rose-500/15 text-rose-500 shrink-0 text-base leading-none">📌</span>
                <div className="min-w-0">
                  <p className="font-bold text-[var(--text)] mb-1.5">필수 확인사항</p>
                  <ul className="space-y-1 text-sm text-[var(--text-muted)]">
                    {must.map((m, i) => <li key={i} className="flex gap-2"><span className="text-rose-500 shrink-0">•</span><span>{m}</span></li>)}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* 홈택스 스타일 조회조건 박스 (2026-06-12) — 라벨 셀 + 기간 + 빠른기간 + [조회하기].
          기간 변경은 즉시 반영(localStorage 유지), 조회하기 = 강제 새로고침(refetch). */}
      {/* 조회기간 컨트롤은 상단(헤더 아래)으로 이동 — 20260701 기간설정 위치 통일 */}

      {/* Registration Form — 2026-06-12 인라인 카드 → 중앙 팝업(모달) 전환. 폼/등록 로직 무변경 */}
      {showForm && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={() => setShowForm(false)}>
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl shadow-xl w-[96vw] max-w-[1240px] max-h-[88vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)] shrink-0">
            <div>
              <h3 className="text-base font-bold">세금계산서 등록</h3>
              <p className="text-[11px] text-[var(--text-dim)] mt-0.5">한 줄이 1건입니다. [+ 항목 추가]로 여러 건을 한 번에 등록할 수 있습니다.</p>
            </div>
            <button onClick={() => setShowForm(false)} className="text-[var(--text-dim)] hover:text-[var(--text)] text-xl leading-none transition" aria-label="닫기">✕</button>
          </div>

          {/* Body — 가로 스프레드시트식 다행 입력 */}
          <div className="flex-1 overflow-auto px-6 py-4">
            <div className="min-w-[1180px]">
              {/* 컬럼 헤더 */}
              <div className="grid grid-cols-[84px_124px_minmax(150px,1.3fr)_108px_128px_46px_84px_124px_120px_minmax(120px,1fr)_32px] gap-2 px-1 pb-2 mb-1 text-[10px] font-semibold text-[var(--text-dim)] uppercase tracking-wide border-b border-[var(--border)]/60 sticky top-0 bg-[var(--bg-card)] z-10">
                <span>유형</span>
                <span>작성일자 *</span>
                <span>거래처명 *</span>
                <span>사업자번호</span>
                <span className="text-right">공급가액 *</span>
                <span></span>
                <span>영수/청구</span>
                <span>연결 프로젝트</span>
                <span>비목</span>
                <span>품목명</span>
                <span></span>
              </div>

              {/* 데이터 행 */}
              <div className="space-y-2 pt-2">
                {rows.map((row) => {
                  const sa = Number(row.supplyAmount) || 0;
                  return (
                    <div key={row.key}>
                      <div className="grid grid-cols-[84px_124px_minmax(150px,1.3fr)_108px_128px_46px_84px_124px_120px_minmax(120px,1fr)_32px] gap-2 items-center">
                        {/* 유형 */}
                        <select
                          value={row.type}
                          onChange={(e) => patchRow(row.key, { type: e.target.value as "sales" | "purchase" })}
                          className="h-9 px-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)] transition"
                        >
                          {INVOICE_TYPES.map((t) => (
                            <option key={t.value} value={t.value}>{t.label}</option>
                          ))}
                        </select>

                        {/* 작성일자 — 연도 4자리로 제한 */}
                        <DateField
                          value={row.issueDate}
                          max="9999-12-31"
                          onChange={(e) => {
                            const parts = e.target.value.split("-");
                            if (parts[0] && parts[0].length > 4) parts[0] = parts[0].slice(0, 4); // 연도 6자리 입력 방지
                            patchRow(row.key, { issueDate: parts.join("-") });
                          }}
                          className="h-9 px-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)] transition"
                        />

                        {/* 거래처명 + 검색 드롭다운 */}
                        <div className="relative">
                          <input
                            value={row.counterpartyName}
                            onChange={(e) => { patchRow(row.key, { counterpartyName: e.target.value, partnerId: "" }); setDropdownRowKey(row.key); }}
                            onFocus={() => { if (row.counterpartyName) setDropdownRowKey(row.key); }}
                            onBlur={() => setTimeout(() => setDropdownRowKey((k) => (k === row.key ? null : k)), 200)}
                            placeholder="거래처명 검색/입력"
                            className="w-full h-9 px-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)] transition"
                          />
                          {dropdownRowKey === row.key && filterPartners(row.counterpartyName).length > 0 && (
                            <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl shadow-lg max-h-48 overflow-y-auto">
                              {filterPartners(row.counterpartyName).slice(0, 10).map((p: any) => (
                                <button
                                  key={p.id}
                                  type="button"
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={() => {
                                    patchRow(row.key, {
                                      counterpartyName: p.name,
                                      counterpartyBizno: p.business_number || "",
                                      counterpartyBusinessType: p.business_type || "",
                                      counterpartyBusinessItem: p.business_item || "",
                                      partnerId: p.id,
                                    });
                                    setDropdownRowKey(null);
                                  }}
                                  className="w-full text-left px-3 py-2 hover:bg-[var(--bg-surface)] text-xs"
                                >
                                  <div className="flex items-center justify-between">
                                    <span className="font-medium">{p.name}</span>
                                    {p.business_number && (
                                      <span className="caption">{p.business_number}</span>
                                    )}
                                  </div>
                                  {(p.business_type || p.business_item) && (
                                    <div className="text-[10px] text-[var(--text-dim)] mt-0.5 flex gap-2">
                                      {p.business_type && <span>{p.business_type}</span>}
                                      {p.business_item && <span>/ {p.business_item}</span>}
                                    </div>
                                  )}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* 사업자번호 */}
                        <input
                          value={row.counterpartyBizno}
                          onChange={(e) => patchRow(row.key, { counterpartyBizno: e.target.value })}
                          placeholder="000-00-00000"
                          className="h-9 px-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)] transition"
                        />

                        {/* 공급가액 */}
                        <CurrencyInput
                          value={row.supplyAmount}
                          onValueChange={(raw) => patchRow(row.key, { supplyAmount: raw })}
                          placeholder="0"
                          className="h-9 px-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)] transition text-right font-mono"
                        />

                        {/* 계산 (인라인: 입력값을 부가세 포함 합계로 보고 공급가액 분리) */}
                        <button
                          type="button"
                          onClick={() => { const t = Number(row.supplyAmount) || 0; if (t > 0) patchRow(row.key, { supplyAmount: String(Math.round(t / 1.1)) }); }}
                          title="입력한 금액을 '부가세 포함 합계'로 보고 공급가액으로 분리합니다 (÷1.1)"
                          className="h-9 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg text-[11px] text-[var(--primary)] font-semibold hover:bg-[var(--primary)]/10 transition"
                        >
                          계산
                        </button>

                        {/* 영수/청구 */}
                        <select
                          value={row.purpose}
                          onChange={(e) => patchRow(row.key, { purpose: e.target.value as "영수" | "청구" })}
                          className="h-9 px-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)] transition"
                        >
                          <option value="청구">청구</option>
                          <option value="영수">영수</option>
                        </select>

                        {/* 연결 프로젝트 */}
                        <select
                          value={row.dealId}
                          onChange={(e) => patchRow(row.key, { dealId: e.target.value })}
                          className="h-9 px-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)] transition"
                        >
                          <option value="">미연결</option>
                          {dealsForLink.map((d: any) => (
                            <option key={d.id} value={d.id}>{d.name}</option>
                          ))}
                        </select>

                        {/* 비목 */}
                        <select
                          value={row.expenseCategory}
                          onChange={(e) => patchRow(row.key, { expenseCategory: e.target.value })}
                          className="h-9 px-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)] transition"
                        >
                          {EXPENSE_CATEGORIES.map((c) => (
                            <option key={c.value} value={c.value}>{c.label}</option>
                          ))}
                        </select>

                        {/* 품목명 */}
                        <input
                          value={row.itemName}
                          onChange={(e) => patchRow(row.key, { itemName: e.target.value })}
                          placeholder="품목명 (선택)"
                          className="h-9 px-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)] transition"
                        />

                        {/* 삭제 */}
                        <button
                          type="button"
                          onClick={() => removeRow(row.key)}
                          title="이 행 삭제"
                          className="h-9 w-8 flex items-center justify-center rounded-lg text-[var(--text-dim)] hover:text-red-500 hover:bg-red-500/10 transition"
                          aria-label="행 삭제"
                        >
                          ✕
                        </button>
                      </div>

                      {/* 행별 인라인 계산 결과 */}
                      {sa > 0 && (
                        <div className="mt-1 pl-1 text-[10px] text-[var(--text-dim)]">
                          {row.counterpartyName || "(거래처 미입력)"} — 세액 <span className="font-mono text-[var(--text-muted)]">₩{Math.round(sa * 0.1).toLocaleString("ko-KR")}</span> · 합계 <span className="font-mono font-semibold text-[var(--primary)]">₩{Math.round(sa * 1.1).toLocaleString("ko-KR")}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* 항목 추가 */}
              <button
                type="button"
                onClick={() => setRows((rs) => [...rs, blankRow()])}
                className="mt-3 inline-flex items-center gap-1.5 px-3 h-8 rounded-lg border border-dashed border-[var(--border)] text-xs font-semibold text-[var(--text-muted)] hover:border-[var(--primary)] hover:text-[var(--primary)] transition"
              >
                + 항목 추가
              </button>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-[var(--border)] shrink-0">
            <div className="text-xs text-[var(--text-dim)] flex flex-wrap items-center gap-x-3 gap-y-0.5">
              <span>유효 <b className="text-[var(--text)]">{validRowCount}</b>건</span>
              <span>공급가액 <span className="font-mono text-[var(--text-muted)]">₩{rowsTotal.supply.toLocaleString("ko-KR")}</span></span>
              <span>세액 <span className="font-mono text-[var(--text-muted)]">₩{rowsTotal.tax.toLocaleString("ko-KR")}</span></span>
              <span>합계 <span className="font-mono font-bold text-[var(--primary)]">₩{(rowsTotal.supply + rowsTotal.tax).toLocaleString("ko-KR")}</span></span>
            </div>
            <div className="flex items-center gap-2.5 shrink-0">
              <button
                onClick={() => setShowForm(false)}
                className="px-5 h-11 rounded-xl text-sm font-semibold text-[var(--text-muted)] border border-[var(--border)] hover:bg-[var(--bg-surface)] hover:text-[var(--text)] transition"
              >
                취소
              </button>
              <button
                onClick={() => canSubmit && createMut.mutate()}
                disabled={!canSubmit || createMut.isPending}
                className="px-7 h-11 bg-[var(--primary)] text-white rounded-xl text-sm font-bold disabled:opacity-50 hover:brightness-110 transition"
              >
                {createMut.isPending ? "등록 중..." : `${validRowCount}건 등록`}
              </button>
            </div>
          </div>
        </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-2 mb-6 flex-wrap">
        <div className="seg-bar flex-wrap">
          {[
            { key: "sales" as const, label: "매출", count: salesInvoices.length },
            { key: "purchase" as const, label: "매입", count: purchaseInvoices.length },
            { key: "queue" as const, label: "자동발행" },
            // "3-Way 매칭" 탭은 새 페이지(/reports/three-way-match)로 이전됨 (2026-05-21)
            { key: "summary" as const, label: "기간별 집계" },
            { key: "vat" as const, label: "VAT 미리보기" },
            { key: "sync" as const, label: "홈택스 동기화" },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key as any)}
              className={`seg-item ${tab === t.key ? "seg-item-active" : ""}`}
            >
              {t.label}
              {"count" in t && t.count !== undefined && (
                <span className="text-xs opacity-70 ml-1">({t.count})</span>
              )}
            </button>
          ))}
        </div>

        <div className="ml-auto flex gap-2">
          {/* Excel import */}
          <label className="btn-secondary cursor-pointer">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" strokeLinecap="round" strokeLinejoin="round"/>
              <polyline points="14 2 14 8 20 8" strokeLinecap="round" strokeLinejoin="round"/>
              <line x1="12" y1="18" x2="12" y2="12" strokeLinecap="round"/>
              <polyline points="9 15 12 12 15 15" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            엑셀 업로드
            <input type="file" accept=".xlsx,.xls,.csv" onChange={handleExcelImport} className="hidden" />
          </label>

          {/* Export — 엑셀 내보내기 (더존 Smart-A 양식 CSV, 보기 좋은 포맷으로 통일) */}
          {(tab === "sales" || tab === "purchase") && currentList.length > 0 && (
            <button
              onClick={async () => {
                const { exportTaxInvoicesDouzone } = await import("@/lib/export-douzone");
                exportTaxInvoicesDouzone(currentList as any, `${viewFromMonth}_${viewToMonth}`);
              }}
              className="btn-secondary"
              title="현재 목록을 엑셀로 내보내기"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" strokeLinecap="round" strokeLinejoin="round"/>
                <polyline points="14 2 14 8 20 8" strokeLinecap="round" strokeLinejoin="round"/>
                <line x1="8" y1="18" x2="16" y2="18" strokeLinecap="round"/><line x1="12" y1="14" x2="12" y2="18" strokeLinecap="round"/><polyline points="9 15 12 12 15 15" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              엑셀 내보내기
            </button>
          )}
        </div>
      </div>

      {/* 정렬 버튼 툴바 — 헤더 클릭 정렬과 동일 invSortKey/invSortDir 공유 */}
      {(tab === "sales" || tab === "purchase") && currentList.length > 0 && (
        <div className="mb-3">
          <SortToolbar
            options={[
              { key: "issue_date", label: "작성일자" },
              { key: "counterparty_name", label: "거래처" },
              { key: "supply_amount", label: "공급가액" },
              { key: "total_amount", label: "합계금액" },
              { key: "status", label: "상태" },
            ]}
            sortKey={invSortKey}
            sortDir={invSortDir}
            onSort={(k) => toggleInvSort(k as any)}
          />
        </div>
      )}

      {/* Batch Actions */}
      {(tab === "sales" || tab === "purchase") && selectedRows.length > 0 && (
        <div className="mb-3 flex items-center gap-2.5 px-4 py-2.5 bg-[var(--primary)]/[.06] border border-[var(--primary)]/20 rounded-xl">
          <span className="text-xs font-semibold text-[var(--primary)]">{selectedRows.length}건 선택</span>
          {selectedIssuable.length > 0 && (
            <button
              onClick={handleBatchIssue}
              disabled={batchIssuing}
              className="px-3 py-1.5 bg-[var(--primary)] text-white rounded-lg text-xs font-semibold disabled:opacity-50 transition"
            >
              {batchIssuing ? "처리 중..." : `미발행 ${selectedIssuable.length}건 일괄 발행`}
            </button>
          )}
          {selectedVoucherable.length > 0 && (
            <button
              onClick={() => { setBulkVoucherAccountId(""); setShowBulkVoucher(true); }}
              disabled={batchIssuing}
              className="px-3 py-1.5 bg-[var(--primary)] text-white rounded-lg text-xs font-semibold disabled:opacity-50 transition hover:brightness-110"
            >
              전표처리 {selectedVoucherable.length}건
            </button>
          )}
          {selectedDeletable.length > 0 && (
            <button
              onClick={handleBatchDelete}
              disabled={batchIssuing}
              className="px-3 py-1.5 bg-red-500/90 text-white rounded-lg text-xs font-semibold disabled:opacity-50 hover:bg-red-500 transition"
            >
              선택 삭제
            </button>
          )}
          <button
            onClick={() => setSelectedIds(new Set())}
            className="px-3 py-1.5 text-[var(--text-muted)] text-xs hover:text-[var(--text)] transition"
          >
            선택 해제
          </button>
          <span className="text-[10px] text-[var(--text-dim)] ml-auto">
            합계 ₩{selectedRows.reduce((s: number, inv: any) => s + Number(inv.total_amount || 0), 0).toLocaleString("ko")}
          </span>
        </div>
      )}

      {/* Sales / Purchase Table */}
      {(tab === "sales" || tab === "purchase") && (
        <div className="glass-card overflow-hidden">
          {isLoading ? (
            <div className="p-16 text-center text-sm text-[var(--text-muted)]">
              불러오는 중...
            </div>
          ) : currentList.length === 0 ? (
            <div className="py-16 px-6 text-center">
              <div className="text-5xl mb-4">🧾</div>
              <div className="text-base font-semibold text-[var(--text)]">
                세금계산서가 등록되면 3-Way 매칭이 시작됩니다
              </div>
              <div className="text-xs text-[var(--text-muted)] mt-1.5">
                홈택스 엑셀을 업로드하거나 직접 등록할 수 있습니다
              </div>
              <button
                onClick={() => setShowForm(true)}
                className="no-print mt-5 px-4 py-2.5 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl text-sm font-semibold transition"
              >
                + 세금계산서 등록
              </button>
            </div>
          ) : (
            <div>
              {/* 홈택스식 결과 요약 바 — 총 N건 · 공급가액/세액/합계 합산 */}
              <div className="px-4 py-2.5 border-b border-[var(--border)] bg-[var(--bg-surface)] flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
                <span className="font-bold text-[var(--text)]">총 {currentList.length}건</span>
                <span className="text-[var(--text-muted)]">공급가액 <b className="text-[var(--text)] mono-number">{currentList.reduce((s: number, inv: any) => s + Number(inv.supply_amount || 0), 0).toLocaleString("ko")}원</b></span>
                <span className="text-[var(--text-muted)]">세액 <b className="text-[var(--text)] mono-number">{currentList.reduce((s: number, inv: any) => s + Number(inv.tax_amount || 0), 0).toLocaleString("ko")}원</b></span>
                <span className="text-[var(--text-muted)]">합계금액 <b className="mono-number" style={{ color: "var(--primary)" }}>{currentList.reduce((s: number, inv: any) => s + Number(inv.total_amount || 0), 0).toLocaleString("ko")}원</b></span>
                <span className="ml-auto text-[10px] text-[var(--text-dim)]">행을 클릭하면 상세를 확인합니다</span>
              </div>
              {/* 홈택스식 격자 그리드 */}
              <div className="overflow-auto max-h-[600px]">
                <table className="w-full text-xs border-collapse" style={{ minWidth: 980 }}>
                  <thead className="sticky top-0 z-10">
                    <tr className="text-xs text-[var(--text-dim)] bg-[var(--bg-card)] border-b border-[var(--border)]">
                      <th className="px-2 py-2.5 w-8 text-center border-l border-[var(--border)]/50 first:border-l-0">
                        {selectableInList.length > 0 && (
                          <input type="checkbox" checked={selectedRows.length === selectableInList.length && selectableInList.length > 0} onChange={toggleSelectAll}
                            className="w-3.5 h-3.5 rounded accent-[var(--primary)] align-middle cursor-pointer" title="미발행 전체 선택" />
                        )}
                      </th>
                      {invSortTh("issue_date", "작성일자", "text-left w-[90px]")}
                      <th className="px-3 py-2.5 text-left font-semibold whitespace-nowrap border-l border-[var(--border)]/50 w-[150px]">승인번호</th>
                      {invSortTh("counterparty_name", "상호(거래처)", "text-left")}
                      {invSortTh("label", "품목", "text-left")}
                      {invSortTh("supply_amount", "공급가액", "text-right w-[110px]")}
                      {invSortTh("tax_amount", "세액", "text-right w-[100px]")}
                      {invSortTh("total_amount", "합계금액", "text-right w-[110px]")}
                      <th className="px-3 py-2.5 text-center font-semibold whitespace-nowrap border-l border-[var(--border)]/50 w-[84px]">전송</th>
                      {invSortTh("status", "상태", "text-center w-[76px]")}
                      <th className="px-3 py-2.5 text-center font-semibold whitespace-nowrap border-l border-[var(--border)]/50 w-[70px]">관리</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayList.map((inv: any) => {
                      const sc = invoiceStatusMeta(inv.status, inv.type);
                      const posted = !!inv.journal_entry_id;
                      const canSelect = isUnissued(inv) || isVoucherable(inv);
                      const canIssue = inv.type === 'sales' && isUnissued(inv);
                      const notIssued = inv.type === 'sales' && inv.status !== 'draft' && !inv.nts_confirm_no;
                      return (
                        <tr key={inv.id} onClick={() => setSelectedInvoice(inv)}
                          className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-surface)]/60 cursor-pointer">
                          <td className="px-2 py-2 text-center border-l border-[var(--border)]/40 first:border-l-0" onClick={(e) => e.stopPropagation()}>
                            {canSelect ? (
                              <input type="checkbox" checked={selectedIds.has(inv.id)} onChange={() => toggleSelect(inv.id)}
                                className="w-3.5 h-3.5 rounded accent-[var(--primary)] align-middle cursor-pointer" />
                            ) : posted ? (
                              <span className="text-[9px] text-emerald-500 font-semibold" title="전표처리됨">전표</span>
                            ) : null}
                          </td>
                          <td className="px-3 py-2 text-[var(--text-muted)] mono-number border-l border-[var(--border)]/40 whitespace-nowrap">{inv.issue_date}</td>
                          <td className="px-3 py-2 border-l border-[var(--border)]/40 whitespace-nowrap overflow-hidden text-ellipsis max-w-[150px]" title={inv.nts_confirm_no || ""}>
                            {inv.nts_confirm_no
                              ? <span className="text-[var(--text-muted)] mono-number text-[11px]">{inv.nts_confirm_no}</span>
                              : notIssued
                                ? <span className="text-red-500 font-semibold">⚠ 미발행</span>
                                : <span className="text-[var(--text-dim)]">—</span>}
                          </td>
                          <td className="px-3 py-2 border-l border-[var(--border)]/40 max-w-[200px]">
                            <span className="flex items-center gap-1.5 min-w-0">
                              <span className="font-semibold text-[var(--text)] truncate">{inv.counterparty_name}</span>
                              {inv.auto_issued && <span className="shrink-0 text-[9px] px-1 py-0.5 rounded bg-blue-500/10 text-blue-400">자동</span>}
                              {inv.original_invoice_id && <span className="shrink-0 text-[9px] px-1 py-0.5 rounded bg-orange-500/10 text-orange-400">수정</span>}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-[var(--text-muted)] border-l border-[var(--border)]/40 whitespace-nowrap overflow-hidden text-ellipsis max-w-[180px]" title={inv.label || (inv.item_name ? String(inv.item_name).replace(/\+/g, " ") : "") || (inv as any).deals?.name || ""}>
                            {inv.label || (inv.item_name ? String(inv.item_name).replace(/\+/g, " ") : "") || (inv as any).deals?.name || "—"}
                          </td>
                          <td className="px-3 py-2 text-right mono-number text-[var(--text)] border-l border-[var(--border)]/40">{Number(inv.supply_amount).toLocaleString("ko")}</td>
                          <td className="px-3 py-2 text-right mono-number text-[var(--text-muted)] border-l border-[var(--border)]/40">{Number(inv.tax_amount).toLocaleString("ko")}</td>
                          <td className="px-3 py-2 text-right mono-number font-semibold text-[var(--text)] border-l border-[var(--border)]/40">{Number(inv.total_amount).toLocaleString("ko")}</td>
                          <td className="px-1.5 py-2 text-center border-l border-[var(--border)]/40 whitespace-nowrap">
                            {inv.source === 'hometax_sync'
                              ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-500 font-semibold">국세청</span>
                              : inv.hometax_synced_at
                                ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-500 font-semibold" title={`전송: ${new Date(inv.hometax_synced_at).toLocaleDateString('ko-KR')}`}>전송완료</span>
                                : <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-500/10 text-gray-400">미전송</span>}
                          </td>
                          <td className="px-3 py-2 text-center border-l border-[var(--border)]/40">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap ${sc.bg} ${sc.text}`}>{sc.label}</span>
                          </td>
                          <td className="px-3 py-2 text-center border-l border-[var(--border)]/40" onClick={(e) => e.stopPropagation()}>
                            {canIssue && (
                              <button
                                onClick={() => handleSingleIssue(inv.id)}
                                className="px-2.5 py-1 rounded text-[11px] font-bold text-white transition hover:brightness-110"
                                style={{ background: "var(--primary)" }}
                                title="홈택스 전자발행"
                              >
                                발행
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {/* 홈택스식 합계 행 */}
                  <tfoot>
                    <tr className="font-bold text-[var(--text)] border-t-2 border-[var(--border)] bg-[var(--bg-surface)]">
                      <td className="px-2 py-2.5" />
                      <td colSpan={4} className="px-3 py-2.5 border-l border-[var(--border)]/40">합계 ({currentList.length}건)</td>
                      <td className="px-3 py-2.5 text-right mono-number border-l border-[var(--border)]/40">{currentList.reduce((s: number, inv: any) => s + Number(inv.supply_amount || 0), 0).toLocaleString("ko")}</td>
                      <td className="px-3 py-2.5 text-right mono-number border-l border-[var(--border)]/40">{currentList.reduce((s: number, inv: any) => s + Number(inv.tax_amount || 0), 0).toLocaleString("ko")}</td>
                      <td className="px-3 py-2.5 text-right mono-number border-l border-[var(--border)]/40" style={{ color: "var(--primary)" }}>{currentList.reduce((s: number, inv: any) => s + Number(inv.total_amount || 0), 0).toLocaleString("ko")}</td>
                      <td colSpan={3} className="border-l border-[var(--border)]/40" />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Summary Tab */}
      {tab === "summary" && (
        <SummaryTab
          periodSummary={periodSummary}
          periodType={periodType}
          setPeriodType={setPeriodType}
          cardDeductions={cardDeductions}
          currentYear={currentYear}
        />
      )}

      {/* VAT Preview Tab */}
      {tab === "vat" && (
        <VATPreviewTab vatPreview={vatPreview} cardDeductions={cardDeductions} />
      )}

      {/* 일괄 전표처리 모달 — 선택된 세금계산서를 계정 1개로 일괄 기장(매출/매입 방향 자동) */}
      {showBulkVoucher && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowBulkVoucher(false)}>
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-[var(--border)]">
              <div className="text-sm font-bold text-[var(--text)]">일괄 전표처리</div>
              <div className="text-[11px] text-[var(--text-dim)] mt-0.5">선택 {selectedVoucherable.length}건을 한 계정으로 전표 생성합니다. 이미 처리된 건은 건너뜁니다.</div>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">계정과목 *</label>
                <select value={bulkVoucherAccountId} onChange={(e) => setBulkVoucherAccountId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm text-[var(--text)]">
                  <option value="">계정 선택</option>
                  {(coaAccounts as any[]).map((a) => (
                    <option key={a.id} value={a.id}>{a.name} ({a.code})</option>
                  ))}
                </select>
              </div>
              <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-[10px] text-amber-600 leading-relaxed">
                매입은 <b>비용 계정</b>, 매출은 <b>수익 계정</b>의 의미가 다릅니다. 같은 유형(매출 또는 매입)끼리 선택해 처리하는 것을 권장합니다. 매입=차)선택비용+부가세대급금/대)외상매입금, 매출=차)외상매출금/대)선택수익+부가세예수금 으로 방향이 자동 결정됩니다.
              </div>
            </div>
            <div className="px-5 py-3 border-t border-[var(--border)] flex justify-end gap-2">
              <button onClick={() => setShowBulkVoucher(false)} className="px-3 py-1.5 text-xs text-[var(--text-muted)]">취소</button>
              <button onClick={handleBulkVoucher} disabled={bulkVoucherPosting || !bulkVoucherAccountId}
                className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-[var(--primary)] text-white hover:opacity-90 disabled:opacity-50">
                {bulkVoucherPosting ? "처리 중..." : `${selectedVoucherable.length}건 전표 생성`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Invoice Detail Modal */}
      {selectedInvoice && (
        <InvoiceDetailModal
          invoice={selectedInvoice}
          companyInfo={companyInfo}
          onClose={() => setSelectedInvoice(null)}
          onModify={(inv: any) => {
            setSelectedInvoice(null);
            setModifyTarget(inv);
            setModifyReason("");
            setShowModifyModal(true);
          }}
        />
      )}

      {/* Modification Modal */}
      {showModifyModal && modifyTarget && (
        <ModificationModal
          invoice={modifyTarget}
          reason={modifyReason}
          setReason={setModifyReason}
          modifyAmount={modifyAmount}
          setModifyAmount={setModifyAmount}
          onClose={() => { setShowModifyModal(false); setModifyTarget(null); setModifyAmount(""); }}
          onSubmit={async () => {
            try {
              await modifyTaxInvoice({
                invoiceId: modifyTarget.id,
                reason: modifyReason,
                newSupplyAmount: modifyAmount ? Number(modifyAmount) : undefined,
              });
              invalidate();
              setShowModifyModal(false);
              setModifyTarget(null);
              setModifyAmount("");
            } catch (err: any) {
              toast(`오류: ${friendlyError(err, '수정세금계산서 발행 실패')}`, "error");
            }
          }}
        />
      )}

      {/* Queue Tab (자동발행 대기) */}
      {tab === "queue" && (
        <div className="space-y-4">
          <div className="glass-card p-5 mb-2">
            <div className="text-xs text-[var(--text-muted)] leading-relaxed">
              <strong className="text-[var(--text)]">자동발행 큐</strong>: 프로젝트 매출 스케줄이 확정되면 세금계산서가 자동으로 큐에 등록됩니다.
              거래처 희망일이 설정된 경우 해당일까지 대기 후 발행됩니다. <span className="text-orange-400">승인 필요</span> 건은 확인 후 승인해주세요.
            </div>
          </div>

          {queueLoading ? (
            <div className="p-16 text-center text-sm text-[var(--text-muted)]">불러오는 중...</div>
          ) : queueItems.length === 0 ? (
            <div className="glass-card py-16 px-6 text-center">
              <div className="text-5xl mb-4">⚡</div>
              <div className="text-base font-semibold mb-1.5">대기 중인 자동발행 없음</div>
              <div className="text-xs text-[var(--text-muted)]">프로젝트의 매출 스케줄이 확정되면 여기에 표시됩니다</div>
            </div>
          ) : (
            <div className="glass-card overflow-hidden">
              <div className="overflow-auto max-h-[560px] relative"><table className="w-full min-w-[700px]">
                <thead>
                  <tr className="table-head-row">
                    <th className="th-cell text-left">액션</th>
                    <th className="th-cell text-left">거래처</th>
                    <th className="th-cell text-right">금액</th>
                    <th className="th-cell text-left">발행일</th>
                    <th className="th-cell text-left">프로젝트</th>
                    <th className="th-cell text-center">상태</th>
                    <th className="th-cell text-left">비고</th>
                    <th className="th-cell text-center">승인</th>
                  </tr>
                </thead>
                <tbody>
                  {queueItems.map((q: any) => {
                    const p = q.payload || {};
                    return (
                      <tr key={q.id} className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-surface)]">
                        <td className="px-5 py-3 text-xs">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            q.action === 'issue' ? 'bg-blue-500/10 text-blue-400'
                            : q.action === 'modify' ? 'bg-orange-500/10 text-orange-400'
                            : 'bg-red-500/10 text-red-400'
                          }`}>
                            {q.action === 'issue' ? '발행' : q.action === 'modify' ? '수정' : '취소'}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-sm font-medium">{p.counterparty_name || '—'}</td>
                        <td className="px-5 py-3 text-sm text-right">{fmt(Number(p.total_amount || 0))}</td>
                        <td className="px-5 py-3 text-xs text-[var(--text-dim)]">{p.issue_date || '—'}</td>
                        <td className="px-5 py-3 text-xs text-[var(--text-muted)]">{(q as any).deals?.name || p.deal_name || '—'}</td>
                        <td className="px-5 py-3 text-center">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            q.status === 'needs_approval' ? 'bg-orange-500/10 text-orange-400'
                            : q.status === 'pending' ? 'bg-yellow-500/10 text-yellow-400'
                            : q.status === 'processing' ? 'bg-blue-500/10 text-blue-400'
                            : 'bg-gray-500/10 text-gray-400'
                          }`}>
                            {q.status === 'needs_approval' ? '승인 필요' : q.status === 'pending' ? '대기' : q.status === 'processing' ? '처리중' : q.status}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-xs text-[var(--text-dim)]">{q.error_message || '—'}</td>
                        <td className="px-5 py-3 text-center">
                          {q.status === 'needs_approval' && userId && (
                            <button
                              onClick={async () => {
                                await approveQueueItem(q.id, userId);
                                queryClient.invalidateQueries({ queryKey: ["invoice-queue"] });
                              }}
                              className="px-3 py-1 bg-green-500/10 text-green-400 hover:bg-green-500/20 rounded-lg text-xs font-semibold transition"
                            >
                              승인
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table></div>
            </div>
          )}
        </div>
      )}

      {/* Sync Tab (홈택스 동기화) */}
      {tab === "sync" && (
        <div className="space-y-4">
          {/* 미연결 상태 — 등록 가이드 */}
          {!isHometaxConnected && (
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-2xl p-5">
              <div className="flex items-start gap-3">
                <div className="text-2xl">💡</div>
                <div className="flex-1">
                  <div className="text-sm font-bold text-[var(--text)] mb-2">처음 사용하시나요? 홈택스 동기화 3단계 안내</div>
                  <ol className="space-y-2 text-xs text-[var(--text-muted)] leading-relaxed">
                    <li className="flex gap-2">
                      <span className="font-bold text-blue-500 flex-shrink-0">1.</span>
                      <span>
                        <Link href="/settings?tab=bank" className="text-blue-500 font-semibold hover:underline">설정 &gt; 은행연동</Link>
                        의 <strong>금융기관 연결 → 홈택스</strong>에서 사업자 인증정보를 먼저 등록하세요
                        (공동인증서 또는 ID/PW)
                      </span>
                    </li>
                    <li className="flex gap-2">
                      <span className="font-bold text-blue-500 flex-shrink-0">2.</span>
                      <span>이 페이지에서 <strong>시작/종료 월 선택 후 동기화</strong> 버튼을 누르면 매출/매입 세금계산서가 자동 조회됩니다</span>
                    </li>
                    <li className="flex gap-2">
                      <span className="font-bold text-blue-500 flex-shrink-0">3.</span>
                      <span>수집된 계산서는 <strong>계약 ↔ 세금계산서 ↔ 입금</strong> 3-Way 매칭으로 자동 검증됩니다 (매칭 탭에서 확인)</span>
                    </li>
                  </ol>
                  <div className="mt-3 text-[11px] text-[var(--text-dim)] bg-[var(--bg-surface)] rounded-lg px-3 py-2">
                    ⚠️ 공동인증서 로그인은 데스크톱 환경에서만 지원되며, 인증서 파일(.pfx)이 등록되어 있어야 합니다.
                    문제가 발생하면 <Link href="/guide" className="text-blue-500 hover:underline">가이드 페이지</Link>를 참고하세요.
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 연결됨 + 첫 동기화 전 — 시작 안내 */}
          {isHometaxConnected && syncLogs.length === 0 && (
            <div className="bg-emerald-500/10 border border-green-500/30 rounded-2xl p-5">
              <div className="flex items-start gap-3">
                <div className="text-2xl">✅</div>
                <div className="flex-1">
                  <div className="text-sm font-bold text-[var(--text)] mb-1">
                    홈택스 연결 완료
                    {hometaxConnection?.method === 'certificate' && <span className="ml-2 text-[10px] font-normal text-[var(--text-dim)]">(공동인증서)</span>}
                    {hometaxConnection?.method === 'id_pw' && <span className="ml-2 text-[10px] font-normal text-[var(--text-dim)]">(ID/PW)</span>}
                  </div>
                  <div className="text-xs text-[var(--text-muted)]">
                    아래 <strong>시작/종료 월 선택 후 동기화 실행</strong> 버튼을 누르면 첫 매출/매입 세금계산서를 가져옵니다.
                    수집 후 자동으로 <strong>3-Way 매칭</strong>이 시작됩니다.
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="glass-card p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold">홈택스 세금계산서 동기화</span>
                  {isHometaxConnected ? (
                    <span className="px-2 py-0.5 rounded-full bg-green-500/10 text-green-500 text-[10px] font-semibold border border-green-500/30">연결됨</span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full bg-[var(--bg-surface)] text-[var(--text-dim)] text-[10px] font-semibold border border-[var(--border)]">미연결</span>
                  )}
                </div>
                <div className="text-xs text-[var(--text-muted)] mt-1">
                  설정 &gt; 은행연동에 등록된 홈택스 인증정보로 매출/매입 세금계산서를 자동 조회합니다
                </div>
              </div>
              {/* 동기화 실행은 페이지 상단 [홈택스에서 가져오기] 버튼으로 통일 (중복 제거) */}
              <div className="text-[11px] text-[var(--text-muted)] bg-[var(--bg-surface)] rounded-lg px-3 py-2 max-w-[280px] leading-relaxed">
                동기화는 페이지 상단의 <strong className="text-[var(--primary)]">홈택스에서 가져오기</strong> 버튼으로 실행하세요. (기간·최신만·백그라운드 옵션 포함)
              </div>
            </div>

            {/* Automation flow diagram */}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mt-4">
              {[
                { icon: "🔑", title: "홈택스 로그인", desc: "ID/PW 또는 공동인증서" },
                { icon: "📥", title: "자동 조회", desc: "매출/매입 계산서 수집" },
                { icon: "🔄", title: "중복 제거", desc: "승인번호 기준 dedup" },
                { icon: "✅", title: "3-Way 매칭", desc: "계약↔계산서↔입금" },
              ].map((step, i) => (
                <div key={step.title} className="bg-[var(--bg-surface)] rounded-xl p-3 text-center relative">
                  <div className="text-xl mb-1">{step.icon}</div>
                  <div className="text-xs font-bold">{step.title}</div>
                  <div className="text-[10px] text-[var(--text-dim)] mt-0.5">{step.desc}</div>
                  {i < 3 && <div className="hidden sm:block absolute right-[-10px] top-1/2 -translate-y-1/2 text-[var(--text-dim)]">→</div>}
                </div>
              ))}
            </div>
          </div>

          {/* Sync Logs */}
          <div className="glass-card overflow-hidden">
            <div className="px-5 py-3 border-b border-[var(--border)]">
              <span className="text-sm font-bold">동기화 이력</span>
            </div>
            {syncLogs.length === 0 ? (
              <div className="py-14 px-6 text-center">
                <div className="text-4xl mb-3">🔄</div>
                <div className="text-sm font-semibold text-[var(--text)]">아직 동기화 이력이 없습니다</div>
                <div className="text-xs text-[var(--text-muted)] mt-1">상단의 홈택스에서 가져오기 버튼으로 첫 동기화를 실행하세요</div>
              </div>
            ) : (
              <div className="overflow-auto max-h-[560px] relative"><table className="w-full min-w-[600px]">
                <thead>
                  <tr className="table-head-row">
                    <th className="text-left px-5 py-2 font-medium">유형</th>
                    <th className="text-center px-5 py-2 font-medium">상태</th>
                    <th className="text-right px-5 py-2 font-medium">조회</th>
                    <th className="text-right px-5 py-2 font-medium">신규</th>
                    <th className="text-left px-5 py-2 font-medium">일시</th>
                    <th className="text-left px-5 py-2 font-medium">오류</th>
                  </tr>
                </thead>
                <tbody>
                  {syncLogs.map((log: any) => (
                    <tr key={log.id} className="border-b border-[var(--border)]/50 text-xs">
                      <td className="px-5 py-2 font-medium">
                        {log.sync_type === 'fetch_sales' ? '매출 조회' : log.sync_type === 'fetch_purchase' ? '매입 조회' : log.sync_type === 'modify' ? '수정발행' : log.sync_type}
                      </td>
                      <td className="px-5 py-2 text-center">
                        <span className={`px-2 py-0.5 rounded-full ${
                          log.status === 'completed' ? 'bg-green-500/10 text-green-400'
                          : log.status === 'failed' ? 'bg-red-500/10 text-red-400'
                          : 'bg-yellow-500/10 text-yellow-400'
                        }`}>
                          {log.status === 'completed' ? '완료' : log.status === 'failed' ? '실패' : '진행중'}
                        </span>
                      </td>
                      <td className="px-5 py-2 text-right">{log.invoices_fetched || 0}</td>
                      <td className="px-5 py-2 text-right font-bold text-green-400">{log.invoices_created || 0}</td>
                      <td className="px-5 py-2 text-[var(--text-dim)]">{log.completed_at ? new Date(log.completed_at).toLocaleString('ko') : '—'}</td>
                      <td className="px-5 py-2 text-red-400 truncate max-w-[150px]">{log.error_message || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </div>
        </div>
      )}

      {/* 계약 상세 팝업 모달 */}
      {matchDealPopup && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setMatchDealPopup(null)}>
          <div className="glass-card w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
              <h3 className="text-sm font-bold">계약 ↔ 세금계산서 매칭 상세</h3>
              <button onClick={() => setMatchDealPopup(null)} className="text-[var(--text-muted)] hover:text-[var(--text)] text-lg">&times;</button>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div>
                <div className="text-[10px] text-[var(--text-dim)] uppercase mb-1">프로젝트</div>
                <div className="text-sm font-semibold">{matchDealPopup.dealName || "—"}</div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-[var(--bg-surface)] rounded-xl p-3">
                  <div className="text-[10px] text-[var(--text-dim)] mb-1">계약금액</div>
                  <div className="text-base font-bold">₩{(matchDealPopup.contractAmount || 0).toLocaleString("ko-KR")}</div>
                </div>
                <div className="bg-[var(--bg-surface)] rounded-xl p-3">
                  <div className="text-[10px] text-[var(--text-dim)] mb-1">세금계산서 공급가액</div>
                  <div className="text-base font-bold">₩{(matchDealPopup.invoiceSupplyAmount || 0).toLocaleString("ko-KR")}</div>
                </div>
                <div className="bg-[var(--bg-surface)] rounded-xl p-3">
                  <div className="text-[10px] text-[var(--text-dim)] mb-1">부가세</div>
                  <div className="text-sm font-semibold">₩{(matchDealPopup.invoiceTaxAmount || 0).toLocaleString("ko-KR")}</div>
                </div>
                <div className="bg-[var(--bg-surface)] rounded-xl p-3">
                  <div className="text-[10px] text-[var(--text-dim)] mb-1">차액</div>
                  <div className={`text-sm font-semibold ${Math.abs(matchDealPopup.gap) < 1 ? "text-green-400" : "text-red-400"}`}>
                    {matchDealPopup.gap === 0 ? "0원 (일치)" : `₩${matchDealPopup.gap.toLocaleString("ko-KR")}`}
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <span className={`px-2 py-1 rounded-lg text-xs font-semibold ${matchDealPopup.amountMatch ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400"}`}>
                  계약매칭 {matchDealPopup.amountMatch ? "✓" : "✗"}
                </span>
                <span className={`px-2 py-1 rounded-lg text-xs font-semibold ${matchDealPopup.paymentMatch ? "bg-green-500/15 text-green-400" : "bg-orange-500/15 text-orange-400"}`}>
                  입금매칭 {matchDealPopup.paymentMatch ? "✓" : "✗"}
                </span>
                <span className={`px-2 py-1 rounded-lg text-xs font-semibold ${matchDealPopup.fullMatch ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400"}`}>
                  전체매칭 {matchDealPopup.fullMatch ? "✓" : "✗"}
                </span>
              </div>
            </div>
            <div className="flex gap-2 px-5 py-3 border-t border-[var(--border)]">
              <Link href="/projects" className="flex-1 px-3 py-2 bg-[var(--bg-surface)] text-[var(--text-muted)] rounded-lg text-xs text-center hover:bg-[var(--primary)]/10 hover:text-[var(--primary)] transition">
                프로젝트 페이지로 이동
              </Link>
              <button onClick={() => setMatchDealPopup(null)} className="flex-1 px-3 py-2 bg-[var(--primary)] text-white rounded-lg text-xs font-semibold">
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Summary Tab ──
function SummaryTab({ periodSummary, periodType, setPeriodType, cardDeductions, currentYear }: any) {
  const totalCardDeduction = cardDeductions.reduce((s: number, c: any) => s + c.estimatedVatDeduction, 0);

  return (
    <div>
      <div className="flex gap-2 mb-4">
        {([
          { key: "monthly", label: "월별" },
          { key: "quarterly", label: "분기별" },
          { key: "annual", label: "연간" },
        ] as const).map(p => (
          <button
            key={p.key}
            onClick={() => setPeriodType(p.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              periodType === p.key ? "bg-[var(--primary)] text-white" : "bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-muted)]"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="glass-card overflow-hidden">
        {periodSummary.length === 0 ? (
          <div className="py-16 px-6 text-center">
            <div className="text-5xl mb-4">📊</div>
            <div className="text-base font-semibold text-[var(--text)]">{currentYear}년 세금계산서 데이터가 없습니다</div>
            <div className="text-xs text-[var(--text-muted)] mt-1.5">세금계산서가 쌓이면 기간별 집계가 자동으로 생성됩니다</div>
          </div>
        ) : (
          <div className="overflow-auto max-h-[560px] relative"><table className="w-full min-w-[700px]">
            <thead className="sticky-bar">
              <tr className="table-head-row">
                <th className="th-cell text-left">기간</th>
                <th className="th-cell text-center">매출 건수</th>
                <th className="th-cell text-right">매출 공급가</th>
                <th className="th-cell text-right">매출 세액</th>
                <th className="th-cell text-center">매입 건수</th>
                <th className="th-cell text-right">매입 공급가</th>
                <th className="th-cell text-right">매입 세액</th>
                <th className="th-cell text-right">VAT 납부</th>
              </tr>
            </thead>
            <tbody>
              {periodSummary.map((s: any) => (
                <tr key={s.period} className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-surface)]">
                  <td className="px-5 py-3 text-sm font-medium">{s.period}</td>
                  <td className="px-5 py-3 text-sm text-center">{s.salesCount}</td>
                  <td className="px-5 py-3 text-sm text-right text-green-500">₩{s.salesSupply.toLocaleString()}</td>
                  <td className="px-5 py-3 text-xs text-right text-[var(--text-muted)]">₩{s.salesTax.toLocaleString()}</td>
                  <td className="px-5 py-3 text-sm text-center">{s.purchaseCount}</td>
                  <td className="px-5 py-3 text-sm text-right text-orange-500">₩{s.purchaseSupply.toLocaleString()}</td>
                  <td className="px-5 py-3 text-xs text-right text-[var(--text-muted)]">₩{s.purchaseTax.toLocaleString()}</td>
                  <td className={`px-5 py-3 text-sm text-right font-bold ${s.vatPayable >= 0 ? "text-[var(--primary)]" : "text-red-400"}`}>
                    ₩{s.vatPayable.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="sticky bottom-0 z-10 bg-[var(--bg-surface)] shadow-[0_-1px_0_0_var(--border)]">
              <tr className="border-t border-[var(--border)] bg-[var(--bg-surface)]">
                <td className="px-5 py-3 text-xs font-bold text-[var(--text-muted)]">합계</td>
                <td className="px-5 py-3 text-sm text-center font-bold">{periodSummary.reduce((s: number, p: any) => s + p.salesCount, 0)}</td>
                <td className="px-5 py-3 text-sm text-right font-bold text-green-500">₩{periodSummary.reduce((s: number, p: any) => s + p.salesSupply, 0).toLocaleString()}</td>
                <td className="px-5 py-3 text-xs text-right font-bold text-[var(--text-muted)]">₩{periodSummary.reduce((s: number, p: any) => s + p.salesTax, 0).toLocaleString()}</td>
                <td className="px-5 py-3 text-sm text-center font-bold">{periodSummary.reduce((s: number, p: any) => s + p.purchaseCount, 0)}</td>
                <td className="px-5 py-3 text-sm text-right font-bold text-orange-500">₩{periodSummary.reduce((s: number, p: any) => s + p.purchaseSupply, 0).toLocaleString()}</td>
                <td className="px-5 py-3 text-xs text-right font-bold text-[var(--text-muted)]">₩{periodSummary.reduce((s: number, p: any) => s + p.purchaseTax, 0).toLocaleString()}</td>
                <td className="px-5 py-3 text-sm text-right font-bold text-[var(--primary)]">₩{periodSummary.reduce((s: number, p: any) => s + p.vatPayable, 0).toLocaleString()}</td>
              </tr>
            </tfoot>
          </table></div>
        )}
      </div>

      {/* Card Deduction Summary */}
      {cardDeductions.length > 0 && (
        <div className="mt-6">
          <h3 className="text-sm font-bold text-[var(--text-muted)] mb-3">법인카드 매입세액 공제 추정</h3>
          <div className="glass-card overflow-hidden">
            <div className="overflow-auto max-h-[560px] relative"><table className="w-full min-w-[700px]">
              <thead>
                <tr className="table-head-row">
                  <th className="th-cell text-left">월</th>
                  <th className="th-cell text-center">건수</th>
                  <th className="th-cell text-right">총 사용액</th>
                  <th className="th-cell text-right">공제대상</th>
                  <th className="th-cell text-right">불공제</th>
                  <th className="th-cell text-right">공제 추정</th>
                </tr>
              </thead>
              <tbody>
                {cardDeductions.map((c: any) => (
                  <tr key={c.month} className="border-b border-[var(--border)]/50">
                    <td className="px-5 py-3 text-sm font-medium">{c.month.slice(0, 7)}</td>
                    <td className="px-5 py-3 text-sm text-center">{c.txCount}</td>
                    <td className="px-5 py-3 text-sm text-right">₩{c.totalAmount.toLocaleString()}</td>
                    <td className="px-5 py-3 text-sm text-right text-green-500">₩{c.deductible.toLocaleString()}</td>
                    <td className="px-5 py-3 text-sm text-right text-red-400">₩{c.nonDeductible.toLocaleString()}</td>
                    <td className="px-5 py-3 text-sm text-right font-bold text-[var(--primary)]">₩{c.estimatedVatDeduction.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="sticky bottom-0 z-10 bg-[var(--bg-surface)] shadow-[0_-1px_0_0_var(--border)]">
                <tr className="border-t border-[var(--border)] bg-[var(--bg-surface)]">
                  <td colSpan={5} className="px-5 py-3 text-xs font-bold text-[var(--text-muted)]">연간 카드공제 추정 합계</td>
                  <td className="px-5 py-3 text-sm text-right font-bold text-[var(--primary)]">₩{totalCardDeduction.toLocaleString()}</td>
                </tr>
              </tfoot>
            </table></div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── VAT Preview Tab ──
function VATPreviewTab({ vatPreview, cardDeductions }: any) {
  const totalVAT = vatPreview.reduce((s: number, v: any) => s + v.netVAT, 0);

  return (
    <div>
      <div className="glass-card p-5 mb-6">
        <div className="text-xs text-[var(--text-muted)] leading-relaxed">
          <strong className="text-[var(--text)]">VAT 미리보기</strong>: 분기별 부가가치세 납부/환급 예상액입니다.
          매출세액(세금계산서 + 현금영수증 발행분) - 매입세액 - 카드매입세액공제 = 최종 납부세액
        </div>
      </div>

      {/* Annual Total Card */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="glass-card p-5">
          <div className="text-xs text-[var(--text-dim)] mb-1">연간 매출세액</div>
          <div className="text-xl font-black text-green-500">₩{vatPreview.reduce((s: number, v: any) => s + v.salesTax, 0).toLocaleString()}</div>
        </div>
        <div className="glass-card p-5">
          <div className="text-xs text-[var(--text-dim)] mb-1">연간 매입세액 + 카드공제</div>
          <div className="text-xl font-black text-orange-500">₩{vatPreview.reduce((s: number, v: any) => s + v.purchaseTax + v.cardDeduction, 0).toLocaleString()}</div>
        </div>
        <div className="glass-card p-5">
          <div className="text-xs text-[var(--text-dim)] mb-1">연간 예상 납부세액</div>
          <div className={`text-xl font-black ${totalVAT >= 0 ? "text-[var(--primary)]" : "text-red-400"}`}>
            ₩{totalVAT.toLocaleString()}
          </div>
          <div className="text-xs text-[var(--text-muted)] mt-1">{totalVAT >= 0 ? "납부" : "환급"}</div>
        </div>
      </div>

      {/* Quarterly Breakdown */}
      <div className="glass-card overflow-hidden">
        <div className="overflow-auto max-h-[560px] relative"><table className="w-full min-w-[700px]">
          <thead className="sticky-bar">
            <tr className="table-head-row">
              <th className="th-cell text-left">분기</th>
              <th className="th-cell text-right">매출세액</th>
              <th className="th-cell text-right">매입세액</th>
              <th className="th-cell text-right">카드공제</th>
              <th className="th-cell text-right">납부세액</th>
              <th className="th-cell text-left">납부기한</th>
              <th className="th-cell text-center">상태</th>
            </tr>
          </thead>
          <tbody>
            {vatPreview.map((v: any) => {
              const isPast = new Date(v.dueDate) < new Date();
              const hasActivity = v.salesTax > 0 || v.purchaseTax > 0;
              return (
                <tr key={v.quarter} className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-surface)]">
                  <td className="px-5 py-3 text-sm font-bold">{v.quarter}</td>
                  <td className="px-5 py-3 text-sm text-right text-green-500" title={v.cashReceiptSalesTax > 0 ? `세금계산서 ₩${(v.invoiceSalesTax ?? 0).toLocaleString()} + 현금영수증 ₩${v.cashReceiptSalesTax.toLocaleString()}` : undefined}>₩{v.salesTax.toLocaleString()}</td>
                  <td className="px-5 py-3 text-sm text-right text-orange-500">₩{v.purchaseTax.toLocaleString()}</td>
                  <td className="px-5 py-3 text-sm text-right text-[var(--primary)]">₩{v.cardDeduction.toLocaleString()}</td>
                  <td className={`px-5 py-3 text-sm text-right font-bold ${v.netVAT >= 0 ? "text-[var(--text)]" : "text-red-400"}`}>
                    ₩{v.netVAT.toLocaleString()}
                  </td>
                  <td className="px-5 py-3 text-xs text-[var(--text-muted)]">{v.dueDate}</td>
                  <td className="px-5 py-3 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      !hasActivity ? "bg-gray-500/10 text-gray-400"
                      : isPast ? "bg-green-500/10 text-green-400"
                      : "bg-yellow-500/10 text-yellow-400"
                    }`}>
                      {!hasActivity ? "데이터 없음" : isPast ? "기한 경과" : "예정"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      </div>
    </div>
  );
}

// ── Invoice Detail Modal (세금계산서 상세) ──
function InvoiceDetailModal({ invoice, companyInfo, onClose, onModify }: { invoice: any; companyInfo?: any; onClose: () => void; onModify: (inv: any) => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const inv = invoice;
  const supplyAmt = Number(inv.supply_amount || 0);
  const taxAmt = Number(inv.tax_amount || 0);
  const totalAmt = Number(inv.total_amount || 0);
  const sc = invoiceStatusMeta(inv.status, inv.type);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [emailLoading, setEmailLoading] = useState(false);
  const [issueLoading, setIssueLoading] = useState(false);
  const [registerLoading, setRegisterLoading] = useState(false);
  const [emailTo, setEmailTo] = useState('');
  const [showEmailForm, setShowEmailForm] = useState(false);
  const myCompany = companyInfo?.name || '(주)우리회사';
  const myBizNo = companyInfo?.business_number || '';
  const myRep = companyInfo?.representative || '';
  const myBizType = companyInfo?.business_type || '';
  const myBizCat = companyInfo?.business_category || '';

  const buildPdfParams = (): TaxInvoicePdfParams => ({
    invoiceNumber: `TI-${inv.issue_date?.replace(/-/g, '').slice(0, 6)}-${inv.id.slice(0, 4).toUpperCase()}`,
    issueDate: inv.issue_date || new Date().toISOString().split('T')[0],
    type: inv.type,
    supplier: {
      name: inv.type === 'sales' ? myCompany : inv.counterparty_name,
      businessNumber: inv.type === 'sales' ? myBizNo : (inv.counterparty_bizno || ''),
      representative: inv.type === 'sales' ? myRep : '',
      address: inv.type === 'sales' ? (companyInfo?.address || '') : '',
      businessType: inv.type === 'sales' ? myBizType : (inv.partners?.business_type || ''),
      businessCategory: inv.type === 'sales' ? myBizCat : (inv.partners?.business_item || ''),
    },
    buyer: {
      name: inv.type === 'purchase' ? myCompany : inv.counterparty_name,
      businessNumber: inv.type === 'purchase' ? myBizNo : (inv.counterparty_bizno || ''),
      representative: inv.type === 'purchase' ? myRep : '',
      address: inv.type === 'purchase' ? (companyInfo?.address || '') : '',
      businessType: inv.type === 'purchase' ? myBizType : (inv.partners?.business_type || ''),
      businessCategory: inv.type === 'purchase' ? myBizCat : (inv.partners?.business_item || ''),
    },
    supplyAmount: supplyAmt,
    taxAmount: taxAmt,
    totalAmount: totalAmt,
    items: [{
      date: inv.issue_date || new Date().toISOString().split('T')[0],
      name: inv.item_name || inv.label || '용역',
      spec: inv.item_spec || '-',
      qty: inv.item_quantity || 1,
      unitPrice: inv.item_unit_price || supplyAmt,
      amount: supplyAmt,
      taxAmount: taxAmt,
    }],
  });

  const handleDownloadPdf = async () => {
    setPdfLoading(true);
    try {
      const blob = await generateTaxInvoicePdf(buildPdfParams());
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `세금계산서_${inv.counterparty_name}_${inv.issue_date}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast('PDF 다운로드 완료', 'success');
    } catch (err: any) {
      toast(`PDF 생성 실패: ${err.message}`, 'error');
    }
    setPdfLoading(false);
  };

  const handleSendEmail = async () => {
    if (!emailTo) { toast('이메일 주소를 입력하세요', 'error'); return; }
    setEmailLoading(true);
    try {
      // Generate PDF blob → base64
      const blob = await generateTaxInvoicePdf(buildPdfParams());
      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const pdfBase64 = btoa(binary);

      const invoiceNumber = `TI-${inv.issue_date?.replace(/-/g, '').slice(0, 6)}-${inv.id.slice(0, 4).toUpperCase()}`;
      const res = await supabase.functions.invoke('send-tax-invoice-email', {
        body: {
          recipientEmail: emailTo,
          counterpartyName: inv.counterparty_name,
          senderCompany: myCompany,
          invoiceNumber,
          issueDate: inv.issue_date,
          supplyAmount: supplyAmt,
          taxAmount: taxAmt,
          totalAmount: totalAmt,
          type: inv.type,
          pdfBase64,
        },
      });
      if (res.error) throw res.error;
      toast(`${emailTo}로 세금계산서 발송 완료`, 'success');
      setShowEmailForm(false);
      setEmailTo('');
    } catch (err: any) {
      toast(`이메일 발송 실패: ${err.message}`, 'error');
    }
    setEmailLoading(false);
  };

  const handleIssue = async () => {
    // 이미 국세청 발행(승인번호 보유)된 건만 차단. draft·내부발행(issued+미발행) 모두 실제 발행 시도 허용.
    if (inv.nts_confirm_no) { toast('이미 국세청에 발행된 세금계산서입니다.', 'error'); return; }
    setIssueLoading(true);
    try {
      const r: any = await issueTaxInvoice(inv.id);
      toast(r?.nts_confirm_no ? `홈택스 발행 완료 (승인번호 ${r.nts_confirm_no})` : '세금계산서가 발행되었습니다', 'success');
      queryClient.invalidateQueries({ queryKey: ['tax-invoices'] });
      queryClient.invalidateQueries({ queryKey: ['tax-invoices-full'] });
      onClose();
    } catch (err: any) {
      toast(`발행 실패: ${err.message}${err.hint ? ' — ' + err.hint : ''}`, 'error');
    }
    setIssueLoading(false);
  };

  // 발행 등록(최초 1회): CODEF 제휴사 회원가입 + 공동인증서 등록 URL → 새 창
  const handleRegisterIssuer = async () => {
    setRegisterLoading(true);
    try {
      const { certURL, message } = await registerHometaxIssuer(inv.company_id);
      window.open(certURL, '_blank', 'noopener');
      toast(message || '인증서 등록 페이지를 열었습니다. 등록 후 다시 발행하세요.', 'success');
    } catch (err: any) {
      toast(`발행 등록 실패: ${err.message}`, 'error');
    }
    setRegisterLoading(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="glass-card w-full max-w-[90vw] sm: max-h-[90vh] overflow-y-auto mx-4" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-lg font-black">세금계산서</span>
            <span className={`text-xs px-2 py-0.5 rounded-full ${sc.bg} ${sc.text}`}>{sc.label}</span>
            {/* 매출 — 실제 국세청 발행 여부(nts_confirm_no)로 별도 표시. status='issued'는 앱 내부 상태일 뿐. */}
            {inv.type === 'sales' && (
              inv.nts_confirm_no ? (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/15 text-green-500" title={`국세청 승인번호 ${inv.nts_confirm_no}`}>홈택스 발행완료</span>
              ) : (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/15 text-red-500">홈택스 미발행</span>
              )
            )}
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text)] text-xl transition">&times;</button>
        </div>

        {/* Tax Invoice Form (국세청 양식 스타일) */}
        <div className="p-6" data-print-area>
          <div className="border-2 border-[var(--primary)] rounded-lg overflow-hidden print:border-black">
            {/* Title bar */}
            <div className="bg-[var(--primary)]/10 px-4 py-2 text-center">
              <span className="text-sm font-black text-[var(--primary)] tracking-widest">
                전 자 세 금 계 산 서
              </span>
              <span className="text-[10px] text-[var(--text-muted)] ml-2">
                ({inv.type === "sales" ? "공급자 보관용" : "공급받는자 보관용"})
              </span>
            </div>

            {/* Supplier / Receiver Info */}
            <div className="grid grid-cols-2 divide-x divide-[var(--border)]">
              {/* 공급자 */}
              <div className="p-3">
                <div className="text-[10px] font-bold text-[var(--primary)] mb-2 tracking-wider">공급자</div>
                <div className="space-y-1.5 text-xs">
                  <div className="flex"><span className="text-[var(--text-dim)] w-16 shrink-0">등록번호</span><span className="font-medium">{inv.type === "sales" ? (myBizNo || "—") : (inv.counterparty_bizno || "—")}</span></div>
                  <div className="flex"><span className="text-[var(--text-dim)] w-16 shrink-0">상호</span><span className="font-medium">{inv.type === "sales" ? myCompany : inv.counterparty_name}</span></div>
                  <div className="flex"><span className="text-[var(--text-dim)] w-16 shrink-0">대표자</span><span className="text-[var(--text-muted)]">{inv.type === "sales" ? (myRep || "—") : "—"}</span></div>
                  <div className="flex"><span className="text-[var(--text-dim)] w-16 shrink-0">업태/종목</span><span className="text-[var(--text-muted)]">{inv.type === "sales" ? ([myBizType, myBizCat].filter(Boolean).join(" / ") || "—") : ([inv.partners?.business_type, inv.partners?.business_item].filter(Boolean).join(" / ") || "—")}</span></div>
                </div>
              </div>
              {/* 공급받는자 */}
              <div className="p-3">
                <div className="text-[10px] font-bold text-orange-400 mb-2 tracking-wider">공급받는자</div>
                <div className="space-y-1.5 text-xs">
                  <div className="flex"><span className="text-[var(--text-dim)] w-16 shrink-0">등록번호</span><span className="font-medium">{inv.type === "purchase" ? (myBizNo || "—") : (inv.counterparty_bizno || "—")}</span></div>
                  <div className="flex"><span className="text-[var(--text-dim)] w-16 shrink-0">상호</span><span className="font-medium">{inv.type === "purchase" ? myCompany : inv.counterparty_name}</span></div>
                  <div className="flex"><span className="text-[var(--text-dim)] w-16 shrink-0">대표자</span><span className="text-[var(--text-muted)]">{inv.type === "purchase" ? (myRep || "—") : "—"}</span></div>
                  <div className="flex"><span className="text-[var(--text-dim)] w-16 shrink-0">업태/종목</span><span className="text-[var(--text-muted)]">{inv.type === "purchase" ? ([myBizType, myBizCat].filter(Boolean).join(" / ") || "—") : ([inv.partners?.business_type, inv.partners?.business_item].filter(Boolean).join(" / ") || "—")}</span></div>
                </div>
              </div>
            </div>

            {/* Amount summary */}
            <div className="border-t border-[var(--border)] grid grid-cols-2 sm:grid-cols-4 divide-x divide-[var(--border)] text-center">
              <div className="p-2">
                <div className="caption">작성일자</div>
                <div className="text-xs font-bold mt-0.5">{inv.issue_date}</div>
              </div>
              <div className="p-2">
                <div className="caption">공급가액</div>
                <div className="text-xs font-bold mt-0.5 text-green-500">₩{supplyAmt.toLocaleString()}</div>
              </div>
              <div className="p-2">
                <div className="caption">세액</div>
                <div className="text-xs font-bold mt-0.5">₩{taxAmt.toLocaleString()}</div>
              </div>
              <div className="p-2">
                <div className="caption">합계금액</div>
                <div className="text-sm font-black mt-0.5 text-[var(--primary)]">₩{totalAmt.toLocaleString()}</div>
              </div>
            </div>

            {/* Item detail table */}
            <div className="border-t border-[var(--border)]">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[10px] text-[var(--text-dim)] border-b border-[var(--border)]">
                    <th className="px-3 py-1.5 text-left font-medium">월/일</th>
                    <th className="px-3 py-1.5 text-left font-medium">품목</th>
                    <th className="px-3 py-1.5 text-right font-medium">수량</th>
                    <th className="px-3 py-1.5 text-right font-medium">단가</th>
                    <th className="px-3 py-1.5 text-right font-medium">공급가액</th>
                    <th className="px-3 py-1.5 text-right font-medium">세액</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-[var(--border)]/50">
                    <td className="px-3 py-2">{inv.issue_date?.slice(5)}</td>
                    <td className="px-3 py-2 font-medium">
                      {inv.label || (inv.item_name ? String(inv.item_name).replace(/\+/g, " ") : "") || EXPENSE_CATEGORIES.find((c: any) => c.value === inv.expense_category)?.label || "—"}
                    </td>
                    <td className="px-3 py-2 text-right">1</td>
                    <td className="px-3 py-2 text-right">₩{supplyAmt.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right">₩{supplyAmt.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right">₩{taxAmt.toLocaleString()}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Footer info */}
            <div className="border-t border-[var(--border)] px-4 py-2 grid grid-cols-3 text-xs">
              <div>
                <span className="text-[var(--text-dim)]">프로젝트: </span>
                <span className="font-medium">{inv.deals?.name || "—"}</span>
              </div>
              <div>
                <span className="text-[var(--text-dim)]">비목: </span>
                <span className="font-medium">{EXPENSE_CATEGORIES.find(c => c.value === inv.expense_category)?.label || inv.label || "—"}</span>
              </div>
              <div>
                <span className="text-[var(--text-dim)]">영수/청구: </span>
                <span className="font-medium">{inv.label?.includes("영수") ? "영수" : "청구"}</span>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="space-y-3 mt-4">
            {/* 매출인데 국세청 미발행(nts_confirm_no 없음) — 오해 방지 경고 + 실제 발행 버튼 */}
            {inv.type === 'sales' && inv.status !== 'draft' && !inv.nts_confirm_no && (
              <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2.5 text-xs text-red-500 leading-relaxed">
                <div>⚠️ 이 세금계산서는 앱에만 기록됐고 <b>아직 국세청에 전자발행되지 않았습니다</b> (승인번호 없음).</div>
                <div className="mt-1 text-[10px] text-red-400/90">전자발행은 최초 1회 <b>발행 등록(회원가입+인증서)</b>이 필요합니다. ① 발행 등록 → 인증서 등록 완료 후 → ② 홈택스 발행.</div>
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  <button
                    onClick={handleRegisterIssuer}
                    disabled={registerLoading}
                    className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-semibold transition disabled:opacity-50"
                  >
                    {registerLoading ? '등록 페이지 여는 중...' : '① 발행 등록 (회원가입+인증서)'}
                  </button>
                  <button
                    onClick={handleIssue}
                    disabled={issueLoading}
                    className="px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white rounded-lg font-semibold transition disabled:opacity-50"
                  >
                    {issueLoading ? '발행 중...' : '② 지금 홈택스 발행'}
                  </button>
                  <span className="text-[10px] text-red-400/80">또는 홈택스에서 직접 발행</span>
                </div>
              </div>
            )}
            <div className="flex items-center gap-2 flex-wrap">
              {inv.status === 'draft' && (
                <button
                  onClick={handleIssue}
                  disabled={issueLoading}
                  className="px-4 py-2 bg-[var(--primary)] text-white hover:bg-[var(--primary-hover)] rounded-lg text-sm font-semibold transition disabled:opacity-50"
                >
                  {issueLoading ? '발행 중...' : '발행 처리'}
                </button>
              )}
              <button
                onClick={handleDownloadPdf}
                disabled={pdfLoading}
                className="px-4 py-2 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 rounded-lg text-sm font-semibold transition disabled:opacity-50"
              >
                {pdfLoading ? 'PDF 생성 중...' : 'PDF 다운로드'}
              </button>
              <button
                onClick={() => setShowEmailForm(!showEmailForm)}
                className="px-4 py-2 bg-green-500/10 text-green-400 hover:bg-green-500/20 rounded-lg text-sm font-semibold transition"
              >
                이메일 발송
              </button>
              <button
                onClick={() => onModify(inv)}
                className="px-4 py-2 bg-orange-500/10 text-orange-400 hover:bg-orange-500/20 rounded-lg text-sm font-semibold transition"
              >
                수정세금계산서
              </button>
              <button
                onClick={() => { ensurePrintStyles(); window.print(); }}
                className="px-4 py-2 bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text)] rounded-lg text-sm border border-[var(--border)] transition"
              >
                인쇄
              </button>
              <button
                onClick={onClose}
                className="px-4 py-2 text-[var(--text-muted)] text-sm hover:text-[var(--text)] transition ml-auto"
              >
                닫기
              </button>
            </div>

            {/* Email form */}
            {showEmailForm && (
              <div className="flex items-center gap-2 bg-[var(--bg-surface)] rounded-xl p-3 border border-[var(--border)]">
                <input
                  type="email"
                  value={emailTo}
                  onChange={e => setEmailTo(e.target.value)}
                  placeholder="수신자 이메일 주소"
                  className="flex-1 px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]"
                />
                <button
                  onClick={handleSendEmail}
                  disabled={emailLoading || !emailTo}
                  className="px-4 py-2 bg-green-500 text-white rounded-lg text-sm font-semibold hover:bg-green-600 transition disabled:opacity-50 whitespace-nowrap"
                >
                  {emailLoading ? '발송 중...' : 'PDF 첨부 발송'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Modification Modal (수정세금계산서) ──
function ModificationModal({ invoice, reason, setReason, modifyAmount, setModifyAmount, onClose, onSubmit }: {
  invoice: any; reason: string; setReason: (r: string) => void; modifyAmount: string; setModifyAmount: (v: string) => void; onClose: () => void; onSubmit: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="glass-card w-full max-w-[90vw] sm:max-w-[520px] mx-4" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-[var(--border)]">
          <h3 className="text-sm font-bold">수정세금계산서 발행</h3>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            원본: {invoice.counterparty_name} / ₩{Number(invoice.total_amount).toLocaleString()} ({invoice.issue_date})
          </p>
        </div>
        <div className="p-6 space-y-4">
          {/* Rules info */}
          <div className="bg-[var(--bg-surface)] rounded-xl p-4 text-xs text-[var(--text-muted)] leading-relaxed space-y-2">
            <div className="font-bold text-[var(--text)] text-sm mb-2">수정세금계산서 발행 규정</div>
            <div>1. 공급시기가 속하는 과세기간에 대한 확정신고 기한 내 발행 가능</div>
            <div>2. 착오정정은 당초 세금계산서와 수정세금계산서를 동시 발행</div>
            <div>3. 계약해제/환입은 사유 발생일을 작성일자로 발행</div>
            <div>4. 가산세: 미발행 시 공급가액의 1%, 지연발행 시 0.5%</div>
          </div>

          {/* Reason selection */}
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-2 font-medium">수정 사유 선택 *</label>
            <div className="space-y-2">
              {MODIFICATION_REASONS.map((r) => (
                <label
                  key={r.value}
                  className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition ${
                    reason === r.value
                      ? "border-[var(--primary)] bg-[var(--primary)]/5"
                      : "border-[var(--border)] hover:border-[var(--text-muted)]"
                  }`}
                >
                  <input
                    type="radio"
                    name="modifyReason"
                    value={r.value}
                    checked={reason === r.value}
                    onChange={() => setReason(r.value)}
                    className="mt-0.5 accent-[var(--primary)]"
                  />
                  <div>
                    <div className="text-sm font-semibold">{r.label}</div>
                    <div className="text-xs text-[var(--text-muted)] mt-0.5">{r.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* 금액 변경 입력 (착오정정, 공급가액 변동 시) */}
          {(reason === "error_correction" || reason === "price_change") && (
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1 font-medium">
                {reason === "price_change" ? "변경 후 공급가액 *" : "정정 공급가액"}
              </label>
              <CurrencyInput
                value={modifyAmount}
                onValueChange={(raw) => setModifyAmount(raw)}
                placeholder={`현재: ${Number(invoice.supply_amount).toLocaleString()}`}
                className="field-input"
              />
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button
              onClick={async () => {
                setSubmitting(true);
                try { await onSubmit(); } finally { setSubmitting(false); }
              }}
              disabled={!reason || submitting || (reason === "price_change" && !modifyAmount)}
              className="px-4 py-2.5 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50 transition"
            >
              {submitting ? "처리 중..." : "수정세금계산서 발행"}
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2.5 text-[var(--text-muted)] text-sm hover:text-[var(--text)] transition"
            >
              취소
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MatchBadge({ ok, na }: { ok: boolean; na: boolean }) {
  if (na) {
    return (
      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-500/10 text-gray-500">
        N/A
      </span>
    );
  }
  return (
    <span
      className={`text-xs px-2 py-0.5 rounded-full ${
        ok ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"
      }`}
    >
      {ok ? "일치" : "불일치"}
    </span>
  );
}
