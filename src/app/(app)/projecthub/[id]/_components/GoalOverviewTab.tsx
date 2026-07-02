"use client";

// 목표형 '개요' = 성과 콕핏 (그래프 대시보드). project_type==='goal' overview 에서만 렌더.
//   히어로(종합 달성률 도넛+상태+예상착지+기간) / ① KPI 스코어카드 / ② 추세 / ③ 분해 / ④ 체크인.
//   데이터: project_kpis·v_deal_kpi_auto·project_kpi_entries·project_updates·tax_invoices(태깅 매출) — 신규 0.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { getKpiAchievement, getOverallAchievement, getOverallStatus, getPaceWarning, KPI_SOURCE_LABEL, type KpiSource } from "@/lib/project-types";
import { buildTrend, sparkPoints, periodProgress } from "@/lib/goal-metrics";
import { RadialGauge, ProgressBar, Sparkline, BarList, LineChart, StatusTimeline, statusColor, DANGER, AMBER } from "@/components/charts";

const db = supabase as any;
const won = (n: number) => Math.round(Number(n || 0)).toLocaleString("ko-KR");
const fmtNum = (n: number, unit: string) => `${won(n)}${unit || ""}`;

type Kpi = { id: string; label: string; unit: string; target_value: number; direction: "up" | "down"; source: KpiSource; sort_order: number };
type Entry = { id: string; kpi_id: string; entry_date: string; value: number; department_id?: string | null };
type Inv = { deal_id: string; partner_id: string | null; issue_date: string | null; supply_amount: number };

const STATUS_META: Record<string, { dot: string; label: string }> = {
  green: { dot: "var(--primary)", label: "정상(순항)" },
  yellow: { dot: AMBER, label: "주의" },
  red: { dot: DANGER, label: "위험" },
  neutral: { dot: "var(--text-dim)", label: "체크인 없음" },
};

