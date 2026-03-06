"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getCurrentUser, getPaymentQueue, getBankAccounts } from "@/lib/queries";
import { approvePayment, rejectPayment, executePayment, createQueueEntry, getPaymentQueueStats } from "@/lib/payment-queue";
import { getRecurringPayments, upsertRecurringPayment, getPaymentBatches } from "@/lib/approval-center";
import { createPayrollBatch, createFixedCostBatch, approveBatch, triggerBatchExecution, type BatchSummary, type PayrollItem } from "@/lib/payment-batch";
import { runAllAutomation, type AutomationResult } from "@/lib/automation";
import { detectRecurringFromBankTx, registerDetectedRecurring, type DetectedRecurring } from "@/lib/smart-setup";

type Tab = 'queue' | 'payroll' | 'fixed' | 'recurring';

export default function PaymentsPage() {
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('queue');
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
    });
  }, []);

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
    { key: 'payroll', label: '급여 일괄' },
    { key: 'fixed', label: '고정비 일괄' },
    { key: 'recurring', label: '반복 결제 설정' },
  ];

  return (
    <div className="max-w-[1100px]">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold">결제 관리</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">결제 큐 + 급여/고정비 배치 + 반복결제</p>
        </div>
      </div>

      {/* Smart Setup Banner + Pipeline + Automation */}
      {companyId && (
        <SmartSetupBanner companyId={companyId} invalidate={invalidate} />
      )}

      {/* Tab navigation */}
      <div className="flex gap-1 mb-6 bg-[var(--bg-surface)] rounded-xl p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 px-4 py-2.5 rounded-lg text-xs font-semibold transition ${
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

  const approveMut = useMutation({ mutationFn: (id: string) => approvePayment(id, userId), onSuccess: invalidate });
  const rejectMut = useMutation({ mutationFn: (id: string) => rejectPayment(id, userId), onSuccess: invalidate });
  const executeMut = useMutation({ mutationFn: (id: string) => executePayment(id), onSuccess: invalidate });
  const createMut = useMutation({
    mutationFn: () => createQueueEntry({ companyId, amount: Number(form.amount), description: form.description }),
    onSuccess: () => { invalidate(); setShowForm(false); setForm({ amount: "", description: "" }); },
  });

  const filtered = filter === "all" ? queue : queue.filter((q: any) => q.status === filter);
  const statusConfig: Record<string, { label: string; bg: string; text: string }> = {
    pending: { label: "승인대기", bg: "bg-yellow-500/10", text: "text-yellow-400" },
    approved: { label: "승인완료", bg: "bg-blue-500/10", text: "text-blue-400" },
    executed: { label: "실행완료", bg: "bg-green-500/10", text: "text-green-400" },
    rejected: { label: "거부", bg: "bg-red-500/10", text: "text-red-400" },
  };

  return (
    <>
      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
          <div className="text-xs text-[var(--text-dim)]">승인 대기</div>
          <div className="text-lg font-bold text-yellow-400 mt-1">{stats?.pendingCount ?? 0}건</div>
          <div className="text-xs text-[var(--text-dim)] mt-0.5">₩{(stats?.pendingAmount ?? 0).toLocaleString()}</div>
        </div>
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
          <div className="text-xs text-[var(--text-dim)]">승인 완료</div>
          <div className="text-lg font-bold text-blue-400 mt-1">{stats?.approvedCount ?? 0}건</div>
          <div className="text-xs text-[var(--text-dim)] mt-0.5">₩{(stats?.approvedAmount ?? 0).toLocaleString()}</div>
        </div>
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
          <div className="text-xs text-[var(--text-dim)]">실행 완료</div>
          <div className="text-lg font-bold text-green-400 mt-1">{stats?.executedCount ?? 0}건</div>
          <div className="text-xs text-[var(--text-dim)] mt-0.5">₩{(stats?.executedAmount ?? 0).toLocaleString()}</div>
        </div>
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
          <div className="text-xs text-[var(--text-dim)]">통장 총 잔고</div>
          <div className="text-lg font-bold mt-1">₩{bankAccounts.reduce((s: number, a: any) => s + Number(a.balance || 0), 0).toLocaleString()}</div>
          <div className="text-xs text-[var(--text-dim)] mt-0.5">{bankAccounts.length}개 통장</div>
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
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6 mb-6">
          <h3 className="text-sm font-bold mb-4">수동 결제 등록</h3>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">금액 (원) *</label>
              <input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })}
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
          { key: "approved", label: "승인완료" }, { key: "executed", label: "실행완료" }, { key: "rejected", label: "거부" },
        ].map((f) => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              filter === f.key ? "bg-[var(--primary)]/10 text-[var(--primary)]" : "text-[var(--text-muted)] hover:text-[var(--text)]"
            }`}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Queue */}
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-16 text-center">
            <div className="text-4xl mb-4">💳</div>
            <div className="text-lg font-bold mb-2">결제 큐가 비어있습니다</div>
            <div className="text-sm text-[var(--text-muted)]">딜 비용 스케줄에서 자동 생성되거나 수동으로 등록하세요</div>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="text-xs text-[var(--text-dim)] border-b border-[var(--border)]">
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
                return (
                  <tr key={item.id} className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-surface)]">
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
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

// ── Tab 2: Payroll Batch ──

function PayrollBatchTab({ companyId, userId, invalidate }: { companyId: string; userId: string; invalidate: () => void }) {
  const [generating, setGenerating] = useState(false);
  const [lastResult, setLastResult] = useState<{ items: PayrollItem[] } | null>(null);
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
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["payment-batches"] }); invalidate(); },
  });

  const executeMut = useMutation({
    mutationFn: (batchId: string) => triggerBatchExecution(batchId),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["payment-batches"] }); invalidate(); },
  });

  async function handleGenerate() {
    setGenerating(true);
    try {
      const result = await createPayrollBatch(companyId);
      setLastResult(result);
      queryClient.invalidateQueries({ queryKey: ["payment-batches"] });
      invalidate();
    } catch (err: any) {
      alert(err.message || '급여 배치 생성 실패');
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
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden">
        {batches.length === 0 ? (
          <div className="p-12 text-center">
            <div className="text-3xl mb-3">💰</div>
            <div className="text-sm font-bold mb-1">급여 배치 없음</div>
            <div className="text-xs text-[var(--text-muted)]">"이번 달 급여 배치 생성" 버튼으로 시작하세요</div>
          </div>
        ) : (
          <table className="w-full">
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
          </table>
        )}
      </div>
    </>
  );
}

// ── Tab 3: Fixed Cost Batch ──

function FixedCostBatchTab({ companyId, userId, invalidate }: { companyId: string; userId: string; invalidate: () => void }) {
  const [generating, setGenerating] = useState(false);
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
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["payment-batches"] }); invalidate(); },
  });

  const executeMut = useMutation({
    mutationFn: (batchId: string) => triggerBatchExecution(batchId),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["payment-batches"] }); invalidate(); },
  });

  async function handleGenerate() {
    setGenerating(true);
    try {
      await createFixedCostBatch(companyId);
      queryClient.invalidateQueries({ queryKey: ["payment-batches"] });
      invalidate();
    } catch (err: any) {
      alert(err.message || '고정비 배치 생성 실패');
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

      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden">
        {batches.length === 0 ? (
          <div className="p-12 text-center">
            <div className="text-3xl mb-3">🏢</div>
            <div className="text-sm font-bold mb-1">고정비 배치 없음</div>
            <div className="text-xs text-[var(--text-muted)]">반복결제를 먼저 설정하고 배치를 생성하세요</div>
          </div>
        ) : (
          <table className="w-full">
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
                  <tr key={b.id} className="border-b border-[var(--border)]/50">
                    <td className="px-5 py-3 text-sm font-medium">{b.name}</td>
                    <td className="px-5 py-3 text-sm text-right font-bold">₩{Number(b.total_amount || 0).toLocaleString()}</td>
                    <td className="px-5 py-3 text-sm text-center">{b.item_count || 0}건</td>
                    <td className="px-5 py-3 text-center">
                      <span className={`text-xs font-semibold ${sl.color}`}>{sl.label}</span>
                    </td>
                    <td className="px-5 py-3 text-center">
                      <div className="flex gap-1.5 justify-center">
                        {(b.status === 'draft' || b.status === 'pending_approval') && (
                          <button onClick={() => approveMut.mutate(b.id)} disabled={approveMut.isPending}
                            className="px-2.5 py-1 bg-blue-500/10 text-blue-400 rounded-lg text-xs font-medium hover:bg-blue-500/20 transition">승인</button>
                        )}
                        {b.status === 'approved' && (
                          <button onClick={() => executeMut.mutate(b.id)} disabled={executeMut.isPending}
                            className="px-2.5 py-1 bg-green-500/10 text-green-400 rounded-lg text-xs font-medium hover:bg-green-500/20 transition">이체 실행</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

// ── Tab 4: Recurring Payments ──

function RecurringPaymentsTab({ companyId, invalidate }: { companyId: string; invalidate: () => void }) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', amount: '', category: 'rent', recipientName: '', recipientAccount: '', recipientBank: '', dayOfMonth: '25' });
  const queryClient = useQueryClient();

  const { data: recurring = [] } = useQuery({
    queryKey: ["recurring-payments", companyId],
    queryFn: () => getRecurringPayments(companyId),
    enabled: !!companyId,
  });

  const saveMut = useMutation({
    mutationFn: () => upsertRecurringPayment({
      companyId,
      name: form.name,
      amount: Number(form.amount),
      category: form.category,
      recipientName: form.recipientName || undefined,
      recipientAccount: form.recipientAccount || undefined,
      recipientBank: form.recipientBank || undefined,
      dayOfMonth: Number(form.dayOfMonth) || 25,
      isActive: true,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recurring-payments"] });
      invalidate();
      setShowForm(false);
      setForm({ name: '', amount: '', category: 'rent', recipientName: '', recipientAccount: '', recipientBank: '', dayOfMonth: '25' });
    },
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["recurring-payments"] }),
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
        <button onClick={() => setShowForm(!showForm)}
          className="px-4 py-2.5 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl text-xs font-semibold transition">
          + 반복결제 추가
        </button>
      </div>

      {showForm && (
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6 mb-6">
          <h3 className="text-sm font-bold mb-4">반복결제 등록</h3>
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">명칭 *</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="예: 스파크플러스 임대료"
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">금액 (원) *</label>
              <input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })}
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
          <div className="flex gap-2">
            <button onClick={() => form.name && form.amount && saveMut.mutate()}
              disabled={!form.name || !form.amount || saveMut.isPending}
              className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-sm font-semibold disabled:opacity-50">등록</button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 text-[var(--text-muted)] text-sm">취소</button>
          </div>
        </div>
      )}

      {/* List */}
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden">
        {recurring.length === 0 ? (
          <div className="p-12 text-center">
            <div className="text-3xl mb-3">🔄</div>
            <div className="text-sm font-bold mb-1">반복결제가 없습니다</div>
            <div className="text-xs text-[var(--text-muted)]">임대료, 보험, 구독 등 매월 고정 지출을 등록하세요</div>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="text-xs text-[var(--text-dim)] border-b border-[var(--border)]">
                <th className="text-left px-5 py-3 font-medium">명칭</th>
                <th className="text-left px-5 py-3 font-medium">카테고리</th>
                <th className="text-right px-5 py-3 font-medium">금액</th>
                <th className="text-left px-5 py-3 font-medium">수취인</th>
                <th className="text-center px-5 py-3 font-medium">이체일</th>
                <th className="text-center px-5 py-3 font-medium">상태</th>
              </tr>
            </thead>
            <tbody>
              {recurring.map((r: any) => (
                <tr key={r.id} className={`border-b border-[var(--border)]/50 ${!r.is_active ? 'opacity-50' : ''}`}>
                  <td className="px-5 py-3 text-sm font-medium">{r.name}</td>
                  <td className="px-5 py-3 text-xs">
                    <span className="px-2 py-0.5 rounded-full bg-[var(--bg-surface)] text-[var(--text-muted)]">
                      {categories[r.category] || r.category}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-sm text-right font-bold">₩{Number(r.amount || 0).toLocaleString()}</td>
                  <td className="px-5 py-3 text-xs text-[var(--text-muted)]">{r.recipient_name || '—'}</td>
                  <td className="px-5 py-3 text-xs text-center">매월 {r.day_of_month || 25}일</td>
                  <td className="px-5 py-3 text-center">
                    <button onClick={() => toggleMut.mutate(r)} disabled={toggleMut.isPending}
                      className={`text-xs px-2.5 py-1 rounded-lg font-medium transition ${
                        r.is_active
                          ? 'bg-green-500/10 text-green-400 hover:bg-green-500/20'
                          : 'bg-gray-500/10 text-gray-400 hover:bg-gray-500/20'
                      }`}>
                      {r.is_active ? '활성' : '비활성'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

// ── Smart Setup Banner (이체내역 분석 + 자동화 실행 + 파이프라인) ──

function SmartSetupBanner({ companyId, invalidate }: { companyId: string; invalidate: () => void }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AutomationResult | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [detected, setDetected] = useState<DetectedRecurring[]>([]);
  const queryClient = useQueryClient();

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

  async function handleRunAutomation() {
    setRunning(true);
    try {
      const res = await runAllAutomation(companyId);
      setResult(res);
      invalidate();
    } catch {
      // silent
    }
    setRunning(false);
  }

  async function handleDetect() {
    setDetecting(true);
    try {
      const res = await detectRecurringFromBankTx(companyId);
      setDetected(res);
      queryClient.invalidateQueries({ queryKey: ["detected-recurring"] });
    } catch {
      // silent
    }
    setDetecting(false);
  }

  const activeRecurring = recurring.filter((r: any) => r.is_active).length;
  const pendingCount = stats?.pendingCount ?? 0;
  const approvedCount = stats?.approvedCount ?? 0;
  const executedCount = stats?.executedCount ?? 0;

  return (
    <div className="mb-6 space-y-3">
      {/* Pipeline visualization */}
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs font-bold text-[var(--text)]">자동화 파이프라인</span>
          <span className="text-[10px] text-[var(--text-dim)]">설정 &rarr; 지출결의 &rarr; 승인 &rarr; 결제 &rarr; 세금계산서</span>
        </div>
        <div className="flex items-center gap-1">
          {[
            { label: '반복설정', count: activeRecurring, color: 'bg-purple-500' },
            { label: '승인대기', count: pendingCount, color: 'bg-yellow-500' },
            { label: '결제대기', count: approvedCount, color: 'bg-blue-500' },
            { label: '완료', count: executedCount, color: 'bg-green-500' },
          ].map((step, i) => (
            <div key={i} className="flex items-center gap-1 flex-1">
              <div className="flex-1 bg-[var(--bg-surface)] rounded-lg p-2 text-center">
                <div className={`text-lg font-bold ${step.color.replace('bg-', 'text-')}`}>{step.count}</div>
                <div className="text-[10px] text-[var(--text-dim)]">{step.label}</div>
              </div>
              {i < 3 && <span className="text-[var(--text-dim)] text-xs">&rarr;</span>}
            </div>
          ))}
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2">
        <button onClick={handleDetect} disabled={detecting}
          className="px-4 py-2 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl text-xs font-semibold hover:border-[var(--primary)] transition disabled:opacity-50">
          {detecting ? '분석 중...' : '이체내역 분석'}
        </button>
        <button onClick={handleRunAutomation} disabled={running}
          className="px-4 py-2 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl text-xs font-semibold transition disabled:opacity-50">
          {running ? '실행 중...' : '전체 자동화 실행'}
        </button>
      </div>

      {/* Automation result */}
      {result && (
        <div className="bg-green-500/5 border border-green-500/20 rounded-xl p-3">
          <div className="text-xs font-bold text-green-500 mb-2">자동화 실행 완료</div>
          <div className="grid grid-cols-4 gap-2 text-[10px]">
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
                <div className="text-[var(--text-dim)]">휴면딜 감지</div>
              </div>
            )}
          </div>
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
                  setDetected([]);
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
