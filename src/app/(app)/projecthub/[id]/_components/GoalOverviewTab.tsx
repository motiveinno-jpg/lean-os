"use client";
import { todayKst } from "@/lib/kst";
import { logRead } from "@/lib/log-read";

// 목표형 '개요' = 성과 콕핏 (그래프 대시보드). project_type==='goal' overview 에서만 렌더.
//   히어로(종합 달성률 도넛+상태+예상착지+기간) / ① KPI 스코어카드 / ② 추세 / ③ 분해 / ④ 체크인.
//   데이터: project_kpis·v_deal_kpi_auto·project_kpi_entries·project_updates·tax_invoices(태깅 매출) — 신규 0.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { getKpiAchievement, getOverallAchievement, getOverallStatus, getPaceWarning, KPI_SOURCE_LABEL, type KpiSource } from "@/lib/project-types";
import { bucketSeries, periodProgress } from "@/lib/goal-metrics";
import { RadialGauge, ProgressBar, BarList, BarLineCombo, StatusTimeline, statusColor, DANGER, AMBER } from "@/components/charts";

const db = supabase;
const won = (n: number) => Math.round(Number(n || 0)).toLocaleString("ko-KR");
const fmtNum = (n: number, unit: string) => `${won(n)}${unit || ""}`;

