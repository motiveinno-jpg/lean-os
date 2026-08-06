"use client";

// 차트 키트 — 오너뷰의 그래프를 한 규칙으로 그린다 (2026-08-06 사장님: "다양한 차트를 세련되게").
//
//   저장소 기조 그대로 **차트 라이브러리 없이 SVG 로 직접** 그린다(간트·정리탭과 같은 철학).
//
//   지키는 규칙(시각화 원칙)
//     · 색은 '무엇인지'를 가를 때만 시리즈 색(--viz-1..8)을 쓰고 **순서대로, 돌려쓰지 않는다**.
//       9번째 계열은 새 색을 만들지 않고 '기타'로 접는다 — 색이 돌면 뜻이 섞인다.
//     · 축은 하나다. 단위가 다른 두 지표를 한 그림에 겹치지 않는다(콤보도 같은 축만).
//     · 막대는 얇게, 끝은 4px 둥글게, 조각 사이는 2px 띄운다. 격자는 뒤로 물린다.
//     · 계열이 둘 이상이면 범례를 늘 둔다 — 색만으로 구분하게 두지 않는다.
//     · 값은 글자색(먹)으로 쓴다. 시리즈 색을 글자에 입히지 않는다.

import { useId, useState } from "react";

export const VIZ = ["var(--viz-1)", "var(--viz-2)", "var(--viz-3)", "var(--viz-4)",
  "var(--viz-5)", "var(--viz-6)", "var(--viz-7)", "var(--viz-8)"];
/** 몇 번째 계열인지 → 색. 8개를 넘으면 색을 새로 만들지 않고 '기타'(회색)로 접는다 */
export const vizColor = (i: number) => (i < VIZ.length ? VIZ[i] : "var(--text-dim)");
const GRID = "var(--border)";
const INK = "var(--text)";
const DIM = "var(--text-dim)";


/** 축 글자 — 개수만큼 칸을 나누면 글자가 잘린다. 대여섯 개만 골라 양끝에 맞춰 놓는다 */
function axisLabels(labels: string[]) {
  if (labels.length === 0) return null;
  const want = Math.min(labels.length, 6);
  const step = (labels.length - 1) / Math.max(1, want - 1);
  const idx = Array.from({ length: want }, (_, i) => Math.round(i * step));
  return [...new Set(idx)].map((i) => <em key={`${labels[i]}-${i}`}>{labels[i]}</em>);
}

export type Datum = { label: string; value: number; color?: string };
export type Series = { name: string; points: { label: string; value: number }[] };

const fmt = (n: number) => Math.round(n).toLocaleString("ko-KR");
/** 눈금 상한을 보기 좋은 값으로 (1/2/5 × 10^n) */
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const e = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / e;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * e;
}

/** 범례 — 계열이 둘 이상이면 늘 붙인다(색만으로 구분하게 두지 않는다) */
export function Legend({ items }: { items: { name: string; color: string }[] }) {
  if (items.length < 2) return null;
  return (
    <div className="viz-legend">
      {items.map((s) => (
        <span key={s.name}><i style={{ background: s.color }} />{s.name}</span>
      ))}
    </div>
  );
}

/** 세로 막대 — 시간 흐름·항목 비교의 기본 */
export function ColumnChart({ data, height = 200, unit = "" }: { data: Datum[]; height?: number; unit?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(1, ...data.map((d) => d.value)));
  return (
    <div className="viz-wrap" style={{ height }}>
      <div className="viz-yaxis"><em>{fmt(max)}</em><em>{fmt(max / 2)}</em><em>0</em></div>
      <div className="viz-plot" onMouseLeave={() => setHover(null)}>
        <span className="viz-grid" /><span className="viz-grid viz-grid-mid" />
        {data.map((d, i) => (
          <span key={`${d.label}-${i}`} className="viz-col" onMouseEnter={() => setHover(i)}>
            <i style={{ height: `${Math.max(1, (d.value / max) * 100)}%`, background: d.color || vizColor(0) }} />
            {hover === i && (
              <b className="viz-tip">{d.label}<em>{fmt(d.value)}{unit}</em></b>
            )}
          </span>
        ))}
      </div>
      <div className="viz-xaxis">{axisLabels(data.map((d) => d.label))}</div>
    </div>
  );
}

