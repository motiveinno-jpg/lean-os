"use client";

import { useEffect, useState } from "react";
import { friendlyError } from "@/lib/friendly-error";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getCurrentUser, getPaymentQueue, getBankAccounts } from "@/lib/queries";
import { approvePayment, rejectPayment, executePayment, createQueueEntry, getPaymentQueueStats } from "@/lib/payment-queue";
import { getRecurringPayments, upsertRecurringPayment, deleteRecurringPayment, getPaymentBatches, refreshRecurringAmounts, type RefreshResult } from "@/lib/approval-center";
import { createPayrollBatch, createFixedCostBatch, approveBatch, triggerBatchExecution, getBatchWithItems, getPrevMonthPayrollSnapshot, type BatchSummary, type PayrollItem } from "@/lib/payment-batch";
import { runAllAutomation, type AutomationResult } from "@/lib/automation";
import { detectRecurringFromBankTx, registerDetectedRecurring, type DetectedRecurring } from "@/lib/smart-setup";
import { createExpenseRequest, getExpenseRequests, approveExpense, rejectExpense, markExpensePaid, EXPENSE_CATEGORIES, EXPENSE_STATUS } from "@/lib/expenses";
import { QueryErrorBanner } from "@/components/query-status";
import { CurrencyInput } from "@/components/currency-input";
import { useToast } from "@/components/toast";
import { useUser } from "@/components/user-context";
import { AccessDenied } from "@/components/access-denied";
import { supabase } from "@/lib/supabase";

type Tab = 'queue' | 'payroll' | 'fixed' | 'recurring' | 'expenses';

