"use client";

// 무의존 SVG 차트 프리미티브 (목표형 개요 콕핏 + 향후 대시보드/reports 재사용).
//   순수 프레젠테이션 — 입력은 숫자/배열, 색은 CSS 변수. 라이트/다크 자동 대응.
//   차트 라이브러리 미도입 기조 유지(간트와 동일 철학).

import { useId } from "react";

const PRIMARY = "var(--primary)";
const DIM = "var(--text-dim)";
const BORDER = "var(--border)";
export const AMBER = "#f59e0b";
export const DANGER = "var(--danger)";

// 달성률(0~100) → 상태색. >=100 primary / 80~99 amber / <80 danger.
export function statusColor(pct: number | null | undefined): string {
  if (pct == null) return DIM;
  if (pct >= 100) return PRIMARY;
  if (pct >= 80) return AMBER;
  return DANGER;
}

const fmtShort = (n: number) => {
  const abs = Math.abs(n); const sign = n < 0 ? "-" : "";
  if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(abs >= 1e9 ? 0 : 1)}억`;
  if (abs >= 1e4) return `${sign}${Math.round(abs / 1e4).toLocaleString("ko-KR")}만`;
  return `${sign}${Math.round(abs).toLocaleString("ko-KR")}`;
};

// ── ① 종합 달성률 도넛 게이지 ──
export function RadialGauge({ pct, label, color, size = 132 }: { pct: number | null; label?: string; color?: string; size?: number }) {
  const p = pct == null ? 0 : Math.min(100, Math.max(0, pct));
  const sw = Math.round(size * 0.085);
  const r = (size - sw * 2) / 2;
  const cx = size / 2;
  const circ = 2 * Math.PI * r;
  const stroke = color || statusColor(pct);
  return (
    <svg className="radial-gauge" viewBox={`0 0 ${size} ${size}`} style={{ width: size, height: size }} role="img" aria-label={`달성률 ${Math.round(p)}%`}>
      <circle cx={cx} cy={cx} r={r} fill="none" stroke={BORDER} strokeWidth={sw} />
      <circle cx={cx} cy={cx} r={r} fill="none" stroke={stroke} strokeWidth={sw} strokeLinecap="round"
        strokeDasharray={`${(circ * p) / 100} ${circ}`} transform={`rotate(-90 ${cx} ${cx})`} />
      <text x={cx} y={cx - (label ? size * 0.02 : 0)} textAnchor="middle" dominantBaseline="central" fontSize={size * 0.22} fontWeight={800} fill="var(--text)">
        {pct == null ? "—" : `${Math.round(p)}%`}
      </text>
      {label && <text x={cx} y={cx + size * 0.18} textAnchor="middle" fontSize={size * 0.095} fill={DIM}>{label}</text>}
    </svg>
  );
}

// ── ① KPI 가로 달성률 바 ──
export function ProgressBar({ pct, color, height = 8 }: { pct: number | null; color?: string; height?: number }) {
  const p = pct == null ? 0 : Math.min(100, Math.max(0, pct));
  return (
    <div className="progress-bar-track" style={{ height, borderRadius: height, background: "var(--bg-surface)", overflow: "hidden" }}>
      <div style={{ width: `${p}%`, height: "100%", borderRadius: height, background: color || statusColor(pct), transition: "width .3s" }} />
    </div>
  );
}

// ── ① 미니 스파크라인 ──
export function Sparkline({ points, color, width = 80, height = 24 }: { points: number[]; color?: string; width?: number; height?: number }) {
  if (!points || points.length === 0) return <svg className="sparkline" width={width} height={height} />;
  const max = Math.max(...points, 1), min = Math.min(...points, 0);
  const span = max - min || 1;
  const step = points.length > 1 ? width / (points.length - 1) : 0;
  const d = points.map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(height - ((v - min) / span) * (height - 2) - 1).toFixed(1)}`).join(" ");
  return (
    <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} style={{ width, height }} preserveAspectRatio="none">
      <path d={d} fill="none" stroke={color || PRIMARY} strokeWidth={1.4} />
    </svg>
  );
}

