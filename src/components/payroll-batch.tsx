"use client";

// 급여 배치(급여 일괄 지급) — 2026-07-08 정기지출→인사 이관. payments/page.tsx 에서 추출(동작 무변경).
//   인사 > 급여 탭에서 마운트. createPayrollBatch → payment_batches 생성 → 승인 → 자동이체 실행.

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createPayrollBatch, approveBatch, triggerBatchExecution, getPrevMonthPayrollSnapshot, type PayrollItem } from "@/lib/payment-batch";
import { getPaymentBatches } from "@/lib/approval-center";
import { friendlyError } from "@/lib/friendly-error";
import { useToast } from "@/components/toast";
import { useModalKeys } from "@/hooks/use-modal-keys";

export function PayrollBatchTab({ companyId, userId, invalidate }: { companyId: string; userId: string; invalidate: () => void }) {
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

  // ESC 닫기 · Enter 확인(복사여부에 따라 해당 solid 버튼 — 생성 중이면 비활성)
  useModalKeys(!!copyPrompt, () => setCopyPrompt(null), copyPrompt && !generating
    ? () => runGenerate(copyPrompt.exists, !copyPrompt.exists)
    : undefined);

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
        <div className="copy-prompt-modal fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setCopyPrompt(null)}>
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

      <div className="payroll-header flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-bold">급여 일괄 이체</h2>
          <p className="text-xs text-[var(--text-muted)] mt-1">전 직원 급여 배치 생성 → 대표 승인 → 일괄 이체</p>
        </div>
        <button onClick={handleGenerate} disabled={generating}
          className="btn-primary disabled:opacity-50">
          {generating ? '생성 중...' : '이번 달 급여 배치 생성'}
        </button>
      </div>

      {/* Last generated preview */}
      {lastResult && (
        <div className="last-generated-preview bg-green-500/5 border border-green-500/20 rounded-2xl p-4 mb-6 shadow-md">
          <div className="text-sm font-bold text-green-500 mb-3">급여 배치가 생성되었습니다 ({lastResult.items.length}명)</div>
          <div className="space-y-1">
            {lastResult.items.map((item, i) => (
              <div key={i} className="preview-item-row flex items-center justify-between text-xs">
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
      <div className="batch-history-card glass-card overflow-hidden">
        {batches.length === 0 ? (
          <div className="batch-empty-state py-14 px-6 text-center">
            <div className="text-5xl mb-4">💰</div>
            <div className="text-base font-bold mb-1.5">급여 배치 없음</div>
            <div className="text-sm text-[var(--text-muted)]">"이번 달 급여 배치 생성" 버튼으로 시작하세요</div>
          </div>
        ) : (
          <div className="overflow-auto max-h-[560px] relative"><table className="w-full min-w-[600px]">
            <thead>
              <tr className="table-head-row">
                <th className="th-cell text-left">배치명</th>
                <th className="th-cell text-right">총액</th>
                <th className="th-cell text-center">인원</th>
                <th className="th-cell text-center">상태</th>
                <th className="th-cell text-left">생성일</th>
                <th className="th-cell text-center">액션</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b: any) => {
                const sl = statusLabel[b.status] || statusLabel.draft;
                return (
                  <tr key={b.id} className="batch-row border-b border-[var(--border)]/50">
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
                      <div className="batch-row-actions flex gap-1.5 justify-center">
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
