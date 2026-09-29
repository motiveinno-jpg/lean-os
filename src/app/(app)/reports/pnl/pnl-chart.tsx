"use client";

import { useEffect, useRef, useState } from "react";
import { fmtAxisKrw, niceTicks, monotonePath } from "@/lib/chart-axis";

interface MonthlyRow { [month: string]: number }
interface PnlChartProps {
  months: string[];
  totalRevenue: MonthlyRow;
  totalExpenses: MonthlyRow;
  netIncome: MonthlyRow;
}

//   그림 폭은 상자 폭을 재서 쓴다. 예전엔 viewBox 600 고정 + 높이 220 이라 넓은 화면에서 폭의 2/3 만 그려졌다.
const H = 260, PT = 16, PB = 32, PL = 64, PR = 16;
const DRAW_H = H - PT - PB;
const BAR_GAP = 4;

function fmtMonth(m: string): string {
  return `${parseInt(m.split("-")[1], 10)}월`;
}

/** 상자 폭 — 창 크기·사이드바 접힘에 따라 다시 잰다 */
function useBoxWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T | null>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => { const v = Math.round(el.clientWidth); if (v > 0) setW(v); };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

export default function PnlChart({ months, totalRevenue, totalExpenses, netIncome }: PnlChartProps) {
  const [boxRef, W] = useBoxWidth<HTMLDivElement>(600);
  const DRAW_W = Math.max(120, W - PL - PR);
  const rev = months.map((m) => totalRevenue[m] || 0);
  const exp = months.map((m) => totalExpenses[m] || 0);
  const net = months.map((m) => netIncome[m] || 0);
  const all = [...rev, ...exp, ...net];
  //   눈금 = 보기 좋은 값(1·2·2.5·5 × 10ⁿ), 0 을 늘 포함 — 축 범위는 눈금 끝에 맞춘다
  const { lo: yMin, hi: yMax, ticks } = niceTicks(Math.min(...all, 0), Math.max(...all, 0), 4);
  const yRange = yMax - yMin || 1;
  const toY = (v: number) => PT + DRAW_H * (1 - (v - yMin) / yRange);
  const zeroY = toY(0);
  const n = months.length;

  /** Returns groupX and groupWidth for bar group at index i */
  const groupAt = (i: number) => {
    const gx = PL + (i / n) * DRAW_W;
    const gw = DRAW_W / n;
    return { gx, gw, cx: gx + gw / 2 };
  };

  //   순이익 곡선 — 단조 보간. 일반 스무딩은 급등락 자리에서 곡선이 0 아래로 출렁여 없던 적자를 그렸다
  const netPoints = months.map((_, i) => { const { cx } = groupAt(i); return { x: cx, y: toY(net[i]) }; });
  const netPath = monotonePath(netPoints);
  //   막대는 너무 넓으면 뭉툭하다 — 한 달 칸이 넓어도 막대 하나는 28px 까지만
  const barW = (gw: number) => Math.min(28, (gw - BAR_GAP * 3) / 2);

  return (
    <div className="pnl-chart-card glass-card">
      <div className="pnl-chart-header">
        <h3 className="text-sm font-bold text-[var(--text)]">월별 매출 vs 비용 추이</h3>
        <p className="text-[10px] text-[var(--text-dim)] mt-0.5">매출/비용 막대 + 당기순이익 선</p>
      </div>
      <div ref={boxRef} className="pnl-chart-box">
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="pnl-chart-svg-fluid" role="img" aria-label="월별 매출·비용·당기순이익">
          <defs>
            <linearGradient id="pnlRevGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--viz-brand)" stopOpacity="0.7" />
              <stop offset="100%" stopColor="var(--viz-brand)" stopOpacity="0.42" />
            </linearGradient>
            <linearGradient id="pnlExpGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--viz-brand)" stopOpacity="0.26" />
              <stop offset="100%" stopColor="var(--viz-brand)" stopOpacity="0.15" />
            </linearGradient>
          </defs>
          {ticks.map((v) => {
            const y = toY(v);
            return (
              <g key={v}>
                {v !== 0 && <line x1={PL} y1={y} x2={W - PR} y2={y} stroke="var(--border)" strokeDasharray="3 3" strokeWidth={0.5} opacity={0.5} />}
                <text x={PL - 8} y={y + 4} textAnchor="end" fontSize={11} fill="var(--text-dim)">{fmtAxisKrw(v)}</text>
              </g>
            );
          })}
          <line x1={PL} y1={zeroY} x2={W - PR} y2={zeroY} stroke="var(--text-muted)" strokeWidth={0.6} opacity={0.5} />

          {months.map((_, i) => {
            const { gx, gw } = groupAt(i);
            const bw = barW(gw);
            const x0 = gx + (gw - (bw * 2 + BAR_GAP)) / 2;
            const rY = toY(rev[i]), eY = toY(exp[i]);
            return (
              <g key={i}>
                <rect x={x0} y={Math.min(rY, zeroY)} width={bw} height={Math.max(Math.abs(zeroY - rY), 1)} rx={4} fill="url(#pnlRevGrad)" />
                <rect x={x0 + bw + BAR_GAP} y={Math.min(eY, zeroY)} width={bw} height={Math.max(Math.abs(zeroY - eY), 1)} rx={4} fill="url(#pnlExpGrad)" />
              </g>
            );
          })}

          <path d={netPath} fill="none" stroke="var(--viz-pos)" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
          {months.map((m, i) => {
            const { cx } = groupAt(i);
            return (
              <circle key={i} cx={cx} cy={toY(net[i])} r={3.5} fill="var(--viz-pos)" stroke="var(--bg-card)" strokeWidth={1.5}>
                <title>{`${fmtMonth(m)} · 매출 ${Math.round(rev[i]).toLocaleString("ko-KR")} · 총 비용 ${Math.round(exp[i]).toLocaleString("ko-KR")} · 당기순이익 ${Math.round(net[i]).toLocaleString("ko-KR")}`}</title>
              </circle>
            );
          })}

          {months.map((m, i) => {
            const { cx } = groupAt(i);
            return <text key={m} x={cx} y={H - 8} textAnchor="middle" fontSize={12} fill="var(--text-muted)" fontWeight={500}>{fmtMonth(m)}</text>;
          })}
        </svg>
      </div>
      <div className="pnl-chart-legend">
        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border border-[var(--viz-brand)]/30 bg-[var(--viz-brand)]/10 text-[var(--viz-brand)]">
          <span className="w-2 h-2 rounded-full bg-[var(--viz-brand)]" />매출
        </span>
        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border border-[var(--viz-brand)]/20 bg-[var(--viz-brand)]/5 text-[var(--text-muted)]">
          <span className="w-2 h-2 rounded-full" style={{ background: "color-mix(in srgb, var(--viz-brand) 35%, transparent)" }} />총 비용
        </span>
        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border border-[var(--viz-pos)]/30 bg-[var(--viz-pos)]/10 text-[var(--viz-pos)]">
          <span className="w-2 h-2 rounded-full bg-[var(--viz-pos)]" />당기순이익
        </span>
      </div>
    </div>
  );
}
