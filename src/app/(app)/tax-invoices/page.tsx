"use client";
import { WaterfallChart } from "@/components/charts/kit";
import { getHometaxPausedUntil, setHometaxPause, clearHometaxPause } from "@/lib/data-sync";
import { useMyPermissions } from "@/lib/permissions";
import { Ico } from "@/components/ui-icon";
import { todayKst, kstDateStr } from "@/lib/kst";
import { logRead } from "@/lib/log-read";

import Link from "next/link";
import { MonthField } from "@/components/month-field";
import { DateField } from "@/components/date-field";
import { useSearchParams } from "next/navigation";
import { friendlyError } from "@/lib/friendly-error";
import { useEffect, useState, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { fetchPaged } from "@/lib/fetch-paged";
import { useSyncCooldown } from "@/lib/sync-cooldown";
import { getCurrentUser } from "@/lib/queries";
import { useColWidths } from "../partners/ledger/shared";
import {
  createTaxInvoice,
  markInvoiceMatched,
  getTaxInvoiceSummary,
  getVATPreview,
  modifyTaxInvoice,
  getInvoiceQueue,
  approveQueueItem,
  getHomeTaxSyncLogs,
  INVOICE_TYPES,
  INVOICE_STATUS,
  invoiceStatusMeta,
  issueTaxInvoice,
  registerHometaxIssuer,
  itemsLabel,
} from "@/lib/tax-invoice";
import { getTaxInvoiceIssuanceStatus } from "@/lib/billing";
import type { PeriodType } from "@/lib/tax-invoice";
import { getCardDeductionSummary } from "@/lib/card-transactions";
import * as XLSX from "xlsx";
import { TaxInvoiceBulkIssueModal } from "@/components/tax-invoice-bulk-issue";
import { QueryErrorBanner } from "@/components/query-status";
import { ToolbarPopover, ToolbarPopoverItem } from "@/components/toolbar-popover";
import { CurrencyInput } from "@/components/currency-input";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm-dialog";
import { useUser } from "@/components/user-context";
import { AccessDenied } from "@/components/access-denied";
import { useCanAccessTab } from "@/lib/tab-access";
import { generateTaxInvoicePdf } from "@/lib/document-generator";
import type { TaxInvoicePdfParams } from "@/lib/document-generator";
import { getThreeWayCandidates, confirmThreeWayMatch, unmatchInvoice } from "@/lib/three-way-match";

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

// label 앞에 붙은 영수/청구 토큰 제거 → 적요/품목엔 순수 내용만 표시.
//   (영수/청구 구분은 홈택스 전자계산서 데이터에 없어 label 토큰으로 보관 — 상세에서 수동 지정 가능)
function stripPurposeToken(label?: string | null) {
  if (!label) return "";
  return label.replace(/^\s*(영수|청구)\s*(\|\s*)?/, "").trim();
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

// ── 수정세금계산서 준비 상태 ──
//   CODEF 수정발행은 정발행과 상품이 분리돼 있어 별도 신청이 필요하다
//   (regist-revise-invoicer-trustee). 2026-08-03 사장님이 상품 구독 완료 →
//   수정발행 분기가 담긴 hometax-issue(v37)·modify-tax-invoice(v27) 배포 후 해제.
const MODIFY_ISSUE_AVAILABLE = true;

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
  // 권한 게이트에서 early return 한 뒤에 나머지 훅들이 이어지면 tabLoading 이 풀리는 순간
  // 렌더당 훅 개수가 달라져 React #310 크래시 — 본문을 별도 컴포넌트로 분리 (2026-08-03).
  if (tabLoading) return null;
  if (!tabAllowed) {
    return <AccessDenied detail="세금계산서 접근 권한이 없습니다. 마스터에게 권한을 요청하세요." />;
  }
  return <TaxInvoicesPageInner />;
}

function TaxInvoicesPageInner() {
  const { toast } = useToast();
  const { confirm: confirmDialog, confirmElement } = useConfirm();
  const queryClient = useQueryClient();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const hometaxCd = useSyncCooldown(companyId, "hometax");
  // 홈택스 연동 일시정지 — 통장 정지 버튼과 동일 UX (2026-07-30 사장님)
  const { data: hometaxPausedUntil } = useQuery({
    queryKey: ["hometax-sync-paused", companyId],
    queryFn: () => getHometaxPausedUntil(companyId!),
    enabled: !!companyId,
    refetchInterval: 30000,
  });
  const isHometaxPaused = !!hometaxPausedUntil;
  const hometaxPauseMut = useMutation({
    mutationFn: async () => {
      if (isHometaxPaused) { await clearHometaxPause(companyId!); return false; }
      await setHometaxPause(companyId!, 30); return true;
    },
    onSuccess: (paused) => {
      queryClient.invalidateQueries({ queryKey: ["hometax-sync-paused", companyId] });
      toast(paused ? "홈택스 연동을 30분간 정지했습니다 — 홈택스에 직접 로그인해도 동기화가 겹치지 않습니다" : "홈택스 연동 정지를 해제했습니다", "success");
    },
    onError: (e: any) => toast(friendlyError(e, "정지 처리 실패"), "error"),
  });
  // 2026-05-21 사장님 요청: "matching" 탭 통째 제거. ?tab=matching 딥링크는 분석 허브로 리다이렉트(별건 — 우선 sales 폴백).
  const searchParams = useSearchParams();
  const { isMaster: taxTabMaster, hasPerm: taxTabPerm } = useMyPermissions();
  const taxTabAllowed = (k: string) => taxTabMaster || taxTabPerm(`/tax-invoices:${k}`);
  const [tab, setTab] = useState<"sales" | "purchase" | "vat" | "summary" | "queue" | "sync">(() => {
    const t = searchParams?.get("tab");
    if (t === "sales" || t === "purchase" || t === "vat" || t === "summary" || t === "queue" || t === "sync") {
      return t;
    }
    return "sales";
  });
  // (P3) 미허용 탭 진입 시 첫 허용 탭으로
  useEffect(() => {
    if (!taxTabAllowed(tab)) {
      const first = (["sales", "purchase", "vat", "summary", "queue", "sync"] as const).find((k) => taxTabAllowed(k));
      if (first) setTab(first);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, taxTabMaster]);

  // ?tab= 딥링크는 마운트 시에만 반영됐음 — 이미 이 페이지에 있는 상태에서 대시보드의
  //   '부가세 납부'(?tab=vat) 링크를 눌러도 탭이 안 바뀌던 문제. searchParams 변경도 동기화.
  useEffect(() => {
    const t = searchParams?.get("tab");
    if (t === "sales" || t === "purchase" || t === "vat" || t === "summary" || t === "queue" || t === "sync") {
      setTab(t);
    }
  }, [searchParams]);
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
  // 동기화 기간 = 상단 조회기간(viewFromMonth~viewToMonth) 공용 — 별도 월 피커 이원화 제거 (기준 통일)
  // 불러오기는 현금영수증 화면과 동일하게 백그라운드 job 하나로 통일 (2026-07-31 사장님 "방식 통일").
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
  // 직원 QA #6 — 백그라운드 job 이 hang(CF-12200 등) 하면 completed/failed 로 안 바뀌어 버튼이 영구 잠김.
  //   멈춘 job 을 failed 로 마킹(서버 409 잠금까지 해제) + 로컬 해제 → 다시 시도 가능. (CODEF 수집 로직 미접촉)
  const forceClearStuckJob = async (jid: string, silent = false) => {
    const db = supabase;
    try {
      await db.from("hometax_sync_jobs").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", jid).in("status", ["pending", "running"]);
    } catch { /* best-effort */ }
    setActiveJobId(null);
    if (!silent) toast("멈춘 백그라운드 동기화를 해제했습니다. 다시 시도할 수 있습니다.", "info");
  };
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
    // 홈택스 연동 일시정지 중이면 시작하지 않음 — 현금영수증 화면과 동일한 가드(2026-07-31 통일)
    if (isHometaxPaused) {
      const t = new Date(hometaxPausedUntil!).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
      toast(`홈택스 연동 일시정지 중 (${t}까지) — 정지를 해제한 뒤 다시 시도하세요.`, 'info');
      return;
    }
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

  // matchFilter state 는 3-way 매칭 페이지(/reports/three-way-match)로 이전됨 (2026-05-21).
  const [matchDealPopup, setMatchDealPopup] = useState<any>(null);
  // 거래매칭 — 목록에서 통장 입출금 거래를 바로 연결 (인라인 팝업)
  const [linkInvoice, setLinkInvoice] = useState<any>(null);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [expandedDupKey, setExpandedDupKey] = useState<string | null>(null);
  //   점검 리포트는 접힌 채로 시작한다 — 목록이 첫 화면에 올라오게 (2026-08-10)
  const [checkOpen, setCheckOpen] = useState(false);
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
    taxKind: "taxable" | "zero_rated" | "exempt"; // 과세/영세율/면세 — 영세율·면세는 세액 0
    itemName: string;
    itemSpec: string;
    itemQty: string;
    itemUnitPrice: string;
    // 거래처 정보 — 계산서에 찍히고 국세청으로 나간다 (2026-08-10)
    counterpartyRepresentative: string;
    counterpartyAddress: string;
    counterpartyEmail: string;
    // 품목 줄 — 계산서 한 장에 여러 줄
    items: ItemLine[];
  };
  // 품목 줄 — 화면에서는 문자열로 다루고 저장할 때 숫자로 바꾼다 (입력 중 0 이 튀지 않게)
  type ItemLine = { key: string; name: string; spec: string; qty: string; unitCost: string };
  const itemKeyRef = useRef(0);
  const blankItem = (): ItemLine => ({ key: `i${itemKeyRef.current++}`, name: "", spec: "", qty: "1", unitCost: "" });
  //   한 줄 공급가액 = 수량 × 단가. 수량이 비면 1 로 본다.
  const itemSupply = (it: ItemLine) => Math.round((Number(it.qty) || 1) * (Number(it.unitCost) || 0));

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
    taxKind: "taxable",
    itemName: "",
    itemSpec: "",
    itemQty: "1",
    itemUnitPrice: "",
    counterpartyRepresentative: "",
    counterpartyAddress: "",
    counterpartyEmail: "",
    items: [blankItem()],
  });
  const [rows, setRows] = useState<FormRow[]>(() => [blankRow()]);
  const [dropdownRowKey, setDropdownRowKey] = useState<string | null>(null);
  //   한 장 쓰기(품목 여러 줄) / 여러 장 한꺼번에(한 줄 = 한 장) — 2026-08-10
  const [formMode, setFormMode] = useState<"single" | "multi">("single");
  const [savePartnerInfo, setSavePartnerInfo] = useState(true);
  const patchRow = (key: string, patch: Partial<FormRow>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const removeRow = (key: string) =>
    setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.key !== key) : [blankRow()]));

  //   계산서 공급가액 = 품목 줄 합계. 규칙이 하나뿐이라 '계산' 버튼이 필요 없어졌다.
  const rowSupply = (r: FormRow) => r.items.reduce((s, it) => s + itemSupply(it), 0);
  const isRowValid = (r: FormRow) =>
    !!r.counterpartyName.trim() && !!r.issueDate && rowSupply(r) > 0;

  const patchItem = (rowKey: string, itemKey: string, patch: Partial<ItemLine>) =>
    setRows((rs) => rs.map((r) => (r.key === rowKey
      ? { ...r, items: r.items.map((it) => (it.key === itemKey ? { ...it, ...patch } : it)) }
      : r)));
  const addItem = (rowKey: string) =>
    setRows((rs) => rs.map((r) => (r.key === rowKey ? { ...r, items: [...r.items, blankItem()] } : r)));
  const removeItem = (rowKey: string, itemKey: string) =>
    setRows((rs) => rs.map((r) => (r.key === rowKey
      ? { ...r, items: r.items.length > 1 ? r.items.filter((it) => it.key !== itemKey) : [blankItem()] }
      : r)));

  //   마지막 줄 끝에서 Tab = 새 줄. 여러 줄을 연달아 칠 때 마우스로 손이 안 가게 (2026-08-10)
  const onItemKeyDown = (e: React.KeyboardEvent, rowKey: string, itemKey: string) => {
    if (e.key !== "Tab" || e.shiftKey) return;
    const row = rows.find((r) => r.key === rowKey);
    if (!row || row.items[row.items.length - 1]?.key !== itemKey) return;
    const it = row.items[row.items.length - 1];
    if (!it.name.trim()) return;             // 빈 줄에서 Tab 은 그냥 넘어간다
    addItem(rowKey);
  };
  //   엑셀에서 여러 줄 붙여넣기 — 탭으로 나뉜 칸을 품목명·규격·수량·단가로 채운다
  const onItemPaste = (e: React.ClipboardEvent, rowKey: string, itemKey: string) => {
    const text = e.clipboardData.getData("text/plain");
    if (!/[\n\t]/.test(text)) return;                          // 한 칸 붙여넣기는 기본 동작 그대로
    e.preventDefault();
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const parsed: ItemLine[] = lines.map((l) => {
      const [name = "", spec = "", qty = "", unit = ""] = l.split("\t");
      return {
        key: `i${itemKeyRef.current++}`,
        name: name.trim(),
        spec: spec.trim(),
        qty: qty.replace(/[^\d.]/g, "") || "1",
        unitCost: unit.replace(/[^\d.]/g, ""),
      };
    });
    if (parsed.length === 0) return;
    setRows((rs) => rs.map((r) => {
      if (r.key !== rowKey) return r;
      const at = r.items.findIndex((it) => it.key === itemKey);
      const next = [...r.items];
      next.splice(at, 1, ...parsed);          // 붙여넣기 시작 줄을 첫 줄로 대체
      return { ...r, items: next };
    }));
  };

  //   거래처를 고르면 계산서에 찍힐 값들을 한꺼번에 채운다
  const applyPartner = (rowKey: string, p: any) => patchRow(rowKey, {
    counterpartyName: p.name,
    counterpartyBizno: p.business_number || "",
    counterpartyBusinessType: p.business_type || "",
    counterpartyBusinessItem: p.business_item || "",
    counterpartyRepresentative: p.representative || "",
    counterpartyAddress: p.address || "",
    counterpartyEmail: p.contact_email || "",
    partnerId: p.id,
  });

  //   발행에 필요한데 비어 있는 것 — 입력 단계에서 알려 준다(발행 때 빈칸으로 나가는 걸 막는다)
  const missingBuyerFields = (r: FormRow) => {
    const out: string[] = [];
    if (!r.counterpartyBizno.trim()) out.push("등록번호");
    if (!r.counterpartyRepresentative.trim()) out.push("대표자");
    if (!r.counterpartyBusinessType.trim() && !r.counterpartyBusinessItem.trim()) out.push("업태/종목");
    if (!r.counterpartyEmail.trim()) out.push("받을 이메일");
    return out;
  };

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
      // 조회기간을 넓게 잡으면 1000행(서버 max_rows) 초과 — 절단 방지 페이징 (prod 계산서 1351건)
      return fetchPaged("taxInvoices.list", () => supabase
        .from("tax_invoices")
        .select("*, deals(name), label, revenue_schedule_id, partners(business_type, business_item, representative, contact_email, address)")
        .eq("company_id", companyId!)
        // 전자계산서(면세, doc_kind='exempt')는 전용 탭(/e-invoices)에서 — 이 화면은 세금계산서만 (2026-08-10)
        .eq("doc_kind", "tax")
        .gte("issue_date", startDate)
        .lte("issue_date", endDate)
        .order("issue_date", { ascending: false })
        .order("id", { ascending: false }), 10000);
    },
    enabled: !!companyId,
  });

  // Partners for counterparty selection
  const { data: partners = [] } = useQuery({
    queryKey: ["partners-for-invoice", companyId],
    queryFn: async () => {
      const data = logRead('tax-invoices/page:data', await supabase
        .from("partners")
        .select("id, name, business_number, contact_email, business_type, business_item, representative, address")
        .eq("company_id", companyId!)
        .eq("is_active", true)
        .order("name"));
      return data || [];
    },
    enabled: !!companyId,
  });

  // 전표처리용 계정과목 (일괄 전표 모달)
  const { data: coaAccounts = [] } = useQuery({
    queryKey: ["tax-invoice-coa-accounts", companyId],
    queryFn: async () => {
      const data = logRead('tax-invoices/page:data', await (supabase).from("chart_of_accounts").select("id, code, name, account_type").eq("company_id", companyId!).order("code"));
      return (data || []) as any[];
    },
    enabled: !!companyId, staleTime: 300_000,
  });

  // 직원 QA 손익계산서 — 매입 세금계산서에 손익 계정과목(expense_category) 일괄 지정.
  //   지정하면 손익계산서에서 매출원가(COGS) 대신 그 판관비 항목으로 집계됨.
  const [bulkExpenseCat, setBulkExpenseCat] = useState("");
  const applyBulkExpenseCat = async () => {
    if (!bulkExpenseCat || selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    const { error } = await (supabase).from("tax_invoices").update({ expense_category: bulkExpenseCat }).in("id", ids);
    if (error) { toast("계정과목 지정 실패: " + error.message, "error"); return; }
    toast(`매입 세금계산서 ${ids.length}건에 '${bulkExpenseCat}' 지정 — 손익계산서에서 매출원가 대신 판관비로 반영됩니다`, "success");
    setBulkExpenseCat(""); setSelectedIds(new Set());
    queryClient.invalidateQueries({ queryKey: ["tax-invoices-full"] });
  };

  // Deals for linking
  const { data: dealsForLink = [] } = useQuery({
    queryKey: ["deals-for-invoice", companyId],
    queryFn: async () => {
      const data = logRead('tax-invoices/page:data', await supabase
        .from("deals")
        .select("id, name, contract_total")
        .eq("company_id", companyId!)
        .neq("status", "archived")
        .order("name"));
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
      // 공급자 이메일 — companies 에 email 컬럼이 없어 상세 화면에서 항상 '-' 로 나오던 문제(2026-08-05 사장님 제보).
      //   실제 계산서에 찍히는 발행자 이메일과 같은 출처를 쓴다: automation_settings.invoicer_email → 없으면 대표 계정 이메일
      //   (hometax-issue 엣지 함수의 발행자 이메일 결정 순서와 동일).
      const data = logRead('tax-invoices/page:data', await (supabase).from('companies').select('name, business_number, representative, address, business_type, business_category, automation_settings').eq('id', companyId!).maybeSingle());
      if (!data) return data;
      let email = (data as any)?.automation_settings?.invoicer_email || '';
      if (!email) {
        const owner = logRead('tax-invoices/page:owner-email', await (supabase)
          .from('users').select('email').eq('company_id', companyId!).eq('role', 'owner')
          .order('created_at').limit(1).maybeSingle());
        email = (owner as any)?.email || '';
      }
      return { ...(data as any), email };
    },
    enabled: !!companyId,
  });

  // 요금제별 세금계산서 국세청 발행 월간 한도 (프로=10건, 울트라=무제한)
  const { data: issuanceStatus } = useQuery({
    queryKey: ["tax-invoice-issuance-status", companyId],
    queryFn: () => getTaxInvoiceIssuanceStatus(companyId!),
    enabled: !!companyId,
    staleTime: 60_000,
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
      const db = supabase;
      const data = logRead('tax-invoices/page:data', await db
        .from('hometax_sync_log')
        .select('completed_at')
        .eq('company_id', companyId!)
        .eq('status', 'completed')
        .order('completed_at', { ascending: false })
        .limit(1));
      return data?.[0]?.completed_at || null;
    },
    enabled: !!companyId,
  });

  // Incremental sync 기준 시각 — company_settings.last_hometax_sync_at
  const { data: lastHometaxSyncAt } = useQuery({
    queryKey: ["last-hometax-sync-at", companyId],
    queryFn: async () => {
      const db = supabase;
      const data = logRead('tax-invoices/page:data', await db
        .from('company_settings')
        .select('last_hometax_sync_at')
        .eq('company_id', companyId!)
        .maybeSingle());
      // react-query 는 undefined 반환을 에러로 취급 — 행/컬럼 없으면 null 로 정규화 (2026-07-16 QA)
      return (data?.last_hometax_sync_at ?? null) as string | null;
    },
    enabled: !!companyId,
  });

  // 페이지 mount 시 — 진행 중인 background job 감지 (사용자가 페이지 떠났다 다시 와도 진행 표시).
  useEffect(() => {
    if (!companyId || activeJobId) return;
    (async () => {
      const db = supabase;
      const data = logRead('tax-invoices/page:data', await db
        .from('hometax_sync_jobs')
        .select('id, status, updated_at')
        .eq('company_id', companyId)
        .in('status', ['pending', 'running'])
        .gt('updated_at', new Date(Date.now() - 30 * 60 * 1000).toISOString())
        .order('created_at', { ascending: false })
        .limit(1));
      if (data && data[0]) setActiveJobId(data[0].id);
    })();
  }, [companyId, activeJobId]);

  // Background sync job — Realtime 구독해서 진행 상황 표시.
  const { data: activeJob } = useQuery({
    queryKey: ["hometax-sync-job", activeJobId],
    queryFn: async () => {
      if (!activeJobId) return null;
      const db = supabase;
      const data = logRead('tax-invoices/page:data', await db
        .from('hometax_sync_jobs')
        .select('*')
        .eq('id', activeJobId)
        .maybeSingle());
      return data;
    },
    enabled: !!activeJobId,
    refetchInterval: activeJobId ? 2000 : false,  // 2초 polling (Realtime 보조)
  });

  useEffect(() => {
    if (!activeJobId || !companyId) return;
    const db = supabase;
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

  // 멈춘 job 자동 감지 — 이미 끝났거나 30분+ 진척 없으면(=hang) 자동 해제해 버튼 잠금 풀기
  useEffect(() => {
    if (!activeJobId || !activeJob) return;
    if (activeJob.status === "completed" || activeJob.status === "failed") { setActiveJobId(null); return; }
    const upd = activeJob.updated_at ? new Date(activeJob.updated_at).getTime() : 0;
    if (upd && Date.now() - upd > 30 * 60 * 1000) { void forceClearStuckJob(activeJobId); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeJob, activeJobId]);

  // (page chain 제거 — layout 의 HometaxBackgroundChain 만 단독으로 chain 추진. 이중 호출 시 CF-00016 발생.)

  // 홈택스 연결 상태 — automation_credentials.hometax 존재 여부 (codef-sync edge function이 실제로 사용하는 자격증명)
  const { data: hometaxConnection } = useQuery({
    queryKey: ["hometax-connection", companyId],
    queryFn: async () => {
      const db = supabase;
      const data = logRead('tax-invoices/page:data', await db
        .from('automation_credentials')
        .select('id, updated_at, credentials')
        .eq('company_id', companyId!)
        .eq('service', 'hometax')
        .maybeSingle());
      return data ? {
        connected: true,
        method: (data.credentials as any)?.login_method as 'certificate' | 'id_pw' | undefined,
        connectedAt: data.updated_at as string | undefined,
      } : { connected: false };
    },
    enabled: !!companyId,
  });
  const isHometaxConnected = !!hometaxConnection?.connected;

  // Excel import handler
  const [showBulkIssue, setShowBulkIssue] = useState(false);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["tax-invoices-full"] });
  };

  const createMut = useMutation({
    // 유효한 모든 행을 일괄 등록
    mutationFn: async () => {
      //   '한 장 쓰기' 는 첫 행만, '여러 장' 은 유효한 행 전부
      const valid = (formMode === "single" ? rows.slice(0, 1) : rows).filter(isRowValid);
      for (const r of valid) {
        //   품목 줄 — 이름이 있는 줄만 저장한다. 계산서 공급가액은 줄 합계다.
        const items = r.items
          .filter((it) => it.name.trim())
          .map((it) => ({
            name: it.name.trim(),
            spec: it.spec.trim(),
            qty: Number(it.qty) || 1,
            unitCost: Math.round(Number(it.unitCost) || 0),
            supplyAmount: itemSupply(it),
          }));
        await createTaxInvoice({
          companyId: companyId!,
          type: r.type,
          counterpartyName: r.counterpartyName,
          counterpartyBizno: r.counterpartyBizno || undefined,
          counterpartyBusinessType: r.counterpartyBusinessType || undefined,
          counterpartyBusinessItem: r.counterpartyBusinessItem || undefined,
          counterpartyRepresentative: r.counterpartyRepresentative || undefined,
          counterpartyAddress: r.counterpartyAddress || undefined,
          counterpartyEmail: r.counterpartyEmail || undefined,
          supplyAmount: rowSupply(r),
          issueDate: r.issueDate,
          preferredDate: r.preferredDate || undefined,
          expenseCategory: r.expenseCategory || undefined,
          dealId: r.dealId || undefined,
          partnerId: r.partnerId || undefined,
          taxKind: r.taxKind,
          items,
          // 품목은 item_name 으로 — label 에 섞으면 홈택스 품목이 "용역"으로 발행된다(2026-08-05 교정).
          //   여러 줄이면 첫 줄 이름을 넣어 목록·옛 폴백과 호환을 유지한다.
          //   label 에는 영수/청구 토큰만 남긴다(발행 엣지가 purposeType 판정에 사용).
          itemName: items[0]?.name || undefined,
          label: r.purpose || undefined,
        });

        //   거래처 정보에도 저장 — 다음 발행부터 자동으로 채워진다 (2026-08-10 사장님)
        if (savePartnerInfo && r.partnerId) {
          const patch: Record<string, string> = {};
          if (r.counterpartyRepresentative.trim()) patch.representative = r.counterpartyRepresentative.trim();
          if (r.counterpartyAddress.trim()) patch.address = r.counterpartyAddress.trim();
          if (r.counterpartyEmail.trim()) patch.contact_email = r.counterpartyEmail.trim();
          if (r.counterpartyBusinessType.trim()) patch.business_type = r.counterpartyBusinessType.trim();
          if (r.counterpartyBusinessItem.trim()) patch.business_item = r.counterpartyBusinessItem.trim();
          if (Object.keys(patch).length > 0) {
            //   거래처 갱신이 실패해도 계산서 등록은 살린다(권한 없는 멤버 등)
            await supabase.from("partners").update(patch as never).eq("id", r.partnerId);
          }
        }
      }
      return valid.length;
    },
    onSuccess: (count: number) => {
      toast(`세금계산서 ${count}장이 등록되었습니다. 홈택스 전자발행은 목록에서 해당 건을 눌러 별도로 진행하세요.`, "success");
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
  // 목록 표 컬럼 리사이즈 — 경계선 드래그로 너비 조절 · 더블클릭 내용 자동맞춤 · localStorage 기억 (2026-07-14)
  const listTableRef = useRef<HTMLTableElement | null>(null);
  const [colW, setColW] = useColWidths("tax-invoice-list-colw-v3", {
    //   승인번호(nts)·전송(send)은 상세로 옮겨 컬럼이 없어졌다 (2026-08-10).
    //   기억해 둔 너비가 옛 컬럼 순서로 되살아나지 않게 저장 키도 v3 으로 올린다.
    issue_date: 104, counterparty_name: 200, label: 170,
    supply_amount: 118, tax_amount: 104, total_amount: 124, status: 96, act: 132,
  });
  const startColDrag = (k: string, e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX; const startW = colW[k] || 100;
    const move = (ev: MouseEvent) => setColW(k, Math.max(44, startW + (ev.clientX - startX)));
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); document.body.style.cursor = ""; };
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
  };
  const autofitCol = (k: string, colIndex: number) => {
    const table = listTableRef.current; if (!table) return;
    let max = 44;
    table.querySelectorAll("tr").forEach((tr) => { const cell = tr.children[colIndex] as HTMLElement | undefined; if (cell) max = Math.max(max, cell.scrollWidth); });
    setColW(k, Math.min(640, max + 14));
  };
  const ColHandle = ({ k, colIndex }: { k: string; colIndex: number }) => (
    <span onMouseDown={(e) => startColDrag(k, e)} onDoubleClick={() => autofitCol(k, colIndex)} onClick={(e) => e.stopPropagation()}
      className="absolute top-0 -right-[3px] h-full w-[7px] cursor-col-resize select-none z-[1] hover:bg-[var(--primary)]/35 active:bg-[var(--primary)]/55 rounded"
      title="드래그: 너비 조절 · 더블클릭: 내용에 맞춤" />
  );
  const invSortTh = (k: InvSortKey, label: string, cls: string, colIndex: number) => (
    <th className={`px-3 py-2.5 font-semibold whitespace-nowrap border-l border-[var(--border)]/50 ${cls} cursor-pointer select-none hover:text-[var(--text)] transition`}
        style={{ width: colW[k], position: "relative" }} onClick={() => toggleInvSort(k)}>
      <span className={`inline-flex items-center gap-1 ${cls.includes("text-right") ? "justify-end w-full" : cls.includes("text-center") ? "justify-center w-full" : ""}`}>
        {label}
        <span className={`text-[9px] ${invSortKey === k ? "text-[var(--primary)]" : "text-[var(--text-dim)]/40"}`}>{invSortKey === k ? (invSortDir === "asc" ? "▲" : "▼") : "↕"}</span>
      </span>
      <ColHandle k={k} colIndex={colIndex} />
    </th>
  );
  // 대량 목록 렌더 상한 — 넓은 기간 선택 시 최대 1만 건 일괄 DOM 렌더로 화면이 멈추던 것 방지 (합계·건수는 전체 기준 유지)
  const [visibleRows, setVisibleRows] = useState(200);
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
      a.tax += r.taxKind === "taxable" ? Math.round(s * 0.1) : 0; // 영세율·면세 = 세액 0
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
    const { ok: delOk } = await confirmDialog({ title: `선택 ${selectedDeletable.length}건 삭제`, desc: "홈택스 미발행 건만 삭제되며, 되돌릴 수 없습니다.", danger: true });
    if (!delOk) return;
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
    const db = supabase;
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
      {confirmElement}
      <QueryErrorBanner error={mainError as Error | null} onRetry={mainRefetch} />
      {/* 한 줄짜리 머리 — [탭] ·········· [기간 ▾] [가져오기 ▾] [+ 등록]  (2026-08-10 사장님 지시로 정리)
          예전엔 기간 줄과 액션 줄이 따로 있어 두 줄을 먹었고, 파란 채움 버튼이 셋이라 어디를 눌러야 할지
          알기 어려웠다. 기간은 눌러야 열리는 칩으로, 가끔 쓰는 일은 '가져오기' 안으로 접었다. */}
      <div className="tax-invoice-tabs no-print">
        <div className="seg-bar flex-wrap">
          {[
            { key: "sales" as const, label: "매출", count: salesInvoices.length },
            { key: "purchase" as const, label: "매입", count: purchaseInvoices.length },
            { key: "queue" as const, label: "자동발행", count: null },
            { key: "summary" as const, label: "기간별 집계", count: null },
          ].filter((t) => taxTabAllowed(t.key)).map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)} className={`seg-item ${tab === t.key ? "seg-item-active" : ""}`}>
              {t.label}{t.count !== null && <span className="text-xs opacity-70 ml-1">({t.count})</span>}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-1.5 flex-wrap">
          {issuanceStatus && issuanceStatus.limit !== null && (
            <span
              className="tax-invoice-issuance-badge"
              style={{
                background: issuanceStatus.remaining === 0 ? "color-mix(in srgb, #ef4444 12%, transparent)" : "var(--bg-surface)",
                borderColor: issuanceStatus.remaining === 0 ? "#ef4444" : "var(--border)",
                color: issuanceStatus.remaining === 0 ? "#ef4444" : "var(--text-muted)",
              }}
              title={`${issuanceStatus.planName || "현재 요금제"} — 세금계산서·현금영수증 합산 월 ${issuanceStatus.limit}건까지 발행할 수 있습니다 (이번 달 ${issuanceStatus.used}건 사용 · 세금계산서+현금영수증 ${issuanceStatus.used}/${issuanceStatus.limit})`}
            >
              발행 <b className="mono-number">{issuanceStatus.remaining ?? 0}건</b> 남음
            </span>
          )}

          {/* 조회기간 — 눌렀을 때만 열린다. 빠른기간은 그 안에 작은 글씨로 (2026-08-10 사장님) */}
          {(tab === "sales" || tab === "purchase") && (
            <ToolbarPopover label={<span className="mono-number">{viewFromMonth} ~ {viewToMonth}</span>} title="조회기간" width={244}>
              {() => (
                <>
                  <div className="period-pop-fields">
                    <MonthField
                      value={viewFromMonth}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (!v) return;
                        setViewFromMonth(v);
                        if (v > viewToMonth) setViewToMonth(v);  // from > to 면 to 도 맞춤
                      }}
                      className="flex-1 px-2 py-1 text-xs bg-[var(--bg-surface)] border border-[var(--border)] rounded text-[var(--text)]"
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
                      className="flex-1 px-2 py-1 text-xs bg-[var(--bg-surface)] border border-[var(--border)] rounded text-[var(--text)]"
                      aria-label="조회 종료 월"
                    />
                  </div>
                  <div className="period-pop-quick">
                    {([["1개월", 0], ["3개월", 2], ["6개월", 5], ["1년", 11]] as const).map(([l, back]) => {
                      const d = new Date();
                      d.setMonth(d.getMonth() - back);
                      const from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
                      const on = viewFromMonth === from && viewToMonth === getCurrentMonth();
                      return (
                        <button key={l} type="button" className={on ? "on" : ""}
                          onClick={() => { setViewFromMonth(from); setViewToMonth(getCurrentMonth()); }}>
                          {l}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </ToolbarPopover>
          )}

          {/* 가져오기·내보내기 — 가끔 쓰는 일들을 한 곳에 모았다 */}
          <ToolbarPopover label="가져오기" title="가져오기 · 내보내기" width={232}>
            {(close) => (
              <>
                {!isHometaxConnected ? (
                  <Link href="/settings?tab=bank" className="toolbar-pop-item" onClick={close}>
                    홈택스 연결 필요 (설정 &gt; 은행연동)
                  </Link>
                ) : (
                  <ToolbarPopoverItem
                    onClick={() => { close(); hometaxCd.run(() => runHometaxSyncBackground(viewFromMonth, viewToMonth)); }}
                    disabled={!!activeJobId || hometaxCd.disabled}
                    hint={hometaxCd.disabled
                      ? `30분 쿨타임 — ${hometaxCd.label}`
                      : `조회기간(${viewFromMonth} ~ ${viewToMonth}) 범위로 홈택스에 이미 발행된 세금계산서를 가져옵니다${lastSyncData ? ` · 마지막 업데이트 ${new Date(lastSyncData).toLocaleString("ko", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}` : ""}`}>
                    <span aria-live="polite">
                      {activeJobId
                        ? `가져오는 중 ${(activeJob?.current_progress as any)?.done || 0}/${(activeJob?.current_progress as any)?.total || 0}`
                        : hometaxCd.disabled ? `홈택스에서 가져오기 (${hometaxCd.label})`
                        : "홈택스에서 가져오기"}
                    </span>
                  </ToolbarPopoverItem>
                )}
                <ToolbarPopoverItem onClick={() => { close(); setShowBulkIssue(true); }}
                  hint="엑셀 양식으로 여러 건을 한 번에 국세청 전자발행합니다">
                  엑셀 일괄발행
                </ToolbarPopoverItem>
                {(tab === "sales" || tab === "purchase") && currentList.length > 0 && (
                  <ToolbarPopoverItem
                    onClick={async () => {
                      close();
                      const { exportTaxInvoicesDouzone } = await import("@/lib/export-douzone");
                      exportTaxInvoicesDouzone(currentList as any, `${viewFromMonth}_${viewToMonth}`);
                    }}
                    hint="현재 목록을 엑셀로 내보내기">
                    엑셀 내보내기
                  </ToolbarPopoverItem>
                )}
                <div className="toolbar-pop-sep" />
                <ToolbarPopoverItem onClick={() => { close(); hometaxPauseMut.mutate(); }} disabled={hometaxPauseMut.isPending}
                  hint="홈택스 연동 잠시 멈추기 (30분) — 홈택스 사이트에 직접 로그인할 때 우리 앱의 동기화 로그인이 겹치는 것을 막습니다">
                  {isHometaxPaused
                    ? `연동 정지 해제 (${new Date(hometaxPausedUntil!).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}까지)`
                    : "홈택스 연동 정지"}
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

          {/*  btn-sm = 32px — 옆 가져오기·기간 칩과 같은 높이 (btn-primary 기본 40px 이라 따로 맞춘다) */}
          <button onClick={() => setShowForm(true)} className="btn-primary btn-sm" title="세금계산서를 등록합니다">
            + 등록
          </button>
        </div>
      </div>

      {/* 매출·매입 목록의 요약·경고 — 이 두 탭에서만 노출 (집계·자동발행 탭엔 중복이라 숨김) */}
      {(tab === "sales" || tab === "purchase") && (<>
      {/* 중복의심·주의할계산서·필수확인 3블록 → 아래 「점검 리포트」 카드로 통합(2026-07-13) */}

      {/* 요약 — 카드 4장을 한 줄 스트립으로 (2026-08-10 사장님: "요약이 화면의 대부분을 먹는다").
          '딜 미연결'은 요약이 아니라 **할 일**이라 아래 점검 리포트 한 곳으로 모았다 — 같은 숫자가
          한 화면에 두 번 나오던 것도 이걸로 없어진다. */}
      <div className="doc-summary-strip" data-print-area>
        <div className="doc-summary-cell">
          <span>매출 {salesInvoices.length.toLocaleString()}건</span>
          <b>{fmt(totalSales)}</b>
        </div>
        <div className="doc-summary-cell">
          <span>매입 {purchaseInvoices.length.toLocaleString()}건</span>
          <b>{fmt(totalPurchase)}</b>
        </div>
        <div className="doc-summary-cell doc-summary-cell-link" role="button" tabIndex={0}
          onClick={() => setTab("vat")} onKeyDown={(e) => { if (e.key === "Enter") setTab("vat"); }}
          title={`매출세액 ${fmt(salesInvoices.reduce((s: number, inv: any) => s + Number(inv.tax_amount || 0), 0))} − 매입세액 ${fmt(purchaseInvoices.reduce((s: number, inv: any) => s + Number(inv.tax_amount || 0), 0))} · 클릭하면 분기별 납부 예상으로 이동`}>
          <span>예상 부가세 {vatEstimate >= 0 ? "납부" : "환급"}</span>
          <b>{fmt(Math.abs(vatEstimate))}</b>
        </div>
      </div>

      {/* 점검 리포트 — 중복의심·딜 미연결·작성중·홈택스 미발행을 한 카드로 통합(2026-07-13, 3블록 압축).
          예상 부가세는 위 KPI 카드에 이미 있어 제외(중복 방지). */}
      {(() => {
        const dups = duplicateInvoices.filter((d) => !dismissedDups.has(d.key));
        const draftCount = invoices.filter((i: any) => i.status === "draft").length;
        const unissued = invoices.filter((i: any) => i.type === "sales" && i.status !== "draft" && !i.nts_confirm_no).length;
        const items = [
          { key: "dup", label: "중복 의심", count: dups.length, tone: "warning" as const, hint: "동일 거래처·금액·일자", expandable: true },
          { key: "unmatched", label: "딜 미연결", count: unmatched, tone: "danger" as const, hint: "거래/입금 매칭 필요" },
          { key: "draft", label: "작성 중 (미발행)", count: draftCount, tone: "warning" as const, hint: "홈택스 발행 권장" },
          { key: "unissued", label: "홈택스 미발행", count: unissued, tone: "warning" as const, hint: "국세청 승인번호 없음" },
        ].filter((it) => it.count > 0);
        //   손댈 것 = 중복 의심 · 작성 중 · 홈택스 미발행. '딜 미연결'은 대개 전체 건수와 맞먹는
        //   기본 상태라 머리 숫자에서 뺐다 — 늘 켜져 있는 경고는 아무것도 경고하지 못한다 (2026-08-10).
        const todo = items.filter((it) => it.key !== "unmatched").reduce((s, it) => s + it.count, 0);
        //   처리할 것이 없으면 **줄 자체를 감춘다**
        if (todo === 0) return null;
        return (
          <div className="doc-check-bar no-print">
            <button type="button" className="doc-check-head" onClick={() => setCheckOpen((v) => !v)} aria-expanded={checkOpen}>
              <b>처리할 것 {todo}건</b>
              <span>{items.filter((it) => it.key !== "unmatched").map((it) => `${it.label} ${it.count}`).join(" · ")}</span>
              <i>{checkOpen ? "접기 ▴" : "펼치기 ▾"}</i>
            </button>
            {checkOpen && (
              <div className="doc-check-body divide-y divide-[var(--border)]">
                {items.map((it) => (
                  <div key={it.key}>
                    <div className="flex items-center gap-3 py-2.5">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${it.tone === "danger" ? "bg-[var(--danger)]" : "bg-[var(--warning)]"}`} />
                      <div className="min-w-0 flex-1">
                        <span className="text-sm font-semibold text-[var(--text)]">{it.label}</span>
                        <span className="text-xs text-[var(--text-dim)] ml-2">{it.hint}</span>
                      </div>
                      <span className={`text-sm font-bold mono-number ${it.tone === "danger" ? "text-[var(--danger)]" : "text-[var(--warning)]"}`}>{it.count}건</span>
                      {it.expandable && (
                        <button type="button" onClick={() => setExpandedDupKey(expandedDupKey ? null : (dups[0]?.key ?? null))}
                          className="text-[11px] px-2 py-1 rounded-lg bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text)] transition shrink-0">
                          {expandedDupKey ? "접기" : "펼치기"}
                        </button>
                      )}
                    </div>
                    {/* 중복 의심 상세 — 그룹별 계산서 리스트 + 상세/삭제/중복아님 */}
                    {it.key === "dup" && expandedDupKey && dups.length > 0 && (
                      <div className="pb-3 pl-4 space-y-3">
                        {dups.map((dup) => {
                          const dupInvs = invoices.filter((inv: any) => dup.ids.includes(inv.id));
                          return (
                            <div key={dup.key} className="rounded-lg border border-[var(--warning)]/25 bg-[var(--warning)]/5 p-3">
                              <div className="text-xs font-semibold text-[var(--text)] mb-2">
                                {dup.counterpartyName} — {fmt(dup.amount)} — {dup.date} <span className="text-[var(--warning)]">({dup.count}건 동일)</span>
                              </div>
                              <div className="space-y-2">
                                {dupInvs.map((inv: any) => (
                                  <div key={inv.id} className="flex items-center gap-3 bg-[var(--bg-card)] rounded-lg px-3 py-2 border border-[var(--border)]">
                                    <div className="flex-1 text-xs min-w-0">
                                      <span className="font-medium">{inv.counterparty_name}</span>
                                      <span className="text-[var(--text-muted)] mx-2">|</span>
                                      <span className="font-mono">₩{Number(inv.supply_amount).toLocaleString("ko-KR")}</span>
                                      <span className="text-[var(--text-dim)] ml-2">{inv.issue_date}</span>
                                      <span className="text-[var(--text-dim)] ml-2">({invoiceStatusMeta(inv.status, inv.type).label})</span>
                                    </div>
                                    <button type="button" onClick={() => setSelectedInvoice(inv)}
                                      className="text-[10px] px-2 py-1 rounded bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition shrink-0">상세</button>
                                    <button type="button" onClick={async () => {
                                      const { ok: rowOk } = await confirmDialog({ title: "세금계산서 삭제", desc: `${inv.counterparty_name} / ₩${Number(inv.total_amount).toLocaleString()}`, danger: true });
                                      if (!rowOk) return;
                                      await supabase.from("tax_invoices").delete().eq("id", inv.id);
                                      invalidate();
                                      toast("세금계산서가 삭제되었습니다", "success");
                                    }}
                                      className="text-[10px] px-2 py-1 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 transition shrink-0">삭제</button>
                                  </div>
                                ))}
                              </div>
                              <button type="button" onClick={() => {
                                setDismissedDups((prev) => {
                                  const next = new Set([...prev, dup.key]);
                                  try { localStorage.setItem(`tax-dup-dismissed-${companyId}`, JSON.stringify([...next])); } catch { /* noop */ }
                                  return next;
                                });
                                setExpandedDupKey(null);
                              }}
                                className="mt-2 text-[10px] px-3 py-1.5 rounded-lg bg-green-500/10 text-green-400 hover:bg-green-500/20 transition font-semibold">
                                ✓ 중복 아님 (이 그룹 숨기기)
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {/* 홈택스 스타일 조회조건 박스 (2026-06-12) — 라벨 셀 + 기간 + 빠른기간 + [조회하기].
          기간 변경은 즉시 반영(localStorage 유지), 조회하기 = 강제 새로고침(refetch). */}
      {/* 조회기간 컨트롤은 상단(헤더 아래)으로 이동 — 20260701 기간설정 위치 통일 */}

      {/* Registration Form — 2026-06-12 인라인 카드 → 중앙 팝업(모달) 전환. 폼/등록 로직 무변경 */}
      {showBulkIssue && companyId && (
        <TaxInvoiceBulkIssueModal companyId={companyId} onClose={() => setShowBulkIssue(false)} />
      )}
      {/* 세금계산서 쓰기 — 2026-08-10 전면 개편 (사장님 지시).
          · 계산서 한 장 = 거래처 한 곳 + **품목 여러 줄**. 예전 [+ 항목 추가]는 계산서를 한 장 더
            만드는 버튼이라 품목 줄을 늘릴 방법이 아예 없었다.
          · 거래처 정보(대표자·업태/종목·주소·받을 이메일)를 국세청 서식대로 **좌 공급자 / 우 공급받는자**
            로 펼친다 — 발행 때 빈칸으로 나가는 걸 입력 단계에서 알 수 있게.
          · 여러 장 모드는 표를 유지하되 사업자번호·대표자까지만 보여 준다(그 이상은 표가 감당 못 함). */}
      {showForm && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
        <div className="tax-invoice-registration-modal" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-[var(--border)] shrink-0 flex-wrap">
            <div>
              <h3 className="text-base font-bold">세금계산서 쓰기</h3>
              <p className="text-[11px] text-[var(--text-dim)] mt-0.5">
                {formMode === "single"
                  ? "계산서 한 장 — 품목은 몇 줄이든 넣을 수 있습니다"
                  : "한 줄이 계산서 한 장 — 품목이 여러 줄인 계산서는 ‘한 장 쓰기’로"}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="seg-bar">
                <button type="button" onClick={() => setFormMode("single")} className={`seg-item ${formMode === "single" ? "seg-item-active" : ""}`}>한 장 쓰기</button>
                <button type="button" onClick={() => setFormMode("multi")} className={`seg-item ${formMode === "multi" ? "seg-item-active" : ""}`}>여러 장 한꺼번에</button>
              </div>
              <button onClick={() => setShowForm(false)} className="text-[var(--text-dim)] hover:text-[var(--text)] text-xl leading-none transition" aria-label="닫기">✕</button>
            </div>
          </div>

          <div className="flex-1 overflow-auto px-6 py-4">
            {formMode === "single" ? (() => {
              const row = rows[0];
              const supply = rowSupply(row);
              const taxAmt = row.taxKind === "taxable" ? Math.round(supply * 0.1) : 0;
              const missing = missingBuyerFields(row);
              return (
                <div className="tax-form-single">
                  {/* 머리 — 유형 · 작성일자 · 거래처 찾기 */}
                  <div className="tax-form-head">
                    <div className="tax-form-field">
                      <label>유형</label>
                      <div className="seg-bar w-fit">
                        {INVOICE_TYPES.map((t) => (
                          <button key={t.value} type="button" onClick={() => patchRow(row.key, { type: t.value as "sales" | "purchase" })}
                            className={`seg-item ${row.type === t.value ? "seg-item-active" : ""}`}>{t.label}</button>
                        ))}
                      </div>
                    </div>
                    <div className="tax-form-field">
                      <label>작성일자 <i>*</i></label>
                      <DateField value={row.issueDate} max="9999-12-31"
                        onChange={(e) => {
                          const parts = e.target.value.split("-");
                          if (parts[0] && parts[0].length > 4) parts[0] = parts[0].slice(0, 4);
                          patchRow(row.key, { issueDate: parts.join("-") });
                        }}
                        className="field-input w-full px-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs" />
                    </div>
                    <div className="tax-form-field relative">
                      <label>거래처 찾기 <i>*</i></label>
                      <input
                        value={row.counterpartyName}
                        onChange={(e) => { patchRow(row.key, { counterpartyName: e.target.value, partnerId: "" }); setDropdownRowKey(row.key); }}
                        onFocus={() => { if (row.counterpartyName) setDropdownRowKey(row.key); }}
                        onBlur={() => setTimeout(() => setDropdownRowKey((k) => (k === row.key ? null : k)), 200)}
                        placeholder="상호 · 사업자번호로 검색"
                        className="field-input w-full px-3 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)] transition" />
                      {dropdownRowKey === row.key && filterPartners(row.counterpartyName).length > 0 && (
                        <div className="tax-form-partner-drop">
                          {filterPartners(row.counterpartyName).slice(0, 10).map((p: any) => (
                            <button key={p.id} type="button" onMouseDown={(e) => e.preventDefault()}
                              onClick={() => { applyPartner(row.key, p); setDropdownRowKey(null); }}
                              className="w-full text-left px-3 py-2 hover:bg-[var(--bg-surface)] text-xs">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-medium truncate">{p.name}</span>
                                {p.business_number && <span className="caption shrink-0">{p.business_number}</span>}
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 국세청 서식대로 — 왼쪽 공급자(우리), 오른쪽 공급받는자(거래처) */}
                  <div className="tax-party-grid">
                    <div className="tax-party">
                      <div className="tax-party-head"><b>공급자</b><span>회사 설정에서 관리</span></div>
                      <div className="tax-party-row"><span>등록번호</span><em>{companyInfo?.business_number || "—"}</em></div>
                      <div className="tax-party-row"><span>상호</span><em>{companyInfo?.name || "—"}</em></div>
                      <div className="tax-party-row"><span>대표자</span><em>{companyInfo?.representative || "—"}</em></div>
                      <div className="tax-party-row"><span>업태 / 종목</span><em>{[companyInfo?.business_type, companyInfo?.business_category].filter(Boolean).join(" / ") || "—"}</em></div>
                      <div className="tax-party-row"><span>사업장</span><em title={companyInfo?.address || ""}>{companyInfo?.address || "—"}</em></div>
                    </div>

                    <div className="tax-party tax-party-edit">
                      <div className="tax-party-head"><b>공급받는자</b><span>계산서에 그대로 찍히고 국세청으로 나갑니다</span></div>
                      <div className="tax-party-row">
                        <span>등록번호 <i>*</i></span>
                        <input value={row.counterpartyBizno} onChange={(e) => patchRow(row.key, { counterpartyBizno: e.target.value })}
                          placeholder="000-00-00000" className="tax-party-input" />
                      </div>
                      <div className="tax-party-row">
                        <span>상호 <i>*</i></span>
                        <input value={row.counterpartyName} onChange={(e) => patchRow(row.key, { counterpartyName: e.target.value })}
                          placeholder="상호" className="tax-party-input" />
                      </div>
                      <div className={`tax-party-row ${!row.counterpartyRepresentative.trim() ? "tax-party-miss" : ""}`}>
                        <span>대표자 <i>*</i></span>
                        <input value={row.counterpartyRepresentative} onChange={(e) => patchRow(row.key, { counterpartyRepresentative: e.target.value })}
                          placeholder="대표자명" className="tax-party-input" />
                      </div>
                      <div className={`tax-party-row ${!row.counterpartyBusinessType.trim() && !row.counterpartyBusinessItem.trim() ? "tax-party-miss" : ""}`}>
                        <span>업태 / 종목</span>
                        <div className="flex gap-1.5 min-w-0">
                          <input value={row.counterpartyBusinessType} onChange={(e) => patchRow(row.key, { counterpartyBusinessType: e.target.value })}
                            placeholder="업태" className="tax-party-input" />
                          <input value={row.counterpartyBusinessItem} onChange={(e) => patchRow(row.key, { counterpartyBusinessItem: e.target.value })}
                            placeholder="종목" className="tax-party-input" />
                        </div>
                      </div>
                      <div className="tax-party-row">
                        <span>사업장</span>
                        <input value={row.counterpartyAddress} onChange={(e) => patchRow(row.key, { counterpartyAddress: e.target.value })}
                          placeholder="사업장 주소" className="tax-party-input" />
                      </div>
                      <div className={`tax-party-row ${!row.counterpartyEmail.trim() ? "tax-party-miss" : ""}`}>
                        <span>받을 이메일 <i>*</i></span>
                        <input value={row.counterpartyEmail} onChange={(e) => patchRow(row.key, { counterpartyEmail: e.target.value })}
                          placeholder="이 주소로 계산서가 갑니다" className="tax-party-input" />
                      </div>
                      <label className="tax-party-save" title="켜 두면 이 거래처 정보가 갱신돼 다음 발행부터 자동으로 채워집니다">
                        <input type="checkbox" checked={savePartnerInfo} onChange={(e) => setSavePartnerInfo(e.target.checked)}
                          className="accent-[var(--primary)]" disabled={!row.partnerId} />
                        고친 내용을 <b>거래처 정보에도 저장</b>
                        {!row.partnerId && <span className="text-[var(--text-dim)]">— 등록된 거래처를 골랐을 때만</span>}
                      </label>
                    </div>
                  </div>

                  {missing.length > 0 && (
                    <div className="tax-form-ready">
                      <b>발행에 필요한 항목 {missing.length}개가 비었습니다</b>
                      {/*  빠진 항목에 맞는 말만 한다 — 이메일이 있는데 "메일을 못 받습니다" 라고 하면 거짓말이 된다 */}
                      <span>
                        {missing.join(" · ")} — 지금 발행하면 국세청에 빈칸으로 나갑니다.
                        {missing.includes("받을 이메일") && " 거래처는 계산서를 메일로 받지 못합니다."}
                      </span>
                    </div>
                  )}

                  {/* 품목 줄 */}
                  <div className="tax-form-field">
                    <label>품목 <i>*</i></label>
                    <div className="tax-items">
                      <div className="tax-items-scroll">
                        <div className="tax-items-grid">
                          <div className="tax-item-row tax-item-head">
                            <span />
                            <span>품목명</span><span>규격</span>
                            <span className="text-right">수량</span><span className="text-right">단가</span><span className="text-right">공급가액</span>
                            <span />
                          </div>
                          {row.items.map((it, i) => (
                            <div key={it.key} className="tax-item-row">
                              <span className="tax-item-no">{i + 1}</span>
                              <input value={it.name} onChange={(e) => patchItem(row.key, it.key, { name: e.target.value })}
                                onKeyDown={(e) => onItemKeyDown(e, row.key, it.key)}
                                onPaste={(e) => onItemPaste(e, row.key, it.key)}
                                placeholder="품목명" className="tax-item-input" />
                              <input value={it.spec} onChange={(e) => patchItem(row.key, it.key, { spec: e.target.value })}
                                onKeyDown={(e) => onItemKeyDown(e, row.key, it.key)}
                                placeholder="규격" className="tax-item-input" />
                              <input value={it.qty} onChange={(e) => patchItem(row.key, it.key, { qty: e.target.value })}
                                onKeyDown={(e) => onItemKeyDown(e, row.key, it.key)}
                                inputMode="decimal" placeholder="1" className="tax-item-input text-right" />
                              <CurrencyInput value={it.unitCost} onValueChange={(raw: string) => patchItem(row.key, it.key, { unitCost: raw })}
                                placeholder="0" className="tax-item-input text-right" />
                              <span className="tax-item-sum">{itemSupply(it).toLocaleString("ko-KR")}</span>
                              <button type="button" onClick={() => removeItem(row.key, it.key)} title="이 품목 줄 지우기"
                                className="tax-item-del">✕</button>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="tax-items-foot">
                        <button type="button" onClick={() => addItem(row.key)} className="btn-secondary btn-sm">+ 품목 줄</button>
                        <span className="text-[11px] text-[var(--text-dim)]">
                          엑셀에서 여러 줄을 <b className="text-[var(--text-muted)]">그대로 붙여넣기</b> 할 수 있습니다 · 마지막 칸에서 Tab 을 누르면 새 줄
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* 합계 — 품목 줄 수는 표에서 이미 보이므로 금액만 (2026-08-10 사장님) */}
                  <div className="tax-form-totals">
                    <div><small>공급가액</small><b>{fmt(supply)}</b></div>
                    <div><small>세액 {row.taxKind === "taxable" ? "(10%)" : "(영세율·면세)"}</small><b>{fmt(taxAmt)}</b></div>
                    <span className="tax-form-totals-sp" />
                    <div className="tax-form-grand"><small>합계</small><b>{fmt(supply + taxAmt)}</b></div>
                  </div>

                  {/* 자세히 — 기본값으로 두어도 되는 것들 */}
                  <details className="tax-form-more">
                    <summary>
                      <span><b>자세히</b> 과세유형 · 영수/청구 · 연결 프로젝트 · 비목</span>
                      <span className="text-[var(--text-dim)]">
                        {row.taxKind === "taxable" ? "과세" : row.taxKind === "zero_rated" ? "영세율" : "면세"} · {row.purpose} · {row.dealId ? (dealsForLink.find((d: any) => d.id === row.dealId)?.name || "연결됨") : "미연결"}
                      </span>
                    </summary>
                    <div className="tax-form-more-grid">
                      <div className="tax-form-field">
                        <label>과세유형</label>
                        <select value={row.taxKind} onChange={(e) => patchRow(row.key, { taxKind: e.target.value as FormRow["taxKind"] })}
                          className="field-input w-full px-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs">
                          <option value="taxable">과세</option><option value="zero_rated">영세율</option><option value="exempt">면세</option>
                        </select>
                      </div>
                      <div className="tax-form-field">
                        <label>영수/청구</label>
                        <select value={row.purpose} onChange={(e) => patchRow(row.key, { purpose: e.target.value as "영수" | "청구" })}
                          className="field-input w-full px-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs">
                          <option value="청구">청구</option><option value="영수">영수</option>
                        </select>
                      </div>
                      <div className="tax-form-field">
                        <label>연결 프로젝트</label>
                        <select value={row.dealId} onChange={(e) => patchRow(row.key, { dealId: e.target.value })}
                          className="field-input w-full px-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs">
                          <option value="">미연결</option>
                          {dealsForLink.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
                        </select>
                      </div>
                      <div className="tax-form-field">
                        <label>비목</label>
                        <select value={row.expenseCategory} onChange={(e) => patchRow(row.key, { expenseCategory: e.target.value })}
                          className="field-input w-full px-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs">
                          <option value="">선택하세요</option>
                          {EXPENSE_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                        </select>
                      </div>
                    </div>
                  </details>
                </div>
              );
            })() : (
              /* 여러 장 한꺼번에 — 사업자번호·대표자까지만 보여 준다 (2026-08-10 사장님) */
              <div className="min-w-[860px]">
                <div className="tax-multi-row tax-multi-head">
                  <span />
                  <span>유형</span><span>작성일자 *</span><span>거래처 *</span><span>사업자번호</span><span>대표자</span>
                  <span>품목명</span><span className="text-right">수량</span><span className="text-right">단가</span><span className="text-right">합계</span>
                  <span />
                </div>
                {rows.map((row, i) => {
                  const supply = rowSupply(row);
                  const taxAmt = row.taxKind === "taxable" ? Math.round(supply * 0.1) : 0;
                  return (
                    <div key={row.key} className="tax-multi-row">
                      <span className="tax-item-no">{i + 1}</span>
                      <select value={row.type} onChange={(e) => patchRow(row.key, { type: e.target.value as "sales" | "purchase" })}
                        className="tax-item-input">
                        {INVOICE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                      <DateField value={row.issueDate} max="9999-12-31"
                        onChange={(e) => {
                          const parts = e.target.value.split("-");
                          if (parts[0] && parts[0].length > 4) parts[0] = parts[0].slice(0, 4);
                          patchRow(row.key, { issueDate: parts.join("-") });
                        }}
                        className="tax-item-input" />
                      <div className="relative">
                        <input value={row.counterpartyName}
                          onChange={(e) => { patchRow(row.key, { counterpartyName: e.target.value, partnerId: "" }); setDropdownRowKey(row.key); }}
                          onFocus={() => { if (row.counterpartyName) setDropdownRowKey(row.key); }}
                          onBlur={() => setTimeout(() => setDropdownRowKey((k) => (k === row.key ? null : k)), 200)}
                          placeholder="거래처 검색" className="tax-item-input w-full" />
                        {dropdownRowKey === row.key && filterPartners(row.counterpartyName).length > 0 && (
                          <div className="tax-form-partner-drop">
                            {filterPartners(row.counterpartyName).slice(0, 10).map((p: any) => (
                              <button key={p.id} type="button" onMouseDown={(e) => e.preventDefault()}
                                onClick={() => { applyPartner(row.key, p); setDropdownRowKey(null); }}
                                className="w-full text-left px-3 py-2 hover:bg-[var(--bg-surface)] text-xs">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-medium truncate">{p.name}</span>
                                  {p.business_number && <span className="caption shrink-0">{p.business_number}</span>}
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      {/*  사업자번호·대표자는 거래처에서 따라오는 읽기 전용 표시 — 비면 붉게 알린다 */}
                      <span className={`tax-multi-ro ${!row.counterpartyBizno ? "tax-multi-ro-miss" : ""}`} title={row.counterpartyBizno || "비어 있음"}>
                        {row.counterpartyBizno || "비어 있음"}
                      </span>
                      <span className={`tax-multi-ro ${!row.counterpartyRepresentative ? "tax-multi-ro-miss" : ""}`} title={row.counterpartyRepresentative || "비어 있음"}>
                        {row.counterpartyRepresentative || "비어 있음"}
                      </span>
                      <input value={row.items[0]?.name || ""} onChange={(e) => patchItem(row.key, row.items[0].key, { name: e.target.value })}
                        placeholder="품목명" className="tax-item-input" />
                      <input value={row.items[0]?.qty || ""} onChange={(e) => patchItem(row.key, row.items[0].key, { qty: e.target.value })}
                        inputMode="decimal" placeholder="1" className="tax-item-input text-right" />
                      <CurrencyInput value={row.items[0]?.unitCost || ""} onValueChange={(raw: string) => patchItem(row.key, row.items[0].key, { unitCost: raw })}
                        placeholder="0" className="tax-item-input text-right" />
                      <span className="tax-item-sum">{(supply + taxAmt).toLocaleString("ko-KR")}</span>
                      <button type="button" onClick={() => removeRow(row.key)} title="이 계산서 줄 지우기" className="tax-item-del">✕</button>
                    </div>
                  );
                })}
                <div className="tax-items-foot">
                  <button type="button" onClick={() => setRows((rs) => [...rs, blankRow()])} className="btn-secondary btn-sm">+ 계산서 줄</button>
                  <span className="text-[11px] text-[var(--text-dim)]">
                    업태/종목 · 주소 · 이메일은 <b className="text-[var(--text-muted)]">거래처 정보 그대로</b> 등록됩니다 — 고쳐야 하면 ‘한 장 쓰기’로
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 px-6 py-3.5 border-t border-[var(--border)] shrink-0 flex-wrap">
            <div className="text-xs text-[var(--text-muted)]">
              {formMode === "single" ? (
                <>품목 <b className="text-[var(--text)]">{rows[0].items.filter((it) => it.name.trim()).length}줄</b></>
              ) : (
                <>계산서 <b className="text-[var(--text)]">{validRowCount}장</b> · 합계 <b className="mono-number text-[var(--primary)]">{fmt(rows.filter(isRowValid).reduce((s, r) => { const sp = rowSupply(r); return s + sp + (r.taxKind === "taxable" ? Math.round(sp * 0.1) : 0); }, 0))}</b></>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setShowForm(false)} className="btn-secondary text-xs">취소</button>
              <button onClick={() => canSubmit && createMut.mutate()} disabled={!canSubmit || createMut.isPending}
                className="btn-primary text-xs disabled:opacity-50 disabled:cursor-not-allowed">
                {createMut.isPending ? "등록 중..." : formMode === "single" ? "등록" : `${validRowCount}장 등록`}
              </button>
            </div>
          </div>
        </div>
        </div>
      )}

      </>)}

      {/* 엑셀 내보내기·등록은 상단 액션 영역으로 이동(2026-07-14 UI 정리). 엑셀 업로드는 제거(2026-07-31 사장님). */}
      {/* 정렬 — 별도 버튼 툴바 제거(2026-07-13). 표 헤더(작성일자·거래처·품목·공급가액…)를 클릭하면 정렬됩니다. */}

      {/* Batch Actions */}
      {(tab === "sales" || tab === "purchase") && selectedRows.length > 0 && (
        <div className="tax-invoice-batch-actions-bar">
          <span className="text-xs font-semibold text-[var(--primary)]">{selectedRows.length}건 선택</span>
          {selectedIssuable.length > 0 && (
            <button
              onClick={handleBatchIssue}
              disabled={batchIssuing}
              className="btn-primary btn-sm"
            >
              {batchIssuing ? "처리 중..." : `미발행 ${selectedIssuable.length}건 일괄 발행`}
            </button>
          )}
          {selectedVoucherable.length > 0 && (
            <button
              onClick={() => { setBulkVoucherAccountId(""); setShowBulkVoucher(true); }}
              disabled={batchIssuing}
              className="btn-primary btn-sm"
            >
              전표처리 {selectedVoucherable.length}건
            </button>
          )}
          {tab === "purchase" && (
            <div className="flex items-center gap-1.5">
              <select value={bulkExpenseCat} onChange={(e) => setBulkExpenseCat(e.target.value)}
                className="px-2 py-1.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] text-xs" title="손익계산서 계정과목 — 지정하면 매출원가 대신 그 비용 항목으로 집계">
                <option value="">손익 계정과목 지정…</option>
                {/*  비용 계정만 — 부채·자산 계정(미지급금 등)을 여기서 고르면 손익계산서에 잘못 실린다 (2026-08-10) */}
                {coaAccounts.filter((a: any) => a.account_type === "expense").map((a: any) => <option key={a.code} value={a.name}>{a.name} ({a.code})</option>)}
              </select>
              <button disabled={!bulkExpenseCat} onClick={applyBulkExpenseCat}
                className="btn-primary btn-sm">적용</button>
            </div>
          )}
          {selectedDeletable.length > 0 && (
            <button
              onClick={handleBatchDelete}
              disabled={batchIssuing}
              className="btn-danger-solid btn-sm"
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
        <div className="tax-invoice-list-card glass-card">
          {isLoading ? (
            <div className="p-16 text-center text-sm text-[var(--text-muted)]">
              불러오는 중...
            </div>
          ) : currentList.length === 0 ? (
            <div className="py-16 px-6 text-center">
              <div className="empty-state-icon mx-auto"><Ico e="🧾" /></div>
              <div className="text-base font-semibold text-[var(--text)]">
                세금계산서가 등록되면 3-Way 매칭이 시작됩니다
              </div>
              <div className="text-xs text-[var(--text-muted)] mt-1.5">
                홈택스에서 불러오거나 직접 등록할 수 있습니다
              </div>
              <button
                onClick={() => setShowForm(true)}
                className="no-print mt-5 btn-primary"
              >
                + 세금계산서 등록
              </button>
            </div>
          ) : (
            <div>
              {/* 홈택스식 결과 요약 바 — 총 N건 · 공급가액/세액/합계 합산 */}
              <div className="px-4 py-2.5 border-b border-[var(--border)] bg-[var(--bg-surface)] flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
                <span className="font-bold text-[var(--text)]">총 {currentList.length}건</span>
                <span className="text-[var(--text-muted)]">공급가액 <b className="text-[var(--text)] mono-number">₩{currentList.reduce((s: number, inv: any) => s + Number(inv.supply_amount || 0), 0).toLocaleString("ko")}</b></span>
                <span className="text-[var(--text-muted)]">세액 <b className="text-[var(--text)] mono-number">₩{currentList.reduce((s: number, inv: any) => s + Number(inv.tax_amount || 0), 0).toLocaleString("ko")}</b></span>
                <span className="text-[var(--text-muted)]">합계금액 <b className="mono-number text-[var(--primary)]">₩{currentList.reduce((s: number, inv: any) => s + Number(inv.total_amount || 0), 0).toLocaleString("ko")}</b></span>
                <span className="ml-auto text-[10px] text-[var(--text-dim)]">행을 클릭하면 상세를 확인합니다</span>
              </div>
              {/* 홈택스식 격자 그리드 */}
              <div className="overflow-auto max-h-[600px]">
                <table ref={listTableRef} className="tax-invoice-list-table">
                  <thead className="sticky top-0 z-10">
                    <tr className="text-xs text-[var(--text-dim)] bg-[var(--bg-card)] border-b border-[var(--border)]">
                      <th className="px-2 py-2.5 w-8 text-center border-l border-[var(--border)]/50 first:border-l-0">
                        {selectableInList.length > 0 && (
                          <input type="checkbox" checked={selectedRows.length === selectableInList.length && selectableInList.length > 0} onChange={toggleSelectAll}
                            className="w-3.5 h-3.5 rounded accent-[var(--primary)] align-middle cursor-pointer" title="미발행 전체 선택" />
                        )}
                      </th>
                      {/*  승인번호·전송은 행을 눌러 여는 상세로 옮겼다 — 표는 찾고 고르는 곳이다 (2026-08-10).
                           국세청 미발행처럼 **눈에 띄어야 하는 것**은 상태 칸에 함께 세운다. */}
                      {invSortTh("issue_date", "작성일자", "text-left", 1)}
                      {invSortTh("counterparty_name", "상호(거래처)", "text-left", 2)}
                      {invSortTh("label", "품목", "text-left", 3)}
                      {invSortTh("supply_amount", "공급가액", "text-right", 4)}
                      {invSortTh("tax_amount", "세액", "text-right", 5)}
                      {invSortTh("total_amount", "합계금액", "text-right", 6)}
                      {invSortTh("status", "상태", "text-center", 7)}
                      <th className="px-3 py-2.5 text-center font-semibold whitespace-nowrap border-l border-[var(--border)]/50" style={{ width: colW.act, position: "relative" }}>관리<ColHandle k="act" colIndex={8} /></th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayList.slice(0, visibleRows).map((inv: any) => {
                      const sc = invoiceStatusMeta(inv.status, inv.type);
                      const posted = !!inv.journal_entry_id;
                      const canSelect = isUnissued(inv) || isVoucherable(inv);
                      const canIssue = inv.type === 'sales' && isUnissued(inv);
                      const notIssued = inv.type === 'sales' && inv.status !== 'draft' && !inv.nts_confirm_no;
                      return (
                        <tr key={inv.id} onClick={() => setSelectedInvoice(inv)}
                          className="tax-invoice-row">
                          <td className="px-2 py-2 text-center border-l border-[var(--border)]/40 first:border-l-0" onClick={(e) => e.stopPropagation()}>
                            {canSelect ? (
                              <input type="checkbox" checked={selectedIds.has(inv.id)} onChange={() => toggleSelect(inv.id)}
                                className="w-3.5 h-3.5 rounded accent-[var(--primary)] align-middle cursor-pointer" />
                            ) : posted ? (
                              <span className="text-[9px] text-emerald-500 font-semibold" title="전표처리됨">전표</span>
                            ) : null}
                          </td>
                          <td className="px-3 py-2 text-[var(--text-muted)] mono-number border-l border-[var(--border)]/40 whitespace-nowrap">{inv.issue_date}</td>
                          <td className="px-3 py-2 border-l border-[var(--border)]/40 max-w-[200px]">
                            <span className="flex items-center gap-1.5 min-w-0">
                              <span className="font-semibold text-[var(--text)] truncate">{inv.counterparty_name}</span>
                              {inv.auto_issued && <span className="shrink-0 text-[9px] px-1 py-0.5 rounded bg-blue-500/10 text-blue-400">자동</span>}
                              {inv.original_invoice_id && <span className="shrink-0 text-[9px] px-1 py-0.5 rounded bg-orange-500/10 text-orange-400">수정</span>}
                            </span>
                          </td>
                          {/* 품목: 줄이 여럿이면 '첫 품목 외 N건' — 국세청에 실제 발행되는 이름 기준 (2026-08-10).
                              줄이 없는 옛 건은 item_name → label → 딜 이름 순 폴백 (2026-08-05) */}
                          {(() => {
                            const one = (inv.item_name ? String(inv.item_name).replace(/\+/g, " ") : "") || stripPurposeToken(inv.label) || (inv as any).deals?.name || "";
                            const label = itemsLabel(inv.items as any, one) || "—";
                            const full = ((inv.items as any[]) || []).map((it: any) => it?.name).filter(Boolean).join(" · ") || one;
                            return (
                              <td className="px-3 py-2 text-[var(--text-muted)] border-l border-[var(--border)]/40 whitespace-nowrap overflow-hidden text-ellipsis max-w-[180px]" title={full}>
                                {label}
                              </td>
                            );
                          })()}
                          <td className="px-3 py-2 text-right mono-number text-[var(--text)] border-l border-[var(--border)]/40">{Number(inv.supply_amount).toLocaleString("ko")}</td>
                          <td className="px-3 py-2 text-right mono-number text-[var(--text-muted)] border-l border-[var(--border)]/40">{Number(inv.tax_amount).toLocaleString("ko")}</td>
                          <td className="px-3 py-2 text-right mono-number font-semibold text-[var(--text)] border-l border-[var(--border)]/40">{Number(inv.total_amount).toLocaleString("ko")}</td>
                          <td className="px-3 py-2 text-center border-l border-[var(--border)]/40">
                            <span className="inline-flex items-center justify-center gap-1 flex-wrap">
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap ${sc.bg} ${sc.text}`}>{sc.label}</span>
                              {/*  국세청에 안 넘어간 건 표에서 바로 보여야 한다 (승인번호 칸을 없앤 대신) */}
                              {notIssued && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold whitespace-nowrap bg-red-500/10 text-red-500"
                                  title="국세청 승인번호가 없습니다 — 앱에만 기록된 계산서입니다">미발행</span>
                              )}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-center border-l border-[var(--border)]/40" onClick={(e) => e.stopPropagation()}>
                            <div className="flex flex-nowrap items-center justify-center gap-1 whitespace-nowrap">
                              {canIssue && (
                                <button
                                  onClick={() => handleSingleIssue(inv.id)}
                                  className="px-2.5 py-1 rounded text-[11px] font-bold text-white transition hover:brightness-110 bg-[var(--primary)]"
                                  title="홈택스 전자발행"
                                >
                                  발행
                                </button>
                              )}
                              {/* 거래매칭 — 통장 입출금 거래에 바로 연결 */}
                              {inv.status === "matched" ? (
                                <button
                                  onClick={() => setLinkInvoice(inv)}
                                  className="inline-flex items-center gap-0.5 px-2 py-1 rounded text-[11px] font-semibold bg-green-500/12 text-green-600 hover:bg-green-500/20 transition"
                                  title="통장 거래에 연결됨 — 클릭해 확인/해제"
                                >
                                  ✓ 연결됨
                                </button>
                              ) : (
                                <button
                                  onClick={() => setLinkInvoice(inv)}
                                  className="px-2 py-1 rounded text-[11px] font-semibold border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--primary)] hover:border-[var(--primary)]/40 transition"
                                  title="통장 입출금 거래에 연결"
                                >
                                  연결
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {/* 홈택스식 합계 행 */}
                  <tfoot>
                    <tr className="font-bold text-[var(--text)] border-t-2 border-[var(--border)] bg-[var(--bg-surface)]">
                      <td className="px-2 py-2.5" />
                      <td colSpan={3} className="px-3 py-2.5 border-l border-[var(--border)]/40">합계 ({currentList.length}건)</td>
                      <td className="px-3 py-2.5 text-right mono-number border-l border-[var(--border)]/40">{currentList.reduce((s: number, inv: any) => s + Number(inv.supply_amount || 0), 0).toLocaleString("ko")}</td>
                      <td className="px-3 py-2.5 text-right mono-number border-l border-[var(--border)]/40">{currentList.reduce((s: number, inv: any) => s + Number(inv.tax_amount || 0), 0).toLocaleString("ko")}</td>
                      <td className="px-3 py-2.5 text-right mono-number border-l border-[var(--border)]/40 text-[var(--primary)]">{currentList.reduce((s: number, inv: any) => s + Number(inv.total_amount || 0), 0).toLocaleString("ko")}</td>
                      <td colSpan={2} className="border-l border-[var(--border)]/40" />
                    </tr>
                  </tfoot>
                </table>
                {displayList.length > visibleRows && (
                  <div className="p-3 text-center border-t border-[var(--border)]">
                    <button type="button" className="btn-secondary btn-sm" onClick={() => setVisibleRows((v) => v + 500)}>
                      더 보기 ({Math.min(visibleRows, displayList.length).toLocaleString()} / {displayList.length.toLocaleString()}건 표시 중)
                    </button>
                  </div>
                )}
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
          <div className="tax-invoice-bulk-voucher-modal" onClick={(e) => e.stopPropagation()}>
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
                className="btn-primary btn-sm">
                {bulkVoucherPosting ? "처리 중..." : `${selectedVoucherable.length}건 전표 생성`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Invoice Detail Modal */}
      {selectedInvoice && (
        // 목록에서 같은 id 의 최신 행을 우선 — 상세 보강(주소·이메일)이 끝나면 열려 있는 모달도 바로 갱신된다.
        //   (열 때의 스냅샷만 쓰면 보강 결과가 화면에 반영되지 않았다 — 2026-08-05)
        <InvoiceDetailModal
          invoice={(invoices as any[]).find((r: any) => r.id === selectedInvoice.id) || selectedInvoice}
          companyInfo={companyInfo}
          partners={partners}
          issuanceStatus={issuanceStatus}
          deals={dealsForLink}
          onClose={() => setSelectedInvoice(null)}
          onModify={(inv: any) => {
            setSelectedInvoice(null);
            setModifyTarget(inv);
            setModifyReason("");
            setShowModifyModal(true);
          }}
        />
      )}

      {/* 거래매칭 — 통장 입출금 거래 인라인 연결 팝업 */}
      {linkInvoice && companyId && (
        <LinkTxPopup
          invoice={linkInvoice}
          companyId={companyId}
          onClose={() => setLinkInvoice(null)}
          onDone={() => { invalidate(); setLinkInvoice(null); }}
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
              // 초안 생성까지가 이 단계 — 국세청 전송은 목록에서 '발행'을 눌러야 한다(2026-08-03).
              toast("수정세금계산서 초안이 만들어졌습니다. 목록에서 '발행'을 눌러야 국세청에 전송됩니다.", "success");
            } catch (err: any) {
              toast(`오류: ${friendlyError(err, '수정세금계산서 생성 실패')}`, "error");
            }
          }}
        />
      )}

      {/* Queue Tab (자동발행 대기) */}
      {tab === "queue" && (
        <div className="tax-invoice-queue-tab">
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
              <div className="empty-state-icon mx-auto"><Ico e="⚡" /></div>
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
                        <td className="px-5 py-3 text-sm font-medium max-w-[200px]"><span className="block truncate" title={p.counterparty_name || undefined}>{p.counterparty_name || '—'}</span></td>
                        <td className="px-5 py-3 text-sm text-right">{fmt(Number(p.total_amount || 0))}</td>
                        <td className="px-5 py-3 text-xs text-[var(--text-dim)]">{p.issue_date || '—'}</td>
                        <td className="px-5 py-3 text-xs text-[var(--text-muted)] max-w-[180px]"><span className="block truncate" title={(q as any).deals?.name || p.deal_name || undefined}>{(q as any).deals?.name || p.deal_name || '—'}</span></td>
                        <td className="px-5 py-3 text-center">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            q.status === 'needs_approval' ? 'bg-orange-500/10 text-orange-400'
                            : q.status === 'pending' ? 'bg-yellow-500/10 text-yellow-400'
                            : q.status === 'processing' ? 'bg-blue-500/10 text-blue-400'
                            : 'bg-[var(--bg-surface)] text-[var(--text-muted)]'
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
        <div className="tax-invoice-sync-tab">
          {/* 미연결 상태 — 등록 가이드 */}
          {!isHometaxConnected && (
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-2xl p-5 shadow-md">
              <div className="flex items-start gap-3">
                <div className="text-2xl"><Ico e="💡" /></div>
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
                    <Ico e="⚠" /> 공동인증서 로그인은 데스크톱 환경에서만 지원되며, 인증서 파일(.pfx)이 등록되어 있어야 합니다.
                    문제가 발생하면 <Link href="/guide" className="text-blue-500 hover:underline">가이드 페이지</Link>를 참고하세요.
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 연결됨 + 첫 동기화 전 — 시작 안내 */}
          {isHometaxConnected && syncLogs.length === 0 && (
            <div className="bg-emerald-500/10 border border-green-500/30 rounded-2xl p-5 shadow-md">
              <div className="flex items-start gap-3">
                <div className="text-2xl"><Ico e="✅" /></div>
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
                  <div className="text-xl mb-1"><Ico e={step.icon} /></div>
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
                <div className="text-4xl mb-3"><Ico e="🔄" /></div>
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
          <div className="tax-invoice-deal-match-popup glass-card" onClick={(e) => e.stopPropagation()}>
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
              <button onClick={() => setMatchDealPopup(null)} className="flex-1 btn-primary btn-sm">
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
    <div className="tax-invoice-summary-tab">
      <div className="seg-bar w-fit mb-4">
        {([
          { key: "monthly", label: "월별" },
          { key: "quarterly", label: "분기별" },
          { key: "annual", label: "연간" },
        ] as const).map(p => (
          <button
            key={p.key}
            onClick={() => setPeriodType(p.key)}
            className={`seg-item ${periodType === p.key ? "seg-item-active" : ""}`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="glass-card overflow-hidden">
        {periodSummary.length === 0 ? (
          <div className="py-16 px-6 text-center">
            <div className="empty-state-icon mx-auto"><Ico e="📊" /></div>
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
    <div className="tax-invoice-vat-preview-tab">
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
          <div className="text-base sm:text-xl font-black mono-number truncate text-green-500">₩{vatPreview.reduce((s: number, v: any) => s + v.salesTax, 0).toLocaleString()}</div>
        </div>
        <div className="glass-card p-5">
          <div className="text-xs text-[var(--text-dim)] mb-1">연간 매입세액 + 카드공제</div>
          <div className="text-base sm:text-xl font-black mono-number truncate text-orange-500">₩{vatPreview.reduce((s: number, v: any) => s + v.purchaseTax + v.cardDeduction, 0).toLocaleString()}</div>
        </div>
        <div className="glass-card p-5">
          <div className="text-xs text-[var(--text-dim)] mb-1">연간 예상 납부세액</div>
          <div className={`text-base sm:text-xl font-black mono-number truncate ${totalVAT >= 0 ? "text-[var(--primary)]" : "text-red-400"}`}>
            ₩{totalVAT.toLocaleString()}
          </div>
          <div className="text-xs text-[var(--text-muted)] mt-1">{totalVAT >= 0 ? "납부" : "환급"}</div>
        </div>
      </div>

      {/* 부가세 구조 — 화면에 글로 적힌 수식(매출세액 − 매입세액 − 카드공제 = 납부세액)을
          그림으로 옮긴 것. 무엇이 얼마를 깎는지는 막대 여럿으로는 안 보인다 (2026-08-07) */}
      <div className="glass-card p-5 mb-6">
        <div className="mb-3">
          <h3 className="text-sm font-bold text-[var(--text)]">부가세 구조</h3>
          <p className="mt-0.5 text-[10px] text-[var(--text-dim)]">올해 합계 · 매출세액에서 무엇이 빠져 납부세액이 남는지</p>
        </div>
        {(() => {
          const sales = vatPreview.reduce((n: number, v: any) => n + (v.salesTax || 0), 0);
          const purchase = vatPreview.reduce((n: number, v: any) => n + (v.purchaseTax || 0), 0);
          const card = vatPreview.reduce((n: number, v: any) => n + (v.cardDeduction || 0), 0);
          if (sales === 0 && purchase === 0) {
            return <p className="py-6 text-center text-xs text-[var(--text-dim)]">아직 집계된 세액이 없어요.</p>;
          }
          return (
            <WaterfallChart height={200} unit="원" steps={[
              { label: "매출세액", value: sales, kind: "add" },
              { label: "매입세액", value: purchase, kind: "sub" },
              { label: "카드공제", value: card, kind: "sub" },
              { label: totalVAT >= 0 ? "납부세액" : "환급세액", value: Math.abs(sales - purchase - card), kind: "total" },
            ]} />
          );
        })()}
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
                      !hasActivity ? "bg-[var(--bg-surface)] text-[var(--text-muted)]"
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

// ── 통장 거래 인라인 연결 팝업 (거래매칭) ──
//   목록의 '연결' 버튼 → 금액(±10%)·거래처가 맞는 미연결 입출금 거래를 골라 즉시 연결.
//   bank_transactions.tax_invoice_id 로 매칭(three-way-match 재사용). 매출=입금, 매입=출금 대응.
function LinkTxPopup({ invoice, companyId, onClose, onDone }: { invoice: any; companyId: string; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const isSales = invoice.type === "sales";
  const isMatched = invoice.status === "matched";
  const [busy, setBusy] = useState(false);

  const { data: candidates = [], isLoading } = useQuery({
    queryKey: ["tx-link-candidates", invoice.id],
    queryFn: () => getThreeWayCandidates(companyId, {
      id: invoice.id, type: invoice.type, counterparty_name: invoice.counterparty_name,
      total_amount: Number(invoice.total_amount || 0), supply_amount: Number(invoice.supply_amount || 0),
      issue_date: invoice.issue_date, status: invoice.status, partner_id: invoice.partner_id ?? null,
    } as any),
    enabled: !isMatched,
  });

  // 이미 연결된 경우 — 현재 연결 거래 조회(해제용)
  const { data: linkedTx } = useQuery({
    queryKey: ["tx-linked", invoice.id],
    queryFn: async () => {
      const data = logRead('tax-invoices/page:data', await (supabase)
        .from("bank_transactions")
        .select("id, counterparty, amount, transaction_date, description, memo")
        .eq("company_id", companyId).eq("tax_invoice_id", invoice.id).limit(1).maybeSingle());
      return data;
    },
    enabled: isMatched,
  });

  const doLink = async (bankTxId: string) => {
    setBusy(true);
    try {
      await confirmThreeWayMatch(bankTxId, invoice.id);
      toast("통장 거래에 연결했습니다", "success");
      onDone();
    } catch (e: any) { toast(friendlyError(e, "연결 실패"), "error"); setBusy(false); }
  };
  const doUnlink = async () => {
    if (!linkedTx) return;
    setBusy(true);
    try {
      await unmatchInvoice(linkedTx.id, invoice.id);
      toast("연결을 해제했습니다", "success");
      onDone();
    } catch (e: any) { toast(friendlyError(e, "해제 실패"), "error"); setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="tax-invoice-link-tx-popup glass-card" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <div className="min-w-0">
            <div className="text-sm font-bold">통장 거래 연결</div>
            <div className="text-[11px] text-[var(--text-muted)] mt-0.5 truncate">
              {invoice.counterparty_name} · ₩{Number(invoice.total_amount || 0).toLocaleString()} · {invoice.issue_date} · {isSales ? "입금" : "출금"} 대응
            </div>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text)] text-xl shrink-0">&times;</button>
        </div>
        <div className="p-5 space-y-2">
          {isMatched ? (
            linkedTx ? (
              <div className="rounded-xl border border-green-500/30 bg-green-500/8 p-3">
                <div className="text-[11px] text-green-600 font-semibold mb-1">✓ 연결된 거래</div>
                <div className="text-sm text-[var(--text)]">{linkedTx.counterparty || "(상대 미상)"} · ₩{Number(linkedTx.amount || 0).toLocaleString()}</div>
                <div className="text-[11px] text-[var(--text-muted)]">{linkedTx.transaction_date} · {linkedTx.description || linkedTx.memo || ""}</div>
                <button onClick={doUnlink} disabled={busy} className="mt-2 px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-500/10 text-red-500 hover:bg-red-500/20 disabled:opacity-50">연결 해제</button>
              </div>
            ) : (
              <div className="text-xs text-[var(--text-muted)] py-6 text-center">연결된 거래 정보를 찾을 수 없습니다 (이미 해제됨).</div>
            )
          ) : isLoading ? (
            <div className="text-xs text-[var(--text-muted)] py-8 text-center">후보 거래 조회 중...</div>
          ) : candidates.length === 0 ? (
            <div className="text-xs text-[var(--text-muted)] py-8 text-center leading-relaxed">
              금액(±10%)·거래처가 맞는 미연결 {isSales ? "입금" : "출금"} 거래가 없습니다.<br />통장 연동 후 다시 시도하세요.
            </div>
          ) : candidates.map((c: any) => (
            <div key={c.bankTxId} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] px-3 py-2.5 hover:border-[var(--primary)]/40 transition">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-[var(--text)] truncate">{c.bankCounterparty || "(상대 미상)"} · ₩{Number(c.bankAmount || 0).toLocaleString()}</div>
                <div className="text-[11px] text-[var(--text-muted)] truncate">{c.bankDate} · {c.reasons.join(" · ")}</div>
              </div>
              <button onClick={() => doLink(c.bankTxId)} disabled={busy}
                className="shrink-0 btn-primary btn-sm">연결</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Invoice Detail Modal (세금계산서 상세) ──
// 거래처 상세 보강이 회사 단위로 막힌 상태(CODEF 상품 미승인 등)를 기억한다.
//   모달마다 state 를 두면 계산서를 열 때마다 같은 실패를 다시 호출한다 — 모듈 스코프로 1회만.
//   새로고침하면 초기화되므로 상품 승인 후엔 자동으로 다시 시도된다.
const detailBlockedRef = { blocked: false, reason: "" };

function InvoiceDetailModal({ invoice, companyInfo, partners, deals, issuanceStatus, onClose, onModify }: { invoice: any; companyInfo?: any; partners?: any[]; deals?: any[]; issuanceStatus?: { limit: number | null; used: number; remaining: number | null; planName: string | null }; onClose: () => void; onModify: (inv: any) => void }) {
  const issuanceLimitReached = !!issuanceStatus && issuanceStatus.limit !== null && (issuanceStatus.remaining ?? 0) <= 0;
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
  // 거래처 사업장 주소·이메일 자동 보강 (2026-08-05 사장님: "홈택스엔 다 있는데 왜 안 불러오냐").
  //   통합 목록 API 엔 주소·이메일이 없어 상세 API 로 이 건만 1회 조회한다.
  //   detail_fetched_at 이 찍힌 건은 다시 부르지 않는다(건당 과금 + 기관 IP 차단 경고).
  const [detailLoading, setDetailLoading] = useState(false);
  const detailTriedRef = useRef<string | null>(null);
  useEffect(() => {
    const id = invoice?.id;
    // 2026-08-05 재확인: 사업장 주소·이메일은 홈택스 **목록** 응답에 이미 들어 있고 동기화가 저장한다.
    //   (종전엔 필드명을 잘못 읽어 비어 보였을 뿐) → 유료·미승인인 상세 API 를 자동 호출할 이유가 없다.
    //   과거 건은 그 기간을 다시 동기화하면 채워진다. 상세 API 는 품목·원문 PDF 가 필요해질 때 되살린다.
    const AUTO_DETAIL_FETCH = false;
    if (!AUTO_DETAIL_FETCH) return;
    if (!id || invoice.detail_fetched_at || !invoice.nts_confirm_no) return;
    if (detailTriedRef.current === id) return;   // 한 번 시도한 건은 재시도 안 함(모달 재렌더 방지)
    // 상품 미승인(CF-00401/CF-00003)처럼 회사 단위로 영구 실패인 경우, 계산서를 열 때마다
    //   같은 실패를 반복 호출하지 않는다 — 2026-08-05 실측으로 헛호출이 쌓이던 것을 확인.
    if (detailBlockedRef.blocked) return;
    detailTriedRef.current = id;
    let alive = true;
    (async () => {
      setDetailLoading(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/codef-sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ companyId: invoice.company_id, action: 'hometax-invoice-detail', invoiceId: id }),
        });
        const json = await res.json().catch(() => ({}));
        if (alive && res.ok && json?.ok && json.invoice) {
          // 목록 캐시를 갱신하면 열려 있는 상세도 새 값으로 다시 그려진다
          //   (키가 "tax-invoices" 가 아니라 "tax-invoices-full" 이라 종전엔 갱신이 안 됐다)
          queryClient.invalidateQueries({ queryKey: ["tax-invoices-full"] });
        } else if (alive && !res.ok) {
          // 조용히 삼키면 왜 안 채워지는지 알 수 없다 — 사유를 눈에 보이게(2026-08-05 사장님 제보)
          const code = json?.code || "";
          if (code === "CF-00401" || code === "CF-00003") {
            // 회사 단위 영구 실패 — 이후 다른 계산서를 열어도 자동 호출하지 않는다(헛호출 방지)
            detailBlockedRef.blocked = true;
            detailBlockedRef.reason = json?.hint || json?.error || "";
          }
          toast(`${json?.error || `HTTP ${res.status}`}${json?.hint ? ` — ${json.hint}` : ""}`, "error");
        }
      } catch { /* 보강 실패는 조용히 — 기존 표시(명부 폴백) 유지 */ }
      finally { if (alive) setDetailLoading(false); }
    })();
    return () => { alive = false; };
  }, [invoice?.id, invoice?.detail_fetched_at, invoice?.nts_confirm_no, invoice?.company_id, queryClient]);
  const [registerLoading, setRegisterLoading] = useState(false);
  const [emailTo, setEmailTo] = useState('');
  const [showEmailForm, setShowEmailForm] = useState(false);
  // 계정과목(비목) — 상세에서 직접 지정, 손익계산서 매출원가/판관비 분류 기준
  const [expenseCat, setExpenseCat] = useState<string>(inv.expense_category || "");
  // 프로젝트(딜) 연결 — 상세에서 직접 선택 (사장님 요청 2026-07-14)
  const [dealId, setDealId] = useState<string>(inv.deal_id || "");
  const myCompany = companyInfo?.name || '(주)우리회사';
  const myBizNo = companyInfo?.business_number || '';
  const myRep = companyInfo?.representative || '';
  const myBizType = companyInfo?.business_type || '';
  const myBizCat = companyInfo?.business_category || '';

  // ── 홈택스 전자세금계산서 양식용 공급자/공급받는자 정리 ──
  //   매출: 공급자=우리회사, 공급받는자=거래처. 매입: 반대.
  const isSales = inv.type === 'sales';
  const issuedToNts = !!inv.nts_confirm_no; // 국세청 승인번호 보유 = 전송(발행)됨
  // 직원 QA 세금계산서2 — 사업자번호 XXX-XX-XXXXX 포맷 + 상호 "+"(공백 인코딩) → 공백 정규화
  const fmtBizNo = (b: string) => { const d = (b || '').replace(/[^0-9]/g, ''); return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}` : (b || ''); };
  const cleanNm = (s: string) => (s || '').replace(/\+/g, ' ').trim();
  // 거래처 정보 보강: FK 조인(inv.partners)이 없으면(홈택스 동기화 건은 partner_id=null 다수)
  //   사업자번호로 거래처 명부에서 찾아 대표자명·업태·종목·이메일·주소를 복원한다.
  const cpBizDigits = (inv.counterparty_bizno || '').replace(/[^0-9]/g, '');
  const cpPartner = inv.partners
    || (cpBizDigits.length === 10
      ? (partners || []).find((p: any) => (p.business_number || '').replace(/[^0-9]/g, '') === cpBizDigits)
      : null);
  // 거래처(공급받는자/공급자) 필드 — 계산서에 저장된 값 우선, 없으면 명부(cpPartner)에서 폴백.
  const cpRep = cpPartner?.representative || inv.counterparty_representative || '';
  const cpBizType = inv.counterparty_business_type || cpPartner?.business_type || '';
  const cpBizCat = inv.counterparty_business_item || cpPartner?.business_item || '';
  const cpEmail = inv.counterparty_email || cpPartner?.contact_email || cpPartner?.email || '';
  // 주소는 홈택스 상세로 받은 사업장 주소를 우선 — 명부 주소는 회사가 임의 입력한 값이라 계산서 원본과 다를 수 있다.
  const cpAddr = inv.counterparty_address || cpPartner?.address || '';
  const supplier = {
    bizNo: fmtBizNo(isSales ? myBizNo : (inv.counterparty_bizno || '')),
    name: cleanNm(isSales ? myCompany : (inv.counterparty_name || '')),
    rep: isSales ? myRep : cpRep,
    addr: isSales ? (companyInfo?.address || '') : cpAddr,
    bizType: isSales ? myBizType : cpBizType,
    bizCat: isSales ? myBizCat : cpBizCat,
    email: isSales ? (companyInfo?.email || '') : cpEmail,
  };
  const buyer = {
    bizNo: fmtBizNo(!isSales ? myBizNo : (inv.counterparty_bizno || '')),
    name: cleanNm(!isSales ? myCompany : (inv.counterparty_name || '')),
    rep: !isSales ? myRep : cpRep,
    addr: !isSales ? (companyInfo?.address || '') : cpAddr,
    bizType: !isSales ? myBizType : cpBizType,
    bizCat: !isSales ? myBizCat : cpBizCat,
    email: !isSales ? (companyInfo?.email || '') : cpEmail,
  };
  // 실제 세금계산서 관행: 매출(공급자 보관용)=적색, 매입=청색. 은은한 톤으로 공식 느낌만.
  const formColor = isSales ? '#C0392B' : '#1D6AA8';
  const formTint = isSales ? '#FBEEEC' : '#EAF2FA';
  // 과세유형별 문서 제목 — 영세율=영세율전자세금계산서, 면세=전자계산서 (직원 QA 그랜터)
  const baseTitle = inv.tax_kind === 'zero_rated' ? '영세율전자세금계산서'
    : inv.tax_kind === 'exempt' ? '전자계산서'
    : '전자세금계산서';
  const docTitle = issuedToNts ? baseTitle : `미전송 ${baseTitle}`;
  // 영수/청구 — 홈택스 전자계산서 데이터엔 없는 필드(종이계산서 잔재)라 자동으론 못 불러옴.
  //   label 앞 토큰("영수 |"/"청구 |")으로 보관하고, 상세에서 사용자가 직접 지정(수정 저장).
  const [billedState, setBilledState] = useState<boolean>(() => !inv.label?.includes('영수'));
  const [savingReceipt, setSavingReceipt] = useState(false);
  const isBilled = billedState; // true=청구, false=영수
  const setReceipt = async (billed: boolean) => {
    if (savingReceipt || billed === billedState) return;
    setSavingReceipt(true);
    const token = billed ? '청구' : '영수';
    const rest = stripPurposeToken(inv.label) || (inv.item_name ? String(inv.item_name).replace(/\+/g, ' ').trim() : '');
    const newLabel = rest ? `${token} | ${rest}` : token;
    try {
      const { error } = await (supabase).from('tax_invoices').update({ label: newLabel }).eq('id', inv.id);
      if (error) throw error;
      inv.label = newLabel; // 로컬 반영 (목록 재조회 전까지)
      setBilledState(billed);
      queryClient.invalidateQueries({ queryKey: ['tax-invoices-full'] });
      toast(`영수/청구를 '${token}'(으)로 저장했습니다`, 'success');
    } catch (e: any) {
      toast(`영수/청구 저장 실패: ${e.message}`, 'error');
    }
    setSavingReceipt(false);
  };

  const buildPdfParams = (): TaxInvoicePdfParams => ({
    invoiceNumber: `TI-${inv.issue_date?.replace(/-/g, '').slice(0, 6)}-${inv.id.slice(0, 4).toUpperCase()}`,
    issueDate: inv.issue_date || todayKst(),
    type: inv.type,
    supplier: {
      name: supplier.name,
      businessNumber: supplier.bizNo,
      representative: supplier.rep,
      address: supplier.addr,
      businessType: supplier.bizType,
      businessCategory: supplier.bizCat,
    },
    buyer: {
      name: buyer.name,
      businessNumber: buyer.bizNo,
      representative: buyer.rep,
      address: buyer.addr,
      businessType: buyer.bizType,
      businessCategory: buyer.bizCat,
    },
    supplyAmount: supplyAmt,
    taxAmount: taxAmt,
    totalAmount: totalAmt,
    items: [{
      date: inv.issue_date || todayKst(),
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
  // 주의: certURL 은 응답 후(await 이후) window.open 하면 브라우저가 "사용자 제스처 아님"으로 판단해 팝업을 무음 차단함
  // (30초 유효 URL이라 재시도도 못 함) → 클릭 즉시(동기) 빈 창을 먼저 열고, 응답이 오면 그 창을 이동시킨다.
  const handleRegisterIssuer = async () => {
    setRegisterLoading(true);
    const popup = window.open('', '_blank');
    if (popup) popup.document.write('<p style="font-family:sans-serif;padding:24px;color:#555">인증서 등록 페이지를 불러오는 중입니다…</p>');
    try {
      const { certURL, message } = await registerHometaxIssuer(inv.company_id);
      if (popup && !popup.closed) popup.location.href = certURL;
      else window.open(certURL, '_blank');
      toast(message || '인증서 등록 페이지를 열었습니다. 등록 후 다시 발행하세요.', 'success');
    } catch (err: any) {
      popup?.close();
      toast(`발행 등록 실패: ${err.message}`, 'error');
    }
    setRegisterLoading(false);
  };

  // 세금계산서 양식 내부 라벨/값 행 (항상 라이트 — 실제 종이 문서처럼)
  const F = ({ label, value, mono, wide }: { label: string; value: React.ReactNode; mono?: boolean; wide?: boolean }) => (
    <div className="flex border-b last:border-b-0" style={{ borderColor: "#e6e6e6" }}>
      <div className={`${wide ? "w-[64px]" : "w-[64px]"} shrink-0 px-2 py-[5px] text-[10px] font-semibold flex items-center`} style={{ background: "#f6f6f6", color: "#555", borderRight: "1px solid #e6e6e6" }}>{label}</div>
      <div className={`flex-1 px-2 py-[5px] text-[11px] leading-snug ${mono ? "font-mono" : ""}`} style={{ color: "#1a1a1a" }}>{value || "—"}</div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="tax-invoice-detail-modal glass-card" onClick={(e) => e.stopPropagation()}>
        {/* Header (모달 크롬) */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-base font-black">세금계산서 상세</span>
            <span className={`text-xs px-2 py-0.5 rounded-full ${sc.bg} ${sc.text}`}>{sc.label}</span>
            {/* 국세청 전송 여부 — nts_confirm_no 유무로 판정(status='issued'는 앱 내부 상태). */}
            {issuedToNts ? (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/15 text-green-600 font-semibold" title={`국세청 승인번호 ${inv.nts_confirm_no}`}>홈택스 전송완료</span>
            ) : (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 font-semibold">홈택스 미전송</span>
            )}
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text)] text-xl transition">&times;</button>
        </div>

        {/* 홈택스 전자세금계산서 양식 — 실제 발행본과 동일한 시각 형태(항상 흰 배경 공식 문서). */}
        <div className="p-4 sm:p-6" data-print-area>
          <div className="tax-invoice-document" style={{ background: "#fff", color: "#1a1a1a", border: `2.5px solid ${formColor}`, borderRadius: 4, overflow: "hidden" }}>
            {/* 제목 바 — 전송 여부에 따라 전자세금계산서 / 미전송 전자세금계산서 */}
            <div className="relative text-center" style={{ background: formTint, borderBottom: `1.5px solid ${formColor}` }}>
              <div className="py-2 font-black tracking-[0.35em] text-[15px] sm:text-[17px]" style={{ color: formColor }}>{docTitle}</div>
              <div className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] font-semibold" style={{ color: formColor }}>
                {isSales ? "공급자 보관용" : "공급받는자 보관용"}
              </div>
              {/* 홈택스 상세에서 사업장·이메일을 가져오는 중 (최초 1회) */}
              {detailLoading && (
                <div className="absolute left-2 top-1/2 -translate-y-1/2 text-[9px] font-semibold animate-pulse" style={{ color: formColor }}>
                  홈택스에서 사업장·이메일 불러오는 중…
                </div>
              )}
            </div>

            {/* 승인번호 */}
            <div className="flex text-[11px]" style={{ borderBottom: "1px solid #ddd" }}>
              <div className="px-3 py-1.5 w-[88px] shrink-0 font-semibold" style={{ background: "#f6f6f6", color: "#555", borderRight: "1px solid #ddd" }}>승인번호</div>
              <div className="px-3 py-1.5 flex-1 font-mono" style={{ color: issuedToNts ? "#1a1a1a" : "#b45309" }}>
                {inv.nts_confirm_no || "미발급 — 국세청에 전송되지 않은 계산서입니다"}
              </div>
            </div>

            {/* 공급자 / 공급받는자 */}
            <div className="grid grid-cols-1 sm:grid-cols-2" style={{ borderBottom: "1px solid #ddd" }}>
              <div style={{ borderRight: "1px solid #ddd" }}>
                <div className="text-center py-1 text-[11px] font-bold text-white" style={{ background: formColor }}>공 급 자</div>
                <F label="등록번호" value={supplier.bizNo} mono />
                <F label="상호" value={supplier.name} />
                <F label="성명" value={supplier.rep} />
                <F label="사업장" value={supplier.addr} />
                <F label="업태" value={supplier.bizType} />
                <F label="종목" value={supplier.bizCat} />
                <F label="이메일" value={supplier.email} />
              </div>
              <div>
                <div className="text-center py-1 text-[11px] font-bold text-white" style={{ background: "#555" }}>공급받는자</div>
                <F label="등록번호" value={buyer.bizNo} mono />
                <F label="상호" value={buyer.name} />
                <F label="성명" value={buyer.rep} />
                <F label="사업장" value={buyer.addr} />
                <F label="업태" value={buyer.bizType} />
                <F label="종목" value={buyer.bizCat} />
                <F label="이메일" value={buyer.email} />
              </div>
            </div>

            {/* 작성일자 · 공급가액 · 세액 */}
            <div className="grid grid-cols-3 text-center" style={{ borderBottom: "1px solid #ddd" }}>
              <div style={{ borderRight: "1px solid #ddd" }}>
                <div className="text-[9px] py-1" style={{ background: "#f6f6f6", color: "#555", borderBottom: "1px solid #ddd" }}>작성일자</div>
                <div className="text-[12px] font-bold py-1.5 font-mono">{inv.issue_date || "—"}</div>
              </div>
              <div style={{ borderRight: "1px solid #ddd" }}>
                <div className="text-[9px] py-1" style={{ background: "#f6f6f6", color: "#555", borderBottom: "1px solid #ddd" }}>공급가액</div>
                <div className="text-[12px] font-bold py-1.5 font-mono">₩{supplyAmt.toLocaleString()}</div>
              </div>
              <div>
                <div className="text-[9px] py-1" style={{ background: "#f6f6f6", color: "#555", borderBottom: "1px solid #ddd" }}>세액</div>
                <div className="text-[12px] font-bold py-1.5 font-mono">₩{taxAmt.toLocaleString()}</div>
              </div>
            </div>

            {/* 품목 상세 */}
            <table className="w-full" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr className="text-[9.5px] font-semibold" style={{ background: "#f6f6f6", color: "#555" }}>
                  <th className="py-1 px-1 text-center" style={{ borderBottom: "1px solid #ddd", borderRight: "1px solid #eee", width: "44px" }}>월/일</th>
                  <th className="py-1 px-2 text-left" style={{ borderBottom: "1px solid #ddd", borderRight: "1px solid #eee" }}>품목</th>
                  <th className="py-1 px-1 text-center" style={{ borderBottom: "1px solid #ddd", borderRight: "1px solid #eee", width: "38px" }}>수량</th>
                  <th className="py-1 px-2 text-right" style={{ borderBottom: "1px solid #ddd", borderRight: "1px solid #eee" }}>단가</th>
                  <th className="py-1 px-2 text-right" style={{ borderBottom: "1px solid #ddd", borderRight: "1px solid #eee" }}>공급가액</th>
                  <th className="py-1 px-2 text-right" style={{ borderBottom: "1px solid #ddd" }}>세액</th>
                </tr>
              </thead>
              <tbody>
                {/*  품목 줄이 있으면 줄마다 한 행 — 국세청 서식과 같은 모양 (2026-08-10).
                     옛 계산서(줄 없음)는 예전처럼 한 행으로 그린다. */}
                {((inv.items as any[]) || []).length > 0 ? (
                  ((inv.items as any[]) || []).map((it: any, i: number) => {
                    const lineSupply = Math.round(Number(it.supplyAmount ?? (Number(it.qty || 1) * Number(it.unitCost || 0))) || 0);
                    return (
                      <tr key={i} className="text-[11px]" style={{ color: "#1a1a1a", borderTop: i > 0 ? "1px solid #f0f0f0" : undefined }}>
                        <td className="py-2 px-1 text-center font-mono" style={{ borderRight: "1px solid #eee" }}>{i === 0 ? (inv.issue_date?.slice(5) || "—") : ""}</td>
                        <td className="py-2 px-2" style={{ borderRight: "1px solid #eee" }}>
                          {it.name || "—"}
                          {it.spec && <span className="ml-1.5 text-[10px]" style={{ color: "#888" }}>{it.spec}</span>}
                        </td>
                        <td className="py-2 px-1 text-center font-mono" style={{ borderRight: "1px solid #eee" }}>{it.qty || 1}</td>
                        <td className="py-2 px-2 text-right font-mono" style={{ borderRight: "1px solid #eee" }}>₩{Number(it.unitCost || 0).toLocaleString()}</td>
                        <td className="py-2 px-2 text-right font-mono" style={{ borderRight: "1px solid #eee" }}>₩{lineSupply.toLocaleString()}</td>
                        <td className="py-2 px-2 text-right font-mono">₩{(taxAmt > 0 ? Math.round(lineSupply * 0.1) : 0).toLocaleString()}</td>
                      </tr>
                    );
                  })
                ) : (
                  <tr className="text-[11px]" style={{ color: "#1a1a1a" }}>
                    <td className="py-2 px-1 text-center font-mono" style={{ borderRight: "1px solid #eee" }}>{inv.issue_date?.slice(5) || "—"}</td>
                    <td className="py-2 px-2" style={{ borderRight: "1px solid #eee" }}>
                      {stripPurposeToken(inv.label) || (inv.item_name ? String(inv.item_name).replace(/\+/g, " ") : "") || EXPENSE_CATEGORIES.find((c: any) => c.value === inv.expense_category)?.label || "—"}
                    </td>
                    <td className="py-2 px-1 text-center font-mono" style={{ borderRight: "1px solid #eee" }}>{inv.item_quantity || 1}</td>
                    <td className="py-2 px-2 text-right font-mono" style={{ borderRight: "1px solid #eee" }}>₩{Number(inv.item_unit_price || supplyAmt).toLocaleString()}</td>
                    <td className="py-2 px-2 text-right font-mono" style={{ borderRight: "1px solid #eee" }}>₩{supplyAmt.toLocaleString()}</td>
                    <td className="py-2 px-2 text-right font-mono">₩{taxAmt.toLocaleString()}</td>
                  </tr>
                )}
              </tbody>
            </table>

            {/* 합계금액 · 영수/청구 */}
            <div className="flex items-stretch text-[11px]" style={{ borderTop: "2px solid " + formColor }}>
              <div className="px-3 py-2 font-semibold flex items-center" style={{ background: "#f6f6f6", color: "#555", borderRight: "1px solid #ddd", width: "88px" }}>합계금액</div>
              <div className="px-3 py-2 flex-1 font-black font-mono text-[14px] flex items-center" style={{ color: formColor }}>₩{totalAmt.toLocaleString()}</div>
              <div className="px-4 py-2 flex items-center gap-1.5 font-semibold" style={{ borderLeft: "1px solid #ddd", color: "#333" }}>
                이 금액을
                {/* 영수/청구 — 클릭해서 지정(홈택스 동기화 건은 이 필드가 없어 기본 '청구', 여기서 실제값으로 수정) */}
                {/* 인쇄 시엔 버튼이 숨겨지므로 선택값만 정적 표기 */}
                <span className="hidden print:inline px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ background: formTint, color: formColor }}>{isBilled ? "청구" : "영수"}</span>
                <span className="inline-flex print:hidden rounded-full overflow-hidden border" style={{ borderColor: formColor }}>
                  <button
                    type="button"
                    disabled={savingReceipt}
                    onClick={() => setReceipt(false)}
                    className="px-2 py-0.5 text-[10px] font-bold transition disabled:opacity-50"
                    style={!isBilled ? { background: formColor, color: "#fff" } : { background: "#fff", color: "#999" }}
                  >영수</button>
                  <button
                    type="button"
                    disabled={savingReceipt}
                    onClick={() => setReceipt(true)}
                    className="px-2 py-0.5 text-[10px] font-bold transition disabled:opacity-50"
                    style={isBilled ? { background: formColor, color: "#fff" } : { background: "#fff", color: "#999" }}
                  >청구</button>
                </span>
                함
              </div>
            </div>
          </div>

          {/* 내부 참고 정보(양식 밖) — 프로젝트/비목. 비목(계정과목)은 여기서 직접 지정 가능:
              매입 계산서에 지정하면 손익계산서에서 매출원가 대신 그 판관비 항목으로 반영 (사장님 QA 2026-07-10) */}
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[11px] text-[var(--text-muted)]">
            <span className="inline-flex items-center gap-1.5">프로젝트:
              <select
                value={dealId}
                onChange={async (e) => {
                  const v = e.target.value;
                  const prev = dealId;
                  setDealId(v);
                  const { error } = await (supabase).from("tax_invoices").update({ deal_id: v || null }).eq("id", inv.id);
                  if (error) { toast("프로젝트 저장 실패: " + error.message, "error"); setDealId(prev); return; }
                  const picked = (deals || []).find((d: any) => d.id === v);
                  inv.deal_id = v || null;
                  inv.deals = v ? { name: picked?.name } : null;
                  queryClient.invalidateQueries({ queryKey: ["tax-invoices-full"] });
                  toast(v ? `'${picked?.name || "프로젝트"}'에 연결되었습니다` : "프로젝트 연결 해제", "success");
                }}
                className="px-2 py-1 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-[11px] text-[var(--text)]"
                title="이 세금계산서를 프로젝트에 연결합니다 — 프로젝트 손익·비용 구성에 집계됩니다"
              >
                <option value="">미지정</option>
                {(deals || []).map((d: any) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </span>
            <span className="inline-flex items-center gap-1.5">계정과목:
              <select
                value={expenseCat}
                onChange={async (e) => {
                  const v = e.target.value;
                  setExpenseCat(v);
                  const { error } = await (supabase).from("tax_invoices").update({ expense_category: v || null }).eq("id", inv.id);
                  if (error) { toast("계정과목 저장 실패: " + error.message, "error"); return; }
                  inv.expense_category = v || null;
                  queryClient.invalidateQueries({ queryKey: ["tax-invoices-full"] });
                  toast(v
                    ? `'${EXPENSE_CATEGORIES.find((c) => c.value === v)?.label || v}' 지정 — 손익계산서에서 매출원가 대신 판관비로 반영됩니다`
                    : "계정과목 해제 — 매입 계산서는 매출원가로 집계됩니다", "success");
                }}
                className="px-2 py-1 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-[11px] text-[var(--text)]"
                title="매입 계산서에 계정과목을 지정하면 손익계산서에서 매출원가 대신 그 판관비 항목으로 반영됩니다"
              >
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.value === "" ? (inv.type === "purchase" ? "미지정 (매출원가)" : "미지정") : c.label}</option>
                ))}
              </select>
            </span>
          </div>

          {/* Actions */}
          <div className="space-y-3 mt-4">
            {/* 매출인데 국세청 미발행(nts_confirm_no 없음) — 오해 방지 경고 + 실제 발행 버튼 */}
            {inv.type === 'sales' && inv.status !== 'draft' && !inv.nts_confirm_no && (
              <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2.5 text-xs text-red-500 leading-relaxed">
                <div><Ico e="⚠" tone="mono" /> 이 세금계산서는 앱에만 기록됐고 <b>아직 국세청에 전자발행되지 않았습니다</b> (승인번호 없음).</div>
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
                    disabled={issueLoading || issuanceLimitReached}
                    title={issuanceLimitReached ? `${issuanceStatus?.planName || '현재 요금제'}의 이번 달 발행 한도(${issuanceStatus?.limit}건)를 모두 사용했습니다` : undefined}
                    className="px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white rounded-lg font-semibold transition disabled:opacity-50"
                  >
                    {issueLoading ? '발행 중...' : issuanceLimitReached ? '이번 달 발행 한도 소진' : '② 지금 홈택스 발행'}
                  </button>
                  <span className="text-[10px] text-red-400/80">또는 홈택스에서 직접 발행</span>
                </div>
                {issuanceLimitReached && (
                  <div className="mt-2 text-[10px] text-amber-500">
                    {issuanceStatus?.planName || '현재 요금제'}는 월 {issuanceStatus?.limit}건까지 국세청 발행이 가능합니다. 울트라로 업그레이드하면 무제한으로 발행할 수 있습니다. (설정 → 요금제)
                  </div>
                )}
              </div>
            )}
            <div className="flex items-center gap-2 flex-wrap">
              {inv.status === 'draft' && (
                <button
                  onClick={handleIssue}
                  disabled={issueLoading || issuanceLimitReached}
                  title={issuanceLimitReached ? `${issuanceStatus?.planName || '현재 요금제'}의 이번 달 발행 한도(${issuanceStatus?.limit}건)를 모두 사용했습니다` : undefined}
                  className="btn-primary"
                >
                  {issueLoading ? '발행 중...' : issuanceLimitReached ? '이번 달 발행 한도 소진' : '발행 처리'}
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
                disabled={!MODIFY_ISSUE_AVAILABLE}
                title={MODIFY_ISSUE_AVAILABLE ? "수정세금계산서 만들기 — 초안 생성 후 목록에서 발행" : "국세청 연동 기관 승인 대기 중입니다. 곧 지원 예정입니다."}
                className={
                  MODIFY_ISSUE_AVAILABLE
                    ? "px-4 py-2 bg-orange-500/10 text-orange-400 hover:bg-orange-500/20 rounded-lg text-sm font-semibold transition"
                    : "px-4 py-2 bg-[var(--bg-surface)] text-[var(--text-dim)] rounded-lg text-sm font-semibold border border-[var(--border)] cursor-not-allowed"
                }
              >
                수정세금계산서{MODIFY_ISSUE_AVAILABLE ? "" : " (업데이트 예정)"}
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

  // 버튼 외 경로(딥링크·기존 상태 등)로 열려도 발행되지 않도록 모달에서도 막는다.
  if (!MODIFY_ISSUE_AVAILABLE) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
        <div className="tax-invoice-modification-modal glass-card" onClick={(e) => e.stopPropagation()}>
          <div className="px-6 py-4 border-b border-[var(--border)]">
            <h3 className="text-sm font-bold">수정세금계산서 — 업데이트 예정</h3>
          </div>
          <div className="px-6 py-6 space-y-3">
            <p className="text-sm text-[var(--text)]">
              수정세금계산서 발행은 <b>현재 준비 중</b>입니다. 국세청 전자세금계산서 <b>수정발행 연동 승인</b>이
              완료되는 대로 열립니다.
            </p>
            <p className="text-xs text-[var(--text-muted)] leading-6">
              그때까지는 홈택스에서 직접 수정발행해 주세요. 이미 국세청에 전송된 세금계산서는
              삭제·정정이 불가능하며, 세법상 적합한 수정사유를 선택해 수정세금계산서를 발행해야 합니다.
            </p>
          </div>
          <div className="px-6 py-4 border-t border-[var(--border)] flex justify-end">
            <button onClick={onClose} className="btn-primary btn-sm">확인</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="tax-invoice-modification-modal glass-card" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-[var(--border)]">
          <h3 className="text-sm font-bold">수정세금계산서 만들기</h3>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            원본: {invoice.counterparty_name} / ₩{Number(invoice.total_amount).toLocaleString()} ({invoice.issue_date})
          </p>
        </div>
        <div className="p-6 space-y-4">
          {/* 2단계 안내 — 이 모달은 초안만 만든다. 국세청 전송은 목록에서 '발행'을 눌러야 일어난다.
              라벨이 '발행'이라 여기서 끝난 줄 알고 미전송으로 남던 문제(2026-08-03 사장님). */}
          <div className="tax-invoice-modify-step-notice">
            <b className="text-[var(--text)]">여기서는 수정세금계산서 초안만 만들어집니다.</b> 국세청 전송은
            목록에 새로 생긴 건에서 <b>발행</b>을 눌러야 이뤄집니다.
          </div>

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
              {submitting ? "만드는 중..." : "수정세금계산서 만들기"}
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
