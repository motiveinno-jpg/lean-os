"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getBankTransactions } from "@/lib/queries";
import { exportBankTransactionsExcel } from "@/lib/excel-export";

interface Props {
  companyId: string;
  topN?: number; // 기본 5
}

function fmtKRW(n: number): string {
  return n.toLocaleString('ko-KR');
}

function startOfMonth(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function endOfMonth(d: Date): string {
  const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  next.setDate(next.getDate() - 1);
  return next.toISOString().slice(0, 10);
}

export function TopExpensesThisMonth({ companyId, topN = 5 }: Props) {
  const now = new Date();
  const monthLabel = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const dateFrom = startOfMonth(now);
  const dateTo = endOfMonth(now);

  const { data: rows = [] } = useQuery({
    queryKey: ['top-expenses-month', companyId, monthLabel],
    queryFn: () => getBankTransactions(companyId, {
      dateFrom, dateTo, type: 'expense',
    }),
    enabled: !!companyId,
    staleTime: 30_000,
  });

  // 이번달 전체 export 용 (입금+출금 다)
  const { data: monthAll = [] } = useQuery({
    queryKey: ['month-tx-all', companyId, monthLabel],
    queryFn: () => getBankTransactions(companyId, { dateFrom, dateTo }),
    enabled: !!companyId,
    staleTime: 30_000,
  });

  const top = useMemo(() => {
    return [...(rows as any[])]
      .sort((a, b) => Math.abs(Number(b.amount || 0)) - Math.abs(Number(a.amount || 0)))
      .slice(0, topN);
  }, [rows, topN]);

  const totalThisMonth = useMemo(() => {
    return (rows as any[]).reduce((s, r) => s + Math.abs(Number(r.amount || 0)), 0);
  }, [rows]);

  const handleExcel = () => {
    if (!monthAll.length) return;
    exportBankTransactionsExcel(monthAll as any, monthLabel);
  };

  return (
    <div className="mb-3 bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-base">💸</span>
          <h2 className="text-sm font-bold text-[var(--text)]">이번달 큰 지출 TOP {topN}</h2>
          <span className="text-[10px] text-[var(--text-dim)]">{monthLabel}</span>
        </div>
        <button
          onClick={handleExcel}
          disabled={monthAll.length === 0}
          className="flex items-center gap-1 px-2.5 py-1.5 bg-[var(--success)]/10 hover:bg-[var(--success)]/20 text-[var(--success)] rounded-lg text-[11px] font-semibold transition disabled:opacity-50"
          title="이번달 통장 거래내역 전체를 회계프로그램 업로드용 엑셀(xlsx)로 다운로드"
        >
          📊 엑셀 다운로드
        </button>
      </div>

      {top.length > 0 && (
        <div className="text-[10px] text-[var(--text-dim)] mb-2 flex justify-between">
          <span>총 지출 {(rows as any[]).length}건</span>
          <span className="mono-number text-[var(--danger)] font-semibold">₩{fmtKRW(totalThisMonth)}</span>
        </div>
      )}

      {top.length === 0 ? (
        <div className="text-center py-6 text-xs text-[var(--text-dim)]">
          이번달 지출 내역이 없습니다.
        </div>
      ) : (
        <div className="space-y-1.5">
          {top.map((t: any, i: number) => {
            const amount = Math.abs(Number(t.amount || 0));
            const dateStr = t.transaction_date || '';
            const d = new Date(dateStr);
            const dateDisplay = isNaN(d.getTime()) ? dateStr : `${d.getMonth() + 1}/${d.getDate()}`;
            const counterparty = t.counterparty || '(거래처 미상)';
            const bank = t.bank_accounts?.alias || t.bank_accounts?.bank_name || '';
            return (
              <div key={t.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[var(--bg-surface)]">
                <div className="text-[10px] font-bold text-[var(--text-dim)] w-5 text-center">{i + 1}</div>
                <div className="text-[10px] text-[var(--text-dim)] w-10 mono-number">{dateDisplay}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-[var(--text)] truncate">{counterparty}</div>
                  <div className="text-[10px] text-[var(--text-dim)] truncate">
                    {bank}{t.classification ? ` · ${t.classification}` : t.category ? ` · ${t.category}` : ''}
                  </div>
                </div>
                <div className="text-sm font-bold mono-number text-[var(--danger)] shrink-0">
                  ₩{fmtKRW(amount)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
