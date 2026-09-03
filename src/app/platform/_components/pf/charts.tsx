"use client";

// 운영자 페이지 차트 래퍼 (2026-09-03) — Bklit UI(@bklit 레지스트리, src/components/charts) 위에
//   오너뷰 데이터 형태·한국어 포맷·빈 상태를 얹는다. 색은 --chart-1..5(검증된 팔레트)만 쓴다.
//   · PfTrend  — 시계열 영역(AreaChart) — 방문·가입·매출 추이
//   · PfBars   — 카테고리 막대(BarChart) — 월별·항목별 비교, 누적 가능
//   · PfRings  — 동심 링(RingChart) — 목표 대비 진행 여러 개
//   · PfGauge  — 노치 게이지(Gauge) — 단일 비율 KPI
//   · PfFunnel — 퍼널(FunnelChart) — 방문→가입→유료
//   · PfDonut  — 도넛(PieChart) — 구성비 + 중앙 합계
//   dataviz 규칙: 한 축, 얇은 마크, 2시리즈 이상이면 범례, 시리즈 색은 고정 순서.

import React, { useMemo, useState } from "react";
import { AreaChart } from "@/components/charts/area-chart";
import { Area } from "@/components/charts/area";
import { BarChart } from "@/components/charts/bar-chart";
import { Bar } from "@/components/charts/bar";
import { BarXAxis } from "@/components/charts/bar-x-axis";
import { BarYAxis } from "@/components/charts/bar-y-axis";
import { Grid } from "@/components/charts/grid";
import { XAxis } from "@/components/charts/x-axis";
import { ChartTooltip } from "@/components/charts/tooltip";
import { RingChart } from "@/components/charts/ring-chart";
import { Ring } from "@/components/charts/ring";
import { RingCenter } from "@/components/charts/ring-center";
import { Gauge } from "@/components/charts/gauge";
import { FunnelChart } from "@/components/charts/funnel-chart";
import { PieChart } from "@/components/charts/pie-chart";
import { PieSlice } from "@/components/charts/pie-slice";
import { PieCenter } from "@/components/charts/pie-center";

export const PF_SERIES = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"] as const;

export type PfSeries = { key: string; label: string; color?: string; format?: (v: number) => string };

const fmtInt = (v: number) => Math.round(v).toLocaleString("ko-KR");

function Legend({ series }: { series: PfSeries[] }) {
  if (series.length < 2) return null;
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 mt-2 px-1">
      {series.map((s, i) => (
        <li key={s.key} className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
          <span className="w-2 h-2 rounded-full" style={{ background: s.color || PF_SERIES[i % 5] }} />{s.label}
        </li>
      ))}
    </ul>
  );
}

function Empty({ text, height }: { text: string; height: number }) {
  return <div className="flex items-center justify-center text-[12px] text-[var(--text-dim)]" style={{ height }}>{text}</div>;
}

/** 시계열 영역 차트. data 는 { date: Date|string, [key]: number }[] */
export function PfTrend({ data, series, xKey = "date", height = 220, empty = "표시할 데이터가 없습니다", dateLabel, revealKey, loading = false }: {
  data: Record<string, unknown>[];
  series: PfSeries[];
  xKey?: string;
  height?: number;
  empty?: string;
  dateLabel?: (d: Date) => string;
  revealKey?: string;
  loading?: boolean;
}) {
  const rows = useMemo(() => data.map((d) => ({ ...d, [xKey]: d[xKey] instanceof Date ? d[xKey] : new Date(String(d[xKey])) })), [data, xKey]);
  if (!loading && rows.length < 2) return <Empty text={empty} height={height} />;
  const fmtDate = dateLabel || ((d: Date) => `${d.getMonth() + 1}/${d.getDate()}`);
  return (
    <div>
      <AreaChart data={rows} xDataKey={xKey} aspectRatio="auto" style={{ height }} className="w-full" revealSignature={revealKey} status={loading ? "loading" : "ready"} loadingLabel="불러오는 중…" margin={{ top: 12, right: 8, bottom: 24, left: 8 }}>
        <Grid horizontal numTicksRows={4} fadeHorizontal hideHorizontalEdgeLines />
        {series.map((s, i) => (
          <Area key={s.key} dataKey={s.key} fill={s.color || PF_SERIES[i % 5]} stroke={s.color || PF_SERIES[i % 5]} strokeWidth={2} fillOpacity={0.22} gradientToOpacity={0} fadeEdges />
        ))}
        <XAxis numTicks={Math.min(6, rows.length)} />
        <ChartTooltip
          showCrosshair
          rows={(p) => series.map((s, i) => ({ label: s.label, value: (s.format || fmtInt)(Number(p[s.key] ?? 0)), color: s.color || PF_SERIES[i % 5] }))}
          content={({ point }) => {
            const d = point[xKey] instanceof Date ? (point[xKey] as Date) : new Date(String(point[xKey]));
            return (
              <div className="rounded-xl px-3 py-2 text-[11px] shadow-lg" style={{ background: "var(--chart-tooltip-background)", color: "var(--chart-tooltip-foreground)" }}>
                <div className="font-semibold mb-1 opacity-80">{fmtDate(d)}</div>
                {series.map((s, i) => (
                  <div key={s.key} className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: s.color || PF_SERIES[i % 5] }} />
                    <span className="opacity-80">{s.label}</span>
                    <span className="ml-auto font-bold mono-number">{(s.format || fmtInt)(Number(point[s.key] ?? 0))}</span>
                  </div>
                ))}
              </div>
            );
          }}
        />
      </AreaChart>
      <Legend series={series} />
    </div>
  );
}

