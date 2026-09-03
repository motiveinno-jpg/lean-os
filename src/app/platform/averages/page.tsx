"use client";

// 재무 평균 — 전체 고객사의 월별 재무 지표 통계(평균·중앙값·사분위).
//   2026-09-03 v2 디자인 — pf 부품 + Bklit 막대 차트. RPC 호출은 그대로.

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { PfPage, PfPageHead, PfCard, PfCardHead, PfCardBody, PfKpi, PfBadge, PfSkeleton, PfEmpty, PfSeg } from "@/app/platform/_components/pf/ui";
import { PfBars } from "@/app/platform/_components/pf/charts";

const db = supabase;

type MetricRow = {
  metric: string;
  label: string;
  avg_value: number;
  median_value: number;
  p25_value: number;
  p75_value: number;
  min_value: number;
  max_value: number;
  stddev_value: number | null;
  sample_size: number;
};

type MonthRow = { month: string; company_count: number };

function fmtW(n: number | null | undefined): string {
  const x = Number(n || 0);
  const abs = Math.abs(x);
  const sign = x < 0 ? "-" : "";
  if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(1)}억`;
  if (abs >= 1e4) return `${sign}${Math.round(abs / 1e4).toLocaleString()}만`;
  return `${sign}₩${abs.toLocaleString()}`;
}

type View = "cards" | "chart";

export default function PlatformAveragesPage() {
  const [month, setMonth] = useState<string>(""); // 빈 문자열 = 최신
  const [view, setView] = useState<View>("cards");

  const { data: months = [] } = useQuery<MonthRow[]>({
    queryKey: ["op-fin-months"],
    queryFn: async () => {
      const { data, error } = await db.rpc("operator_financial_months");
      if (error) throw error;
      return (data || []) as MonthRow[];
    },
  });

  const effectiveMonth = month || months[0]?.month || "";

  const { data: rows = [], isLoading, error } = useQuery<MetricRow[]>({
    queryKey: ["op-fin-averages", effectiveMonth],
    queryFn: async () => {
      const { data, error } = await db.rpc("operator_financial_averages", {
        p_month: effectiveMonth || undefined,
      });
      if (error) throw error;
      return (data || []) as MetricRow[];
    },
    enabled: !!effectiveMonth || months.length === 0,
  });

  const sampleSize = rows[0]?.sample_size ?? 0;

  // 지표별 평균·중앙값 비교 막대 — 지표마다 단위가 달라 만원 단위로 통일(한 축)
  const chartRows = rows.map((r) => ({
    name: r.label,
    avg: Math.round(Number(r.avg_value || 0) / 1e4),
    median: Math.round(Number(r.median_value || 0) / 1e4),
  }));
  const fmtMan = (v: number) => `${v.toLocaleString("ko-KR")}만`;

  const actions = (
    <div className="flex items-center gap-2 flex-wrap">
      <PfSeg<View> value={view} onChange={setView} options={[{ value: "cards", label: "지표 카드" }, { value: "chart", label: "비교 차트" }]} />
      <select
        value={effectiveMonth}
        onChange={(e) => setMonth(e.target.value)}
        className="pf-btn"
      >
        {months.length === 0 && <option value="">데이터 없음</option>}
        {months.map((m) => (
          <option key={m.month} value={m.month}>
            {m.month} · {m.company_count}개 회사
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <PfPage>
      <PfPageHead
        eyebrow="운영"
        title="재무 평균"
        desc="오너뷰를 쓰는 회사들의 한 달 재무 지표를 한데 모아 평균과 중앙값, 위·아래 25% 경계를 보여줍니다. 우리 고객이 어떤 규모의 회사인지 감을 잡는 화면입니다."
        actions={actions}
      />

      {/* 요약 */}
      <div className="pf-kpi-grid">
        <div className="pf-kpi-tile pf-in" style={{ ["--pf-i" as string]: 1 }}>
          <PfKpi label="집계 월" value={effectiveMonth || "—"} />
        </div>
        <div className="pf-kpi-tile pf-in" style={{ ["--pf-i" as string]: 2 }}>
          <PfKpi label="표본 회사" value={sampleSize} unit="곳" />
          <div className="mt-1">
            {sampleSize > 0 && sampleSize < 10
              ? <PfBadge tone="warn">표본이 적어 참고용</PfBadge>
              : sampleSize >= 10 ? <PfBadge tone="ok">통계 참고 가능</PfBadge> : null}
          </div>
        </div>
        <div className="pf-kpi-tile pf-in" style={{ ["--pf-i" as string]: 3 }}>
          <PfKpi label="집계 지표" value={rows.length} unit="개" />
        </div>
      </div>

      {sampleSize > 0 && sampleSize < 10 && (
        <PfCard i={4} hover={false} pad className="text-[12px] text-[var(--text-muted)]">
          표본이 <b className="text-[var(--text)]">{sampleSize}곳</b>뿐이라 평균과 중앙값이 한두 회사에 크게 흔들립니다. 회사가 늘어날수록 믿을 만해집니다.
        </PfCard>
      )}

      {isLoading && (
        <PfCard pad><PfSkeleton h={16} rows={5} /></PfCard>
      )}
      {error && (
        <PfCard i={5}><PfEmpty>조회에 실패했습니다: {(error as any)?.message || "알 수 없는 오류"}</PfEmpty></PfCard>
      )}
      {!isLoading && !error && rows.length === 0 && (
        <PfCard i={5}><PfEmpty>이 달에는 집계할 수 있는 재무 데이터가 없습니다.</PfEmpty></PfCard>
      )}

      {!isLoading && rows.length > 0 && view === "chart" && (
        <PfCard i={5}>
          <PfCardHead title="지표별 평균 vs 중앙값" sub="단위 만원 · 평균이 중앙값보다 훨씬 크면 큰 회사 몇 곳이 끌어올린 것" />
          <PfCardBody>
            <PfBars
              data={chartRows}
              xKey="name"
              series={[{ key: "avg", label: "평균", format: fmtMan }, { key: "median", label: "중앙값", format: fmtMan }]}
              height={Math.max(220, rows.length * 44)}
              horizontal
              revealKey={effectiveMonth}
            />
          </PfCardBody>
        </PfCard>
      )}

      {!isLoading && rows.length > 0 && view === "cards" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {rows.map((r, idx) => {
            const avg = Number(r.avg_value || 0);
            const median = Number(r.median_value || 0);
            const p25 = Number(r.p25_value || 0);
            const p75 = Number(r.p75_value || 0);
            const min = Number(r.min_value || 0);
            const max = Number(r.max_value || 0);
            // 행별 [min, max] 선형 스케일 — 음수 지표(순이익·현금흐름 등)도 올바르게 배치.
            const span = max - min;
            const pct = (v: number) => span <= 0 ? 50 : Math.min(100, Math.max(0, ((v - min) / span) * 100));
            return (
              <PfCard key={r.metric} i={5 + idx}>
                <PfCardHead
                  title={r.label}
                  sub={`표본 ${r.sample_size}곳`}
                  right={
                    <div className="text-right shrink-0">
                      <div className="text-[10.5px] text-[var(--text-dim)]">평균</div>
                      <div className="text-lg font-extrabold mono-number text-[var(--primary)]">{fmtW(avg)}</div>
                    </div>
                  }
                />
                <PfCardBody>
                  {/* 범위 막대 — 회색 선: 최소~최대, 파란 상자: 가운데 50%(P25~P75), 세로선: 중앙값, ◆: 평균 */}
                  <div className="relative h-8 mb-3">
                    <div className="absolute top-1/2 -translate-y-1/2 h-px bg-[var(--border)]" style={{ left: `${pct(min)}%`, width: `${pct(max) - pct(min)}%` }} />
                    <div
                      className="absolute top-1.5 bottom-1.5 rounded-md pf-grow"
                      style={{ left: `${pct(p25)}%`, width: `${Math.max(0.5, pct(p75) - pct(p25))}%`, background: "color-mix(in oklab, var(--chart-1) 22%, transparent)", border: "1px solid color-mix(in oklab, var(--chart-1) 55%, transparent)" }}
                      title={`가운데 50% ${fmtW(p25)} ~ ${fmtW(p75)}`}
                    />
                    <div className="absolute top-1 bottom-1 w-0.5 rounded" style={{ left: `${pct(median)}%`, background: "var(--chart-1)" }} title={`중앙값 ${fmtW(median)}`} />
                    <div className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rotate-45 -ml-1 rounded-[2px]" style={{ left: `${pct(avg)}%`, background: "var(--chart-2)" }} title={`평균 ${fmtW(avg)}`} />
                  </div>
                  <div className="grid grid-cols-5 gap-1.5 text-[11px]">
                    {[
                      { k: "최소", v: min },
                      { k: "하위 25%", v: p25 },
                      { k: "중앙값", v: median, on: true },
                      { k: "상위 25%", v: p75 },
                      { k: "최대", v: max },
                    ].map((c) => (
                      <div key={c.k} className={`rounded-lg px-2 py-1.5 ${c.on ? "bg-[var(--primary-light)]" : "bg-[var(--bg-surface)]"}`}>
                        <div className={c.on ? "text-[var(--primary)]" : "text-[var(--text-dim)]"}>{c.k}</div>
                        <div className={`font-semibold mono-number ${c.on ? "text-[var(--primary)]" : "text-[var(--text)]"}`}>{fmtW(c.v)}</div>
                      </div>
                    ))}
                  </div>
                </PfCardBody>
              </PfCard>
            );
          })}
        </div>
      )}

      {rows.length > 0 && (
        <div className="text-[11px] text-[var(--text-dim)] px-1">
          범위 막대 읽는 법 — 파란 상자는 가운데 50% 회사, 세로선은 중앙값, <span style={{ color: "var(--chart-2)" }}>◆</span>는 평균.
          업종별로 나눠 보려면 <Link href="/platform/industry" className="text-[var(--primary)] hover:underline font-medium">업계 분석</Link>으로.
        </div>
      )}
    </PfPage>
  );
}
