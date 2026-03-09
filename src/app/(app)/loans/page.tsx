"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getCurrentUser } from "@/lib/queries";
import {
  getLoans,
  getAllLoanPayments,
  getLoanSummary,
  createLoan,
  updateLoan,
  recordLoanPayment,
  deleteLoan,
  type LoanRow,
  type LoanPaymentRow,
} from "@/lib/loans";
import { QueryErrorBanner } from "@/components/query-status";

type Tab = "list" | "payments" | "register";

function fmtW(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(1)}억`;
  if (abs >= 1e4) return `${sign}${Math.round(abs / 1e4).toLocaleString()}만`;
  return `${sign}₩${abs.toLocaleString()}`;
}

const LOAN_STATUS: Record<string, { label: string; bg: string; text: string }> = {
  active: { label: "상환중", bg: "bg-blue-500/10", text: "text-blue-400" },
  paid_off: { label: "완납", bg: "bg-green-500/10", text: "text-green-400" },
  refinanced: { label: "대환", bg: "bg-yellow-500/10", text: "text-yellow-400" },
};

const LOAN_TYPES: Record<string, string> = {
  term: "기업대출",
  credit_line: "한도대출",
  facility: "시설대출",
  government: "정책자금",
};

export default function LoansPage() {
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("list");
  const [editingLoan, setEditingLoan] = useState<LoanRow | null>(null);
  const queryClient = useQueryClient();

  // Register form
  const [form, setForm] = useState({
    name: "", lender: "", loanType: "term",
    originalAmount: "", remainingBalance: "",
    interestRate: "", startDate: "", maturityDate: "",
    paymentDay: "", interestDay: "", notes: "",
  });

  // Payment form
  const [payForm, setPayForm] = useState({
    loanId: "", paymentDate: "", principalAmount: "", interestAmount: "", paymentNumber: "", notes: "",
  });
  const [showPayForm, setShowPayForm] = useState(false);

  useEffect(() => {
    getCurrentUser().then((u) => {
      if (u) { setCompanyId(u.company_id); setUserId(u.id); }
    });
  }, []);

  const { data: summary, error: mainError, refetch } = useQuery({
    queryKey: ["loan-summary", companyId],
    queryFn: () => getLoanSummary(companyId!),
    enabled: !!companyId,
  });

  const { data: allPayments = [] } = useQuery({
    queryKey: ["loan-payments-all", companyId],
    queryFn: () => getAllLoanPayments(companyId!),
    enabled: !!companyId,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["loan-summary"] });
    queryClient.invalidateQueries({ queryKey: ["loan-payments-all"] });
  };

  const createMut = useMutation({
    mutationFn: () => createLoan({
      companyId: companyId!,
      name: form.name,
      lender: form.lender,
      loanType: form.loanType,
      originalAmount: Number(form.originalAmount) || 0,
      remainingBalance: Number(form.remainingBalance) || 0,
      interestRate: Number(form.interestRate) || undefined,
      startDate: form.startDate || undefined,
      maturityDate: form.maturityDate || undefined,
      paymentDay: Number(form.paymentDay) || undefined,
      interestDay: Number(form.interestDay) || undefined,
      notes: form.notes || undefined,
    }),
    onSuccess: () => {
      invalidate();
      setTab("list");
      setForm({ name: "", lender: "", loanType: "term", originalAmount: "", remainingBalance: "", interestRate: "", startDate: "", maturityDate: "", paymentDay: "", interestDay: "", notes: "" });
    },
  });

  const updateMut = useMutation({
    mutationFn: (params: { id: string; data: Parameters<typeof updateLoan>[1] }) =>
      updateLoan(params.id, params.data),
    onSuccess: () => { invalidate(); setEditingLoan(null); },
  });

  const deleteMut = useMutation({
    mutationFn: deleteLoan,
    onSuccess: invalidate,
  });

  const payMut = useMutation({
    mutationFn: () => recordLoanPayment({
      loanId: payForm.loanId,
      paymentDate: payForm.paymentDate,
      principalAmount: Number(payForm.principalAmount) || 0,
      interestAmount: Number(payForm.interestAmount) || 0,
      paymentNumber: Number(payForm.paymentNumber) || undefined,
      notes: payForm.notes || undefined,
    }),
    onSuccess: () => {
      invalidate();
      setShowPayForm(false);
      setPayForm({ loanId: "", paymentDate: "", principalAmount: "", interestAmount: "", paymentNumber: "", notes: "" });
    },
  });

  const loans = summary?.loans || [];
  const TABS: { key: Tab; label: string }[] = [
    { key: "list", label: `대출 목록 (${loans.length})` },
    { key: "payments", label: `상환 이력 (${allPayments.length})` },
    { key: "register", label: "대출 등록" },
  ];

  const statCards = [
    { label: "총 대출금", value: fmtW(summary?.totalOriginal || 0), sub: summary?.totalOriginal ? "" : "은행 확인 필요" },
    { label: "현재 잔금", value: fmtW(summary?.totalRemaining || 0), sub: summary?.totalRemaining ? "" : "은행 확인 필요" },
    { label: "최근 납부", value: fmtW(summary?.monthlyPayment || 0), sub: "월 납부액" },
    { label: "총 상환", value: `${summary?.totalPayments || 0}회차`, sub: "납부 완료" },
  ];

  return (
    <div className="max-w-[900px]">
      <QueryErrorBanner error={mainError} onRetry={refetch} />

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold">대출 관리</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">대출 현황, 상환 이력, 잔금 추적</p>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {statCards.map((c) => (
          <div key={c.label} className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-4">
            <div className="text-[11px] text-[var(--text-dim)] mb-1">{c.label}</div>
            <div className="text-lg font-bold">{c.value}</div>
            {c.sub && <div className="text-[10px] text-[var(--text-dim)] mt-0.5">{c.sub}</div>}
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-[var(--bg-surface)] rounded-xl p-1 mb-4">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex-1 text-xs font-semibold py-2 rounded-lg transition ${
              tab === t.key ? "bg-[var(--bg-card)] text-[var(--text)] shadow-sm" : "text-[var(--text-muted)] hover:text-[var(--text)]"
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* List Tab */}
      {tab === "list" && (
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden">
          {loans.length === 0 ? (
            <div className="p-16 text-center">
              <div className="text-4xl mb-4">🏦</div>
              <div className="text-sm text-[var(--text-muted)]">등록된 대출이 없습니다</div>
              <button onClick={() => setTab("register")} className="mt-3 text-xs text-[var(--primary)] hover:underline">대출 등록하기</button>
            </div>
          ) : (
            <div className="divide-y divide-[var(--border)]/50">
              {loans.map((loan) => {
                const st = LOAN_STATUS[loan.status] || LOAN_STATUS.active;
                const isEditing = editingLoan?.id === loan.id;
                return (
                  <div key={loan.id} className="p-5 hover:bg-[var(--bg-surface)]/50 transition">
                    {isEditing ? (
                      <EditLoanForm loan={loan} onSave={(data) => updateMut.mutate({ id: loan.id, data })} onCancel={() => setEditingLoan(null)} />
                    ) : (
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-bold text-sm">{loan.name}</span>
                            <span className={`text-[10px] px-2 py-0.5 rounded-full ${st.bg} ${st.text}`}>{st.label}</span>
                            <span className="text-[10px] text-[var(--text-dim)]">{LOAN_TYPES[loan.loan_type] || loan.loan_type}</span>
                          </div>
                          <div className="text-xs text-[var(--text-muted)] mb-2">{loan.lender}</div>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                            <div>
                              <span className="text-[var(--text-dim)]">최초 대출금</span>
                              <div className="font-semibold mt-0.5">{loan.original_amount ? fmtW(Number(loan.original_amount)) : "미입력"}</div>
                            </div>
                            <div>
                              <span className="text-[var(--text-dim)]">잔금</span>
                              <div className="font-semibold mt-0.5">{loan.remaining_balance ? fmtW(Number(loan.remaining_balance)) : "미입력"}</div>
                            </div>
                            <div>
                              <span className="text-[var(--text-dim)]">이율</span>
                              <div className="font-semibold mt-0.5">{loan.interest_rate ? `${loan.interest_rate}%` : "-"}</div>
                            </div>
                            <div>
                              <span className="text-[var(--text-dim)]">납부일</span>
                              <div className="font-semibold mt-0.5">
                                {loan.payment_day ? `매월 ${loan.payment_day}일` : "-"}
                                {loan.interest_day && loan.interest_day !== loan.payment_day ? ` (이자 ${loan.interest_day}일)` : ""}
                              </div>
                            </div>
                          </div>
                          {(loan.start_date || loan.maturity_date) && (
                            <div className="text-[10px] text-[var(--text-dim)] mt-2">
                              {loan.start_date && `시작: ${loan.start_date}`}
                              {loan.start_date && loan.maturity_date && " → "}
                              {loan.maturity_date && `만기: ${loan.maturity_date}`}
                            </div>
                          )}
                          {loan.notes && <div className="text-[10px] text-[var(--text-dim)] mt-1 italic">{loan.notes}</div>}
                        </div>
                        <div className="flex gap-1 ml-3">
                          <button onClick={() => setEditingLoan(loan)} className="text-[10px] px-2 py-1 rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg-surface)]">수정</button>
                          <button onClick={() => { if (confirm("이 대출을 삭제하시겠습니까?")) deleteMut.mutate(loan.id); }}
                            className="text-[10px] px-2 py-1 rounded-lg border border-red-500/20 text-red-400 hover:bg-red-500/10">삭제</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Payments Tab */}
      {tab === "payments" && (
        <div className="space-y-4">
          {/* Add payment button */}
          <div className="flex justify-end">
            <button onClick={() => { setShowPayForm(!showPayForm); if (loans.length > 0 && !payForm.loanId) setPayForm(f => ({ ...f, loanId: loans[0].id })); }}
              className="text-xs px-3 py-1.5 rounded-lg bg-[var(--primary)]/10 text-[var(--primary)] hover:bg-[var(--primary)]/20">
              {showPayForm ? "취소" : "+ 상환 기록"}
            </button>
          </div>

          {/* Payment form */}
          {showPayForm && (
            <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-5">
              <h3 className="text-sm font-bold mb-3">상환 기록 추가</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
                <div>
                  <label className="block text-[10px] text-[var(--text-dim)] mb-1">대출 선택 *</label>
                  <select value={payForm.loanId} onChange={e => setPayForm(f => ({ ...f, loanId: e.target.value }))}
                    className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-xs">
                    <option value="">선택</option>
                    {loans.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-[var(--text-dim)] mb-1">납부일 *</label>
                  <input type="date" value={payForm.paymentDate} onChange={e => setPayForm(f => ({ ...f, paymentDate: e.target.value }))}
                    className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-xs" />
                </div>
                <div>
                  <label className="block text-[10px] text-[var(--text-dim)] mb-1">회차</label>
                  <input type="number" value={payForm.paymentNumber} onChange={e => setPayForm(f => ({ ...f, paymentNumber: e.target.value }))}
                    className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-xs" placeholder="3" />
                </div>
                <div>
                  <label className="block text-[10px] text-[var(--text-dim)] mb-1">원금 상환 *</label>
                  <input type="number" value={payForm.principalAmount} onChange={e => setPayForm(f => ({ ...f, principalAmount: e.target.value }))}
                    className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-xs" placeholder="3,751,053" />
                </div>
                <div>
                  <label className="block text-[10px] text-[var(--text-dim)] mb-1">이자 *</label>
                  <input type="number" value={payForm.interestAmount} onChange={e => setPayForm(f => ({ ...f, interestAmount: e.target.value }))}
                    className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-xs" placeholder="1,269,125" />
                </div>
                <div>
                  <label className="block text-[10px] text-[var(--text-dim)] mb-1">메모</label>
                  <input value={payForm.notes} onChange={e => setPayForm(f => ({ ...f, notes: e.target.value }))}
                    className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-xs" />
                </div>
              </div>
              <button onClick={() => payMut.mutate()} disabled={!payForm.loanId || !payForm.paymentDate || payMut.isPending}
                className="text-xs px-4 py-2 rounded-xl bg-[var(--primary)] text-white hover:opacity-90 disabled:opacity-50">
                {payMut.isPending ? "저장 중..." : "저장"}
              </button>
            </div>
          )}

          {/* Payments table */}
          <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden">
            {allPayments.length === 0 ? (
              <div className="p-16 text-center">
                <div className="text-4xl mb-4">📋</div>
                <div className="text-sm text-[var(--text-muted)]">상환 이력이 없습니다</div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[600px]">
                  <thead>
                    <tr className="text-[10px] text-[var(--text-dim)] border-b border-[var(--border)]">
                      <th className="text-left px-4 py-3 font-medium">#</th>
                      <th className="text-left px-4 py-3 font-medium">대출</th>
                      <th className="text-left px-4 py-3 font-medium">납부일</th>
                      <th className="text-right px-4 py-3 font-medium">원금</th>
                      <th className="text-right px-4 py-3 font-medium">이자</th>
                      <th className="text-right px-4 py-3 font-medium">합계</th>
                      <th className="text-center px-4 py-3 font-medium">거래연결</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allPayments.map((p) => {
                      const loan = loans.find(l => l.id === p.loan_id);
                      return (
                        <tr key={p.id} className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-surface)]/50">
                          <td className="px-4 py-3 text-xs font-mono text-[var(--primary)]">{p.payment_number || "-"}</td>
                          <td className="px-4 py-3 text-xs font-medium">{loan?.name || "-"}</td>
                          <td className="px-4 py-3 text-xs text-[var(--text-muted)]">{p.payment_date}</td>
                          <td className="px-4 py-3 text-xs text-right font-medium">₩{Number(p.principal_amount).toLocaleString()}</td>
                          <td className="px-4 py-3 text-xs text-right text-[var(--text-muted)]">₩{Number(p.interest_amount).toLocaleString()}</td>
                          <td className="px-4 py-3 text-xs text-right font-bold">₩{Number(p.total_amount).toLocaleString()}</td>
                          <td className="px-4 py-3 text-center">
                            {p.bank_transaction_id ? (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-400">연결됨</span>
                            ) : (
                              <span className="text-[10px] text-[var(--text-dim)]">-</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Register Tab */}
      {tab === "register" && (
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6">
          <h3 className="text-sm font-bold mb-4">새 대출 등록</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-[10px] text-[var(--text-dim)] mb-1">대출명 *</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm" placeholder="IBK 기업대출" />
            </div>
            <div>
              <label className="block text-[10px] text-[var(--text-dim)] mb-1">금융기관 *</label>
              <input value={form.lender} onChange={e => setForm(f => ({ ...f, lender: e.target.value }))}
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm" placeholder="IBK기업은행" />
            </div>
            <div>
              <label className="block text-[10px] text-[var(--text-dim)] mb-1">대출 유형</label>
              <select value={form.loanType} onChange={e => setForm(f => ({ ...f, loanType: e.target.value }))}
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm">
                {Object.entries(LOAN_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-[var(--text-dim)] mb-1">최초 대출금액</label>
              <input type="number" value={form.originalAmount} onChange={e => setForm(f => ({ ...f, originalAmount: e.target.value }))}
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm" placeholder="100000000" />
            </div>
            <div>
              <label className="block text-[10px] text-[var(--text-dim)] mb-1">현재 잔금</label>
              <input type="number" value={form.remainingBalance} onChange={e => setForm(f => ({ ...f, remainingBalance: e.target.value }))}
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm" placeholder="80000000" />
            </div>
            <div>
              <label className="block text-[10px] text-[var(--text-dim)] mb-1">연이율 (%)</label>
              <input type="number" step="0.01" value={form.interestRate} onChange={e => setForm(f => ({ ...f, interestRate: e.target.value }))}
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm" placeholder="4.5" />
            </div>
            <div>
              <label className="block text-[10px] text-[var(--text-dim)] mb-1">대출 시작일</label>
              <input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))}
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm" />
            </div>
            <div>
              <label className="block text-[10px] text-[var(--text-dim)] mb-1">만기일</label>
              <input type="date" value={form.maturityDate} onChange={e => setForm(f => ({ ...f, maturityDate: e.target.value }))}
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm" />
            </div>
            <div>
              <label className="block text-[10px] text-[var(--text-dim)] mb-1">원금 납부일 (매월)</label>
              <input type="number" min="1" max="31" value={form.paymentDay} onChange={e => setForm(f => ({ ...f, paymentDay: e.target.value }))}
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm" placeholder="26" />
            </div>
            <div>
              <label className="block text-[10px] text-[var(--text-dim)] mb-1">이자 납부일 (매월)</label>
              <input type="number" min="1" max="31" value={form.interestDay} onChange={e => setForm(f => ({ ...f, interestDay: e.target.value }))}
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm" placeholder="25" />
            </div>
          </div>
          <div className="mb-4">
            <label className="block text-[10px] text-[var(--text-dim)] mb-1">메모</label>
            <input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm" placeholder="비고" />
          </div>
          <button onClick={() => createMut.mutate()} disabled={!form.name || !form.lender || createMut.isPending}
            className="text-sm px-5 py-2.5 rounded-xl bg-[var(--primary)] text-white hover:opacity-90 disabled:opacity-50">
            {createMut.isPending ? "등록 중..." : "대출 등록"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Edit Loan Inline Form ──
function EditLoanForm({ loan, onSave, onCancel }: {
  loan: LoanRow;
  onSave: (data: Parameters<typeof updateLoan>[1]) => void;
  onCancel: () => void;
}) {
  const [f, setF] = useState({
    name: loan.name,
    originalAmount: String(loan.original_amount || ""),
    remainingBalance: String(loan.remaining_balance || ""),
    interestRate: String(loan.interest_rate || ""),
    notes: loan.notes || "",
  });

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div>
          <label className="block text-[10px] text-[var(--text-dim)] mb-1">대출명</label>
          <input value={f.name} onChange={e => setF(p => ({ ...p, name: e.target.value }))}
            className="w-full px-2 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs" />
        </div>
        <div>
          <label className="block text-[10px] text-[var(--text-dim)] mb-1">최초 대출금</label>
          <input type="number" value={f.originalAmount} onChange={e => setF(p => ({ ...p, originalAmount: e.target.value }))}
            className="w-full px-2 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs" />
        </div>
        <div>
          <label className="block text-[10px] text-[var(--text-dim)] mb-1">현재 잔금</label>
          <input type="number" value={f.remainingBalance} onChange={e => setF(p => ({ ...p, remainingBalance: e.target.value }))}
            className="w-full px-2 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs" />
        </div>
        <div>
          <label className="block text-[10px] text-[var(--text-dim)] mb-1">연이율 (%)</label>
          <input type="number" step="0.01" value={f.interestRate} onChange={e => setF(p => ({ ...p, interestRate: e.target.value }))}
            className="w-full px-2 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs" />
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={() => onSave({
          name: f.name,
          originalAmount: Number(f.originalAmount) || undefined,
          remainingBalance: Number(f.remainingBalance) || undefined,
          interestRate: Number(f.interestRate) || undefined,
          notes: f.notes || undefined,
        })} className="text-[10px] px-3 py-1.5 rounded-lg bg-[var(--primary)] text-white">저장</button>
        <button onClick={onCancel} className="text-[10px] px-3 py-1.5 rounded-lg border border-[var(--border)] text-[var(--text-muted)]">취소</button>
      </div>
    </div>
  );
}
