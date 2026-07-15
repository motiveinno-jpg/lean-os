"use client";

import { useState } from "react";

interface BarGroup {
  label: string;
  values: Array<{ value: number; color: string; label: string }>;
}

interface BarChartProps {
  data: BarGroup[];
  height?: number;
  onBarClick?: (index: number) => void;
  trendLine?: number[]; // overlay polyline values
  trendColor?: string;
}

export function BarChart({ data, height = 220, onBarClick, trendLine, trendColor = 'var(--warning)' }: BarChartProps) {
  const [hover, setHover] = useState<number | null>(null);

  if (data.length === 0) return <div className="text-xs text-[var(--text-dim)] text-center py-8">데이터 없음</div>;

  // 스케일: bars(양수)와 trendLine(순이익 — 음수 가능)을 [axisMin, axisMax] 공통 축으로 정규화.
  //   axisMin 은 0 이하만(음수 trend 수용), 양수만 있으면 0 → 기존 동작과 동일(회귀 0).
  const allValues = data.flatMap(g => g.values.map(v => v.value));
  const trendVals = trendLine && trendLine.length ? trendLine : [];
  const axisMax = Math.max(...allValues, ...trendVals, 1);
  const axisMin = Math.min(...allValues, ...trendVals, 0);
  const range = (axisMax - axisMin) || 1;
  const clampPct = (n: number) => Math.max(0, Math.min(100, n));
  // 값 → y(0=상단,100=하단), 화면 밖 안 나가게 clamp.
  const yOf = (v: number) => clampPct(100 - ((v - axisMin) / range) * 100);
  const baseY = clampPct(100 - ((0 - axisMin) / range) * 100); // 0 기준선 위치

  // SVG trend line points
  const barWidth = 100 / data.length;
  const trendPoints = trendLine
    ? trendLine.map((v, i) => {
        const x = barWidth * i + barWidth / 2;
        const y = yOf(v);
        return `${x},${y}`;
      }).join(' ')
    : null;

  return (
    // transform:translateZ(0) — 자체 컴포지팅 레이어 격리(스크롤 시 고정 배경 위 페인트 잔상 방지)
    <div className="bar-chart relative [transform:translateZ(0)]" style={{ height }}>
      {/* Y-axis labels — min~max(음수 포함) 반영 */}
      <div className="bar-chart-y-axis absolute left-0 top-0 bottom-4 w-12 flex flex-col justify-between text-[9px] text-[var(--text-dim)] mono-number">
        <span>{fmtShort(axisMax)}</span>
        <span>{fmtShort((axisMax + axisMin) / 2)}</span>
        <span>{fmtShort(axisMin)}</span>
      </div>

      {/* Chart area */}
      <div className="bar-chart-area ml-12 h-full flex flex-col">
        <div className="bar-chart-plot flex-1 flex gap-1 relative">
          {/* Grid lines */}
          <div className="bar-chart-grid-lines absolute inset-0 flex flex-col justify-between pointer-events-none">
            {[0, 1, 2].map(i => (
              <div key={i} className="border-b border-[var(--border)] opacity-30" />
            ))}
          </div>

          {/* 0 기준선 — 음수 값이 있을 때만 (양/음 구분) */}
          {axisMin < 0 && (
            <div
              className="bar-chart-zero-line absolute left-0 right-0 border-t border-dashed border-[var(--text-dim)] opacity-60 pointer-events-none z-[1]"
              style={{ top: `${baseY}%` }}
            />
          )}

          {/* Bars — 0 기준선에서 위(양수)/아래(음수)로. 절대배치 + clamp 로 컨테이너 밖 안 나감 */}
          {data.map((group, gi) => (
            <div
              key={gi}
              className={`bar-chart-group flex-1 flex gap-0.5 h-full relative cursor-pointer rounded-t transition-all ${hover === gi ? 'bg-[var(--bg-surface)]' : ''}`}
              onClick={() => onBarClick?.(gi)}
              onMouseEnter={() => setHover(gi)}
              onMouseLeave={() => setHover(null)}
            >
              {group.values.map((v, vi) => {
                const yv = yOf(v.value);
                const topY = Math.min(yv, baseY);
                const bottomY = Math.max(yv, baseY);
                const hPct = Math.max(bottomY - topY, v.value !== 0 ? 1 : 0);
                const botPct = 100 - bottomY;
                return (
                  <div key={vi} className="flex-1 relative h-full group">
                    <div
                      className="absolute left-0 right-0 rounded-t transition-all duration-300"
                      style={{
                        bottom: `${botPct}%`,
                        height: `${hPct}%`,
                        background: v.color,
                        opacity: hover === gi ? 1 : 0.85,
                        minHeight: 2,
                      }}
                    />
                    {/* Tooltip */}
                    {hover === gi && (
                      <div className="bar-chart-tooltip absolute -top-8 left-1/2 -translate-x-1/2 bg-[var(--bg-elevated)] border border-[var(--border)] rounded px-1.5 py-0.5 text-[9px] text-[var(--text)] whitespace-nowrap z-10 mono-number">
                        {v.label}: ₩{v.value.toLocaleString()}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}

          {/* SVG Trend Line Overlay — paint-containment 래퍼로 박스 밖 페인트 원천 차단.
              (preserveAspectRatio=none + non-scaling-stroke 가 일부 브라우저서 박스 밖으로 번지던 버그 2026-06-10) */}
          {trendPoints && (
            <div
              className="bar-chart-trend-overlay absolute inset-0 overflow-hidden pointer-events-none z-[2] [contain:paint] [transform:translateZ(0)]"
            >
              <svg className="w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                <polyline
                  points={trendPoints}
                  fill="none"
                  stroke={trendColor}
                  strokeWidth="0.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
                {trendLine!.map((v, i) => {
                  const x = barWidth * i + barWidth / 2;
                  const y = yOf(v);
                  return <circle key={i} cx={x} cy={y} r="1.2" fill={trendColor} vectorEffect="non-scaling-stroke" />;
                })}
              </svg>
            </div>
          )}
        </div>

        {/* X-axis labels */}
        <div className="bar-chart-x-axis flex mt-1">
          {data.map((g, i) => (
            <div
              key={i}
              className={`flex-1 text-center text-[9px] truncate ${hover === i ? 'text-[var(--text)]' : 'text-[var(--text-dim)]'}`}
            >
              {g.label}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function fmtShort(n: number): string {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(0)}억`;
  if (abs >= 1e4) return `${sign}${Math.round(abs / 1e4)}만`;
  return n.toLocaleString();
}
