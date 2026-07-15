"use client";

// 경영흐름 콕핏 — 입금/지출 예정 (P5).
//   cash-pulse 와 동일 입력(getCashPulseData)의 revenueSchedules/costSchedules 재사용
//   → 예측 헤더와 동일 소스(숫자 정합성). 앞으로 90일 예정 입출금을 날짜순으로.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getCashPulseData } from "@/lib/queries";

const won = (n: number) => `${Math.round(Number(n || 0)).toLocaleString("ko-KR")}`;
const todayStr = () => new Date().toISOString().slice(0, 10);

type Item = { date: string; amount: number; kind: "in" | "out" };

export function FlowSchedule({ companyId, userId }: { companyId: string; userId?: string }) {
  const { data: raw, isLoading } = useQuery({
    queryKey: ["flow-schedule-input", companyId, userId],
    queryFn: () => getCashPulseData(companyId, userId),
    enabled: !!companyId,
    staleTime: 60_000,
  });

  const { items, inTotal, outTotal } = useMemo(() => {
    const t = todayStr();
    const horizon = (() => { const d = new Date(); d.setDate(d.getDate() + 90); return d.toISOString().slice(0, 10); })();
    const list: Item[] = [];
    const push = (arr: any[], kind: "in" | "out") => {
      for (const s of arr || []) {
        if (s.status !== "scheduled" || !s.due_date) continue;
        const d = String(s.due_date).slice(0, 10);
        if (d < t || d > horizon) continue;
        list.push({ date: d, amount: Number(s.amount || 0), kind });
      }
    };
    push((raw as any)?.revenueSchedules, "in");
    push((raw as any)?.costSchedules, "out");
    list.sort((a, b) => a.date.localeCompare(b.date));
    const inTotal = list.filter((i) => i.kind === "in").reduce((s, i) => s + i.amount, 0);
    const outTotal = list.filter((i) => i.kind === "out").reduce((s, i) => s + i.amount, 0);
    return { items: list, inTotal, outTotal };
  }, [raw]);

  // 월별 그룹
  const byMonth = useMemo(() => {
    const m: Record<string, Item[]> = {};
    for (const it of items) (m[it.date.slice(0, 7)] ||= []).push(it);
    return Object.entries(m).sort((a, b) => a[0].localeCompare(b[0]));
  }, [items]);

  return (
    <div className="flow-schedule-card glass-card p-5 space-y-3">
      <div className="flow-schedule-header flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-sm font-bold text-[var(--text)]">입금 / 지출 예정 <span className="font-normal text-[var(--text-dim)] text-xs">앞으로 90일</span></h3>
        <div className="flow-schedule-totals flex gap-3 text-xs">
          <span className="text-[var(--success)] font-semibold mono-number">입금 +₩{won(inTotal)}</span>
          <span className="text-[var(--danger)] font-semibold mono-number">지출 -₩{won(outTotal)}</span>
        </div>
      </div>

      {isLoading ? (
        <div className="text-sm text-[var(--text-muted)] py-6 text-center">불러오는 중…</div>
      ) : items.length === 0 ? (
        <div className="flow-schedule-empty text-sm text-[var(--text-muted)] py-6 text-center">
          예정된 입출금이 없습니다.
          <div className="text-[11px] text-[var(--text-dim)] mt-1">매출·비용 일정(예정 입금/정기결제)이 등록되면 여기에 표시됩니다.</div>
        </div>
      ) : (
        <div className="space-y-3">
          {byMonth.map(([ym, list]) => {
            const mi = list.filter((i) => i.kind === "in").reduce((s, i) => s + i.amount, 0);
            const mo = list.filter((i) => i.kind === "out").reduce((s, i) => s + i.amount, 0);
            return (
              <div key={ym} className="flow-schedule-month-group">
                <div className="flow-schedule-month-header flex items-center justify-between text-[11px] font-bold text-[var(--text-muted)] mb-1 px-1">
                  <span>{ym}</span>
                  <span className="mono-number">순 {mi - mo >= 0 ? "+" : ""}₩{won(mi - mo)}</span>
                </div>
                <div className="space-y-1">
                  {list.map((it, i) => (
                    <div key={i} className="flow-schedule-item flex items-center justify-between text-xs px-2.5 py-1.5 rounded-lg bg-[var(--bg-surface)]">
                      <span className="text-[var(--text-muted)] mono-number">{it.date.slice(5)}</span>
                      <span className={`font-semibold mono-number ${it.kind === "in" ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>
                        {it.kind === "in" ? "+" : "-"}₩{won(it.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
