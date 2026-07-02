"use client";

// 프로젝트(라이프사이클·손익 뷰) — 워크플로우(/projects 보드)와 같은 deals 데이터의 다른 렌즈.
//   2026-06-17 핸드오프 v2: 신규 테이블 없이 기존 deals 재사용. 목록 → 상세(탭) 구조.
//   목록 컬럼: 프로젝트명·거래처·담당자·단계·계약금액·진행률·기간. (직접원가·원가율은 손익 단계에서 추가)

import { useMemo, useState } from "react";
import { DateField } from "@/components/date-field";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";
import { useToast } from "@/components/toast";
import { AccessDenied } from "@/components/access-denied";
import { getDeals, getCompanyUsers } from "@/lib/queries";
import { getPartners } from "@/lib/partners";
import { STAGE_LABEL, STAGE_COLOR, STAGE_ORDER, type ProjectStage } from "@/lib/project-rules";
import { PROJECT_TYPES, PROJECT_TYPE_ORDER, normalizeProjectType, getHeroMetric, getOverallAchievement, type ProjectType, type KpiSource } from "@/lib/project-types";
import { useCanAccessTab } from "@/lib/tab-access";
import { PerformanceDashboard } from "./_components/PerformanceDashboard";

const won = (n: number | null | undefined) => `${Math.round(Number(n || 0)).toLocaleString("ko-KR")}원`;
const fmtDate = (d: string | null | undefined) => (d ? String(d).slice(0, 10) : "");