export default function PaymentsPage() {
  const { role } = useUser();
  if (role === "employee" || role === "partner") {
    return <AccessDenied detail="자금/결제는 대표·관리자 전용입니다." />;
  }

  const [companyId, setCompanyId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(() => {
    if (typeof window === 'undefined') return 'queue';
    const t = new URLSearchParams(window.location.search).get('tab');
    const valid: Tab[] = ['queue', 'payroll', 'fixed', 'recurring', 'expenses'];
    return (valid as string[]).includes(t || '') ? (t as Tab) : 'queue';
  });
  const [filter, setFilter] = useState<string>("all");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ amount: "", description: "" });
  const queryClient = useQueryClient();

  useEffect(() => {
    getCurrentUser().then((u) => {
      if (u) {
        setCompanyId(u.company_id);
        setUserId(u.id);
      }
    }).finally(() => setIsInitLoading(false));
  }, []);

  const [isInitLoading, setIsInitLoading] = useState(true);

  const { data: queue = [], error: mainError, refetch: mainRefetch } = useQuery({
    queryKey: ["payment-queue", companyId],
    queryFn: () => getPaymentQueue(companyId!),
    enabled: !!companyId,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["payment-queue"] });
    queryClient.invalidateQueries({ queryKey: ["payment-stats"] });
    queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
    queryClient.invalidateQueries({ queryKey: ["payment-batches"] });
    queryClient.invalidateQueries({ queryKey: ["recurring-payments"] });
    queryClient.invalidateQueries({ queryKey: ["detected-recurring"] });
  };

  const TABS: { key: Tab; label: string }[] = [
    { key: 'queue', label: '결제 큐' },
    { key: 'expenses', label: '지출결의/품의' },
    { key: 'payroll', label: '급여 일괄' },
    { key: 'fixed', label: '고정비 일괄' },
    { key: 'recurring', label: '반복 결제 설정' },
  ];

  if (isInitLoading) return <div className="p-6 text-center text-[var(--text-muted)]">불러오는 중...</div>;
  if (mainError) return <div className="p-6 text-center text-red-400">데이터를 불러올 수 없습니다. 새로고침해 주세요.</div>;

  return (
    <div className="">
      <QueryErrorBanner error={mainError as Error | null} onRetry={mainRefetch} />
      <div className="page-sticky-header flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold break-keep">결제 관리</h1>
          <p className="text-xs sm:text-sm text-[var(--text-muted)] mt-1 break-keep">결제 큐 + 급여/고정비 배치 + 반복결제</p>
        </div>
      </div>

      {/* Smart Setup Banner + Pipeline + Automation */}
      {companyId && (
        <SmartSetupBanner companyId={companyId} invalidate={invalidate} />
      )}

      {/* Tab navigation */}
      <div className="flex gap-1 mb-6 bg-[var(--bg-surface)] rounded-xl p-1 overflow-x-auto scrollbar-hide">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`shrink-0 flex-1 min-w-fit px-3 sm:px-4 py-2.5 rounded-lg text-xs font-semibold transition whitespace-nowrap ${
              tab === t.key
                ? 'bg-[var(--bg-card)] text-[var(--text)] shadow-sm'
                : 'text-[var(--text-muted)] hover:text-[var(--text)]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'queue' && companyId && userId && (
        <PaymentQueueTab companyId={companyId} userId={userId} filter={filter} setFilter={setFilter}
          showForm={showForm} setShowForm={setShowForm} form={form} setForm={setForm} invalidate={invalidate} />
      )}
      {tab === 'expenses' && companyId && userId && (
        <ExpenseTab companyId={companyId} userId={userId} invalidate={invalidate} />
      )}
      {tab === 'payroll' && companyId && userId && (
        <PayrollBatchTab companyId={companyId} userId={userId} invalidate={invalidate} />
      )}
      {tab === 'fixed' && companyId && userId && (
        <FixedCostBatchTab companyId={companyId} userId={userId} invalidate={invalidate} />
      )}
      {tab === 'recurring' && companyId && (
        <RecurringPaymentsTab companyId={companyId} invalidate={invalidate} />
      )}
    </div>
  );
}

// ── Tab 1: Payment Queue (기존) ──

function PaymentQueueTab({ companyId, userId, filter, setFilter, showForm, setShowForm, form, setForm, invalidate }: {
  companyId: string; userId: string; filter: string; setFilter: (f: string) => void;
  showForm: boolean; setShowForm: (s: boolean) => void;
  form: { amount: string; description: string }; setForm: (f: { amount: string; description: string }) => void;
  invalidate: () => void;
}) {
  const { data: queue = [] } = useQuery({
    queryKey: ["payment-queue", companyId],
    queryFn: () => getPaymentQueue(companyId),
    enabled: !!companyId,
  });

  const { data: stats } = useQuery({
    queryKey: ["payment-stats", companyId],
    queryFn: () => getPaymentQueueStats(companyId),
    enabled: !!companyId,
  });

  const { data: bankAccounts = [] } = useQuery({
    queryKey: ["bank-accounts", companyId],
    queryFn: () => getBankAccounts(companyId),
    enabled: !!companyId,
  });

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0, failed: 0 });
  const { toast: queueToast } = useToast();
  const [receiptItem, setReceiptItem] = useState<any | null>(null);
  const [refundItem, setRefundItem] = useState<any | null>(null);
  const [refundReason, setRefundReason] = useState("");
  const [refundStep, setRefundStep] = useState<1 | 2>(1);
  const [refundSubmitting, setRefundSubmitting] = useState(false);

  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (receiptItem) { setReceiptItem(null); return; }
      if (refundItem && !refundSubmitting) { setRefundItem(null); return; }
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [receiptItem, refundItem, refundSubmitting]);

  async function submitRefund() {
    if (!refundItem || !refundReason.trim() || !userId) return;
    setRefundSubmitting(true);
    try {
      const db: any = supabase;
      const { error } = await db.from('payment_queue').update({
        status: 'refunded',
        refund_reason: refundReason.trim(),
        refunded_at: new Date().toISOString(),
        refunded_by: userId,
      }).eq('id', refundItem.id);
      if (error) throw error;
      await db.from('audit_logs').insert({
        company_id: companyId,
        user_id: userId,
        action: 'update',
        entity_type: 'payment',
        entity_id: refundItem.id,
        metadata: { action: 'refund', reason: refundReason.trim(), amount: refundItem.amount, entity_name: refundItem.description || '결제' },
        created_at: new Date().toISOString(),
      });
      queueToast(`₩${Number(refundItem.amount).toLocaleString()} 환불 처리되었습니다`, 'success');
      setRefundItem(null);
      setRefundReason("");
      setRefundStep(1);
      invalidate();
    } catch (e: any) {
      queueToast('환불 처리 실패: ' + (e.message || '알 수 없는 오류'), 'error');
    } finally {
      setRefundSubmitting(false);
    }
  }

  const approveMut = useMutation({
    mutationFn: (id: string) => approvePayment(id, userId),
    onSuccess: (result) => {
      invalidate();
      if (result && typeof result === 'object') {
        if (result.autoExecuted) queueToast("승인 + 자동이체 완료", "success");
        else if (result.notified) queueToast("승인됨 — 한도 초과로 대표 텔레그램 승인 요청 전송", "info");
        else if (result.error) queueToast("승인됨 (자동이체 실패: " + result.error + ")", "info");
        else queueToast("승인되었습니다", "success");
      } else {
        queueToast("승인되었습니다", "success");
      }
    },
    onError: (err: Error) => { queueToast("승인 실패: " + (err?.message || ""), "error"); },
  });
  const rejectMut = useMutation({ mutationFn: (id: string) => rejectPayment(id, userId), onSuccess: () => { invalidate(); queueToast("거부되었습니다", "success"); }, onError: (err: Error) => { queueToast("거부 실패: " + (err?.message || ""), "error"); } });
  const executeMut = useMutation({ mutationFn: (id: string) => executePayment(id), onSuccess: () => { invalidate(); queueToast("실행 완료", "success"); }, onError: (err: Error) => { queueToast("실행 실패: " + (err?.message || ""), "error"); } });
  const createMut = useMutation({
    mutationFn: () => createQueueEntry({ companyId, amount: Number(form.amount), description: form.description }),
    onSuccess: () => { invalidate(); setShowForm(false); setForm({ amount: "", description: "" }); queueToast("결제가 등록되었습니다", "success"); },
    onError: (err: Error) => { queueToast("등록 실패: " + (err?.message || ""), "error"); },
  });

  // 'executed' and legacy 'completed' are treated as the same bucket in filter and stats.
  const filtered = filter === "all"
    ? queue
    : filter === "executed"
      ? queue.filter((q: any) => q.status === 'executed' || q.status === 'completed')
      : queue.filter((q: any) => q.status === filter);

  function toggleOne(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleAllSelectable() {
    const selectable = filtered.filter((q: any) => q.status === 'pending' || q.status === 'approved').map((q: any) => q.id);
    setSelectedIds(prev => {
      const allSelected = selectable.length > 0 && selectable.every((id: string) => prev.has(id));
      return allSelected ? new Set() : new Set(selectable);
    });
  }
  function clearSelection() { setSelectedIds(new Set()); }

  async function runBulk(action: 'approve' | 'reject' | 'execute') {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    // 액션별로 가능한 항목만 필터
    const candidates = filtered.filter((q: any) => {
      if (!selectedIds.has(q.id)) return false;
      if (action === 'approve' || action === 'reject') return q.status === 'pending';
      if (action === 'execute') return q.status === 'approved';
      return false;
    });
    if (candidates.length === 0) {
      queueToast(action === 'execute' ? '실행 가능한 항목이 없습니다 (승인완료 상태만 가능)' : '대기 중인 항목이 없습니다', 'info');
      return;
    }
    const verb = action === 'approve' ? '승인' : action === 'reject' ? '거부' : '실행';
    if (!confirm(`${candidates.length}건 ${verb}하시겠습니까?`)) return;
    setBulkRunning(true);
    setBulkProgress({ done: 0, total: candidates.length, failed: 0 });
    let failed = 0;
    for (let i = 0; i < candidates.length; i++) {
      try {
        const id = candidates[i].id;
        if (action === 'approve') await approvePayment(id, userId);
        else if (action === 'reject') await rejectPayment(id, userId);
        else await executePayment(id);
      } catch { failed++; }
      setBulkProgress({ done: i + 1, total: candidates.length, failed });
    }
    setBulkRunning(false);
    setSelectedIds(new Set());
    invalidate();
    queueToast(`${verb} 완료: ${candidates.length - failed}/${candidates.length}${failed > 0 ? ` (실패 ${failed}건)` : ''}`, failed > 0 ? 'error' : 'success');
  }

  const selectableInView = filtered.filter((q: any) => q.status === 'pending' || q.status === 'approved');
  const allSelected = selectableInView.length > 0 && selectableInView.every((q: any) => selectedIds.has(q.id));
  const selectedSum = filtered.filter((q: any) => selectedIds.has(q.id)).reduce((s: number, q: any) => s + Number(q.amount || 0), 0);
  const statusConfig: Record<string, { label: string; bg: string; text: string }> = {
    pending: { label: "승인대기", bg: "bg-yellow-500/10", text: "text-yellow-400" },
    approved: { label: "승인완료", bg: "bg-blue-500/10", text: "text-blue-400" },
    executed: { label: "실행완료", bg: "bg-green-500/10", text: "text-green-400" },
    completed: { label: "실행완료", bg: "bg-green-500/10", text: "text-green-400" },
    rejected: { label: "거부", bg: "bg-red-500/10", text: "text-red-400" },
    refunded: { label: "환불완료", bg: "bg-orange-500/10", text: "text-orange-400" },
  };

  return (
    <>
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-6">
        <div className="glass-card p-4 overflow-hidden">
          <div className="text-xs text-[var(--text-dim)]">승인 대기</div>
          <div className="text-lg font-bold text-yellow-400 mt-1 truncate">{stats?.pendingCount ?? 0}건</div>
          <div className="text-xs text-[var(--text-dim)] mt-0.5 truncate">₩{(stats?.pendingAmount ?? 0).toLocaleString()}</div>
        </div>
        <div className="glass-card p-4 overflow-hidden">
          <div className="text-xs text-[var(--text-dim)]">승인 완료</div>
          <div className="text-lg font-bold text-blue-400 mt-1 truncate">{stats?.approvedCount ?? 0}건</div>
          <div className="text-xs text-[var(--text-dim)] mt-0.5 truncate">₩{(stats?.approvedAmount ?? 0).toLocaleString()}</div>
        </div>
        <div className="glass-card p-4 overflow-hidden">
          <div className="text-xs text-[var(--text-dim)]">실행 완료</div>
          <div className="text-lg font-bold text-green-400 mt-1 truncate">{stats?.executedCount ?? 0}건</div>
          <div className="text-xs text-[var(--text-dim)] mt-0.5 truncate">₩{(stats?.executedAmount ?? 0).toLocaleString()}</div>
        </div>
        <div className="glass-card p-4 overflow-hidden">
          <div className="text-xs text-[var(--text-dim)]">통장 총 잔고</div>
          <div className="text-lg font-bold mt-1 truncate">₩{bankAccounts.reduce((s: number, a: any) => s + Number(a.balance || 0), 0).toLocaleString()}</div>
          <div className="text-xs text-[var(--text-dim)] mt-0.5 truncate">{bankAccounts.length}개 통장</div>
        </div>
      </div>

      {/* Add button */}
      <div className="flex justify-end mb-4">
        <button onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl text-xs font-semibold transition">
          + 수동 결제 등록
        </button>
      </div>

      {showForm && (
        <div className="glass-card p-6 mb-6">
          <h3 className="text-sm font-bold mb-4">수동 결제 등록</h3>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">금액 (원) *</label>
              <CurrencyInput value={form.amount} onValueChange={(raw) => setForm({ ...form, amount: raw })}
                placeholder="1000000"
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">설명</label>
              <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="외주비 - A업체"
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => Number(form.amount) > 0 && createMut.mutate()}
              disabled={!form.amount || createMut.isPending}
              className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-sm font-semibold disabled:opacity-50">등록</button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 text-[var(--text-muted)] text-sm">취소</button>
          </div>
        </div>
      )}

      {/* Filter */}
      <div className="flex gap-2 mb-4">
        {[
          { key: "all", label: "전체" }, { key: "pending", label: "승인대기" },
          { key: "approved", label: "승인완료" }, { key: "executed", label: "실행완료" }, { key: "refunded", label: "환불" }, { key: "rejected", label: "거부" },
        ].map((f) => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              filter === f.key ? "bg-[var(--primary)]/10 text-[var(--primary)]" : "text-[var(--text-muted)] hover:text-[var(--text)]"
            }`}>
            {f.label}
          </button>
        ))}
      </div>

      {/* 벌크 액션바 — 선택 항목이 있을 때만 표시 */}
      {selectedIds.size > 0 && (
        <div className="sticky top-0 z-10 mb-3 bg-[var(--primary)]/10 border border-[var(--primary)]/30 rounded-xl px-4 py-3 flex flex-wrap items-center gap-3">
          <div className="text-sm font-semibold text-[var(--primary)]">
            {selectedIds.size}건 선택됨 · ₩{selectedSum.toLocaleString()}
          </div>
          {bulkRunning && (
            <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
              <span>처리 중 {bulkProgress.done}/{bulkProgress.total}</span>
              <div className="w-32 h-1.5 bg-[var(--bg)] rounded-full overflow-hidden">
                <div className="h-full bg-[var(--primary)] transition-all" style={{ width: `${bulkProgress.total > 0 ? (bulkProgress.done / bulkProgress.total) * 100 : 0}%` }} />
              </div>
              {bulkProgress.failed > 0 && <span className="text-red-400">실패 {bulkProgress.failed}</span>}
            </div>
          )}
          <div className="ml-auto flex gap-2">
            <button onClick={() => runBulk('approve')} disabled={bulkRunning}
              className="px-3 py-1.5 bg-blue-500/15 hover:bg-blue-500/25 text-blue-400 rounded-lg text-xs font-semibold transition disabled:opacity-50">
              일괄 승인
            </button>
            <button onClick={() => runBulk('reject')} disabled={bulkRunning}
              className="px-3 py-1.5 bg-red-500/15 hover:bg-red-500/25 text-red-400 rounded-lg text-xs font-semibold transition disabled:opacity-50">
              일괄 거부
            </button>
            <button onClick={() => runBulk('execute')} disabled={bulkRunning}
              className="px-3 py-1.5 bg-green-500/15 hover:bg-green-500/25 text-green-400 rounded-lg text-xs font-semibold transition disabled:opacity-50">
              일괄 실행
            </button>
            <button onClick={clearSelection} disabled={bulkRunning}
              className="px-3 py-1.5 bg-[var(--bg-surface)] hover:bg-[var(--border)] text-[var(--text-muted)] rounded-lg text-xs font-semibold transition disabled:opacity-50">
              선택 해제
            </button>
          </div>
        </div>
      )}

      {/* Queue */}
      <div className="glass-card overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-16 text-center">
            <div className="text-4xl mb-4">💳</div>
            <div className="text-lg font-bold mb-2">결제 큐가 비어있습니다</div>
            <div className="text-sm text-[var(--text-muted)]">프로젝트 비용 스케줄에서 자동 생성되거나 수동으로 등록하세요</div>
          </div>
        ) : (
          <div className="overflow-auto max-h-[560px] relative"><table className="w-full min-w-[600px]">
            <thead>
              <tr className="text-xs text-[var(--text-dim)] border-b border-[var(--border)]">
                <th className="px-3 py-3 w-10">
                  <input type="checkbox" checked={allSelected} onChange={toggleAllSelectable}
                    disabled={selectableInView.length === 0}
                    className="w-4 h-4 rounded border-[var(--border)] accent-[var(--primary)] cursor-pointer disabled:opacity-30"
                    title="선택 가능 항목 전체 선택" />
                </th>
                <th className="text-left px-5 py-3 font-medium">설명</th>
                <th className="text-right px-5 py-3 font-medium">금액</th>
                <th className="text-left px-5 py-3 font-medium">통장</th>
                <th className="text-center px-5 py-3 font-medium">상태</th>
                <th className="text-left px-5 py-3 font-medium">등록일</th>
                <th className="text-center px-5 py-3 font-medium">액션</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item: any) => {
                const sc = statusConfig[item.status] || statusConfig.pending;
                const selectable = item.status === 'pending' || item.status === 'approved';
                const isSelected = selectedIds.has(item.id);
                return (
                  <tr key={item.id} className={`border-b border-[var(--border)]/50 hover:bg-[var(--bg-surface)] transition ${isSelected ? 'bg-[var(--primary)]/5' : ''}`}>
                    <td className="px-3 py-3">
                      <input type="checkbox" checked={isSelected} disabled={!selectable}
                        onChange={() => toggleOne(item.id)}
                        className="w-4 h-4 rounded border-[var(--border)] accent-[var(--primary)] cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                        title={selectable ? '선택' : '벌크 액션 불가 (실행/거부 완료)'} />
                    </td>
                    <td className="px-5 py-3 text-sm">{item.description || "—"}</td>
                    <td className="px-5 py-3 text-sm text-right font-medium">₩{Number(item.amount).toLocaleString()}</td>
                    <td className="px-5 py-3 text-xs text-[var(--text-muted)]">{item.bank_accounts?.alias || item.bank_accounts?.bank_name || "미지정"}</td>
                    <td className="px-5 py-3 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${sc.bg} ${sc.text}`}>{sc.label}</span>
                    </td>
                    <td className="px-5 py-3 text-xs text-[var(--text-dim)]">
                      {item.created_at ? new Date(item.created_at).toLocaleDateString('ko') : "—"}
                    </td>
                    <td className="px-5 py-3 text-center">
                      <div className="flex gap-1.5 justify-center">
                        {item.status === "pending" && (
                          <>
                            <button onClick={() => approveMut.mutate(item.id)} disabled={approveMut.isPending}
                              className="px-2.5 py-1 bg-blue-500/10 text-blue-400 rounded-lg text-xs font-medium hover:bg-blue-500/20 transition">승인</button>
                            <button onClick={() => rejectMut.mutate(item.id)} disabled={rejectMut.isPending}
                              className="px-2.5 py-1 bg-red-500/10 text-red-400 rounded-lg text-xs font-medium hover:bg-red-500/20 transition">거부</button>
                          </>
                        )}
                        {item.status === "approved" && (
                          <button onClick={() => executeMut.mutate(item.id)} disabled={executeMut.isPending}
                            className="px-2.5 py-1 bg-green-500/10 text-green-400 rounded-lg text-xs font-medium hover:bg-green-500/20 transition">실행</button>
                        )}
                        {item.status === "executed" && (
                          <>
                            <button onClick={() => setReceiptItem(item)}
                              className="px-2.5 py-1 bg-blue-500/10 text-blue-400 rounded-lg text-xs font-medium hover:bg-blue-500/20 transition">영수증</button>
                            <button onClick={() => { setRefundItem(item); setRefundReason(""); setRefundStep(1); }}
                              className="px-2.5 py-1 bg-orange-500/10 text-orange-400 rounded-lg text-xs font-medium hover:bg-orange-500/20 transition">환불</button>
                          </>
                        )}
                        {item.status === "refunded" && (
                          <button onClick={() => setReceiptItem(item)}
                            className="px-2.5 py-1 bg-[var(--bg-surface)] text-[var(--text-muted)] rounded-lg text-xs font-medium hover:bg-[var(--border)] transition">영수증</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        )}
      </div>

      {/* 영수증 모달 */}
      {receiptItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setReceiptItem(null)}>
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div id="receipt-printable" className="p-6">
              <div className="text-center mb-4">
                <div className="text-xs text-[var(--text-dim)]">RECEIPT / 영수증</div>
                <div className="text-lg font-extrabold mt-1">오너뷰 결제 내역</div>
                <div className="text-[10px] text-[var(--text-dim)] mt-1">#{receiptItem.id?.slice(0, 8).toUpperCase()}</div>
              </div>
              <div className="border-t border-b border-[var(--border)] py-4 space-y-2">
                <div className="flex justify-between text-sm"><span className="text-[var(--text-dim)]">결제일</span><span>{receiptItem.executed_at ? new Date(receiptItem.executed_at).toLocaleString('ko-KR') : (receiptItem.created_at ? new Date(receiptItem.created_at).toLocaleString('ko-KR') : '—')}</span></div>
                <div className="flex justify-between text-sm"><span className="text-[var(--text-dim)]">설명</span><span className="text-right max-w-[60%]">{receiptItem.description || '—'}</span></div>
                <div className="flex justify-between text-sm"><span className="text-[var(--text-dim)]">통장</span><span>{receiptItem.bank_accounts?.alias || receiptItem.bank_accounts?.bank_name || '—'}</span></div>
                <div className="flex justify-between text-sm"><span className="text-[var(--text-dim)]">상태</span><span className={receiptItem.status === 'refunded' ? 'text-orange-400 font-semibold' : 'text-green-400 font-semibold'}>{receiptItem.status === 'refunded' ? '환불완료' : '실행완료'}</span></div>
                {receiptItem.status === 'refunded' && receiptItem.refund_reason && (
                  <div className="flex justify-between text-sm"><span className="text-[var(--text-dim)]">환불사유</span><span className="text-right max-w-[60%] text-orange-400">{receiptItem.refund_reason}</span></div>
                )}
              </div>
              <div className="flex justify-between items-center mt-4">
                <span className="text-sm text-[var(--text-dim)]">총 금액</span>
                <span className={`text-2xl font-extrabold ${receiptItem.status === 'refunded' ? 'line-through text-[var(--text-dim)]' : ''}`}>₩{Number(receiptItem.amount).toLocaleString()}</span>
              </div>
            </div>
            <div className="flex gap-2 p-4 border-t border-[var(--border)]">
              <button onClick={() => setReceiptItem(null)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-[var(--bg-surface)] text-[var(--text)] hover:bg-[var(--border)] transition">닫기</button>
              <button onClick={() => {
                const el = document.getElementById('receipt-printable');
                if (!el) return;
                const w = window.open('', '_blank', 'width=600,height=800');
                if (!w) { queueToast('팝업이 차단되었습니다. 팝업을 허용해주세요.', 'error'); return; }
                w.document.write(`<html><head><title>영수증</title><style>body{font-family:sans-serif;padding:20px;color:#000}.row{display:flex;justify-content:space-between;padding:4px 0;font-size:14px}.hr{border-top:1px solid #ccc;margin:12px 0}.center{text-align:center;margin-bottom:16px}.big{font-size:22px;font-weight:900}</style></head><body onload="window.print();window.close()">${el.innerHTML.replace(/var\(--[^)]+\)/g, '#333').replace(/text-\w+-\d+/g, '')}</body></html>`);
                w.document.close();
              }} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-[var(--primary)] text-white hover:opacity-90 transition">PDF / 인쇄</button>
            </div>
          </div>
        </div>
      )}

      {/* 환불 모달 */}
      {refundItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => !refundSubmitting && setRefundItem(null)}>
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <h3 className="text-lg font-extrabold text-orange-400 mb-2">
                {refundStep === 1 ? '환불 요청' : '⚠️ 환불 최종 확인'}
              </h3>
              <p className="text-sm text-[var(--text-muted)] mb-4">
                {refundStep === 1
                  ? '환불 사유를 입력하면 결제 상태가 환불 처리됩니다. (되돌릴 수 없습니다)'
                  : '한번 더 확인해주세요. 환불 후에는 상태를 되돌릴 수 없습니다.'}
              </p>
              <div className="bg-[var(--bg-surface)] rounded-xl p-3 mb-4">
                <div className="text-xs text-[var(--text-dim)] mb-1">대상</div>
                <div className="text-sm font-semibold">{refundItem.description || '—'}</div>
                <div className="text-lg font-extrabold text-orange-400 mt-1">₩{Number(refundItem.amount).toLocaleString()}</div>
              </div>
              {refundStep === 1 ? (
                <textarea value={refundReason} onChange={(e) => setRefundReason(e.target.value)} rows={3} placeholder="환불 사유 (필수) - 예: 서비스 취소, 중복결제, 고객 요청"
                  className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)] resize-none mb-4" />
              ) : (
                <div className="bg-orange-500/10 border border-orange-500/30 rounded-xl p-3 mb-4">
                  <div className="text-xs text-[var(--text-dim)] mb-1">환불 사유</div>
                  <div className="text-sm">{refundReason}</div>
                </div>
              )}
              <div className="flex gap-2">
                <button disabled={refundSubmitting} onClick={() => { if (refundStep === 2) setRefundStep(1); else setRefundItem(null); }}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-[var(--bg-surface)] text-[var(--text)] hover:bg-[var(--border)] transition disabled:opacity-50">
                  {refundStep === 2 ? '이전' : '취소'}
                </button>
                {refundStep === 1 ? (
                  <button disabled={!refundReason.trim()} onClick={() => setRefundStep(2)}
                    className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-orange-600 text-white hover:bg-orange-700 transition disabled:opacity-50">다음</button>
                ) : (
                  <button disabled={refundSubmitting} onClick={submitRefund}
                    className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-red-600 text-white hover:bg-red-700 transition disabled:opacity-50">
                    {refundSubmitting ? '처리 중...' : '환불 확정'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Tab 2: Payroll Batch ──

function PayrollBatchTab({ companyId, userId, invalidate }: { companyId: string; userId: string; invalidate: () => void }) {
  const { toast } = useToast();
  const [generating, setGenerating] = useState(false);
  const [lastResult, setLastResult] = useState<{ items: PayrollItem[] } | null>(null);
  const [copyPrompt, setCopyPrompt] = useState<{ monthLabel: string; itemCount: number; exists: boolean } | null>(null);
  const queryClient = useQueryClient();

  const { data: batches = [] } = useQuery({
    queryKey: ["payment-batches", companyId, "payroll"],
    queryFn: async () => {
      const all = await getPaymentBatches(companyId);
      return (all || []).filter((b: any) => b.batch_type === 'payroll');
    },
    enabled: !!companyId,
  });

  const approveMut = useMutation({
    mutationFn: (batchId: string) => approveBatch(batchId, userId),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["payment-batches"] }); invalidate(); toast("급여 배치가 승인되었습니다", "success"); },
    onError: (err: Error) => { toast("승인 실패: " + (err?.message || ""), "error"); },
  });

  const executeMut = useMutation({
    mutationFn: (batchId: string) => triggerBatchExecution(batchId),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["payment-batches"] }); invalidate(); toast("이체가 실행되었습니다", "success"); },
    onError: (err: Error) => { toast("실행 실패: " + (err?.message || ""), "error"); },
  });

  // 1단계: 배치 생성 진입 시 "지난달 명세 복사?" 프롬프트를 **항상** 노출한다.
  //   (R4: 기존엔 직전월 데이터가 자동 감지될 때만 모달을 띄우고 없으면 조용히
  //    새로 산정 → 직원이 "안 물어보는데…"로 인지. 복사 로직은 그대로 두고
  //    노출만 보강: 직전월 데이터가 없으면 모달에서 그 사실을 알리고 새로 산정.)
  async function handleGenerate() {
    setGenerating(true);
    try {
      const snap = await getPrevMonthPayrollSnapshot(companyId);
      setCopyPrompt({
        monthLabel: snap?.monthLabel ?? "",
        itemCount: snap?.itemCount ?? 0,
        exists: !!snap?.exists,
      });
    } catch (err: any) {
      toast(friendlyError(err, '급여 배치 생성 실패'), "error");
    }
    setGenerating(false);
  }

  // 2단계: 실제 배치 생성 (copy=true 면 직전월 명세 프리필, false 면 자동산정)
  // V6: 예=지난달 복사(현행) / 아니요=빈칸 배치(직접 입력). blank 시 0원 행 생성.
  async function runGenerate(copyFromPrevMonth: boolean, blank = false) {
    setCopyPrompt(null);
    setGenerating(true);
    try {
      const result = await createPayrollBatch(companyId, undefined, { copyFromPrevMonth, blank });
      setLastResult(result);
      queryClient.invalidateQueries({ queryKey: ["payment-batches"] });
      invalidate();
      toast(
        blank ? "빈 급여 배치를 생성했습니다 — 명세에서 직접 입력하세요"
          : copyFromPrevMonth ? "지난달 명세를 복사해 배치를 생성했습니다" : "급여 배치를 생성했습니다",
        "success",
      );
    } catch (err: any) {
      toast(friendlyError(err, '급여 배치 생성 실패'), "error");
    }
    setGenerating(false);
  }

  const statusLabel: Record<string, { label: string; color: string }> = {
    draft: { label: '초안', color: 'text-gray-400' },
    pending_approval: { label: '승인대기', color: 'text-yellow-400' },
    approved: { label: '승인완료', color: 'text-blue-400' },
    executing: { label: '실행중', color: 'text-orange-400' },
    completed: { label: '완료', color: 'text-green-400' },
    failed: { label: '실패', color: 'text-red-400' },
  };

  return (
    <>
      {/* 직전월 명세 복사 여부 모달 */}
      {copyPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setCopyPrompt(null)}>
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="text-lg font-bold mb-2">지난달 명세를 그대로 복사할까요?</div>
            {copyPrompt.exists ? (
              <>
                <p className="text-sm text-[var(--text-muted)] leading-relaxed mb-1">
                  <strong className="text-[var(--text)]">{copyPrompt.monthLabel}</strong> 급여 명세가 있습니다
                  {copyPrompt.itemCount > 0 && <span> ({copyPrompt.itemCount}건)</span>}.
                </p>
                <p className="text-xs text-[var(--text-dim)] leading-relaxed mb-5">
                  · <strong>예</strong>: 지난달 기본급·비과세 입력값을 그대로 가져와 이번 달 명세에 반영합니다 (4대보험·세금은 동일 기준으로 재산정).<br />
                  · <strong>아니오</strong>: 빈 명세(공란)로 생성합니다. 명세에서 직접 입력하세요.
                </p>
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => runGenerate(false, true)}
                    disabled={generating}
                    className="px-4 py-2.5 rounded-xl text-xs font-semibold border border-[var(--border)] hover:bg-[var(--bg)] transition disabled:opacity-50"
                  >
                    아니오 — 빈칸 생성
                  </button>
                  <button
                    onClick={() => runGenerate(true)}
                    disabled={generating}
                    className="px-4 py-2.5 rounded-xl text-xs font-semibold bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white transition disabled:opacity-50"
                  >
                    예 — 그대로 복사
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-[var(--text-muted)] leading-relaxed mb-1">
                  {copyPrompt.monthLabel
                    ? <><strong className="text-[var(--text)]">{copyPrompt.monthLabel}</strong> 급여 명세가 없어 복사할 항목이 없습니다.</>
                    : <>복사할 지난달 급여 명세가 없습니다.</>}
                </p>
                <p className="text-xs text-[var(--text-dim)] leading-relaxed mb-5">
                  복사할 지난달 명세가 없어 <strong>빈 명세(공란)</strong>로 생성합니다.
                  명세에서 직접 입력하세요. (다음 달부터는 이번 달 명세를 복사해 올 수 있습니다.)
                </p>
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => setCopyPrompt(null)}
                    disabled={generating}
                    className="px-4 py-2.5 rounded-xl text-xs font-semibold border border-[var(--border)] hover:bg-[var(--bg)] transition disabled:opacity-50"
                  >
                    취소
                  </button>
                  <button
                    onClick={() => runGenerate(false, true)}
                    disabled={generating}
                    className="px-4 py-2.5 rounded-xl text-xs font-semibold bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white transition disabled:opacity-50"
                  >
                    확인 — 빈칸 생성
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-bold">급여 일괄 이체</h2>
          <p className="text-xs text-[var(--text-muted)] mt-1">전 직원 급여 배치 생성 → 대표 승인 → 일괄 이체</p>
        </div>
        <button onClick={handleGenerate} disabled={generating}
          className="px-4 py-2.5 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl text-xs font-semibold transition disabled:opacity-50">
          {generating ? '생성 중...' : '이번 달 급여 배치 생성'}
        </button>
      </div>

      {/* Last generated preview */}
      {lastResult && (
        <div className="bg-green-500/5 border border-green-500/20 rounded-2xl p-4 mb-6">
          <div className="text-sm font-bold text-green-500 mb-3">급여 배치가 생성되었습니다 ({lastResult.items.length}명)</div>
          <div className="space-y-1">
            {lastResult.items.map((item, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <span>{item.employeeName}</span>
                <div className="flex gap-4">
                  <span className="text-[var(--text-dim)]">기본급 ₩{item.baseSalary.toLocaleString()}</span>
                  <span className="text-red-400">공제 ₩{item.deductionsTotal.toLocaleString()}</span>
                  <span className="font-bold">실지급 ₩{item.netPay.toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Batch history */}
      <div className="glass-card overflow-hidden">
        {batches.length === 0 ? (
          <div className="p-12 text-center">
            <div className="text-3xl mb-3">💰</div>
            <div className="text-sm font-bold mb-1">급여 배치 없음</div>
            <div className="text-xs text-[var(--text-muted)]">"이번 달 급여 배치 생성" 버튼으로 시작하세요</div>
          </div>
        ) : (
          <div className="overflow-auto max-h-[560px] relative"><table className="w-full min-w-[600px]">
            <thead>
              <tr className="text-xs text-[var(--text-dim)] border-b border-[var(--border)]">
                <th className="text-left px-5 py-3 font-medium">배치명</th>
                <th className="text-right px-5 py-3 font-medium">총액</th>
                <th className="text-center px-5 py-3 font-medium">인원</th>
                <th className="text-center px-5 py-3 font-medium">상태</th>
                <th className="text-left px-5 py-3 font-medium">생성일</th>
                <th className="text-center px-5 py-3 font-medium">액션</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b: any) => {
                const sl = statusLabel[b.status] || statusLabel.draft;
                return (
                  <tr key={b.id} className="border-b border-[var(--border)]/50">
                    <td className="px-5 py-3 text-sm font-medium">{b.name}</td>
                    <td className="px-5 py-3 text-sm text-right font-bold">₩{Number(b.total_amount || 0).toLocaleString()}</td>
                    <td className="px-5 py-3 text-sm text-center">{b.item_count || 0}명</td>
                    <td className="px-5 py-3 text-center">
                      <span className={`text-xs font-semibold ${sl.color}`}>{sl.label}</span>
                    </td>
                    <td className="px-5 py-3 text-xs text-[var(--text-dim)]">
                      {b.created_at ? new Date(b.created_at).toLocaleDateString('ko') : '—'}
                    </td>
                    <td className="px-5 py-3 text-center">
                      <div className="flex gap-1.5 justify-center">
                        {(b.status === 'draft' || b.status === 'pending_approval') && (
                          <button onClick={() => approveMut.mutate(b.id)} disabled={approveMut.isPending}
                            className="px-2.5 py-1 bg-blue-500/10 text-blue-400 rounded-lg text-xs font-medium hover:bg-blue-500/20 transition">
                            승인
                          </button>
                        )}
                        {b.status === 'approved' && (
                          <button onClick={() => executeMut.mutate(b.id)} disabled={executeMut.isPending}
                            className="px-2.5 py-1 bg-green-500/10 text-green-400 rounded-lg text-xs font-medium hover:bg-green-500/20 transition">
                            이체 실행
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        )}
      </div>
    </>
  );
}

// ── Tab 3: Fixed Cost Batch ──

function FixedCostBatchTab({ companyId, userId, invalidate }: { companyId: string; userId: string; invalidate: () => void }) {
  const { toast } = useToast();
  const [generating, setGenerating] = useState(false);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: batches = [] } = useQuery({
    queryKey: ["payment-batches", companyId, "fixed_cost"],
    queryFn: async () => {
      const all = await getPaymentBatches(companyId);
      return (all || []).filter((b: any) => b.batch_type === 'fixed_cost');
    },
    enabled: !!companyId,
  });

  const approveMut = useMutation({
    mutationFn: (batchId: string) => approveBatch(batchId, userId),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["payment-batches"] }); invalidate(); toast("고정비 배치가 승인되었습니다", "success"); },
    onError: (err: Error) => { toast("승인 실패: " + (err?.message || ""), "error"); },
  });

  const executeMut = useMutation({
    mutationFn: (batchId: string) => triggerBatchExecution(batchId),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["payment-batches"] }); invalidate(); toast("이체가 실행되었습니다", "success"); },
    onError: (err: Error) => { toast("실행 실패: " + (err?.message || ""), "error"); },
  });

  async function handleGenerate() {
    setGenerating(true);
    try {
      await createFixedCostBatch(companyId);
      queryClient.invalidateQueries({ queryKey: ["payment-batches"] });
      invalidate();
    } catch (err: any) {
      toast(friendlyError(err, '고정비 배치 생성 실패'), "error");
    }
    setGenerating(false);
  }

  const statusLabel: Record<string, { label: string; color: string }> = {
    draft: { label: '초안', color: 'text-gray-400' },
    approved: { label: '승인완료', color: 'text-blue-400' },
    executing: { label: '실행중', color: 'text-orange-400' },
    completed: { label: '완료', color: 'text-green-400' },
    failed: { label: '실패', color: 'text-red-400' },
  };

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-bold">고정비 일괄 이체</h2>
          <p className="text-xs text-[var(--text-muted)] mt-1">반복결제(임대/보험/구독 등) 배치 → 대표 승인 → 일괄 이체</p>
        </div>
        <button onClick={handleGenerate} disabled={generating}
          className="px-4 py-2.5 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl text-xs font-semibold transition disabled:opacity-50">
          {generating ? '생성 중...' : '이번 달 고정비 배치 생성'}
        </button>
      </div>

      {selectedBatchId && (
        <BatchDetailModal
          batchId={selectedBatchId}
          onClose={() => setSelectedBatchId(null)}
        />
      )}

      <div className="glass-card overflow-hidden">
        {batches.length === 0 ? (
          <div className="p-12 text-center">
            <div className="text-3xl mb-3">🏢</div>
            <div className="text-sm font-bold mb-1">고정비 배치 없음</div>
            <div className="text-xs text-[var(--text-muted)]">반복결제를 먼저 설정하고 배치를 생성하세요</div>
          </div>
        ) : (
          <div className="overflow-auto max-h-[560px] relative"><table className="w-full min-w-[500px]">
            <thead>
              <tr className="text-xs text-[var(--text-dim)] border-b border-[var(--border)]">
                <th className="text-left px-5 py-3 font-medium">배치명</th>
                <th className="text-right px-5 py-3 font-medium">총액</th>
                <th className="text-center px-5 py-3 font-medium">건수</th>
                <th className="text-center px-5 py-3 font-medium">상태</th>
                <th className="text-center px-5 py-3 font-medium">액션</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b: any) => {
                const sl = statusLabel[b.status] || statusLabel.draft;
                return (
                  <tr
                    key={b.id}
                    onClick={() => setSelectedBatchId(b.id)}
                    className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-surface)] transition cursor-pointer"
                  >
                    <td className="px-5 py-3 text-sm font-medium">{b.name}</td>
                    <td className="px-5 py-3 text-sm text-right font-bold">₩{Number(b.total_amount || 0).toLocaleString()}</td>
                    <td className="px-5 py-3 text-sm text-center">{b.item_count || 0}건</td>
                    <td className="px-5 py-3 text-center">
                      <span className={`text-xs font-semibold ${sl.color}`}>{sl.label}</span>
                    </td>
                    <td className="px-5 py-3 text-center">
                      <div className="flex gap-1.5 justify-center">
                        {(b.status === 'draft' || b.status === 'pending_approval') && (
                          <button
                            onClick={(e) => { e.stopPropagation(); approveMut.mutate(b.id); }}
                            disabled={approveMut.isPending}
                            className="px-2.5 py-1 bg-blue-500/10 text-blue-400 rounded-lg text-xs font-medium hover:bg-blue-500/20 transition">승인</button>
                        )}
                        {b.status === 'approved' && (
                          <button
                            onClick={(e) => { e.stopPropagation(); executeMut.mutate(b.id); }}
                            disabled={executeMut.isPending}
                            className="px-2.5 py-1 bg-green-500/10 text-green-400 rounded-lg text-xs font-medium hover:bg-green-500/20 transition">이체 실행</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        )}
      </div>
    </>
  );
}

