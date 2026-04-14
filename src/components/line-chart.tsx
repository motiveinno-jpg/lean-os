"use client";

import { useState } from "react";

export interface LineSeries {
  label: string;
  color: string;
  values: number[];
  area?: boolean;
}

interface LineChartProps {
  labels: string[];
  series: LineSeries[];
  height?: number;
  formatY?: (v: number) => string;
  showZeroLine?: boolean;
}

function fmtShortKR(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(1)}억`;
  if (abs >= 1e4) return `${sign}${Math.round(abs / 1e4)}만`;
  return `${sign}${abs.toLocaleString()}`;
}

export function LineChart({
  labels,
  series,
  height = 220,
  formatY = fmtShortKR,
  showZeroLine = true,
}: LineChartProps) {
  const [hover, setHover] = useState<number | null>(null);

  if (labels.length === 0 || series.length === 0) {
    return <div className="text-xs text-[var(--text-dim)] text-center py-8">데이터 없음</div>;
  }

  const allValues = series.flatMap((s) => s.values);
  const rawMax = Math.max(...allValues, 0);
  const rawMin = Math.min(...allValues, 0);
  const span = rawMax - rawMin || 1;
  const padding = span * 0.1;
  const yMax = rawMax + padding;
  const yMin = rawMin - padding;
  const yRange = yMax - yMin || 1;

  const W = 100;
  const H = 100;
  const stepX = labels.length > 1 ? W / (labels.length - 1) : W;

  const yToSvg = (v: number) => H - ((v - yMin) / yRange) * H;
  const zeroY = yToSvg(0);

  return (
    <div className="relative" style={{ height }}>
      <div className="absolute left-0 top-0 bottom-5 w-12 flex flex-col justify-between text-[9px] text-[var(--text-dim)] mono-number text-right pr-1">
        <span>{formatY(yMax)}</span>
        <span>{formatY((yMax + yMin) / 2)}</span>
        <span>{formatY(yMin)}</span>
      </div>

      <div className="ml-12 h-full flex flex-col">
        <div className="flex-1 relative">
          {/* Grid */}
          <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
            {[0, 1, 2].map((i) => (
              <div key={i} className="border-b border-[var(--border)] opacity-30" />
            ))}
          </div>

          <svg
            className="absolute inset-0 w-full h-full overflow-visible"
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
          >
            {/* Zero baseline */}
            {showZeroLine && yMin < 0 && yMax > 0 && (
              <line
                x1="0"
                y1={zeroY}
                x2={W}
                y2={zeroY}
                stroke="var(--text-dim)"
                strokeWidth="0.4"
                strokeDasharray="1.5,1.5"
                vectorEffect="non-scaling-stroke"
                opacity="0.5"
              />
            )}

            {series.map((s, si) => {
              const points = s.values
                .map((v, i) => `${stepX * i},${yToSvg(v)}`)
                .join(" ");
              const areaPoints = s.area
                ? `0,${zeroY} ${points} ${stepX * (s.values.length - 1)},${zeroY}`
                : null;
              const gradId = `lcgrad-${si}`;
              return (
                <g key={si}>
                  {areaPoints && (
                    <>
                      <defs>
                        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={s.color} stopOpacity="0.35" />
                          <stop offset="100%" stopColor={s.color} stopOpacity="0.02" />
                        </linearGradient>
                      </defs>
                      <polygon points={areaPoints} fill={`url(#${gradId})`} />
                    </>
                  )}
                  <polyline
                    points={points}
                    fill="none"
                    stroke={s.color}
                    strokeWidth="1.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                  {s.values.map((v, i) => (
                    <circle
                      key={i}
                      cx={stepX * i}
                      cy={yToSvg(v)}
                      r={hover === i ? 1.8 : 1.2}
                      fill={s.color}
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
                </g>
              );
            })}

            {/* Hover hit areas */}
            {labels.map((_, i) => (
              <rect
                key={i}
                x={stepX * i - stepX / 2}
                y="0"
                width={stepX}
                height={H}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                style={{ cursor: "pointer" }}
              />
            ))}

            {hover !== null && (
              <line
                x1={stepX * hover}
                y1="0"
                x2={stepX * hover}
                y2={H}
                stroke="var(--text-muted)"
                strokeWidth="0.4"
                vectorEffect="non-scaling-stroke"
                opacity="0.4"
                pointerEvents="none"
              />
            )}
          </svg>

          {/* Tooltip */}
          {hover !== null && (
            <div
              className="absolute -top-1 z-10 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-md px-2 py-1.5 text-[10px] shadow-md pointer-events-none whitespace-nowrap"
              style={{
                left: `${(stepX * hover * 100) / W}%`,
                transform:
                  hover < labels.length / 2
                    ? "translate(8px, 0)"
                    : "translate(calc(-100% - 8px), 0)",
              }}
            >
              <div className="font-semibold text-[var(--text)] mb-0.5">
                {labels[hover]}
              </div>
              {series.map((s) => (
                <div key={s.label} className="flex items-center gap-1.5">
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ background: s.color }}
                  />
                  <span className="text-[var(--text-muted)]">{s.label}:</span>
                  <span className="mono-number text-[var(--text)] font-semibold">
                    {formatY(s.values[hover])}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex mt-1">
          {labels.map((l, i) => (
            <div
              key={i}
              className="flex-1 text-center text-[9px] truncate text-[var(--text-dim)]"
              style={{ minWidth: 0 }}
            >
              {l}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
