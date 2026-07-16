"use client";

/* 인원별 급여 막대.
   reports/pnl/pnl-chart.tsx 의 막대/그리드 패턴 재사용 (인원 축으로 변형). */

interface Row { [person: string]: number }
interface ByPersonChartProps {
  people: string[];
  payByPerson: Row;
}

const H = 280, PT = 24, PB = 56, PL = 64, PR = 16, W = 600;
const DRAW_W = W - PL - PR;
const DRAW_H = H - PT - PB;
const GRID_COUNT = 5;
const BAR_GAP = 8;
const MAX_BARS = 12;

function fmtAxis(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e8) return `${(v / 1e8).toFixed(1)}억`;
  if (a >= 1e4) return `${Math.round(v / 1e4)}만`;
  return v.toLocaleString("ko-KR");
}

function shortName(s: string): string {
  return s.length > 5 ? s.slice(0, 5) + "…" : s;
}

export default function ByPersonChart({ people, payByPerson }: ByPersonChartProps) {
  // 급여 기준 상위 MAX_BARS 명만 (나머지는 표에서 확인)
  const ranked = [...people]
    .map((p) => ({ p, total: payByPerson[p] || 0 }))
    .sort((a, b) => b.total - a.total)
    .slice(0, MAX_BARS)
    .map((x) => x.p);

  const pay = ranked.map((p) => payByPerson[p] || 0);
  const yMax = Math.max(...pay, 1) * 1.12;
  const toY = (v: number) => PT + DRAW_H * (1 - v / yMax);
  const n = ranked.length || 1;

  const groupAt = (i: number) => {
    const gw = DRAW_W / n;
    const gx = PL + i * gw;
    return { gx, gw, cx: gx + gw / 2 };
  };

  const gridVals = Array.from({ length: GRID_COUNT }, (_, i) => (yMax * (i + 1)) / (GRID_COUNT + 1));

  return (
    <div className="by-person-chart-card glass-card">
      <div className="by-person-chart-header">
        <h3 className="text-sm font-bold text-[var(--text)]">인원별 급여</h3>
        <p className="text-[10px] text-[var(--text-dim)] mt-0.5">상위 {MAX_BARS}명 · 연 급여 합계</p>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet" className="by-person-chart-svg">
        <defs>
          <linearGradient id="bpPayGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--warning)" stopOpacity="0.95" />
            <stop offset="100%" stopColor="var(--warning)" stopOpacity="0.6" />
          </linearGradient>
          <linearGradient id="bpCardGrad" x1="0" y1="0" x2="0" y2="1">
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

        {ranked.map((_, i) => {
          const { gx, gw } = groupAt(i);
          const bw = Math.max(gw - BAR_GAP * 2, 4);
          const bx = gx + BAR_GAP;
          const baseY = toY(0);
          const payTop = toY(pay[i]);
          return (
            <g key={i}>
              <rect x={bx} y={payTop} width={bw} height={Math.max(baseY - payTop, 0)} rx={3} fill="url(#bpPayGrad)" />
            </g>
          );
        })}

        {ranked.map((p, i) => {
          const { cx } = groupAt(i);
          return (
            <text
              key={p}
              x={cx}
              y={H - 30}
              textAnchor="end"
              fontSize={11}
              fill="var(--text-muted)"
              fontWeight={500}
              transform={`rotate(-40 ${cx} ${H - 30})`}
            >
              {shortName(p)}
            </text>
          );
        })}
      </svg>
      <div className="by-person-chart-legend">
        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border border-[var(--warning)]/30 bg-[var(--warning-dim)] text-[var(--warning)]">
          <span className="w-2 h-2 rounded-full bg-[var(--warning)]" />급여
        </span>
      </div>
    </div>
  );
}
