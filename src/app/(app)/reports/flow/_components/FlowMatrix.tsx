"use client";

// 경영흐름 — 월별 자금예산현황 매트릭스 (1년치, 엑셀 ▶자금예산현황 자동판) P3b §4-2.
//   행=지표(수입 비목 / 지출 고정·변동 / 부가세 / 순이익·영업이익률·자금수지누적·통장월말잔액·차액·BEP), 열=월.
//   셀 모드 토글: 금액 / 전월대비 / 전년동월(YoY) / 누계(YTD) / 구성비. 과거=실적·미래=예측 배지.
//   소스: getMonthlyBudgetOverview(과거+YoY), getTaxInvoiceSummary 분기(부가세). 비목 중립.

import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getMonthlyBudgetOverview, type MonthlyBudget } from "@/lib/cash-budget";
import { getTaxInvoiceSummary } from "@/lib/tax-invoice";

type CellMode = "amount" | "mom" | "yoy" | "ytd" | "ratio";
const CELL_MODES: { key: CellMode; label: string }[] = [
  { key: "amount", label: "금액" },
  { key: "mom", label: "전월대비" },
  { key: "yoy", label: "전년동월" },
  { key: "ytd", label: "누계" },
  { key: "ratio", label: "구성비" },
];

const won = (n: number) => `${Math.round(Number(n || 0)).toLocaleString("ko-KR")}`;
const fmtCell = (n: number | null, fmt: "won" | "pct") => {
  if (n == null) return "—";
  if (fmt === "pct") return `${(Math.round(n * 10) / 10).toLocaleString("ko-KR")}%`;
  const sign = n < 0 ? "-" : "";
  return `${sign}${won(Math.abs(n))}`;
};

const EMPTY_B = (month: string): MonthlyBudget => ({ month, incomeTotal: 0, bankBalance: 0, salesRevenue: 0, subsidies: 0, ownerInjection: 0, otherIncome: 0, expenseTotal: 0, fixedCosts: 0, variableCosts: 0, netProfit: 0 });

type Row = {
  key: string; label: string; fmt: "won" | "pct"; section: "income" | "expense" | "vat" | "summary";
  strong?: boolean; indent?: boolean;
  get: (b: MonthlyBudget, ctx: RowCtx) => number | null;
  ratioBase?: (b: MonthlyBudget) => number; // 구성비 분모
  noCompare?: boolean; // 전월/YoY/누계 비교 비활성(비율 행 등)
};
type RowCtx = { vatByMonth: Record<number, number> };

const monthNet = (b: MonthlyBudget) => Number(b.incomeTotal || 0) - Number(b.expenseTotal || 0);
const cmRate = (b: MonthlyBudget) => { const s = Number(b.salesRevenue || 0); return s > 0 ? (s - Number(b.variableCosts || 0)) / s : 0; };

const ROWS: Row[] = [
  { key: "incomeTotal", label: "수입 총액", fmt: "won", section: "income", strong: true, get: (b) => b.incomeTotal },
  { key: "salesRevenue", label: "매출", fmt: "won", section: "income", indent: true, get: (b) => b.salesRevenue, ratioBase: (b) => b.incomeTotal },
  { key: "subsidies", label: "보조금/지원금", fmt: "won", section: "income", indent: true, get: (b) => b.subsidies, ratioBase: (b) => b.incomeTotal },
  { key: "ownerInjection", label: "대표 가수금", fmt: "won", section: "income", indent: true, get: (b) => b.ownerInjection, ratioBase: (b) => b.incomeTotal },
  { key: "otherIncome", label: "기타 수입", fmt: "won", section: "income", indent: true, get: (b) => b.otherIncome, ratioBase: (b) => b.incomeTotal },

  { key: "expenseTotal", label: "지출 총액", fmt: "won", section: "expense", strong: true, get: (b) => b.expenseTotal },
  { key: "fixedCosts", label: "고정비", fmt: "won", section: "expense", indent: true, get: (b) => b.fixedCosts, ratioBase: (b) => b.expenseTotal },
  { key: "variableCosts", label: "변동비", fmt: "won", section: "expense", indent: true, get: (b) => b.variableCosts, ratioBase: (b) => b.expenseTotal },

  { key: "vat", label: "부가세 (분기 신고)", fmt: "won", section: "vat", noCompare: true, get: () => null },

  { key: "netProfit", label: "순이익 (수입−지출)", fmt: "won", section: "summary", strong: true, get: (b) => monthNet(b) },
  { key: "opMargin", label: "영업이익률", fmt: "pct", section: "summary", noCompare: true, get: (b) => { const i = Number(b.incomeTotal || 0); return i > 0 ? (monthNet(b) / i) * 100 : null; } },
  { key: "cumNet", label: "자금수지 누적 (YTD)", fmt: "won", section: "summary", noCompare: true, get: () => null }, // 별도 누적 계산
  { key: "bankBalance", label: "통장 월말잔액", fmt: "won", section: "summary", strong: true, get: (b) => b.bankBalance },
  { key: "gap", label: "누적순익 − 통장 차액", fmt: "won", section: "summary", noCompare: true, get: () => null }, // 별도
  { key: "bep", label: "손익분기점(BEP) 매출", fmt: "won", section: "summary", noCompare: true, get: (b) => { const r = cmRate(b); return r > 0 ? Number(b.fixedCosts || 0) / r : null; } },
  { key: "bepRate", label: "BEP 달성률", fmt: "pct", section: "summary", noCompare: true, get: (b) => { const r = cmRate(b); if (r <= 0) return null; const bep = Number(b.fixedCosts || 0) / r; return bep > 0 ? (Number(b.salesRevenue || 0) / bep) * 100 : null; } },
];