/** 카테고리 막대 차트. data 는 { [xKey]: string, [key]: number }[] */
export function PfBars({ data, series, xKey = "name", height = 220, stacked = false, horizontal = false, empty = "표시할 데이터가 없습니다", revealKey }: {
  data: Record<string, unknown>[];
  series: PfSeries[];
  xKey?: string;
  height?: number;
  stacked?: boolean;
  horizontal?: boolean;
  empty?: string;
  revealKey?: string;
}) {
  if (data.length === 0) return <Empty text={empty} height={height} />;
  return (
    <div>
      <div style={{ height }} className="w-full">
      <BarChart data={data} xDataKey={xKey} aspectRatio="auto" className="w-full h-full" stacked={stacked} orientation={horizontal ? "horizontal" : "vertical"} revealSignature={revealKey} margin={{ top: 8, right: 8, bottom: 24, left: 8 }}>
        <Grid horizontal={!horizontal} vertical={horizontal} numTicksRows={4} fadeHorizontal hideHorizontalEdgeLines />
        {series.map((s, i) => (
          <Bar key={s.key} dataKey={s.key} fill={s.color || PF_SERIES[i % 5]} lineCap={4} staggerDelay={0.04} stackGap={stacked ? 2 : undefined} />
        ))}
        {horizontal ? <BarYAxis /> : <BarXAxis />}
        <ChartTooltip
          rows={(p) => series.map((s, i) => ({ label: s.label, value: (s.format || fmtInt)(Number(p[s.key] ?? 0)), color: s.color || PF_SERIES[i % 5] }))}
          content={({ point }) => (
            <div className="rounded-xl px-3 py-2 text-[11px] shadow-lg" style={{ background: "var(--chart-tooltip-background)", color: "var(--chart-tooltip-foreground)" }}>
              <div className="font-semibold mb-1 opacity-80">{String(point[xKey] ?? "")}</div>
              {series.map((s, i) => (
                <div key={s.key} className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: s.color || PF_SERIES[i % 5] }} />
                  <span className="opacity-80">{s.label}</span>
                  <span className="ml-auto font-bold mono-number">{(s.format || fmtInt)(Number(point[s.key] ?? 0))}</span>
                </div>
              ))}
            </div>
          )}
        />
      </BarChart>
      </div>
      <Legend series={series} />
    </div>
  );
}

