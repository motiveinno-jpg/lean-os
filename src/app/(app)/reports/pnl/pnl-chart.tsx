"use client";

interface MonthlyRow { [month: string]: number }
interface PnlChartProps {
  months: string[];
  totalRevenue: MonthlyRow;
  totalExpenses: MonthlyRow;
  netIncome: MonthlyRow;
}

const H = 260, PT = 24, PB = 32, PL = 64, PR = 16, W = 600;
const DRAW_W = W - PL - PR;
const DRAW_H = H - PT - PB;
const GRID_COUNT = 5;
const BAR_GAP = 4;

function fmtAxis(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e8) return `${(v / 1e8).toFixed(1)}억`;
  if (a >= 1e4) return `${Math.round(v / 1e4)}만`;
  return v.toLocaleString("ko-KR");
}

function fmtMonth(m: string): string {
  return `${parseInt(m.split("-")[1], 10)}월`;
}

function LegendItem({ color, label, isLine }: { color: string; label: string; isLine?: boolean }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ width: 12, height: isLine ? 4 : 12, borderRadius: isLine ? 2 : 3, background: color, opacity: isLine ? 1 : 0.85, flexShrink: 0 }} />
      {label}
    </span>
  );
}

export default function PnlChart({ months, totalRevenue, totalExpenses, netIncome }: PnlChartProps) {
  const rev = months.map((m) => totalRevenue[m] || 0);
  const exp = months.map((m) => totalExpenses[m] || 0);
  const net = months.map((m) => netIncome[m] || 0);
  const all = [...rev, ...exp, ...net];
  const rMax = Math.max(...all, 0), rMin = Math.min(...all, 0);
  const span = rMax - rMin || 1;
  const yMax = rMax + span * 0.1, yMin = rMin - span * 0.1, yRange = yMax - yMin;
  const toY = (v: number) => PT + DRAW_H * (1 - (v - yMin) / yRange);
  const zeroY = toY(0);
  const n = months.length;

  /** Returns groupX and groupWidth for bar group at index i */
  const groupAt = (i: number) => {
    const gx = PL + (i / n) * DRAW_W;
    const gw = DRAW_W / n;
    return { gx, gw, cx: gx + gw / 2 };
  };

  const gridVals = Array.from({ length: GRID_COUNT }, (_, i) => yMin + (yRange * (i + 1)) / (GRID_COUNT + 1));

  return (
    <div style={{ marginBottom: 28, borderRadius: 12, border: "1px solid var(--border)", background: "var(--bg-card)", padding: "20px 20px 12px" }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", marginBottom: 16 }}>
        월별 매출 vs 비용 추이
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet" style={{ display: "block" }}>
        {gridVals.map((v, i) => {
          const y = toY(v);
          return (
            <g key={i}>
              <line x1={PL} y1={y} x2={W - PR} y2={y} stroke="var(--border)" strokeDasharray="4 3" strokeWidth={0.5} />
              <text x={PL - 8} y={y + 4} textAnchor="end" fontSize={10} fill="var(--text-dim)">{fmtAxis(Math.round(v))}</text>
            </g>
          );
        })}
        <line x1={PL} y1={zeroY} x2={W - PR} y2={zeroY} stroke="var(--text-muted)" strokeWidth={0.5} opacity={0.5} />

        {months.map((_, i) => {
          const { gx, gw } = groupAt(i);
          const bw = (gw - BAR_GAP * 3) / 2;
          const rY = toY(rev[i]), eY = toY(exp[i]);
          return (
            <g key={i}>
              <rect x={gx + BAR_GAP} y={Math.min(rY, zeroY)} width={bw} height={Math.max(Math.abs(zeroY - rY), 1)} rx={3} fill="var(--primary)" opacity={0.85} />
              <rect x={gx + BAR_GAP + bw + BAR_GAP} y={Math.min(eY, zeroY)} width={bw} height={Math.max(Math.abs(zeroY - eY), 1)} rx={3} fill="#f97316" opacity={0.75} />
            </g>
          );
        })}

        <polyline
          points={months.map((_, i) => { const { cx } = groupAt(i); return `${cx},${toY(net[i])}`; }).join(" ")}
          fill="none" stroke="#10b981" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"
        />
        {months.map((_, i) => {
          const { cx } = groupAt(i);
          return <circle key={i} cx={cx} cy={toY(net[i])} r={4} fill="#10b981" stroke="var(--bg-card)" strokeWidth={2} />;
        })}

        {months.map((m, i) => {
          const { cx } = groupAt(i);
          return <text key={m} x={cx} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--text-muted)">{fmtMonth(m)}</text>;
        })}
      </svg>
      <div style={{ display: "flex", gap: 20, justifyContent: "center", marginTop: 8, fontSize: 12, color: "var(--text-muted)" }}>
        <LegendItem color="var(--primary)" label="매출" />
        <LegendItem color="#f97316" label="총 비용 (원가+운영비)" />
        <LegendItem color="#10b981" label="당기순이익" isLine />
      </div>
    </div>
  );
}
