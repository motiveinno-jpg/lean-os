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
    <div className="max-w-6xl">
      <div className="mb-8">
        <h1 className="text-2xl font-extrabold text-white">수익 관리</h1>
        <p className="text-sm text-[#64748b] mt-1">결제 내역, MRR, 인보이스</p>
      </div>

      {/* Revenue KPI */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-gradient-to-br from-blue-600 to-blue-800 rounded-2xl p-5 text-white">
          <div className="text-xs font-semibold opacity-70 mb-1">MRR</div>
          <div className="text-2xl font-extrabold">{fmtW(mrr)}</div>
        </div>
        <div className="bg-gradient-to-br from-purple-600 to-purple-800 rounded-2xl p-5 text-white">
          <div className="text-xs font-semibold opacity-70 mb-1">ARR</div>
          <div className="text-2xl font-extrabold">{fmtW(mrr * 12)}</div>
        </div>
        <div className="bg-[#111827] rounded-2xl border border-[#1e293b] p-5">
          <div className="text-xs text-[#64748b] mb-1">누적 매출</div>
          <div className="text-2xl font-extrabold text-emerald-400">{fmtW(totalRevenue)}</div>
        </div>
        <div className="bg-[#111827] rounded-2xl border border-[#1e293b] p-5">
          <div className="text-xs text-[#64748b] mb-1">미수금</div>
          <div className="text-2xl font-extrabold text-amber-400">{fmtW(pendingAmount)}</div>
        </div>
      </div>

      {/* Invoice list */}
      <div className="bg-[#111827] rounded-2xl border border-[#1e293b] overflow-hidden">
        <div className="p-5 border-b border-[#1e293b]">
          <h3 className="font-bold text-white">전체 결제 내역</h3>
        </div>
        {invoices.length === 0 ? (
          <div className="text-center py-16 text-sm text-[#64748b]">결제 내역이 없습니다</div>
        ) : (
          <div className="divide-y divide-[#1e293b]">
            {invoices.map((inv: any) => (
              <div key={inv.id} className="flex items-center justify-between p-4 hover:bg-[#1e293b]/50 transition">
                <div className="flex items-center gap-3">
                  <div className={`w-2.5 h-2.5 rounded-full ${
                    inv.status === "paid" ? "bg-emerald-500" : inv.status === "failed" ? "bg-red-500" : "bg-yellow-500"
                  }`} />
                  <div>
                    <div className="font-semibold text-sm text-white">{inv.companies?.name}</div>
                    <div className="text-xs text-[#64748b]">{inv.invoice_number} · {inv.description || "구독 결제"}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-bold text-sm text-white">₩{(inv.total_amount || 0).toLocaleString()}</div>
                  <div className="text-xs text-[#64748b]">{new Date(inv.created_at).toLocaleDateString("ko-KR")}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
