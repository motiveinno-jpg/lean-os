"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

interface UpcomingScheduleCardProps {
  companyId: string;
  windowDays?: number;
}

type ScheduleType = "loan" | "tax" | "contract" | "subscription";

interface ScheduleItem {
  id: string;
  type: ScheduleType;
  title: string;
  date: string; // YYYY-MM-DD
  daysLeft: number;
  amount?: number;
  href: string;
}

const TYPE_META: Record<ScheduleType, { label: string; color: string; bg: string; icon: string }> = {
  loan:         { label: "대출만기",   color: "var(--danger)",   bg: "rgba(239,68,68,0.10)",   icon: "💰" },
  tax:          { label: "세금마감",   color: "var(--warning)",  bg: "rgba(245,158,11,0.10)",  icon: "🧾" },
  contract:     { label: "계약만료",   color: "var(--primary)",  bg: "rgba(99,102,241,0.10)",  icon: "📄" },
  subscription: { label: "구독갱신",   color: "var(--success)",  bg: "rgba(34,197,94,0.10)",   icon: "🔄" },
};

function fmtKR(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e8) return `${(abs / 1e8).toFixed(1)}억`;
  if (abs >= 1e4) return `${Math.round(abs / 1e4)}만`;
  return abs.toLocaleString();
}

function daysBetween(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  return Math.floor(ms / 86400000);
}

function nextOccurrence(today: Date, day: number): Date {
  const y = today.getFullYear();
  const m = today.getMonth();
  let target = new Date(y, m, day);
  if (target < today) target = new Date(y, m + 1, day);
  return target;
}

function fmtDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function buildTaxSchedules(today: Date, windowEnd: Date): ScheduleItem[] {
  const items: ScheduleItem[] = [];

  const vat = nextOccurrence(today, 25);
  if (vat <= windowEnd) {
    items.push({
      id: `vat-${fmtDateKey(vat)}`,
      type: "tax",
      title: "부가세 신고/납부",
      date: fmtDateKey(vat),
      daysLeft: daysBetween(today, vat),
      href: "/tax-invoices",
    });
  }

  const wht = nextOccurrence(today, 10);
  if (wht <= windowEnd) {
    items.push({
      id: `wht-${fmtDateKey(wht)}`,
      type: "tax",
      title: "원천세 납부",
      date: fmtDateKey(wht),
      daysLeft: daysBetween(today, wht),
      href: "/tax-invoices",
    });
  }

  return items;
}

export function UpcomingScheduleCard({ companyId, windowDays = 30 }: UpcomingScheduleCardProps) {
  const [expanded, setExpanded] = useState(false);

  const { data: items = [], isLoading } = useQuery<ScheduleItem[]>({
    queryKey: ["upcoming-schedule", companyId, windowDays],
    queryFn: async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const windowEnd = new Date(today);
      windowEnd.setDate(windowEnd.getDate() + windowDays);
      const windowEndIso = fmtDateKey(windowEnd);

      const db = supabase as any;
      const [loans, docs, vault] = await Promise.all([
        db.from("loans")
          .select("id, name, lender, maturity_date, remaining_balance")
          .eq("company_id", companyId)
          .not("maturity_date", "is", null)
          .lte("maturity_date", windowEndIso),
        db.from("documents")
          .select("id, name, contract_end_date, contract_amount, counterparty")
          .eq("company_id", companyId)
          .not("contract_end_date", "is", null)
          .lte("contract_end_date", windowEndIso),
        db.from("vault_accounts")
          .select("id, service_name, renewal_date, monthly_cost")
          .eq("company_id", companyId)
          .not("renewal_date", "is", null)
          .lte("renewal_date", windowEndIso),
      ]);

      const merged: ScheduleItem[] = [];

      (loans.data || []).forEach((l: any) => {
        const d = new Date(l.maturity_date);
        const dl = daysBetween(today, d);
        if (dl < 0) return;
        merged.push({
          id: `loan-${l.id}`,
          type: "loan",
          title: `${l.lender} ${l.name}`,
          date: l.maturity_date,
          daysLeft: dl,
          amount: Number(l.remaining_balance) || undefined,
          href: "/loans",
        });
      });

      (docs.data || []).forEach((d: any) => {
        const dt = new Date(d.contract_end_date);
        const dl = daysBetween(today, dt);
        if (dl < 0) return;
        merged.push({
          id: `doc-${d.id}`,
          type: "contract",
          title: d.counterparty ? `${d.counterparty} · ${d.name}` : d.name,
          date: d.contract_end_date,
          daysLeft: dl,
          amount: Number(d.contract_amount) || undefined,
          href: "/documents",
        });
      });

      (vault.data || []).forEach((v: any) => {
        const dt = new Date(v.renewal_date);
        const dl = daysBetween(today, dt);
        if (dl < 0) return;
        merged.push({
          id: `vault-${v.id}`,
          type: "subscription",
          title: v.service_name,
          date: v.renewal_date,
          daysLeft: dl,
          amount: Number(v.monthly_cost) || undefined,
          href: "/vault",
        });
      });

      merged.push(...buildTaxSchedules(today, windowEnd));

      merged.sort((a, b) => a.daysLeft - b.daysLeft);
      return merged;
    },
    enabled: !!companyId,
    refetchInterval: 5 * 60_000,
  });

  const visible = expanded ? items : items.slice(0, 5);

  return (
    <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold text-[var(--text)]">이번 달 주요 일정</span>
          <span className="text-[9px] text-[var(--text-dim)]">D-{windowDays} 이내</span>
        </div>
        <span className="text-[10px] mono-number text-[var(--text-muted)]">{items.length}건</span>
      </div>

      {isLoading ? (
        <div className="text-[11px] text-[var(--text-dim)] text-center py-8">불러오는 중…</div>
      ) : items.length === 0 ? (
        <div className="text-[11px] text-[var(--text-dim)] text-center py-8">예정된 일정이 없습니다</div>
      ) : (
        <>
          <ul className="space-y-1.5">
            {visible.map((it) => {
              const meta = TYPE_META[it.type];
              const urgent = it.daysLeft <= 7;
              return (
                <li key={it.id}>
                  <Link
                    href={it.href}
                    className="flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-[var(--bg-surface)] transition group"
                  >
                    <span
                      className="shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold"
                      style={{ background: meta.bg, color: meta.color }}
                    >
                      {meta.label}
                    </span>
                    <span className="flex-1 min-w-0 text-[11px] text-[var(--text)] truncate font-medium">
                      {it.title}
                    </span>
                    {it.amount ? (
                      <span className="text-[10px] mono-number text-[var(--text-muted)] hidden sm:inline">
                        ₩{fmtKR(it.amount)}
                      </span>
                    ) : null}
                    <span
                      className={`shrink-0 text-[10px] mono-number font-bold ${urgent ? "" : "text-[var(--text-muted)]"}`}
                      style={urgent ? { color: meta.color } : undefined}
                    >
                      D-{it.daysLeft}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          {items.length > 5 && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="mt-2 w-full text-[10px] text-[var(--text-muted)] hover:text-[var(--primary)] py-1 transition"
            >
              {expanded ? "접기" : `+${items.length - 5}건 더보기`}
            </button>
          )}
        </>
      )}
    </div>
  );
}
