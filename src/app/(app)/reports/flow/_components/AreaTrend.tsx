"use client";

// 경영흐름 콕핏 공용 — 부드러운 영역 추이 차트 (무의존 SVG + HTML 오버레이).
//   · min-max 스케일(여백 16%)로 값 변동을 또렷하게 (절대값/0기준 정규화의 "평평한 직선" 문제 해소).
//   · 라인 stroke 는 vector-effect=non-scaling 으로 종횡비와 무관하게 균일.
//   · 점·라벨은 HTML 오버레이라 preserveAspectRatio=none 의 타원/글자 왜곡이 없다.
//   · 라이트/다크 자동 대응(색은 CSS 변수). 차트 라이브러리 미도입 기조 유지.

import { useId } from "react";

export type TrendTone = "normal" | "muted" | "danger";
export type TrendPoint = { label: string; value: number; tone?: TrendTone };

const fmtShort = (n: number) => {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(abs >= 1e9 ? 0 : 1)}억`;
  if (abs >= 1e4) return `${sign}${Math.round(abs / 1e4).toLocaleString("ko-KR")}만`;
  if (abs === 0) return "0";
  return `${sign}${Math.round(abs).toLocaleString("ko-KR")}`;
};

const toneColor = (t: TrendTone | undefined, accent: string) =>
  t === "danger" ? "var(--danger, var(--viz-neg))" : t === "muted" ? "var(--text-dim)" : accent;

// Catmull-Rom → 큐빅 베지어 (부드러운 곡선)
function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M${pts[0].x},${pts[0].y}`;
  let d = `M${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`;
  }
  return d;
}

export function AreaTrend({
  points,
  height = 120,
  accent = "var(--primary)",
  showValues = false,
  markerIndex,
}: {
  points: TrendPoint[];
  height?: number;
  accent?: string;
  showValues?: boolean;
  markerIndex?: number;
}) {
  const gid = useId().replace(/:/g, "");
  const n = points.length;
  if (n === 0) return <div className="text-xs text-[var(--text-dim)] py-6 text-center">표시할 데이터가 없습니다</div>;

  const vals = points.map((p) => p.value);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min;
  const pad = range > 0 ? range * 0.16 : Math.max(1, Math.abs(max) * 0.16);
  const lo = min - pad;
  const span = max + pad - lo || 1;
  const norm = (v: number) => (v - lo) / span; // 0(아래)~1(위)

  const X = (i: number) => (n > 1 ? (i / (n - 1)) * 100 : 50);
  const Y = (v: number) => (1 - norm(v)) * 100;

  const coords = points.map((p, i) => ({ x: X(i), y: Y(p.value) }));
  const line = smoothPath(coords);
  const area = `${line} L${coords[n - 1].x.toFixed(2)},100 L${coords[0].x.toFixed(2)},100 Z`;
  const zeroY = min < 0 && max > 0 ? Y(0) : null;

  return (
    <div className="area-trend">
      {showValues && (
        <div className="area-trend-values">
          {points.map((p, i) => (
            <div key={i} className="flex-1 text-center mono-number text-[11px] font-bold leading-none" style={{ color: toneColor(p.tone, accent) }}>
              {fmtShort(p.value)}
            </div>
          ))}
        </div>
      )}
      <div className="area-trend-chart" style={{ height }}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full overflow-visible">
          <defs>
            <linearGradient id={`at-${gid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={accent} stopOpacity="0.12" />
              <stop offset="100%" stopColor={accent} stopOpacity="0" />
            </linearGradient>
          </defs>
          {zeroY != null && (
            <line x1="0" y1={zeroY} x2="100" y2={zeroY} stroke="var(--danger, var(--viz-neg))" strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" opacity={0.4} />
          )}
          {markerIndex != null && n > 1 && (
            <line x1={X(markerIndex)} y1="0" x2={X(markerIndex)} y2="100" stroke="var(--text-dim)" strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" opacity={0.55} />
          )}
          <path d={area} fill={`url(#at-${gid})`} />
          <path d={line} fill="none" stroke={accent} strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
        {coords.map((c, i) => {
          const isMarker = i === markerIndex;
          const col = toneColor(points[i].tone, accent);
          return (
            <span
              key={i}
              className="absolute rounded-full pointer-events-none"
              title={`${points[i].label}: ${fmtShort(points[i].value)}`}
              style={{
                left: `${c.x}%`,
                top: `${c.y}%`,
                transform: "translate(-50%,-50%)",
                width: isMarker ? 11 : 7,
                height: isMarker ? 11 : 7,
                background: "var(--bg-card)",
                border: `2px solid ${col}`,
                boxShadow: isMarker ? `0 0 0 4px color-mix(in srgb, ${col} 18%, transparent)` : undefined,
              }}
            />
          );
        })}
      </div>
      <div className="area-trend-labels">
        {points.map((p, i) => (
          <div key={i} className={`flex-1 text-center text-[10px] truncate ${i === markerIndex ? "font-bold text-[var(--text-muted)]" : "text-[var(--text-dim)]"}`}>
            {p.label}
          </div>
        ))}
      </div>
    </div>
  );
}
