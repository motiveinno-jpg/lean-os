"use client";
import { logRead } from "@/lib/log-read";

// 목표형(성과관리) 히어로 — 다중 KPI 패널(목표/실적/달성률 게이지) + 종합 달성률 + 종합 신호등 + 페이스 경고.
//   실적 출처: KPI.source='revenue_auto' → v_deal_revenue_actual, 'manual' → sum(project_kpi_entries by kpi_id).
//   종합 달성률 = 평균(KPI 달성률, cap 100%). 종합 상태 = 최신 project_updates.status. 페이스 = 가장 위험한 KPI 대표.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { getKpiAchievement, getOverallAchievement, getOverallStatus, getPaceWarning, type KpiSource } from "@/lib/project-types";

const db = supabase as any;
const fmtNum = (n: number, unit: string) => `${Math.round(Number(n || 0)).toLocaleString("ko-KR")}${unit}`;

type Kpi = { id: string; label: string; unit: string; target_value: number; direction: "up" | "down"; source: KpiSource; sort_order: number };

const STATUS_META: Record<string, { dot: string; text: string; label: string }> = {
  green: { dot: "bg-green-500", text: "text-green-500", label: "정상(순항)" },
  yellow: { dot: "bg-amber-500", text: "text-amber-500", label: "주의" },
  red: { dot: "bg-red-500", text: "text-red-500", label: "위험" },
  neutral: { dot: "bg-[var(--text-dim)]", text: "text-[var(--text-muted)]", label: "체크인 없음" },
};

