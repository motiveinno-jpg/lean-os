"use client";

// 나갈 돈 — "앞으로 낼 돈은?"에 답하는 대표용 화면(2026-07-08).
//   세금(부가세)·대출 상환·매달 고정비·미지급금 (매입)을 모아, 다음 30일 예상 지출과
//   통장으로 감당되는지 신호로. 읽기 전용 소스만(스냅샷 쓰기 부수효과 없는 헬퍼).

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { getCurrentUser, getCashPulseData } from "@/lib/queries";
import { buildCashPulse } from "@/lib/cash-pulse";
import { getMonthlyBudgetOverview, getLoanStatuses, type MonthlyBudget, type LoanStatus } from "@/lib/cash-budget";
import { getVATPreview, type VATPreview } from "@/lib/tax-invoice";
import { useUser } from "@/components/user-context";
import { AccessDenied } from "@/components/access-denied";
import { ReportsTabs } from "../_components/ReportsTabs";
import { fmt, ymNow } from "../_components/kit";

const db = supabase as any;
function daysUntil(dateStr: string) { return Math.ceil((new Date(dateStr + "T00:00:00").getTime() - Date.now()) / 864e5); }

export default function UpcomingPage() {
  const { role } = useUser();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const { year, month } = ymNow();

  useEffect(() => { getCurrentUser().then((u) => { if (u) { setCompanyId(u.company_id); setUserId(u.id); } }); }, []);

  const { data: pulse } = useQuery({
    queryKey: ["upcoming-pulse", companyId, userId],
    queryFn: async () => { const raw = await getCashPulseData(companyId!, userId || undefined); return raw ? buildCashPulse(raw) : null; },
    enabled: !!companyId, staleTime: 60_000,
  });
  const { data: budget = [] } = useQuery<MonthlyBudget[]>({
    queryKey: ["upcoming-budget", companyId, year], queryFn: () => getMonthlyBudgetOverview(companyId!, year), enabled: !!companyId, staleTime: 60_000,
  });
  const { data: vat = [] } = useQuery<VATPreview[]>({
    queryKey: ["upcoming-vat", companyId, year], queryFn: () => getVATPreview(companyId!, year), enabled: !!companyId, staleTime: 60_000,
  });
  const { data: loans = [] } = useQuery<LoanStatus[]>({
    queryKey: ["upcoming-loans", companyId], queryFn: () => getLoanStatuses(companyId!), enabled: !!companyId, staleTime: 60_000,
  });
  const { data: apTotal = 0 } = useQuery<number>({
    queryKey: ["upcoming-ap", companyId],
    queryFn: async () => {
      const { data } = await db.from("tax_invoices").select("total_amount").eq("company_id", companyId)
        .eq("type", "purchase").in("status", ["issued", "sent", "pending", "overdue"]);
      return ((data || []) as { total_amount: number | null }[]).reduce((s, r) => s + Number(r.total_amount || 0), 0);
    },
    enabled: !!companyId, staleTime: 60_000,
  });

  if (role === "partner" || role === "employee") {
    return <AccessDenied detail="나갈 돈은 대표·관리자 전용입니다." />;
  }

  const today = new Date().toISOString().slice(0, 10);
  const fixedCosts = budget.find((b) => b.month === month)?.fixedCosts ?? 0;
  const loanMonthly = loans.filter((l) => l.repaymentType !== "bullet").reduce((s, l) => s + Number(l.monthlyPayment || 0), 0);
  const bulletSoon = loans.filter((l) => l.repaymentType === "bullet" && l.maturityDate >= today && daysUntil(l.maturityDate) <= 90);
  const nextVat = vat.filter((v) => v.dueDate >= today && Math.abs(v.netVAT) > 0).sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
  const vatWithin30 = nextVat && daysUntil(nextVat.dueDate) <= 30 ? Math.abs(nextVat.netVAT) : 0;

  const next30 = fixedCosts + loanMonthly + vatWithin30;
  const balance = pulse?.currentBalance ?? 0;
  const covered = balance >= next30;
  const loading = !companyId || !pulse || budget.length === 0;

  // 항목 리스트 구성
  const items: { icon: string; title: string; note: string; amount: number; danger?: boolean; href?: string }[] = [];
  if (nextVat) items.push({ icon: "🧾", title: "부가세 납부", note: `D-${Math.max(0, daysUntil(nextVat.dueDate))} · ${nextVat.dueDate}`, amount: Math.abs(nextVat.netVAT), href: "/tax-invoices" });
  if (loanMonthly > 0) items.push({ icon: "🏦", title: "대출 상환 (월 상환)", note: `${loans.filter((l) => l.repaymentType !== "bullet").length}건 원리금`, amount: loanMonthly, href: "/loans" });
  bulletSoon.forEach((l) => items.push({ icon: "🏦", title: `${l.name} 만기 일시상환`, note: `D-${Math.max(0, daysUntil(l.maturityDate))} · ${l.maturityDate}`, amount: l.remainingAmount, danger: true, href: "/loans" }));
  if (fixedCosts > 0) items.push({ icon: "🔁", title: "월 고정비", note: "임대·구독·정기결제 등", amount: fixedCosts, href: "/payments" });
  if (apTotal > 0) items.push({ icon: "💳", title: "미지급금 (매입)", note: "매입 세금계산서 미결제", amount: apTotal, href: "/tax-invoices" });

  return (
    <div className="space-y-6">
      <ReportsTabs />
      {loading ? (
        <div className="flex items-center justify-center py-20"><div className="w-8 h-8 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <>
          {/* 다음 30일 예상 지출 + 감당 신호 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="glass-card p-5 flex flex-col gap-2">
              <span className="text-[13px] font-semibold text-[var(--text-muted)] flex items-center gap-1.5"><span className="w-2 h-2 rounded-full shrink-0 bg-[var(--warning)]" />30일 내 예정 지출</span>
              <span className="text-[28px] leading-9 font-extrabold mono-number text-[var(--warning)]">{fmt(next30)}</span>
              <span className="text-[11px] text-[var(--text-dim)]">고정비 + 대출 매달 상환{vatWithin30 ? " + 부가세" : ""}</span>
            </div>
            <div className="glass-card p-5 flex flex-col gap-2">
              <span className="text-[13px] font-semibold text-[var(--text-muted)] flex items-center gap-1.5"><span className="w-2 h-2 rounded-full shrink-0" style={{ background: covered ? "var(--success)" : "var(--danger)" }} />가용 현금 충당 여부</span>
              <span className="text-[22px] leading-8 font-extrabold" style={{ color: covered ? "var(--success)" : "var(--danger)" }}>{covered ? "충당 가능 🟢" : "부족 우려 🔴"}</span>
              <span className="text-[11px] text-[var(--text-dim)]">가용 현금 {fmt(balance)} − 예정 지출 {fmt(next30)} = <b style={{ color: covered ? "var(--success)" : "var(--danger)" }}>{fmt(balance - next30)}</b></span>
            </div>
          </div>

          {/* 앞으로 나갈 돈 목록 */}
          <div className="glass-card p-5">
            <div className="text-sm font-bold text-[var(--text)] mb-3">예정 지출 항목</div>
            {items.length === 0 ? (
              <div className="text-xs text-[var(--text-dim)] py-6 text-center">예정된 세금·대출·고정 지출이 없습니다.</div>
            ) : (
              <div className="space-y-2">
                {items.map((it, i) => (
                  <Link key={i} href={it.href || "#"} className="flex items-center justify-between px-4 py-3 rounded-xl no-underline transition hover:border-[var(--primary)]"
                    style={{ background: it.danger ? "color-mix(in srgb, var(--danger) 8%, transparent)" : "var(--bg-surface)", border: `1px solid ${it.danger ? "color-mix(in srgb, var(--danger) 25%, transparent)" : "var(--border)"}` }}>
                    <span className={`text-sm ${it.danger ? "font-semibold text-[var(--danger)]" : "text-[var(--text)]"}`}>{it.icon} {it.title} <span className="text-[var(--text-dim)] text-xs font-normal ml-1">{it.note}</span></span>
                    <span className="mono-number font-bold shrink-0" style={{ color: it.danger ? "var(--danger)" : "var(--text)" }}>{fmt(it.amount)}</span>
                  </Link>
                ))}
              </div>
            )}
            <div className="text-[11px] text-[var(--text-dim)] mt-3">※ 부가세·대출·고정비는 예정 기준입니다. 실제 납부일은 홈택스·은행 일정을 확인하세요.</div>
          </div>
        </>
      )}
    </div>
  );
}
