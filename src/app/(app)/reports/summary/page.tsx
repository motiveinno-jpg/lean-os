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
  const bannerTone = profit < 0 && runwayTone === "danger" ? "danger" : runwayTone === "danger" ? "danger" : runwayTone === "warning" ? "warning" : "success";
  const TONE_BG: Record<string, string> = { success: "var(--success)", warning: "var(--warning)", danger: "var(--danger)" };

  const toneColor = (t: string) => TONE_BG[t] || "var(--primary)";

  return (
    <div className="space-y-6">
      <ReportsTabs />

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* 한 줄 요약 배너 */}
          <div className="glass-card p-5 flex items-start gap-3">
            <span className="text-xl leading-none mt-0.5">{bannerTone === "success" ? "🟢" : bannerTone === "warning" ? "🟡" : "🔴"}</span>
            <div>
              <div className="text-[15px] font-bold text-[var(--text)] leading-relaxed">{summaryLine}</div>
              {nextVat && vatDday !== null && (
                <div className="text-xs text-[var(--text-muted)] mt-1">
                  다가오는 부가세 {fmt(Math.abs(nextVat.netVAT))} · 납부 D-{Math.max(0, vatDday)} ({nextVat.dueDate})
                </div>
              )}
            </div>
          </div>

          {/* 신호등 3카드 — 순수 글래스 카드(색줄 없음), 신호는 라벨 앞 점 + 큰 숫자 색으로 */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="glass-card p-5 flex flex-col gap-2">
              <span className="text-[13px] font-semibold text-[var(--text-muted)] flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: profit >= 0 ? "var(--success)" : "var(--danger)" }} />
                이번 달 손익 <span className="text-[var(--text-dim)] font-normal">(매출 − 비용)</span>
              </span>
              <span className="text-[26px] leading-8 font-extrabold mono-number" style={{ color: profit >= 0 ? "var(--success)" : "var(--danger)" }}>
                {profit >= 0 ? "+" : "−"}{fmt(Math.abs(profit))}
              </span>
              <Delta cur={profit} prev={lastProfit} />
            </div>
            <div className="glass-card p-5 flex flex-col gap-2">
              <span className="text-[13px] font-semibold text-[var(--text-muted)] flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full shrink-0 bg-[var(--primary)]" />
                통장 잔액 <span className="text-[var(--text-dim)] font-normal">(가용 현금)</span>
              </span>
              <span className="text-[26px] leading-8 font-extrabold mono-number text-[var(--text)]">{fmt(balance)}</span>
              <span className="text-[11px] text-[var(--text-dim)]">월 평균 지출 약 {fmt(burn)}</span>
            </div>
            <div className="glass-card p-5 flex flex-col gap-2">
              <span className="text-[13px] font-semibold text-[var(--text-muted)] flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: toneColor(runwayTone) }} />
                운영 가능 기간 <span className="text-[var(--text-dim)] font-normal">(현재 현금 기준)</span>
              </span>
              <span className="text-[26px] leading-8 font-extrabold mono-number" style={{ color: toneColor(runwayTone) }}>{runwayTxt}</span>
              <span className="text-[11px] text-[var(--text-dim)]">{runwayTone === "danger" ? "자금 계획이 필요합니다" : runwayTone === "warning" ? "여유가 넉넉하진 않습니다" : "당장은 안정적입니다"}</span>
            </div>
          </div>

          {/* 번 돈 / 쓴 돈 / 남은 돈 */}
          <div className="glass-card p-5">
            <div className="text-sm font-bold text-[var(--text)] mb-4">이번 달 손익 요약</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Link href="/reports/revenue" className="stat-tile no-underline hover:border-[var(--primary)] transition">
                <div className="stat-tile-label">매출</div>
                <div className="stat-tile-value mono-number text-[var(--success)]">{fmt(sales)}</div>
                <Delta cur={sales} prev={lastSales} />
              </Link>
              <Link href="/reports/expense" className="stat-tile no-underline hover:border-[var(--primary)] transition">
                <div className="stat-tile-label">비용</div>
                <div className="stat-tile-value mono-number text-[var(--warning)]">{fmt(expense)}</div>
                <Delta cur={expense} prev={lastExpense} invert />
              </Link>
              <div className="stat-tile">
                <div className="stat-tile-label">손익</div>
                <div className="stat-tile-value mono-number" style={{ color: profit >= 0 ? "var(--success)" : "var(--danger)" }}>{profit >= 0 ? "+" : "−"}{fmt(Math.abs(profit))}</div>
                <Delta cur={profit} prev={lastProfit} />
              </div>
            </div>
          </div>

          {/* 주요 예정 항목 */}
          <div className="glass-card p-5">
            <div className="text-sm font-bold text-[var(--text)] mb-3">주요 예정 항목</div>
            <div className="space-y-2">
              {nextVat && vatDday !== null && (
                <Link href="/tax-invoices" className="flex items-center justify-between px-4 py-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] no-underline hover:border-[var(--primary)] transition">
                  <span className="text-sm text-[var(--text)]">🧾 부가세 납부 <span className="text-[var(--text-dim)] text-xs">D-{Math.max(0, vatDday)} ({nextVat.dueDate})</span></span>
                  <span className="mono-number font-bold text-[var(--text)]">{fmt(Math.abs(nextVat.netVAT))}</span>
                </Link>
              )}
              <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)]">
                <span className="text-sm text-[var(--text)]">🔁 월 고정비</span>
                <span className="mono-number font-bold text-[var(--text)]">{fmt(mBudget?.fixedCosts ?? 0)}</span>
              </div>
              {(receivable?.over30 ?? 0) > 0 && (
                <Link href="/partners/ledger" className="flex items-center justify-between px-4 py-3 rounded-xl no-underline transition hover:opacity-90"
                  style={{ background: "color-mix(in srgb, var(--danger) 8%, transparent)", border: "1px solid color-mix(in srgb, var(--danger) 25%, transparent)" }}>
                  <span className="text-sm font-semibold text-[var(--danger)]">💰 30일 이상 미수금 — 회수 필요</span>
                  <span className="mono-number font-bold text-[var(--danger)]">{fmt(receivable!.over30)}</span>
                </Link>
              )}
              {!nextVat && (receivable?.over30 ?? 0) === 0 && (
                <div className="text-xs text-[var(--text-dim)] px-1">당장 예정된 지출·회수 항목이 없습니다.</div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
