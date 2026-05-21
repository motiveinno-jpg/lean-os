"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

const db = supabase as any;

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
        p_month: effectiveMonth || null,
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
    <div className="max-w-5xl">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-white">재무 평균</h1>
          <p className="text-sm text-[#64748b] mt-1">
            전체 회사 월별 재무 지표 — 평균·중앙값·1·3사분위·표준편차
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-[#64748b]">월</label>
          <select
            value={effectiveMonth}
            onChange={(e) => setMonth(e.target.value)}
            className="px-3 py-2 bg-[#111827] border border-[#1e293b] rounded-lg text-sm text-white focus:outline-none focus:border-cyan-500"
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
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 text-xs text-amber-300 mb-4">
          ⚠ 표본 {sampleSize}개 — 평균/중앙값의 통계적 의미는 제한적입니다. 회사가 늘어날수록 신뢰도가 올라갑니다.
        </div>
      )}

      {isLoading && <div className="text-sm text-[#64748b]">불러오는 중…</div>}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-sm text-red-400">
          {(error as any)?.message || "조회 실패"}
        </div>
      )}

      {!isLoading && rows.length === 0 && (
        <div className="bg-[#111827] rounded-2xl border border-[#1e293b] p-8 text-center text-sm text-[#64748b]">
          이 달에는 집계 가능한 monthly_financials 데이터가 없습니다.
        </div>
      )}

      <div className="space-y-3">
        {rows.map((r) => {
          const avg = Number(r.avg_value || 0);
          const median = Number(r.median_value || 0);
          const p25 = Number(r.p25_value || 0);
          const p75 = Number(r.p75_value || 0);
          const min = Number(r.min_value || 0);
          const max = Number(r.max_value || 0);
          const pct = (v: number) => Math.min(100, Math.max(0, (Math.abs(v) / globalMax) * 100));
          return (
            <div key={r.metric} className="bg-[#111827] rounded-2xl border border-[#1e293b] p-5">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-white font-bold text-sm">{r.label}</div>
                  <div className="text-[11px] text-[#64748b]">표본 {r.sample_size}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-[#64748b]">평균</div>
                  <div className="text-lg font-extrabold text-cyan-300">{fmtW(avg)}</div>
                </div>
              </div>

              {/* 박스 플롯 스타일 — min, p25, median, p75, max */}
              <div className="relative h-7 bg-[#0b0f1a] rounded-lg overflow-hidden">
                {/* 전체 min~max 가로선 */}
                <div
                  className="absolute top-1/2 -translate-y-1/2 h-px bg-[#334155]"
                  style={{ left: `${pct(min)}%`, width: `${pct(max) - pct(min)}%` }}
                />
                {/* 사분위 박스 */}
                <div
                  className="absolute top-1 bottom-1 bg-cyan-600/30 border border-cyan-500/50 rounded"
                  style={{ left: `${pct(p25)}%`, width: `${Math.max(0.5, pct(p75) - pct(p25))}%` }}
                  title={`P25 ${fmtW(p25)} ~ P75 ${fmtW(p75)}`}
                />
                {/* 중앙값 마커 */}
                <div
                  className="absolute top-0.5 bottom-0.5 w-0.5 bg-cyan-200"
                  style={{ left: `${pct(median)}%` }}
                  title={`중앙값 ${fmtW(median)}`}
                />
                {/* 평균 마커 (다이아) */}
                <div
                  className="absolute top-1/2 -translate-y-1/2 w-2 h-2 bg-amber-300 rotate-45 -ml-1"
                  style={{ left: `${pct(avg)}%` }}
                  title={`평균 ${fmtW(avg)}`}
                />
              </div>

              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mt-3 text-[11px]">
                <div className="bg-[#0b0f1a] rounded-lg px-2.5 py-1.5">
                  <div className="text-[#64748b]">최소</div>
                  <div className="text-white font-semibold">{fmtW(min)}</div>
                </div>
                <div className="bg-[#0b0f1a] rounded-lg px-2.5 py-1.5">
                  <div className="text-[#64748b]">P25</div>
                  <div className="text-white font-semibold">{fmtW(p25)}</div>
                </div>
                <div className="bg-[#0b0f1a] rounded-lg px-2.5 py-1.5">
                  <div className="text-cyan-300">중앙</div>
                  <div className="text-cyan-200 font-semibold">{fmtW(median)}</div>
                </div>
                <div className="bg-[#0b0f1a] rounded-lg px-2.5 py-1.5">
                  <div className="text-[#64748b]">P75</div>
                  <div className="text-white font-semibold">{fmtW(p75)}</div>
                </div>
                <div className="bg-[#0b0f1a] rounded-lg px-2.5 py-1.5">
                  <div className="text-[#64748b]">최대</div>
                  <div className="text-white font-semibold">{fmtW(max)}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {rows.length > 0 && (
        <div className="mt-6 bg-cyan-600/5 border border-cyan-600/20 rounded-2xl p-4 text-xs text-[#94a3b8]">
          <span className="text-cyan-400 font-bold">OP-C</span> · 막대 안 <span className="text-amber-300">◆</span> 평균, <span className="text-cyan-200">│</span> 중앙값, 박스는 P25~P75.
          업계별 분리는 <span className="text-cyan-400">/platform/industry</span> (PR-D) 에서.
        </div>
      )}
    </div>
  );
}
