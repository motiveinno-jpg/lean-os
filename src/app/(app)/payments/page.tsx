"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getCurrentUser, getPaymentQueue, getBankAccounts } from "@/lib/queries";
import { approvePayment, rejectPayment, executePayment, createQueueEntry, getPaymentQueueStats } from "@/lib/payment-queue";

export default function PaymentsPage() {
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
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

  const { data: queue = [] } = useQuery({
    queryKey: ["payment-queue", companyId],
    queryFn: () => getPaymentQueue(companyId!),
    enabled: !!companyId,
  });

  const { data: stats } = useQuery({
    queryKey: ["payment-stats", companyId],
    queryFn: () => getPaymentQueueStats(companyId!),
    enabled: !!companyId,
  });

  const { data: bankAccounts = [] } = useQuery({
    queryKey: ["bank-accounts", companyId],
    queryFn: () => getBankAccounts(companyId!),
    enabled: !!companyId,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["payment-queue"] });
    queryClient.invalidateQueries({ queryKey: ["payment-stats"] });
    queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
  };

  const approveMut = useMutation({
    mutationFn: (id: string) => approvePayment(id, userId!),
    onSuccess: invalidate,
  });

  const rejectMut = useMutation({
    mutationFn: (id: string) => rejectPayment(id, userId!),
    onSuccess: invalidate,
  });

  const executeMut = useMutation({
    mutationFn: (id: string) => executePayment(id),
    onSuccess: invalidate,
  });

  const createMut = useMutation({
    mutationFn: () => createQueueEntry({
      companyId: companyId!,
      amount: Number(form.amount),
      description: form.description,
    }),
    onSuccess: () => {
      invalidate();
      setShowForm(false);
      setForm({ amount: "", description: "" });
    },
  });

  const filtered = filter === "all" ? queue : queue.filter((q: any) => q.status === filter);

  const statusConfig: Record<string, { label: string; bg: string; text: string }> = {
    pending: { label: "승인대기", bg: "bg-yellow-500/10", text: "text-yellow-400" },
    approved: { label: "승인완료", bg: "bg-blue-500/10", text: "text-blue-400" },
    executed: { label: "실행완료", bg: "bg-green-500/10", text: "text-green-400" },
    rejected: { label: "거부", bg: "bg-red-500/10", text: "text-red-400" },
  };

  return (
    <div className="max-w-[1100px]">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-extrabold">결제 관리</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">지급 결제 승인/실행 큐</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-4 py-2.5 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl text-sm font-semibold transition"
        >
          + 수동 결제 등록
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
          <div className="text-xs text-[var(--text-dim)]">승인 대기</div>
          <div className="text-lg font-bold text-yellow-400 mt-1">
            {stats?.pendingCount ?? 0}건
          </div>
          <div className="text-xs text-[var(--text-dim)] mt-0.5">
            ₩{(stats?.pendingAmount ?? 0).toLocaleString()}
          </div>
        </div>
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
          <div className="text-xs text-[var(--text-dim)]">승인 완료</div>
          <div className="text-lg font-bold text-blue-400 mt-1">
            {stats?.approvedCount ?? 0}건
          </div>
          <div className="text-xs text-[var(--text-dim)] mt-0.5">
            ₩{(stats?.approvedAmount ?? 0).toLocaleString()}
          </div>
        </div>
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
          <div className="text-xs text-[var(--text-dim)]">실행 완료</div>
          <div className="text-lg font-bold text-green-400 mt-1">
            {stats?.executedCount ?? 0}건
          </div>
          <div className="text-xs text-[var(--text-dim)] mt-0.5">
            ₩{(stats?.executedAmount ?? 0).toLocaleString()}
          </div>
        </div>
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
          <div className="text-xs text-[var(--text-dim)]">통장 총 잔고</div>
          <div className="text-lg font-bold mt-1">
            ₩{bankAccounts.reduce((s: number, a: any) => s + Number(a.balance || 0), 0).toLocaleString()}
          </div>
          <div className="text-xs text-[var(--text-dim)] mt-0.5">
            {bankAccounts.length}개 통장
          </div>
        </div>
      </div>

      {/* Quick add form */}
      {showForm && (
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6 mb-6">
          <h3 className="text-sm font-bold mb-4">수동 결제 등록</h3>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">금액 (원) *</label>
              <input
                type="number"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                placeholder="1000000"
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">설명</label>
              <input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="외주비 - A업체"
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => Number(form.amount) > 0 && createMut.mutate()}
              disabled={!form.amount || createMut.isPending}
              className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-sm font-semibold disabled:opacity-50"
            >
              등록
            </button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 text-[var(--text-muted)] text-sm">
              취소
            </button>
          </div>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-2 mb-4">
        {[
          { key: "all", label: "전체" },
          { key: "pending", label: "승인대기" },
          { key: "approved", label: "승인완료" },
          { key: "executed", label: "실행완료" },
          { key: "rejected", label: "거부" },
        ].map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              filter === f.key
                ? "bg-[var(--primary)]/10 text-[var(--primary)]"
                : "text-[var(--text-muted)] hover:text-white hover:bg-white/[.03]"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Queue list */}
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-16 text-center">
            <div className="text-4xl mb-4">💳</div>
            <div className="text-lg font-bold mb-2">결제 큐가 비어있습니다</div>
            <div className="text-sm text-[var(--text-muted)]">
              딜 비용 스케줄에서 자동 생성되거나 수동으로 등록하세요
            </div>
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
                  <tr key={item.id} className="border-b border-[var(--border)]/50 hover:bg-white/[.01]">
                    <td className="px-5 py-3 text-sm">{item.description || "—"}</td>
                    <td className="px-5 py-3 text-sm text-right font-medium">
                      ₩{Number(item.amount).toLocaleString()}
                    </td>
                    <td className="px-5 py-3 text-xs text-[var(--text-muted)]">
                      {item.bank_accounts?.alias || item.bank_accounts?.bank_name || "미지정"}
                    </td>
                    <td className="px-5 py-3 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${sc.bg} ${sc.text}`}>
                        {sc.label}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-xs text-[var(--text-dim)]">
                      {item.created_at ? new Date(item.created_at).toLocaleDateString('ko') : "—"}
                    </td>
                    <td className="px-5 py-3 text-center">
                      <div className="flex gap-1.5 justify-center">
                        {item.status === "pending" && (
                          <>
                            <button
                              onClick={() => approveMut.mutate(item.id)}
                              disabled={approveMut.isPending}
                              className="px-2.5 py-1 bg-blue-500/10 text-blue-400 rounded-lg text-xs font-medium hover:bg-blue-500/20 transition"
                            >
                              승인
                            </button>
                            <button
                              onClick={() => rejectMut.mutate(item.id)}
                              disabled={rejectMut.isPending}
                              className="px-2.5 py-1 bg-red-500/10 text-red-400 rounded-lg text-xs font-medium hover:bg-red-500/20 transition"
                            >
                              거부
                            </button>
                          </>
                        )}
                        {item.status === "approved" && (
                          <button
                            onClick={() => executeMut.mutate(item.id)}
                            disabled={executeMut.isPending}
                            className="px-2.5 py-1 bg-green-500/10 text-green-400 rounded-lg text-xs font-medium hover:bg-green-500/20 transition"
                          >
                            실행
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
    </div>
  );
}
