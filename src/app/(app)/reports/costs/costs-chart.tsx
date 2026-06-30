"use client";

/* 고정비 vs 변동비 월별 막대 차트.
   reports/pnl/pnl-chart.tsx 의 그룹 막대 패턴 재사용 (스택형으로 변형). */

interface MonthlyRow { [month: string]: number }
interface CostsChartProps {
  months: string[];
  fixed: MonthlyRow;
  variable: MonthlyRow;
}

const H = 260, PT = 24, PB = 32, PL = 64, PR = 16, W = 600;
const DRAW_W = W - PL - PR;
const DRAW_H = H - PT - PB;
const GRID_COUNT = 5;
const BAR_GAP = 6;

function fmtAxis(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e8) return `${(v / 1e8).toFixed(1)}억`;
  if (a >= 1e4) return `${Math.round(v / 1e4)}만`;
  return v.toLocaleString("ko-KR");
}

function fmtMonth(m: string): string {
  return `${parseInt(m.split("-")[1], 10)}월`;
}

export default function CostsChart({ months, fixed, variable }: CostsChartProps) {
  const fx = months.map((m) => fixed[m] || 0);
  const vr = months.map((m) => variable[m] || 0);
  const stacked = months.map((_, i) => fx[i] + vr[i]);
  const yMax = Math.max(...stacked, 1) * 1.12;
  const toY = (v: number) => PT + DRAW_H * (1 - v / yMax);
  const n = months.length || 1;

  const groupAt = (i: number) => {
    const gw = DRAW_W / n;
    const gx = PL + i * gw;
    return { gx, gw, cx: gx + gw / 2 };
  };

  const gridVals = Array.from({ length: GRID_COUNT }, (_, i) => (yMax * (i + 1)) / (GRID_COUNT + 1));

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-gradient-to-br from-[var(--bg-card)] to-[var(--bg-surface)]/40 p-5 shadow-sm">
      <div className="mb-4">
        <h3 className="text-sm font-bold text-[var(--text)]">월별 고정비 vs 변동비</h3>
        <p className="text-[10px] text-[var(--text-dim)] mt-0.5">아래쪽 = 고정비, 위쪽 = 변동비 (쌓아 올린 총비용)</p>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ display: "block", height: 200, width: "auto", maxWidth: "100%", margin: "0 auto" }}>
        <defs>
          <linearGradient id="costFixedGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f97316" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#f97316" stopOpacity="0.6" />
          </linearGradient>
          <linearGradient id="costVarGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.6" />
          </linearGradient>
        </defs>

        {gridVals.map((v, i) => {
          const y = toY(v);
          return (
            <g key={i}>
              <line x1={PL} y1={y} x2={W - PR} y2={y} stroke="var(--border)" strokeDasharray="3 3" strokeWidth={0.5} opacity={0.5} />
              <text x={PL - 8} y={y + 4} textAnchor="end" fontSize={11} fill="var(--text-dim)">{fmtAxis(Math.round(v))}</text>
            </g>
          );
        })}
        <line x1={PL} y1={toY(0)} x2={W - PR} y2={toY(0)} stroke="var(--text-muted)" strokeWidth={0.6} opacity={0.5} />

        {months.map((_, i) => {
          const { gx, gw } = groupAt(i);
          const bw = Math.max(gw - BAR_GAP * 2, 4);
          const bx = gx + BAR_GAP;
          const baseY = toY(0);
          const fxTop = toY(fx[i]);
          const totTop = toY(fx[i] + vr[i]);
          return (
            <g key={i}>
              <rect x={bx} y={fxTop} width={bw} height={Math.max(baseY - fxTop, 0)} rx={3} fill="url(#costFixedGrad)" />
              <rect x={bx} y={totTop} width={bw} height={Math.max(fxTop - totTop, 0)} rx={3} fill="url(#costVarGrad)" />
            </g>
          );
        })}

        {months.map((m, i) => {
          const { cx } = groupAt(i);
          return <text key={m} x={cx} y={H - 8} textAnchor="middle" fontSize={12} fill="var(--text-muted)" fontWeight={500}>{fmtMonth(m)}</text>;
        })}
      </svg>
      <div className="flex flex-wrap gap-2 justify-center mt-3">
        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border border-orange-500/30 bg-orange-500/10 text-orange-500">
          <span className="w-2 h-2 rounded-full bg-orange-500" />고정비
        </span>
        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border border-violet-500/30 bg-violet-500/10 text-violet-500">
          <span className="w-2 h-2 rounded-full bg-violet-500" />변동비
        </span>
      </div>
    </div>
  );
}