export function GoalHero({ deal }: { deal: any }) {
  const dealId = deal.id as string;

  // KPI 정의
  const { data: kpis = [] } = useQuery({
    queryKey: ["project-kpis", dealId],
    queryFn: async () => {
      const data = logRead('_components/GoalHero:data', await db.from("project_kpis").select("id, label, unit, target_value, direction, source, sort_order").eq("deal_id", dealId).order("sort_order", { ascending: true }));
      return (data || []) as Kpi[];
    },
    enabled: !!dealId,
  });

  // 수동 KPI 실적 (kpi_id 기준 합)
  const { data: entries = [] } = useQuery({
    queryKey: ["project-kpi-entries-all", dealId],
    queryFn: async () => {
      const data = logRead('_components/GoalHero:data', await db.from("project_kpi_entries").select("kpi_id, entry_date, value").eq("deal_id", dealId).order("entry_date", { ascending: true }));
      return (data || []) as { kpi_id: string; entry_date: string; value: number }[];
    },
    enabled: !!dealId,
  });

  // 자동 실적 (auto KPI 가 하나라도 있으면 로드) — 매출/이익/건수 통합
  const hasAuto = (kpis as Kpi[]).some((k) => k.source !== "manual");
  const { data: autoActual } = useQuery({
    queryKey: ["deal-kpi-auto", dealId],
    queryFn: async () => {
      const data = logRead('_components/GoalHero:data', await db.from("v_deal_kpi_auto").select("revenue_actual, profit_actual, output_count").eq("deal_id", dealId).maybeSingle());
      return { revenue: Number(data?.revenue_actual || 0), profit: Number(data?.profit_actual || 0), count: Number(data?.output_count || 0) };
    },
    enabled: !!dealId && hasAuto,
  });

  // 최신 성과 체크인 (종합 신호등)
  const { data: latestUpdate } = useQuery({
    queryKey: ["project-updates-latest", dealId],
    queryFn: async () => {
      const data = logRead('_components/GoalHero:data', await db.from("project_updates").select("status, update_date").eq("deal_id", dealId).order("update_date", { ascending: false }).order("created_at", { ascending: false }).limit(1).maybeSingle());
      return data as { status: string; update_date: string } | null;
    },
    enabled: !!dealId,
  });

  // KPI별 실적 누적값(manual 은 entries 합, auto 는 v_deal_revenue_actual)
  const actualByKpi = useMemo(() => {
    const m: Record<string, number> = {};
    for (const e of entries as any[]) m[e.kpi_id] = (m[e.kpi_id] || 0) + Number(e.value || 0);
    return m;
  }, [entries]);
  const actualOf = (k: Kpi) => {
    if (k.source === "revenue_auto") return Number(autoActual?.revenue || 0);
    if (k.source === "profit_auto") return Number(autoActual?.profit || 0);
    if (k.source === "count_auto") return Number(autoActual?.count || 0);
    return Number(actualByKpi[k.id] || 0);
  };

  // KPI별 마지막 입력일(manual 정체 판정용)
  const lastEntryByKpi = useMemo(() => {
    const m: Record<string, string> = {};
    for (const e of entries as any[]) if (!m[e.kpi_id] || e.entry_date > m[e.kpi_id]) m[e.kpi_id] = e.entry_date;
    return m;
  }, [entries]);

  const rows = (kpis as Kpi[]).map((k) => {
    const actual = actualOf(k);
    const ach = getKpiAchievement(Number(k.target_value || 0), actual, k.direction);
    return { k, actual, ach };
  });
  const overall = getOverallAchievement((kpis as Kpi[]).map((k) => ({ target: Number(k.target_value || 0), actual: actualOf(k), direction: k.direction })));
  const overallPct = overall == null ? null : Math.round(overall * 100);
  const status = getOverallStatus(latestUpdate?.status);
  const sm = STATUS_META[status];

  // 페이스 경고 — 가장 미달폭(달성률 최저) 큰 KPI 대표
  const worst = rows.filter((r) => r.ach != null).sort((a, b) => (a.ach! - b.ach!))[0];
  const worstPace = worst
    ? getPaceWarning({
        targetAmount: Number(worst.k.target_value || 0),
        actualAmount: worst.actual,
        startDate: deal.start_date, endDate: deal.end_date,
        recentGain: worst.k.source === "manual" && lastEntryByKpi[worst.k.id]
          ? ((Date.now() - new Date(lastEntryByKpi[worst.k.id]).getTime()) / 86400000 > 14 ? 0 : 1)
          : null,
      })
    : null;
  const paceColor = worstPace?.tone === "danger" ? "text-red-500" : worstPace?.tone === "warn" ? "text-amber-500" : "text-green-500";

  if ((kpis as Kpi[]).length === 0) {
    return (
      <div className="goal-hero-empty glass-card">
        등록된 KPI가 없습니다. <b className="text-[var(--text)]">성과</b> 탭에서 KPI를 추가하면 목표·실적·달성률이 여기에 표시됩니다.
      </div>
    );
  }

  return (
    <div className="goal-hero">
      {/* 좌 2/3 — 페이스 경고 + KPI 패널 */}
      <div className="goal-hero-main">
      {/* 페이스 경고 (대표 KPI) */}
      {worstPace && (
        <div className={`goal-hero-pace-warning glass-card ${worstPace.tone === "danger" ? "border border-red-500/30" : worstPace.tone === "warn" ? "border border-amber-500/30" : ""}`}>
          <div className="flex-1">
            <div className={`text-sm font-semibold ${paceColor}`}>
              {worst && <span className="text-[var(--text-muted)] font-normal">[{worst.k.label}] </span>}{worstPace.message}
            </div>
            {(worstPace.requiredDaily != null || worstPace.currentDaily != null) && (
              <div className="text-[11px] text-[var(--text-dim)] mt-1 flex flex-wrap gap-x-4">
                {worstPace.requiredDaily != null && <span>필요 일평균 <b className="text-[var(--text-muted)] mono-number">{fmtNum(worstPace.requiredDaily, worst!.k.unit)}</b></span>}
                {worstPace.currentDaily != null && <span>현재 일평균 <b className="text-[var(--text-muted)] mono-number">{fmtNum(worstPace.currentDaily, worst!.k.unit)}</b></span>}
                {worstPace.projected != null && <span>예상 최종 <b className="text-[var(--text-muted)] mono-number">{fmtNum(worstPace.projected, worst!.k.unit)}</b></span>}
              </div>
            )}
          </div>
        </div>
      )}

      {/* KPI 패널 — 목표/실적/달성률 게이지 */}
      <div className="goal-hero-kpi-list">
        {rows.map(({ k, actual, ach }) => {
          const pct = ach == null ? null : Math.round(ach * 100);
          const gaugeColor = pct == null ? "bg-[var(--text-dim)]" : pct >= 100 ? "bg-green-500" : pct >= 70 ? "bg-[var(--primary)]" : pct >= 40 ? "bg-amber-500" : "bg-red-500";
          return (
            <div key={k.id} className="goal-hero-kpi-card glass-card">
              <div className="goal-hero-kpi-card-header">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-[var(--text)]">{k.label}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--bg-surface)] text-[var(--text-dim)]">{k.direction === "down" ? "낮을수록 좋음" : "높을수록 좋음"}</span>
                  {k.source === "revenue_auto" && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--primary)]/10 text-[var(--primary)]">매출 자동</span>}
                </div>
                <span className={`text-sm font-bold mono-number ${pct == null ? "text-[var(--text-dim)]" : pct >= 100 ? "text-[var(--primary)]" : pct < 40 ? "text-[var(--danger)]" : "text-[var(--text)]"}`}>{pct == null ? "—" : `${pct}%`}</span>
              </div>
              <div className="goal-hero-kpi-gauge-track">
                <div className={`goal-hero-kpi-gauge-fill ${gaugeColor}`} style={{ width: `${Math.min(100, pct || 0)}%` }} />
              </div>
              <div className="goal-hero-kpi-card-footer">
                <span>실적 <b className="text-[var(--text-muted)] mono-number">{fmtNum(actual, k.unit)}</b></span>
                <span>목표 <b className="text-[var(--text-muted)] mono-number">{Number(k.target_value) > 0 ? fmtNum(Number(k.target_value), k.unit) : "—"}</b></span>
              </div>
            </div>
          );
        })}
      </div>

      {hasAuto && (
        <p className="goal-hero-auto-note">※ ‘매출 자동’ KPI는 <b className="text-[var(--text-muted)]">매출 세금계산서(공급가액, 무효 제외)</b>를 자동 집계합니다.</p>
      )}
      </div>

      {/* 우 1/3 — 종합 요약 위젯(달성률·신호등·KPI 수) */}
      <div className="goal-hero-summary">
        <div className="goal-hero-summary-achievement glass-card">
          <div className="text-[11px] text-[var(--text-muted)]">종합 달성률 <span className="text-[var(--text-dim)]">(KPI 평균)</span></div>
          <div className={`text-base font-bold mono-number mt-0.5 ${overallPct == null ? "text-[var(--text-dim)]" : overallPct >= 100 ? "text-[var(--primary)]" : overallPct < 40 ? "text-[var(--danger)]" : "text-[var(--text)]"}`}>
            {overallPct == null ? "—" : `${overallPct}%`}
          </div>
        </div>
        <div className="goal-hero-summary-status glass-card">
          <div className="text-[11px] text-[var(--text-muted)]">종합 상태 <span className="text-[var(--text-dim)]">(최신 체크인)</span></div>
          <div className={`text-base font-bold mt-0.5 flex items-center gap-1.5 ${sm.text}`}>
            <span className={`inline-block w-2.5 h-2.5 rounded-full ${sm.dot}`} />
            {sm.label}
          </div>
        </div>
        <div className="goal-hero-summary-count glass-card">
          <div className="text-[11px] text-[var(--text-muted)]">KPI 수</div>
          <div className="text-base font-bold mono-number mt-0.5 text-[var(--text)]">{(kpis as Kpi[]).length}개</div>
        </div>
      </div>
    </div>
  );
}