/** 가로 막대 — 이름이 길거나 순위를 볼 때 */
export function BarChart({ data, unit = "", max: fixedMax }: { data: Datum[]; unit?: string; max?: number }) {
  const max = niceMax(fixedMax || Math.max(1, ...data.map((d) => d.value)));
  return (
    <div className="viz-bars">
      {data.map((d, i) => (
        <div key={`${d.label}-${i}`} className="viz-bar">
          <span className="viz-bar-label" title={d.label}>{d.label}</span>
          <span className="viz-bar-track">
            <i style={{ width: `${Math.max(0.5, (d.value / max) * 100)}%`, background: d.color || vizColor(i) }} />
          </span>
          <span className="viz-bar-num">{fmt(d.value)}{unit}</span>
        </div>
      ))}
    </div>
  );
}

/** 선 — 흐름을 본다. 계열이 여럿이면 색으로 가르고 범례를 붙인다 */
export function LineChart({ series, height = 200, unit = "" }: { series: Series[]; height?: number; unit?: string }) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const labels = series[0]?.points.map((p) => p.label) || [];
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.points.map((p) => p.value))));
  const W = 100, H = 100;
  const x = (i: number) => (labels.length <= 1 ? 0 : (i / (labels.length - 1)) * W);
  const y = (v: number) => H - (v / max) * H;
  return (
    <div className="viz-wrap" style={{ height }}>
      <div className="viz-yaxis"><em>{fmt(max)}</em><em>{fmt(max / 2)}</em><em>0</em></div>
      <div className="viz-plot" onMouseLeave={() => setHover(null)}>
        <span className="viz-grid" /><span className="viz-grid viz-grid-mid" />
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="viz-svg">
          {series.map((s, si) => (
            <polyline key={s.name} fill="none" stroke={vizColor(si)} strokeWidth="2"
              vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round"
              points={s.points.map((p, i) => `${x(i)},${y(p.value)}`).join(" ")} />
          ))}
        </svg>
        {/*  점 위에 손이 가면 그 자리 값을 모두 보여 준다 — 선 위 한 점만 짚으면 비교가 안 된다 */}
        {labels.map((l, i) => (
          <span key={`${id}-${i}`} className="viz-hit" style={{ left: `${x(i)}%` }} onMouseEnter={() => setHover(i)}>
            {hover === i && (
              <b className="viz-tip viz-tip-line">{l}
                {series.map((s, si) => (
                  <em key={s.name}><i style={{ background: vizColor(si) }} />{s.name} {fmt(s.points[i]?.value || 0)}{unit}</em>
                ))}
              </b>
            )}
          </span>
        ))}
      </div>
      <div className="viz-xaxis">{axisLabels(labels)}</div>
    </div>
  );
}

/** 도넛 — 무엇이 얼마를 차지하는지. 가운데에 합계를 둔다 */
export function DonutChart({ data, total, unit = "", hole = 0.62 }: {
  data: Datum[]; total?: string; unit?: string; hole?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const sum = data.reduce((n, d) => n + d.value, 0) || 1;
  const R = 50, C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <div className="viz-donut">
      <svg viewBox="0 0 120 120" className="viz-donut-svg">
        <g transform="translate(60,60) rotate(-90)">
          {data.map((d, i) => {
            const frac = d.value / sum;
            const len = frac * C;
            const el = (
              <circle key={`${d.label}-${i}`} r={R} fill="none"
                stroke={d.color || vizColor(i)} strokeWidth={R * (1 - hole)}
                strokeDasharray={`${Math.max(0, len - 2)} ${C - Math.max(0, len - 2)}`}
                strokeDashoffset={-acc} opacity={hover === null || hover === i ? 1 : 0.35}
                onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
            );
            acc += len;
            return el;
          })}
        </g>
      </svg>
      <div className="viz-donut-center">
        {hover === null
          ? <><b>{total ?? `${fmt(sum)}${unit}`}</b><em>합계</em></>
          : <><b>{fmt(data[hover].value)}{unit}</b><em>{data[hover].label} {Math.round((data[hover].value / sum) * 1000) / 10}%</em></>}
      </div>
    </div>
  );
}

