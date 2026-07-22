"use client";

// 경영흐름 콕핏 — 과거↔미래 타임라인 + 다각도 렌즈 (P2/P3).
//   과거 N개월 실적(getMonthlyBudgetOverview, cash-budget) + 미래(cash-pulse) 잔액 추이.
//   렌즈(비목 중립): 수입 구성 / 지출(고정·변동) / 순흐름 — 같은 월별 데이터의 여러 단면.
//   잔액 라인: 과거 월말잔액(bankBalance) → 오늘(현재잔액) → 미래(cash-pulse forecast) 관통.
//   라인은 AreaTrend(min-max 스케일)로 변동을 또렷하게 — 막대는 풀하이트 트랙 위 실적.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getMonthlyBudgetOverview, type MonthlyBudget } from "@/lib/cash-budget";
import { getCashPulseData } from "@/lib/queries";
import { buildCashPulse } from "@/lib/cash-pulse";
import { AreaTrend, type TrendPoint } from "./AreaTrend";

export type FlowLens = "income" | "expense" | "net";

const fmtShort = (n: number) => {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(1)}억`;
  if (abs >= 1e4) return `${sign}${Math.round(abs / 1e4).toLocaleString("ko-KR")}만`;
  if (abs === 0) return "0";
  return `${sign}${Math.round(abs).toLocaleString("ko-KR")}`;
};

type Lens = FlowLens;
const LENSES: { key: Lens; label: string }[] = [
  { key: "income", label: "수입 구성" },
  { key: "expense", label: "지출(고정·변동)" },
  { key: "net", label: "순흐름" },
];

// 수입원/지출 구성 색 (비목 중립 — 동등 표시)
const INCOME_PARTS = [
  { key: "salesRevenue", label: "매출", color: "var(--primary)" },
  { key: "subsidies", label: "보조금", color: "var(--success)" },
  { key: "ownerInjection", label: "대표 가수금", color: "var(--warning)" },
  { key: "otherIncome", label: "기타", color: "var(--text-dim)" },
] as const;
const EXPENSE_PARTS = [
  { key: "fixedCosts", label: "고정비", color: "var(--warning)" },
  { key: "variableCosts", label: "변동비", color: "var(--viz-brand)" }, // 장식용 고유색 — 고정비(--warning)와 구분 유지
] as const;

const BAR_H = 96;

function ymAdd(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function FlowTrend({ companyId, userId, anchorMonth, pastN = 6, lens, onLensChange }: { companyId: string; userId?: string; anchorMonth: string; pastN?: number; lens: FlowLens; onLensChange: (l: FlowLens) => void }) {

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

  const todayIdx = pastMonths.length - 1;

  const trendPts: TrendPoint[] = balanceLine.map((p) => ({
    label: p.label,
    value: p.balance,
    tone: p.balance < 0 ? "danger" : p.future ? "muted" : "normal",
  }));

  // 렌즈별 막대 데이터
  const parts = lens === "income" ? INCOME_PARTS : lens === "expense" ? EXPENSE_PARTS : null;
  const barMax = useMemo(() => {
    if (lens === "net") return Math.max(1, ...pastMonths.map((b) => Math.abs(b.incomeTotal - b.expenseTotal)));
    const total = (b: MonthlyBudget) => (lens === "income" ? b.incomeTotal : b.expenseTotal);
    return Math.max(1, ...pastMonths.map(total));
  }, [pastMonths, lens]);

  return (
    <div className="flow-trend-card glass-card">
      <div className="flow-trend-header">
        <h3 className="text-sm font-bold text-[var(--text)]">과거 → 미래 흐름 <span className="font-normal text-[var(--text-dim)] text-xs">과거 {pastN}개월 실적 + 예측 3개월</span></h3>
        <div className="flow-lens-switch seg-bar">
          {LENSES.map((l) => (
            <button key={l.key} onClick={() => onLensChange(l.key)}
              className={`seg-item ${lens === l.key ? "seg-item-active" : ""}`}>
              {l.label}
            </button>
          ))}
        </div>
      </div>

      {/* 잔액 추이 (과거 월말 → 미래 예측 관통) */}
      <div className="flow-balance-trend" style={{ background: "color-mix(in srgb, var(--primary) 4%, transparent)" }}>
        <div className="flex items-center justify-between mb-3">
          <div className="text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)]">잔액 추이</div>
          <div className="text-[10px] text-[var(--text-dim)]">점선 = 오늘 · 회색 점 = 예측</div>
        </div>
        <AreaTrend points={trendPts} height={132} markerIndex={todayIdx} />
      </div>

      {/* 렌즈별 월 막대 (과거 실적) — 풀하이트 트랙 위 실적 */}
      <div className="flow-lens-bars">
        <div className="flex items-end gap-2">
          {pastMonths.map((b, idx) => {
            const isCur = idx === todayIdx;
            const net = b.incomeTotal - b.expenseTotal;
            const total = lens === "net" ? net : lens === "income" ? b.incomeTotal : b.expenseTotal;
            const barH = Math.max(2, Math.round((Math.abs(total) / barMax) * (BAR_H - 6)));
            const neg = lens === "net" && net < 0;
            const labelColor = neg ? "text-[var(--danger)]" : "text-[var(--text-muted)]";
            return (
              <div key={b.month} className="flow-bar-col" title={`${b.month}: ${fmtShort(total)}`}>
                <span className={`text-[9px] mono-number ${labelColor}`}>{fmtShort(total)}</span>
                <div className="w-full rounded-xl flex items-end overflow-hidden" style={{ height: BAR_H, background: "var(--bg-surface)" }}>
                  {lens === "net" ? (
                    <div className="w-full" style={{ height: barH, borderRadius: "10px 10px 0 0", background: neg ? "color-mix(in srgb, var(--danger) 75%, transparent)" : "color-mix(in srgb, var(--success) 80%, transparent)" }} />
                  ) : (
                    <div className="w-full flex flex-col-reverse overflow-hidden" style={{ height: barH, borderRadius: "10px 10px 0 0" }}>
                      {parts!.map((pt) => {
                        const v = Number((b as any)[pt.key] || 0);
                        if (v <= 0) return null;
                        return <div key={pt.key} title={`${pt.label} ${fmtShort(v)}`} style={{ height: `${(v / Math.max(1, total)) * 100}%`, background: pt.color }} />;
                      })}
                    </div>
                  )}
                </div>
                <span className={`text-[10px] ${isCur ? "text-[var(--primary)] font-bold" : "text-[var(--text-dim)]"}`}>{Number(b.month.slice(5))}월</span>
              </div>
            );
          })}
        </div>
        {/* 범례 */}
        {parts && (
          <div className="flow-bar-legend">
            {parts.map((pt) => (
              <span key={pt.key} className="inline-flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
                <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: pt.color }} />{pt.label}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
