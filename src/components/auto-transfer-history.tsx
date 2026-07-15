"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { TileIcon } from "@/components/ui/icon-tile";
import { getBankTransactions } from "@/lib/queries";

interface Props {
  companyId: string;
  maxItems?: number;
}

function fmtKRW(n: number): string {
  return n.toLocaleString("ko-KR");
}

function startOfMonth(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function endOfMonth(d: Date): string {
  const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  next.setDate(next.getDate() - 1);
  return next.toISOString().slice(0, 10);
}

// 통장에서 자동이체(고정지출)로 연결·표시된 실제 출금 내역 — 이번달
export function AutoTransferHistoryCard({ companyId, maxItems = 8 }: Props) {
  const now = new Date();
  const monthLabel = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const dateFrom = startOfMonth(now);
  const dateTo = endOfMonth(now);

  const { data: rows = [] } = useQuery({
    queryKey: ["auto-transfer-history", companyId, monthLabel],
    queryFn: () => getBankTransactions(companyId, { dateFrom, dateTo, type: "expense" }),
    enabled: !!companyId,
    staleTime: 30_000,
  });

  const items = useMemo(() => {
    // 2026-05-22 자동이체 내역 = is_auto_transfer = true 만 (고정비와 분리), 중복 제거
    const seen = new Set<string>();
    const out: any[] = [];
    for (const r of rows as any[]) {
      if (!r.is_auto_transfer) continue;
      const key = `${r.transaction_date || ""}|${(r.counterparty || "").trim()}|${Math.abs(Number(r.amount || 0))}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(r);
    }
    return out
      .sort((a, b) => (b.transaction_date || "").localeCompare(a.transaction_date || ""))
      .slice(0, maxItems);
  }, [rows, maxItems]);

  const total = useMemo(
    () => items.reduce((s, r) => s + Math.abs(Number(r.amount || 0)), 0),
    [items],
  );

  return (
    <div className="auto-transfer-history-card mb-3 glass-card p-5">
      <div className="auto-transfer-history-header flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <span className="kpi-icon info"><TileIcon name="repeat" className="w-5 h-5" /></span>
          <div>
            <h2 className="text-[15px] font-bold text-[var(--text)]">자동이체 연결 내역</h2>
            <span className="caption">{monthLabel} · {items.length}건</span>
          </div>
        </div>
        {items.length > 0 && (
          <div className="text-right">
            <div className="text-[10px] text-[var(--text-dim)] uppercase tracking-wider">이번달 출금</div>
            <div className="text-base font-black mono-number text-[var(--danger)]">₩{fmtKRW(total)}</div>
          </div>
        )}
      </div>

      {items.length === 0 ? (
        <div className="auto-transfer-history-empty text-center py-6 text-xs text-[var(--text-dim)]">
          이번달 자동이체 연결 내역이 없습니다.
          <div className="text-[10px] mt-1">
            <Link href="/transactions" className="text-[var(--primary)] hover:underline font-medium">거래 자동화</Link> 페이지에서 거래를 &quot;자동이체&quot;로 표시하면 여기에 모입니다.
          </div>
        </div>
      ) : (
        <div className="auto-transfer-history-list space-y-2">
          {items.map((t: any) => {
            const amount = Math.abs(Number(t.amount || 0));
            const dateStr = t.transaction_date || "";
            const d = new Date(dateStr);
            const dateDisplay = isNaN(d.getTime()) ? dateStr : `${d.getMonth() + 1}/${d.getDate()}`;
            const counterparty = t.counterparty || "(거래처 미상)";
            const bank = t.bank_accounts?.alias || t.bank_accounts?.bank_name || "";
            return (
              <div key={t.id} className="auto-transfer-history-row flex items-center gap-3 px-3 py-2 rounded-lg bg-[var(--bg-surface)]">
                <div className="text-[10px] text-[var(--text-dim)] w-10 mono-number">{dateDisplay}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold text-[var(--text)] truncate">{counterparty}</span>
                    <span className="text-[9px] px-1 py-0.5 rounded bg-[var(--primary)]/10 text-[var(--primary)] shrink-0">고정지출</span>
                  </div>
                  <div className="text-[10px] text-[var(--text-dim)] truncate">
                    {bank}{t.classification ? ` · ${t.classification}` : t.category ? ` · ${t.category}` : ""}
                  </div>
                </div>
                <div className="text-sm font-bold mono-number text-[var(--danger)] shrink-0">
                  ₩{fmtKRW(amount)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