export default function ProjectHubPage() {
  const { user, role } = useUser();
  const companyId = user?.company_id ?? null;
  const isManager = role === "owner" || role === "admin";
  const router = useRouter();
  const { allowed: tabAllowed, loading: tabLoading } = useCanAccessTab("/projecthub");
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [showDashboard, setShowDashboard] = useState(true); // 성과 대시보드 — 목표형 탭 선택 시 기본 열림(토글 가능)
  const [editDeal, setEditDeal] = useState<any | null>(null);
  const [delDeal, setDelDeal] = useState<any | null>(null);

  const { data: deals = [], isLoading } = useQuery({
    queryKey: ["projecthub-deals", companyId],
    queryFn: () => getDeals(companyId!),
    enabled: !!companyId,
  });
  const { data: partners = [] } = useQuery({
    queryKey: ["projecthub-partners", companyId],
    queryFn: () => getPartners(companyId!),
    enabled: !!companyId,
  });
  const { data: users = [] } = useQuery({
    queryKey: ["projecthub-users", companyId],
    queryFn: () => getCompanyUsers(companyId!),
    enabled: !!companyId,
  });

  // 세부 프로젝트(캠페인)는 목록에서 숨기고 상위 프로젝트만 노출. 자식 수는 배지로 표시.
  const topDeals = useMemo(() => (deals as any[]).filter((d) => !d.parent_deal_id), [deals]);
  const childCount = useMemo(() => {
    const m: Record<string, number> = {};
    for (const d of deals as any[]) if (d.parent_deal_id) m[d.parent_deal_id] = (m[d.parent_deal_id] || 0) + 1;
    return m;
  }, [deals]);

  // 손익 — v_deal_pnl (직접원가·직접원가율). 전표 deal_id 태그 전엔 0.
  const { data: pnl = [] } = useQuery({
    queryKey: ["projecthub-pnl", companyId],
    queryFn: async () => {
      const { data } = await (supabase as any).from("v_deal_pnl").select("deal_id, revenue, direct_cost, direct_cost_ratio, margin");
      return (data || []) as any[];
    },
    enabled: !!companyId,
  });
  const pnlByDeal = useMemo(() => {
    const m: Record<string, any> = {};
    for (const p of pnl as any[]) m[p.deal_id] = p;
    return m;
  }, [pnl]);

  // 유형별 실적 — 목표형(자동/수동), 실행형(태스크). 핵심지표 정규화·요약·위험 판정에 사용.
  const goalDealIds = useMemo(() => topDeals.filter((d) => normalizeProjectType(d.project_type) === "goal").map((d) => d.id), [topDeals]);
  const deliveryDealIds = useMemo(() => topDeals.filter((d) => normalizeProjectType(d.project_type) === "delivery").map((d) => d.id), [topDeals]);

  // 목표형 KPI 정의 (다중 KPI 성과관리 모델)
  const { data: goalKpis = [] } = useQuery({
    queryKey: ["projecthub-goal-kpis", companyId, goalDealIds.length],
    queryFn: async () => {
      if (goalDealIds.length === 0) return [];
      const { data } = await (supabase as any).from("project_kpis").select("id, deal_id, target_value, direction, source").in("deal_id", goalDealIds);
      return (data || []) as any[];
    },
    enabled: !!companyId && goalDealIds.length > 0,
  });
  // 목표형 수동 KPI 실적(kpi_id 별 합)
  const { data: goalEntries = [] } = useQuery({
    queryKey: ["projecthub-goal-entries", companyId, goalDealIds.length],
    queryFn: async () => {
      if (goalDealIds.length === 0) return [];
      const { data } = await (supabase as any).from("project_kpi_entries").select("kpi_id, value").in("deal_id", goalDealIds);
      return (data || []) as any[];
    },
    enabled: !!companyId && goalDealIds.length > 0,
  });
  // 목표형 자동 실적(v_deal_kpi_auto — 매출/이익/건수)
  const { data: goalAutos = [] } = useQuery({
    queryKey: ["projecthub-goal-autos", companyId, goalDealIds.length],
    queryFn: async () => {
      if (goalDealIds.length === 0) return [];
      const { data } = await (supabase as any).from("v_deal_kpi_auto").select("deal_id, revenue_actual, profit_actual, output_count").in("deal_id", goalDealIds);
      return (data || []) as any[];
    },
    enabled: !!companyId && goalDealIds.length > 0,
  });
  // 실행형 태스크(진행률·지연)
  const { data: tasksRows = [] } = useQuery({
    queryKey: ["projecthub-tasks", companyId, deliveryDealIds.length],
    queryFn: async () => {
      if (deliveryDealIds.length === 0) return [];
      const { data } = await (supabase as any).from("project_tasks").select("deal_id, status, due_date").in("deal_id", deliveryDealIds).is("archived_at", null);
      return (data || []) as any[];
    },
    enabled: !!companyId && deliveryDealIds.length > 0,
  });

  const todayStr = new Date().toISOString().slice(0, 10);
  // 목표형 종합 달성률(0~1) — 평균(KPI 달성률). KPI별 실적: manual=entries 합, revenue_auto=v_deal_revenue_actual.
  const goalOverallByDeal = useMemo(() => {
    // kpi_id → 수동 실적 합
    const manualByKpi: Record<string, number> = {};
    for (const e of goalEntries as any[]) manualByKpi[e.kpi_id] = (manualByKpi[e.kpi_id] || 0) + Number(e.value || 0);
    // deal_id → 자동 실적(매출/이익/건수)
    const autoByDeal: Record<string, { revenue: number; profit: number; count: number }> = {};
    for (const r of goalAutos as any[]) autoByDeal[r.deal_id] = { revenue: Number(r.revenue_actual || 0), profit: Number(r.profit_actual || 0), count: Number(r.output_count || 0) };
    const autoVal = (dealId: string, source: string) => {
      const a = autoByDeal[dealId] || { revenue: 0, profit: 0, count: 0 };
      return source === "profit_auto" ? a.profit : source === "count_auto" ? a.count : a.revenue;
    };
    // deal_id → KPI 목록
    const kpisByDeal: Record<string, any[]> = {};
    for (const k of goalKpis as any[]) (kpisByDeal[k.deal_id] ||= []).push(k);
    const m: Record<string, number | null> = {};
    for (const d of topDeals) {
      if (normalizeProjectType(d.project_type) !== "goal") continue;
      const ks = kpisByDeal[d.id] || [];
      m[d.id] = getOverallAchievement(ks.map((k) => ({
        target: Number(k.target_value || 0),
        actual: k.source === "manual" ? (manualByKpi[k.id] || 0) : autoVal(d.id, k.source),
        direction: (k.direction === "down" ? "down" : "up") as "up" | "down",
      })));
    }
    return m;
  }, [goalKpis, goalEntries, goalAutos, topDeals]);
  // 실행형 태스크 집계
  const taskStatsByDeal = useMemo(() => {
    const m: Record<string, { total: number; done: number; delayed: number }> = {};
    for (const t of tasksRows as any[]) {
      const e = (m[t.deal_id] ||= { total: 0, done: 0, delayed: 0 });
      e.total += 1;
      if (t.status === "done") e.done += 1;
      else if (t.due_date && String(t.due_date).slice(0, 10) < todayStr) e.delayed += 1;
    }
    return m;
  }, [tasksRows, todayStr]);

  // 핵심지표(0~100 정규화) — 행 유형별 마진률/달성률/진행률 + 위험 판정
  const heroByDeal = useMemo(() => {
    const m: Record<string, ReturnType<typeof getHeroMetric> & { delayed?: boolean }> = {};
    for (const d of topDeals) {
      const type = normalizeProjectType(d.project_type);
      if (type === "goal") {
        // 종합 달성률(0~1) → HeroMetric. KPI 없으면 raw=null('—').
        const ov = goalOverallByDeal[d.id];
        if (ov == null) {
          m[d.id] = { pct: 0, raw: null, risk: false, label: "—" };
        } else {
          const p = Math.round(ov * 100);
          m[d.id] = { pct: Math.min(100, p), raw: ov, risk: false, label: `${p}%` };
        }
      } else if (type === "delivery") {
        const st = taskStatsByDeal[d.id];
        const h = getHeroMetric("delivery", { taskTotal: st?.total || 0, taskDone: st?.done || 0 });
        m[d.id] = { ...h, delayed: (st?.delayed || 0) > 0, risk: (st?.delayed || 0) > 0 };
      } else {
        const p = pnlByDeal[d.id];
        const revenue = Number(d.contract_total || 0) || Number(p?.revenue || 0);
        m[d.id] = getHeroMetric("margin", { revenue, cost: Number(p?.direct_cost || 0) });
      }
    }
    return m;
  }, [topDeals, goalOverallByDeal, taskStatsByDeal, pnlByDeal]);

  // 유형 탭 — 수익형/목표형/실행형 리스트 분리 (각 유형 전용 컬럼). 기본 수익형.
  const [typeFilter, setTypeFilter] = useState<ProjectType>("margin");

  const partnerName = useMemo(() => {
    const m: Record<string, string> = {};
    for (const p of partners as any[]) m[p.id] = p.name;
    return m;
  }, [partners]);
  const userName = useMemo(() => {
    const m: Record<string, string> = {};
    for (const u of users as any[]) m[u.id] = u.name;
    return m;
  }, [users]);
  // 제목줄 클릭 정렬
  type PSortKey = "name" | "partner" | "manager" | "stage" | "contract" | "direct_cost" | "cost_ratio" | "progress" | "period";
  const [sortKey, setSortKey] = useState<PSortKey>("contract");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const toggleSort = (k: PSortKey) => {
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir(["contract", "direct_cost", "cost_ratio", "progress"].includes(k) ? "desc" : "asc"); }
  };
  const sortableTh = (k: PSortKey, label: string, cls: string) => (
    <th className={`${cls} cursor-pointer select-none hover:text-[var(--text)] transition`} onClick={() => toggleSort(k)} title="클릭하여 정렬">
      <span className={`inline-flex items-center gap-1 ${cls.includes("text-right") ? "justify-end w-full" : cls.includes("text-center") ? "justify-center w-full" : ""}`}>
        {label}
        <span className={`text-[9px] ${sortKey === k ? "text-[var(--primary)]" : "text-[var(--text-dim)]/40"}`}>{sortKey === k ? (sortDir === "asc" ? "▲" : "▼") : "↕"}</span>
      </span>
    </th>
  );
  // 위험 판정 — 마진<0 · 달성 정체(0%) · 기한초과 · 태스크 지연
  const isRisk = (d: any) => {
    const type = normalizeProjectType(d.project_type);
    const h = heroByDeal[d.id];
    const overdue = d.end_date && String(d.end_date).slice(0, 10) < todayStr && d.stage !== "completed" && d.stage !== "settlement";
    if (type === "delivery") return !!h?.delayed || !!overdue;
    // 목표형 위험 — 종합 달성률 정체(거의 0%)이거나 기한 초과. KPI(raw) 있어야 판정.
    if (type === "goal") return (h?.raw != null && h.raw < 0.0001) || !!overdue;
    return !!h?.risk || !!overdue;
  };

  const rows = useMemo(() => {
    const filtered = topDeals.filter((d) => normalizeProjectType(d.project_type) === typeFilter);
    return filtered.slice().sort((a, b) => {
      // 위험 항목 최상단 고정
      const ra = isRisk(a) ? 1 : 0, rb = isRisk(b) ? 1 : 0;
      if (ra !== rb) return rb - ra;
      let c = 0;
      switch (sortKey) {
        case "name": c = (a.name || "").localeCompare(b.name || "", "ko"); break;
        case "partner": c = (partnerName[a.partner_id] || "").localeCompare(partnerName[b.partner_id] || "", "ko"); break;
        case "manager": c = (userName[a.internal_manager_id] || "").localeCompare(userName[b.internal_manager_id] || "", "ko"); break;
        case "stage": c = STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage); break;
        case "direct_cost": c = Number(pnlByDeal[a.id]?.direct_cost || 0) - Number(pnlByDeal[b.id]?.direct_cost || 0); break;
        case "cost_ratio": c = Number(pnlByDeal[a.id]?.direct_cost_ratio || 0) - Number(pnlByDeal[b.id]?.direct_cost_ratio || 0); break;
        case "progress": c = (heroByDeal[a.id]?.pct ?? -1) - (heroByDeal[b.id]?.pct ?? -1); break;
        case "period": c = (a.start_date || "").localeCompare(b.start_date || ""); break;
        default: c = Number(a.contract_total || 0) - Number(b.contract_total || 0);
      }
      if (c === 0) c = Number(a.contract_total || 0) - Number(b.contract_total || 0);
      return sortDir === "asc" ? c : -c;
    });
  }, [topDeals, typeFilter, sortKey, sortDir, partnerName, userName, pnlByDeal, heroByDeal]);

  // 유형별 요약 구획
  const typeSummary = useMemo(() => {
    const marginDeals = topDeals.filter((d) => normalizeProjectType(d.project_type) === "margin");
    const goalDeals = topDeals.filter((d) => normalizeProjectType(d.project_type) === "goal");
    const deliveryDeals = topDeals.filter((d) => normalizeProjectType(d.project_type) === "delivery");
    const marginSum = marginDeals.reduce((s, d) => {
      const p = pnlByDeal[d.id]; const rev = Number(d.contract_total || 0) || Number(p?.revenue || 0);
      return s + (rev - Number(p?.direct_cost || 0));
    }, 0);
    const goalRates = goalDeals.map((d) => heroByDeal[d.id]?.raw).filter((r): r is number => r != null);
    const avgGoal = goalRates.length ? Math.round((goalRates.reduce((s, r) => s + r, 0) / goalRates.length) * 100) : null;
    const delRates = deliveryDeals.map((d) => heroByDeal[d.id]?.raw).filter((r): r is number => r != null);
    const avgDelivery = delRates.length ? Math.round((delRates.reduce((s, r) => s + r, 0) / delRates.length) * 100) : null;
    return {
      margin: { count: marginDeals.length, marginSum },
      goal: { count: goalDeals.length, avgGoal },
      delivery: { count: deliveryDeals.length, avgDelivery },
    };
  }, [topDeals, pnlByDeal, heroByDeal]);

  const summary = useMemo(() => {
    const total = rows.length;
    const inProgress = rows.filter((d) => d.stage === "in_progress").length;
    const totalContract = rows.reduce((s, d) => s + Number(d.contract_total || 0), 0);
    // VAT포함 합계 = Σ(공급가 + round(공급가×0.1)) — 행별 반올림 합산이라 목록 합계와 일치
    const totalContractWithVat = rows.reduce((s, d) => { const sup = Number(d.contract_total || 0); return s + sup + Math.round(sup * 0.1); }, 0);
    const ratios = rows.map((d) => pnlByDeal[d.id]?.direct_cost_ratio).filter((r) => r != null && Number(r) > 0).map(Number);
    const avgRatio = ratios.length ? ratios.reduce((s, r) => s + r, 0) / ratios.length : null;
    return { total, inProgress, totalContract, totalContractWithVat, avgRatio };
  }, [rows, pnlByDeal]);

  if (tabLoading) return null;
  if (!tabAllowed) return <AccessDenied detail="프로젝트 접근 권한이 없습니다. 관리자/대표에게 권한을 요청하세요." />;

  return (
    <div className="space-y-4">
      <div className="page-sticky-header flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-[var(--text)]">프로젝트</h1>
          <p className="text-xs text-[var(--text-dim)] mt-1">견적 → 계약 → 진행 → 손익까지 프로젝트별 라이프사이클·수익성을 관리합니다</p>
        </div>
        <div className="flex items-center gap-2">
          {isManager && typeFilter === "goal" && (
            <button onClick={() => setShowDashboard((v) => !v)} className={`px-4 py-2 text-xs font-semibold rounded-lg border transition ${showDashboard ? "bg-[var(--primary)] text-white border-[var(--primary)]" : "border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg-surface)]"}`}>
              🎯 성과 대시보드
            </button>
          )}
          <button onClick={() => setShowCreate(true)} className="px-4 py-2 text-xs font-semibold rounded-lg bg-[var(--primary)] text-white hover:opacity-90">
            + 프로젝트 생성
          </button>
        </div>
      </div>

      {/* 유형 선택 — 먼저 유형을 고르면 아래 대시보드·요약·목록이 그 유형 기준으로 표시 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {PROJECT_TYPE_ORDER.map((t) => {
          const c = PROJECT_TYPES[t];
          const active = typeFilter === t;
          return (
            <button key={t} onClick={() => setTypeFilter(t)}
              className={`glass-card px-4 py-3 text-left transition ${active ? "ring-2 ring-[var(--primary)] !border-[var(--primary)]" : "opacity-75 hover:opacity-100 hover:bg-[var(--bg-surface)]/60"}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-semibold text-[var(--text-muted)]">{c.icon} {c.label} <span className="font-normal text-[var(--text-dim)]">{typeSummary[t].count}건</span></div>
                {active && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--primary)]/10 text-[var(--primary)] font-semibold whitespace-nowrap">보는 중</span>}
              </div>
              <div className="text-lg font-bold mono-number mt-0.5 text-[var(--text)]">
                {t === "margin" ? (
                  <span title="마진(매출−직접원가) 합계">마진합 {won(typeSummary.margin.marginSum)}</span>
                ) : t === "goal" ? (
                  <>평균 달성률 {typeSummary.goal.avgGoal == null ? <span className="text-[var(--text-dim)]">—</span> : `${typeSummary.goal.avgGoal}%`}</>
                ) : (
                  <>평균 진행률 {typeSummary.delivery.avgDelivery == null ? <span className="text-[var(--text-dim)]">—</span> : `${typeSummary.delivery.avgDelivery}%`}</>
                )}
              </div>
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-[var(--text-dim)] -mt-1">{PROJECT_TYPES[typeFilter].desc}</p>

      {/* 성과 대시보드 — 목표형(KPI·체크인) 전용 집계라 목표형 탭에서만 표시 */}
      {showDashboard && typeFilter === "goal" && companyId && (
        <PerformanceDashboard companyId={companyId} onClose={() => setShowDashboard(false)} />
      )}

      {showCreate && companyId && (
        <ProjectFormModal
          companyId={companyId}
          partners={partners as any[]}
          users={users as any[]}
          onClose={() => setShowCreate(false)}
          onSaved={(id) => { setShowCreate(false); qc.invalidateQueries({ queryKey: ["projecthub-deals"] }); if (id) router.push(`/projecthub/${id}`); }}
        />
      )}

      {editDeal && companyId && (
        <ProjectFormModal
          companyId={companyId}
          partners={partners as any[]}
          users={users as any[]}
          editDeal={editDeal}
          onClose={() => setEditDeal(null)}
          onSaved={() => {
            setEditDeal(null);
            qc.invalidateQueries({ queryKey: ["projecthub-deals"] });
            qc.invalidateQueries({ queryKey: ["deals"] });
            qc.invalidateQueries({ queryKey: ["projects-deals"] });
          }}
        />
      )}

      {delDeal && (
        <DeleteProjectModal
          deal={delDeal}
          companyId={companyId}
          onClose={() => setDelDeal(null)}
          onDeleted={() => {
            setDelDeal(null);
            qc.invalidateQueries({ queryKey: ["projecthub-deals"] });
            qc.invalidateQueries({ queryKey: ["deals"] });
            qc.invalidateQueries({ queryKey: ["projects-deals"] });
          }}
        />
      )}

      {/* 요약 카드 — 활성 유형 기준 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="glass-card px-4 py-3">
          <div className="text-xs text-[var(--text-muted)]">{PROJECT_TYPES[typeFilter].icon} {PROJECT_TYPES[typeFilter].label} 프로젝트</div>
          <div className="text-2xl font-bold mono-number mt-0.5 text-[var(--text)]">{summary.total}</div>
        </div>
        <div className="glass-card px-4 py-3">
          <div className="text-xs text-[var(--text-muted)]">진행중</div>
          <div className="text-2xl font-bold mono-number mt-0.5 text-amber-500">{summary.inProgress}</div>
        </div>
        {typeFilter === "margin" ? (<>
          <div className="glass-card px-4 py-3">
            <div className="text-xs text-[var(--text-muted)]">총 계약금액 <span className="text-[10px] text-[var(--text-dim)]">(VAT별도)</span></div>
            <div className="text-xl font-bold mono-number mt-0.5 text-[var(--text)]">{won(summary.totalContract)}</div>
            <div className="text-[10px] text-[var(--text-dim)] mt-0.5">VAT포함 {won(summary.totalContractWithVat)}</div>
          </div>
          <div className="glass-card px-4 py-3">
            <div className="text-xs text-[var(--text-muted)]">평균 직접원가율</div>
            <div className="text-xl font-bold mono-number mt-0.5 text-[var(--text)]" title="전표에 프로젝트를 태그한 직접원가 기준 (판관비 제외)">
              {summary.avgRatio == null ? <span className="text-[var(--text-dim)]">—</span> : `${Math.round(summary.avgRatio * 100)}%`}
            </div>
          </div>
        </>) : (<>
          <div className="glass-card px-4 py-3">
            <div className="text-xs text-[var(--text-muted)]">{typeFilter === "goal" ? "평균 달성률" : "평균 진행률"}</div>
            <div className="text-xl font-bold mono-number mt-0.5 text-[var(--text)]">
              {(() => { const v = typeFilter === "goal" ? typeSummary.goal.avgGoal : typeSummary.delivery.avgDelivery; return v == null ? <span className="text-[var(--text-dim)]">—</span> : `${v}%`; })()}
            </div>
          </div>
          <div className="glass-card px-4 py-3">
            <div className="text-xs text-[var(--text-muted)]">{typeFilter === "delivery" ? "지연·위험" : "위험"}</div>
            <div className="text-2xl font-bold mono-number mt-0.5 text-red-500">{rows.filter(isRisk).length}</div>
          </div>
        </>)}
      </div>

      {/* 목록 그리드 */}
      <div className="glass-card overflow-hidden">
        <div className="overflow-auto max-h-[640px]">
          <table className={`w-full text-xs border-collapse ${typeFilter === "margin" ? "min-w-[1100px]" : "min-w-[720px]"}`}>
            <thead className="sticky top-0 z-10">
              <tr className="bg-[var(--bg-surface)] text-[var(--text-muted)] border-b border-[var(--border)]">
                {sortableTh("name", "프로젝트명", "px-3 py-2 text-left font-semibold")}
                {typeFilter !== "delivery" && sortableTh("partner", "거래처", "px-3 py-2 text-left font-semibold border-l border-[var(--border)]/60")}
                {sortableTh("manager", "담당자", "px-3 py-2 text-left font-semibold border-l border-[var(--border)]/60 w-[100px]")}
                {sortableTh("progress", typeFilter === "margin" ? "마진률" : typeFilter === "goal" ? "달성률" : "진행률", "px-3 py-2 text-center font-semibold border-l border-[var(--border)]/60 w-[150px]")}
                {typeFilter === "delivery" && <th className="px-3 py-2 text-center font-semibold border-l border-[var(--border)]/60 w-[70px]">지연</th>}
                {sortableTh("stage", "단계", "px-3 py-2 text-center font-semibold border-l border-[var(--border)]/60 w-[80px]")}
                {typeFilter === "margin" && (<>
                  {sortableTh("contract", "계약금액(VAT별도)", "px-3 py-2 text-right font-semibold border-l border-[var(--border)]/60 w-[120px]")}
                  <th className="px-3 py-2 text-right font-semibold border-l border-[var(--border)]/60 w-[90px]">VAT(10%)</th>
                  <th className="px-3 py-2 text-right font-semibold border-l border-[var(--border)]/60 w-[120px]">합계(VAT포함)</th>
                  {sortableTh("direct_cost", "직접원가", "px-3 py-2 text-right font-semibold border-l border-[var(--border)]/60 w-[110px]")}
                  {sortableTh("cost_ratio", "원가율", "px-3 py-2 text-center font-semibold border-l border-[var(--border)]/60 w-[70px]")}
                </>)}
                {sortableTh("period", "기간", "px-3 py-2 text-left font-semibold border-l border-[var(--border)]/60 w-[150px]")}
                <th className="px-3 py-2 text-center font-semibold border-l border-[var(--border)]/60 w-[110px]">관리</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={typeFilter === "margin" ? 12 : 7} className="p-10 text-center text-[var(--text-muted)]">불러오는 중...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={typeFilter === "margin" ? 12 : 7} className="p-10 text-center text-[var(--text-muted)]">{PROJECT_TYPES[typeFilter].label} 프로젝트가 없습니다. ‘+ 프로젝트 생성’으로 추가하세요.</td></tr>
              ) : rows.map((d) => {
                const stage = (STAGE_ORDER.includes(d.stage) ? d.stage : "estimate") as ProjectStage;
                const sc = STAGE_COLOR[stage];
                const p = pnlByDeal[d.id];
                const ratio = p?.direct_cost_ratio != null ? Number(p.direct_cost_ratio) : null;
                const ptype = normalizeProjectType(d.project_type);
                const hero = heroByDeal[d.id];
                const risk = isRisk(d);
                return (
                  <tr key={d.id} onClick={() => router.push(`/projecthub/${d.id}`)}
                    className={`border-b border-[var(--border)]/40 hover:bg-[var(--bg-surface)]/50 cursor-pointer ${risk ? "bg-red-500/[0.04]" : ""}`}>
                    <td className="px-3 py-2 text-[var(--text)] font-medium">
                      {risk && <span className="mr-1 text-red-500" title="위험 — 확인 필요">●</span>}
                      {d.name || "(이름 없음)"}
                      {childCount[d.id] > 0 && (
                        <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--primary)]/10 text-[var(--primary)] font-semibold align-middle" title={`세부 프로젝트 ${childCount[d.id]}개`}>
                          캠페인 {childCount[d.id]}
                        </span>
                      )}
                    </td>
                    {typeFilter !== "delivery" && <td className="px-3 py-2 text-[var(--text-muted)] border-l border-[var(--border)]/30 truncate">{partnerName[d.partner_id] || "—"}</td>}
                    <td className="px-3 py-2 text-[var(--text-muted)] border-l border-[var(--border)]/30 truncate">{userName[d.internal_manager_id] || "—"}</td>
                    {/* 핵심지표 — 유형별 마진률/달성률/진행률 0~100% 막대(위험=빨강) */}
                    <td className="px-3 py-2 border-l border-[var(--border)]/30">
                      {!hero || hero.raw == null ? <span className="text-[var(--text-dim)] text-[11px]">—</span> : (
                        <div className="flex items-center gap-1.5" title={`${PROJECT_TYPES[ptype].hero} ${hero.label}`}>
                          <div className="flex-1 h-1.5 rounded-full bg-[var(--bg-surface)] overflow-hidden">
                            <div className={`h-full rounded-full ${risk ? "bg-red-500" : hero.pct >= 70 ? "bg-green-500" : "bg-[var(--primary)]"}`} style={{ width: `${hero.pct}%` }} />
                          </div>
                          <span className={`text-[10px] mono-number w-9 text-right ${risk ? "text-red-500 font-semibold" : "text-[var(--text-muted)]"}`}>{hero.label}</span>
                        </div>
                      )}
                    </td>
                    {typeFilter === "delivery" && (
                      <td className="px-3 py-2 text-center border-l border-[var(--border)]/30">
                        {hero?.delayed ? <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold bg-red-500/10 text-red-500">지연</span> : <span className="text-[var(--text-dim)]">—</span>}
                      </td>
                    )}
                    <td className="px-3 py-2 text-center border-l border-[var(--border)]/30">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${sc.bg} ${sc.text}`}>{STAGE_LABEL[stage]}</span>
                    </td>
                    {typeFilter === "margin" && (() => {
                      const sup = Number(d.contract_total || 0);
                      const vat = Math.round(sup * 0.1);
                      const dash = <span className="text-[var(--text-dim)]">—</span>;
                      return (<>
                        <td className="px-3 py-2 text-right mono-number text-[var(--text)] border-l border-[var(--border)]/30">{sup > 0 ? won(sup) : dash}</td>
                        <td className="px-3 py-2 text-right mono-number text-[var(--text-muted)] border-l border-[var(--border)]/30">{sup > 0 ? won(vat) : dash}</td>
                        <td className="px-3 py-2 text-right mono-number font-bold text-[var(--text)] border-l border-[var(--border)]/30">{sup > 0 ? won(sup + vat) : dash}</td>
                        <td className="px-3 py-2 text-right mono-number border-l border-[var(--border)]/30 text-[var(--text-muted)]">{p && Number(p.direct_cost) > 0 ? won(p.direct_cost) : dash}</td>
                        <td className="px-3 py-2 text-center mono-number border-l border-[var(--border)]/30">
                          {ratio == null || ratio === 0 ? <span className="text-[var(--text-dim)] text-[11px]">—</span> : (
                            <span className={ratio >= 1 ? "text-red-500 font-semibold" : ratio >= 0.8 ? "text-amber-500" : "text-[var(--text)]"}>{Math.round(ratio * 100)}%</span>
                          )}
                        </td>
                      </>);
                    })()}
                    <td className="px-3 py-2 text-[var(--text-muted)] mono-number border-l border-[var(--border)]/30 text-[11px]">
                      {fmtDate(d.start_date) || "—"}{d.end_date ? ` ~ ${fmtDate(d.end_date)}` : ""}
                    </td>
                    <td className="px-3 py-2 text-center border-l border-[var(--border)]/30 whitespace-nowrap">
                      <button onClick={(e) => { e.stopPropagation(); setEditDeal(d); }}
                        className="px-2 py-1 text-[11px] font-semibold rounded-md text-[var(--primary)] bg-[var(--primary)]/10 hover:bg-[var(--primary)]/20 transition">수정</button>
                      <button onClick={(e) => { e.stopPropagation(); setDelDeal(d); }}
                        className="ml-1 px-2 py-1 text-[11px] font-semibold rounded-md text-red-400 bg-red-500/10 hover:bg-red-500/20 transition">삭제</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] text-[var(--text-dim)]">※ 진행 단계·실적·비용은 프로젝트 상세의 ‘개요’ 탭에서, 활동·일정은 ‘프로젝트 운영’ 탭에서 확인합니다.</p>
    </div>
  );
}

// 프로젝트 생성 모달 — deals 직접 insert (워크플로우 보드와 동일 데이터)
function ProjectFormModal({ companyId, partners, users, editDeal, onClose, onSaved }: {
  companyId: string; partners: any[]; users: any[]; editDeal?: any; onClose: () => void; onSaved: (id?: string) => void;
}) {
  const { toast } = useToast();
  const db = supabase as any;
  const isEdit = !!editDeal;
  const [saving, setSaving] = useState(false);
  // 생성 흐름: 1단계 유형 선택 → 2단계 입력. 수정은 기존 유형 유지(유형은 수정 불가, 입력만).
  const editType: ProjectType = normalizeProjectType(editDeal?.project_type);
  const [step, setStep] = useState<1 | 2>(isEdit ? 2 : 1);
  const [projectType, setProjectType] = useState<ProjectType>(editType);
  const [form, setForm] = useState(() => editDeal ? {
    name: editDeal.name || "", partner_id: editDeal.partner_id || "", manager_id: editDeal.internal_manager_id || "",
    start_date: (editDeal.start_date || "").slice(0, 10), end_date: (editDeal.end_date || "").slice(0, 10),
    classification: editDeal.classification || "B2B",
    contract_total: editDeal.contract_total ? Number(editDeal.contract_total).toLocaleString("ko-KR") : "",
    vatType: "exclude" as "exclude" | "include", // 저장값은 이미 공급가액 → VAT별도로 표시(그대로 저장 시 값 유지)
  } : {
    name: "", partner_id: "", manager_id: "", start_date: "", end_date: "",
    classification: "B2B", contract_total: "", vatType: "exclude" as "exclude" | "include",
  });
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const comma = (s: string) => { const n = Number(String(s).replace(/[^0-9]/g, "")); return n ? n.toLocaleString("ko-KR") : ""; };

  // 거래처 검색 픽커 — 네이티브 select(620개) 대신 검색 입력 + 스타일 드롭다운 (SubDealsTab 동일 패턴)
  const [ptSearch, setPtSearch] = useState(() => (editDeal?.partner_id ? ((partners as any[]).find((p) => p.id === editDeal.partner_id)?.name || "") : ""));
  const [ptOpen, setPtOpen] = useState(false);
  const ptMatches = useMemo(() => {
    const t = ptSearch.trim().toLowerCase();
    if (!t) return (partners as any[]).slice(0, 30);
    const tn = t.replace(/-/g, "");
    return (partners as any[]).filter((p) => (p.name || "").toLowerCase().includes(t) || (p.business_number || "").replace(/-/g, "").includes(tn)).slice(0, 200);
  }, [partners, ptSearch]);

  // 목표형 — 생성 시 정의할 KPI 목록(1개 이상). 수정은 '성과' 탭에서 관리하므로 여기선 생성에만 사용.
  type KpiDraft = { label: string; target: string; unit: string; direction: "up" | "down"; source: KpiSource };
  const [kpiDrafts, setKpiDrafts] = useState<KpiDraft[]>([{ label: "매출", target: "", unit: "원", direction: "up", source: "revenue_auto" }]);
  const setKpi = (i: number, patch: Partial<KpiDraft>) => setKpiDrafts((arr) => arr.map((k, idx) => (idx === i ? { ...k, ...patch } : k)));
  const addKpi = () => setKpiDrafts((arr) => [...arr, { label: "", target: "", unit: "원", direction: "up", source: "manual" }]);
  const removeKpiDraft = (i: number) => setKpiDrafts((arr) => (arr.length > 1 ? arr.filter((_, idx) => idx !== i) : arr));

  const submit = async () => {
    if (!form.name.trim()) { toast("프로젝트명을 입력하세요", "error"); return; }
    const raw = Number(String(form.contract_total).replace(/[^0-9]/g, ""));
    // 목표형(신규 생성) — KPI 1개 이상 유효성 검사
    let validKpis: { label: string; target_value: number; unit: string; direction: "up" | "down"; source: KpiSource }[] = [];
    if (projectType === "goal" && !isEdit) {
      validKpis = kpiDrafts
        .map((k) => ({ label: k.label.trim(), target_value: Number(String(k.target).replace(/[^0-9.-]/g, "")) || 0, unit: k.unit.trim() || "원", direction: k.direction, source: k.source }))
        .filter((k) => k.label && k.target_value > 0);
      if (validKpis.length === 0) { toast("KPI를 1개 이상 입력하세요 (이름·목표값 필수)", "error"); return; }
    }
    setSaving(true);
    try {
      const contractAmount = form.vatType === "include" ? Math.round(raw / 1.1) : raw;
      // 공통 척추 — 유형 무관 항목
      const base: any = {
        name: form.name.trim(),
        start_date: form.start_date || null, end_date: form.end_date || null,
        internal_manager_id: form.manager_id || null,
      };
      // 유형별 분기 payload
      let payload: any;
      if (projectType === "goal") {
        payload = {
          ...base,
          project_type: "goal",
          partner_id: form.partner_id || null,
          // KPI 는 별도 테이블(project_kpis)에 저장. deals 의 단일목표 컬럼은 미사용.
        };
      } else if (projectType === "delivery") {
        payload = {
          ...base,
          project_type: "delivery",
          partner_id: form.partner_id || null,
          // (선택) 예산은 contract_total 재사용
          contract_total: contractAmount || 0,
        };
      } else {
        // margin — 현행 100% 보존
        payload = {
          ...base,
          project_type: "margin",
          classification: form.classification,
          contract_total: contractAmount || 0,
          partner_id: form.partner_id || null,
        };
      }
      if (isEdit) {
        // 단계(stage)·상태(status)·project_type 은 건드리지 않음(유형 변경 불가) — 기본 정보만 수정
        delete payload.project_type;
        const { error } = await db.from("deals").update(payload).eq("id", editDeal.id);
        if (error) throw new Error(error.message);
        toast("프로젝트가 수정되었습니다", "success");
        onSaved();
      } else {
        const { data, error } = await db.from("deals").insert({
          company_id: companyId, status: "active", stage: "estimate", ...payload,
        }).select("id").single();
        if (error) throw new Error(error.message);
        // 목표형 — 정의한 KPI 들을 project_kpis 에 삽입
        if (projectType === "goal" && data?.id && validKpis.length > 0) {
          const rows = validKpis.map((k, i) => ({ company_id: companyId, deal_id: data.id, label: k.label, target_value: k.target_value, unit: k.unit, direction: k.direction, source: k.source, sort_order: i }));
          const { error: kErr } = await db.from("project_kpis").insert(rows);
          if (kErr) throw new Error(kErr.message);
        }
        toast("프로젝트가 생성되었습니다", "success");
        onSaved(data?.id);
      }
    } catch (e: any) { toast(e?.message || (isEdit ? "수정 실패" : "생성 실패"), "error"); } finally { setSaving(false); }
  };

  const IN = "w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm text-[var(--text)]";
  const LB = "block text-xs text-[var(--text-muted)] mb-1";
  const cfg = PROJECT_TYPES[projectType];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
          <div className="text-sm font-bold text-[var(--text)]">
            {isEdit ? "프로젝트 수정" : step === 1 ? "+ 프로젝트 생성 · 유형 선택" : `+ ${cfg.icon} ${cfg.label} 프로젝트`}
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text)] text-xl leading-none">✕</button>
        </div>

        {/* 1단계 — 유형 선택 (생성 시에만) */}
        {!isEdit && step === 1 && (
          <div className="p-5 space-y-3">
            <p className="text-xs text-[var(--text-muted)]">프로젝트 유형을 선택하세요. 유형에 따라 히어로 지표와 탭이 달라집니다.</p>
            <div className="grid grid-cols-1 gap-2.5">
              {PROJECT_TYPE_ORDER.map((t) => {
                const c = PROJECT_TYPES[t];
                const active = projectType === t;
                return (
                  <button key={t} onClick={() => setProjectType(t)}
                    className={`text-left px-4 py-3 rounded-xl border transition ${active ? "border-[var(--primary)] bg-[var(--primary)]/5 ring-1 ring-[var(--primary)]/30" : "border-[var(--border)] hover:bg-[var(--bg-surface)]"}`}>
                    <div className="flex items-center gap-2">
                      <span className="text-xl">{c.icon}</span>
                      <span className="text-sm font-bold text-[var(--text)]">{c.label}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--bg-surface)] text-[var(--text-dim)]">히어로: {c.hero}</span>
                    </div>
                    <p className="text-[11px] text-[var(--text-dim)] mt-1 leading-relaxed">{c.desc}</p>
                  </button>
                );
              })}
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={onClose} className="px-3 py-1.5 text-xs text-[var(--text-muted)]">취소</button>
              <button onClick={() => setStep(2)} className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-[var(--primary)] text-white hover:opacity-90">다음 →</button>
            </div>
          </div>
        )}

        {/* 2단계 — 유형별 입력 */}
        {(isEdit || step === 2) && (
          <>
            <div className="p-5 space-y-3">
              {!isEdit && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-[var(--text-dim)]">유형:</span>
                  <span className="font-semibold text-[var(--text)]">{cfg.icon} {cfg.label}</span>
                  <button onClick={() => setStep(1)} className="text-[var(--primary)] hover:underline">변경</button>
                </div>
              )}
              <div>
                <label className={LB}>프로젝트명 *</label>
                <input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="프로젝트명" className={IN} autoFocus />
              </div>
              <div className="grid grid-cols-2 gap-3">
                {/* 거래처 — 실행형(내부 태스크)은 숨김, 목표형은 선택 */}
                {projectType !== "delivery" && (
                  <div className="relative">
                    <label className={LB}>거래처 {projectType === "goal" && <span className="font-normal text-[var(--text-dim)]">(선택)</span>}</label>
                    <input
                      value={ptSearch}
                      onChange={(e) => { setPtSearch(e.target.value); setPtOpen(true); if (form.partner_id) set({ partner_id: "" }); }}
                      onFocus={() => setPtOpen(true)}
                      onBlur={() => setTimeout(() => setPtOpen(false), 150)}
                      placeholder="거래처명·사업자번호 검색"
                      className={IN}
                    />
                    {ptOpen && (
                      <div className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto bg-[var(--bg-card)] border border-[var(--border)] rounded-lg shadow-lg">
                        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { set({ partner_id: "" }); setPtSearch(""); setPtOpen(false); }}
                          className={`block w-full text-left px-3 py-2 text-sm hover:bg-[var(--bg-surface)] ${!form.partner_id ? "text-[var(--primary)] font-semibold" : "text-[var(--text-muted)]"}`}>
                          미지정
                        </button>
                        {ptMatches.length === 0 ? (
                          <div className="px-3 py-2 text-xs text-[var(--text-dim)]">검색 결과 없음</div>
                        ) : ptMatches.map((p: any) => (
                          <button key={p.id} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { set({ partner_id: p.id }); setPtSearch(p.name); setPtOpen(false); }}
                            className={`block w-full text-left px-3 py-2 text-sm hover:bg-[var(--bg-surface)] ${form.partner_id === p.id ? "text-[var(--primary)] font-semibold" : "text-[var(--text)]"}`}>
                            {p.name}{p.business_number ? <span className="text-[11px] text-[var(--text-dim)] ml-1.5">{p.business_number}</span> : null}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <div className={projectType === "delivery" ? "col-span-2" : ""}>
                  <label className={LB}>담당자</label>
                  <select value={form.manager_id} onChange={(e) => set({ manager_id: e.target.value })} className={IN}>
                    <option value="">미지정</option>
                    {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                </div>
              </div>

              {/* 수익형(margin) — 분류 + 계약금액 (현행) */}
              {projectType === "margin" && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={LB}>분류</label>
                    <select value={form.classification} onChange={(e) => set({ classification: e.target.value })} className={IN}>
                      <option value="B2B">B2B</option><option value="B2C">B2C</option><option value="B2G">B2G</option>
                    </select>
                  </div>
                  <div>
                    <label className={LB}>계약금액</label>
                    <div className="flex gap-1">
                      <input value={form.contract_total} onChange={(e) => set({ contract_total: comma(e.target.value) })} inputMode="numeric" placeholder="0" className={`${IN} text-right mono-number`} />
                      <select value={form.vatType} onChange={(e) => set({ vatType: e.target.value as "exclude" | "include" })} className="px-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-[11px] text-[var(--text-muted)]">
                        <option value="exclude">VAT별도</option><option value="include">VAT포함</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {/* 목표형(goal) — 다중 KPI 정의 (생성 시). 수정은 '성과' 탭에서 관리. */}
              {projectType === "goal" && !isEdit && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className={`${LB} mb-0`}>KPI <span className="font-normal text-[var(--text-dim)]">(1개 이상 — 이름·목표값 필수)</span></label>
                    <button type="button" onClick={addKpi} className="text-[11px] font-semibold text-[var(--primary)] hover:underline">+ KPI 추가</button>
                  </div>
                  {kpiDrafts.map((k, i) => (
                    <div key={i} className="rounded-xl border border-[var(--border)] p-2.5 space-y-2 bg-[var(--bg-surface)]/40">
                      <div className="flex items-center gap-2">
                        <input value={k.label} onChange={(e) => setKpi(i, { label: e.target.value })} placeholder="KPI 이름 (예: 신규 매출)" className={`${IN} flex-1`} />
                        {kpiDrafts.length > 1 && <button type="button" onClick={() => removeKpiDraft(i)} className="px-2 py-1 text-[11px] rounded-md text-[var(--danger)] hover:bg-[var(--danger)]/10" aria-label="KPI 삭제">✕</button>}
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <input value={k.target} onChange={(e) => setKpi(i, { target: comma(e.target.value) })} inputMode="numeric" placeholder="목표값" className={`${IN} text-right mono-number`} />
                        <input value={k.unit} onChange={(e) => setKpi(i, { unit: e.target.value })} placeholder="단위(원)" className={IN} />
                        <select value={k.direction} onChange={(e) => setKpi(i, { direction: e.target.value as "up" | "down" })} className={IN}>
                          <option value="up">↑ 높을수록</option>
                          <option value="down">↓ 낮을수록</option>
                        </select>
                        <select value={k.source} onChange={(e) => setKpi(i, { source: e.target.value as KpiSource })} className={IN}>
                          <option value="manual">수동</option>
                          <option value="revenue_auto">매출자동</option>
                          <option value="profit_auto">이익자동</option>
                          <option value="count_auto">건수자동</option>
                        </select>
                      </div>
                    </div>
                  ))}
                  <p className="text-[11px] text-[var(--text-dim)]">‘매출자동’ KPI는 매출 세금계산서(공급가액)를 자동 집계합니다. 생성 후 ‘성과’ 탭에서 KPI·실적·체크인을 관리합니다.</p>
                </div>
              )}
              {projectType === "goal" && isEdit && (
                <p className="text-[11px] text-[var(--text-dim)]">KPI·실적·성과 체크인은 프로젝트 상세의 <b className="text-[var(--text-muted)]">‘성과’</b> 탭에서 관리합니다.</p>
              )}

              {/* 실행형(delivery) — (선택) 예산 */}
              {projectType === "delivery" && (
                <div>
                  <label className={LB}>예산 <span className="font-normal text-[var(--text-dim)]">(선택)</span></label>
                  <div className="flex gap-1">
                    <input value={form.contract_total} onChange={(e) => set({ contract_total: comma(e.target.value) })} inputMode="numeric" placeholder="0" className={`${IN} text-right mono-number`} />
                    <select value={form.vatType} onChange={(e) => set({ vatType: e.target.value as "exclude" | "include" })} className="px-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-[11px] text-[var(--text-muted)]">
                      <option value="exclude">VAT별도</option><option value="include">VAT포함</option>
                    </select>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={LB}>시작일</label>
                  <DateField value={form.start_date} onChange={(e) => set({ start_date: e.target.value })} className={`${IN} mono-number`} />
                </div>
                <div>
                  <label className={LB}>종료일</label>
                  <DateField value={form.end_date} min={form.start_date || undefined} onChange={(e) => set({ end_date: e.target.value })} className={`${IN} mono-number`} />
                </div>
              </div>
            </div>
            <div className="px-5 py-3 border-t border-[var(--border)] flex justify-between gap-2">
              {!isEdit ? (
                <button onClick={() => setStep(1)} className="px-3 py-1.5 text-xs text-[var(--text-muted)]">← 이전</button>
              ) : <span />}
              <div className="flex gap-2">
                <button onClick={onClose} className="px-3 py-1.5 text-xs text-[var(--text-muted)]">취소</button>
                <button onClick={submit} disabled={saving || !form.name.trim()} className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-[var(--primary)] text-white hover:opacity-90 disabled:opacity-50">
                  {saving ? "저장 중..." : isEdit ? "저장" : "생성"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// 프로젝트 삭제 모달 — 이름 입력 확인 게이트 + 소프트 삭제(archived_at). 보드 삭제와 동일 정책.
function DeleteProjectModal({ deal, companyId, onClose, onDeleted }: {
  deal: any; companyId: string | null; onClose: () => void; onDeleted: () => void;
}) {
  const { toast } = useToast();
  const db = supabase as any;
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const target = (deal.name || "").trim();
  const canDelete = typed.trim() === target && target.length > 0;

  const del = async () => {
    if (!canDelete || busy) return;
    setBusy(true);
    try {
      // 소프트 삭제 — archived_at 만 갱신. getDeals() 는 archived_at IS NULL 만 조회하므로 즉시 사라짐.
      const { error } = await db.from("deals").update({ archived_at: new Date().toISOString() }).eq("id", deal.id);
      if (error) throw new Error(error.message);
      // 감사 로그 (실패해도 비차단) — 보드 삭제와 동일 컬럼 구조
      try {
        await db.from("audit_logs").insert({
          company_id: companyId, entity_type: "deal", entity_id: deal.id, action: "delete",
          before_json: { archived_at: null, name: deal.name },
          after_json: { archived_at: new Date().toISOString() },
          metadata: { soft_delete: true, deal_name: deal.name },
        });
      } catch { /* audit 실패 무시 */ }
      toast("프로젝트가 삭제되었습니다", "success");
      onDeleted();
    } catch (e: any) { toast(e?.message || "삭제 실패", "error"); } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-[2px] p-4" onClick={() => !busy && onClose()}>
      <div className="bg-[var(--bg-card)] border border-red-500/30 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
          <div className="text-sm font-bold text-red-400">프로젝트 삭제</div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text)] text-xl leading-none">✕</button>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-xs text-[var(--text-muted)] leading-relaxed">
            <span className="font-bold text-[var(--text)]">{deal.name || "(이름 없음)"}</span> 프로젝트를 삭제하면 목록·보드 어디에서도 보이지 않습니다. (회계·자식 데이터는 보존되며, 복구 가능)
          </p>
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">확인을 위해 프로젝트명을 입력하세요</label>
            <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={target}
              className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm text-[var(--text)]" autoFocus />
          </div>
        </div>
        <div className="px-5 py-3 border-t border-[var(--border)] flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-[var(--text-muted)]">취소</button>
          <button onClick={del} disabled={!canDelete || busy} className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-red-500 text-white hover:opacity-90 disabled:opacity-40">
            {busy ? "삭제 중..." : "삭제"}
          </button>
        </div>
      </div>
    </div>
  );
}
