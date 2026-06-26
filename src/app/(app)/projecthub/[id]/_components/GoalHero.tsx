"use client";

// 목표형 히어로 — 목표/누적실적/잔여/달성률(게이지) + 추이(막대) + 페이스 경고.
//   누적실적 출처: goal_source='revenue_auto' → v_deal_goal_actual, 'manual' → sum(project_kpi_entries).
//   이중계상 금지 — 출처 하나만 사용.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { getPaceWarning } from "@/lib/project-types";

const db = supabase as any;
const fmtNum = (n: number, unit: string) => `${Math.round(Number(n || 0)).toLocaleString("ko-KR")}${unit}`;

export function GoalHero({ deal }: { deal: any }) {
  const dealId = deal.id as string;
  const target = Number(deal.target_amount || 0);
  const unit = deal.target_unit || "원";
  const label = deal.target_label || "매출";
  const source: "revenue_auto" | "manual" = deal.goal_source === "manual" ? "manual" : "revenue_auto";

  // 자동 실적 (revenue_auto) — v_deal_goal_actual
  const { data: autoActual } = useQuery({
    queryKey: ["goal-actual-auto", dealId],
    queryFn: async () => {
      const { data } = await db.from("v_deal_goal_actual").select("actual_amount").eq("deal_id", dealId).maybeSingle();
      return Number(data?.actual_amount || 0);
    },
    enabled: source === "revenue_auto",
  });

  // 수동 KPI (manual) — project_kpi_entries (추이용으로 전체 로드)
  const { data: kpiEntries = [] } = useQuery({
    queryKey: ["goal-kpi-entries", dealId],
    queryFn: async () => {
      const { data } = await db.from("project_kpi_entries").select("entry_date, value").eq("deal_id", dealId).order("entry_date", { ascending: true });
      return (data || []) as { entry_date: string; value: number }[];
    },
    enabled: source === "manual",
  });

  const actual = source === "manual"
    ? (kpiEntries as any[]).reduce((s, e) => s + Number(e.value || 0), 0)
    : Number(autoActual || 0);
  const remaining = Math.max(0, target - actual);
  const pct = target > 0 ? Math.round((actual / target) * 100) : 0;

  // 추이 막대 — 수동이면 entry별 누적, 자동이면 단일 막대(추이 데이터 없음)
  const trend = useMemo(() => {
    if (source !== "manual") return [] as { date: string; cum: number }[];
    let cum = 0;
    return (kpiEntries as any[]).map((e) => { cum += Number(e.value || 0); return { date: String(e.entry_date).slice(5, 10), cum }; });
  }, [kpiEntries, source]);
  const trendMax = useMemo(() => Math.max(target, ...trend.map((t) => t.cum), 1), [trend, target]);

  // 최근 정체 — 마지막 entry 가 14일 이상 전이면 정체로 간주(recentGain=0)
  const recentGain = useMemo(() => {
    if (source !== "manual" || (kpiEntries as any[]).length === 0) return null;
    const last = (kpiEntries as any[])[(kpiEntries as any[]).length - 1];
    const lastDate = new Date(String(last.entry_date));
    const days = (Date.now() - lastDate.getTime()) / 86400000;
    return days > 14 ? 0 : 1;
  }, [kpiEntries, source]);

  const pace = getPaceWarning({
    targetAmount: target, actualAmount: actual,
    startDate: deal.start_date, endDate: deal.end_date,
    recentGain,
  });

  const gaugeColor = pct >= 100 ? "bg-green-500" : pct >= 70 ? "bg-[var(--primary)]" : pct >= 40 ? "bg-amber-500" : "bg-red-500";
  const paceColor = pace.tone === "danger" ? "text-red-500" : pace.tone === "warn" ? "text-amber-500" : "text-green-500";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Metric label={`목표 (${label})`} value={target > 0 ? fmtNum(target, unit) : "—"} />
        <Metric label="누적 실적" value={fmtNum(actual, unit)} accent="primary" />
        <Metric label="잔여" value={fmtNum(remaining, unit)} accent={remaining > 0 ? undefined : "primary"} />
        <Metric label="달성률" value={target > 0 ? `${pct}%` : "—"} accent={pct >= 100 ? "primary" : pct < 40 ? "danger" : undefined} />
      </div>

      {/* 게이지 */}
      <div className="glass-card p-4 space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="font-bold text-[var(--text-muted)]">달성률</span>
          <span className="mono-number text-[var(--text)]">{fmtNum(actual, unit)} / {target > 0 ? fmtNum(target, unit) : "—"}</span>
        </div>
        <div className="h-3 rounded-full bg-[var(--bg-surface)] overflow-hidden">
          <div className={`h-full rounded-full transition-all ${gaugeColor}`} style={{ width: `${Math.min(100, pct)}%` }} />
        </div>
        {pct > 100 && <p className="text-[11px] text-green-500">목표를 {pct - 100}% 초과 달성했습니다 🎉</p>}
      </div>

      {/* 페이스 경고 */}
      <div className={`glass-card p-4 flex items-start gap-3 ${pace.tone === "danger" ? "border border-red-500/30" : pace.tone === "warn" ? "border border-amber-500/30" : ""}`}>
        <div className="flex-1">
          <div className={`text-sm font-semibold ${paceColor}`}>{pace.message}</div>
          {(pace.requiredDaily != null || pace.currentDaily != null) && (
            <div className="text-[11px] text-[var(--text-dim)] mt-1 flex flex-wrap gap-x-4">
              {pace.requiredDaily != null && <span>필요 일평균 <b className="text-[var(--text-muted)] mono-number">{fmtNum(pace.requiredDaily, unit)}</b></span>}
              {pace.currentDaily != null && <span>현재 일평균 <b className="text-[var(--text-muted)] mono-number">{fmtNum(pace.currentDaily, unit)}</b></span>}
              {pace.projected != null && <span>예상 최종 <b className="text-[var(--text-muted)] mono-number">{fmtNum(pace.projected, unit)}</b></span>}
            </div>
          )}
        </div>
      </div>

      {/* 추이 (수동 KPI 만) */}
      {source === "manual" && trend.length > 0 && (
        <div className="glass-card p-4">
          <div className="text-xs font-bold text-[var(--text-muted)] mb-3">누적 추이</div>
          <div className="flex items-end gap-1 h-32">
            {trend.map((t, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1 min-w-0" title={`${t.date}: ${fmtNum(t.cum, unit)}`}>
                <div className="w-full rounded-t bg-[var(--primary)]/70 hover:bg-[var(--primary)] transition" style={{ height: `${Math.max(2, (t.cum / trendMax) * 100)}%` }} />
                <span className="text-[9px] text-[var(--text-dim)] mono-number truncate w-full text-center">{t.date}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {source === "revenue_auto" && (
        <p className="text-[11px] text-[var(--text-dim)]">※ 누적 실적은 <b className="text-[var(--text-muted)]">매출 세금계산서(공급가액, 무효 제외)</b>를 자동 집계합니다. 추이를 보려면 실적 출처를 ‘수동 KPI’로 변경하세요.</p>
      )}
    </div>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: "primary" | "danger" }) {
  const color = value === "—" ? "text-[var(--text-dim)]" : accent === "danger" ? "text-[var(--danger)]" : accent === "primary" ? "text-[var(--primary)]" : "text-[var(--text)]";
  return (
    <div className="glass-card px-3 py-2.5">
      <div className="text-[11px] text-[var(--text-muted)]">{label}</div>
      <div className={`text-base font-bold mono-number mt-0.5 ${color}`}>{value}</div>
    </div>
  );
}
