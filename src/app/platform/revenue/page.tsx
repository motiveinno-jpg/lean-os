"use client";

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

const db = supabase as any;

function fmtW(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(1)}억`;
  if (abs >= 1e4) return `${sign}${Math.round(abs / 1e4).toLocaleString()}만`;
  return `${sign}₩${abs.toLocaleString()}`;
}

export default function RevenuePage() {
  const { data: subscriptions = [] } = useQuery({
    queryKey: ["p-subs-rev"],
    queryFn: async () => {
      const { data } = await db.from("subscriptions").select("*, subscription_plans(*), companies(name)").order("created_at", { ascending: false });
      return data || [];
    },
  });

  const { data: invoices = [] } = useQuery({
    queryKey: ["p-invoices-rev"],
    queryFn: async () => {
      const { data } = await db.from("invoices").select("*, companies(name)").order("created_at", { ascending: false });
      return data || [];
    },
  });

  const mrr = subscriptions
    .filter((s: any) => s.status === "active")
    .reduce((sum: number, s: any) => {
      const plan = s.subscription_plans;
      if (!plan) return sum;
      return sum + (plan.base_price || 0) + (plan.per_seat_price || 0) * (s.seat_count || 1);
    }, 0);

  const paidInvoices = invoices.filter((i: any) => i.status === "paid");
  const pendingInvoices = invoices.filter((i: any) => i.status === "pending");
  const totalRevenue = paidInvoices.reduce((s: number, i: any) => s + (i.total_amount || 0), 0);
  const pendingAmount = pendingInvoices.reduce((s: number, i: any) => s + (i.total_amount || 0), 0);

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-extrabold text-[var(--text)]">수익 관리</h1>
      </div>

      {/* Revenue KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="glass-card p-5 flex flex-col gap-3">
          <span className="text-[13px] font-semibold text-[var(--text-muted)]">MRR</span>
          <span className="text-[26px] leading-8 font-extrabold mono-number text-[var(--primary)]">{fmtW(mrr)}</span>
        </div>
        <div className="glass-card p-5 flex flex-col gap-3">
          <span className="text-[13px] font-semibold text-[var(--text-muted)]">ARR</span>
          <span className="text-[26px] leading-8 font-extrabold mono-number text-[var(--text)]">{fmtW(mrr * 12)}</span>
        </div>
        <div className="glass-card p-5 flex flex-col gap-3">
          <span className="text-[13px] font-semibold text-[var(--text-muted)]">누적 매출</span>
          <span className="text-[26px] leading-8 font-extrabold mono-number text-[var(--success)]">{fmtW(totalRevenue)}</span>
        </div>
        <div className="glass-card p-5 flex flex-col gap-3">
          <span className="text-[13px] font-semibold text-[var(--text-muted)]">미수금</span>
          <span className="text-[26px] leading-8 font-extrabold mono-number text-[var(--warning)]">{fmtW(pendingAmount)}</span>
        </div>
      </div>

      {/* Invoice list */}
      <div className="glass-card overflow-hidden">
        <div className="p-5 border-b border-[var(--border)] flex items-center justify-between">
          <h3 className="text-sm font-bold text-[var(--text)]">전체 결제 내역</h3>
        </div>
        {invoices.length === 0 ? (
          <div className="text-center py-16 text-sm text-[var(--text-dim)]">결제 내역이 없습니다</div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {invoices.map((inv: any) => (
              <div key={inv.id} className="flex items-center justify-between p-4 hover:bg-[var(--bg-surface)]/60 transition">
                <div className="flex items-center gap-3">
                  <div className={`w-2.5 h-2.5 rounded-full ${
                    inv.status === "paid" ? "bg-[var(--success)]" : inv.status === "failed" ? "bg-[var(--danger)]" : "bg-[var(--warning)]"
                  }`} />
                  <div>
                    <div className="font-semibold text-sm text-[var(--text)]">{inv.companies?.name}</div>
                    <div className="text-xs text-[var(--text-dim)]">{inv.invoice_number} · {inv.description || "구독 결제"}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-bold text-sm mono-number text-[var(--text)]">₩{(inv.total_amount || 0).toLocaleString()}</div>
                  <div className="text-xs text-[var(--text-dim)]">{new Date(inv.created_at).toLocaleDateString("ko-KR")}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