type Kpi = { id: string; label: string; unit: string; target_value: number; direction: "up" | "down"; source: KpiSource; sort_order: number };
type Entry = { id: string; kpi_id: string; entry_date: string; value: number; department_id?: string | null; created_by?: string | null };
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
  const [chartUnit, setChartUnit] = useState<"day" | "week" | "month">("day"); // 기간 단위 — 기본 일별
  const [breakdown, setBreakdown] = useState<"channel" | "campaign" | "manager">("channel");
  const [contribDim, setContribDim] = useState<"dept" | "member">("dept"); // 성과 기여 다각도(부서/개인)

  const { data: kpis = [] } = useQuery({
    queryKey: ["project-kpis", dealId],
    queryFn: async () => (await db.from("project_kpis").select("id, label, unit, target_value, direction, source, sort_order").eq("deal_id", dealId).order("sort_order", { ascending: true })).data || [],
    enabled: !!dealId,
  });
  const { data: entries = [] } = useQuery({
    queryKey: ["project-kpi-entries-all", dealId],
    queryFn: async () => (await db.from("project_kpi_entries").select("id, kpi_id, entry_date, value, department_id, created_by").eq("deal_id", dealId).order("entry_date", { ascending: true })).data || [],
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
      const data = logRead('_components/GoalOverviewTab:data', await db.from("v_deal_kpi_auto").select("revenue_actual, profit_actual, output_count").eq("deal_id", dealId).maybeSingle());
      return { revenue: Number(data?.revenue_actual || 0), profit: Number(data?.profit_actual || 0), count: Number(data?.output_count || 0) };
    },
    enabled: !!dealId && hasAuto,
  });
  const { data: updates = [] } = useQuery({
    queryKey: ["project-updates", dealId],
    queryFn: async () => (await db.from("project_updates").select("status, did, issues, next_plan, period_start, update_date, created_by").eq("deal_id", dealId).order("update_date", { ascending: true })).data || [],
    enabled: !!dealId,
  });
  const { data: openIssues = [] } = useQuery({
    queryKey: ["project-issues-open", dealId],
    queryFn: async () => (await db.from("project_issues").select("id, title, severity, status, due_date, assignee_id").eq("deal_id", dealId).neq("status", "resolved").order("created_at", { ascending: false })).data || [],
    enabled: !!dealId,
  });
  const { data: overdueTasks = [] } = useQuery({
    queryKey: ["goal-overview-overdue-tasks", dealId],
    queryFn: async () => logRead('_components/GoalOverviewTab:overdue', await db.from("project_tasks").select("id, title, due_date, status, assignee_id").eq("deal_id", dealId).is("archived_at", null).neq("status", "done").not("due_date", "is", null).lt("due_date", todayKst()).order("due_date", { ascending: true })) || [],
    enabled: !!dealId,
  });
  const { data: children = [] } = useQuery({
    queryKey: ["goal-overview-children", dealId],
    queryFn: async () => logRead('_components/GoalOverviewTab:children', await db.from("deals").select("id, name, internal_manager_id").eq("parent_deal_id", dealId).is("archived_at", null)) || [],
    enabled: !!dealId,
  });
  const dealIds = useMemo(() => [dealId, ...(children as any[]).map((c) => c.id)], [dealId, children]);
  const { data: invoices = [] } = useQuery({
    queryKey: ["goal-overview-invoices", companyId, dealIds.join(",")],
    queryFn: async () => logRead('_components/GoalOverviewTab:invoices', await db.from("tax_invoices").select("deal_id, partner_id, issue_date, supply_amount").in("deal_id", dealIds).eq("type", "sales").neq("status", "void")) || [],
    enabled: !!companyId && dealIds.length > 0,
  });
  const { data: partners = [] } = useQuery({
    queryKey: ["goal-overview-partners", companyId],
    queryFn: async () => logRead('_components/GoalOverviewTab:partners', await db.from("partners").select("id, name").eq("company_id", companyId)) || [],
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
  const prog = periodProgress(deal.start_date, deal.end_date);
  // KPI 행 — 달성률 + 페이스(이대로면 예상 %). 위험(낮은 달성)한 것을 위로 정렬.
  const rowsUnsorted = kpiList.map((k) => {
    const actual = actualOf(k);
    const ach = getKpiAchievement(Number(k.target_value || 0), actual, k.direction);
    const pct = ach == null ? null : Math.round(ach * 100);
    // 페이스: 기간·상향목표일 때만. 이대로면 예상 달성률 = 현재실적 ÷ 기간진행률.
    let projPct: number | null = null;
    if (prog && k.direction === "up" && Number(k.target_value) > 0 && prog.elapsed > 0) {
      const projected = actual * (prog.total / prog.elapsed);
      projPct = Math.round((projected / Number(k.target_value)) * 100);
    }
    return { k, actual, pct, projPct };
  });
  const rows = [...rowsUnsorted].sort((a, b) => (a.pct ?? 999) - (b.pct ?? 999));
  const overall = getOverallAchievement(kpiList.map((k) => ({ target: Number(k.target_value || 0), actual: actualOf(k), direction: k.direction })));
  const overallPct = overall == null ? null : Math.round(overall * 100);
  const latestUpdate = (updates as any[]).length ? (updates as any[])[(updates as any[]).length - 1] : null;
  const status = getOverallStatus(latestUpdate?.status);

  // 페이스(예상착지) — 가장 위험한 KPI 대표
  const worst = rows.filter((r) => r.pct != null).sort((a, b) => (a.pct! - b.pct!))[0];
  const worstPace = worst ? getPaceWarning({ targetAmount: Number(worst.k.target_value || 0), actualAmount: worst.actual, startDate: deal.start_date, endDate: deal.end_date }) : null;

  // ② 콤보 차트 — 선택 KPI(기본 첫 KPI)의 일자별 실적을 선택 단위(일/주/월)로 버킷팅.
  const selKpi = kpiList.find((k) => k.id === trendKpiId) || kpiList[0];
  const selHasSeries = !!selKpi && (selKpi.source === "manual" || selKpi.source === "revenue_auto");
  const chartBuckets = useMemo(() => {
    if (!selKpi || !selHasSeries) return null;
    let pts: { date: string; value: number }[] = [];
    if (selKpi.source === "manual") pts = (entries as Entry[]).filter((e) => e.kpi_id === selKpi.id).map((e) => ({ date: String(e.entry_date).slice(0, 10), value: Number(e.value || 0) }));
    else pts = (invoices as Inv[]).filter((i) => i.deal_id === dealId && i.issue_date).map((i) => ({ date: String(i.issue_date).slice(0, 10), value: Number(i.supply_amount || 0) }));
    return bucketSeries({ entries: pts, target: Number(selKpi.target_value || 0), startDate: deal.start_date, endDate: deal.end_date, unit: chartUnit });
  }, [selKpi, selHasSeries, entries, invoices, dealId, deal.start_date, deal.end_date, chartUnit]);
  const chartHasData = !!chartBuckets && chartBuckets.some((b) => (b.value || 0) > 0);

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

  // 성과 기여(다각도) — 선택 KPI(manual)의 entries 를 부서(department_id) 또는 개인(created_by) 으로 그룹.
  //   자동 KPI 는 부서/개인 데이터 없음(태그 매출은 위 '매출 분해'에서 담당자별 제공).
  const contribution = useMemo(() => {
    if (!selKpi || selKpi.source !== "manual") return null;
    const m: Record<string, number> = {};
    for (const e of entries as Entry[]) if (e.kpi_id === selKpi.id) {
      const k = (contribDim === "member" ? e.created_by : e.department_id) || "__none";
      m[k] = (m[k] || 0) + Number(e.value || 0);
    }
    return Object.entries(m).map(([id, v]) => ({ label: id === "__none" ? "(미지정)" : contribDim === "member" ? nameOf(id) : deptName(id), value: v }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selKpi, entries, departments, members, contribDim]);

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

  const issueCount = (openIssues as any[]).length;
  const overdueCount = (overdueTasks as any[]).length;

  return (
    <div className="goal-overview">
      {/* ① 상태 요약 밴드 — 종합 달성률 · 상태 · 예상 착지 · 기간 */}
      <div className="goal-band glass-card">
        <div className="goal-band-donut"><RadialGauge pct={overallPct} label="종합 달성률" size={104} /></div>
        <div className="goal-band-sep" />
        <div className="goal-band-col">
          <span className="goal-band-lbl">상태</span>
          <span className="goal-band-status" style={{ color: STATUS_META[status].dot }}>
            <span className="inline-block w-3 h-3 rounded-full" style={{ background: STATUS_META[status].dot }} />{STATUS_META[status].label}
          </span>
          {worst && <span className="text-[11px] text-[var(--text-muted)] truncate">{worst.k.label} 지표가 가장 뒤처짐</span>}
        </div>
        <div className="goal-band-sep" />
        <div className="goal-band-col">
          <span className="goal-band-lbl">예상 착지 (이대로라면)</span>
          {worstPace ? (
            <span className="goal-band-land" style={{ color: worstPace.tone === "danger" ? DANGER : worstPace.tone === "warn" ? AMBER : "var(--success)" }}>{worstPace.message}</span>
          ) : <span className="text-[12px] text-[var(--text-dim)]">기간을 설정하면 예상 착지가 표시됩니다</span>}
        </div>
        <div className="goal-band-sep" />
        <div className="goal-band-col">
          <span className="goal-band-lbl">기간</span>
          {prog ? (<>
            <span className="text-[18px] font-extrabold mono-number">{Math.max(0, prog.total - prog.elapsed)}<span className="text-[12px] font-semibold text-[var(--text-dim)]">일 남음</span></span>
            <ProgressBar pct={Math.round(prog.pct * 100)} color="var(--text-dim)" height={6} />
            <span className="text-[10.5px] text-[var(--text-dim)]">진행 {Math.round(prog.pct * 100)}% · 영업일 {prog.elapsed}/{prog.total}</span>
          </>) : <span className="text-[12px] text-[var(--text-dim)]">시작·종료일 미설정</span>}
        </div>
      </div>

      {/* ② 핵심 그래프 — 기간별 실적 vs 목표 (일/주/월 콤보) */}
      <section className="goal-overview-trend-card glass-card">
        <div className="goal-chart-head">
          <div>
            <h3 className="text-sm font-bold text-[var(--text)]">기간별 실적 vs 목표</h3>
            <span className="text-[11px] text-[var(--text-dim)]">막대가 목표선 위면 그 기간 목표 달성 · 아래면 미달</span>
          </div>
          <div className="goal-chart-ctrls">
            <div className="goal-unit-seg">
              {([["day", "일별"], ["week", "주별"], ["month", "월별"]] as const).map(([u, l]) => (
                <button key={u} onClick={() => setChartUnit(u)} className={chartUnit === u ? "on" : ""}>{l}</button>
              ))}
            </div>
            <select value={selKpi?.id || ""} onChange={(e) => setTrendKpiId(e.target.value)} className="px-2.5 py-1.5 text-xs rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text)]">
              {kpiList.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
            </select>
          </div>
        </div>
        {!selHasSeries ? (
          <div className="text-xs text-[var(--text-dim)] py-8 text-center">이 KPI는 기간별 시계열을 제공하지 않습니다(이익/건수 자동). 목표 대비 현재 달성률은 아래 KPI 현황을 참고하세요.</div>
        ) : !chartHasData ? (
          <div className="text-xs text-[var(--text-dim)] py-8 text-center">아직 기록된 실적이 없습니다. ‘성과’ 탭에서 실적을 입력하면 기간별로 표시됩니다.</div>
        ) : (
          <>
            <BarLineCombo buckets={chartBuckets!} unit={chartUnit} yUnit={selKpi?.unit || ""} />
            <div className="goal-chart-legend">
              <span className="k"><i className="sw" style={{ background: "var(--success)" }} />목표 달성 기간</span>
              <span className="k"><i className="sw" style={{ background: AMBER }} />목표 미달 기간</span>
              <span className="k"><i className="sw line" />기간 목표(페이스)</span>
              <span className="k"><i className="sw dashed" />남은 기간(목표)</span>
              {selKpi?.unit && <span className="text-[var(--text-dim)] ml-auto">단위: {selKpi.unit} / {chartUnit === "day" ? "일" : chartUnit === "week" ? "주" : "월"}</span>}
            </div>
          </>
        )}
      </section>

      {/* ③ KPI 현황 — 위험(낮은 달성) 우선, 페이스 표시 */}
      <section className="goal-overview-kpi-section">
        <div className="flex items-center gap-2 mb-2">
          <h3 className="text-sm font-bold text-[var(--text)]">KPI 현황</h3>
          <span className="text-[11px] text-[var(--text-dim)]">· 뒤처진 지표를 위로</span>
        </div>
        <div className="goal-overview-kpi-grid">
          {rows.map(({ k, actual, pct, projPct }) => (
            <div key={k.id} className="goal-overview-kpi-card glass-card">
              <div className="goal-overview-kpi-card-header">
                <span className="text-sm font-semibold text-[var(--text)] truncate">{k.label}</span>
                {k.source !== "manual" && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--primary)]/10 text-[var(--primary)] shrink-0">{KPI_SOURCE_LABEL[k.source]}</span>}
              </div>
              <div className="goal-overview-kpi-card-values">
                <div className="text-xs text-[var(--text-muted)]">
                  <span className="mono-number text-[var(--text)] font-bold text-sm">{fmtNum(actual, k.unit)}</span>
                  <span className="text-[var(--text-dim)]"> / {fmtNum(Number(k.target_value), k.unit)}</span>
                </div>
                <span className="text-lg font-extrabold mono-number" style={{ color: statusColor(pct) }}>{pct == null ? "—" : `${pct}%`}</span>
              </div>
              <ProgressBar pct={pct} />
              {projPct != null && (
                <span className="goal-kpi-pace" style={{ color: projPct >= 100 ? "var(--success)" : projPct >= 90 ? AMBER : DANGER }}>
                  {projPct >= 100 ? "▲" : "▼"} 이 페이스면 목표의 {projPct}% 예상
                </span>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ④ 상세 분석 — 이슈·지연 · 분해 · 기여 · 체크인 (접기, 요약 카운트는 항상 노출) */}
      <details className="goal-overview-details glass-card">
        <summary>
          <span className="flex items-center gap-2.5 flex-wrap">
            상세 분석
            <span className={`goal-detail-chip ${issueCount ? "danger" : ""}`}>열린 이슈 {issueCount}</span>
            <span className={`goal-detail-chip ${overdueCount ? "danger" : ""}`}>지연 과제 {overdueCount}</span>
            <span className="text-[11px] font-normal text-[var(--text-dim)]">· 분해 · 기여 · 체크인</span>
          </span>
          <span className="goal-detail-chev">▸</span>
        </summary>
        <div className="goal-detail-body">
          {/* 이슈 · 지연 */}
          <div className="goal-overview-alerts-grid">
            <section className="goal-overview-issues-card glass-card">
              <div className="goal-overview-issues-header">
                <h3 className="text-sm font-bold text-[var(--text)]">열린 이슈 <span className="font-normal text-[var(--text-dim)] text-xs">문제점·리스크</span></h3>
                <span className={`text-xs font-bold ${issueCount ? "text-[var(--danger)]" : "text-[var(--text-dim)]"}`}>{issueCount}건</span>
              </div>
              {issueCount === 0 ? (
                <div className="text-xs text-[var(--text-dim)]">열린 이슈가 없습니다. 👍</div>
              ) : (
                <div className="goal-overview-issues-list">
                  {(openIssues as any[]).slice(0, 6).map((i) => {
                    const sevColor = i.severity === "critical" ? DANGER : i.severity === "high" ? AMBER : i.severity === "medium" ? "var(--primary)" : "var(--text-dim)";
                    const overdue = i.due_date && i.due_date < todayKst();
                    return (
                      <div key={i.id} className="goal-overview-issue-row">
                        <span className="inline-block w-[7px] h-[7px] rounded-full shrink-0" style={{ background: sevColor }} />
                        <span className="flex-1 truncate text-[var(--text)]">{i.title}</span>
                        {i.due_date && <span className={`mono-number text-[10px] ${overdue ? "text-[var(--danger)] font-semibold" : "text-[var(--text-dim)]"}`}>{String(i.due_date).slice(5, 10)}{overdue ? "⚠" : ""}</span>}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
            <section className="goal-overview-tasks-card glass-card">
              <div className="goal-overview-tasks-header">
                <h3 className="text-sm font-bold text-[var(--text)]">지연 과제 <span className="font-normal text-[var(--text-dim)] text-xs">마감 초과</span></h3>
                <span className={`text-xs font-bold ${overdueCount ? "text-[var(--danger)]" : "text-[var(--text-dim)]"}`}>{overdueCount}건</span>
              </div>
              {overdueCount === 0 ? (
                <div className="text-xs text-[var(--text-dim)]">마감 지난 과제가 없습니다. 👍</div>
              ) : (
                <div className="goal-overview-tasks-list">
                  {(overdueTasks as any[]).slice(0, 6).map((t) => (
                    <div key={t.id} className="goal-overview-task-row">
                      <span className="inline-block w-[7px] h-[7px] rounded-full shrink-0 bg-[var(--danger)]" />
                      <span className="flex-1 truncate text-[var(--text)]">{t.title}</span>
                      <span className="mono-number text-[10px] text-[var(--danger)] font-semibold">{String(t.due_date).slice(5, 10)}⚠</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          {/* 분해 · 기여 · 체크인 */}
          <div className="goal-overview-analysis-grid">
            <section className="goal-overview-breakdown-card glass-card">
              <div className="goal-overview-breakdown-header">
                <h3 className="text-sm font-bold text-[var(--text)]">매출 분해</h3>
                <div className="seg-bar flex-wrap max-w-full">
                  {([["channel", "채널"], ["campaign", "세부"], ["manager", "담당자"]] as const).map(([k, l]) => (
                    <button key={k} onClick={() => setBreakdown(k)} className={`seg-item ${breakdown === k ? "seg-item-active" : ""}`}>{l}</button>
                  ))}
                </div>
              </div>
              <BarList items={breakdownItems} unit="원" emptyText="태깅된 매출이 없습니다. 세금계산서를 이 프로젝트에 태깅하면 자동 반영됩니다." />
            </section>

            {selKpi && selKpi.source === "manual" && (
              <section className="goal-overview-contribution-card glass-card">
                <div className="goal-overview-contribution-header">
                  <h3 className="text-sm font-bold text-[var(--text)]">성과 기여 <span className="font-normal text-[var(--text-dim)] text-xs">{selKpi.label}</span></h3>
                  <div className="seg-bar">
                    {([["dept", "부서"], ["member", "개인"]] as const).map(([k, l]) => (
                      <button key={k} onClick={() => setContribDim(k)} className={`seg-item ${contribDim === k ? "seg-item-active" : ""}`}>{l}</button>
                    ))}
                  </div>
                </div>
                <BarList items={contribution || []} unit={selKpi.unit} emptyText={contribDim === "member" ? "개인별 실적 입력이 없습니다. ‘성과’ 탭에서 실적을 입력하면 입력자별로 표시됩니다." : "부서별 실적 입력이 없습니다. ‘성과’ 탭 실적 입력에서 부서를 지정하면 표시됩니다."} />
              </section>
            )}

            <section className="goal-overview-checkin-card glass-card">
              <h3 className="text-sm font-bold text-[var(--text)] mb-3">성과 체크인 추이</h3>
              <StatusTimeline points={checkinPoints} />
              <div className="goal-checkin-legend">
                <span><i style={{ background: "var(--primary)" }} />정상</span>
                <span><i style={{ background: AMBER }} />주의</span>
                <span><i style={{ background: DANGER }} />위험</span>
              </div>
              {latestUpdate && (latestUpdate.did || latestUpdate.issues || latestUpdate.next_plan) && (
                <div className="goal-overview-checkin-note">
                  <div className="text-[10px] text-[var(--text-dim)]">최근 체크인 · {nameOf(latestUpdate.created_by)} · {String(latestUpdate.update_date || "").slice(0, 10)}</div>
                  {latestUpdate.did && <div>✅ {latestUpdate.did}</div>}
                  {latestUpdate.issues && <div className="text-amber-600">🚧 {latestUpdate.issues}</div>}
                  {latestUpdate.next_plan && <div>➡️ {latestUpdate.next_plan}</div>}
                </div>
              )}
            </section>
          </div>
        </div>
      </details>
    </div>
  );
}
