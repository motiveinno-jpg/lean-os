"use client";

// 무의존 SVG 차트 프리미티브 (목표형 개요 콕핏 + 향후 대시보드/reports 재사용).
//   순수 프레젠테이션 — 입력은 숫자/배열, 색은 CSS 변수. 라이트/다크 자동 대응.
//   차트 라이브러리 미도입 기조 유지(간트와 동일 철학).

import { useId, useState } from "react";

const PRIMARY = "var(--primary)";
const DIM = "var(--text-dim)";
const MUTED = "var(--text-muted)";
const BORDER = "var(--border)";
const GRID = "var(--grid, var(--border))";
const SUCCESS = "var(--success)";
export const AMBER = "#f59e0b";
export const DANGER = "var(--danger)";

// 눈금 상한을 '깔끔한' 값으로 (1/2/5 × 10^n)
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const e = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / e;
  const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return m * e;
}

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
    <div className="bar-list">
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

// ── ② 막대 + 목표선 콤보 (기간별 실적 vs 목표) ──
//   buckets: 기간(일/주/월) 단위 실적·목표. value=null 은 미래(목표만큼 빈 막대).
//   막대 색으로 그 기간 목표 달성(초록)·미달(주황). 목표를 잇는 선 + 오늘 경계 + hover 값.
export type ComboBucket = { label: string; days: number; value: number | null; target: number };
export function BarLineCombo({ buckets, unit, yUnit = "" }: { buckets: ComboBucket[]; unit: "day" | "week" | "month"; yUnit?: string }) {
  const [hi, setHi] = useState<number | null>(null);
  if (!buckets.length) return <div className="text-xs text-[var(--text-dim)] py-6 text-center">표시할 데이터가 없습니다</div>;

  const W = 760, H = 300, padL = 52, padR = 16, padT = 22, padB = 30;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  // 누적 시작일 계산
  let acc = 0;
  const bs = buckets.map((b) => { const o = { ...b, startDay: acc }; acc += b.days; return o; });
  const totalDays = acc || 1;
  const firstFuture = bs.findIndex((b) => b.value === null);
  const todayDay = firstFuture < 0 ? totalDays : bs[firstFuture].startDay;
  const yMax = niceMax(Math.max(1, ...bs.map((b) => Math.max(b.value || 0, b.target))) * 1.18);
  const sx = (d: number) => padL + (d / totalDays) * plotW;
  const sy = (y: number) => padT + (1 - y / yMax) * plotH;
  const maxBw = unit === "day" ? 9 : unit === "week" ? 24 : 56;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(yMax * f));
  const hasTarget = bs.some((b) => b.target > 0);
  const tgtPath = bs.map((b, i) => { const x = sx(b.startDay + b.days / 2), y = sy(b.target); return `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`; }).join(" ");
  const perTargetLabel = Math.round((bs.find((b) => b.target > 0)?.target) || 0);
  const everyN = unit === "day" ? Math.ceil(bs.length / 9) : 1;
  const hb = hi != null ? bs[hi] : null;

  return (
    <div className="barcombo-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="barcombo-svg" role="img" aria-label="기간별 실적 대 목표">
        {/* Y 눈금 */}
        {ticks.map((yv, i) => (
          <g key={i}>
            <line x1={padL} y1={sy(yv)} x2={W - padR} y2={sy(yv)} stroke={GRID} strokeWidth={1} />
            <text x={padL - 8} y={sy(yv) + 3.5} textAnchor="end" fontSize={11} fill={DIM}>{yv >= 10000 ? `${Math.round(yv / 10000)}만` : yv}</text>
          </g>
        ))}
        {/* 오늘 이후 음영 + 경계 */}
        {todayDay < totalDays && (
          <>
            <rect x={sx(todayDay)} y={padT} width={W - padR - sx(todayDay)} height={plotH} fill={DIM} opacity={0.05} />
            <line x1={sx(todayDay)} y1={padT - 4} x2={sx(todayDay)} y2={H - padB} stroke={DIM} strokeWidth={1} strokeDasharray="3 3" />
            <text x={sx(todayDay)} y={padT - 8} textAnchor="middle" fontSize={10} fontWeight={700} fill={MUTED}>오늘</text>
          </>
        )}
        {/* 막대 */}
        {bs.map((b, i) => {
          const cx = sx(b.startDay + b.days / 2);
          const bw = Math.min(maxBw, (b.days / totalDays) * plotW * 0.66);
          const x = cx - bw / 2, r = Math.min(unit === "day" ? 2 : 4, bw / 2);
          if (b.value == null) {
            const yt = sy(b.target), h = (H - padB) - yt;
            return <rect key={i} x={x} y={yt} width={bw} height={Math.max(0, h)} rx={r} fill="none" stroke={DIM} strokeWidth={1} strokeDasharray="2 2" opacity={0.5} />;
          }
          const hit = hasTarget && b.value >= b.target;
          const col = !hasTarget ? PRIMARY : hit ? SUCCESS : AMBER;
          const yt = sy(b.value), h = (H - padB) - yt;
          return (
            <rect key={i} x={x} y={yt} width={bw} height={Math.max(0, h)} rx={r} fill={col} fillOpacity={hi === i ? 1 : 0.85}
              style={{ cursor: "pointer" }} onMouseEnter={() => setHi(i)} onMouseLeave={() => setHi(null)} />
          );
        })}
        {/* 목표선(페이스) */}
        {hasTarget && (
          <>
            <path d={tgtPath} fill="none" stroke={MUTED} strokeWidth={1.8} />
            {bs.map((b, i) => <circle key={i} cx={sx(b.startDay + b.days / 2)} cy={sy(b.target)} r={unit === "day" ? 1.4 : 2.2} fill={MUTED} />)}
            <text x={W - padR} y={sy(bs.find((b) => b.target > 0)!.target) - 6} textAnchor="end" fontSize={10.5} fontWeight={700} fill={MUTED}>
              {unit === "day" ? "일" : unit === "week" ? "주" : "월"} 목표 ~{perTargetLabel >= 10000 ? `${Math.round(perTargetLabel / 10000)}만` : perTargetLabel}
            </text>
          </>
        )}
        {/* X 라벨 (솎음) */}
        {bs.map((b, i) => (i % everyN !== 0 && i !== bs.length - 1) ? null : (
          <text key={i} x={sx(b.startDay + b.days / 2)} y={H - 12} textAnchor="middle" fontSize={10} fill={b.startDay >= todayDay ? DIM : MUTED}>{b.label}</text>
        ))}
        {/* hover 프레임 */}
        {hb && hb.value != null && (() => {
          const cx = sx(hb.startDay + hb.days / 2), bw = Math.min(maxBw, (hb.days / totalDays) * plotW * 0.66);
          return <rect x={cx - bw / 2 - 1.5} y={sy(hb.value) - 1.5} width={bw + 3} height={Math.max(0, (H - padB) - sy(hb.value)) + 1.5} rx={4} fill="none" stroke="var(--text)" strokeWidth={1.4} opacity={0.5} />;
        })()}
      </svg>
      {hb && hb.value != null && (() => {
        const cx = sx(hb.startDay + hb.days / 2), diff = Math.round(hb.value - hb.target), hit = hb.value >= hb.target;
        return (
          <div className="barcombo-tip" style={{ left: `${(cx / W) * 100}%`, top: `${(sy(hb.value) / H) * 100}%` }}>
            <b>{hb.label}{unit !== "month" ? ` · ${hb.days}일` : ""}</b>
            <div className="barcombo-tip-row"><i style={{ background: hasTarget ? (hit ? SUCCESS : AMBER) : PRIMARY }} />실적 {Math.round(hb.value).toLocaleString("ko-KR")}{yUnit}</div>
            {hasTarget && <div className="barcombo-tip-row"><i style={{ background: MUTED }} />목표 {Math.round(hb.target).toLocaleString("ko-KR")}{yUnit} ({hit ? "+" : ""}{diff.toLocaleString("ko-KR")}, {hit ? "달성" : "미달"})</div>}
          </div>
        );
      })()}
    </div>
  );
}

