"use client";

// 경영흐름 — 월별 자금예산현황 매트릭스 (1년치, 엑셀 ▶자금예산현황 자동판) P3b §4-2.
//   행=지표(수입 비목 / 지출 고정·변동 / 부가세 / 순이익·영업이익률·자금수지누적·통장월말잔액·차액·BEP), 열=월.
//   셀 모드 토글: 금액 / 전월대비 / 전년동월(YoY) / 누계(YTD) / 구성비. 과거=실적·미래=예측 배지.
//   소스: getMonthlyBudgetOverview(과거+YoY), getTaxInvoiceSummary 분기(부가세). 비목 중립.

import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getMonthlyBudgetOverview, type MonthlyBudget } from "@/lib/cash-budget";
import { getTaxInvoiceSummary } from "@/lib/tax-invoice";
import { MetricInfo } from "./MetricInfo";
import { CellDetail } from "./CellDetail";
import { RECORD_BACKED_KEYS, type BudgetDetailItem } from "@/lib/budget-detail";

type CellMode = "amount" | "mom" | "yoy" | "ytd" | "ratio";
const CELL_MODES: { key: CellMode; label: string }[] = [
  { key: "amount", label: "금액" },
  { key: "mom", label: "전월대비" },
  { key: "yoy", label: "전년동월" },
  { key: "ytd", label: "누계" },
  { key: "ratio", label: "구성비" },
];
const MODE_HINT: Record<CellMode, string> = {
  amount: "각 달의 실제 금액입니다. 금액을 클릭하면 어떤 거래로 구성됐는지 볼 수 있습니다.",
  mom: "바로 전월 대비 증감액입니다.",
  yoy: "작년 같은 달 대비 증감액입니다.",
  ytd: "1월부터 그 달까지 누적 합계입니다.",
  ratio: "그 달 수입/지출 대비 구성 비중(%)입니다.",
};

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
  const [detail, setDetail] = useState<{ rowKey: string; label: string; mo: number } | null>(null);

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

  // 금액 셀 클릭 시 산출 내역(원 단위 행만). 레코드 기반 행은 CellDetail 이 직접 조회, 파생행은 여기서 계산.
  const canDetail = (row: Row, v: number | null) =>
    mode === "amount" && v != null && row.fmt === "won" && !["subsidies", "otherIncome"].includes(row.key);

  // 파생행 산출 내역(이미 로드된 값 기반)
  const clientDetail = (rowKey: string, mo: number): { items: BudgetDetailItem[]; note?: string; showTotal?: boolean } | null => {
    const b = byMonth[mo];
    if (rowKey === "incomeTotal") return { items: [
      { label: "매출", amount: Number(b.salesRevenue || 0) },
      { label: "대표 가수금", amount: Number(b.ownerInjection || 0) },
      { label: "보조금/지원금", amount: Number(b.subsidies || 0) },
      { label: "기타 수입", amount: Number(b.otherIncome || 0) },
    ].filter((i) => i.amount) };
    if (rowKey === "expenseTotal") return { items: [
      { label: "고정비", amount: Number(b.fixedCosts || 0) },
      { label: "변동비", amount: Number(b.variableCosts || 0) },
    ].filter((i) => i.amount) };
    if (rowKey === "netProfit") return { items: [
      { label: "수입 총액", amount: Number(b.incomeTotal || 0) },
      { label: "지출 총액", amount: -Number(b.expenseTotal || 0) },
    ] };
    if (rowKey === "cumNet") {
      const items: BudgetDetailItem[] = [];
      for (let i = 1; i <= mo; i++) items.push({ label: `${i}월 순이익`, amount: monthNet(byMonth[i]) });
      return { items };
    }
    if (rowKey === "gap") return { items: [
      { label: "통장 월말잔액", amount: Number(b.bankBalance || 0) },
      { label: "누적순익", amount: -cumNetByMonth[mo] },
    ] };
    if (rowKey === "vat") {
      const qMap: Record<number, string> = { 4: "Q1", 7: "Q2", 10: "Q3", 1: "Q4" };
      const q = qMap[mo];
      if (!q) return null;
      const r = (quarterly as any[]).find((x) => (x.quarter || x.period) === `${year}-${q}`);
      const s = Number(r?.salesTax || 0), p = Number(r?.purchaseTax || 0);
      return { items: [{ label: "매출세액", amount: s }, { label: "매입세액", amount: -p }], note: `${q} 매출세액 − 매입세액 = 순부가세` };
    }
    if (rowKey === "bep") {
      const r = cmRate(b);
      const bepVal = r > 0 ? Number(b.fixedCosts || 0) / r : 0;
      return {
        items: [{ label: "고정비", amount: Number(b.fixedCosts || 0) }],
        note: `공헌이익률 ${(r * 100).toFixed(1)}% · BEP 매출 = 고정비 ÷ 공헌이익률 = ${Math.round(bepVal).toLocaleString("ko-KR")}원`,
        showTotal: false,
      };
    }
    return null;
  };

  // 섹션별 그룹 렌더
  const sections: Row["section"][] = ["income", "expense", "vat", "summary"];

  return (
    <div className="space-y-3">
      {/* 컨트롤 바 — 연도(좌) + 표시 방식 세그먼트(우) + 현재 모드 설명 */}
      <div className="flow-matrix-toolbar glass-card p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flow-matrix-year-switch flex items-center gap-1">
          <button onClick={() => setYear((y) => y - 1)} className="w-8 h-8 flex items-center justify-center text-sm rounded-lg hover:bg-[var(--bg-surface)] text-[var(--text-muted)]">←</button>
          <span className="text-sm font-bold text-[var(--text)] mono-number min-w-[64px] text-center">{year}년</span>
          <button onClick={() => setYear((y) => y + 1)} disabled={year >= curYear} className="w-8 h-8 flex items-center justify-center text-sm rounded-lg hover:bg-[var(--bg-surface)] text-[var(--text-muted)] disabled:opacity-30">→</button>
        </div>
        <div className="flex flex-col gap-1.5 sm:items-end">
          <div className="flow-matrix-mode-switch inline-flex rounded-xl bg-[var(--bg-surface)] p-1 border border-[var(--border)] overflow-x-auto scrollbar-hide">
            {CELL_MODES.map((m) => (
              <button key={m.key} onClick={() => setMode(m.key)}
                className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold whitespace-nowrap transition ${mode === m.key ? "bg-[var(--primary)] text-white shadow-sm" : "text-[var(--text-muted)] hover:text-[var(--text)]"}`}>
                {m.label}
              </button>
            ))}
          </div>
          <span className="text-[11px] text-[var(--text-dim)] leading-snug">{MODE_HINT[mode]}</span>
        </div>
      </div>

      {/* 표 */}
      <div className="flow-matrix-table-wrap glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="flow-matrix-table border-collapse text-[12px] w-full min-w-[920px]">
            <thead>
              <tr className="flow-matrix-header-row bg-[var(--bg-surface)]">
                <th className="flow-matrix-account-col sticky left-0 z-10 bg-[var(--bg-surface)] px-3 py-2.5 text-left font-bold text-[var(--text-muted)] border-b border-[var(--border)] min-w-[168px] shadow-[1px_0_0_var(--border)]">계정</th>
                {months.map((mo) => {
                  const isActual = year < curYear || (year === curYear && mo <= curMonthNum);
                  return (
                    <th key={mo} className="flow-matrix-month-col px-2.5 py-2 text-right font-bold border-b border-[var(--border)] whitespace-nowrap min-w-[82px]">
                      <div className={`text-[12px] ${isActual ? "text-[var(--text)]" : "text-[var(--text-dim)]"}`}>{mo}월</div>
                      <div className="mt-0.5">
                        <span className={`inline-block px-1.5 py-0.5 rounded-full text-[8.5px] font-bold ${isActual ? "bg-[var(--success)]/12 text-[var(--success)]" : "bg-[var(--warning)]/12 text-[var(--warning)]"}`}>{isActual ? "실적" : "예측"}</span>
                      </div>
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
                    <tr className="flow-matrix-section-row">
                      <td colSpan={13} className="sticky left-0 bg-[var(--bg-surface)]/70 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--text-dim)] border-b border-[var(--border)]/40 shadow-[1px_0_0_var(--border)]">{SECTION_LABEL[sec]}</td>
                    </tr>
                    {rows.map((row) => (
                      <tr key={row.key} className={`flow-matrix-data-row transition-colors hover:bg-[var(--primary)]/[0.04] ${row.strong ? "bg-[var(--bg-surface)]/40" : ""}`}>
                        <td className={`flow-matrix-row-label sticky left-0 z-10 px-3 py-2 border-b border-[var(--border)]/30 whitespace-nowrap shadow-[1px_0_0_var(--border)] ${row.strong ? "font-bold text-[var(--text)] bg-[var(--bg-surface)]/40" : row.indent ? "pl-6 text-[var(--text-muted)] bg-[var(--bg-card)]" : "text-[var(--text-muted)] bg-[var(--bg-card)]"}`}>{row.label}<MetricInfo rowKey={row.key} /></td>
                        {months.map((mo) => {
                          const v = cellValue(row, mo);
                          const neg = v != null && v < 0;
                          const clickable = canDetail(row, v);
                          return (
                            <td key={mo}
                              onClick={clickable ? () => setDetail({ rowKey: row.key, label: row.label, mo }) : undefined}
                              title={clickable ? "클릭하면 구성 내역을 봅니다" : undefined}
                              className={`flow-matrix-cell px-2.5 py-2 text-right mono-number border-b border-[var(--border)]/30 ${row.strong ? "font-bold" : ""} ${neg ? "text-[var(--danger)]" : "text-[var(--text)]"} ${clickable ? "cursor-pointer hover:bg-[var(--primary)]/10 hover:underline decoration-dotted underline-offset-2" : ""}`}>
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
        <div className="flow-matrix-legend px-4 py-3 text-[10px] text-[var(--text-dim)] leading-relaxed border-t border-[var(--border)]/40">
          <span className="inline-block px-1.5 py-0.5 rounded-full bg-[var(--success)]/12 text-[var(--success)] font-bold mr-1">실적</span> 과거 월=자동집계(다른 화면과 동일 소스) ·
          <span className="inline-block px-1.5 py-0.5 rounded-full bg-[var(--warning)]/12 text-[var(--warning)] font-bold mx-1">예측</span> 미래 월=예산/예측. 부가세=분기 매출세액−매입세액을 신고월(4·7·10·익1)에 표기.
          금액 모드에서 셀을 클릭하면 구성 내역이 열립니다.
        </div>
      </div>

      {detail && companyId && (() => {
        const cd = RECORD_BACKED_KEYS.has(detail.rowKey) ? null : clientDetail(detail.rowKey, detail.mo);
        return (
          <CellDetail
            companyId={companyId}
            year={year}
            month={detail.mo}
            rowKey={detail.rowKey}
            title={detail.label}
            clientItems={cd?.items ?? null}
            note={cd?.note}
            showTotal={cd?.showTotal ?? true}
            onClose={() => setDetail(null)}
          />
        );
      })()}
    </div>
  );
}
