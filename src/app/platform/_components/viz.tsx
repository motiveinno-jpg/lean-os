"use client";

// 운영자 대시보드 시각화 프리미티브 (2026-08-04 전면 개편)
//   dataviz 방법론: 얇은 마크, 세그먼트 사이 2px 표면 간격, 값·라벨은 텍스트 토큰(시리즈색 금지),
//   시리즈 2개 이상이면 범례 필수(도넛 옆 리스트가 범례 겸 표 뷰).
//   카테고리 팔레트는 검증된 기본 순서(blue→orange→aqua→yellow→magenta) 고정 배정 — 순환 금지.

import React from "react";

// 검증된 카테고리 팔레트 (dataviz 기본, 인접쌍 CVD ΔE≥8 통과 순서 — 재배열 금지)
export const VIZ_CATEGORICAL = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"] as const;
export const VIZ_GRAY = "#9ca3af";

export type DonutSegment = { label: string; value: number; color: string };

/** 도넛 차트 — 중앙 헤드라인 + 세그먼트 2px 간격. 범례/수치는 호출측이 옆에 리스트로 붙인다. */
export function Donut({ segments, size = 148, thickness = 15, centerTop, centerSub }: {
  segments: DonutSegment[];
  size?: number;
  thickness?: number;
  centerTop: React.ReactNode;
  centerSub?: React.ReactNode;
}) {
  const live = segments.filter((s) => s.value > 0);
  const total = live.reduce((s, x) => s + x.value, 0);
  const r = (size - thickness) / 2;
  const C = 2 * Math.PI * r;
  const gap = live.length > 1 ? 2 : 0; // 세그먼트 사이 표면 간격
  let acc = 0;
  return (
    <div className="viz-donut-wrap" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="구성 도넛 차트">
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          {total === 0 ? (
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--bg-surface)" strokeWidth={thickness} />
          ) : (
            live.map((seg) => {
              const frac = seg.value / total;
              const len = Math.max(0.5, frac * C - gap);
              const el = (
                <circle
                  key={seg.label}
                  cx={size / 2}
                  cy={size / 2}
                  r={r}
                  fill="none"
                  stroke={seg.color}
                  strokeWidth={thickness}
                  strokeDasharray={`${len} ${C - len}`}
                  strokeDashoffset={-(acc + gap / 2)}
                >
                  <title>{`${seg.label} ${Math.round(frac * 100)}%`}</title>
                </circle>
              );
              acc += frac * C;
              return el;
            })
          )}
        </g>
      </svg>
      <div className="viz-donut-center">
        <span className="viz-donut-center-top mono-number">{centerTop}</span>
        {centerSub && <span className="viz-donut-center-sub">{centerSub}</span>}
      </div>
    </div>
  );
}

/** 반원 게이지 — 단일 비율(0~100%)용. 다크 카드 안에서도 쓰므로 색을 인자로 받는다. */
export function GaugeArc({ pct, size = 120, thickness = 10, color = "#2a78d6", track = "rgba(148,163,184,0.25)", label }: {
  pct: number;
  size?: number;
  thickness?: number;
  color?: string;
  track?: string;
  label?: React.ReactNode;
}) {
  const clamped = Math.max(0, Math.min(100, pct));
  const r = (size - thickness) / 2;
  const half = Math.PI * r; // 반원 길이
  const h = size / 2 + thickness / 2;
  const d = `M ${thickness / 2} ${size / 2} A ${r} ${r} 0 0 1 ${size - thickness / 2} ${size / 2}`;
  return (
    <div className="viz-gauge-wrap" style={{ width: size, height: h }}>
      <svg width={size} height={h} viewBox={`0 0 ${size} ${h}`} role="img" aria-label={`게이지 ${Math.round(clamped)}%`}>
        <path d={d} fill="none" stroke={track} strokeWidth={thickness} strokeLinecap="round" />
        <path d={d} fill="none" stroke={color} strokeWidth={thickness} strokeLinecap="round"
          strokeDasharray={`${(clamped / 100) * half} ${half}`} />
      </svg>
      <div className="viz-gauge-label">{label ?? `${Math.round(clamped)}%`}</div>
    </div>
  );
}

/** 도넛 옆 범례 리스트 — 색 점은 식별만, 수치는 텍스트 토큰. (표 뷰 겸용) */
export function VizLegend({ rows }: {
  rows: { label: string; color: string; value: string; sub?: string }[];
}) {
  return (
    <ul className="viz-legend">
      {rows.map((r) => (
        <li key={r.label}>
          <span className="viz-legend-dot" style={{ background: r.color }} />
          <span className="viz-legend-label">{r.label}</span>
          <span className="viz-legend-value mono-number">{r.value}</span>
          {r.sub && <span className="viz-legend-sub mono-number">{r.sub}</span>}
        </li>
      ))}
    </ul>
  );
}
