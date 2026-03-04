"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/queries";
import {
  createTaxInvoice,
  threeWayMatch,
  markInvoiceMatched,
  INVOICE_TYPES,
  INVOICE_STATUS,
} from "@/lib/tax-invoice";
import * as XLSX from "xlsx";

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

export default function TaxInvoicesPage() {
  const queryClient = useQueryClient();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [tab, setTab] = useState<"sales" | "purchase" | "matching">("sales");
  const [month, setMonth] = useState(getCurrentMonth());
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    type: "sales" as "sales" | "purchase",
    counterpartyName: "",
    counterpartyBizno: "",
    supplyAmount: "",
    issueDate: "",
  });

  useEffect(() => {
    getCurrentUser().then((u) => {
      if (u) setCompanyId(u.company_id);
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
        .select("*, deals(name)")
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
      <div className="flex items-center justify-between mb-8">
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

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4 mb-8">
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
          <div className="grid grid-cols-3 gap-4 mb-4">
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
      <div className="flex items-center gap-2 mb-6">
        {(
          [
            { key: "sales" as const, label: "매출 (발행)", count: salesInvoices.length },
            { key: "purchase" as const, label: "매입 (수취)", count: purchaseInvoices.length },
            { key: "matching" as const, label: "3-Way 매칭", count: matchResults.length },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
              tab === t.key
                ? "bg-[var(--primary)]/10 text-[var(--primary)]"
                : "text-[var(--text-muted)] hover:text-[var(--text)]"
            }`}
          >
            {t.label}{" "}
            <span className="text-xs opacity-70">({t.count})</span>
          </button>
        ))}

        {/* Excel export button */}
        {tab !== "matching" && currentList.length > 0 && (
          <button
            onClick={() =>
              exportToExcel(
                currentList,
                `세금계산서_${tab === "sales" ? "매출" : "매입"}_${month}.xlsx`
              )
            }
            className="ml-auto px-4 py-2 bg-[var(--bg-surface)] hover:bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text)] rounded-lg text-sm font-medium border border-[var(--border)] transition flex items-center gap-2"
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
              />
            </svg>
            Excel 다운로드
          </button>
        )}
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
            <table className="w-full">
              <thead>
                <tr className="text-xs text-[var(--text-dim)] border-b border-[var(--border)]">
                  <th className="text-left px-5 py-3 font-medium">거래처명</th>
                  <th className="text-left px-5 py-3 font-medium">사업자번호</th>
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
                      className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-surface)] transition"
                    >
                      <td className="px-5 py-3 text-sm font-medium">
                        {inv.counterparty_name}
                      </td>
                      <td className="px-5 py-3 text-xs text-[var(--text-muted)]">
                        {inv.counterparty_bizno || "—"}
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
            </table>
          )}
        </div>
      )}

      {/* 3-Way Matching Tab */}
      {tab === "matching" && (
        <div className="space-y-4">
          <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-5 mb-2">
            <div className="text-xs text-[var(--text-muted)] leading-relaxed">
              <strong className="text-white">3-Way 매칭</strong>: 계약금액 ↔
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
              <table className="w-full">
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
              </table>
            </div>
          )}
        </div>
      )}
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
