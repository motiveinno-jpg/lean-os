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
import { fmt, ymNow, MonthlyCompareCard } from "../_components/kit";
import { CellDetail } from "../flow/_components/CellDetail";
import { IntroCard, Section } from "@/components/report-kit";

export default function ExpensePage() {
  const { role } = useUser();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const { year, month } = ymNow();
  const [detailMonth, setDetailMonth] = useState<number | null>(null);

  useEffect(() => { getCurrentUser().then((u) => { if (u) setCompanyId(u.company_id); }); }, []);

  const { data: budget = [], isLoading: budgetLoading } = useQuery<MonthlyBudget[]>({
    queryKey: ["expense-budget", companyId, year],
    queryFn: () => getMonthlyBudgetOverview(companyId!, year),
    enabled: !!companyId, staleTime: 60_000,
  });
  const { data: prevBudget = [] } = useQuery<MonthlyBudget[]>({
    queryKey: ["expense-budget-prev", companyId, year - 1],
    queryFn: () => getMonthlyBudgetOverview(companyId!, year - 1),
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
  const fixed = mBudget?.fixedCosts ?? 0;
  const variable = mBudget?.variableCosts ?? 0;
  const fixedPct = expense > 0 ? Math.round((fixed / expense) * 100) : 0;
  const prevByMonthNum: Record<number, number> = {};
  prevBudget.forEach((b) => { prevByMonthNum[Number(b.month.slice(5, 7))] = b.expenseTotal || 0; });
  const compareRows = budget.filter((b) => b.month <= month).slice(-6).map((b) => {
    const mn = Number(b.month.slice(5, 7));
    return { monthNum: mn, label: `${mn}월`, cur: b.expenseTotal || 0, prev: prevByMonthNum[mn] ?? null };
  });
  const detailBudget = detailMonth != null ? budget.find((b) => Number(b.month.slice(5, 7)) === detailMonth) : null;

  // 카테고리(고정+변동 합쳐 연간 금액 큰 순 TOP)
  const cats = [...(breakdown?.fixed || []), ...(breakdown?.variable || [])]
    .map((c) => ({ label: c.label, amt: c.amount })).filter((c) => c.amt > 0)
    .sort((a, b) => b.amt - a.amt).slice(0, 7);
  const catMax = Math.max(1, ...cats.map((c) => c.amt));
  // 2026-07-21 QA — 거래 0건 신규회사가 무한 스피너에 갇히던 문제: 빈 데이터를 로딩으로 오판하지 않도록 isLoading 기준으로 변경
  const loading = !companyId || budgetLoading;

  return (
    <>
      <ReportsTabs />
      {loading ? (
        <div className="flex items-center justify-center py-20"><div className="w-8 h-8 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <div className="expense-page-content">
          <IntroCard
            eyebrow="이번 달 비용"
            title={fmt(expense)}
            desc="고정비·변동비 구성과 월별 추세, 항목별 지출은 아래에서 확인하세요."
            callout={{ label: "고정비 비중", value: `${fixedPct}%`, sub: `고정 ${fmt(fixed)} · 변동 ${fmt(variable)}`, tone: "primary" }}
          />

          {/* 좌: 월별 추세(주 보고서) · 우: 고정/변동 구성 + 항목별 구성 */}
          <div className="report-cols">
            <div className="report-col">
              {/* 월별 비용 · 전년 비교 (행 클릭 → 고정/변동 구성 드릴다운) */}
              <MonthlyCompareCard title="월별 비용 · 전년 비교" rows={compareRows} accent="var(--warning)" onRowClick={(mn) => setDetailMonth(mn)} />
            </div>
            <div className="report-col">
              {/* 고정비 · 변동비 구성 */}
              <Section title="고정비 · 변동비" desc="이번 달 지출의 고정/변동 구성 비중">
                <div className="expense-fixed-variable-bar">
                  <div style={{ width: `${fixedPct}%`, background: "var(--primary)" }} title={`고정비 ${fixedPct}%`} />
                  <div style={{ width: `${100 - fixedPct}%`, background: "var(--warning)" }} title={`변동비 ${100 - fixedPct}%`} />
                </div>
                <div className="flex justify-between text-[11px] mt-2">
                  <span className="text-[var(--primary)] font-semibold">고정 {fmt(fixed)} ({fixedPct}%)</span>
                  <span className="text-[var(--warning)] font-semibold">변동 {fmt(variable)} ({100 - fixedPct}%)</span>
                </div>
              </Section>

              {/* 어디에 썼나 — 카테고리 */}
              <Section title="비용 항목별 구성" desc="올해 상위 지출 항목" right={<Link href="/reports/costs" className="text-xs text-[var(--primary)] font-semibold hover:underline no-underline">상세 비용 분석 →</Link>}>
                {cats.length === 0 ? (
                  <div className="text-xs text-[var(--text-dim)] py-6 text-center">분류된 비용 데이터가 없습니다. 거래내역을 분류하면 채워집니다.</div>
                ) : (
                  <div className="expense-category-list">
                    {cats.map((c) => (
                      <div key={c.label} className="expense-category-row">
                        <span className="text-sm text-[var(--text)] w-28 shrink-0 truncate">{c.label}</span>
                        <div className="flex-1 h-2.5 rounded-full bg-[var(--bg-surface)] overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${Math.round((c.amt / catMax) * 100)}%`, background: "var(--warning)" }} />
                        </div>
                        <span className="mono-number text-xs font-semibold text-[var(--text)] w-24 text-right shrink-0">{fmt(c.amt)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Section>
            </div>
          </div>
        </div>
      )}

      {detailMonth != null && companyId && (
        <CellDetail companyId={companyId} year={year} month={detailMonth} rowKey="expenseTotal"
          title="비용" subtitle={`${year}년 ${detailMonth}월 · 고정비·변동비 구성`}
          clientItems={[
            { label: "고정비", amount: Number(detailBudget?.fixedCosts || 0) },
            { label: "변동비", amount: Number(detailBudget?.variableCosts || 0) },
          ].filter((i) => i.amount)}
          onClose={() => setDetailMonth(null)} />
      )}
    </>
  );
}
