"use client";

// 실행형 '비용' 탭(선택 돈추적) — 예산(deal.contract_total) + 태깅 비용(기존 비용 소스 재사용).
//   비용 소스는 개요 손익과 동일: 세금계산서(매입)·현금영수증·카드사용·수동전표. deal_id 태그 기준.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

const db = supabase as any;
const won = (n: number | null | undefined) => `${Math.round(Number(n || 0)).toLocaleString("ko-KR")}원`;

export function CostTab({ dealId, deal }: { dealId: string; deal: any }) {
  const budget = Number(deal.contract_total || 0);

  const { data: invoices = [] } = useQuery({
    queryKey: ["delivery-cost-inv", dealId],
    queryFn: async () => {
      const { data } = await db.from("tax_invoices").select("id, issue_date, counterparty_name, supply_amount, total_amount").eq("deal_id", dealId).eq("type", "purchase").neq("status", "void").order("issue_date", { ascending: false });
      return (data || []) as any[];
    },
    enabled: !!dealId,
  });
  const { data: cash = [] } = useQuery({
    queryKey: ["delivery-cost-cash", dealId],
    queryFn: async () => {
      const { data } = await db.from("cash_receipts").select("id, issue_date, counterparty_name, amount, supply_amount").eq("deal_id", dealId).order("issue_date", { ascending: false });
      return (data || []) as any[];
    },
    enabled: !!dealId,
  });
  const { data: cards = [] } = useQuery({
    queryKey: ["delivery-cost-card", dealId],
    queryFn: async () => {
      const { data } = await db.from("card_transactions").select("id, transaction_date, merchant_name, amount, card_name").eq("deal_id", dealId).is("journal_entry_id", null).order("transaction_date", { ascending: false });
      return (data || []) as any[];
    },
    enabled: !!dealId,
  });

  const sumBy = (arr: any[], f: (x: any) => number) => arr.reduce((s, x) => s + (Number(f(x)) || 0), 0);
  const invSum = sumBy(invoices as any[], (i) => i.supply_amount || i.total_amount);
  const cashSum = sumBy(cash as any[], (c) => c.supply_amount || c.amount);
  const cardSum = sumBy(cards as any[], (c) => c.amount);
  const totalCost = invSum + cashSum + cardSum;
  const remaining = budget - totalCost;
  const usePct = budget > 0 ? Math.round((totalCost / budget) * 100) : null;

  const sources = useMemo(() => [
    { key: "invoice", label: "세금계산서(매입)", total: invSum, items: invoices as any[], date: (it: any) => it.issue_date, name: (it: any) => it.counterparty_name, amt: (it: any) => Number(it.supply_amount || it.total_amount || 0) },
    { key: "cash", label: "현금영수증", total: cashSum, items: cash as any[], date: (it: any) => it.issue_date, name: (it: any) => it.counterparty_name || "현금영수증", amt: (it: any) => Number(it.supply_amount || it.amount || 0) },
    { key: "card", label: "카드사용", total: cardSum, items: cards as any[], date: (it: any) => it.transaction_date, name: (it: any) => it.merchant_name || it.card_name || "카드사용", amt: (it: any) => Number(it.amount || 0) },
  ], [invoices, cash, cards, invSum, cashSum, cardSum]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Metric label="예산" value={budget > 0 ? won(budget) : "—"} />
        <Metric label="집행 비용" value={won(totalCost)} hint="태그된 전표·계산서 합계" />
        <Metric label="잔여 예산" value={budget > 0 ? won(remaining) : "—"} accent={remaining < 0 ? "danger" : "primary"} />
        <Metric label="집행률" value={usePct == null ? "—" : `${usePct}%`} accent={usePct != null && usePct > 100 ? "danger" : undefined} />
      </div>

      {budget > 0 && (
        <div className="glass-card p-4 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-[var(--text-muted)]">예산 집행률</span>
            <span className="mono-number text-[var(--text)]">{won(totalCost)} / {won(budget)}</span>
          </div>
          <div className="h-3 rounded-full bg-[var(--bg-surface)] overflow-hidden">
            <div className={`h-full rounded-full ${usePct != null && usePct > 100 ? "bg-red-500" : usePct != null && usePct > 80 ? "bg-amber-500" : "bg-[var(--primary)]"}`} style={{ width: `${Math.min(100, usePct || 0)}%` }} />
          </div>
          {usePct != null && usePct > 100 && <p className="text-[11px] text-red-500">예산을 {usePct - 100}% 초과했습니다.</p>}
        </div>
      )}

      <div className="glass-card overflow-hidden">
        <div className="px-4 py-2.5 border-b border-[var(--border)] bg-[var(--bg-surface)] flex items-center justify-between">
          <span className="text-xs font-bold text-[var(--text-muted)]">집행 비용 (프로젝트에 태그된 내역)</span>
          <span className="text-sm font-bold mono-number text-[var(--text)]">{won(totalCost)}</span>
        </div>
        <div className="divide-y divide-[var(--border)]/40">
          {sources.map((s) => (
            <details key={s.key} className="group">
              <summary className="px-4 py-3 flex items-center gap-2 cursor-pointer hover:bg-[var(--bg-surface)]/50 list-none">
                <span className="text-[var(--text-dim)] text-[10px] group-open:rotate-90 transition-transform">▶</span>
                <span className="text-sm text-[var(--text)] flex-1">{s.label}</span>
                <span className="text-[11px] text-[var(--text-dim)]">{s.items.length}건</span>
                <span className="text-sm font-bold mono-number text-[var(--text)] w-32 text-right">{won(s.total)}</span>
              </summary>
              <div className="px-4 pb-3 pl-9 space-y-0.5">
                {s.items.length === 0 ? (
                  <div className="text-[11px] text-[var(--text-dim)]">태그된 {s.label} 없음 — 각 내역 화면에서 이 프로젝트로 지정하세요.</div>
                ) : s.items.slice(0, 80).map((it: any) => (
                  <div key={it.id} className="flex items-center gap-2 text-xs py-0.5">
                    <span className="text-[var(--text-dim)] mono-number w-[78px] shrink-0">{s.date(it) ? String(s.date(it)).slice(0, 10) : "—"}</span>
                    <span className="text-[var(--text)] flex-1 truncate">{s.name(it) || "—"}</span>
                    <span className="mono-number text-[var(--text-muted)] shrink-0">{won(s.amt(it))}</span>
                  </div>
                ))}
              </div>
            </details>
          ))}
        </div>
      </div>
      <p className="text-[11px] text-[var(--text-dim)]">※ 비용은 각 내역(세금계산서·현금영수증·카드) 화면에서 이 프로젝트로 태그하면 자동 집계됩니다.</p>
    </div>
  );
}

function Metric({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: "primary" | "danger" }) {
  const color = value === "—" ? "text-[var(--text-dim)]" : accent === "danger" ? "text-[var(--danger)]" : accent === "primary" ? "text-[var(--primary)]" : "text-[var(--text)]";
  return (
    <div className="glass-card px-3 py-2.5">
      <div className="text-[11px] text-[var(--text-muted)]">{label}</div>
      <div className={`text-base font-bold mono-number mt-0.5 ${color}`} title={hint}>{value}</div>
    </div>
  );
}
