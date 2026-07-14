"use client";

// 경영 요약 — "지금 우리 회사 괜찮나?"에 한 화면으로 답하는 대표용 진입 화면(2026-07-08).
//   회계 용어 없이: 규칙 기반 한 줄 요약 + 신호등 3카드(이번 달 손익·통장 잔액·버티는 기간)
//   + 번 돈/쓴 돈/남은 돈 요약 + 주요 예정 항목. 기존 계산(cash-pulse·budget·VAT·미수금) 재조합.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { getCurrentUser, getCashPulseData } from "@/lib/queries";
import { buildCashPulse } from "@/lib/cash-pulse";
import { getMonthlyBudgetOverview, type MonthlyBudget } from "@/lib/cash-budget";
import { getVATPreview, type VATPreview } from "@/lib/tax-invoice";
import { calcRunwayMonths, getRunwayLevel } from "@/lib/engines";
import { useUser } from "@/components/user-context";
import { AccessDenied } from "@/components/access-denied";
import { ReportsTabs } from "../_components/ReportsTabs";
import { ReportShell, IntroCard, StatCard, Section } from "@/components/report-kit";

const db = supabase as any;
const fmt = (n: number) => `₩${Math.round(n).toLocaleString("ko-KR")}`;
const fmtMan = (n: number) => `${Math.round(n / 10000).toLocaleString("ko-KR")}만원`;

function ymNow() {
  const d = new Date();
  return { year: d.getFullYear(), month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}` };
}
function prevMonthStr(month: string) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function daysUntil(dateStr: string) {
  const t = new Date(dateStr + "T00:00:00").getTime();
  return Math.ceil((t - Date.now()) / (24 * 3600 * 1000));
}

// 지난달 대비 화살표
function Delta({ cur, prev, invert }: { cur: number; prev: number; invert?: boolean }) {
  if (!prev) return null;
  const diff = cur - prev;
  if (diff === 0) return <span className="text-[11px] text-[var(--text-dim)]">지난달과 같음</span>;
  const up = diff > 0;
  const good = invert ? !up : up;
  const pct = Math.abs(Math.round((diff / Math.abs(prev)) * 100));
  return (
    <span className={`text-[11px] font-semibold ${good ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>
      {up ? "▲" : "▼"} 지난달 대비 {pct}%
    </span>
  );
}

