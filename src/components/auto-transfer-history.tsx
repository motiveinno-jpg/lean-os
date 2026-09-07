"use client";

import { kstDateStr } from "@/lib/kst";
import { useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { TileIcon } from "@/components/ui/icon-tile";
import { getBankTransactions } from "@/lib/queries";
import { getRecurringPayments } from "@/lib/approval-center";
import { buildRecurringPatterns, matchRecurring, RECURRING_CATEGORY_LABEL } from "@/lib/recurring-match";

interface Props {
  companyId: string;
  maxItems?: number;
  /** 통장 화면 안에서 쓸 때 — 같은 화면의 거래내역 탭으로 바로 바꾼다.
   *  (링크로 /bank?tab=transactions 를 열면 이미 통장 화면이라 탭이 안 바뀐다 — 2026-09-07 사장님: "눌러도 아무 반응 없음") */
  onOpenTransactions?: () => void;
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
  return kstDateStr(next);
}

// 자동이체 연결 내역 — 이번 달 통장 출금 가운데 정기 지출(재무 › 정기 지출)로 등록된 것과 맞는 줄.
//   예전엔 사람이 손으로 켠 표시(is_auto_transfer)만 봐서 늘 비어 있었고, 안내 링크는 이 화면 자신(/bank)을
//   가리켰다. 이제 정기 지출과 자동으로 짝을 맞추고(lib/recurring-match), 손으로 켠 표시도 같이 모은다 (2026-09-07).
export function AutoTransferHistoryCard({ companyId, maxItems = 8, onOpenTransactions }: Props) {
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
  const { data: recurring = [] } = useQuery({
    queryKey: ["recurring-payments", companyId],
    queryFn: () => getRecurringPayments(companyId),
    enabled: !!companyId,
    staleTime: 60_000,
  });
  const patterns = useMemo(() => buildRecurringPatterns(recurring as any[]), [recurring]);
  const activeRecurringCount = useMemo(() => (recurring as any[]).filter((r) => r.is_active !== false).length, [recurring]);

  const items = useMemo(() => {
    const seen = new Set<string>();
    const out: { tx: any; rp: any | null }[] = [];
    for (const r of rows as any[]) {
      const rp = matchRecurring(r, patterns);
      if (!rp && r.is_auto_transfer !== true) continue;
      const key = `${r.transaction_date || ""}|${(r.counterparty || "").trim()}|${Math.abs(Number(r.amount || 0))}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ tx: r, rp });
    }
    return out
      .sort((a, b) => (b.tx.transaction_date || "").localeCompare(a.tx.transaction_date || ""))
      .slice(0, maxItems);
  }, [rows, patterns, maxItems]);

  const total = useMemo(
    () => items.reduce((s, { tx }) => s + Math.abs(Number(tx.amount || 0)), 0),
    [items],
  );

  return (
    <div className="auto-transfer-history-card glass-card">
      <div className="auto-transfer-history-header">
        <div className="flex items-center gap-2.5">
          <span className="kpi-icon info"><TileIcon name="repeat" className="w-5 h-5" /></span>
          <div>
            <h2 className="text-[15px] font-bold text-[var(--text)]">자동이체 연결 내역</h2>
            <span className="caption">{monthLabel} · {items.length}건 · 정기 지출 {activeRecurringCount}건 기준</span>
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
        <div className="auto-transfer-history-empty">
          {activeRecurringCount === 0
            ? "등록된 정기 지출이 없어서 맞춰 볼 출금이 없어요."
            : "이번 달엔 정기 지출과 맞는 출금이 아직 없어요."}
          <div className="text-[10px] mt-1">
            {activeRecurringCount === 0 ? (
              <><Link href="/payments" className="text-[var(--primary)] hover:underline font-medium">정기 지출</Link>에 월세·보험·구독을 등록해 두면, 이름·금액이 맞는 출금이 여기에 모여요.</>
            ) : (
              <>정기 지출의 이름·금액과 맞는 출금이 들어오면 자동으로 모여요. 안 잡히는 줄은 {onOpenTransactions
                ? <button type="button" onClick={onOpenTransactions} className="text-[var(--primary)] hover:underline font-medium">거래내역</button>
                : <Link href="/bank?tab=transactions" className="text-[var(--primary)] hover:underline font-medium">거래내역</Link>}에서 골라 &quot;자동이체 표시&quot;를 누르면 돼요.</>
            )}
          </div>
        </div>
      ) : (
        <div className="auto-transfer-history-list">
          {items.map(({ tx: t, rp }) => {
            const amount = Math.abs(Number(t.amount || 0));
            const dateStr = t.transaction_date || "";
            const d = new Date(dateStr);
            const dateDisplay = isNaN(d.getTime()) ? dateStr : `${d.getMonth() + 1}/${d.getDate()}`;
            const counterparty = t.counterparty || "(거래처 미상)";
            const bank = t.bank_accounts?.alias || t.bank_accounts?.bank_name || "";
            const badge = rp ? (RECURRING_CATEGORY_LABEL[String(rp.category || "")] || "정기 지출") : "직접 표시";
            return (
              <div key={t.id} className="auto-transfer-history-row">
                <div className="text-[10px] text-[var(--text-dim)] w-10 mono-number">{dateDisplay}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold text-[var(--text)] truncate">{counterparty}</span>
                    <span className="text-[9px] px-1 py-0.5 rounded bg-[var(--primary)]/10 text-[var(--primary)] shrink-0" title={rp ? `정기 지출 '${rp.name}' 의 출금` : "거래내역에서 자동이체로 표시한 줄"}>{badge}</span>
                  </div>
                  <div className="text-[10px] text-[var(--text-dim)] truncate">
                    {rp ? rp.name : bank}{bank && rp ? ` · ${bank}` : ""}{t.classification ? ` · ${t.classification}` : ""}
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