// ── 실행형 마감 워크로드 (주별 예정 마감 태스크 스택) ──
//   weeks: 주별 {완료 done · 남음 pending · 지연 over(마감초과·미완료)}. 스택 막대 + 오늘 경계.
export type WorkloadWeek = { label: string; done: number; pending: number; over: number };
export function WorkloadChart({ weeks, todayIndex }: { weeks: WorkloadWeek[]; todayIndex?: number }) {
  const [hi, setHi] = useState<number | null>(null);
  if (!weeks.length) return <div className="text-xs text-[var(--text-dim)] py-6 text-center">마감일이 지정된 태스크가 없습니다</div>;
  const W = 760, H = 220, padL = 34, padR = 14, padT = 16, padB = 28;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const totals = weeks.map((w) => w.done + w.pending + w.over);
  const yMax = niceMax(Math.max(2, ...totals));
  const N = weeks.length, band = plotW / N, bw = Math.min(44, band * 0.56);
  const sy = (y: number) => padT + (1 - y / yMax) * plotH;
  const bx = (i: number) => padL + band * i + band / 2;
  const ticks = Array.from({ length: 3 }, (_, i) => Math.round((yMax / 2) * i));
  const hw = hi != null ? weeks[hi] : null;
  return (
    <div className="barcombo-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="barcombo-svg" role="img" aria-label="주별 마감 워크로드">
        {ticks.map((yv, i) => (
          <g key={i}>
            <line x1={padL} y1={sy(yv)} x2={W - padR} y2={sy(yv)} stroke={GRID} strokeWidth={1} />
            <text x={padL - 7} y={sy(yv) + 3.5} textAnchor="end" fontSize={10.5} fill={DIM}>{yv}</text>
          </g>
        ))}
        {todayIndex != null && todayIndex >= 0 && todayIndex < N && (() => {
          const tx = padL + band * todayIndex;
          return (<><line x1={tx} y1={padT - 2} x2={tx} y2={H - padB} stroke={DIM} strokeWidth={1} strokeDasharray="3 3" /><text x={tx} y={padT - 4} textAnchor="middle" fontSize={10} fontWeight={700} fill={MUTED}>오늘</text></>);
        })()}
        {weeks.map((w, i) => {
          const x = bx(i) - bw / 2; let base = H - padB;
          const segs: [number, string][] = [[w.done, SUCCESS], [w.pending, DIM], [w.over, DANGER]];
          return (
            <g key={i} style={{ cursor: "pointer" }} onMouseEnter={() => setHi(i)} onMouseLeave={() => setHi(null)}>
              {/* 투명 히트영역 */}
              <rect x={x} y={padT} width={bw} height={plotH} fill="transparent" />
              {segs.map(([v, col], si) => {
                if (v <= 0) return null;
                const h = (v / yMax) * plotH; base -= h;
                return <rect key={si} x={x} y={base} width={bw} height={h} rx={3} fill={col} fillOpacity={hi === i ? 1 : 0.9} />;
              })}
              <text x={bx(i)} y={H - 10} textAnchor="middle" fontSize={10} fill={todayIndex === i ? MUTED : DIM}>{w.label}</text>
            </g>
          );
        })}
      </svg>
      {hw && (totals[hi!] > 0) && (
        <div className="barcombo-tip" style={{ left: `${(bx(hi!) / W) * 100}%`, top: `${(sy(totals[hi!]) / H) * 100}%` }}>
          <b>{hw.label} 마감</b>
          {hw.over > 0 && <div className="barcombo-tip-row"><i style={{ background: DANGER }} />지연 {hw.over}건</div>}
          {hw.pending > 0 && <div className="barcombo-tip-row"><i style={{ background: DIM }} />남음 {hw.pending}건</div>}
          {hw.done > 0 && <div className="barcombo-tip-row"><i style={{ background: SUCCESS }} />완료 {hw.done}건</div>}
        </div>
      )}
    </div>
  );
}

// ── ④ 신호등 타임라인 ──
const ST_COLOR: Record<string, string> = { green: "var(--primary)", yellow: AMBER, red: DANGER };
export function StatusTimeline({ points }: { points: { label: string; status: string }[] }) {
  if (!points || points.length === 0) return <div className="text-xs text-[var(--text-dim)] py-2">체크인 기록 없음</div>;
  return (
    <div className="status-timeline">
      {points.map((p, i) => (
        <div key={i} className="flex flex-col items-center gap-0.5" title={`${p.label}: ${p.status}`}>
          <span style={{ width: 14, height: 14, borderRadius: 999, background: ST_COLOR[p.status] || DIM, display: "inline-block" }} />
          <span className="text-[8px] text-[var(--text-dim)] mono-number">{p.label}</span>
        </div>
      ))}
    </div>
  );
}
