"use client";
import { appConfirm } from "@/components/global-confirm";
import { Ico } from "@/components/ui-icon";
import { todayKst } from "@/lib/kst";

import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { getFinancialDashboardData } from "@/lib/queries";
import { buildFinancialDashboard as buildFinDash } from "@/lib/engines";
import { generateMonthlyPLReport } from "@/lib/pdf-report";
import { getOrCreateChecklist, toggleChecklistItem, completeClosingChecklist, lockClosingMonth, unlockClosingMonth, autoVerifyChecklist, autoCloseMonth, attachReportUrl } from "@/lib/closing";
import { useToast } from "@/components/toast";

// 월 마감 체크리스트 — 대시보드 하단에 있던 것을 마스터 화면으로 이동하며 분리 (2026-08-10 사장님).
//   로직·마크업은 dashboard/page.tsx 의 ClosingChecklistWidget 그대로.
export function ClosingChecklistWidget({ companyId, userId }: { companyId: string | null; userId: string | null }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const month = todayKst().slice(0, 7);

  const { data: checklist } = useQuery({
    queryKey: ['closing-checklist', companyId, month],
    queryFn: () => getOrCreateChecklist(companyId!, month),
    enabled: !!companyId,
  });

  // 리포트 PDF 생성에 필요한 재무 raw data (자동 마감 시 PDF 자동 생성용)
  const { data: finRaw } = useQuery({
    queryKey: ['fin-dash', companyId],
    queryFn: () => getFinancialDashboardData(companyId!),
    enabled: !!companyId,
  });

  const toggleMut = useMutation({
    mutationFn: ({ itemId, completed }: { itemId: string; completed: boolean }) => {
      if (!userId) throw new Error("Not authenticated");
      return toggleChecklistItem(itemId, userId, completed);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['closing-checklist'] }),
  });

  const completeMut = useMutation({
    mutationFn: () => {
      if (!userId) throw new Error("Not authenticated");
      return completeClosingChecklist(checklist!.id, userId);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['closing-checklist'] }),
  });

  const lockMut = useMutation({
    mutationFn: () => {
      if (!userId) throw new Error("Not authenticated");
      return lockClosingMonth(checklist!.id, userId);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['closing-checklist'] }),
  });

  const unlockMut = useMutation({
    mutationFn: () => {
      if (!userId) throw new Error("Not authenticated");
      return unlockClosingMonth(checklist!.id, userId);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['closing-checklist'] }),
  });

  const autoVerifyMut = useMutation({
    mutationFn: () => autoVerifyChecklist(companyId!, checklist!.id, month),
    onSuccess: (outcomes) => {
      const passed = outcomes.filter(o => o.passed).length;
      toast(`자동 검증 완료: ${passed}/${outcomes.length} 항목 통과`, 'success');
      queryClient.invalidateQueries({ queryKey: ['closing-checklist'] });
    },
    onError: (e: any) => toast(`자동 검증 실패: ${e.message}`, 'error'),
  });

  const autoCloseMut = useMutation({
    mutationFn: async () => {
      if (!companyId || !checklist || !finRaw) throw new Error("데이터 로딩 중");

      // 1) 자동 검증 + 자동 완료 (필수 통과 시)
      const result = await autoCloseMonth(companyId, month, { userId: userId || undefined });

      // 2) PDF 생성 + Storage 업로드 (마감 여부와 무관하게 리포트 보관)
      const finData = buildFinDash(
        (finRaw.allMonths as any[]).map((m: any) => ({
          month: m.month,
          revenue: Number(m.revenue || 0),
          totalIncome: Number(m.totalIncome || m.revenue || 0),
          totalExpense: Number(m.totalExpense || m.expense || 0),
        })),
        (finRaw.deals as any[]).map((d: any) => ({
          classification: d.classification || '미분류',
          contractTotal: Number(d.contractTotal || 0),
          revenue: Number(d.revenue || 0),
          cost: Number(d.cost || 0),
        })),
        finRaw.classificationColors || {},
      );

      const { publicUrl } = await generateMonthlyPLReport({
        month, companyName: '',
        revenue: finData.totalRevenue,
        expense: finData.totalExpense,
        netIncome: finData.netIncome,
        items: (finRaw.items || []).filter((i: any) => i.month === month).map((i: any) => ({
          name: i.name || '-',
          category: i.category || 'expense',
          amount: Number(i.amount || 0),
          counterparty: i.project_name || undefined,
        })),
        bankBalance: 0, fixedCost: 0, runwayMonths: 999,
        dealBreakdown: finData.classificationBreakdown.map(cb => ({
          dealName: cb.classification, classification: cb.classification,
          revenue: cb.totalRevenue, cost: cb.totalCost,
          margin: cb.totalRevenue > 0 ? cb.avgMargin : 0,
        })),
      }, { upload: true, companyId, download: true });

      if (publicUrl) await attachReportUrl(checklist.id, publicUrl);

      return { ...result, publicUrl };
    },
    onSuccess: (r) => {
      const pdfMsg = r.publicUrl ? '리포트 PDF 다운로드 + 저장됨' : '리포트 PDF 다운로드됨(저장 실패)';
      if (r.closed) {
        toast(`자동 마감 완료 — ${r.reason}. ${pdfMsg}`, 'success');
      } else {
        toast(`자동 검증 완료 — ${r.reason}. ${pdfMsg}`, 'info');
      }
      queryClient.invalidateQueries({ queryKey: ['closing-checklist'] });
    },
    onError: (e: any) => toast(`자동 마감 실패: ${e.message}`, 'error'),
  });

  if (!checklist) return null;

  const items = checklist.items || [];
  const total = items.length;
  const done = items.filter((i: any) => i.is_completed).length;
  const requiredDone = items.filter((i: any) => i.is_required && i.is_completed).length;
  const requiredTotal = items.filter((i: any) => i.is_required).length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const allRequiredDone = requiredDone === requiredTotal;
  const reportUrl = (checklist as any).report_url as string | null;
  const autoClosed = (checklist as any).auto_closed as boolean | undefined;

  return (
    <div className="dashboard-closing-checklist-widget">
      <div className="flex items-center gap-2 mb-3">
        <div className={`w-2 h-2 rounded-full ${checklist.status === 'completed' ? 'bg-[var(--success)]' : 'bg-[var(--warning)]'}`} />
        <h2 className="eyebrow">월 마감 체크리스트</h2>
        <span className="caption">{month} · {done}/{total} ({pct}%)</span>
        {autoClosed && <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--accent)]/10 text-[var(--accent)]">자동마감</span>}
      </div>

      <div className="glass-card p-4">
        {/* Progress bar */}
        <div className="flex items-center gap-2 mb-3">
          <div className="flex-1 h-1.5 rounded-full bg-[var(--bg-surface)] overflow-hidden">
            <div className={`h-full rounded-full transition-all duration-500 ${pct === 100 ? 'bg-[var(--success)]' : pct >= 60 ? 'bg-[var(--warning)]' : 'bg-[var(--danger)]'}`} style={{ width: `${pct}%` }} />
          </div>
          <span className="text-[10px] text-[var(--text-dim)] mono-number">{pct}%</span>
        </div>

        {/* 저장된 리포트 다운로드 */}
        {reportUrl && (
          <a href={reportUrl} target="_blank" rel="noopener noreferrer"
            className="mb-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] transition text-[11px] text-[var(--text)]">
            <span><Ico e="📄" /></span>
            <span className="flex-1">{month} 손익 리포트 PDF</span>
            <span className="text-[9px] text-[var(--text-dim)]">다운로드</span>
          </a>
        )}

        {checklist.status === 'locked' ? (
          <div className="text-center py-3">
            <div className="text-sm text-[var(--text-dim)] font-semibold mb-2"><Ico e="🔒" /> 마감 잠금됨</div>
            <p className="text-[10px] text-[var(--text-dim)] mb-2">이 달의 데이터 수정이 잠금되었습니다</p>
            <button onClick={async () => { if (await appConfirm("마감 잠금을 해제하시겠습니까? 데이터 수정이 가능해집니다.", { confirmLabel: "잠금 해제" })) unlockMut.mutate(); }}
              disabled={unlockMut.isPending}
              className="px-3 py-1.5 text-[10px] bg-[var(--bg-surface)] text-[var(--text-muted)] rounded-lg hover:bg-[var(--bg-elevated)] transition disabled:opacity-50">
              {unlockMut.isPending ? '해제 중...' : '잠금 해제'}
            </button>
          </div>
        ) : checklist.status === 'completed' ? (
          <div className="text-center py-3">
            <div className="text-sm text-[var(--success)] font-semibold mb-2">마감 완료</div>
            <button onClick={() => lockMut.mutate()} disabled={lockMut.isPending}
              className="px-3 py-1.5 text-[10px] bg-[var(--warning)]/10 text-[var(--warning)] rounded-lg hover:bg-[var(--warning)]/20 transition disabled:opacity-50">
              {lockMut.isPending ? '잠금 중...' : '마감 잠금'}
            </button>
          </div>
        ) : (
          <>
            <div className="space-y-1">
              {items.map((item: any) => (
                <label key={item.id} className="flex items-start gap-2 px-2 py-1.5 rounded-lg hover:bg-[var(--bg-surface)] cursor-pointer transition">
                  <input
                    type="checkbox"
                    checked={item.is_completed}
                    onChange={(e) => toggleMut.mutate({ itemId: item.id, completed: e.target.checked })}
                    className="rounded mt-0.5"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className={`text-xs ${item.is_completed ? 'text-[var(--text-dim)] line-through' : 'text-[var(--text)]'}`}>
                        {item.title}
                      </span>
                      {item.is_required && <span className="text-[var(--danger)] text-[10px]">*</span>}
                      {item.auto_verified && (
                        <span className="text-[9px] px-1 py-0.5 rounded bg-[var(--accent)]/10 text-[var(--accent)] shrink-0">자동</span>
                      )}
                    </div>
                    {item.verified_reason && (
                      <div className={`text-[10px] ${item.is_completed ? 'text-[var(--text-dim)]' : 'text-[var(--danger)]'}`}>
                        {item.verified_reason}
                      </div>
                    )}
                  </div>
                </label>
              ))}
            </div>

            <div className="mt-3 flex gap-2">
              <button
                onClick={() => autoVerifyMut.mutate()}
                disabled={autoVerifyMut.isPending}
                className="flex-1 py-2 bg-[var(--bg-surface)] text-[var(--text)] rounded-lg text-xs font-semibold hover:bg-[var(--bg-elevated)] transition disabled:opacity-50"
              >
                {autoVerifyMut.isPending ? '검증 중...' : '자동 검증'}
              </button>
              <button
                onClick={() => autoCloseMut.mutate()}
                disabled={autoCloseMut.isPending || !finRaw}
                className="flex-1 py-2 bg-[var(--accent)] text-black rounded-lg text-xs font-semibold hover:bg-[var(--accent)]/90 transition disabled:opacity-50"
                title="자동 검증 + 필수 통과 시 자동 마감 + PDF 리포트 저장"
              >
                {autoCloseMut.isPending ? '처리 중...' : '⚡ 자동 마감 + 리포트'}
              </button>
            </div>

            {allRequiredDone && (
              <button
                onClick={() => completeMut.mutate()}
                disabled={completeMut.isPending}
                className="mt-2 w-full py-2 bg-[var(--success)] text-white rounded-lg text-xs font-semibold hover:bg-[var(--success)]/90 transition disabled:opacity-50"
              >
                {completeMut.isPending ? '처리 중...' : '월 마감 수동 완료'}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
