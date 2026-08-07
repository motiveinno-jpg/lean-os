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
  //   여덟 개까지는 다 보여 준다 — 이름 하나하나가 뜻인 경우(사람·캠페인)가 많다
  if (labels.length <= 8) return labels.map((l, i) => <em key={`${l}-${i}`}>{l}</em>);
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

/** 묶음 막대 — 한 자리에 계열 여럿을 나란히 세운다(예: 자산·부채·자본, 매출·비용).
 *  ⚠️ 계열끼리 단위가 같을 때만 쓴다. 단위가 다르면 그림이 거짓말을 한다 — 그림을 둘로 나눈다.
 *  손대면 그 자리의 **모든 계열 값**이 함께 뜬다(하나만 짚으면 비교가 안 된다). */
export function GroupedColumnChart({ labels, series, height = 200, unit = "", trend, onColumnClick, activeIndex }: {
  labels: string[];
  series: { name: string; values: number[] }[];
  height?: number; unit?: string;
  /** 같은 축에 겹쳐 그리는 한 줄(예: 순이익) — 단위가 같을 때만 준다 */
  trend?: { name: string; values: number[] };
  onColumnClick?: (i: number) => void;
  activeIndex?: number | null;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const all = [...series.flatMap((s) => s.values), ...(trend?.values || [])];
  const max = niceMax(Math.max(1, ...all.map((v) => Math.abs(v))));
  const trendColor = vizColor(series.length);
  return (
    <div className="viz-wrap" style={{ height }}>
      <div className="viz-yaxis"><em>{fmt(max)}</em><em>{fmt(max / 2)}</em><em>0</em></div>
      <div className="viz-plot" onMouseLeave={() => setHover(null)}>
        <span className="viz-grid" /><span className="viz-grid viz-grid-mid" />
        {trend && (
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="viz-svg">
            <polyline fill="none" stroke={trendColor} strokeWidth="2" vectorEffect="non-scaling-stroke"
              strokeLinejoin="round" strokeLinecap="round"
              points={trend.values.map((v, i) => `${labels.length <= 1 ? 0 : (i / (labels.length - 1)) * 100},${100 - (Math.max(0, v) / max) * 100}`).join(" ")} />
          </svg>
        )}
        {labels.map((l, i) => (
          <span key={`${l}-${i}`}
            className={`viz-group ${activeIndex === i ? "viz-group-on" : ""} ${onColumnClick ? "viz-group-click" : ""}`}
            onMouseEnter={() => setHover(i)} onClick={() => onColumnClick?.(i)}>
            {series.map((s, si) => (
              <i key={s.name} style={{ height: `${Math.max(1, (Math.abs(s.values[i] || 0) / max) * 100)}%`, background: vizColor(si) }} />
            ))}
            {hover === i && (
              <b className="viz-tip viz-tip-line">{l}
                {series.map((s, si) => (
                  <em key={s.name}><i style={{ background: vizColor(si) }} />{s.name} {fmt(s.values[i] || 0)}{unit}</em>
                ))}
                {trend && <em><i style={{ background: trendColor }} />{trend.name} {fmt(trend.values[i] || 0)}{unit}</em>}
              </b>
            )}
          </span>
        ))}
      </div>
      <div className="viz-xaxis">{axisLabels(labels)}</div>
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

/** 폭포수 — 무엇이 얼마를 깎아 얼마가 남는지. 손익 구조(매출 → 원가 → 판관비 → 이익)처럼
 *  '더하고 빼서 결론에 닿는' 자료의 최적 형태다. 막대 여럿으로는 그 관계가 안 보인다.
 *  step: 'add'(더함) · 'sub'(뺌) · 'total'(그때까지의 결론) */
export function WaterfallChart({ steps, unit = "원", height = 220 }: {
  steps: { label: string; value: number; kind: "add" | "sub" | "total" }[];
  unit?: string; height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  //   막대가 떠 있는 높이를 미리 셈한다 — 결론(total) 은 바닥에서 시작한다
  let run = 0;
  const bars = steps.map((s) => {
    const start = s.kind === "total" ? 0 : s.kind === "add" ? run : run - Math.abs(s.value);
    const end = s.kind === "total" ? s.value : s.kind === "add" ? run + Math.abs(s.value) : run;
    if (s.kind !== "total") run = s.kind === "add" ? run + Math.abs(s.value) : run - Math.abs(s.value);
    else run = s.value;
    return { ...s, lo: Math.min(start, end), hi: Math.max(start, end) };
  });
  const max = niceMax(Math.max(1, ...bars.map((b) => b.hi)));
  //   더하는 것·빼는 것·결론을 색으로 가른다(상태색이 아니라 시리즈 색 — 좋고 나쁨이 아니다)
  const colorOf = (k: string) => (k === "sub" ? vizColor(1) : k === "total" ? vizColor(2) : vizColor(0));
  return (
    <div className="viz-wrap" style={{ height }}>
      <div className="viz-yaxis"><em>{fmt(max)}</em><em>{fmt(max / 2)}</em><em>0</em></div>
      <div className="viz-plot" onMouseLeave={() => setHover(null)}>
        <span className="viz-grid" /><span className="viz-grid viz-grid-mid" />
        {bars.map((b, i) => (
          <span key={`${b.label}-${i}`} className="viz-wf" onMouseEnter={() => setHover(i)}>
            <i style={{
              bottom: `${(b.lo / max) * 100}%`,
              height: `${Math.max(1, ((b.hi - b.lo) / max) * 100)}%`,
              background: colorOf(b.kind),
            }} />
            {hover === i && (
              <b className="viz-tip">{b.label}<em>{b.kind === "sub" ? "−" : ""}{fmt(Math.abs(b.value))}{unit}</em></b>
            )}
          </span>
        ))}
      </div>
      <div className="viz-xaxis">{steps.map((s, i) => <em key={`${s.label}-${i}`}>{s.label}</em>)}</div>
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

/** 누적 영역 — '전체가 어떻게 흘렀고, 그 안에서 구성이 어떻게 변했나' (2026-08-07).
 *
 *  누적 막대와 언제 갈리나: 달마다의 **값을 정확히 읽는 게 목적이면 막대**,
 *  열두 달의 **흐름과 비중 변화를 보는 게 목적이면 영역**이다. 정확한 값이 옆이나 아래
 *  표에 이미 있는 자리라면 영역이 맞다.
 *
 *  ⚠️ 부분이 전체의 일부일 때만 쓴다 — 매출과 비용처럼 성격이 다른 값을 쌓으면
 *     꼭대기 선(합계)이 아무 뜻도 없는 숫자가 된다. 그럴 땐 묶음 막대로.
 */
export function StackedAreaChart({ labels, series, height = 220, unit = "" }: {
  labels: string[];
  series: { name: string; values: number[] }[];
  height?: number; unit?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const totals = labels.map((_, i) => series.reduce((s, sr) => s + (sr.values[i] || 0), 0));
  const max = niceMax(Math.max(1, ...totals));
  const W = 100, H = 100;
  const x = (i: number) => (labels.length <= 1 ? 0 : (i / (labels.length - 1)) * W);
  const y = (v: number) => H - (v / max) * H;

  //   아래에서부터 쌓는다 — 첫 계열이 바닥, 꼭대기 선이 합계
  let acc = labels.map(() => 0);
  const bands = series.map((sr) => {
    const lower = [...acc];
    acc = acc.map((v, i) => v + (sr.values[i] || 0));
    const upper = [...acc];
    const top = upper.map((v, i) => `${x(i)},${y(v)}`);
    return {
      name: sr.name,
      area: [...top, ...lower.map((v, i) => `${x(i)},${y(v)}`).reverse()].join(" "),
      line: top.join(" "),
    };
  });

  return (
    <div className="viz-wrap" style={{ height }}>
      <div className="viz-yaxis"><em>{fmt(max)}</em><em>{fmt(max / 2)}</em><em>0</em></div>
      <div className="viz-plot" onMouseLeave={() => setHover(null)}>
        <span className="viz-grid" /><span className="viz-grid viz-grid-mid" />
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="viz-svg">
          {bands.map((b, i) => (
            <g key={b.name}>
              {/*  칠은 옅게, 경계는 선명하게 — 면이 진하면 위아래 계열이 서로를 가린다 */}
              <polygon points={b.area} fill={vizColor(i)} fillOpacity={0.32} />
              <polyline points={b.line} fill="none" stroke={vizColor(i)} strokeWidth="2"
                vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
            </g>
          ))}
        </svg>
        {labels.map((l, i) => (
          <span key={`${l}-${i}`} className="viz-hit" style={{ left: `${x(i)}%` }} onMouseEnter={() => setHover(i)}>
            {hover === i && (
              <b className="viz-tip viz-tip-line">{l}
                {series.map((s, si) => (
                  <em key={s.name}><i style={{ background: vizColor(si) }} />{s.name} {fmt(s.values[i] || 0)}{unit}</em>
                ))}
                <em><i className="viz-tip-total" />합계 {fmt(totals[i])}{unit}</em>
              </b>
            )}
          </span>
        ))}
      </div>
      <div className="viz-xaxis">{axisLabels(labels)}</div>
    </div>
  );
}