export function GoalOverviewTab({ deal }: { deal: any }) {
  const dealId = deal.id as string;
  const companyId = deal.company_id as string;
  const [trendKpiId, setTrendKpiId] = useState<string>("");
  const [breakdown, setBreakdown] = useState<"channel" | "campaign" | "manager">("channel");

  const { data: kpis = [] } = useQuery({
    queryKey: ["project-kpis", dealId],
    queryFn: async () => (await db.from("project_kpis").select("id, label, unit, target_value, direction, source, sort_order").eq("deal_id", dealId).order("sort_order", { ascending: true })).data || [],
    enabled: !!dealId,
  });
  const { data: entries = [] } = useQuery({
    queryKey: ["project-kpi-entries-all", dealId],
    queryFn: async () => (await db.from("project_kpi_entries").select("id, kpi_id, entry_date, value, department_id").eq("deal_id", dealId).order("entry_date", { ascending: true })).data || [],
    enabled: !!dealId,
  });
  const { data: departments = [] } = useQuery({
    queryKey: ["departments", companyId],
    queryFn: async () => (await db.from("departments").select("id, name").eq("company_id", companyId).is("archived_at", null)).data || [],
    enabled: !!companyId,
  });
  const deptName = (id?: string | null) => (id ? (departments as any[]).find((d) => d.id === id)?.name || "(미지정)" : "(미지정)");
  const hasAuto = (kpis as Kpi[]).some((k) => k.source !== "manual");
  const { data: autoActual } = useQuery({
    queryKey: ["deal-kpi-auto", dealId],
    queryFn: async () => {
      const { data } = await db.from("v_deal_kpi_auto").select("revenue_actual, profit_actual, output_count").eq("deal_id", dealId).maybeSingle();
      return { revenue: Number(data?.revenue_actual || 0), profit: Number(data?.profit_actual || 0), count: Number(data?.output_count || 0) };
    },
    enabled: !!dealId && hasAuto,
  });
  const { data: updates = [] } = useQuery({
    queryKey: ["project-updates", dealId],
    queryFn: async () => (await db.from("project_updates").select("status, did, issues, next_plan, period_start, update_date, created_by").eq("deal_id", dealId).order("update_date", { ascending: true })).data || [],
    enabled: !!dealId,
  });
  const { data: children = [] } = useQuery({
    queryKey: ["goal-overview-children", dealId],
    queryFn: async () => (await db.from("deals").select("id, name, internal_manager_id").eq("parent_deal_id", dealId).is("archived_at", null)).data || [],
    enabled: !!dealId,
  });
  const dealIds = useMemo(() => [dealId, ...(children as any[]).map((c) => c.id)], [dealId, children]);
  const { data: invoices = [] } = useQuery({
    queryKey: ["goal-overview-invoices", companyId, dealIds.join(",")],
    queryFn: async () => (await db.from("tax_invoices").select("deal_id, partner_id, issue_date, supply_amount").in("deal_id", dealIds).eq("type", "sales").neq("status", "void")).data || [],
    enabled: !!companyId && dealIds.length > 0,
  });
  const { data: partners = [] } = useQuery({
    queryKey: ["goal-overview-partners", companyId],
    queryFn: async () => (await db.from("partners").select("id, name").eq("company_id", companyId)).data || [],
    enabled: !!companyId,
  });
  const { data: members = [] } = useQuery({
    queryKey: ["goal-overview-members", companyId],
    queryFn: async () => (await db.from("users").select("id, name, email").eq("company_id", companyId)).data || [],
    enabled: !!companyId,
  });
  const nameOf = (id?: string | null) => { const m = (members as any[]).find((x) => x.id === id); return m?.name || m?.email || "—"; };
  const partnerName = (id?: string | null) => (partners as any[]).find((p) => p.id === id)?.name || "미지정";

  // 실적 집계
  const entriesSumByKpi = useMemo(() => { const m: Record<string, number> = {}; for (const e of entries as Entry[]) m[e.kpi_id] = (m[e.kpi_id] || 0) + Number(e.value || 0); return m; }, [entries]);
  const actualOf = (k: Kpi) => k.source === "revenue_auto" ? Number(autoActual?.revenue || 0)
    : k.source === "profit_auto" ? Number(autoActual?.profit || 0)
    : k.source === "count_auto" ? Number(autoActual?.count || 0)
    : Number(entriesSumByKpi[k.id] || 0);

  const kpiList = kpis as Kpi[];
  const rows = kpiList.map((k) => {
    const actual = actualOf(k);
    const ach = getKpiAchievement(Number(k.target_value || 0), actual, k.direction);
    return { k, actual, pct: ach == null ? null : Math.round(ach * 100) };
  });
  const overall = getOverallAchievement(kpiList.map((k) => ({ target: Number(k.target_value || 0), actual: actualOf(k), direction: k.direction })));
  const overallPct = overall == null ? null : Math.round(overall * 100);
  const latestUpdate = (updates as any[]).length ? (updates as any[])[(updates as any[]).length - 1] : null;
  const status = getOverallStatus(latestUpdate?.status);

  // 페이스(예상착지) — 가장 위험한 KPI 대표
  const worst = rows.filter((r) => r.pct != null).sort((a, b) => (a.pct! - b.pct!))[0];
  const worstPace = worst ? getPaceWarning({ targetAmount: Number(worst.k.target_value || 0), actualAmount: worst.actual, startDate: deal.start_date, endDate: deal.end_date }) : null;
  const prog = periodProgress(deal.start_date, deal.end_date);

  // ② 추세 — 선택 KPI (기본: 첫 KPI)
  const selKpi = kpiList.find((k) => k.id === trendKpiId) || kpiList[0];
  const trend = useMemo(() => {
    if (!selKpi) return null;
    let pts: { date: string; value: number }[] = [];
    if (selKpi.source === "manual") pts = (entries as Entry[]).filter((e) => e.kpi_id === selKpi.id).map((e) => ({ date: String(e.entry_date).slice(0, 10), value: Number(e.value || 0) }));
    else if (selKpi.source === "revenue_auto") pts = (invoices as Inv[]).filter((i) => i.deal_id === dealId && i.issue_date).map((i) => ({ date: String(i.issue_date).slice(0, 10), value: Number(i.supply_amount || 0) }));
    return buildTrend({ entries: pts, target: Number(selKpi.target_value || 0), startDate: deal.start_date, endDate: deal.end_date });
  }, [selKpi, entries, invoices, dealId, deal.start_date, deal.end_date]);

  // 스파크라인 점 (KPI별)
  const sparkOf = (k: Kpi): number[] => {
    if (k.source === "manual") return sparkPoints((entries as Entry[]).filter((e) => e.kpi_id === k.id).map((e) => ({ date: String(e.entry_date).slice(0, 10), value: Number(e.value || 0) })), deal.start_date, deal.end_date);
    if (k.source === "revenue_auto") return sparkPoints((invoices as Inv[]).filter((i) => i.deal_id === dealId && i.issue_date).map((i) => ({ date: String(i.issue_date).slice(0, 10), value: Number(i.supply_amount || 0) })), deal.start_date, deal.end_date);
    return [];
  };

  // ③ 분해
  const breakdownItems = useMemo(() => {
    const inv = invoices as Inv[];
    if (breakdown === "channel") {
      const m: Record<string, number> = {};
      for (const i of inv) if (i.deal_id === dealId) m[i.partner_id || "__none"] = (m[i.partner_id || "__none"] || 0) + Number(i.supply_amount || 0);
      return Object.entries(m).map(([pid, v]) => ({ label: pid === "__none" ? "미지정" : partnerName(pid), value: v }));
    }
    if (breakdown === "campaign") {
      const m: Record<string, number> = {};
      for (const i of inv) m[i.deal_id] = (m[i.deal_id] || 0) + Number(i.supply_amount || 0);
      return Object.entries(m).map(([did, v]) => ({ label: did === dealId ? "본 프로젝트(직접)" : ((children as any[]).find((c) => c.id === did)?.name || "세부"), value: v }));
    }
    // manager — deal_id → 담당자
    const mgrOf = (did: string) => did === dealId ? deal.internal_manager_id : (children as any[]).find((c) => c.id === did)?.internal_manager_id;
    const m: Record<string, number> = {};
    for (const i of inv) { const uid = mgrOf(i.deal_id) || "__none"; m[uid] = (m[uid] || 0) + Number(i.supply_amount || 0); }
    return Object.entries(m).map(([uid, v]) => ({ label: uid === "__none" ? "미지정" : nameOf(uid), value: v }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoices, breakdown, dealId, children, partners, members]);

  // 부서별 기여 — 선택 KPI(manual)의 entries 를 department_id 로 그룹(단위 일관). 자동 KPI 는 부서 데이터 없음.
  const deptContribution = useMemo(() => {
    if (!selKpi || selKpi.source !== "manual") return null;
    const m: Record<string, number> = {};
    for (const e of entries as Entry[]) if (e.kpi_id === selKpi.id) { const k = e.department_id || "__none"; m[k] = (m[k] || 0) + Number(e.value || 0); }
    return Object.entries(m).map(([id, v]) => ({ label: id === "__none" ? "(미지정)" : deptName(id), value: v }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selKpi, entries, departments]);

  // ④ 체크인 타임라인
  const checkinPoints = (updates as any[]).map((u) => ({ label: String(u.period_start || u.update_date || "").slice(5, 10), status: u.status }));

  if (kpiList.length === 0) {
    return (
      <div className="glass-card p-10 text-center">
        <div className="text-4xl mb-3">📊</div>
        <div className="text-sm font-semibold text-[var(--text)]">아직 KPI가 없습니다</div>
        <div className="text-xs text-[var(--text-muted)] mt-1">‘성과’ 탭에서 KPI를 추가하면 목표·실적·달성률이 그래프로 표시됩니다.</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 히어로 */}
      <div className="glass-card p-5 flex flex-wrap items-center gap-6">
        <RadialGauge pct={overallPct} label="종합 달성률" />
        <div className="flex-1 min-w-[200px] space-y-2">
          <div className="flex items-center gap-2">
            <span style={{ width: 12, height: 12, borderRadius: 999, background: STATUS_META[status].dot, display: "inline-block" }} />
            <span className="text-sm font-bold text-[var(--text)]">{STATUS_META[status].label}</span>
          </div>
          {worstPace && (
            <div className="text-xs" style={{ color: worstPace.tone === "danger" ? DANGER : worstPace.tone === "warn" ? AMBER : "var(--text-muted)" }}>
              {worstPace.message}
            </div>
          )}
          {prog ? (
            <div>
              <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)] mb-1">
                <span>기간 진행 (영업일)</span>
                <span className="mono-number">{prog.elapsed} / {prog.total}일</span>
              </div>
              <ProgressBar pct={Math.round(prog.pct * 100)} color="var(--text-dim)" height={6} />
            </div>
          ) : <div className="text-[11px] text-[var(--text-dim)]">기간(시작·종료일)을 설정하면 페이스 분석이 표시됩니다.</div>}
        </div>
      </div>

      {/* ① KPI 스코어카드 */}
      <section>
        <h3 className="text-sm font-bold text-[var(--text)] mb-2">KPI 현황</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {rows.map(({ k, actual, pct }) => {
            const sp = sparkOf(k);
            return (
              <div key={k.id} className="glass-card p-4">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-sm font-semibold text-[var(--text)] truncate">{k.label}</span>
                  {k.source !== "manual" && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--primary)]/10 text-[var(--primary)] shrink-0">{KPI_SOURCE_LABEL[k.source]}</span>}
                </div>
                <div className="flex items-end justify-between gap-2 mb-1.5">
                  <div className="text-xs text-[var(--text-muted)]">
                    <span className="mono-number text-[var(--text)] font-bold text-sm">{fmtNum(actual, k.unit)}</span>
                    <span className="text-[var(--text-dim)]"> / {fmtNum(Number(k.target_value), k.unit)}</span>
                  </div>
                  <span className="text-sm font-extrabold mono-number" style={{ color: statusColor(pct) }}>{pct == null ? "—" : `${pct}%`}</span>
                </div>
                <ProgressBar pct={pct} />
                {sp.length > 1 && <div className="mt-2"><Sparkline points={sp} color={statusColor(pct)} width={200} height={26} /></div>}
              </div>
            );
          })}
        </div>
      </section>

      {/* ② 추세 */}
      <section className="glass-card p-4">
        <div className="flex items-center justify-between gap-2 mb-2">
          <h3 className="text-sm font-bold text-[var(--text)]">누적 실적 vs 목표 페이스</h3>
          <select value={selKpi?.id || ""} onChange={(e) => setTrendKpiId(e.target.value)} className="px-2.5 py-1 text-xs rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text)]">
            {kpiList.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
          </select>
        </div>
        {selKpi && (selKpi.source === "profit_auto" || selKpi.source === "count_auto") ? (
          <div className="text-xs text-[var(--text-dim)] py-6 text-center">이 KPI는 누적 시계열을 제공하지 않습니다(이익/건수 자동). 목표 대비 현재 달성률은 위 스코어카드를 참고하세요.</div>
        ) : trend ? (
          <LineChart
            series={[
              { color: "var(--primary)", points: trend.actual, label: "실제 누적" },
              { color: "var(--text-dim)", dash: true, points: trend.pace, label: "목표 페이스" },
            ]}
            markerX={trend.todayX}
            yUnit={selKpi?.unit}
          />
        ) : null}
      </section>

      {/* ③ 분해 */}
      <section className="glass-card p-4">
        <div className="flex items-center justify-between gap-2 mb-3">
          <h3 className="text-sm font-bold text-[var(--text)]">매출 분해</h3>
          <div className="seg-bar">
            {([["channel", "채널(거래처)"], ["campaign", "세부프로젝트"], ["manager", "담당자"]] as const).map(([k, l]) => (
              <button key={k} onClick={() => setBreakdown(k)} className={`seg-item ${breakdown === k ? "seg-item-active" : ""}`}>{l}</button>
            ))}
          </div>
        </div>
        <BarList items={breakdownItems} unit="원" emptyText="태깅된 매출이 없습니다. 세금계산서를 이 프로젝트에 태깅하면 자동 반영됩니다." />
      </section>

      {/* 부서별 기여 (수동 KPI) — 매출 분해(tax_invoices)와 별개 소스(entries) */}
      {selKpi && selKpi.source === "manual" && (
        <section className="glass-card p-4">
          <h3 className="text-sm font-bold text-[var(--text)] mb-1">부서별 기여 <span className="font-normal text-[var(--text-dim)] text-xs">{selKpi.label} · 수동 KPI 실적 입력 기준</span></h3>
          <BarList items={deptContribution || []} unit={selKpi.unit} emptyText="부서별 실적 입력이 없습니다. ‘성과’ 탭 실적 입력에서 부서를 지정하면 표시됩니다." />
        </section>
      )}

      {/* ④ 성과 체크인 추이 */}
      <section className="glass-card p-4">
        <h3 className="text-sm font-bold text-[var(--text)] mb-3">성과 체크인 추이</h3>
        <StatusTimeline points={checkinPoints} />
        {latestUpdate && (latestUpdate.did || latestUpdate.issues || latestUpdate.next_plan) && (
          <div className="mt-3 text-xs text-[var(--text-muted)] border-t border-[var(--border)] pt-2 space-y-0.5">
            <div className="text-[10px] text-[var(--text-dim)]">최근 체크인 · {nameOf(latestUpdate.created_by)} · {String(latestUpdate.update_date || "").slice(0, 10)}</div>
            {latestUpdate.did && <div>✅ {latestUpdate.did}</div>}
            {latestUpdate.issues && <div className="text-amber-600">🚧 {latestUpdate.issues}</div>}
            {latestUpdate.next_plan && <div>➡️ {latestUpdate.next_plan}</div>}
          </div>
        )}
      </section>
    </div>
  );
}