/** 동심 링 — 목표 대비 진행. items: { label, value, max, color? } */
export function PfRings({ items, size = 200, centerLabel = "합계", formatCenter, strokeWidth = 12 }: {
  items: { label: string; value: number; max: number; color?: string }[];
  size?: number;
  centerLabel?: string;
  formatCenter?: (v: number) => string;
  strokeWidth?: number;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const data = items.map((it, i) => ({ label: it.label, value: it.value, maxValue: Math.max(it.max, 1), color: it.color || PF_SERIES[i % 5] }));
  if (items.length === 0) return <Empty text="표시할 데이터가 없습니다" height={size} />;
  return (
    <div className="flex items-center gap-5 min-w-0">
      <RingChart data={data} size={size} strokeWidth={strokeWidth} ringGap={5} baseInnerRadius={Math.round(size * 0.2)} hoveredIndex={hovered} onHoverChange={setHovered}>
        {data.map((d, i) => <Ring key={d.label} index={i} />)}
        <RingCenter defaultLabel={centerLabel}>
          {({ value, label }) => (
            <div className="flex flex-col items-center leading-tight">
              <span className="text-lg font-extrabold text-[var(--text)] mono-number">{formatCenter ? formatCenter(value) : fmtInt(value)}</span>
              <span className="text-[10px] text-[var(--text-dim)]">{label}</span>
            </div>
          )}
        </RingCenter>
      </RingChart>
      <ul className="flex-1 min-w-0 space-y-1.5">
        {data.map((d, i) => {
          const pct = Math.round((d.value / d.maxValue) * 100);
          return (
            <li key={d.label} className={`flex items-center gap-2 text-[12px] min-w-0 rounded-lg px-1.5 py-1 transition ${hovered === i ? "bg-[var(--bg-surface)]" : ""}`} onMouseEnter={() => setHovered(i)} onMouseLeave={() => setHovered(null)}>
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: d.color }} />
              <span className="flex-1 truncate text-[var(--text-muted)]">{d.label}</span>
              <span className="font-bold text-[var(--text)] mono-number">{fmtInt(d.value)}</span>
              <span className="text-[10px] text-[var(--text-dim)] mono-number w-9 text-right">{pct}%</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** 노치 게이지 — 단일 비율(0~100). */
export function PfGauge({ pct, label, centerValue, suffix = "%", width = 180, linear = false, tone }: {
  pct: number;
  label: string;
  centerValue?: number;
  suffix?: string;
  width?: number;
  linear?: boolean;
  tone?: "ok" | "warn" | "danger" | "info";
}) {
  const v = Math.max(0, Math.min(100, pct));
  const color = tone === "ok" ? "var(--success)" : tone === "warn" ? "#D97706" : tone === "danger" ? "var(--danger)" : "var(--chart-1)";
  return (
    <Gauge
      orientation={linear ? "linear" : "arc"}
      value={v}
      centerValue={centerValue ?? Math.round(v)}
      suffix={centerValue == null ? suffix : undefined}
      defaultLabel={label}
      totalNotches={linear ? 60 : 40}
      spacing={linear ? 0 : 20}
      notchCornerRadius={3}
      inactiveFillOpacity={0.28}
      activeFill={color}
      width={width}
      labelPlacement={linear ? "bottom" : undefined}
      labelAlign="center"
      formatOptions={{ maximumFractionDigits: 0 }}
    />
  );
}

/** 퍼널 — stages: { label, value, display? } (첫 단계 대비 % 자동). */
export function PfFunnel({ stages, height = 220, vertical = false }: { stages: { label: string; value: number; display?: string }[]; height?: number; vertical?: boolean }) {
  if (stages.length === 0 || stages.every((s) => s.value === 0)) return <Empty text="퍼널 데이터가 없습니다" height={height} />;
  return (
    <FunnelChart
      data={stages.map((s) => ({ label: s.label, value: s.value, displayValue: s.display ?? fmtInt(s.value) }))}
      color="var(--chart-1)"
      layers={3}
      orientation={vertical ? "vertical" : "horizontal"}
      edges="curved"
      gap={4}
      staggerDelay={0.1}
      showPercentage
      showValues
      showLabels
      labelLayout="spread"
      style={{ height }}
      formatPercentage={(p) => `${Math.round(p)}%`}
    />
  );
}

/** 도넛 — 구성비. slices: { label, value, color? }; 중앙에는 합계. */
export function PfDonut({ slices, size = 180, centerLabel = "합계", formatCenter, legend = true }: {
  slices: { label: string; value: number; color?: string }[];
  size?: number;
  centerLabel?: string;
  formatCenter?: (total: number) => string;
  legend?: boolean;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const live = slices.filter((s) => s.value > 0);
  const total = live.reduce((a, b) => a + b.value, 0);
  if (live.length === 0) return <Empty text="표시할 데이터가 없습니다" height={size} />;
  const data = live.map((s, i) => ({ label: s.label, value: s.value, color: s.color || PF_SERIES[i % 5] }));
  return (
    <div className="flex items-center gap-5 min-w-0">
      <PieChart data={data} size={size} innerRadius={Math.round(size * 0.33)} padAngle={0.025} cornerRadius={4} hoveredIndex={hovered} onHoverChange={setHovered}>
        {data.map((_, i) => <PieSlice key={i} index={i} hoverEffect="translate" hoverOffset={6} />)}
        <PieCenter defaultLabel={centerLabel}>
          {({ value, label }: { value: number; label: string }) => (
            <div className="flex flex-col items-center leading-tight">
              <span className="text-lg font-extrabold text-[var(--text)] mono-number">{formatCenter ? formatCenter(value) : fmtInt(value)}</span>
              <span className="text-[10px] text-[var(--text-dim)]">{label}</span>
            </div>
          )}
        </PieCenter>
      </PieChart>
      {legend && (
        <ul className="flex-1 min-w-0 space-y-1.5">
          {data.map((d, i) => (
            <li key={d.label} className={`flex items-center gap-2 text-[12px] min-w-0 rounded-lg px-1.5 py-1 transition ${hovered === i ? "bg-[var(--bg-surface)]" : ""}`} onMouseEnter={() => setHovered(i)} onMouseLeave={() => setHovered(null)}>
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: d.color }} />
              <span className="flex-1 truncate text-[var(--text-muted)]">{d.label}</span>
              <span className="font-bold text-[var(--text)] mono-number">{fmtInt(d.value)}</span>
              <span className="text-[10px] text-[var(--text-dim)] mono-number w-9 text-right">{total ? Math.round((d.value / total) * 100) : 0}%</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
