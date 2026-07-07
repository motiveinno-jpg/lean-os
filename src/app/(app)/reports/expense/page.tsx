"use client";

// 비용 현황 — "어디에 썼나?"에 답하는 대표용 화면(2026-07-08).
//   이번 달 비용 + 지난달 대비 + 고정 vs 변동 + 월별 추세 + 어디에 썼나(카테고리).
//   소스: cash-budget 월별 비용 + getCostBreakdown(카테고리). /reports/costs(정식 비용분석)와 동일 소스.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { getCurrentUser } from "@/lib/queries";
import { getMonthlyBudgetOverview, getCostBreakdown, type MonthlyBudget, type CostBreakdown } from "@/lib/cash-budget";
import { useUser } from "@/components/user-context";
import { AccessDenied } from "@/components/access-denied";
import { ReportsTabs } from "../_components/ReportsTabs";
import { fmt, ymNow, prevMonthStr, Delta, MiniBars } from "../_components/kit";

export default function ExpensePage() {
  const { role } = useUser();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const { year, month } = ymNow();
  const lastMonth = prevMonthStr(month);

  useEffect(() => { getCurrentUser().then((u) => { if (u) setCompanyId(u.company_id); }); }, []);

  const { data: budget = [] } = useQuery<MonthlyBudget[]>({
    queryKey: ["expense-budget", companyId, year],
    queryFn: () => getMonthlyBudgetOverview(companyId!, year),
    enabled: !!companyId, staleTime: 60_000,
  });
  const { data: breakdown } = useQuery<CostBreakdown>({
    queryKey: ["expense-breakdown", companyId, year],
    queryFn: () => getCostBreakdown(companyId!, year),
    enabled: !!companyId, staleTime: 60_000,
  });

  if (role === "partner" || role === "employee") {
    return <AccessDenied detail="비용 현황은 대표·관리자 전용입니다." />;
  }

  const mBudget = budget.find((b) => b.month === month);
  const expense = mBudget?.expenseTotal ?? 0;
  const lastExpense = budget.find((b) => b.month === lastMonth)?.expenseTotal ?? 0;
  const fixed = mBudget?.fixedCosts ?? 0;
  const variable = mBudget?.variableCosts ?? 0;
  const fixedPct = expense > 0 ? Math.round((fixed / expense) * 100) : 0;
  const trend = budget.filter((b) => b.month <= month).slice(-6).map((b) => ({ label: b.month.slice(5) + "월", value: b.expenseTotal || 0 }));

  // 카테고리(고정+변동 합쳐 연간 금액 큰 순 TOP)
  const cats = [...(breakdown?.fixed || []), ...(breakdown?.variable || [])]
    .map((c) => ({ label: c.label, amt: c.amount })).filter((c) => c.amt > 0)
    .sort((a, b) => b.amt - a.amt).slice(0, 7);
  const catMax = Math.max(1, ...cats.map((c) => c.amt));
  const loading = !companyId || budget.length === 0;

  return (
    <div className="space-y-6">
      <ReportsTabs />
      {loading ? (
        <div className="flex items-center justify-center py-20"><div className="w-8 h-8 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <>
          {/* 이번 달 비용 + 고정/변동 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="glass-card p-5 flex flex-col gap-2">
              <span className="text-[13px] font-semibold text-[var(--text-muted)] flex items-center gap-1.5"><span className="w-2 h-2 rounded-full shrink-0 bg-[var(--warning)]" />이번 달 비용</span>
              <span className="text-[28px] leading-9 font-extrabold mono-number text-[var(--warning)]">{fmt(expense)}</span>
              <Delta cur={expense} prev={lastExpense} invert />
            </div>
            <div className="glass-card p-5 flex flex-col gap-2">
              <span className="text-[13px] font-semibold text-[var(--text-muted)]">고정비 · 변동비 <span className="text-[var(--text-dim)] font-normal">(구성 비중)</span></span>
              <div className="flex h-3 rounded-full overflow-hidden mt-1 bg-[var(--bg-surface)]">
                <div style={{ width: `${fixedPct}%`, background: "var(--primary)" }} title={`고정비 ${fixedPct}%`} />
                <div style={{ width: `${100 - fixedPct}%`, background: "var(--warning)" }} title={`변동비 ${100 - fixedPct}%`} />
              </div>
              <div className="flex justify-between text-[11px] mt-1">
                <span className="text-[var(--primary)] font-semibold">고정 {fmt(fixed)} ({fixedPct}%)</span>
                <span className="text-[var(--warning)] font-semibold">변동 {fmt(variable)} ({100 - fixedPct}%)</span>
              </div>
            </div>
          </div>

          {/* 월별 추세 */}
          <div className="glass-card p-5">
            <div className="text-sm font-bold text-[var(--text)] mb-4">최근 비용 추세</div>
            <MiniBars data={trend} color="var(--warning)" />
          </div>

          {/* 어디에 썼나 — 카테고리 */}
          <div className="glass-card p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="text-sm font-bold text-[var(--text)]">비용 항목별 구성 <span className="text-[var(--text-dim)] text-xs font-normal">(올해 상위)</span></div>
              <Link href="/reports/costs" className="text-xs text-[var(--primary)] font-semibold hover:underline">상세 비용 분석 →</Link>
            </div>
            {cats.length === 0 ? (
              <div className="text-xs text-[var(--text-dim)] py-6 text-center">분류된 비용 데이터가 없습니다. 거래내역을 분류하면 채워집니다.</div>
            ) : (
              <div className="space-y-2.5">
                {cats.map((c) => (
                  <div key={c.label} className="flex items-center gap-3">
                    <span className="text-sm text-[var(--text)] w-28 shrink-0 truncate">{c.label}</span>
                    <div className="flex-1 h-2.5 rounded-full bg-[var(--bg-surface)] overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${Math.round((c.amt / catMax) * 100)}%`, background: "var(--warning)" }} />
                    </div>
                    <span className="mono-number text-xs font-semibold text-[var(--text)] w-24 text-right shrink-0">{fmt(c.amt)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