// ── ③ 정렬된 가로 막대 리스트 (분해) ──
export function BarList({ items, unit = "", emptyText = "데이터 없음" }: { items: { label: string; value: number; color?: string }[]; unit?: string; emptyText?: string }) {
  const rows = [...items].filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  if (rows.length === 0) return <div className="text-xs text-[var(--text-dim)] py-4 text-center">{emptyText}</div>;
  const max = Math.max(...rows.map((r) => r.value), 1);
  const total = rows.reduce((s, r) => s + r.value, 0);
  return (
    <div className="bar-list space-y-2">
      {rows.map((r) => (
        <div key={r.label}>
          <div className="flex items-center justify-between text-[11px] mb-0.5">
            <span className="text-[var(--text-muted)] truncate">{r.label}</span>
            <span className="mono-number text-[var(--text)] shrink-0">{fmtShort(r.value)}{unit} <span className="text-[var(--text-dim)]">({total > 0 ? Math.round((r.value / total) * 100) : 0}%)</span></span>
          </div>
          <div style={{ height: 7, borderRadius: 7, background: "var(--bg-surface)", overflow: "hidden" }}>
            <div style={{ width: `${(r.value / max) * 100}%`, height: "100%", borderRadius: 7, background: r.color || PRIMARY }} title={`${r.label}: ${fmtShort(r.value)}${unit}`} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── ② 라인 차트 (누적 실적 vs 목표 페이스 + today) ──
export type LineSeries = { color: string; dash?: boolean; points: { x: number; y: number }[]; label?: string };
export function LineChart({ series, markerX, height = 160, yUnit = "" }: { series: LineSeries[]; markerX?: number; height?: number; yUnit?: string }) {
  const id = useId();
  const W = 320, H = height, padL = 6, padR = 6, padT = 10, padB = 16;
  const allPts = series.flatMap((s) => s.points);
  if (allPts.length === 0) return <div className="text-xs text-[var(--text-dim)] py-6 text-center">표시할 데이터가 없습니다</div>;
  const xs = allPts.map((p) => p.x), ys = allPts.map((p) => p.y);
  const xMin = Math.min(...xs), xMax = Math.max(...xs) || 1;
  const yMax = Math.max(...ys, 1), yMin = Math.min(...ys, 0);
  const xSpan = xMax - xMin || 1, ySpan = yMax - yMin || 1;
  const sx = (x: number) => padL + ((x - xMin) / xSpan) * (W - padL - padR);
  const sy = (y: number) => padT + (1 - (y - yMin) / ySpan) * (H - padT - padB);
  const path = (pts: { x: number; y: number }[]) => pts.map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ");
  return (
    <div className="chart-line">
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: H }} preserveAspectRatio="none">
        <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke={BORDER} strokeWidth={0.5} />
        {markerX != null && (
          <line x1={sx(markerX)} y1={padT} x2={sx(markerX)} y2={H - padB} stroke={DIM} strokeWidth={0.5} strokeDasharray="2 2" />
        )}
        {series.map((s, i) => (
          <path key={`${id}-${i}`} d={path(s.points)} fill="none" stroke={s.color} strokeWidth={1.6} strokeDasharray={s.dash ? "4 3" : undefined} strokeLinejoin="round" />
        ))}
        {/* 마지막 실제점 강조 (첫 시리즈 = 실제) */}
        {series[0]?.points.length ? (() => { const last = series[0].points[series[0].points.length - 1]; return <circle cx={sx(last.x)} cy={sy(last.y)} r={2.5} fill={series[0].color} />; })() : null}
      </svg>
      <div className="flex flex-wrap gap-3 mt-1">
        {series.filter((s) => s.label).map((s, i) => (
          <span key={i} className="inline-flex items-center gap-1 text-[10px] text-[var(--text-muted)]">
            <span style={{ width: 12, height: 2, background: s.color, display: "inline-block", opacity: s.dash ? 0.6 : 1 }} />{s.label}
          </span>
        ))}
        {yUnit && <span className="text-[10px] text-[var(--text-dim)] ml-auto">단위: {yUnit}</span>}
      </div>
    </div>
  );
}

// ── ④ 신호등 타임라인 ──
const ST_COLOR: Record<string, string> = { green: "var(--primary)", yellow: AMBER, red: DANGER };
export function StatusTimeline({ points }: { points: { label: string; status: string }[] }) {
  if (!points || points.length === 0) return <div className="text-xs text-[var(--text-dim)] py-2">체크인 기록 없음</div>;
  return (
    <div className="status-timeline flex items-center gap-1.5 flex-wrap">
      {points.map((p, i) => (
        <div key={i} className="flex flex-col items-center gap-0.5" title={`${p.label}: ${p.status}`}>
          <span style={{ width: 14, height: 14, borderRadius: 999, background: ST_COLOR[p.status] || DIM, display: "inline-block" }} />
          <span className="text-[8px] text-[var(--text-dim)] mono-number">{p.label}</span>
        </div>
      ))}
    </div>
  );
}