const SECTION_LABEL: Record<string, string> = { income: "수입", expense: "지출", vat: "세무", summary: "요약·재무비율" };

export function FlowMatrix({ companyId, currentMonth }: { companyId: string; currentMonth: string }) {
  const curYear = Number(currentMonth.slice(0, 4));
  const curMonthNum = Number(currentMonth.slice(5, 7));
  const [year, setYear] = useState(curYear);
  const [mode, setMode] = useState<CellMode>("amount");

  const { data: budget = [] } = useQuery({
    queryKey: ["flow-matrix-budget", companyId, year],
    queryFn: () => getMonthlyBudgetOverview(companyId, year),
    enabled: !!companyId, staleTime: 60_000,
  });
  const { data: prevBudget = [] } = useQuery({
    queryKey: ["flow-matrix-budget", companyId, year - 1],
    queryFn: () => getMonthlyBudgetOverview(companyId, year - 1),
    enabled: !!companyId && mode === "yoy", staleTime: 60_000,
  });
  const { data: quarterly = [] } = useQuery({
    queryKey: ["flow-matrix-vat", companyId, year],
    queryFn: () => getTaxInvoiceSummary(companyId, year, "quarterly"),
    enabled: !!companyId, staleTime: 60_000,
  });

  // 월(1~12) → budget
  const byMonth = useMemo(() => {
    const m: Record<number, MonthlyBudget> = {};
    for (const b of budget as MonthlyBudget[]) m[Number(b.month.slice(5, 7))] = b;
    for (let i = 1; i <= 12; i++) if (!m[i]) m[i] = EMPTY_B(`${year}-${String(i).padStart(2, "0")}`);
    return m;
  }, [budget, year]);
  const prevByMonth = useMemo(() => {
    const m: Record<number, MonthlyBudget> = {};
    for (const b of prevBudget as MonthlyBudget[]) m[Number(b.month.slice(5, 7))] = b;
    return m;
  }, [prevBudget]);

  // 부가세: 분기 netVAT(매출세액−매입세액)을 신고월에 배치 (예정 4·10 / 확정 7·익1[전년Q4를 1월])
  const vatByMonth = useMemo(() => {
    const q: Record<string, number> = {};
    for (const r of quarterly as any[]) {
      const net = Number(r.salesTax || 0) - Number(r.purchaseTax || 0);
      q[r.quarter || r.period || ""] = net;
    }
    const pick = (suffix: string) => q[`${year}-${suffix}`] ?? 0;
    return { 4: pick("Q1"), 7: pick("Q2"), 10: pick("Q3"), 1: pick("Q4") } as Record<number, number>;
  }, [quarterly, year]);

  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const ctx: RowCtx = { vatByMonth };

  // 자금수지 누적 / 차액 사전계산
  const cumNetByMonth = useMemo(() => {
    const m: Record<number, number> = {}; let acc = 0;
    for (let i = 1; i <= 12; i++) { acc += monthNet(byMonth[i]); m[i] = acc; }
    return m;
  }, [byMonth]);

  const cellValue = (row: Row, mo: number): number | null => {
    const b = byMonth[mo];
    if (row.key === "vat") return vatByMonth[mo] || null;
    if (row.key === "cumNet") return cumNetByMonth[mo];
    if (row.key === "gap") return Number(b.bankBalance || 0) - cumNetByMonth[mo];

    const base = row.get(b, ctx);
    if (base == null) return null;
    if (row.noCompare || mode === "amount") return base;
    if (mode === "mom") { const p = mo > 1 ? row.get(byMonth[mo - 1], ctx) : null; return p == null ? null : base - p; }
    if (mode === "yoy") { const p = prevByMonth[mo] ? row.get(prevByMonth[mo], ctx) : null; return p == null ? null : base - p; }
    if (mode === "ytd") { let s = 0; for (let i = 1; i <= mo; i++) { const v = row.get(byMonth[i], ctx); if (v != null) s += v; } return s; }
    if (mode === "ratio") { if (!row.ratioBase) return null; const denom = row.ratioBase(b); return denom > 0 ? (base / denom) * 100 : null; }
    return base;
  };
  const cellFmt = (row: Row): "won" | "pct" => (mode === "ratio" && row.ratioBase ? "pct" : row.fmt);

  // 섹션별 그룹 렌더
  const sections: Row["section"][] = ["income", "expense", "vat", "summary"];

  return (
    <div className="glass-card p-4 space-y-3 overflow-hidden">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <button onClick={() => setYear((y) => y - 1)} className="px-2 py-1 text-xs rounded-lg hover:bg-[var(--bg-surface)] text-[var(--text-muted)]">←</button>
          <span className="text-sm font-bold text-[var(--text)] mono-number">{year}년</span>
          <button onClick={() => setYear((y) => y + 1)} disabled={year >= curYear} className="px-2 py-1 text-xs rounded-lg hover:bg-[var(--bg-surface)] text-[var(--text-muted)] disabled:opacity-30">→</button>
        </div>
        <div className="flex gap-1 flex-wrap">
          {CELL_MODES.map((m) => (
            <button key={m.key} onClick={() => setMode(m.key)}
              className={`px-2.5 py-1 text-[11px] font-semibold rounded-full border transition ${mode === m.key ? "bg-[var(--primary)] text-white border-[var(--primary)]" : "border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg-surface)]"}`}>
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="border-collapse text-xs" style={{ minWidth: 900 }}>
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-[var(--bg-card)] px-2 py-1.5 text-left font-bold text-[var(--text-muted)] border-b border-[var(--border)]" style={{ minWidth: 150 }}>지표</th>
              {months.map((mo) => {
                const isActual = year < curYear || (year === curYear && mo <= curMonthNum);
                return (
                  <th key={mo} className="px-2 py-1.5 text-right font-bold border-b border-[var(--border)] whitespace-nowrap" style={{ minWidth: 78 }}>
                    <div className={isActual ? "text-[var(--text)]" : "text-[var(--text-dim)]"}>{mo}월</div>
                    <div className={`text-[8px] font-semibold ${isActual ? "text-green-500" : "text-amber-500"}`}>{isActual ? "실적" : "예측"}</div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sections.map((sec) => {
              const rows = ROWS.filter((r) => r.section === sec);
              if (rows.length === 0) return null;
              return (
                <Fragment key={`sec-${sec}`}>
                  <tr>
                    <td colSpan={13} className="sticky left-0 bg-[var(--bg-surface)] px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-[var(--text-dim)]">{SECTION_LABEL[sec]}</td>
                  </tr>
                  {rows.map((row) => (
                    <tr key={row.key} className="hover:bg-[var(--bg-surface)]/40">
                      <td className={`sticky left-0 z-10 bg-[var(--bg-card)] px-2 py-1.5 border-b border-[var(--border)]/40 ${row.strong ? "font-bold text-[var(--text)]" : row.indent ? "pl-5 text-[var(--text-muted)]" : "text-[var(--text-muted)]"}`}>{row.label}</td>
                      {months.map((mo) => {
                        const v = cellValue(row, mo);
                        const neg = v != null && v < 0;
                        return (
                          <td key={mo} className={`px-2 py-1.5 text-right mono-number border-b border-[var(--border)]/40 ${row.strong ? "font-bold" : ""} ${neg ? "text-[var(--danger)]" : "text-[var(--text)]"}`}>
                            {fmtCell(v, cellFmt(row))}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="text-[10px] text-[var(--text-dim)] leading-relaxed">
        과거 월=실적 자동집계(cash-budget·세금계산서, 다른 화면과 동일), 미래 월=예측/예산. 부가세=분기 매출세액−매입세액을 신고월(4·7·10·익1)에 표기.
        계정과목 전수(예수금·4대보험·임차료 등)는 분개·계정과목 데이터가 입력되면 자동으로 행이 추가됩니다.
      </div>
    </div>
  );
}