/** 깔때기 — 단계마다 얼마나 남는지 */
export function FunnelChart({ data, unit = "" }: { data: Datum[]; unit?: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="viz-funnel">
      {data.map((d, i) => {
        const prev = i > 0 ? data[i - 1].value : d.value;
        const keep = prev > 0 ? Math.round((d.value / prev) * 100) : 100;
        return (
          <div key={`${d.label}-${i}`} className="viz-funnel-row">
            <span className="viz-funnel-label">{d.label}</span>
            <span className="viz-funnel-track">
              <i style={{ width: `${Math.max(1, (d.value / max) * 100)}%`, background: vizColor(i) }} />
            </span>
            <span className="viz-funnel-num">{fmt(d.value)}{unit}{i > 0 && <em>{keep}%</em>}</span>
          </div>
        );
      })}
    </div>
  );
}

/** 분산형 — 두 지표의 관계를 본다(예: 광고비 대비 CPC) */
export function ScatterChart({ points, xLabel, yLabel, height = 220 }: {
  points: { label: string; x: number; y: number }[]; xLabel: string; yLabel: string; height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const xMax = niceMax(Math.max(1, ...points.map((p) => p.x)));
  const yMax = niceMax(Math.max(1, ...points.map((p) => p.y)));
  return (
    <div className="viz-scatter" style={{ height }}>
      <div className="viz-yaxis"><em>{fmt(yMax)}</em><em>{fmt(yMax / 2)}</em><em>0</em></div>
      <div className="viz-plot viz-plot-dots" onMouseLeave={() => setHover(null)}>
        <span className="viz-grid" /><span className="viz-grid viz-grid-mid" />
        {points.map((p, i) => (
          <span key={`${p.label}-${i}`} className="viz-dot"
            style={{ left: `${(p.x / xMax) * 100}%`, bottom: `${(p.y / yMax) * 100}%`, background: vizColor(i) }}
            onMouseEnter={() => setHover(i)}>
            {hover === i && <b className="viz-tip">{p.label}<em>{xLabel} {fmt(p.x)} · {yLabel} {fmt(p.y)}</em></b>}
          </span>
        ))}
      </div>
      <div className="viz-axis-names"><em>{yLabel}</em><em>{xLabel} (최대 {fmt(xMax)})</em></div>
    </div>
  );
}

/** 묶음(클러스터) — 크기로 무게를 보여 준다. 이름이 길면 자른다 */
export function ClusterChart({ data, unit = "" }: { data: Datum[]; unit?: string }) {
  const sum = data.reduce((n, d) => n + d.value, 0) || 1;
  return (
    <div className="viz-cluster">
      {data.map((d, i) => {
        const pct = (d.value / sum) * 100;
        return (
          <span key={`${d.label}-${i}`} className="viz-cluster-cell"
            style={{ flexGrow: Math.max(1, pct), background: d.color || vizColor(i) }}
            title={`${d.label} ${fmt(d.value)}${unit} (${Math.round(pct * 10) / 10}%)`}>
            <b>{d.label}</b>
            <em>{Math.round(pct)}%</em>
          </span>
        );
      })}
    </div>
  );
}

/** 말 구름 — 많이 나온 말이 크게. 색은 뜻이 없으므로 한 색의 진하기로만 (2026-08-06) */
export function WordCloud({ data }: { data: Datum[] }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="viz-cloud">
      {data.map((d, i) => {
        const r = d.value / max;
        return (
          <span key={`${d.label}-${i}`} className="viz-word"
            style={{ fontSize: `${11 + r * 20}px`, opacity: 0.45 + r * 0.55 }}
            title={`${d.label} ${fmt(d.value)}`}>{d.label}</span>
        );
      })}
    </div>
  );
}
