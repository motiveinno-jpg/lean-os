"use client";

export interface FunnelStage {
  label: string;
  count: number;
  amount: number;
  color: string;
}

interface FunnelChartProps {
  stages: FunnelStage[];
  height?: number;
}

function fmtKR(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(1)}억`;
  if (abs >= 1e4) return `${sign}${Math.round(abs / 1e4)}만`;
  return `${sign}${abs.toLocaleString()}`;
}

export function FunnelChart({ stages, height = 220 }: FunnelChartProps) {
  if (stages.length === 0) {
    return <div className="text-xs text-[var(--text-dim)] text-center py-8">데이터 없음</div>;
  }

  const maxCount = Math.max(...stages.map((s) => s.count), 1);
  const firstCount = stages[0].count; // keep 0 as 0 — conversion from 0 is 0%

  return (
    <>
      {/* Desktop: SVG funnel */}
      <div className="hidden md:block relative" style={{ height }}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full">
          {stages.map((s, i) => {
            const segH = 100 / stages.length;
            const yTop = i * segH;
            const yBot = (i + 1) * segH;
            const wTop = s.count > 0 ? (s.count / maxCount) * 90 : 4; // min 4% for visibility
            const nextStage = stages[i + 1];
            const rawNextCount = nextStage ? nextStage.count : 0;
            const wBot = rawNextCount > 0 ? (rawNextCount / maxCount) * 90 : (nextStage ? 4 : Math.max(wTop * 0.3, 2));
            const xTopL = 50 - wTop / 2;
            const xTopR = 50 + wTop / 2;
            const xBotL = 50 - wBot / 2;
            const xBotR = 50 + wBot / 2;
            const points = `${xTopL},${yTop} ${xTopR},${yTop} ${xBotR},${yBot} ${xBotL},${yBot}`;
            return (
              <polygon
                key={i}
                points={points}
                fill={s.color}
                opacity={0.7 + (i / stages.length) * 0.3}
                stroke="var(--bg-card)"
                strokeWidth="0.4"
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        </svg>

        {/* Labels overlay */}
        <div className="absolute inset-0 flex flex-col">
          {stages.map((s, i) => {
            const conv = i === 0 ? 100 : (firstCount > 0 ? (s.count / firstCount) * 100 : 0);
            return (
              <div
                key={i}
                className="flex-1 flex items-center justify-between px-3 text-[10px]"
                style={{ minHeight: 0 }}
              >
                <span className="font-semibold text-[var(--text)] bg-[var(--bg-card)]/80 px-1.5 py-0.5 rounded">
                  {s.label}
                </span>
                <div className="text-right bg-[var(--bg-card)]/80 px-1.5 py-0.5 rounded">
                  <div className="font-bold mono-number">{s.count}건</div>
                  <div className="text-[var(--text-muted)] mono-number">
                    ₩{fmtKR(s.amount)} · {conv.toFixed(0)}%
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Mobile: horizontal stacked bars */}
      <div className="md:hidden space-y-2">
        {stages.map((s, i) => {
          const widthPct = (maxCount > 0 && s.count > 0) ? (s.count / maxCount) * 100 : 0;
          const conv = i === 0 ? 100 : (firstCount > 0 ? (s.count / firstCount) * 100 : 0);
          return (
            <div key={i}>
              <div className="flex items-center justify-between text-[11px] mb-1">
                <span className="font-semibold text-[var(--text)]">{s.label}</span>
                <span className="text-[var(--text-muted)] mono-number">
                  {s.count}건 · ₩{fmtKR(s.amount)}{" "}
                  <span className="text-[var(--text-dim)]">({conv.toFixed(0)}%)</span>
                </span>
              </div>
              <div className="h-2 rounded-full bg-[var(--bg-surface)] overflow-hidden">
                <div
                  className="h-full transition-all duration-500"
                  style={{ width: `${widthPct > 0 ? Math.max(widthPct, 2) : 0}%`, background: s.color }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
