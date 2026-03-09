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
    <div className="max-w-6xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-extrabold text-white">플랫폼 개요</h1>
        <p className="text-sm text-[#64748b] mt-1">OwnerView SaaS 운영 현황</p>
      </div>

      {/* KPI Row 1 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: "총 가입사", value: totalCompanies, sub: `이번 달 +${thisMonth}`, color: "from-blue-600 to-blue-800" },
          { label: "총 사용자", value: totalUsers, sub: `회사당 ${totalCompanies ? (totalUsers / totalCompanies).toFixed(1) : 0}명`, color: "from-purple-600 to-purple-800" },
          { label: "유료 구독", value: paidSubs, sub: `전환율 ${conversionRate}%`, color: "from-emerald-600 to-emerald-800" },
          { label: "활성 구독", value: activeSubs, sub: "체험+유료 포함", color: "from-amber-600 to-amber-800" },
        ].map((kpi) => (
          <div key={kpi.label} className={`bg-gradient-to-br ${kpi.color} rounded-2xl p-5 text-white`}>
            <div className="text-xs font-semibold opacity-70 mb-2">{kpi.label}</div>
            <div className="text-3xl font-extrabold">{kpi.value}</div>
            <div className="text-[11px] opacity-60 mt-1">{kpi.sub}</div>
          </div>
        ))}
      </div>

      {/* Revenue Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-[#111827] rounded-2xl border border-[#1e293b] p-6">
          <div className="text-xs text-[#64748b] mb-1">MRR (월간 반복 매출)</div>
          <div className="text-3xl font-extrabold text-white">{fmtW(mrr)}</div>
          <div className="text-xs text-[#64748b] mt-1">ARR: {fmtW(mrr * 12)}</div>
        </div>
        <div className="bg-[#111827] rounded-2xl border border-[#1e293b] p-6">
          <div className="text-xs text-[#64748b] mb-1">총 누적 매출</div>
          <div className="text-3xl font-extrabold text-emerald-400">{fmtW(totalRevenue)}</div>
          <div className="text-xs text-[#64748b] mt-1">{paidInvoices.length}건 결제</div>
        </div>
        <div className="bg-[#111827] rounded-2xl border border-[#1e293b] p-6">
          <div className="text-xs text-[#64748b] mb-1">미처리 피드백</div>
          <div className="text-3xl font-extrabold text-amber-400">{pendingFeedback}</div>
          <div className="text-xs text-[#64748b] mt-1">
            <Link href="/platform/feedback" className="text-blue-400 hover:underline">바로가기</Link>
          </div>
        </div>
      </div>

      {/* Recent signups */}
      <div className="bg-[#111827] rounded-2xl border border-[#1e293b] p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-white">최근 가입</h3>
          <Link href="/platform/customers" className="text-xs text-blue-400 hover:underline">전체 보기</Link>
        </div>
        <div className="space-y-2">
          {companies.slice(0, 8).map((c: any) => {
            const sub = c.subscriptions?.[0];
            const plan = sub?.subscription_plans;
            return (
              <div key={c.id} className="flex items-center justify-between p-3 rounded-xl bg-[#0b0f1a] hover:bg-[#1e293b] transition">
                <div>
                  <div className="font-semibold text-sm text-white">{c.name}</div>
                  <div className="text-xs text-[#64748b]">
                    {new Date(c.created_at).toLocaleDateString("ko-KR")}
                  </div>
                </div>
                <span className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${
                  plan?.slug === "business" || plan?.slug === "pro" ? "bg-purple-500/20 text-purple-400" :
                  plan?.slug === "starter" ? "bg-blue-500/20 text-blue-400" :
                  "bg-[#1e293b] text-[#64748b]"
                }`}>
                  {plan?.name || c.current_plan || "Free"}
                </span>
              </div>
            );
          })}
          {companies.length === 0 && (
            <div className="text-center py-8 text-sm text-[#64748b]">아직 가입 고객이 없습니다</div>
          )}
        </div>
      </div>
    </div>
  );
}
