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

  // 부드러운 순이익 라인 (Catmull-Rom)
  const buildSmooth = (pts: { x: number; y: number }[]): string => {
    if (pts.length === 0) return "";
    if (pts.length === 1) return `M${pts[0].x},${pts[0].y}`;
    let d = `M${pts[0].x},${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[i + 2] || p2;
      const t = 0.18;
      const c1x = p1.x + (p2.x - p0.x) * t;
      const c1y = p1.y + (p2.y - p0.y) * t;
      const c2x = p2.x - (p3.x - p1.x) * t;
      const c2y = p2.y - (p3.y - p1.y) * t;
      d += ` C${c1x},${c1y} ${c2x},${c2y} ${p2.x},${p2.y}`;
    }
    return d;
  };
  const netPoints = months.map((_, i) => { const { cx } = groupAt(i); return { x: cx, y: toY(net[i]) }; });
  const netPath = buildSmooth(netPoints);

  return (
    <div className="glass-card mb-7 p-5">
      <div className="mb-4">
        <h3 className="text-sm font-bold text-[var(--text)]">월별 매출 vs 비용 추이</h3>
        <p className="text-[10px] text-[var(--text-dim)] mt-0.5">매출/비용 막대 + 당기순이익 곡선</p>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ display: "block", height: 220, width: "auto", maxWidth: "100%", margin: "0 auto" }}>
        <defs>
          <linearGradient id="pnlRevGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.95" />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.55" />
          </linearGradient>
          <linearGradient id="pnlExpGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.40" />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.20" />
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
        <line x1={PL} y1={zeroY} x2={W - PR} y2={zeroY} stroke="var(--text-muted)" strokeWidth={0.6} opacity={0.5} />

        {months.map((_, i) => {
          const { gx, gw } = groupAt(i);
          const bw = (gw - BAR_GAP * 3) / 2;
          const rY = toY(rev[i]), eY = toY(exp[i]);
          return (
            <g key={i}>
              <rect x={gx + BAR_GAP} y={Math.min(rY, zeroY)} width={bw} height={Math.max(Math.abs(zeroY - rY), 1)} rx={4} fill="url(#pnlRevGrad)" />
              <rect x={gx + BAR_GAP + bw + BAR_GAP} y={Math.min(eY, zeroY)} width={bw} height={Math.max(Math.abs(zeroY - eY), 1)} rx={4} fill="url(#pnlExpGrad)" />
            </g>
          );
        })}

        <path d={netPath} fill="none" stroke="var(--success)" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
        {months.map((_, i) => {
          const { cx } = groupAt(i);
          return <circle key={i} cx={cx} cy={toY(net[i])} r={4.5} fill="var(--success)" stroke="var(--bg-card)" strokeWidth={2} />;
        })}

        {months.map((m, i) => {
          const { cx } = groupAt(i);
          return <text key={m} x={cx} y={H - 8} textAnchor="middle" fontSize={12} fill="var(--text-muted)" fontWeight={500}>{fmtMonth(m)}</text>;
        })}
      </svg>
      <div className="flex flex-wrap gap-2 justify-center mt-3">
        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border border-[var(--primary)]/30 bg-[var(--primary)]/10 text-[var(--primary)]">
          <span className="dot-primary" />매출
        </span>
        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border border-[var(--primary)]/20 bg-[var(--primary)]/5 text-[var(--text-muted)]">
          <span className="w-2 h-2 rounded-full" style={{ background: "color-mix(in srgb, var(--primary) 35%, transparent)" }} />총 비용
        </span>
        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border border-[var(--success)]/30 bg-[var(--success-dim)] text-[var(--success)]">
          <span className="w-2 h-2 rounded-full bg-[var(--success)]" />당기순이익
        </span>
      </div>
    </div>
  );
}
