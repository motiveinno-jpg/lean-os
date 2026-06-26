"use client";

// 경영흐름 콕핏 — 과거↔미래 타임라인 + 다각도 렌즈 (P2/P3).
//   과거 N개월 실적(getMonthlyBudgetOverview, cash-budget) + 미래(cash-pulse) 잔액 추이.
//   렌즈(비목 중립): 수입 구성 / 지출(고정·변동) / 순흐름 — 같은 월별 데이터의 여러 단면.
//   잔액 라인: 과거 월말잔액(bankBalance) → 오늘(현재잔액) → 미래(cash-pulse forecast) 관통.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getMonthlyBudgetOverview, type MonthlyBudget } from "@/lib/cash-budget";
import { getCashPulseData } from "@/lib/queries";
import { buildCashPulse } from "@/lib/cash-pulse";

const fmtShort = (n: number) => {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(1)}억`;
  if (abs >= 1e4) return `${sign}${Math.round(abs / 1e4).toLocaleString("ko-KR")}만`;
  if (abs === 0) return "0";
  return `${sign}${Math.round(abs).toLocaleString("ko-KR")}`;
};

type Lens = "income" | "expense" | "net";
const LENSES: { key: Lens; label: string }[] = [
  { key: "income", label: "수입 구성" },
  { key: "expense", label: "지출(고정·변동)" },
  { key: "net", label: "순흐름" },
];

// 수입원/지출 구성 색 (비목 중립 — 동등 표시)
const INCOME_PARTS = [
  { key: "salesRevenue", label: "매출", color: "#6366f1" },
  { key: "subsidies", label: "보조금", color: "#10b981" },
  { key: "ownerInjection", label: "대표 가수금", color: "#f59e0b" },
  { key: "otherIncome", label: "기타", color: "#94a3b8" },
] as const;
const EXPENSE_PARTS = [
  { key: "fixedCosts", label: "고정비", color: "#f97316" },
  { key: "variableCosts", label: "변동비", color: "#ec4899" },
] as const;

function ymAdd(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function FlowTrend({ companyId, userId, anchorMonth, pastN = 6 }: { companyId: string; userId?: string; anchorMonth: string; pastN?: number }) {
  const [lens, setLens] = useState<Lens>("income");

  // 과거 범위가 걸치는 연도들 (예: 2026-01 기준 과거6 → 2025 + 2026)
  const years = useMemo(() => {
    const set = new Set<number>();
    for (let i = 0; i <= pastN; i++) set.add(Number(ymAdd(anchorMonth, -i).slice(0, 4)));
    return [...set];
  }, [anchorMonth, pastN]);

  const { data: budgetByYear = {} } = useQuery({
    queryKey: ["flow-trend-budget", companyId, years.join(",")],
    queryFn: async () => {
      const out: Record<number, MonthlyBudget[]> = {};
      for (const y of years) out[y] = await getMonthlyBudgetOverview(companyId, y);
      return out;
    },
    enabled: !!companyId,
    staleTime: 60_000,
  });

  const { data: pulse } = useQuery({
    queryKey: ["flow-cash-pulse", companyId, userId],
    queryFn: async () => {
      const raw = await getCashPulseData(companyId, userId);
      return raw ? buildCashPulse(raw) : null;
    },
    enabled: !!companyId,
    staleTime: 60_000,
  });

  // 과거 N개월 + 당월 (오래된 → 최신)
  const pastMonths = useMemo(() => {
    const all: Record<string, MonthlyBudget> = {};
    for (const y of Object.keys(budgetByYear)) for (const b of (budgetByYear as any)[y]) all[b.month] = b;
    const arr: MonthlyBudget[] = [];
    for (let i = pastN; i >= 0; i--) {
      const ym = ymAdd(anchorMonth, -i);
      arr.push(all[ym] || { month: ym, incomeTotal: 0, bankBalance: 0, salesRevenue: 0, subsidies: 0, ownerInjection: 0, otherIncome: 0, expenseTotal: 0, fixedCosts: 0, variableCosts: 0, netProfit: 0 });
    }
    return arr;
  }, [budgetByYear, anchorMonth, pastN]);

  // 미래 잔액 포인트 (cash-pulse D+30/60/90 ≈ +1/+2/+3개월)
  const futurePoints = useMemo(() => {
    if (!pulse) return [];
    return [30, 60, 90].map((d, i) => {
      const fp = pulse.forecastPoints.find((p) => p.days === d);
      return { label: ymAdd(anchorMonth, i + 1).slice(2), balance: fp?.balance ?? 0, future: true };
    });
  }, [pulse, anchorMonth]);

  // 잔액 라인 포인트: 과거 월말잔액 → (오늘=현재잔액은 마지막 과거에 반영) → 미래 예측
  const balanceLine = useMemo(() => {
    const pts = pastMonths.map((b) => ({ label: b.month.slice(2), balance: Number(b.bankBalance || 0), future: false }));
    return [...pts, ...futurePoints];
  }, [pastMonths, futurePoints]);

  // 렌즈별 막대 데이터
  const parts = lens === "income" ? INCOME_PARTS : lens === "expense" ? EXPENSE_PARTS : null;
  const barMax = useMemo(() => {
    if (lens === "net") return Math.max(1, ...pastMonths.map((b) => Math.abs(b.incomeTotal - b.expenseTotal)));
    const total = (b: MonthlyBudget) => (lens === "income" ? b.incomeTotal : b.expenseTotal);
    return Math.max(1, ...pastMonths.map(total));
  }, [pastMonths, lens]);

  // 잔액 라인 SVG
  const lineMax = Math.max(1, ...balanceLine.map((p) => Math.abs(p.balance)));
  const W = 100, H = 36;
  const linePath = balanceLine.map((p, i) => {
    const x = balanceLine.length > 1 ? (i / (balanceLine.length - 1)) * W : 0;
    const y = H - (p.balance / lineMax) * (H * 0.45) - H * 0.5; // 0 기준선 중앙
    return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${Math.max(1, Math.min(H - 1, y)).toFixed(1)}`;
  }).join(" ");
  const todayIdx = pastMonths.length - 1;

  return (
    <div className="glass-card p-5 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-sm font-bold text-[var(--text)]">과거 → 미래 흐름 <span className="font-normal text-[var(--text-dim)] text-xs">과거 {pastN}개월 실적 + 예측 3개월</span></h3>
        <div className="flex gap-1.5">
          {LENSES.map((l) => (
            <button key={l.key} onClick={() => setLens(l.key)}
              className={`px-2.5 py-1 text-[11px] font-semibold rounded-full border transition ${lens === l.key ? "bg-[var(--primary)] text-white border-[var(--primary)]" : "border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg-surface)]"}`}>
              {l.label}
            </button>
          ))}
        </div>
      </div>

      {/* 잔액 라인 (과거 월말 → 미래 예측 관통) */}
      <div>
        <div className="text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">잔액 추이</div>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height: 48 }}>
          <line x1="0" y1={H * 0.5} x2={W} y2={H * 0.5} stroke="var(--border)" strokeWidth="0.3" />
          {balanceLine.length > 1 && (
            <line x1={(todayIdx / (balanceLine.length - 1)) * W} y1="0" x2={(todayIdx / (balanceLine.length - 1)) * W} y2={H} stroke="var(--text-dim)" strokeWidth="0.3" strokeDasharray="1.5" />
          )}
          <path d={linePath} fill="none" stroke="var(--primary)" strokeWidth="0.8" />
          {balanceLine.map((p, i) => {
            const x = balanceLine.length > 1 ? (i / (balanceLine.length - 1)) * W : 0;
            const y = Math.max(1, Math.min(H - 1, H - (p.balance / lineMax) * (H * 0.45) - H * 0.5));
            return <circle key={i} cx={x} cy={y} r="0.8" fill={p.balance < 0 ? "#ef4444" : p.future ? "#94a3b8" : "var(--primary)"} />;
          })}
        </svg>
        <div className="flex justify-between text-[9px] text-[var(--text-dim)] mt-0.5">
          <span>{balanceLine[0]?.label}</span>
          <span className="text-[var(--text-muted)]">↑오늘</span>
          <span>{balanceLine[balanceLine.length - 1]?.label} (예측)</span>
        </div>
      </div>

      {/* 렌즈별 월 막대 (과거 실적) */}
      <div>
        <div className="flex items-end gap-1.5" style={{ height: 110 }}>
          {pastMonths.map((b, idx) => {
            const isCur = idx === todayIdx;
            if (lens === "net") {
              const net = b.incomeTotal - b.expenseTotal;
              const h = Math.max(2, Math.round((Math.abs(net) / barMax) * 84));
              return (
                <div key={b.month} className="flex-1 flex flex-col items-center justify-end gap-1" title={`${b.month}: 순 ${fmtShort(net)}`}>
                  <span className={`text-[9px] mono-number ${net < 0 ? "text-red-500" : "text-[var(--text-muted)]"}`}>{fmtShort(net)}</span>
                  <div className={`w-full rounded-t ${net < 0 ? "bg-red-500/70" : "bg-green-500/70"}`} style={{ height: h }} />
                  <span className={`text-[9px] ${isCur ? "text-[var(--primary)] font-bold" : "text-[var(--text-dim)]"}`}>{Number(b.month.slice(5))}월</span>
                </div>
              );
            }
            const total = lens === "income" ? b.incomeTotal : b.expenseTotal;
            return (
              <div key={b.month} className="flex-1 flex flex-col items-center justify-end gap-1" title={`${b.month}: ${fmtShort(total)}`}>
                <span className="text-[9px] mono-number text-[var(--text-muted)]">{fmtShort(total)}</span>
                <div className="w-full flex flex-col-reverse rounded-t overflow-hidden" style={{ height: Math.max(2, Math.round((total / barMax) * 84)) }}>
                  {parts!.map((pt) => {
                    const v = Number((b as any)[pt.key] || 0);
                    if (v <= 0) return null;
                    return <div key={pt.key} title={`${pt.label} ${fmtShort(v)}`} style={{ height: `${(v / Math.max(1, total)) * 100}%`, background: pt.color }} />;
                  })}
                </div>
                <span className={`text-[9px] ${isCur ? "text-[var(--primary)] font-bold" : "text-[var(--text-dim)]"}`}>{Number(b.month.slice(5))}월</span>
              </div>
            );
          })}
        </div>
        {/* 범례 */}
        {parts && (
          <div className="flex flex-wrap gap-2 mt-2">
            {parts.map((pt) => (
              <span key={pt.key} className="inline-flex items-center gap-1 text-[10px] text-[var(--text-muted)]">
                <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: pt.color }} />{pt.label}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
