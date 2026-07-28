"use client";
import { kstDateStr } from "@/lib/kst";
import { logRead } from "@/lib/log-read";

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useMemo, useState } from "react";
import { OpsPageHeader, OpsSearch, OpsExportButton, exportCsv } from "../_components/ops-kit";

const db = supabase;

function fmtW(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(1)}억`;
  if (abs >= 1e4) return `${sign}${Math.round(abs / 1e4).toLocaleString()}만`;
  return `${sign}₩${abs.toLocaleString()}`;
}

export default function RevenuePage() {
  const [search, setSearch] = useState("");
  const { data: subscriptions = [] } = useQuery({
    queryKey: ["p-subs-rev"],
    queryFn: async () => {
      const data = logRead('revenue/page:data', await db.from("subscriptions").select("*, subscription_plans(*), companies(name)").order("created_at", { ascending: false }));
      return data || [];
    },
    refetchInterval: 60_000,
  });

  const { data: invoices = [] } = useQuery({
    queryKey: ["p-invoices-rev"],
    queryFn: async () => {
      const data = logRead('revenue/page:data', await db.from("invoices").select("*, companies(name)").order("created_at", { ascending: false }));
      return data || [];
    },
    refetchInterval: 60_000,
  });

  const mrr = subscriptions
    .filter((s: any) => s.status === "active")
    .reduce((sum: number, s: any) => {
      const plan = s.subscription_plans;
      if (!plan) return sum;
      return sum + (plan.base_price || 0) + (plan.per_seat_price || 0) * (s.seat_count || 1);
    }, 0);

  // 회사명·청구서번호 검색 (2026-07-28 전면 정비)
  const shownInvoices = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return invoices;
    return invoices.filter((i: any) =>
      (i.companies?.name || "").toLowerCase().includes(q) ||
      String(i.invoice_number || "").toLowerCase().includes(q));
  }, [invoices, search]);

  const paidInvoices = invoices.filter((i: any) => i.status === "paid");
  const pendingInvoices = invoices.filter((i: any) => i.status === "pending");
  const totalRevenue = paidInvoices.reduce((s: number, i: any) => s + (i.total_amount || 0), 0);
  const pendingAmount = pendingInvoices.reduce((s: number, i: any) => s + (i.total_amount || 0), 0);

  return (
    <div className="max-w-6xl space-y-6">
      <OpsPageHeader title="수익 관리" sub="구독·청구 현황 · 1분마다 자동 갱신">
        <OpsSearch value={search} onChange={setSearch} placeholder="회사명·청구서번호 검색" />
        <OpsExportButton
          disabled={shownInvoices.length === 0}
          onClick={() => exportCsv(shownInvoices.map((i: any) => ({
            회사: i.companies?.name || "", 청구서번호: i.invoice_number || "",
            내용: i.description || "구독 결제", 금액: i.total_amount || 0,
            상태: i.status === "paid" ? "결제완료" : i.status === "failed" ? "실패" : "대기",
            일자: kstDateStr(new Date(i.created_at)),
          })), "결제내역")}
        />
      </OpsPageHeader>

      {/* Revenue KPI */}
      <div className="platform-revenue-kpi-grid">
        <div className="platform-revenue-kpi-card glass-card">
          <span className="text-[13px] font-semibold text-[var(--text-muted)]">MRR</span>
          <span className="text-[26px] leading-8 font-extrabold mono-number text-[var(--primary)]">{fmtW(mrr)}</span>
        </div>
        <div className="platform-revenue-kpi-card glass-card">
          <span className="text-[13px] font-semibold text-[var(--text-muted)]">ARR</span>
          <span className="text-[26px] leading-8 font-extrabold mono-number text-[var(--text)]">{fmtW(mrr * 12)}</span>
        </div>
        <div className="platform-revenue-kpi-card glass-card">
          <span className="text-[13px] font-semibold text-[var(--text-muted)]">누적 매출</span>
          <span className="text-[26px] leading-8 font-extrabold mono-number text-[var(--success)]">{fmtW(totalRevenue)}</span>
        </div>
        <div className="platform-revenue-kpi-card glass-card">
          <span className="text-[13px] font-semibold text-[var(--text-muted)]">미수금</span>
          <span className="text-[26px] leading-8 font-extrabold mono-number text-[var(--warning)]">{fmtW(pendingAmount)}</span>
        </div>
      </div>

      {/* Invoice list */}
      <div className="platform-revenue-invoice-list glass-card">
        <div className="p-5 border-b border-[var(--border)] flex items-center justify-between">
          <h3 className="text-sm font-bold text-[var(--text)]">전체 결제 내역 <span className="text-[var(--text-dim)] font-normal">{shownInvoices.length}건</span></h3>
        </div>
        {shownInvoices.length === 0 ? (
          <div className="text-center py-16 text-sm text-[var(--text-dim)]">결제 내역이 없습니다</div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {shownInvoices.map((inv: any) => (
              <div key={inv.id} className="platform-revenue-invoice-row">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`shrink-0 w-2.5 h-2.5 rounded-full ${
                    inv.status === "paid" ? "bg-[var(--success)]" : inv.status === "failed" ? "bg-[var(--danger)]" : "bg-[var(--warning)]"
                  }`} />
                  <div className="min-w-0">
                    <div className="font-semibold text-sm text-[var(--text)] truncate">{inv.companies?.name || "—"}</div>
                    <div className="text-xs text-[var(--text-dim)] truncate">{inv.invoice_number} · {inv.description || "구독 결제"}</div>
                  </div>
                </div>
                <div className="text-right shrink-0 pl-3">
                  <div className="font-bold text-sm mono-number text-[var(--text)]">₩{(inv.total_amount || 0).toLocaleString()}</div>
                  <div className="text-xs text-[var(--text-dim)]">{kstDateStr(new Date(inv.created_at))}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