export default function ManagementSummaryPage() {
  const { role } = useUser();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const { year, month } = ymNow();
  const lastMonth = prevMonthStr(month);

  useEffect(() => {
    getCurrentUser().then((u) => { if (u) { setCompanyId(u.company_id); setUserId(u.id); } });
  }, []);

  const { data: pulse } = useQuery({
    queryKey: ["summary-pulse", companyId, userId],
    queryFn: async () => {
      const raw = await getCashPulseData(companyId!, userId || undefined);
      return raw ? buildCashPulse(raw) : null;
    },
    enabled: !!companyId,
    staleTime: 60_000,
  });
  const { data: budget = [] } = useQuery<MonthlyBudget[]>({
    queryKey: ["summary-budget", companyId, year],
    queryFn: () => getMonthlyBudgetOverview(companyId!, year),
    enabled: !!companyId,
    staleTime: 60_000,
  });
  const { data: vat = [] } = useQuery<VATPreview[]>({
    queryKey: ["summary-vat", companyId, year],
    queryFn: () => getVATPreview(companyId!, year),
    enabled: !!companyId,
    staleTime: 60_000,
  });
  const { data: receivable } = useQuery({
    queryKey: ["summary-receivable", companyId],
    queryFn: async () => {
      const { data } = await db.from("tax_invoices")
        .select("total_amount, issue_date").eq("company_id", companyId)
        .eq("type", "sales").in("status", ["issued", "sent", "pending", "overdue"]);
      const rows = (data || []) as { total_amount: number | null; issue_date: string | null }[];
      const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
      const total = rows.reduce((s, r) => s + Number(r.total_amount || 0), 0);
      const over30 = rows.filter((r) => (r.issue_date || "") < cutoff).reduce((s, r) => s + Number(r.total_amount || 0), 0);
      return { total, over30 };
    },
    enabled: !!companyId,
    staleTime: 60_000,
  });

  if (role === "partner" || role === "employee") {
    return <AccessDenied detail="경영 요약은 대표·관리자 전용입니다." />;
  }

  const mBudget = budget.find((b) => b.month === month);
  const lBudget = budget.find((b) => b.month === lastMonth);
  const sales = mBudget?.salesRevenue ?? 0;
  const expense = mBudget?.expenseTotal ?? 0;
  const profit = sales - expense;
  const lastSales = lBudget?.salesRevenue ?? 0;
  const lastExpense = lBudget?.expenseTotal ?? 0;
  const lastProfit = lastSales - lastExpense;

  const balance = pulse?.currentBalance ?? 0;
  const burn = pulse?.monthlyBurn ?? 0;
  const runway = calcRunwayMonths(balance, 0, 0, burn);
  const runwayLevel = getRunwayLevel(runway);
  const runwayTone = runwayLevel === "CRITICAL" || runwayLevel === "DANGER" ? "danger" : runwayLevel === "WARNING" ? "warning" : "success";
  const runwayTxt = runway >= 999 ? "무기한" : `약 ${runway.toFixed(1)}개월`;

  // 다가오는 부가세(가장 가까운 미래 납부, 금액>0)
  const today = new Date().toISOString().slice(0, 10);
  const nextVat = vat.filter((v) => v.dueDate >= today && Math.abs(v.netVAT) > 0).sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
  const vatDday = nextVat ? daysUntil(nextVat.dueDate) : null;

  const loading = !companyId || !pulse || budget.length === 0;

  // 규칙 기반 한 줄 요약
  const profitTxt = profit >= 0 ? `이번 달 ${fmtMan(profit)} 흑자` : `이번 달 ${fmtMan(-profit)} 적자`;
  const summaryLine = `${profitTxt}, 통장 잔액 ${fmtMan(balance)} — 현재 지출 속도라면 ${runwayTxt} 운영 가능합니다.`;

  // 최근 6개월 손익 미니 추이
  const recent = budget.slice(-6).map((b) => ({ m: b.month.slice(5), profit: (b.salesRevenue ?? 0) - (b.expenseTotal ?? 0) }));
  const maxAbs = Math.max(1, ...recent.map((r) => Math.abs(r.profit)));

  return (
    <ReportShell>
      <ReportsTabs />

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-5 mt-1">
          <IntroCard
            eyebrow="이번 달 상태"
            title={summaryLine}
            desc="아래 지표는 통장·세금계산서·예산 데이터를 규칙 기반으로 재조합해 자동 계산됩니다."
            callout={{
              label: "운영 가능 기간 (현재 현금 기준)",
              value: runwayTxt,
              sub: runwayTone === "danger" ? "자금 계획이 필요합니다" : runwayTone === "warning" ? "여유가 넉넉하진 않습니다" : "당장은 안정적입니다",
              tone: runwayTone,
            }}
            box={nextVat && vatDday !== null ? { label: `다가오는 부가세 · D-${Math.max(0, vatDday)}`, value: fmt(Math.abs(nextVat.netVAT)), sub: nextVat.dueDate, tone: "warning" } : undefined}
          />

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="이번 달 손익" value={`${profit >= 0 ? "+" : "−"}${fmt(Math.abs(profit))}`} caption="매출 − 비용" tone={profit >= 0 ? "success" : "danger"} icon="📊" />
            <StatCard label="이번 달 매출" value={fmt(sales)} caption="세금계산서 기준" tone="success" icon="💰" href="/reports/revenue" />
            <StatCard label="이번 달 비용" value={fmt(expense)} caption="지출 합계" tone="warning" icon="⚡" href="/reports/expense" />
            <StatCard label="통장 잔액" value={fmt(balance)} caption={`월 평균 지출 ${fmtMan(burn)}`} tone="primary" icon="🏦" />
          </div>

          <div className="grid gap-5 lg:grid-cols-3">
            <Section title="이번 달 손익 요약" desc="매출에서 비용을 뺀 이번 달 손익입니다." className="lg:col-span-2">
              <div className="grid grid-cols-3 gap-3 mb-5">
                {[
                  { l: "매출", v: fmt(sales), c: "var(--success)", cur: sales, prev: lastSales, invert: false, href: "/reports/revenue" },
                  { l: "비용", v: fmt(expense), c: "var(--warning)", cur: expense, prev: lastExpense, invert: true, href: "/reports/expense" },
                  { l: "손익", v: `${profit >= 0 ? "+" : "−"}${fmt(Math.abs(profit))}`, c: profit >= 0 ? "var(--success)" : "var(--danger)", cur: profit, prev: lastProfit, invert: false, href: null },
                ].map((x) => {
                  const inner = (
                    <>
                      <div className="text-[11px] text-[var(--text-muted)]">{x.l}</div>
                      <div className="text-lg font-extrabold mono-number mt-0.5" style={{ color: x.c }}>{x.v}</div>
                      <div className="mt-0.5"><Delta cur={x.cur} prev={x.prev} invert={x.invert} /></div>
                    </>
                  );
                  return x.href
                    ? <Link key={x.l} href={x.href} className="rounded-xl bg-[var(--bg-surface)] p-3 block no-underline hover:ring-1 hover:ring-[var(--primary)]/30 transition">{inner}</Link>
                    : <div key={x.l} className="rounded-xl bg-[var(--bg-surface)] p-3">{inner}</div>;
                })}
              </div>
              {recent.length > 1 && (
                <div>
                  <div className="text-[11px] text-[var(--text-dim)] mb-2">최근 손익 추이</div>
                  <div className="flex items-end gap-2">
                    {recent.map((r, i) => (
                      <div key={i} className="flex-1 flex flex-col items-center gap-1">
                        <div className="w-full flex items-end justify-center" style={{ height: 48 }}>
                          <div className="w-6 rounded-t" style={{ height: `${Math.max(4, (Math.abs(r.profit) / maxAbs) * 44)}px`, background: r.profit >= 0 ? "var(--success)" : "var(--danger)" }} title={fmt(r.profit)} />
                        </div>
                        <span className="text-[9px] text-[var(--text-dim)] mono-number">{r.m}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Section>

            <Section title="주요 예정 항목" desc="곧 나갈 돈·받을 돈을 미리 챙깁니다.">
              <div className="space-y-2">
                {nextVat && vatDday !== null && (
                  <Link href="/tax-invoices" className="flex items-center justify-between px-3.5 py-3 rounded-xl bg-[var(--bg-surface)] no-underline hover:ring-1 hover:ring-[var(--primary)]/30 transition">
                    <span className="text-sm text-[var(--text)]">🧾 부가세 납부 <span className="text-[var(--text-dim)] text-xs">D-{Math.max(0, vatDday)}</span></span>
                    <span className="mono-number font-bold text-[var(--text)]">{fmt(Math.abs(nextVat.netVAT))}</span>
                  </Link>
                )}
                <div className="flex items-center justify-between px-3.5 py-3 rounded-xl bg-[var(--bg-surface)]">
                  <span className="text-sm text-[var(--text)]">🔁 월 고정비</span>
                  <span className="mono-number font-bold text-[var(--text)]">{fmt(mBudget?.fixedCosts ?? 0)}</span>
                </div>
                {(receivable?.over30 ?? 0) > 0 && (
                  <Link href="/partners/ledger" className="flex items-center justify-between px-3.5 py-3 rounded-xl no-underline transition hover:opacity-90"
                    style={{ background: "color-mix(in srgb, var(--danger) 8%, transparent)" }}>
                    <span className="text-sm font-semibold text-[var(--danger)]">💰 30일+ 미수금</span>
                    <span className="mono-number font-bold text-[var(--danger)]">{fmt(receivable!.over30)}</span>
                  </Link>
                )}
                {!nextVat && (receivable?.over30 ?? 0) === 0 && (
                  <div className="text-xs text-[var(--text-dim)] px-1 py-2">당장 예정된 지출·회수 항목이 없습니다.</div>
                )}
              </div>
            </Section>
          </div>
        </div>
      )}
    </ReportShell>
  );
}
