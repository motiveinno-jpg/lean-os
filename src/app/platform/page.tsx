"use client";

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import Link from "next/link";

const db = supabase as any;

function fmtW(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(1)}억`;
  if (abs >= 1e4) return `${sign}${Math.round(abs / 1e4).toLocaleString()}만`;
  return `${sign}₩${abs.toLocaleString()}`;
}

export default function PlatformOverview() {
  const { data: companies = [] } = useQuery({
    queryKey: ["p-companies"],
    queryFn: async () => {
      const { data } = await db.from("companies").select("*, users(count), subscriptions(*, subscription_plans(*))").order("created_at", { ascending: false });
      return data || [];
    },
  });

  const { data: subscriptions = [] } = useQuery({
    queryKey: ["p-subs"],
    queryFn: async () => {
      const { data } = await db.from("subscriptions").select("*, subscription_plans(*), companies(name)").order("created_at", { ascending: false });
      return data || [];
    },
  });

  const { data: invoices = [] } = useQuery({
    queryKey: ["p-invoices"],
    queryFn: async () => {
      const { data } = await db.from("invoices").select("*, companies(name)").order("created_at", { ascending: false });
      return data || [];
    },
  });

  const { data: users = [] } = useQuery({
    queryKey: ["p-users"],
    queryFn: async () => {
      const { data } = await db.from("users").select("id").order("created_at", { ascending: false });
      return data || [];
    },
  });

  const { data: feedback = [] } = useQuery({
    queryKey: ["p-feedback"],
    queryFn: async () => {
      const { data } = await db.from("feedback").select("id, status, category, created_at").order("created_at", { ascending: false });
      return data || [];
    },
  });

  // OP-A: 24h 에러 수 (error_logs 테이블 — 운영 신호)
  const { data: recentErrors = [] } = useQuery({
    queryKey: ["p-errors-24h"],
    queryFn: async () => {
      const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const { data } = await db.from("error_logs").select("id").gte("created_at", since);
      return data || [];
    },
  });

  const totalCompanies = companies.length;
  const totalUsers = users.length;
  const activeSubs = subscriptions.filter((s: any) => s.status === "active" || s.status === "trialing").length;
  const paidSubs = subscriptions.filter((s: any) => s.status === "active" && s.subscription_plans?.slug !== "free").length;
  const mrr = subscriptions
    .filter((s: any) => s.status === "active")
    .reduce((sum: number, s: any) => {
      const plan = s.subscription_plans;
      if (!plan) return sum;
      return sum + (plan.base_price || 0) + (plan.per_seat_price || 0) * (s.seat_count || 1);
    }, 0);
  const paidInvoices = invoices.filter((i: any) => i.status === "paid");
  const totalRevenue = paidInvoices.reduce((s: number, i: any) => s + (i.total_amount || 0), 0);
  const pendingFeedback = feedback.filter((f: any) => f.status === "pending").length;
  const conversionRate = totalCompanies > 0 ? ((paidSubs / totalCompanies) * 100).toFixed(1) : "0";

  // 이번 달 가입
  const now = new Date();
  const thisMonth = companies.filter((c: any) => {
    const d = new Date(c.created_at);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;

  return (
    <div className="max-w-6xl space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-extrabold text-[var(--text)]">플랫폼 개요</h1>
        <p className="text-sm text-[var(--text-muted)] mt-1">OwnerView SaaS 운영 현황</p>
      </div>

      {/* KPI Row 1 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "총 가입사", value: totalCompanies, sub: `이번 달 +${thisMonth}` },
          { label: "총 사용자", value: totalUsers, sub: `회사당 ${totalCompanies ? (totalUsers / totalCompanies).toFixed(1) : 0}명` },
          { label: "유료 구독", value: paidSubs, sub: `전환율 ${conversionRate}%` },
          { label: "활성 구독", value: activeSubs, sub: "체험+유료 포함" },
        ].map((kpi) => (
          <div key={kpi.label} className="glass-card p-5 flex flex-col gap-3">
            <span className="text-[13px] font-semibold text-[var(--text-muted)]">{kpi.label}</span>
            <div className="flex items-end gap-2">
              <span className="text-[26px] leading-8 font-extrabold mono-number text-[var(--text)]">{kpi.value}</span>
            </div>
            <div className="text-[11px] text-[var(--text-dim)]">{kpi.sub}</div>
          </div>
        ))}
      </div>

      {/* Revenue Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="glass-card p-5 flex flex-col gap-3">
          <span className="text-[13px] font-semibold text-[var(--text-muted)]">MRR (월간 반복 매출)</span>
          <div className="flex items-end gap-2">
            <span className="text-[26px] leading-8 font-extrabold mono-number text-[var(--text)]">{fmtW(mrr)}</span>
          </div>
          <div className="text-[11px] text-[var(--text-dim)]">ARR: {fmtW(mrr * 12)}</div>
        </div>
        <div className="glass-card p-5 flex flex-col gap-3">
          <span className="text-[13px] font-semibold text-[var(--text-muted)]">총 누적 매출</span>
          <div className="flex items-end gap-2">
            <span className="text-[26px] leading-8 font-extrabold mono-number text-[var(--success)]">{fmtW(totalRevenue)}</span>
          </div>
          <div className="text-[11px] text-[var(--text-dim)]">{paidInvoices.length}건 결제</div>
        </div>
        <div className="glass-card p-5 flex flex-col gap-3">
          <span className="text-[13px] font-semibold text-[var(--text-muted)]">미처리 피드백</span>
          <div className="flex items-end gap-2">
            <span className="text-[26px] leading-8 font-extrabold mono-number text-[var(--warning)]">{pendingFeedback}</span>
          </div>
          <div className="text-[11px]">
            <Link href="/platform/feedback" className="text-[var(--primary)] hover:underline">바로가기</Link>
          </div>
        </div>
      </div>

      {/* OP-A: 운영 신호 (24h 에러 + 사고) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="glass-card p-5 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-semibold text-[var(--text-muted)]">최근 24시간 에러</span>
            <span className="badge badge-primary uppercase tracking-wider">운영</span>
          </div>
          <div className={`text-[26px] leading-8 font-extrabold mono-number ${recentErrors.length > 50 ? "text-[var(--danger)]" : recentErrors.length > 10 ? "text-[var(--warning)]" : "text-[var(--success)]"}`}>
            {recentErrors.length}
          </div>
          <div className="text-[11px]">
            <Link href="/platform/errors" className="text-[var(--primary)] hover:underline">상세 해석 보기 →</Link>
          </div>
        </div>
        <div className="glass-card p-5 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-semibold text-[var(--text-muted)]">미해결 사고</span>
            <span className="badge badge-primary uppercase tracking-wider">운영</span>
          </div>
          <div className="text-[26px] leading-8 font-extrabold mono-number text-[var(--text-dim)]">—</div>
          <div className="text-[11px]">
            <Link href="/platform/incidents" className="text-[var(--primary)] hover:underline">사고 기록 →</Link>
          </div>
        </div>
      </div>

      {/* Recent signups */}
      <div className="glass-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-[var(--text)]">최근 가입</h3>
          <Link href="/platform/customers" className="text-xs text-[var(--primary)] hover:underline">전체 보기</Link>
        </div>
        <div className="space-y-2">
          {companies.slice(0, 8).map((c: any) => {
            const sub = c.subscriptions?.[0];
            const plan = sub?.subscription_plans;
            return (
              <div key={c.id} className="flex items-center justify-between p-3 rounded-xl bg-[var(--bg-surface)]/60 hover:bg-[var(--bg-surface)] transition">
                <div>
                  <div className="font-semibold text-sm text-[var(--text)]">{c.name}</div>
                  <div className="text-xs text-[var(--text-dim)]">
                    {new Date(c.created_at).toLocaleDateString("ko-KR")}
                  </div>
                </div>
                <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${
                  plan?.slug === "business" || plan?.slug === "pro" ? "bg-[var(--primary-light)] text-[var(--primary)]" :
                  plan?.slug === "starter" ? "bg-[var(--info-dim)] text-[var(--info)]" :
                  "bg-[var(--bg-surface)] text-[var(--text-muted)]"
                }`}>
                  {plan?.name || c.current_plan || "Free"}
                </span>
              </div>
            );
          })}
          {companies.length === 0 && (
            <div className="text-center py-8 text-sm text-[var(--text-dim)]">아직 가입 고객이 없습니다</div>
          )}
        </div>
      </div>
    </div>
  );
}
