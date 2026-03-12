"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/queries";
import {
  createTaxInvoice,
  threeWayMatch,
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
} from "@/lib/tax-invoice";
import type { PeriodType } from "@/lib/tax-invoice";
import { getCardDeductionSummary } from "@/lib/card-transactions";
import * as XLSX from "xlsx";
import { useToast } from "@/components/toast";

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
      상태: (INVOICE_STATUS as any)[inv.status]?.label || inv.status,
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
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [tab, setTab] = useState<"sales" | "purchase" | "matching" | "vat" | "summary" | "queue" | "sync">("sales");
  const [month, setMonth] = useState(getCurrentMonth());
  const [periodType, setPeriodType] = useState<PeriodType>("monthly");
  const [showForm, setShowForm] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<any>(null);
  const [showModifyModal, setShowModifyModal] = useState(false);
  const [modifyTarget, setModifyTarget] = useState<any>(null);
  const [modifyReason, setModifyReason] = useState("");
  const [modifyAmount, setModifyAmount] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [form, setForm] = useState({
    type: "sales" as "sales" | "purchase",
    counterpartyName: "",
    counterpartyBizno: "",
    supplyAmount: "",
    issueDate: "",
    preferredDate: "",
    expenseCategory: "",
  });

  useEffect(() => {
    getCurrentUser().then((u) => {
      if (u) {
        setCompanyId(u.company_id);
        setUserId(u.id);
      }
    });
  }, []);

  // Fetch all invoices
  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ["tax-invoices-full", companyId, month],
    queryFn: async () => {
      const startDate = `${month}-01`;
      const endDate = `${month}-31`;
      const { data } = await supabase
        .from("tax_invoices")
        .select("*, deals(name), label, revenue_schedule_id")
        .eq("company_id", companyId!)
        .gte("issue_date", startDate)
        .lte("issue_date", endDate)
        .order("issue_date", { ascending: false });
      return data || [];
    },
    enabled: !!companyId,
  });

  // 3-way match data
  const { data: matchResults = [], isLoading: matchLoading } = useQuery({
    queryKey: ["three-way-match", companyId],
    queryFn: () => threeWayMatch(companyId!),
    enabled: !!companyId && tab === "matching",
  });

  // VAT Preview
  const currentYear = Number(month.split("-")[0]);
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
    queryClient.invalidateQueries({ queryKey: ["three-way-match"] });
  };

  const createMut = useMutation({
    mutationFn: () =>
      createTaxInvoice({
        companyId: companyId!,
        type: form.type,
        counterpartyName: form.counterpartyName,
        counterpartyBizno: form.counterpartyBizno || undefined,
        supplyAmount: Number(form.supplyAmount),
        issueDate: form.issueDate,
        preferredDate: form.preferredDate || undefined,
        expenseCategory: form.expenseCategory || undefined,
      }),
    onSuccess: () => {
      invalidate();
      setShowForm(false);
      setForm({
        type: "sales",
        counterpartyName: "",
        counterpartyBizno: "",
        supplyAmount: "",
        issueDate: "",
        preferredDate: "",
        expenseCategory: "",
      });
    },
  });

  const markMatchedMut = useMutation({
    mutationFn: (id: string) => markInvoiceMatched(id),
    onSuccess: invalidate,
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

  const currentList = tab === "sales" ? salesInvoices : tab === "purchase" ? purchaseInvoices : [];

  const canSubmit =
    form.counterpartyName &&
    form.supplyAmount &&
    form.issueDate &&
    Number(form.supplyAmount) > 0;

  return (
    <div className="max-w-[1200px]">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-extrabold">세금계산서</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            매출/매입 세금계산서 관리 및 3-Way 매칭
          </p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="px-3 py-2 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)] text-[var(--text-muted)]"
          />
          <button
            onClick={() => setShowForm(!showForm)}
            className="px-4 py-2.5 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl text-sm font-semibold transition"
          >
            + 세금계산서 등록
          </button>
        </div>
      </div>

      {/* Sync bar */}
      <div className="flex items-center justify-between bg-[var(--bg-card)] rounded-xl border border-[var(--border)] px-4 py-2.5 mb-6">
        <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          {lastSyncData ? (
            <span>
              마지막 업데이트: <strong className="text-[var(--text)]">{new Date(lastSyncData).toLocaleString('ko', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</strong>
            </span>
          ) : (
            <span>아직 홈택스 동기화 이력이 없습니다</span>
          )}
        </div>
        <button
          onClick={async () => {
            if (syncing) return;
            setSyncing(true);
            try {
              const startDate = `${month}-01`;
              const endDate = `${month}-31`;
              await syncHomeTaxInvoices({ startDate, endDate });
              invalidate();
              queryClient.invalidateQueries({ queryKey: ["last-sync-time"] });
              queryClient.invalidateQueries({ queryKey: ["hometax-sync-logs"] });
              queryClient.invalidateQueries({ queryKey: ["invoice-queue"] });
            } catch (err: any) {
              toast(`동기화 오류: ${err.message}`, "error");
            } finally {
              setSyncing(false);
            }
          }}
          disabled={syncing}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--primary)]/10 text-[var(--primary)] hover:bg-[var(--primary)]/20 rounded-lg text-xs font-semibold transition disabled:opacity-50"
        >
          <svg className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          {syncing ? "동기화 중..." : "최신자료 업데이트"}
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-8">
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-5">
          <div className="text-xs text-[var(--text-dim)] mb-1 uppercase tracking-wider font-medium">
            총 매출계산서
          </div>
          <div className="text-xl font-black text-green-400">{fmt(totalSales)}</div>
          <div className="text-xs text-[var(--text-muted)] mt-1">
            {salesInvoices.length}건
          </div>
        </div>
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-5">
          <div className="text-xs text-[var(--text-dim)] mb-1 uppercase tracking-wider font-medium">
            총 매입계산서
          </div>
          <div className="text-xl font-black text-orange-400">{fmt(totalPurchase)}</div>
          <div className="text-xs text-[var(--text-muted)] mt-1">
            {purchaseInvoices.length}건
          </div>
        </div>
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-5">
          <div className="text-xs text-[var(--text-dim)] mb-1 uppercase tracking-wider font-medium">
            미매칭
          </div>
          <div
            className={`text-xl font-black ${
              unmatched > 0 ? "text-red-400" : "text-[var(--text-muted)]"
            }`}
          >
            {unmatched}건
          </div>
          <div className="text-xs text-[var(--text-muted)] mt-1">매칭 필요</div>
        </div>
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-5">
          <div className="text-xs text-[var(--text-dim)] mb-1 uppercase tracking-wider font-medium">
            VAT 예상
          </div>
          <div
            className={`text-xl font-black ${
              vatEstimate >= 0 ? "text-[var(--primary)]" : "text-red-400"
            }`}
          >
            {fmt(vatEstimate)}
          </div>
          <div className="text-xs text-[var(--text-muted)] mt-1">
            {vatEstimate >= 0 ? "납부 예정" : "환급 예정"}
          </div>
        </div>
      </div>

      {/* Registration Form */}
      {showForm && (
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6 mb-6">
          <h3 className="text-sm font-bold mb-4">세금계산서 등록</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">
                유형 *
              </label>
              <select
                value={form.type}
                onChange={(e) =>
                  setForm({ ...form, type: e.target.value as "sales" | "purchase" })
                }
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
              >
                {INVOICE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">
                거래처명 *
              </label>
              <input
                value={form.counterpartyName}
                onChange={(e) =>
                  setForm({ ...form, counterpartyName: e.target.value })
                }
                placeholder="(주)A기업"
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">
                사업자번호
              </label>
              <input
                value={form.counterpartyBizno}
                onChange={(e) =>
                  setForm({ ...form, counterpartyBizno: e.target.value })
                }
                placeholder="123-45-67890"
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">
                공급가액 (원) *
              </label>
              <input
                type="number"
                value={form.supplyAmount}
                onChange={(e) =>
                  setForm({ ...form, supplyAmount: e.target.value })
                }
                placeholder="10000000"
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">
                발행일 *
              </label>
              <input
                type="date"
                value={form.issueDate}
                onChange={(e) =>
                  setForm({ ...form, issueDate: e.target.value })
                }
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">
                거래처 희망일자
              </label>
              <input
                type="date"
                value={form.preferredDate}
                onChange={(e) =>
                  setForm({ ...form, preferredDate: e.target.value })
                }
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
              />
              <span className="text-[10px] text-[var(--text-dim)] mt-0.5 block">거래처가 희망하는 발행일</span>
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">
                비목 (품목)
              </label>
              <select
                value={form.expenseCategory}
                onChange={(e) =>
                  setForm({ ...form, expenseCategory: e.target.value })
                }
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
              >
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            {Number(form.supplyAmount) > 0 && (
              <div className="flex items-end pb-1">
                <div className="text-xs text-[var(--text-dim)]">
                  부가세: ₩
                  {Math.round(
                    Number(form.supplyAmount) * 0.1
                  ).toLocaleString("ko")}{" "}
                  / 합계: ₩
                  {Math.round(
                    Number(form.supplyAmount) * 1.1
                  ).toLocaleString("ko")}
                </div>
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => canSubmit && createMut.mutate()}
              disabled={!canSubmit || createMut.isPending}
              className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-sm font-semibold disabled:opacity-50 transition"
            >
              {createMut.isPending ? "등록 중..." : "등록"}
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="px-4 py-2 text-[var(--text-muted)] text-sm hover:text-[var(--text)] transition"
            >
              취소
            </button>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-2 mb-6 flex-wrap">
        {[
          { key: "sales" as const, label: "매출", count: salesInvoices.length },
          { key: "purchase" as const, label: "매입", count: purchaseInvoices.length },
          { key: "queue" as const, label: "자동발행" },
          { key: "matching" as const, label: "3-Way 매칭" },
          { key: "summary" as const, label: "기간별 집계" },
          { key: "vat" as const, label: "VAT 미리보기" },
          { key: "sync" as const, label: "홈택스 동기화" },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key as any)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
              tab === t.key
                ? "bg-[var(--primary)]/10 text-[var(--primary)]"
                : "text-[var(--text-muted)] hover:text-[var(--text)]"
            }`}
          >
            {t.label}
            {"count" in t && t.count !== undefined && (
              <span className="text-xs opacity-70 ml-1">({t.count})</span>
            )}
          </button>
        ))}

        <div className="ml-auto flex gap-2">
          {/* Excel import */}
          <label className="px-4 py-2 bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text)] rounded-lg text-sm font-medium border border-[var(--border)] transition flex items-center gap-2 cursor-pointer">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m4-8l-4-4m0 0L13 8m4-4v12" />
            </svg>
            Excel 가져오기
            <input type="file" accept=".xlsx,.xls,.csv" onChange={handleExcelImport} className="hidden" />
          </label>

          {/* Excel export */}
          {(tab === "sales" || tab === "purchase") && currentList.length > 0 && (
            <button
              onClick={() =>
                exportToExcel(
                  currentList,
                  `세금계산서_${tab === "sales" ? "매출" : "매입"}_${month}.xlsx`
                )
              }
              className="px-4 py-2 bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text)] rounded-lg text-sm font-medium border border-[var(--border)] transition flex items-center gap-2"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Excel 내보내기
            </button>
          )}
        </div>
      </div>

      {/* Sales / Purchase Table */}
      {(tab === "sales" || tab === "purchase") && (
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden">
          {isLoading ? (
            <div className="p-16 text-center text-sm text-[var(--text-muted)]">
              불러오는 중...
            </div>
          ) : currentList.length === 0 ? (
            <div className="p-16 text-center">
              <div className="text-4xl mb-4">🧾</div>
              <div className="text-lg font-bold mb-2">
                {tab === "sales" ? "매출 계산서" : "매입 계산서"}가 없습니다
              </div>
              <div className="text-sm text-[var(--text-muted)]">
                {month} 기간에 등록된 세금계산서가 없습니다
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto"><table className="w-full min-w-[700px]">
              <thead>
                <tr className="text-xs text-[var(--text-dim)] border-b border-[var(--border)]">
                  <th className="text-left px-5 py-3 font-medium">거래처명</th>
                  <th className="text-left px-5 py-3 font-medium">구분</th>
                  <th className="text-right px-5 py-3 font-medium">공급가</th>
                  <th className="text-right px-5 py-3 font-medium">세액</th>
                  <th className="text-right px-5 py-3 font-medium">합계</th>
                  <th className="text-left px-5 py-3 font-medium">딜</th>
                  <th className="text-left px-5 py-3 font-medium">발행일</th>
                  <th className="text-center px-5 py-3 font-medium">상태</th>
                </tr>
              </thead>
              <tbody>
                {currentList.map((inv: any) => {
                  const sc =
                    (INVOICE_STATUS as any)[inv.status] || INVOICE_STATUS.draft;
                  return (
                    <tr
                      key={inv.id}
                      onClick={() => setSelectedInvoice(inv)}
                      className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-surface)] transition cursor-pointer"
                    >
                      <td className="px-5 py-3 text-sm font-medium">
                        {inv.counterparty_name}
                      </td>
                      <td className="px-5 py-3 text-xs">
                        {inv.label ? (
                          <span className="font-medium text-[var(--text)]">{inv.label}</span>
                        ) : (
                          <span className="text-[var(--text-dim)]">—</span>
                        )}
                        {inv.auto_issued && (
                          <span className="ml-1.5 px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 text-[10px]">자동</span>
                        )}
                        {inv.source === 'hometax_sync' && (
                          <span className="ml-1.5 px-1.5 py-0.5 rounded bg-green-500/10 text-green-400 text-[10px]">홈택스</span>
                        )}
                        {inv.original_invoice_id && (
                          <span className="ml-1.5 px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-400 text-[10px]">수정</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-sm text-right">
                        ₩{Number(inv.supply_amount).toLocaleString("ko")}
                      </td>
                      <td className="px-5 py-3 text-xs text-right text-[var(--text-muted)]">
                        ₩{Number(inv.tax_amount).toLocaleString("ko")}
                      </td>
                      <td className="px-5 py-3 text-sm text-right font-semibold">
                        ₩{Number(inv.total_amount).toLocaleString("ko")}
                      </td>
                      <td className="px-5 py-3 text-xs text-[var(--text-muted)]">
                        {(inv as any).deals?.name || "—"}
                      </td>
                      <td className="px-5 py-3 text-xs text-[var(--text-dim)]">
                        {inv.issue_date}
                      </td>
                      <td className="px-5 py-3 text-center">
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full ${sc.bg} ${sc.text}`}
                        >
                          {sc.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {/* Footer totals */}
              <tfoot>
                <tr className="border-t border-[var(--border)] bg-[var(--bg-surface)]">
                  <td
                    colSpan={2}
                    className="px-5 py-3 text-xs font-bold text-[var(--text-muted)]"
                  >
                    합계 ({currentList.length}건)
                  </td>
                  <td className="px-5 py-3 text-sm text-right font-bold">
                    ₩
                    {currentList
                      .reduce(
                        (s: number, inv: any) =>
                          s + Number(inv.supply_amount || 0),
                        0
                      )
                      .toLocaleString("ko")}
                  </td>
                  <td className="px-5 py-3 text-xs text-right font-bold text-[var(--text-muted)]">
                    ₩
                    {currentList
                      .reduce(
                        (s: number, inv: any) =>
                          s + Number(inv.tax_amount || 0),
                        0
                      )
                      .toLocaleString("ko")}
                  </td>
                  <td className="px-5 py-3 text-sm text-right font-bold">
                    ₩
                    {currentList
                      .reduce(
                        (s: number, inv: any) =>
                          s + Number(inv.total_amount || 0),
                        0
                      )
                      .toLocaleString("ko")}
                  </td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            </table></div>
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

      {/* Invoice Detail Modal */}
      {selectedInvoice && (
        <InvoiceDetailModal
          invoice={selectedInvoice}
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
              toast(`오류: ${err.message || '수정세금계산서 발행 실패'}`, "error");
            }
          }}
        />
      )}

      {/* Queue Tab (자동발행 대기) */}
      {tab === "queue" && (
        <div className="space-y-4">
          <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-5 mb-2">
            <div className="text-xs text-[var(--text-muted)] leading-relaxed">
              <strong className="text-[var(--text)]">자동발행 큐</strong>: 딜 매출 스케줄이 확정되면 세금계산서가 자동으로 큐에 등록됩니다.
              거래처 희망일이 설정된 경우 해당일까지 대기 후 발행됩니다. <span className="text-orange-400">승인 필요</span> 건은 확인 후 승인해주세요.
            </div>
          </div>

          {queueLoading ? (
            <div className="p-16 text-center text-sm text-[var(--text-muted)]">불러오는 중...</div>
          ) : queueItems.length === 0 ? (
            <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-16 text-center">
              <div className="text-4xl mb-4">⚡</div>
              <div className="text-lg font-bold mb-2">대기 중인 자동발행 없음</div>
              <div className="text-sm text-[var(--text-muted)]">딜의 매출 스케줄이 확정되면 여기에 표시됩니다</div>
            </div>
          ) : (
            <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden">
              <div className="overflow-x-auto"><table className="w-full min-w-[700px]">
                <thead>
                  <tr className="text-xs text-[var(--text-dim)] border-b border-[var(--border)]">
                    <th className="text-left px-5 py-3 font-medium">액션</th>
                    <th className="text-left px-5 py-3 font-medium">거래처</th>
                    <th className="text-right px-5 py-3 font-medium">금액</th>
                    <th className="text-left px-5 py-3 font-medium">발행일</th>
                    <th className="text-left px-5 py-3 font-medium">딜</th>
                    <th className="text-center px-5 py-3 font-medium">상태</th>
                    <th className="text-left px-5 py-3 font-medium">비고</th>
                    <th className="text-center px-5 py-3 font-medium">승인</th>
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
          <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-sm font-bold">홈택스 세금계산서 동기화</div>
                <div className="text-xs text-[var(--text-muted)] mt-1">
                  설정 &gt; 세무자동화에 등록된 홈택스 인증정보로 매출/매입 세금계산서를 자동 조회합니다
                </div>
              </div>
              <button
                onClick={async () => {
                  if (syncing) return;
                  setSyncing(true);
                  try {
                    const startDate = `${month}-01`;
                    const endDate = `${month}-31`;
                    const result = await syncHomeTaxInvoices({ startDate, endDate });
                    toast(`동기화 완료: ${JSON.stringify(result.results?.map((r: any) => `${r.type}: ${r.created}건 생성`) || [])}`, "success");
                    invalidate();
                    queryClient.invalidateQueries({ queryKey: ["hometax-sync-logs"] });
                  } catch (err: any) {
                    toast(`동기화 오류: ${err.message}`, "error");
                  } finally {
                    setSyncing(false);
                  }
                }}
                disabled={syncing}
                className="px-4 py-2.5 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl text-sm font-semibold transition disabled:opacity-50"
              >
                {syncing ? "동기화 중..." : `${month} 동기화 실행`}
              </button>
            </div>

            {/* Automation flow diagram */}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mt-4">
              {[
                { icon: "🔑", title: "홈택스 로그인", desc: "ID/PW 또는 공동인증서" },
                { icon: "📥", title: "자동 조회", desc: "매출/매입 계산서 수집" },
                { icon: "🔄", title: "중복 제거", desc: "승인번호 기준 dedup" },
                { icon: "✅", title: "3-Way 매칭", desc: "계약↔계산서↔입금" },
              ].map((step, i) => (
                <div key={i} className="bg-[var(--bg-surface)] rounded-xl p-3 text-center relative">
                  <div className="text-xl mb-1">{step.icon}</div>
                  <div className="text-xs font-bold">{step.title}</div>
                  <div className="text-[10px] text-[var(--text-dim)] mt-0.5">{step.desc}</div>
                  {i < 3 && <div className="hidden sm:block absolute right-[-10px] top-1/2 -translate-y-1/2 text-[var(--text-dim)]">→</div>}
                </div>
              ))}
            </div>
          </div>

          {/* Sync Logs */}
          <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden">
            <div className="px-5 py-3 border-b border-[var(--border)]">
              <span className="text-sm font-bold">동기화 이력</span>
            </div>
            {syncLogs.length === 0 ? (
              <div className="p-12 text-center text-sm text-[var(--text-muted)]">아직 동기화 이력이 없습니다</div>
            ) : (
              <div className="overflow-x-auto"><table className="w-full min-w-[600px]">
                <thead>
                  <tr className="text-xs text-[var(--text-dim)] border-b border-[var(--border)]">
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

      {/* 3-Way Matching Tab */}
      {tab === "matching" && (
        <div className="space-y-4">
          <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-5 mb-2">
            <div className="text-xs text-[var(--text-muted)] leading-relaxed">
              <strong className="text-[var(--text)]">3-Way 매칭</strong>: 계약금액 ↔
              세금계산서 ↔ 실제 입금액을 비교합니다. 세 금액이 모두 일치하면
              완전 매칭 처리됩니다.
            </div>
          </div>

          {matchLoading ? (
            <div className="p-16 text-center text-sm text-[var(--text-muted)]">
              매칭 분석 중...
            </div>
          ) : matchResults.length === 0 ? (
            <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-16 text-center">
              <div className="text-4xl mb-4">🔍</div>
              <div className="text-lg font-bold mb-2">매칭 대상 없음</div>
              <div className="text-sm text-[var(--text-muted)]">
                딜에 연결된 매출 세금계산서가 없습니다
              </div>
            </div>
          ) : (
            <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden">
              <div className="overflow-x-auto"><table className="w-full min-w-[700px]">
                <thead>
                  <tr className="text-xs text-[var(--text-dim)] border-b border-[var(--border)]">
                    <th className="text-left px-5 py-3 font-medium">딜명</th>
                    <th className="text-right px-5 py-3 font-medium">계약금액</th>
                    <th className="text-right px-5 py-3 font-medium">세금계산서</th>
                    <th className="text-right px-5 py-3 font-medium">입금액</th>
                    <th className="text-right px-5 py-3 font-medium">차액</th>
                    <th className="text-center px-5 py-3 font-medium">계약매칭</th>
                    <th className="text-center px-5 py-3 font-medium">입금매칭</th>
                    <th className="text-center px-5 py-3 font-medium">전체매칭</th>
                    <th className="text-center px-5 py-3 font-medium">액션</th>
                  </tr>
                </thead>
                <tbody>
                  {matchResults.map((r) => (
                    <tr
                      key={r.invoiceId}
                      className={`border-b border-[var(--border)]/50 transition ${
                        r.fullMatch
                          ? "bg-green-500/[.03]"
                          : "hover:bg-[var(--bg-surface)]"
                      }`}
                    >
                      <td className="px-5 py-3 text-sm font-medium">
                        {r.dealName || "딜 없음"}
                      </td>
                      <td className="px-5 py-3 text-sm text-right">
                        {r.contractAmount > 0
                          ? fmt(r.contractAmount)
                          : <span className="text-[var(--text-dim)]">—</span>}
                      </td>
                      <td className="px-5 py-3 text-sm text-right font-medium">
                        {fmt(r.invoiceAmount)}
                      </td>
                      <td className="px-5 py-3 text-sm text-right">
                        {r.receivedAmount > 0
                          ? fmt(r.receivedAmount)
                          : <span className="text-[var(--text-dim)]">—</span>}
                      </td>
                      <td
                        className={`px-5 py-3 text-sm text-right font-semibold ${
                          Math.abs(r.gap) < 1
                            ? "text-green-400"
                            : r.gap > 0
                            ? "text-red-400"
                            : "text-orange-400"
                        }`}
                      >
                        {r.gap !== 0
                          ? (r.gap > 0 ? "+" : "") + fmt(r.gap)
                          : "0"}
                      </td>
                      <td className="px-5 py-3 text-center">
                        <MatchBadge ok={r.amountMatch} na={r.contractAmount === 0} />
                      </td>
                      <td className="px-5 py-3 text-center">
                        <MatchBadge ok={r.paymentMatch} na={r.receivedAmount === 0} />
                      </td>
                      <td className="px-5 py-3 text-center">
                        <MatchBadge ok={r.fullMatch} na={false} />
                      </td>
                      <td className="px-5 py-3 text-center">
                        {r.fullMatch ? (
                          <button
                            onClick={() => markMatchedMut.mutate(r.invoiceId)}
                            disabled={markMatchedMut.isPending}
                            className="px-3 py-1 bg-green-500/10 text-green-400 hover:bg-green-500/20 rounded-lg text-xs font-semibold transition disabled:opacity-50"
                          >
                            매칭 확정
                          </button>
                        ) : (
                          <span className="text-xs text-[var(--text-dim)]">
                            미매칭
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            </div>
          )}
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

      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden">
        {periodSummary.length === 0 ? (
          <div className="p-16 text-center">
            <div className="text-4xl mb-4">📊</div>
            <div className="text-sm text-[var(--text-muted)]">{currentYear}년 세금계산서 데이터가 없습니다</div>
          </div>
        ) : (
          <div className="overflow-x-auto"><table className="w-full min-w-[700px]">
            <thead>
              <tr className="text-xs text-[var(--text-dim)] border-b border-[var(--border)]">
                <th className="text-left px-5 py-3 font-medium">기간</th>
                <th className="text-center px-5 py-3 font-medium">매출 건수</th>
                <th className="text-right px-5 py-3 font-medium">매출 공급가</th>
                <th className="text-right px-5 py-3 font-medium">매출 세액</th>
                <th className="text-center px-5 py-3 font-medium">매입 건수</th>
                <th className="text-right px-5 py-3 font-medium">매입 공급가</th>
                <th className="text-right px-5 py-3 font-medium">매입 세액</th>
                <th className="text-right px-5 py-3 font-medium">VAT 납부</th>
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
            <tfoot>
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
          <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden">
            <div className="overflow-x-auto"><table className="w-full min-w-[700px]">
              <thead>
                <tr className="text-xs text-[var(--text-dim)] border-b border-[var(--border)]">
                  <th className="text-left px-5 py-3 font-medium">월</th>
                  <th className="text-center px-5 py-3 font-medium">건수</th>
                  <th className="text-right px-5 py-3 font-medium">총 사용액</th>
                  <th className="text-right px-5 py-3 font-medium">공제대상</th>
                  <th className="text-right px-5 py-3 font-medium">불공제</th>
                  <th className="text-right px-5 py-3 font-medium">공제 추정</th>
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
              <tfoot>
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
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-5 mb-6">
        <div className="text-xs text-[var(--text-muted)] leading-relaxed">
          <strong className="text-[var(--text)]">VAT 미리보기</strong>: 분기별 부가가치세 납부/환급 예상액입니다.
          매출세액 - 매입세액 - 카드매입세액공제 = 최종 납부세액
        </div>
      </div>

      {/* Annual Total Card */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-5">
          <div className="text-xs text-[var(--text-dim)] mb-1">연간 매출세액</div>
          <div className="text-xl font-black text-green-500">₩{vatPreview.reduce((s: number, v: any) => s + v.salesTax, 0).toLocaleString()}</div>
        </div>
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-5">
          <div className="text-xs text-[var(--text-dim)] mb-1">연간 매입세액 + 카드공제</div>
          <div className="text-xl font-black text-orange-500">₩{vatPreview.reduce((s: number, v: any) => s + v.purchaseTax + v.cardDeduction, 0).toLocaleString()}</div>
        </div>
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-5">
          <div className="text-xs text-[var(--text-dim)] mb-1">연간 예상 납부세액</div>
          <div className={`text-xl font-black ${totalVAT >= 0 ? "text-[var(--primary)]" : "text-red-400"}`}>
            ₩{totalVAT.toLocaleString()}
          </div>
          <div className="text-xs text-[var(--text-muted)] mt-1">{totalVAT >= 0 ? "납부" : "환급"}</div>
        </div>
      </div>

      {/* Quarterly Breakdown */}
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden">
        <div className="overflow-x-auto"><table className="w-full min-w-[700px]">
          <thead>
            <tr className="text-xs text-[var(--text-dim)] border-b border-[var(--border)]">
              <th className="text-left px-5 py-3 font-medium">분기</th>
              <th className="text-right px-5 py-3 font-medium">매출세액</th>
              <th className="text-right px-5 py-3 font-medium">매입세액</th>
              <th className="text-right px-5 py-3 font-medium">카드공제</th>
              <th className="text-right px-5 py-3 font-medium">납부세액</th>
              <th className="text-left px-5 py-3 font-medium">납부기한</th>
              <th className="text-center px-5 py-3 font-medium">상태</th>
            </tr>
          </thead>
          <tbody>
            {vatPreview.map((v: any) => {
              const isPast = new Date(v.dueDate) < new Date();
              const hasActivity = v.salesTax > 0 || v.purchaseTax > 0;
              return (
                <tr key={v.quarter} className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-surface)]">
                  <td className="px-5 py-3 text-sm font-bold">{v.quarter}</td>
                  <td className="px-5 py-3 text-sm text-right text-green-500">₩{v.salesTax.toLocaleString()}</td>
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
function InvoiceDetailModal({ invoice, onClose, onModify }: { invoice: any; onClose: () => void; onModify: (inv: any) => void }) {
  const inv = invoice;
  const supplyAmt = Number(inv.supply_amount || 0);
  const taxAmt = Number(inv.tax_amount || 0);
  const totalAmt = Number(inv.total_amount || 0);
  const sc = (INVOICE_STATUS as any)[inv.status] || INVOICE_STATUS.draft;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] w-full max-w-[720px] max-h-[90vh] overflow-y-auto mx-4" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
          <div className="flex items-center gap-3">
            <span className="text-lg font-black">세금계산서</span>
            <span className={`text-xs px-2 py-0.5 rounded-full ${sc.bg} ${sc.text}`}>{sc.label}</span>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text)] text-xl transition">&times;</button>
        </div>

        {/* Tax Invoice Form (국세청 양식 스타일) */}
        <div className="p-6">
          <div className="border-2 border-[var(--primary)] rounded-lg overflow-hidden">
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
                  <div className="flex"><span className="text-[var(--text-dim)] w-16 shrink-0">등록번호</span><span className="font-medium">{inv.type === "sales" ? "123-45-67890" : (inv.counterparty_bizno || "—")}</span></div>
                  <div className="flex"><span className="text-[var(--text-dim)] w-16 shrink-0">상호</span><span className="font-medium">{inv.type === "sales" ? "(주)우리회사" : inv.counterparty_name}</span></div>
                  <div className="flex"><span className="text-[var(--text-dim)] w-16 shrink-0">대표자</span><span className="text-[var(--text-muted)]">—</span></div>
                  <div className="flex"><span className="text-[var(--text-dim)] w-16 shrink-0">업태/종목</span><span className="text-[var(--text-muted)]">—</span></div>
                </div>
              </div>
              {/* 공급받는자 */}
              <div className="p-3">
                <div className="text-[10px] font-bold text-orange-400 mb-2 tracking-wider">공급받는자</div>
                <div className="space-y-1.5 text-xs">
                  <div className="flex"><span className="text-[var(--text-dim)] w-16 shrink-0">등록번호</span><span className="font-medium">{inv.type === "purchase" ? "123-45-67890" : (inv.counterparty_bizno || "—")}</span></div>
                  <div className="flex"><span className="text-[var(--text-dim)] w-16 shrink-0">상호</span><span className="font-medium">{inv.type === "purchase" ? "(주)우리회사" : inv.counterparty_name}</span></div>
                  <div className="flex"><span className="text-[var(--text-dim)] w-16 shrink-0">대표자</span><span className="text-[var(--text-muted)]">—</span></div>
                  <div className="flex"><span className="text-[var(--text-dim)] w-16 shrink-0">업태/종목</span><span className="text-[var(--text-muted)]">—</span></div>
                </div>
              </div>
            </div>

            {/* Amount summary */}
            <div className="border-t border-[var(--border)] grid grid-cols-4 divide-x divide-[var(--border)] text-center">
              <div className="p-2">
                <div className="text-[10px] text-[var(--text-dim)]">작성일자</div>
                <div className="text-xs font-bold mt-0.5">{inv.issue_date}</div>
              </div>
              <div className="p-2">
                <div className="text-[10px] text-[var(--text-dim)]">공급가액</div>
                <div className="text-xs font-bold mt-0.5 text-green-500">₩{supplyAmt.toLocaleString()}</div>
              </div>
              <div className="p-2">
                <div className="text-[10px] text-[var(--text-dim)]">세액</div>
                <div className="text-xs font-bold mt-0.5">₩{taxAmt.toLocaleString()}</div>
              </div>
              <div className="p-2">
                <div className="text-[10px] text-[var(--text-dim)]">합계금액</div>
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
                      {inv.label || EXPENSE_CATEGORIES.find((c: any) => c.value === inv.expense_category)?.label || "—"}
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
                <span className="text-[var(--text-dim)]">딜: </span>
                <span className="font-medium">{inv.deals?.name || "—"}</span>
              </div>
              <div>
                <span className="text-[var(--text-dim)]">비목: </span>
                <span className="font-medium">{EXPENSE_CATEGORIES.find(c => c.value === inv.expense_category)?.label || inv.label || "—"}</span>
              </div>
              <div>
                <span className="text-[var(--text-dim)]">거래처 희망일: </span>
                <span className="font-medium">{inv.preferred_date || "—"}</span>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 mt-4">
            <button
              onClick={() => onModify(inv)}
              className="px-4 py-2 bg-orange-500/10 text-orange-400 hover:bg-orange-500/20 rounded-lg text-sm font-semibold transition"
            >
              수정세금계산서 발행
            </button>
            <button
              onClick={() => {
                const printContent = document.querySelector('[data-invoice-print]');
                if (printContent) window.print();
              }}
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
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] w-full max-w-[520px] mx-4" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-[var(--border)]">
          <h3 className="text-sm font-black">수정세금계산서 발행</h3>
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
              <input
                type="number"
                value={modifyAmount}
                onChange={(e) => setModifyAmount(e.target.value)}
                placeholder={`현재: ${Number(invoice.supply_amount).toLocaleString()}`}
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
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
