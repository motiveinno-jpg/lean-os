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
    // transform:translateZ(0) — 자체 컴포지팅 레이어 격리(스크롤 시 고정 배경 위 페인트 잔상 방지)
    <div className="relative" style={{ height, transform: "translateZ(0)" }}>
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
            className="absolute inset-0 w-full h-full overflow-hidden"
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
              // Smooth Catmull-Rom bezier
              const points = s.values.map((v, i) => ({ x: stepX * i, y: yToSvg(v) }));
              const buildSmooth = (): string => {
                if (points.length === 0) return "";
                if (points.length === 1) return `M${points[0].x},${points[0].y}`;
                let d = `M${points[0].x},${points[0].y}`;
                for (let i = 0; i < points.length - 1; i++) {
                  const p0 = points[i - 1] || points[i];
                  const p1 = points[i];
                  const p2 = points[i + 1];
                  const p3 = points[i + 2] || p2;
                  const t = 0.18;
                  const c1x = p1.x + (p2.x - p0.x) * t;
                  const c1y = p1.y + (p2.y - p0.y) * t;
                  const c2x = p2.x - (p3.x - p1.x) * t;
                  const c2y = p2.y - (p3.y - p1.y) * t;
                  d += ` C${c1x},${c1y} ${c2x},${c2y} ${p2.x},${p2.y}`;
                }
                return d;
              };
              const linePath = buildSmooth();
              const areaPath = s.area && points.length > 0
                ? `${linePath} L${points[points.length - 1].x},${zeroY} L${points[0].x},${zeroY} Z`
                : null;
              const gradId = `lcgrad-${si}`;
              return (
                <g key={si}>
                  {areaPath && (
                    <>
                      <defs>
                        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={s.color} stopOpacity="0.35" />
                          <stop offset="100%" stopColor={s.color} stopOpacity="0.02" />
                        </linearGradient>
                      </defs>
                      <path d={areaPath} fill={`url(#${gradId})`} />
                    </>
                  )}
                  <path
                    d={linePath}
                    fill="none"
                    stroke={s.color}
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                  {s.values.map((v, i) => (
                    <circle
                      key={i}
                      cx={stepX * i}
                      cy={yToSvg(v)}
                      r={hover === i ? 2.2 : 1.4}
                      fill={s.color}
                      stroke="var(--bg-card)"
                      strokeWidth={hover === i ? "1.2" : "0.8"}
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
