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

  // Find max value for scaling
  const allValues = data.flatMap(g => g.values.map(v => v.value));
  const trendMax = trendLine ? Math.max(...trendLine) : 0;
  const maxVal = Math.max(...allValues, trendMax, 1);

  // SVG trend line points
  const barWidth = 100 / data.length;
  const trendPoints = trendLine
    ? trendLine.map((v, i) => {
        const x = barWidth * i + barWidth / 2;
        const y = 100 - (v / maxVal) * 100;
        return `${x},${y}`;
      }).join(' ')
    : null;

  return (
    <div className="relative" style={{ height }}>
      {/* Y-axis labels */}
      <div className="absolute left-0 top-0 bottom-4 w-12 flex flex-col justify-between text-[9px] text-[var(--text-dim)] mono-number">
        <span>{fmtShort(maxVal)}</span>
        <span>{fmtShort(maxVal / 2)}</span>
        <span>0</span>
      </div>

      {/* Chart area */}
      <div className="ml-12 h-full flex flex-col">
        <div className="flex-1 flex items-end gap-1 relative">
          {/* Grid lines */}
          <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
            {[0, 1, 2].map(i => (
              <div key={i} className="border-b border-[var(--border)] opacity-30" />
            ))}
          </div>

          {/* Bars */}
          {data.map((group, gi) => (
            <div
              key={gi}
              className={`flex-1 flex items-end gap-0.5 cursor-pointer rounded-t transition-all ${hover === gi ? 'bg-[var(--bg-surface)]' : ''}`}
              onClick={() => onBarClick?.(gi)}
              onMouseEnter={() => setHover(gi)}
              onMouseLeave={() => setHover(null)}
            >
              {group.values.map((v, vi) => {
                const pct = maxVal > 0 ? (v.value / maxVal) * 100 : 0;
                return (
                  <div key={vi} className="flex-1 flex flex-col items-center justify-end relative group">
                    <div
                      className="w-full rounded-t transition-all duration-300"
                      style={{
                        height: `${Math.max(pct, 1)}%`,
                        background: v.color,
                        opacity: hover === gi ? 1 : 0.85,
                        minHeight: 2,
                      }}
                    />
                    {/* Tooltip */}
                    {hover === gi && (
                      <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-[var(--bg-elevated)] border border-[var(--border)] rounded px-1.5 py-0.5 text-[9px] text-[var(--text)] whitespace-nowrap z-10 mono-number">
                        {v.label}: ₩{v.value.toLocaleString()}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}

          {/* SVG Trend Line Overlay */}
          {trendPoints && (
            <svg className="absolute inset-0 pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
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
                const y = 100 - (v / maxVal) * 100;
                return <circle key={i} cx={x} cy={y} r="1.2" fill={trendColor} vectorEffect="non-scaling-stroke" />;
              })}
            </svg>
          )}
        </div>

        {/* X-axis labels */}
        <div className="flex mt-1">
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
  if (n >= 1e8) return `${(n / 1e8).toFixed(0)}억`;
  if (n >= 1e4) return `${Math.round(n / 1e4)}만`;
  return n.toLocaleString();
}
