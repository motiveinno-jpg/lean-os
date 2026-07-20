"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

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

export default function PlatformAveragesPage() {
  const [month, setMonth] = useState<string>(""); // 빈 문자열 = 최신

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

  // 최대값 계산 — 막대 길이 정규화
  const globalMax = useMemo(() => {
    const m = rows.reduce((acc, r) => Math.max(acc, Math.abs(r.max_value || 0)), 0);
    return m || 1;
  }, [rows]);

  const sampleSize = rows[0]?.sample_size ?? 0;

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-[var(--text)]">재무 평균</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            전체 회사 월별 재무 지표 — 평균·중앙값·1·3사분위·표준편차
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-[var(--text-dim)]">월</label>
          <select
            value={effectiveMonth}
            onChange={(e) => setMonth(e.target.value)}
            className="px-3 py-2 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg text-sm text-[var(--text)] focus:outline-none focus:border-[var(--primary)]"
          >
            {months.length === 0 && <option value="">데이터 없음</option>}
            {months.map((m) => (
              <option key={m.month} value={m.month}>
                {m.month} · {m.company_count}개 회사
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 표본 안내 */}
      {sampleSize > 0 && sampleSize < 10 && (
        <div className="platform-sample-size-warning kpi-callout warning">
          ⚠ 표본 <b>{sampleSize}개</b> — 평균/중앙값의 통계적 의미는 제한적입니다. 회사가 늘어날수록 신뢰도가 올라갑니다.
        </div>
      )}

      {isLoading && <div className="text-sm text-[var(--text-dim)]">불러오는 중…</div>}
      {error && (
        <div className="rounded-xl bg-[var(--danger-dim)] p-4 text-sm text-[var(--danger)]">
          {(error as any)?.message || "조회 실패"}
        </div>
      )}

      {!isLoading && rows.length === 0 && (
        <div className="glass-card p-8 text-center text-sm text-[var(--text-dim)]">
          이 달에는 집계 가능한 monthly_financials 데이터가 없습니다.
        </div>
      )}

      <div className="space-y-4">
        {rows.map((r) => {
          const avg = Number(r.avg_value || 0);
          const median = Number(r.median_value || 0);
          const p25 = Number(r.p25_value || 0);
          const p75 = Number(r.p75_value || 0);
          const min = Number(r.min_value || 0);
          const max = Number(r.max_value || 0);
          const pct = (v: number) => Math.min(100, Math.max(0, (Math.abs(v) / globalMax) * 100));
          return (
            <div key={r.metric} className="platform-metric-card glass-card">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-[var(--text)] font-bold text-sm">{r.label}</div>
                  <div className="text-[11px] text-[var(--text-dim)]">표본 {r.sample_size}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-[var(--text-dim)]">평균</div>
                  <div className="text-lg font-extrabold mono-number text-[var(--primary)]">{fmtW(avg)}</div>
                </div>
              </div>

              {/* 박스 플롯 스타일 — min, p25, median, p75, max */}
              <div className="platform-boxplot">
                {/* 전체 min~max 가로선 */}
                <div
                  className="absolute top-1/2 -translate-y-1/2 h-px bg-[var(--border-light)]"
                  style={{ left: `${pct(min)}%`, width: `${pct(max) - pct(min)}%` }}
                />
                {/* 사분위 박스 */}
                <div
                  className="absolute top-1 bottom-1 bg-[var(--primary)]/25 border border-[var(--primary)]/50 rounded"
                  style={{ left: `${pct(p25)}%`, width: `${Math.max(0.5, pct(p75) - pct(p25))}%` }}
                  title={`P25 ${fmtW(p25)} ~ P75 ${fmtW(p75)}`}
                />
                {/* 중앙값 마커 */}
                <div
                  className="absolute top-0.5 bottom-0.5 w-0.5 bg-[var(--primary)]"
                  style={{ left: `${pct(median)}%` }}
                  title={`중앙값 ${fmtW(median)}`}
                />
                {/* 평균 마커 (다이아) */}
                <div
                  className="absolute top-1/2 -translate-y-1/2 w-2 h-2 bg-[var(--warning)] rotate-45 -ml-1"
                  style={{ left: `${pct(avg)}%` }}
                  title={`평균 ${fmtW(avg)}`}
                />
              </div>

              <div className="platform-metric-stats-grid">
                <div className="bg-[var(--bg-surface)] rounded-lg px-2.5 py-1.5">
                  <div className="text-[var(--text-dim)]">최소</div>
                  <div className="text-[var(--text)] font-semibold mono-number">{fmtW(min)}</div>
                </div>
                <div className="bg-[var(--bg-surface)] rounded-lg px-2.5 py-1.5">
                  <div className="text-[var(--text-dim)]">P25</div>
                  <div className="text-[var(--text)] font-semibold mono-number">{fmtW(p25)}</div>
                </div>
                <div className="bg-[var(--primary-light)] rounded-lg px-2.5 py-1.5">
                  <div className="text-[var(--primary)]">중앙</div>
                  <div className="text-[var(--primary)] font-semibold mono-number">{fmtW(median)}</div>
                </div>
                <div className="bg-[var(--bg-surface)] rounded-lg px-2.5 py-1.5">
                  <div className="text-[var(--text-dim)]">P75</div>
                  <div className="text-[var(--text)] font-semibold mono-number">{fmtW(p75)}</div>
                </div>
                <div className="bg-[var(--bg-surface)] rounded-lg px-2.5 py-1.5">
                  <div className="text-[var(--text-dim)]">최대</div>
                  <div className="text-[var(--text)] font-semibold mono-number">{fmtW(max)}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {rows.length > 0 && (
        <div className="kpi-callout">
          <b>OP-C</b> · 막대 안 <span className="text-[var(--warning)]">◆</span> 평균, <span className="text-[var(--primary)]">│</span> 중앙값, 박스는 P25~P75.
          업계별 분리는 <span className="text-[var(--primary)]">/platform/industry</span> (PR-D) 에서.
        </div>
      )}
    </div>
  );
}