// ── 고정비 배치 상세 모달 (read-only) ──
function BatchDetailModal({ batchId, onClose }: { batchId: string; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["batch-with-items", batchId],
    queryFn: () => getBatchWithItems(batchId),
    enabled: !!batchId,
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const batch: any = data?.batch;
  const items: any[] = data?.items || [];

  const statusLabel: Record<string, { label: string; color: string }> = {
    draft: { label: '초안', color: 'bg-gray-500/10 text-gray-400' },
    pending_approval: { label: '승인대기', color: 'bg-yellow-500/10 text-yellow-400' },
    approved: { label: '승인완료', color: 'bg-blue-500/10 text-blue-400' },
    executing: { label: '실행중', color: 'bg-orange-500/10 text-orange-400' },
    completed: { label: '완료', color: 'bg-green-500/10 text-green-400' },
    failed: { label: '실패', color: 'bg-red-500/10 text-red-400' },
  };
  const sl = batch ? (statusLabel[batch.status] || statusLabel.draft) : null;

  const categoryLabels: Record<string, string> = {
    rent: '임대료', insurance: '보험', loan: '대출상환', subscription: '구독', salary: '급여', utility: '공과금', other: '기타',
  };

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm flex items-start sm:items-center justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="glass-card w-full max-w-2xl my-8 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
          <div>
            <h3 className="text-base font-bold">{batch?.name || '배치 상세'}</h3>
            <p className="text-[11px] text-[var(--text-dim)] mt-0.5">조회 전용 — 수정하려면 반복결제 설정 탭에서 항목을 변경 후 배치 다시 생성</p>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--text)] p-1"
            aria-label="닫기"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {isLoading ? (
          <div className="p-12 text-center text-sm text-[var(--text-muted)]">불러오는 중...</div>
        ) : !batch ? (
          <div className="p-12 text-center text-sm text-[var(--text-muted)]">배치 정보를 불러올 수 없습니다.</div>
        ) : (
          <div className="p-6 space-y-5">
            {/* Batch summary */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <ReadOnlyField label="총액" value={`₩${Number(batch.total_amount || 0).toLocaleString()}`} />
              <ReadOnlyField label="건수" value={`${batch.item_count || items.length}건`} />
              <div>
                <div className="text-[10px] font-semibold text-[var(--text-dim)] uppercase mb-1">상태</div>
                {sl && (
                  <span className={`inline-block px-2.5 py-1 rounded-lg text-xs font-medium ${sl.color}`}>{sl.label}</span>
                )}
              </div>
              <ReadOnlyField label="배치 종류" value={batch.batch_type === 'fixed_cost' ? '고정비' : (batch.batch_type === 'payroll' ? '급여' : batch.batch_type)} />
              <ReadOnlyField label="생성일" value={batch.created_at ? new Date(batch.created_at).toLocaleString('ko-KR') : '—'} />
              <ReadOnlyField label="승인자" value={batch.users?.name || '—'} />
            </div>

            {/* Items list */}
            <div>
              <div className="text-[10px] font-semibold text-[var(--text-dim)] uppercase mb-2">포함된 항목 ({items.length}건)</div>
              {items.length === 0 ? (
                <div className="p-6 text-center text-xs text-[var(--text-muted)] bg-[var(--bg-surface)] rounded-xl">포함된 항목이 없습니다.</div>
              ) : (
                <div className="border border-[var(--border)] rounded-xl divide-y divide-[var(--border)] max-h-[400px] overflow-y-auto">
                  {items.map((it) => (
                    <div key={it.id} className="px-4 py-3 grid grid-cols-12 gap-2 items-center text-xs">
                      <div className="col-span-5">
                        <div className="font-medium text-sm">{it.description || '(설명 없음)'}</div>
                        {it.recipient_name && (
                          <div className="text-[10px] text-[var(--text-dim)] mt-0.5">
                            {it.recipient_name}
                            {it.recipient_account && ` · ${it.recipient_bank || ''} ${it.recipient_account}`}
                          </div>
                        )}
                      </div>
                      <div className="col-span-3 text-[var(--text-muted)]">
                        {it.category && <span className="px-2 py-0.5 rounded-full bg-[var(--bg-surface)]">{categoryLabels[it.category] || it.category}</span>}
                      </div>
                      <div className="col-span-3 text-right font-bold text-sm">₩{Number(it.amount || 0).toLocaleString()}</div>
                      <div className="col-span-1 text-right text-[10px] text-[var(--text-dim)]">{it.status || ''}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={onClose}
                className="px-4 py-2 bg-[var(--bg-surface)] hover:bg-[var(--bg)] text-[var(--text)] rounded-lg text-sm font-semibold border border-[var(--border)] transition"
              >닫기</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-semibold text-[var(--text-dim)] uppercase mb-1">{label}</div>
      <div className="text-sm font-medium px-3 py-2 bg-[var(--bg-surface)] rounded-lg border border-[var(--border)] truncate">{value}</div>
    </div>
  );
}

// ── 반복결제 상세 모달 (read-only — 수정 form 과 같은 레이아웃, "수정" 버튼으로 편집 모드 전환) ──
function RecurringDetailModal({
  item,
  categories,
  bankAccounts,
  onClose,
  onEdit,
}: {
  item: any;
  categories: Record<string, string>;
  bankAccounts: any[];
  onClose: () => void;
  onEdit: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const transferAccount = bankAccounts.find((a: any) => a.id === item.auto_transfer_account_id);
  const transferAccountLabel = transferAccount
    ? `${transferAccount.bank_name} ${transferAccount.alias || transferAccount.account_number}`
    : '미지정';

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm flex items-start sm:items-center justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="glass-card w-full my-8 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
          <div>
            <h3 className="text-base font-bold">{item.name}</h3>
            <p className="text-[11px] text-[var(--text-dim)] mt-0.5">조회 전용 — 수정하려면 하단의 "수정" 버튼을 누르세요.</p>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--text)] p-1"
            aria-label="닫기"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <ReadOnlyField label="명칭" value={item.name || '—'} />
            <ReadOnlyField label="금액" value={`₩${Number(item.amount || 0).toLocaleString()}`} />
            <ReadOnlyField label="카테고리" value={categories[item.category] || item.category || '—'} />
            <ReadOnlyField label="수취인명" value={item.recipient_name || '—'} />
            <ReadOnlyField label="계좌번호" value={item.recipient_account || '—'} />
            <ReadOnlyField label="이체일 (매월)" value={item.day_of_month ? `${item.day_of_month}일` : '25일'} />
          </div>

          <div className="bg-[var(--bg-surface)] rounded-xl p-4">
            <div className="text-xs font-bold text-[var(--text-muted)] mb-3">자동이체 설정</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <ReadOnlyField label="자동이체 예약일" value={item.auto_transfer_date ? `매월 ${item.auto_transfer_date}일` : '미설정'} />
              <ReadOnlyField label="출금 계좌" value={transferAccountLabel} />
              <ReadOnlyField label="적요 (메모)" value={item.auto_transfer_memo || '—'} />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <ReadOnlyField label="상태" value={item.is_active ? '활성' : '비활성'} />
            <ReadOnlyField label="등록일" value={item.created_at ? new Date(item.created_at).toLocaleDateString('ko-KR') : '—'} />
            <ReadOnlyField label="마지막 배치 생성" value={item.last_generated_at ? new Date(item.last_generated_at).toLocaleString('ko-KR') : '—'} />
          </div>

          <div className="pt-2 flex justify-end gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-[var(--bg-surface)] hover:bg-[var(--bg)] text-[var(--text)] rounded-lg text-sm font-semibold border border-[var(--border)] transition"
            >닫기</button>
            <button
              onClick={onEdit}
              className="px-4 py-2 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-lg text-sm font-semibold transition"
            >수정</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Tab 4: Recurring Payments ──

function RecurringPaymentsTab({ companyId, invalidate }: { companyId: string; invalidate: () => void }) {
  const { toast: recurToast } = useToast();
  const { data: bankAccounts = [] } = useQuery({
    queryKey: ["bank-accounts", companyId],
    queryFn: () => getBankAccounts(companyId),
    enabled: !!companyId,
  });
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewingItem, setViewingItem] = useState<any | null>(null);
  const [form, setForm] = useState({ name: '', amount: '', category: 'rent', recipientName: '', recipientAccount: '', recipientBank: '', dayOfMonth: '25', autoTransferDate: '', autoTransferAccountId: '', autoTransferMemo: '' });
  const [refreshing, setRefreshing] = useState(false);
  const [refreshResults, setRefreshResults] = useState<RefreshResult[] | null>(null);
  const queryClient = useQueryClient();

  const startEdit = (r: any) => {
    setEditingId(r.id);
    setForm({
      name: r.name || '',
      amount: String(r.amount || ''),
      category: r.category || 'rent',
      recipientName: r.recipient_name || '',
      recipientAccount: r.recipient_account || '',
      recipientBank: r.recipient_bank || '',
      dayOfMonth: String(r.day_of_month || 25),
      autoTransferDate: r.auto_transfer_date ? String(r.auto_transfer_date) : '',
      autoTransferAccountId: r.auto_transfer_account_id || '',
      autoTransferMemo: r.auto_transfer_memo || '',
    });
    setShowForm(true);
  };
  const resetForm = () => {
    setEditingId(null);
    setShowForm(false);
    setForm({ name: '', amount: '', category: 'rent', recipientName: '', recipientAccount: '', recipientBank: '', dayOfMonth: '25', autoTransferDate: '', autoTransferAccountId: '', autoTransferMemo: '' });
  };

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteRecurringPayment(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recurring-payments"] });
      invalidate();
      recurToast("반복결제가 삭제되었습니다", "success");
    },
    onError: (err: Error) => recurToast("삭제 실패: " + (err?.message || ""), "error"),
  });

  const { data: recurring = [] } = useQuery({
    queryKey: ["recurring-payments", companyId],
    queryFn: () => getRecurringPayments(companyId),
    enabled: !!companyId,
  });

  const saveMut = useMutation({
    mutationFn: () => upsertRecurringPayment({
      id: editingId || undefined,
      companyId,
      name: form.name,
      amount: Number(form.amount),
      category: form.category,
      recipientName: form.recipientName || undefined,
      recipientAccount: form.recipientAccount || undefined,
      recipientBank: form.recipientBank || undefined,
      dayOfMonth: Number(form.dayOfMonth) || 25,
      isActive: true,
      autoTransferDate: form.autoTransferDate ? Number(form.autoTransferDate) : undefined,
      autoTransferAccountId: form.autoTransferAccountId || undefined,
      autoTransferMemo: form.autoTransferMemo || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recurring-payments"] });
      invalidate();
      const isEdit = !!editingId;
      resetForm();
      recurToast(isEdit ? "반복결제가 수정되었습니다" : "반복결제가 등록되었습니다", "success");
    },
    onError: (err: Error) => { recurToast("저장 실패: " + (err?.message || ""), "error"); },
  });

  const toggleMut = useMutation({
    mutationFn: (item: any) => upsertRecurringPayment({
      id: item.id,
      companyId,
      name: item.name,
      amount: Number(item.amount),
      category: item.category,
      isActive: !item.is_active,
    }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["recurring-payments"] }); recurToast("상태가 변경되었습니다", "success"); },
    onError: (err: Error) => { recurToast("상태 변경 실패: " + (err?.message || ""), "error"); },
  });

  const categories: Record<string, string> = {
    rent: '임대료', insurance: '보험', loan: '대출상환', subscription: '구독', salary: '급여', utility: '공과금', other: '기타',
  };

  const totalActive = recurring.filter((r: any) => r.is_active).reduce((s: number, r: any) => s + Number(r.amount || 0), 0);

  // Get detected recurring for badge
  const { data: detected = [] } = useQuery({
    queryKey: ["detected-recurring", companyId],
    queryFn: () => detectRecurringFromBankTx(companyId),
    enabled: !!companyId,
  });
  const newDetected = detected.filter((d: DetectedRecurring) => !d.alreadyRegistered);

  return (
    <>
      {/* Detected recurring from bank tx */}
      {newDetected.length > 0 && (
        <div className="bg-blue-500/5 border border-blue-500/20 rounded-2xl p-4 mb-6">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-bold text-blue-500">
              이체내역에서 고정비 {newDetected.length}건 감지됨
            </div>
            <button
              onClick={async () => {
                await registerDetectedRecurring(companyId, newDetected);
                queryClient.invalidateQueries({ queryKey: ["recurring-payments"] });
                queryClient.invalidateQueries({ queryKey: ["detected-recurring"] });
              }}
              className="px-3 py-1.5 bg-blue-500 text-white rounded-lg text-xs font-semibold hover:bg-blue-600 transition"
            >
              전체 자동등록
            </button>
          </div>
          <div className="space-y-1.5">
            {newDetected.slice(0, 5).map((d: DetectedRecurring, i: number) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                    d.confidence === 'high' ? 'bg-green-500/10 text-green-500' :
                    d.confidence === 'medium' ? 'bg-yellow-500/10 text-yellow-500' :
                    'bg-gray-500/10 text-gray-400'
                  }`}>
                    {d.confidence === 'high' ? '확실' : d.confidence === 'medium' ? '가능성' : '낮음'}
                  </span>
                  <span>{d.counterparty}</span>
                </div>
                <span className="font-bold">₩{d.amount.toLocaleString()}/월</span>
              </div>
            ))}
            {newDetected.length > 5 && (
              <div className="text-xs text-blue-400">... 외 {newDetected.length - 5}건</div>
            )}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-bold">반복 결제 설정</h2>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            월 고정비 합계: <span className="font-bold text-[var(--text)]">₩{totalActive.toLocaleString()}</span>
            ({recurring.filter((r: any) => r.is_active).length}건 활성)
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={async () => {
              setRefreshing(true);
              setRefreshResults(null);
              try {
                const results = await refreshRecurringAmounts(companyId);
                setRefreshResults(results);
                if (results.length > 0) {
                  queryClient.invalidateQueries({ queryKey: ["recurring-payments"] });
                  invalidate();
                }
              } finally {
                setRefreshing(false);
              }
            }}
            disabled={refreshing}
            className="px-4 py-2.5 bg-blue-500/10 hover:bg-blue-500/20 text-blue-500 rounded-xl text-xs font-semibold transition disabled:opacity-50"
          >
            {refreshing ? '최신화 중...' : '금액 최신화'}
          </button>
          <button onClick={() => setShowForm(!showForm)}
            className="px-4 py-2.5 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl text-xs font-semibold transition">
            + 반복결제 추가
          </button>
        </div>
      </div>

      {/* Refresh Results */}
      {refreshResults !== null && (
        <div className={`rounded-2xl border p-4 mb-6 ${
          refreshResults.length > 0
            ? 'bg-green-500/5 border-green-500/20'
            : 'bg-[var(--bg-surface)] border-[var(--border)]'
        }`}>
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-bold">
              {refreshResults.length > 0
                ? `${refreshResults.length}건 금액 업데이트됨`
                : '모든 항목이 최신 상태입니다'
              }
            </div>
            <button onClick={() => setRefreshResults(null)} className="text-xs text-[var(--text-dim)] hover:text-[var(--text)]">닫기</button>
          </div>
          {refreshResults.length > 0 && (
            <div className="space-y-1.5">
              {refreshResults.map((r) => (
                <div key={r.id} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                      r.source === 'card' ? 'bg-orange-500/10 text-orange-500' : 'bg-blue-500/10 text-blue-500'
                    }`}>
                      {r.source === 'card' ? '카드' : '이체'}
                    </span>
                    <span>{r.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[var(--text-dim)] line-through">₩{r.oldAmount.toLocaleString()}</span>
                    <span className="text-[var(--text-dim)]">&rarr;</span>
                    <span className="font-bold text-green-500">₩{r.newAmount.toLocaleString()}</span>
                    <span className="text-[10px] text-[var(--text-dim)]">({r.lastTxDate})</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showForm && (
        <div className="glass-card p-6 mb-6">
          <h3 className="text-sm font-bold mb-4">{editingId ? '반복결제 수정' : '반복결제 등록'}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 mb-4">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">명칭 *</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="예: 스파크플러스 임대료"
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">금액 (원) *</label>
              <CurrencyInput value={form.amount} onValueChange={(raw) => setForm({ ...form, amount: raw })}
                placeholder="500000"
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">카테고리</label>
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]">
                {Object.entries(categories).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">수취인명</label>
              <input value={form.recipientName} onChange={(e) => setForm({ ...form, recipientName: e.target.value })}
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">계좌번호</label>
              <input value={form.recipientAccount} onChange={(e) => setForm({ ...form, recipientAccount: e.target.value })}
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">이체일 (매월)</label>
              <input type="number" min="1" max="31" value={form.dayOfMonth} onChange={(e) => setForm({ ...form, dayOfMonth: e.target.value })}
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
            </div>
          </div>
          <div className="bg-[var(--bg-surface)] rounded-xl p-4 mb-4">
            <div className="text-xs font-bold text-[var(--text-muted)] mb-3">자동이체 설정 (선택)</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">자동이체 예약일 (매월)</label>
                <input type="number" min="1" max="31" value={form.autoTransferDate} onChange={(e) => setForm({ ...form, autoTransferDate: e.target.value })}
                  placeholder="미설정"
                  className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">출금 계좌</label>
                <select value={form.autoTransferAccountId} onChange={(e) => setForm({ ...form, autoTransferAccountId: e.target.value })}
                  className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]">
                  <option value="">미지정</option>
                  {bankAccounts.map((a: any) => (
                    <option key={a.id} value={a.id}>{a.bank_name} {a.alias || a.account_number}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">적요 (메모)</label>
                <input value={form.autoTransferMemo} onChange={(e) => setForm({ ...form, autoTransferMemo: e.target.value })}
                  placeholder="자동이체 적요"
                  className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => form.name && form.amount && saveMut.mutate()}
              disabled={!form.name || !form.amount || saveMut.isPending}
              className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-sm font-semibold disabled:opacity-50">{editingId ? '수정 저장' : '등록'}</button>
            <button onClick={resetForm} className="px-4 py-2 text-[var(--text-muted)] text-sm">취소</button>
          </div>
        </div>
      )}

      {viewingItem && (
        <RecurringDetailModal
          item={viewingItem}
          categories={categories}
          bankAccounts={bankAccounts}
          onClose={() => setViewingItem(null)}
          onEdit={() => { startEdit(viewingItem); setViewingItem(null); }}
        />
      )}

      {/* List */}
      <div className="glass-card overflow-hidden">
        {recurring.length === 0 ? (
          <div className="p-12 text-center">
            <div className="text-3xl mb-3">🔄</div>
            <div className="text-sm font-bold mb-1">반복결제가 없습니다</div>
            <div className="text-xs text-[var(--text-muted)]">임대료, 보험, 구독 등 매월 고정 지출을 등록하세요</div>
          </div>
        ) : (
          <div className="overflow-auto max-h-[560px] relative"><table className="w-full min-w-[600px]">
            <thead>
              <tr className="text-xs text-[var(--text-dim)] border-b border-[var(--border)]">
                <th className="text-left px-5 py-3 font-medium">명칭</th>
                <th className="text-left px-5 py-3 font-medium">카테고리</th>
                <th className="text-right px-5 py-3 font-medium">금액</th>
                <th className="text-left px-5 py-3 font-medium">수취인</th>
                <th className="text-center px-5 py-3 font-medium">이체일</th>
                <th className="text-left px-5 py-3 font-medium">자동이체</th>
                <th className="text-center px-5 py-3 font-medium">상태</th>
                <th className="text-center px-5 py-3 font-medium">관리</th>
              </tr>
            </thead>
            <tbody>
              {recurring.map((r: any) => (
                <tr
                  key={r.id}
                  onClick={() => setViewingItem(r)}
                  className={`border-b border-[var(--border)]/50 hover:bg-[var(--bg-surface)] transition cursor-pointer ${!r.is_active ? 'opacity-50' : ''}`}
                >
                  <td className="px-5 py-3 text-sm font-medium">{r.name}</td>
                  <td className="px-5 py-3 text-xs">
                    <span className="px-2 py-0.5 rounded-full bg-[var(--bg-surface)] text-[var(--text-muted)]">
                      {categories[r.category] || r.category}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-sm text-right font-bold">₩{Number(r.amount || 0).toLocaleString()}</td>
                  <td className="px-5 py-3 text-xs text-[var(--text-muted)]">{r.recipient_name || '—'}</td>
                  <td className="px-5 py-3 text-xs text-center">매월 {r.day_of_month || 25}일</td>
                  <td className="px-5 py-3 text-xs text-[var(--text-muted)]">
                    {r.auto_transfer_date ? (
                      <div>
                        <div>매월 {r.auto_transfer_date}일</div>
                        {r.auto_transfer_memo && <div className="text-[10px] text-[var(--text-dim)]">{r.auto_transfer_memo}</div>}
                      </div>
                    ) : <span className="text-[var(--text-dim)]">미설정</span>}
                  </td>
                  <td className="px-5 py-3 text-center">
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleMut.mutate(r); }}
                      disabled={toggleMut.isPending}
                      className={`text-xs px-2.5 py-1 rounded-lg font-medium transition ${
                        r.is_active
                          ? 'bg-green-500/10 text-green-400 hover:bg-green-500/20'
                          : 'bg-gray-500/10 text-gray-400 hover:bg-gray-500/20'
                      }`}>
                      {r.is_active ? '활성' : '비활성'}
                    </button>
                  </td>
                  <td className="px-5 py-3 text-center">
                    <div className="flex gap-1.5 justify-center">
                      <button
                        onClick={(e) => { e.stopPropagation(); startEdit(r); }}
                        className="text-xs px-2.5 py-1 rounded-lg font-medium bg-[var(--bg-surface)] text-[var(--text-muted)] hover:bg-[var(--bg)] hover:text-[var(--text)] transition"
                        title="수정"
                      >수정</button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`"${r.name}" 반복결제를 삭제하시겠습니까? 등록된 자동이체와 연결도 함께 끊깁니다.`)) {
                            deleteMut.mutate(r.id);
                          }
                        }}
                        disabled={deleteMut.isPending}
                        className="text-xs px-2.5 py-1 rounded-lg font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 transition disabled:opacity-50"
                        title="삭제"
                      >삭제</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
    </>
  );
}

// ── Smart Setup Banner (이체내역 분석 + 자동화 실행 + 진행 현황) ──

function SmartSetupBanner({ companyId, invalidate }: { companyId: string; invalidate: () => void }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AutomationResult | null>(null);
  const [includeRisky, setIncludeRisky] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: stats } = useQuery({
    queryKey: ["payment-stats", companyId],
    queryFn: () => getPaymentQueueStats(companyId),
    enabled: !!companyId,
  });

  const { data: recurring = [] } = useQuery({
    queryKey: ["recurring-payments", companyId],
    queryFn: () => getRecurringPayments(companyId),
    enabled: !!companyId,
  });

  // 이체내역 분석: 탭 진입 시 자동 실행(읽기 전용·무비용) → 고정비 후보 패널 자동 노출.
  const { data: detected = [], refetch: refetchDetect, isFetching: detecting } = useQuery<DetectedRecurring[]>({
    queryKey: ["detected-recurring", companyId],
    queryFn: () => detectRecurringFromBankTx(companyId),
    enabled: !!companyId,
    staleTime: 10 * 60 * 1000,
  });

  async function handleRunAutomation() {
    setRunning(true);
    try {
      const res = await runAllAutomation(companyId, { includeRisky });
      setResult(res);
      invalidate();
      const total =
        res.recurringExpense.created + res.approvedQueue.queued + res.contractExpense.created +
        res.taxOnPayment.created + res.expenseApproval.approved + res.bankClassification.matched +
        res.threeWayMatch.autoMatched + res.dormantDeals.detected;
      const failed = res.errors?.length ?? 0;
      if (failed > 0) toast(`자동화 완료 — ${total}건 처리, ${failed}개 단계 실패 (아래 확인)`, "error");
      else toast(total > 0 ? `자동화 실행 완료 — 총 ${total}건 처리` : "자동화 실행 완료 — 처리할 항목이 없습니다", total > 0 ? "success" : "info");
    } catch (e: any) {
      toast("자동화 실행 실패: " + (e?.message || "오류"), "error");
    }
    setRunning(false);
  }

  async function handleDetect() {
    try {
      const { data } = await refetchDetect();
      const res = data || [];
      const fresh = res.filter((d) => !d.alreadyRegistered).length;
      if (res.length === 0) toast("최근 3개월 이체내역에서 반복 결제 패턴을 찾지 못했습니다", "info");
      else toast(`반복 이체 ${res.length}건 감지 (신규 ${fresh}건 · 기등록 ${res.length - fresh}건)`, "success");
    } catch (e: any) {
      toast("이체내역 분석 실패: " + (e?.message || "오류"), "error");
    }
  }

  const activeRecurring = recurring.filter((r: any) => r.is_active).length;
  const pendingCount = stats?.pendingCount ?? 0;
  const approvedCount = stats?.approvedCount ?? 0;
  const executedCount = stats?.executedCount ?? 0;

  return (
    <div className="mb-6 space-y-3">
      {/* Pipeline visualization */}
      <div className="glass-card p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs font-bold text-[var(--text)]">자동화 진행 현황</span>
          <span className="text-[10px] text-[var(--text-dim)]">설정 &rarr; 지출결의 &rarr; 승인 &rarr; 결제 &rarr; 세금계산서</span>
        </div>
        <div className="flex items-center gap-1 overflow-x-auto">
          {[
            { label: '반복설정', count: activeRecurring, color: 'bg-purple-500' },
            { label: '승인대기', count: pendingCount, color: 'bg-yellow-500' },
            { label: '결제대기', count: approvedCount, color: 'bg-blue-500' },
            { label: '완료', count: executedCount, color: 'bg-green-500' },
          ].map((step, i) => (
            <div key={i} className="flex items-center gap-1 flex-1 min-w-[70px]">
              <div className="flex-1 bg-[var(--bg-surface)] rounded-lg p-2 text-center">
                <div className={`text-lg font-bold ${step.color.replace('bg-', 'text-')}`}>{step.count}</div>
                <div className="text-[10px] text-[var(--text-dim)] whitespace-nowrap">{step.label}</div>
              </div>
              {i < 3 && <span className="text-[var(--text-dim)] text-xs flex-shrink-0">&rarr;</span>}
            </div>
          ))}
        </div>
      </div>

      {/* Action buttons */}
      <div className="space-y-2">
        <div className="flex gap-2">
          <button onClick={handleDetect} disabled={detecting}
            className="px-4 py-2 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl text-xs font-semibold hover:border-[var(--primary)] transition disabled:opacity-50">
            {detecting ? '분석 중...' : '이체내역 분석'}
          </button>
          <button onClick={handleRunAutomation} disabled={running}
            className="px-4 py-2 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl text-xs font-semibold transition disabled:opacity-50">
            {running ? '실행 중...' : '자동화 실행'}
          </button>
        </div>
        {/* 무엇을 하는지 투명하게 안내 + 위험 작업 옵트인 */}
        <p className="text-[10px] text-[var(--text-dim)] leading-relaxed">
          기본 실행: 거래 자동분류·매칭, 결제큐 정리, 지출결의 드래프트 생성 (데이터 정리만, 돈/세무 변경 없음).
        </p>
        <label className="flex items-start gap-1.5 text-[10px] text-[var(--text-muted)] cursor-pointer select-none">
          <input type="checkbox" checked={includeRisky} onChange={(e) => setIncludeRisky(e.target.checked)} className="mt-0.5 accent-[var(--danger)]" />
          <span>
            <span className="font-semibold text-[var(--danger)]">위험 작업 포함</span> — 소액 자동승인 · 결제→세금계산서 자동발행 · 환불→세금계산서 취소.
            실제 승인·세무 레코드를 자동 생성합니다. 내용을 이해한 경우에만 체크하세요.
          </span>
        </label>
      </div>

      {/* Automation result */}
      {result && (
        <div className="bg-green-500/5 border border-green-500/20 rounded-xl p-3">
          <div className="text-xs font-bold text-green-500 mb-2">자동화 실행 완료</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
            {result.recurringExpense.created > 0 && (
              <div className="bg-[var(--bg-surface)] rounded-lg p-2 text-center">
                <div className="font-bold">{result.recurringExpense.created}건</div>
                <div className="text-[var(--text-dim)]">반복→지출결의</div>
              </div>
            )}
            {result.approvedQueue.queued > 0 && (
              <div className="bg-[var(--bg-surface)] rounded-lg p-2 text-center">
                <div className="font-bold">{result.approvedQueue.queued}건</div>
                <div className="text-[var(--text-dim)]">승인→결제큐</div>
              </div>
            )}
            {result.contractExpense.created > 0 && (
              <div className="bg-[var(--bg-surface)] rounded-lg p-2 text-center">
                <div className="font-bold">{result.contractExpense.created}건</div>
                <div className="text-[var(--text-dim)]">계약→지출결의</div>
              </div>
            )}
            {result.taxOnPayment.created > 0 && (
              <div className="bg-[var(--bg-surface)] rounded-lg p-2 text-center">
                <div className="font-bold">{result.taxOnPayment.created}건</div>
                <div className="text-[var(--text-dim)]">결제→세금계산서</div>
              </div>
            )}
            {result.expenseApproval.approved > 0 && (
              <div className="bg-[var(--bg-surface)] rounded-lg p-2 text-center">
                <div className="font-bold">{result.expenseApproval.approved}건</div>
                <div className="text-[var(--text-dim)]">소액자동승인</div>
              </div>
            )}
            {result.bankClassification.matched > 0 && (
              <div className="bg-[var(--bg-surface)] rounded-lg p-2 text-center">
                <div className="font-bold">{result.bankClassification.matched}건</div>
                <div className="text-[var(--text-dim)]">거래자동분류</div>
              </div>
            )}
            {result.threeWayMatch.autoMatched > 0 && (
              <div className="bg-[var(--bg-surface)] rounded-lg p-2 text-center">
                <div className="font-bold">{result.threeWayMatch.autoMatched}건</div>
                <div className="text-[var(--text-dim)]">3-Way 매칭</div>
              </div>
            )}
            {result.dormantDeals.detected > 0 && (
              <div className="bg-[var(--bg-surface)] rounded-lg p-2 text-center">
                <div className="font-bold">{result.dormantDeals.detected}건</div>
                <div className="text-[var(--text-dim)]">휴면 프로젝트 감지</div>
              </div>
            )}
          </div>
          {result.errors && result.errors.length > 0 && (
            <div className="mt-2 bg-red-500/5 border border-red-500/20 rounded-lg p-2">
              <div className="text-[11px] font-bold text-red-500 mb-1">실패한 단계 {result.errors.length}개</div>
              <ul className="space-y-0.5">
                {result.errors.map((e, i) => (
                  <li key={i} className="text-[10px] text-[var(--text-dim)] break-all">• {e}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Detected patterns from bank tx */}
      {detected.length > 0 && (
        <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-bold text-blue-500">
              이체내역에서 {detected.filter(d => !d.alreadyRegistered).length}건 신규 감지 / {detected.filter(d => d.alreadyRegistered).length}건 기등록
            </div>
            {detected.filter(d => !d.alreadyRegistered).length > 0 && (
              <button
                onClick={async () => {
                  const newItems = detected.filter(d => !d.alreadyRegistered);
                  await registerDetectedRecurring(companyId, newItems);
                  invalidate();
                  refetchDetect();
                  queryClient.invalidateQueries({ queryKey: ["recurring-payments", companyId] });
                  toast(`${newItems.length}건을 고정비(반복결제)로 등록했습니다`, "success");
                }}
                className="px-3 py-1 bg-blue-500 text-white rounded-lg text-[10px] font-semibold hover:bg-blue-600 transition"
              >
                전체 자동등록
              </button>
            )}
          </div>
          <div className="space-y-1">
            {detected.filter(d => !d.alreadyRegistered).slice(0, 8).map((d, i) => (
              <div key={i} className="flex items-center justify-between text-[11px]">
                <div className="flex items-center gap-2">
                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${
                    d.confidence === 'high' ? 'bg-green-500/10 text-green-500' :
                    d.confidence === 'medium' ? 'bg-yellow-500/10 text-yellow-500' :
                    'bg-gray-500/10 text-gray-400'
                  }`}>
                    {d.occurrences}회
                  </span>
                  <span>{d.counterparty}</span>
                  <span className="text-[var(--text-dim)]">({d.suggestedCategory})</span>
                </div>
                <span className="font-bold">₩{d.amount.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tab: 지출결의서/품의서 ──

function ExpenseTab({ companyId, userId, invalidate }: { companyId: string; userId: string; invalidate: () => void }) {
  const { toast: expToast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [requestType, setRequestType] = useState<'expense' | 'purchase_request'>('expense');
  const [statusFilter, setStatusFilter] = useState('all');
  // U2: 지출결의서 8필드 확장 — 사유/기안일/결제요청일/상세내역/총금액(부가세토글)/결제방법/비고/첨부파일
  const today = new Date().toISOString().split('T')[0];
  const [form, setForm] = useState({
    title: '', description: '', amount: '', category: 'general', dealId: '',
    reason: '', request_date: today, payment_due_date: '',
    has_vat: false, payment_method: 'card' as 'card'|'bank'|'cash'|'other',
    note: '',
    receipt_urls: [] as string[],
    detail_items: [] as { desc: string; qty: number; price: number }[],
  });
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const queryClient = useQueryClient();

  const { data: expenses = [] } = useQuery({
    queryKey: ['expense-requests', companyId, statusFilter],
    queryFn: () => getExpenseRequests(companyId, statusFilter === 'all' ? undefined : statusFilter),
    enabled: !!companyId,
  });

  const { data: deals = [] } = useQuery({
    queryKey: ['deals-for-expense', companyId],
    queryFn: async () => {
      const { data } = await (await import('@/lib/supabase')).supabase
        .from('deals').select('id, name').eq('company_id', companyId).eq('status', 'active');
      return data || [];
    },
    enabled: !!companyId,
  });

  const createMut = useMutation({
    mutationFn: () => createExpenseRequest({
      companyId,
      requesterId: userId,
      dealId: form.dealId || undefined,
      title: form.title,
      description: form.description || undefined,
      amount: Number(form.amount),
      category: form.category,
    }),
    onSuccess: async (data) => {
      // U2: 8 확장필드 + requestType 저장 (createExpenseRequest 시그니처 무수정 — 추가 update 1회)
      if (data?.id) {
        const { supabase } = await import('@/lib/supabase');
        const supplyAmt = Number(form.amount) || 0;
        const vatAmt = form.has_vat ? Math.round(supplyAmt * 0.1) : 0;
        const patch: Record<string, unknown> = {
          reason: form.reason || null,
          request_date: form.request_date || null,
          payment_due_date: form.payment_due_date || null,
          has_vat: form.has_vat,
          vat_amount: vatAmt,
          payment_method: form.payment_method,
          note: form.note || null,
          detail_items: form.detail_items.length > 0 ? form.detail_items : null,
          receipt_urls: form.receipt_urls.length > 0 ? form.receipt_urls : null,
        };
        if (requestType === 'purchase_request') patch.request_type = 'purchase_request';
        await (supabase as any).from('expense_requests').update(patch).eq('id', data.id);
      }
      queryClient.invalidateQueries({ queryKey: ['expense-requests'] });
      invalidate();
      setShowForm(false);
      setForm({
        title: '', description: '', amount: '', category: 'general', dealId: '',
        reason: '', request_date: today, payment_due_date: '',
        has_vat: false, payment_method: 'card', note: '',
        receipt_urls: [], detail_items: [],
      });
      expToast("지출결의가 등록되었습니다", "success");
    },
    onError: (err: Error) => { expToast("등록 실패: " + (err?.message || ""), "error"); },
  });

  const approveMut = useMutation({
    mutationFn: (id: string) => approveExpense({ companyId, expenseId: id, approverId: userId }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['expense-requests'] }); invalidate(); expToast("승인되었습니다", "success"); },
    onError: (err: Error) => { expToast("승인 실패: " + (err?.message || ""), "error"); },
  });

  const rejectMut = useMutation({
    mutationFn: (id: string) => rejectExpense({ companyId, expenseId: id, approverId: userId }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['expense-requests'] }); invalidate(); expToast("반려되었습니다", "success"); },
    onError: (err: Error) => { expToast("반려 실패: " + (err?.message || ""), "error"); },
  });

  const paidMut = useMutation({
    mutationFn: (id: string) => markExpensePaid(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['expense-requests'] }); invalidate(); expToast("지급 처리되었습니다", "success"); },
    onError: (err: Error) => { expToast("지급 처리 실패: " + (err?.message || ""), "error"); },
  });

  const categoryLabels: Record<string, string> = {};
  EXPENSE_CATEGORIES.forEach(c => { categoryLabels[c.value] = c.label; });

  const pendingCount = expenses.filter((e: any) => e.status === 'pending').length;
  const approvedTotal = expenses.filter((e: any) => e.status === 'approved').reduce((s: number, e: any) => s + Number(e.amount || 0), 0);

  return (
    <>
      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="glass-card p-4">
          <div className="text-xs text-[var(--text-dim)]">승인 대기</div>
          <div className="text-lg font-bold text-yellow-400 mt-1">{pendingCount}건</div>
        </div>
        <div className="glass-card p-4">
          <div className="text-xs text-[var(--text-dim)]">승인 완료 (미지급)</div>
          <div className="text-lg font-bold text-blue-400 mt-1">₩{approvedTotal.toLocaleString()}</div>
        </div>
        <div className="glass-card p-4">
          <div className="text-xs text-[var(--text-dim)]">이번달 지출</div>
          <div className="text-lg font-bold text-green-400 mt-1">
            ₩{expenses.filter((e: any) => e.status === 'paid' && e.created_at?.startsWith(new Date().toISOString().slice(0, 7)))
              .reduce((s: number, e: any) => s + Number(e.amount || 0), 0).toLocaleString()}
          </div>
        </div>
        <div className="glass-card p-4">
          <div className="text-xs text-[var(--text-dim)]">전체</div>
          <div className="text-lg font-bold mt-1">{expenses.length}건</div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-2">
          {['all', 'pending', 'approved', 'paid', 'rejected'].map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                statusFilter === s ? 'bg-[var(--primary)]/10 text-[var(--primary)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'
              }`}>
              {s === 'all' ? '전체' : (EXPENSE_STATUS as any)[s]?.label || s}
            </button>
          ))}
        </div>
        <button onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl text-xs font-semibold transition">
          + 지출결의/품의 작성
        </button>
      </div>

      {/* Create Form */}
      {showForm && (
        <div className="glass-card p-6 mb-6">
          <div className="flex gap-2 mb-4">
            <button onClick={() => setRequestType('expense')}
              className={`px-4 py-2 rounded-lg text-xs font-semibold transition ${requestType === 'expense' ? 'bg-blue-500 text-white' : 'bg-[var(--bg-surface)] text-[var(--text-muted)]'}`}>
              지출결의서
            </button>
            <button onClick={() => setRequestType('purchase_request')}
              className={`px-4 py-2 rounded-lg text-xs font-semibold transition ${requestType === 'purchase_request' ? 'bg-purple-500 text-white' : 'bg-[var(--bg-surface)] text-[var(--text-muted)]'}`}>
              품의서
            </button>
          </div>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">{requestType === 'expense' ? '지출 제목' : '품의 제목'} *</label>
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder={requestType === 'expense' ? '거래처 접대비' : 'Adobe 연간 구독 구매'}
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">금액 (원) *</label>
              <CurrencyInput value={form.amount} onValueChange={(raw) => setForm({ ...form, amount: raw })}
                placeholder="100000"
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">카테고리</label>
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]">
                {EXPENSE_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">연결 프로젝트</label>
              <select value={form.dealId} onChange={(e) => setForm({ ...form, dealId: e.target.value })}
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]">
                <option value="">없음 (독립 지출)</option>
                {deals.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
          </div>
          <div className="mb-4">
            <label className="block text-xs text-[var(--text-muted)] mb-1">상세 설명</label>
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={3} placeholder={requestType === 'expense' ? '지출 사유 및 상세 내역' : '구매 사유, 필요성, 비교 견적 등'}
              className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)] resize-none" />
          </div>

          {/* U2: 8필드 확장 — 사유/기안일/결제요청일/상세내역/부가세토글/결제방법/비고/첨부파일 */}
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">사유</label>
              <input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}
                placeholder="예: 거래처 회의비 / 정기 SaaS 갱신"
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">결제방법</label>
              <select value={form.payment_method} onChange={(e) => setForm({ ...form, payment_method: e.target.value as any })}
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]">
                <option value="card">법인카드</option>
                <option value="bank">통장 이체</option>
                <option value="cash">현금</option>
                <option value="other">기타</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">기안일</label>
              <input type="date" value={form.request_date} onChange={(e) => setForm({ ...form, request_date: e.target.value })}
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">결제요청일</label>
              <input type="date" value={form.payment_due_date} onChange={(e) => setForm({ ...form, payment_due_date: e.target.value })}
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
            </div>
          </div>

          {/* 부가세 토글 + 총금액 표시 */}
          <div className="mb-4 p-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] flex items-center justify-between flex-wrap gap-2">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={form.has_vat} onChange={(e) => setForm({ ...form, has_vat: e.target.checked })}
                className="accent-[var(--primary)]" />
              <span>부가세 10% 포함</span>
            </label>
            {form.amount && (
              <div className="text-xs text-[var(--text-muted)] space-x-3">
                <span>공급가액: ₩{Number(form.amount).toLocaleString()}</span>
                {form.has_vat && <span>VAT: ₩{Math.round(Number(form.amount) * 0.1).toLocaleString()}</span>}
                <span className="font-semibold text-[var(--text)]">
                  총 ₩{(Number(form.amount) + (form.has_vat ? Math.round(Number(form.amount) * 0.1) : 0)).toLocaleString()}
                </span>
              </div>
            )}
          </div>

          {/* 상세내역 (line items) */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-[var(--text-muted)]">상세내역 (선택)</label>
              <button type="button" onClick={() => setForm({ ...form, detail_items: [...form.detail_items, { desc: '', qty: 1, price: 0 }] })}
                className="text-xs text-[var(--primary)] hover:underline">+ 행 추가</button>
            </div>
            {form.detail_items.length > 0 && (
              <div className="space-y-1.5">
                {form.detail_items.map((it, idx) => (
                  <div key={idx} className="flex gap-2 items-center">
                    <input value={it.desc} onChange={(e) => {
                      const next = [...form.detail_items]; next[idx] = { ...it, desc: e.target.value }; setForm({ ...form, detail_items: next });
                    }} placeholder="내역" className="flex-1 px-2 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded text-xs focus:outline-none focus:border-[var(--primary)]" />
                    <input type="number" min="1" value={it.qty} onChange={(e) => {
                      const next = [...form.detail_items]; next[idx] = { ...it, qty: Number(e.target.value) || 1 }; setForm({ ...form, detail_items: next });
                    }} className="w-16 px-2 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded text-xs focus:outline-none focus:border-[var(--primary)]" />
                    <input type="number" value={it.price} onChange={(e) => {
                      const next = [...form.detail_items]; next[idx] = { ...it, price: Number(e.target.value) || 0 }; setForm({ ...form, detail_items: next });
                    }} placeholder="단가" className="w-28 px-2 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded text-xs focus:outline-none focus:border-[var(--primary)]" />
                    <button type="button" onClick={() => setForm({ ...form, detail_items: form.detail_items.filter((_, i) => i !== idx) })}
                      className="text-red-400/70 hover:text-red-400 text-xs">✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 비고 */}
          <div className="mb-4">
            <label className="block text-xs text-[var(--text-muted)] mb-1">비고</label>
            <textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })}
              rows={2} placeholder="추가 참고사항 (선택)"
              className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)] resize-none" />
          </div>

          {/* 첨부파일 — receipt_urls 배열 (커밋 4346f0a 패턴: company-assets 회사격리) */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-[var(--text-muted)]">첨부파일 (영수증·견적서 등)</label>
              <input type="file" multiple accept="image/*,application/pdf"
                disabled={uploadingReceipt}
                onChange={async (e) => {
                  const files = Array.from(e.target.files || []);
                  if (files.length === 0) return;
                  setUploadingReceipt(true);
                  try {
                    const { supabase } = await import('@/lib/supabase');
                    const newUrls: string[] = [];
                    for (const file of files) {
                      const path = `${companyId}/expense-receipts/${Date.now()}-${file.name}`;
                      const { error: upErr } = await (supabase as any).storage.from('company-assets').upload(path, file, { cacheControl: '3600', upsert: false });
                      if (upErr) throw upErr;
                      const { data: pub } = (supabase as any).storage.from('company-assets').getPublicUrl(path);
                      newUrls.push(pub.publicUrl);
                    }
                    setForm({ ...form, receipt_urls: [...form.receipt_urls, ...newUrls] });
                  } catch (err: any) {
                    expToast(`첨부 실패: ${err?.message || '오류'}`, 'error');
                  }
                  setUploadingReceipt(false);
                  e.target.value = '';
                }}
                className="text-xs text-[var(--text-muted)]" />
            </div>
            {uploadingReceipt && <div className="text-[10px] text-[var(--text-dim)]">업로드 중...</div>}
            {form.receipt_urls.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-1">
                {form.receipt_urls.map((url, idx) => (
                  <div key={idx} className="flex items-center gap-1 px-2 py-1 rounded-md bg-[var(--bg-surface)] text-[10px]">
                    <a href={url} target="_blank" rel="noopener noreferrer" className="text-[var(--primary)] hover:underline">파일 {idx + 1}</a>
                    <button type="button" onClick={() => setForm({ ...form, receipt_urls: form.receipt_urls.filter((_, i) => i !== idx) })}
                      className="text-red-400/70 hover:text-red-400">✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <button onClick={() => form.title && form.amount && createMut.mutate()}
              disabled={!form.title || !form.amount || createMut.isPending}
              className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-sm font-semibold disabled:opacity-50">
              {requestType === 'expense' ? '지출결의서 제출' : '품의서 제출'}
            </button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 text-[var(--text-muted)] text-sm">취소</button>
          </div>
        </div>
      )}

      {/* List */}
      <div className="glass-card overflow-hidden">
        {expenses.length === 0 ? (
          <div className="p-16 text-center">
            <div className="text-4xl mb-4">📄</div>
            <div className="text-lg font-bold mb-2">지출결의서/품의서가 없습니다</div>
            <div className="text-sm text-[var(--text-muted)]">프로젝트 외 지출이나 구매가 필요할 때 작성하세요</div>
          </div>
        ) : (
          <div className="overflow-auto max-h-[560px] relative"><table className="w-full min-w-[700px]">
            <thead>
              <tr className="text-xs text-[var(--text-dim)] border-b border-[var(--border)]">
                <th className="text-left px-5 py-3 font-medium">유형</th>
                <th className="text-left px-5 py-3 font-medium">제목</th>
                <th className="text-left px-5 py-3 font-medium">카테고리</th>
                <th className="text-right px-5 py-3 font-medium">금액</th>
                <th className="text-left px-5 py-3 font-medium">요청자</th>
                <th className="text-left px-5 py-3 font-medium">프로젝트</th>
                <th className="text-center px-5 py-3 font-medium">상태</th>
                <th className="text-center px-5 py-3 font-medium">액션</th>
              </tr>
            </thead>
            <tbody>
              {expenses.map((e: any) => {
                const sc = (EXPENSE_STATUS as any)[e.status] || EXPENSE_STATUS.pending;
                const isExpense = e.request_type !== 'purchase_request';
                return (
                  <tr key={e.id} className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-surface)]">
                    <td className="px-5 py-3">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${isExpense ? 'bg-blue-500/10 text-blue-400' : 'bg-purple-500/10 text-purple-400'}`}>
                        {isExpense ? '지출결의' : '품의'}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-sm font-medium">{e.title}</td>
                    <td className="px-5 py-3 text-xs">
                      <span className="px-2 py-0.5 rounded-full bg-[var(--bg-surface)] text-[var(--text-muted)]">
                        {categoryLabels[e.category] || e.category}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-sm text-right font-bold">₩{Number(e.amount).toLocaleString()}</td>
                    <td className="px-5 py-3 text-xs text-[var(--text-muted)]">{e.users?.name || '—'}</td>
                    <td className="px-5 py-3 text-xs text-[var(--text-muted)]">{e.deals?.name || '—'}</td>
                    <td className="px-5 py-3 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${sc.bg} ${sc.text}`}>{sc.label}</span>
                    </td>
                    <td className="px-5 py-3 text-center">
                      <div className="flex gap-1 justify-center">
                        {e.status === 'pending' && (
                          <>
                            <button onClick={() => approveMut.mutate(e.id)} disabled={approveMut.isPending}
                              className="px-2 py-1 bg-green-500/10 text-green-400 rounded-lg text-[10px] font-medium hover:bg-green-500/20">승인</button>
                            <button onClick={() => rejectMut.mutate(e.id)} disabled={rejectMut.isPending}
                              className="px-2 py-1 bg-red-500/10 text-red-400 rounded-lg text-[10px] font-medium hover:bg-red-500/20">반려</button>
                          </>
                        )}
                        {e.status === 'approved' && (
                          <button onClick={() => paidMut.mutate(e.id)} disabled={paidMut.isPending}
                            className="px-2 py-1 bg-blue-500/10 text-blue-400 rounded-lg text-[10px] font-medium hover:bg-blue-500/20">지급완료</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        )}
      </div>
    </>
  );
}
