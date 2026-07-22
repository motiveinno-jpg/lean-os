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
  const catSum = cats.reduce((s, c) => s + c.amt, 0);

  // 규칙 기반 요약 코멘트 — 경영요약 '이번 달 상태'와 동일 방식(전월·고정비비중·최대항목 조합, LLM 아님)
  const fmtMan = (n: number) => `${Math.round(n / 10000).toLocaleString("ko-KR")}만원`;
  const curMn = Number(month.slice(5, 7));
  const prevMonthKey = curMn === 1 ? `${year - 1}-12` : `${year}-${String(curMn - 1).padStart(2, "0")}`;
  const lastMonthExp = (curMn === 1 ? prevBudget : budget).find((b) => b.month === prevMonthKey)?.expenseTotal ?? 0;
  const momPct = lastMonthExp > 0 ? Math.round(((expense - lastMonthExp) / lastMonthExp) * 100) : null;
  const momTxt = momPct == null ? "지난달 지출이 없어 비교는 어렵지만" : momPct > 0 ? `지난달보다 ${momPct}% 늘었고` : momPct < 0 ? `지난달보다 ${Math.abs(momPct)}% 줄었고` : "지난달과 비슷하고";
  const catTxt = cats[0]?.label ? ` 가장 큰 지출 항목은 '${cats[0].label}'입니다.` : "";
  const expLine = `이번 달 지출은 ${fmtMan(expense)}으로 ${momTxt}, 고정비 비중은 ${fixedPct}%입니다.${catTxt}`;

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
            eyebrow="이번 달 요약"
            title={expLine}
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
              {/* 어디에 썼나 — 카테고리 (비중 %) — 매출 탭의 '거래처별'과 동일 구조 */}
              <Section title="비용 항목별 구성" desc="올해 상위 지출 항목" right={<Link href="/reports/costs" className="text-xs text-[var(--primary)] font-semibold hover:underline no-underline">상세 비용 분석 →</Link>}>
                {cats.length === 0 ? (
                  <div className="text-xs text-[var(--text-dim)] py-6 text-center">분류된 비용 데이터가 없습니다. 거래내역을 분류하면 채워집니다.</div>
                ) : (
                  <>
                    <div className="lp-bar-list">
                      {cats.map((c) => (
                        <div key={c.label} className="lp-bar-row">
                          <span className="lp-bar-name">{c.label}</span>
                          <div className="lp-bar-track"><div className="lp-bar-fill" style={{ width: `${Math.round((c.amt / catMax) * 100)}%`, background: "var(--warning)" }} /></div>
                          <span className="lp-bar-amt mono-number">{fmt(c.amt)}</span>
                          <span className="lp-bar-share mono-number">{catSum > 0 ? Math.round((c.amt / catSum) * 100) : 0}%</span>
                        </div>
                      ))}
                    </div>
                    <div className="lp-bar-foot"><span>상위 {cats.length}개 항목 합계</span><span className="mono-number font-semibold text-[var(--text-muted)]">{fmt(catSum)}</span></div>
                  </>
                )}
              </Section>

              {/* 핵심 지표 — 고정비·변동비 (2 타일) — 매출 탭의 '미수금'과 동일 구조 */}
              <Section title="고정비 · 변동비" desc={`이번 달 지출 구성 · 고정비 비중 ${fixedPct}%`}>
                <div className="lp-tile-grid">
                  <div className="stat-tile">
                    <div className="stat-tile-label">고정비 ({fixedPct}%)</div>
                    <div className="stat-tile-value mono-number" style={{ color: "var(--primary)" }}>{fmt(fixed)}</div>
                  </div>
                  <div className="stat-tile">
                    <div className="stat-tile-label">변동비 ({100 - fixedPct}%)</div>
                    <div className="stat-tile-value mono-number" style={{ color: "var(--warning)" }}>{fmt(variable)}</div>
                  </div>
                </div>
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
