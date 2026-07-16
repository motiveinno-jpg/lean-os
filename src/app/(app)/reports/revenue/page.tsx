"use client";

// 매출 현황 — "얼마나 벌었나?"에 답하는 대표용 화면(2026-07-08).
//   이번 달 매출 + 지난달 대비 + 월별 추세 + 어디서 벌었나(거래처 TOP) + 아직 못 받은 돈(미수금).
//   소스: cash-budget 월별 매출 + tax_invoices(매출) 집계. /reports/pnl(정식 손익)과 동일 계열.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/queries";
import { getMonthlyBudgetOverview, type MonthlyBudget } from "@/lib/cash-budget";
import { useUser } from "@/components/user-context";
import { AccessDenied } from "@/components/access-denied";
import { ReportsTabs } from "../_components/ReportsTabs";
import { fmt, ymNow, MonthlyCompareCard } from "../_components/kit";
import { CellDetail } from "../flow/_components/CellDetail";
import { IntroCard, Section } from "@/components/report-kit";

const db = supabase as any;

export default function RevenuePage() {
  const { role } = useUser();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const { year, month } = ymNow();
  const [detailMonth, setDetailMonth] = useState<number | null>(null);

  useEffect(() => { getCurrentUser().then((u) => { if (u) setCompanyId(u.company_id); }); }, []);

  const { data: budget = [] } = useQuery<MonthlyBudget[]>({
    queryKey: ["revenue-budget", companyId, year],
    queryFn: () => getMonthlyBudgetOverview(companyId!, year),
    enabled: !!companyId, staleTime: 60_000,
  });
  const { data: prevBudget = [] } = useQuery<MonthlyBudget[]>({
    queryKey: ["revenue-budget-prev", companyId, year - 1],
    queryFn: () => getMonthlyBudgetOverview(companyId!, year - 1),
    enabled: !!companyId, staleTime: 60_000,
  });

  // 올해 매출 세금계산서 — 거래처별 집계 + 미수금
  const { data: salesData } = useQuery({
    queryKey: ["revenue-sales", companyId, year],
    queryFn: async () => {
      const { data } = await db.from("tax_invoices")
        .select("counterparty_name, supply_amount, total_amount, issue_date, status")
        .eq("company_id", companyId).eq("type", "sales")
        .gte("issue_date", `${year}-01-01`).lte("issue_date", `${year}-12-31`);
      const rows = (data || []) as { counterparty_name: string | null; supply_amount: number | null; total_amount: number | null; issue_date: string | null; status: string | null }[];
      // 거래처별 공급가액 합
      const byPartner: Record<string, number> = {};
      for (const r of rows) {
        const k = r.counterparty_name || "(미상)";
        byPartner[k] = (byPartner[k] || 0) + Number(r.supply_amount || 0);
      }
      const topPartners = Object.entries(byPartner).map(([name, amt]) => ({ name, amt })).sort((a, b) => b.amt - a.amt).slice(0, 6);
      // 미수금 (미입금 상태) + 30일 연체
      const unpaid = rows.filter((r) => ["issued", "sent", "pending", "overdue"].includes(r.status || ""));
      const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
      const arTotal = unpaid.reduce((s, r) => s + Number(r.total_amount || 0), 0);
      const arOver30 = unpaid.filter((r) => (r.issue_date || "") < cutoff).reduce((s, r) => s + Number(r.total_amount || 0), 0);
      return { topPartners, arTotal, arOver30 };
    },
    enabled: !!companyId, staleTime: 60_000,
  });

  if (role === "partner" || role === "employee") {
    return <AccessDenied detail="매출 현황은 대표·관리자 전용입니다." />;
  }

  const sales = budget.find((b) => b.month === month)?.salesRevenue ?? 0;
  const prevByMonthNum: Record<number, number> = {};
  prevBudget.forEach((b) => { prevByMonthNum[Number(b.month.slice(5, 7))] = b.salesRevenue || 0; });
  const compareRows = budget.filter((b) => b.month <= month).slice(-6).map((b) => {
    const mn = Number(b.month.slice(5, 7));
    return { monthNum: mn, label: `${mn}월`, cur: b.salesRevenue || 0, prev: prevByMonthNum[mn] ?? null };
  });
  const ytd = budget.filter((b) => b.month <= month).reduce((s, b) => s + (b.salesRevenue || 0), 0);
  const top = salesData?.topPartners || [];
  const topMax = Math.max(1, ...top.map((t) => t.amt));
  const loading = !companyId || budget.length === 0;

  return (
    <>
      <ReportsTabs />
      {loading ? (
        <div className="flex items-center justify-center py-20"><div className="w-8 h-8 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <div className="revenue-page-content">
          <IntroCard
            eyebrow="이번 달 매출"
            title={fmt(sales)}
            desc="세금계산서 공급가액 기준입니다. 월별 추세·전년 비교와 거래처별 구성은 아래에서 확인하세요."
            callout={{ label: `올해 누적 매출 (${year}년 1월~이번 달)`, value: fmt(ytd), tone: "success" }}
            box={(salesData?.arOver30 ?? 0) > 0
              ? { label: "30일 이상 미수금", value: fmt(salesData!.arOver30), sub: "회수 관리가 필요합니다", tone: "danger" }
              : (salesData?.arTotal ?? 0) > 0
                ? { label: "미수금 합계", value: fmt(salesData!.arTotal), sub: "회수 예정", tone: "warning" }
                : undefined}
          />

          {/* 월별 매출 · 전년 비교 (행 클릭 → 거래처별 구성 드릴다운) */}
          <MonthlyCompareCard title="월별 매출 · 전년 비교" rows={compareRows} accent="var(--success)" onRowClick={(mn) => setDetailMonth(mn)} />

          {/* 어디서 벌었나 — 거래처 TOP */}
          <Section title="거래처별 매출" desc="올해 상위 거래처" right={<Link href="/partners" className="text-xs text-[var(--primary)] font-semibold hover:underline no-underline">거래처 관리 →</Link>}>
            {top.length === 0 ? (
              <div className="text-xs text-[var(--text-dim)] py-6 text-center">올해 매출 세금계산서가 없습니다.</div>
            ) : (
              <div className="revenue-top-partners-list">
                {top.map((t) => (
                  <div key={t.name} className="revenue-partner-row">
                    <span className="text-sm text-[var(--text)] w-28 shrink-0 truncate">{t.name}</span>
                    <div className="flex-1 h-2.5 rounded-full bg-[var(--bg-surface)] overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${Math.round((t.amt / topMax) * 100)}%`, background: "var(--success)" }} />
                    </div>
                    <span className="mono-number text-xs font-semibold text-[var(--text)] w-24 text-right shrink-0">{fmt(t.amt)}</span>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* 아직 못 받은 돈 (미수금) */}
          <Section title="미수금" desc="아직 못 받은 돈 (회수 예정)">
            <div className="revenue-ar-summary-grid">
              <div className="revenue-ar-total-tile stat-tile">
                <div className="stat-tile-label">미수금 합계</div>
                <div className="stat-tile-value mono-number text-[var(--text)]">{fmt(salesData?.arTotal ?? 0)}</div>
              </div>
              <Link href="/partners/ledger" className="revenue-ar-over30-tile stat-tile" style={{ borderColor: (salesData?.arOver30 ?? 0) > 0 ? "color-mix(in srgb, var(--danger) 30%, transparent)" : undefined }}>
                <div className="stat-tile-label">30일 이상 경과</div>
                <div className="stat-tile-value mono-number" style={{ color: (salesData?.arOver30 ?? 0) > 0 ? "var(--danger)" : "var(--text)" }}>{fmt(salesData?.arOver30 ?? 0)}</div>
              </Link>
            </div>
            {(salesData?.arOver30 ?? 0) > 0 && (
              <div className="text-[11px] text-[var(--danger)] mt-2">30일 이상 경과한 미수금이 있습니다 — 거래처 원장에서 회수를 관리하세요.</div>
            )}
          </Section>
        </div>
      )}

      {detailMonth != null && companyId && (
        <CellDetail companyId={companyId} year={year} month={detailMonth} rowKey="salesRevenue"
          title="매출" subtitle={`${year}년 ${detailMonth}월 · 거래처별 매출 구성`} clientItems={null}
          onClose={() => setDetailMonth(null)} />
      )}
    </>
  );
}
