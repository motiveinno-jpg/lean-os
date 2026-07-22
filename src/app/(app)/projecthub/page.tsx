"use client";
import { todayKst } from "@/lib/kst";
import { logRead } from "@/lib/log-read";

// 프로젝트(라이프사이클·손익 뷰) — 워크플로우(/projects 보드)와 같은 deals 데이터의 다른 렌즈.
//   2026-06-17 핸드오프 v2: 신규 테이블 없이 기존 deals 재사용. 목록 → 상세(탭) 구조.
//   목록 컬럼: 프로젝트명·거래처·담당자·단계·계약금액·진행률·기간. (직접원가·원가율은 손익 단계에서 추가)

import { useMemo, useState } from "react";
import { DateField } from "@/components/date-field";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
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
import { useModalKeys } from "@/hooks/use-modal-keys";

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
  // 콕핏(2026-07-22) — "지금 챙길 것" 렌즈 필터 + 카드 ⋯메뉴 열림 상태
  const [lens, setLens] = useState<null | "risk" | "due" | "progress" | "receivable">(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);

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
      const data = logRead('projecthub/page:data', await (supabase).from("v_deal_pnl").select("deal_id, revenue, direct_cost, direct_cost_ratio, margin"));
      return (data || []) as any[];
    },
    enabled: !!companyId,
  });
  const pnlByDeal = useMemo(() => {
    const m: Record<string, any> = {};
    for (const p of pnl as any[]) m[p.deal_id] = p;
    return m;
  }, [pnl]);

  // 회사 전체 미수금 롤업(Phase 3) — 프로젝트에 연결된 매출 계산서의 발행 vs 실입금(settled_amount, 통장 매칭).
  const { data: settleRows = [] } = useQuery({
    queryKey: ["projecthub-settle-rollup", companyId],
    queryFn: async () => {
      const data = logRead('projecthub/page:data', await (supabase).from("tax_invoices")
        .select("deal_id, total_amount, supply_amount, settled_amount, status")
        .eq("company_id", companyId!).eq("type", "sales").neq("status", "void").not("deal_id", "is", null));
      return (data || []) as any[];
    },
    enabled: !!companyId,
  });
  // 프로젝트별 미수금(발행 - 실입금) — 콕핏 미수 렌즈·카드 다음액션에서 재사용.
  const outstandingByDeal = useMemo(() => {
    const byDeal: Record<string, number> = {};
    for (const r of settleRows as any[]) {
      if (r.status === "draft") continue;
      const bal = Number(r.total_amount || r.supply_amount || 0) - Number(r.settled_amount || 0);
      byDeal[r.deal_id] = (byDeal[r.deal_id] || 0) + bal;
    }
    return byDeal;
  }, [settleRows]);
  const settleSummary = useMemo(() => {
    let totalOutstanding = 0, projects = 0;
    for (const k in outstandingByDeal) { if (outstandingByDeal[k] > 1) { totalOutstanding += outstandingByDeal[k]; projects++; } }
    return { totalOutstanding, projects };
  }, [outstandingByDeal]);

  // 유형별 실적 — 목표형(자동/수동), 실행형(태스크). 핵심지표 정규화·요약·위험 판정에 사용.
  const goalDealIds = useMemo(() => topDeals.filter((d) => normalizeProjectType(d.project_type) === "goal").map((d) => d.id), [topDeals]);
  const deliveryDealIds = useMemo(() => topDeals.filter((d) => normalizeProjectType(d.project_type) === "delivery").map((d) => d.id), [topDeals]);

  // 목표형 KPI 정의 (다중 KPI 성과관리 모델)
  const { data: goalKpis = [] } = useQuery({
    queryKey: ["projecthub-goal-kpis", companyId, goalDealIds.length],
    queryFn: async () => {
      if (goalDealIds.length === 0) return [];
      const data = logRead('projecthub/page:data', await (supabase).from("project_kpis").select("id, deal_id, target_value, direction, source").in("deal_id", goalDealIds));
      return (data || []) as any[];
    },
    enabled: !!companyId && goalDealIds.length > 0,
  });
  // 목표형 수동 KPI 실적(kpi_id 별 합)
  const { data: goalEntries = [] } = useQuery({
    queryKey: ["projecthub-goal-entries", companyId, goalDealIds.length],
    queryFn: async () => {
      if (goalDealIds.length === 0) return [];
      const data = logRead('projecthub/page:data', await (supabase).from("project_kpi_entries").select("kpi_id, value").in("deal_id", goalDealIds));
      return (data || []) as any[];
    },
    enabled: !!companyId && goalDealIds.length > 0,
  });
  // 목표형 자동 실적(v_deal_kpi_auto — 매출/이익/건수)
  const { data: goalAutos = [] } = useQuery({
    queryKey: ["projecthub-goal-autos", companyId, goalDealIds.length],
    queryFn: async () => {
      if (goalDealIds.length === 0) return [];
      const data = logRead('projecthub/page:data', await (supabase).from("v_deal_kpi_auto").select("deal_id, revenue_actual, profit_actual, output_count").in("deal_id", goalDealIds));
      return (data || []) as any[];
    },
    enabled: !!companyId && goalDealIds.length > 0,
  });
  // 실행형 태스크(진행률·지연)
  const { data: tasksRows = [] } = useQuery({
    queryKey: ["projecthub-tasks", companyId, deliveryDealIds.length],
    queryFn: async () => {
      if (deliveryDealIds.length === 0) return [];
      const data = logRead('projecthub/page:data', await (supabase).from("project_tasks").select("deal_id, status, due_date").in("deal_id", deliveryDealIds).is("archived_at", null));
      return (data || []) as any[];
    },
    enabled: !!companyId && deliveryDealIds.length > 0,
  });

  const todayStr = todayKst();
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

  // 유형 필터 — 전체(기본) + 수익형/목표형/실행형. 2026-07-13 개편: 전체 뷰 + 검색 + 내담당 + 카드형.
  const [typeFilter, setTypeFilter] = useState<"all" | ProjectType>("all");
  // 2026-07-20 QA: 전역 검색(⌘K)에서 프로젝트 결과 클릭 시 ?q=<이름> 딥링크로 진입 —
  //   검색어를 초기값으로 물려받고, 남의 담당 프로젝트도 보이도록 내담당 필터는 해제 상태로 시작.
  const searchParams = useSearchParams();
  const initialQ = searchParams?.get("q") ?? "";
  const [search, setSearch] = useState(initialQ);
  const [mineOnly, setMineOnly] = useState(!initialQ); // 내 담당 우선(기본) — '전체'로 전환 가능
  const userId = user?.id ?? null;

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
  // 제목줄 클릭 정렬 — 콕핏 기본값은 긴급도순(2026-07-22)
  type PSortKey = "urgency" | "name" | "partner" | "manager" | "stage" | "contract" | "direct_cost" | "cost_ratio" | "progress" | "period";
  const [sortKey, setSortKey] = useState<PSortKey>("urgency");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  // 카드 뷰 정렬 옵션 — 모든 유형 공통
  const SORT_OPTIONS: [PSortKey, string][] = [
    ["urgency", "긴급도"], ["contract", "계약금액"], ["progress", "진행·달성률"], ["stage", "단계"], ["name", "프로젝트명"], ["period", "시작일"],
  ];
  const isDone = (d: any) => d.stage === "completed" || d.stage === "settlement";
  // 마감까지 남은 일수(음수=초과). end_date 없으면 null.
  const daysToEnd = (d: any): number | null => {
    if (!d.end_date) return null;
    const end = new Date(`${String(d.end_date).slice(0, 10)}T00:00:00`);
    const now = new Date(`${todayStr}T00:00:00`);
    return Math.round((end.getTime() - now.getTime()) / 86_400_000);
  };
  // 이번 주 마감 — 진행 중이면서 마감이 0~7일 이내
  const isDueSoon = (d: any) => {
    if (isDone(d)) return false;
    const dd = daysToEnd(d);
    return dd != null && dd >= 0 && dd <= 7;
  };
  // 위험 판정(엄격, 2026-07-22) — 실제 적자·지연·기한초과만. 초기·미착수 상태는 위험 아님.
  //   · 수익형: 매출>0 이고 마진<0(getHeroMetric.risk 가 이미 revenue<=0 가드) 또는 기한초과
  //   · 실행형: 마감 지난 미완료 태스크 있음 또는 기한초과
  //   · 목표형: 기한초과만. (달성률 0% 자체는 위험 아님 — 이제 막 시작한 정상 프로젝트가 위로 몰리던 것 제거)
  const isRisk = (d: any) => {
    const type = normalizeProjectType(d.project_type);
    const h = heroByDeal[d.id];
    const overdue = d.end_date && String(d.end_date).slice(0, 10) < todayStr && !isDone(d);
    if (type === "delivery") return !!h?.delayed || !!overdue;
    if (type === "goal") return !!overdue;
    return !!h?.risk || !!overdue;
  };
  // 카드 "다음 액션" 줄 — 기존 데이터(마감일·단계·미수·지연태스크)만으로 구성.
  const nextAction = (d: any): { icon: string; text: string; dday: string; tone: "risk" | "soon" | "ok" } => {
    const dd = daysToEnd(d);
    const type = normalizeProjectType(d.project_type);
    const out = outstandingByDeal[d.id] || 0;
    if (isDone(d)) {
      if (out > 1) return { icon: "💵", text: "정산 대기 · 미수 있음", dday: won(out), tone: "soon" };
      return { icon: "✅", text: d.stage === "settlement" ? "정산 단계" : "완료", dday: "완료", tone: "ok" };
    }
    if (dd != null && dd < 0) return { icon: "⏰", text: "마감 기한 초과", dday: `D+${-dd}`, tone: "risk" };
    if (type === "delivery" && heroByDeal[d.id]?.delayed) return { icon: "💤", text: "지연된 태스크 있음", dday: "지연", tone: "risk" };
    if (dd != null && dd <= 7) return { icon: "⏰", text: "마감 임박", dday: `D-${dd}`, tone: "soon" };
    if (type === "margin" && out > 1) return { icon: "💵", text: "미수금 회수 필요", dday: won(out), tone: "soon" };
    if (dd != null) return { icon: "🗓", text: "다음 마감", dday: `D-${dd}`, tone: "ok" };
    return { icon: "🗓", text: "기간 미정", dday: "—", tone: "ok" };
  };

  // 렌즈 필터 판정 — 지금 챙길 것 칩 클릭 시 목록을 좁힌다.
  const matchesLens = (d: any) => {
    if (!lens) return true;
    if (lens === "risk") return isRisk(d);
    if (lens === "due") return isDueSoon(d);
    // "진행중" = 완료·정산 전(살아있는) 프로젝트. 단계값(in_progress)을 안 옮기고 작업하는
    //   실사용 패턴 대응 — 견적 단계라도 아직 안 끝났으면 진행중으로 본다(2026-07-22).
    if (lens === "progress") return !isDone(d);
    if (lens === "receivable") return (outstandingByDeal[d.id] || 0) > 1;
    return true;
  };
  // 긴급도 랭크(낮을수록 위) — 위험 → 이번주마감 → 미수 → 나머지 → 완료
  const urgencyRank = (d: any) => {
    if (isDone(d)) return 4;
    if (isRisk(d)) return 0;
    if (isDueSoon(d)) return 1;
    if ((outstandingByDeal[d.id] || 0) > 1) return 2;
    return 3;
  };

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = topDeals.filter((d) => {
      if (typeFilter !== "all" && normalizeProjectType(d.project_type) !== typeFilter) return false;
      if (mineOnly && d.internal_manager_id !== userId) return false;
      if (!matchesLens(d)) return false;
      if (q) {
        const hay = `${d.name || ""} ${partnerName[d.partner_id] || ""} ${userName[d.internal_manager_id] || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    return filtered.slice().sort((a, b) => {
      // 긴급도 정렬 — 랭크 오름차순 + 마감 임박 우선. 방향 토글과 무관하게 항상 급한 게 위로.
      if (sortKey === "urgency") {
        const ra = urgencyRank(a), rb = urgencyRank(b);
        if (ra !== rb) return ra - rb;
        const da = daysToEnd(a), db = daysToEnd(b);
        const va = da == null ? Infinity : da, vb = db == null ? Infinity : db;
        if (va !== vb) return va - vb;
        return Number(b.contract_total || 0) - Number(a.contract_total || 0);
      }
      // 그 외 정렬에서도 위험 항목 최상단 고정
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
  }, [topDeals, typeFilter, search, mineOnly, userId, sortKey, sortDir, lens, partnerName, userName, pnlByDeal, heroByDeal, outstandingByDeal]);

  // 렌즈 카운트 — 유형·내담당·검색 스코프(lens 제외)에서 집계. baseDeals 는 typeFilter 미반영이라 별도 구성.
  const lensScope = useMemo(() => rows.length === 0 || lens ? topDeals.filter((d) => {
    const q = search.trim().toLowerCase();
    if (typeFilter !== "all" && normalizeProjectType(d.project_type) !== typeFilter) return false;
    if (mineOnly && d.internal_manager_id !== userId) return false;
    if (q) {
      const hay = `${d.name || ""} ${partnerName[d.partner_id] || ""} ${userName[d.internal_manager_id] || ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }) : rows, [rows, lens, topDeals, typeFilter, mineOnly, userId, search, partnerName, userName]);
  const lensCounts = useMemo(() => {
    let receivableSum = 0, receivableCount = 0;
    for (const d of lensScope) {
      const o = outstandingByDeal[d.id] || 0;
      if (o > 1) { receivableSum += o; receivableCount++; }
    }
    return {
      risk: lensScope.filter(isRisk).length,
      due: lensScope.filter(isDueSoon).length,
      progress: lensScope.filter((d) => !isDone(d)).length,
      receivableSum, receivableCount,
    };
  }, [lensScope, outstandingByDeal]);

  // 2026-07-20 QA: 유형 칩 카운트가 내담당·검색 필터를 무시해 "전체 7"인데 KPI·목록은 0으로
  //   따로 놀던 혼란 — 칩도 동일한 기준(typeFilter 제외한 나머지 필터)을 따르게 한다.
  const baseDeals = useMemo(() => {
    const q = search.trim().toLowerCase();
    return topDeals.filter((d) => {
      if (mineOnly && d.internal_manager_id !== userId) return false;
      if (q) {
        const hay = `${d.name || ""} ${partnerName[d.partner_id] || ""} ${userName[d.internal_manager_id] || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [topDeals, mineOnly, userId, search, partnerName, userName]);

  // 유형별 요약 구획
  const typeSummary = useMemo(() => {
    const marginDeals = baseDeals.filter((d) => normalizeProjectType(d.project_type) === "margin");
    const goalDeals = baseDeals.filter((d) => normalizeProjectType(d.project_type) === "goal");
    const deliveryDeals = baseDeals.filter((d) => normalizeProjectType(d.project_type) === "delivery");
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
  }, [baseDeals, pnlByDeal, heroByDeal]);

  if (tabLoading) return null;
  if (!tabAllowed) return <AccessDenied detail="프로젝트 접근 권한이 없습니다. 관리자/대표에게 권한을 요청하세요." />;

  return (
    <div className="projecthub-page">
      {/* 카드 ⋯메뉴 바깥 클릭 닫기 */}
      {openMenu && <div className="fixed inset-0 z-10" onClick={() => setOpenMenu(null)} />}
      {/* 툴바 — 검색·내담당·성과대시보드·생성 */}
      <div className="projecthub-toolbar page-sticky-header">
        <div className="flex items-center gap-2 flex-1 min-w-[200px]">
          <div className="search-input-wrap">
            <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-dim)]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" strokeLinecap="round" /></svg>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="프로젝트·거래처·담당 검색"
              className="w-full h-9 pl-9 pr-3 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] text-sm focus:outline-none focus:border-[var(--primary)]" />
          </div>
          <div className="mine-scope-toggle">
            <button onClick={() => setMineOnly(true)}
              className={`px-3 h-full whitespace-nowrap transition ${mineOnly ? "bg-[var(--primary)] text-white" : "text-[var(--text-muted)] hover:text-[var(--text)]"}`}>
              내 담당
            </button>
            <button onClick={() => setMineOnly(false)}
              className={`px-3 h-full whitespace-nowrap transition border-l border-[var(--border)] ${!mineOnly ? "bg-[var(--primary)] text-white" : "text-[var(--text-muted)] hover:text-[var(--text)]"}`}>
              전체
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="sort-control">
            <select value={sortKey} onChange={(e) => setSortKey(e.target.value as PSortKey)}
              className="h-full pl-3 pr-1 bg-transparent text-[13px] text-[var(--text-muted)] focus:outline-none cursor-pointer" title="정렬 기준">
              {SORT_OPTIONS.map(([k, label]) => <option key={k} value={k}>{label}순</option>)}
            </select>
            <button onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
              className="h-full px-2 border-l border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] text-xs" title={sortDir === "asc" ? "오름차순" : "내림차순"}>
              {sortDir === "asc" ? "▲" : "▼"}
            </button>
          </div>
          {isManager && typeFilter === "goal" && (
            <button onClick={() => setShowDashboard((v) => !v)} className={`btn-sm ${showDashboard ? "btn-primary" : "btn-secondary"}`}>성과 대시보드</button>
          )}
          <button onClick={() => setShowCreate(true)} className="btn-primary">+ 프로젝트 생성</button>
        </div>
      </div>

      {/* 유형 필터 — 전체 + 3유형 칩. 전체가 기본(모든 유형 한눈에), 클릭 시 그 유형만 */}
      <div className="type-filter-chips">
        {([["all", "전체", baseDeals.length]] as [string, string, number][])
          .concat(PROJECT_TYPE_ORDER.map((t) => [t, `${PROJECT_TYPES[t].icon} ${PROJECT_TYPES[t].label}`, typeSummary[t].count] as [string, string, number]))
          .map(([key, label, count]) => {
            const active = typeFilter === key;
            return (
              <button key={key} onClick={() => setTypeFilter(key as "all" | ProjectType)}
                className={`px-3.5 py-1.5 rounded-full text-[13px] font-semibold transition ${active ? "bg-[var(--primary)] text-white shadow-sm" : "bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--primary)]"}`}>
                {label} <span className={active ? "opacity-80" : "text-[var(--text-dim)]"}>{count}</span>
              </button>
            );
          })}
      </div>
      {typeFilter !== "all" && <p className="text-[11px] text-[var(--text-dim)] -mt-3">{PROJECT_TYPES[typeFilter].desc}</p>}

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

      {/* ① 지금 챙길 것 — 개수 타일을 클릭 렌즈로(2026-07-22). 누르면 아래 목록이 그 조건만 표시 */}
      <div>
        <p className="text-[11px] font-extrabold uppercase tracking-wider text-[var(--text-dim)] mb-2 ml-0.5">지금 챙길 것 · 누르면 아래 목록이 그 조건만 보여줘요</p>
        <div className="ph-lens-grid">
          <button onClick={() => setLens(lens === "risk" ? null : "risk")} className={`ph-lens glass-card ${lens === "risk" ? "ph-lens-on" : ""}`}>
            <span className="ph-lens-label"><span className="ph-lens-dot bg-[var(--danger)]" />위험 · 지연</span>
            <div className="ph-lens-num text-[var(--danger)]">{lensCounts.risk}</div>
            <div className="ph-lens-sub">기한 초과·마진 적자·태스크 지연</div>
            <span className="ph-lens-go">목록 필터 ↓</span>
          </button>
          <button onClick={() => setLens(lens === "due" ? null : "due")} className={`ph-lens glass-card ${lens === "due" ? "ph-lens-on" : ""}`}>
            <span className="ph-lens-label"><span className="ph-lens-dot bg-[var(--warning)]" />이번 주 마감</span>
            <div className="ph-lens-num text-[var(--warning)]">{lensCounts.due}</div>
            <div className="ph-lens-sub">7일 내 마감 예정</div>
            <span className="ph-lens-go">목록 필터 ↓</span>
          </button>
          <button onClick={() => setLens(lens === "progress" ? null : "progress")} className={`ph-lens glass-card ${lens === "progress" ? "ph-lens-on" : ""}`}>
            <span className="ph-lens-label"><span className="ph-lens-dot bg-[var(--text-dim)]" />진행중</span>
            <div className="ph-lens-num text-[var(--text)]">{lensCounts.progress}</div>
            <div className="ph-lens-sub">완료·정산 전 진행 중</div>
            <span className="ph-lens-go">목록 필터 ↓</span>
          </button>
          <button onClick={() => setLens(lens === "receivable" ? null : "receivable")} className={`ph-lens glass-card ${lens === "receivable" ? "ph-lens-on" : ""}`}>
            <span className="ph-lens-label"><span className="ph-lens-dot bg-[var(--danger)]" />{mineOnly ? "내 미수금" : "미수금"}</span>
            <div className="ph-lens-num text-[var(--danger)] !text-[19px] !mt-2.5">{lensCounts.receivableCount > 0 ? won(lensCounts.receivableSum) : "₩0"}</div>
            <div className="ph-lens-sub">발행했지만 미입금 · {lensCounts.receivableCount}건</div>
            <span className="ph-lens-go">목록 필터 ↓</span>
          </button>
        </div>
      </div>

      {/* 회사 전체 미수금 롤업(Phase 3) — 수익형/전체 뷰에서 미수 발생 시 노출 */}
      {(typeFilter === "margin" || typeFilter === "all") && settleSummary.totalOutstanding > 1 && (
        <div className="receivables-rollup glass-card">
          <span className="kpi-icon danger text-base leading-none">💸</span>
          <div className="min-w-0">
            <div className="text-[13px] font-bold text-[var(--text)]">회사 전체 미수금</div>
            <div className="text-[11px] text-[var(--text-muted)]">계산서는 발행했지만 아직 통장에 입금 안 된 금액 (매칭 기준)</div>
          </div>
          <div className="ml-auto text-right">
            <div className="text-lg font-black mono-number text-[var(--danger)]">{won(settleSummary.totalOutstanding)}</div>
            <div className="text-[11px] text-[var(--text-muted)]">미수 프로젝트 {settleSummary.projects}건 — 각 프로젝트 개요의 정산 현황에서 확인</div>
          </div>
        </div>
      )}

      {/* ② 목록 헤더 — 활성 렌즈 표시(해제) + 건수 */}
      <div className="flex items-center justify-between gap-2 flex-wrap -mb-1">
        <div>
          {lens && (
            <button onClick={() => setLens(null)} className="ph-filter-pill">
              {lens === "risk" ? "🔴 위험·지연" : lens === "due" ? "⏰ 이번 주 마감" : lens === "progress" ? "🔵 진행중" : "💸 미수금"}{" "}
              {lens === "receivable" ? `${lensCounts.receivableCount}건만` : `${rows.length}건만`} 보는 중 · 해제 ✕
            </button>
          )}
        </div>
        <span className="text-[12px] text-[var(--text-muted)]">총 <b className="text-[var(--text)]">{rows.length}</b>건</span>
      </div>

      {/* 목록 — 카드형. 긴급도순 정렬 + 다음 액션 줄(2026-07-22). 클릭 시 상세. */}
      {isLoading ? (
        <div className="glass-card p-10 text-center text-sm text-[var(--text-muted)]">불러오는 중...</div>
      ) : rows.length === 0 ? (
        <div className="glass-card py-14 flex flex-col items-center justify-center text-center gap-2">
          <div className="text-4xl">{typeFilter === "all" ? "📁" : PROJECT_TYPES[typeFilter].icon}</div>
          <div className="text-sm font-semibold text-[var(--text)]">
            {search ? "조건에 맞는 프로젝트가 없습니다." : mineOnly ? "내가 담당한 프로젝트가 없습니다." : typeFilter === "all" ? "아직 프로젝트가 없습니다." : `${PROJECT_TYPES[typeFilter].label} 프로젝트가 없습니다.`}
          </div>
          {mineOnly && !search ? (
            <button onClick={() => setMineOnly(false)} className="btn-secondary btn-sm mt-2">전체 프로젝트 보기 →</button>
          ) : !search && <>
            <div className="text-xs text-[var(--text-muted)]">‘+ 프로젝트 생성’으로 추가하세요.</div>
            <button onClick={() => setShowCreate(true)} className="btn-primary mt-2">+ 프로젝트 생성</button>
          </>}
        </div>
      ) : (
        <div className="project-card-grid">
          {rows.map((d) => {
            const stage = (STAGE_ORDER.includes(d.stage) ? d.stage : "estimate") as ProjectStage;
            const sc = STAGE_COLOR[stage];
            const p = pnlByDeal[d.id];
            const ptype = normalizeProjectType(d.project_type);
            const tc = PROJECT_TYPES[ptype];
            const hero = heroByDeal[d.id];
            const risk = isRisk(d);
            const sup = Number(d.contract_total || 0);
            const footerLeft = ptype === "margin" && sup > 0
              ? `계약 ${won(sup)} (VAT별도)`
              : fmtDate(d.start_date) ? `${fmtDate(d.start_date)}${d.end_date ? ` ~ ${fmtDate(d.end_date)}` : ""}` : "기간 미정";
            return (
              <div key={d.id} onClick={() => router.push(`/projecthub/${d.id}`)}
                className={`project-card glass-card ${risk ? "!border-[var(--danger)]/40" : ""}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-[var(--primary)]/10 text-[var(--primary)] whitespace-nowrap">{tc.icon} {tc.label}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${sc.bg} ${sc.text}`}>{STAGE_LABEL[stage]}</span>
                </div>
                <div className="text-sm font-bold text-[var(--text)] leading-snug">
                  {risk && <span className="mr-1 text-[var(--danger)]" title="위험 — 확인 필요">●</span>}
                  {d.name || "(이름 없음)"}
                  {childCount[d.id] > 0 && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--primary)]/10 text-[var(--primary)] font-semibold align-middle">캠페인 {childCount[d.id]}</span>}
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)] min-w-0">
                  <span className="truncate">🏢 {partnerName[d.partner_id] || "—"}</span>
                  <span className="text-[var(--text-dim)]">·</span>
                  <span className="truncate">👤 {userName[d.internal_manager_id] || "—"}</span>
                </div>
                {hero && hero.raw != null && (
                  <div className="flex items-center gap-2" title={`${tc.hero} ${hero.label}`}>
                    <span className="text-[10px] text-[var(--text-dim)] w-11 shrink-0 truncate">{tc.hero}</span>
                    <div className="flex-1 h-1.5 rounded-full bg-[var(--bg-surface)] overflow-hidden">
                      <div className={`h-full rounded-full ${risk ? "bg-[var(--danger)]" : hero.pct >= 70 ? "bg-[var(--success)]" : "bg-[var(--primary)]"}`} style={{ width: `${hero.pct}%` }} />
                    </div>
                    <span className={`text-[10px] mono-number w-9 text-right ${risk ? "text-[var(--danger)] font-semibold" : "text-[var(--text-muted)]"}`}>{hero.label}</span>
                    {ptype === "delivery" && hero.delayed && <span className="text-[9px] px-1 py-0.5 rounded bg-red-500/10 text-red-500 font-semibold shrink-0">지연</span>}
                  </div>
                )}
                {/* 다음 액션 줄 — 마감/미수/완료를 한 줄로(2026-07-22) */}
                {(() => {
                  const na = nextAction(d);
                  return (
                    <div className={`ph-next-row ph-next-${na.tone}`}>
                      <span className="text-xs">{na.icon}</span>
                      <span className="ph-next-txt">다음: {na.text}</span>
                      <span className="ph-next-dday mono-number">{na.dday}</span>
                    </div>
                  );
                })()}
                <div className="flex items-center justify-between gap-2 mt-auto pt-2 border-t border-[var(--border)]/40 relative">
                  <span className="text-[11px] text-[var(--text-muted)] mono-number truncate">{footerLeft}</span>
                  <span className="flex items-center gap-1.5 shrink-0">
                    <button onClick={(e) => { e.stopPropagation(); router.push(`/projecthub/${d.id}`); }} className="ph-open-btn">열기 →</button>
                    <button onClick={(e) => { e.stopPropagation(); setOpenMenu(openMenu === d.id ? null : d.id); }} className="ph-kebab" title="수정·삭제" aria-label="더보기">⋯</button>
                  </span>
                  {openMenu === d.id && (
                    <div className="ph-card-menu" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => { setOpenMenu(null); setEditDeal(d); }}>✏ 수정</button>
                      <button onClick={() => { setOpenMenu(null); setDelDeal(d); }} className="!text-[var(--danger)]">🗑 삭제</button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-[11px] text-[var(--text-dim)]">※ 진행 단계·실적·비용은 프로젝트 상세의 ‘개요’ 탭에서, 활동·일정은 ‘프로젝트 운영’ 탭에서 확인합니다.</p>
    </div>
  );
}

// 프로젝트 생성 모달 — deals 직접 insert (워크플로우 보드와 동일 데이터)
function ProjectFormModal({ companyId, partners, users, editDeal, onClose, onSaved }: {
  companyId: string; partners: any[]; users: any[]; editDeal?: any; onClose: () => void; onSaved: (id?: string) => void;
}) {
  const { toast } = useToast();
  const db = supabase;
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

  const IN = "field-input";
  const LB = "block text-xs text-[var(--text-muted)] mb-1";
  const cfg = PROJECT_TYPES[projectType];

  useModalKeys(true, onClose, !isEdit && step === 1 ? () => setStep(2) : (saving || !form.name.trim() ? undefined : submit));

  return (
    <div className="project-form-modal fixed inset-0">
      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="project-form-modal-header">
          <div className="text-sm font-bold text-[var(--text)]">
            {isEdit ? "프로젝트 수정" : step === 1 ? "+ 프로젝트 생성 · 유형 선택" : `+ ${cfg.icon} ${cfg.label} 프로젝트`}
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text)] text-xl leading-none">✕</button>
        </div>

        {/* 1단계 — 유형 선택 (생성 시에만) */}
        {!isEdit && step === 1 && (
          <div className="project-type-step">
            <p className="text-xs text-[var(--text-muted)]">프로젝트 유형을 선택하세요. 유형에 따라 히어로 지표와 탭이 달라집니다.</p>
            <div className="grid grid-cols-1 gap-2.5">
              {PROJECT_TYPE_ORDER.map((t) => {
                const c = PROJECT_TYPES[t];
                const active = projectType === t;
                return (
                  <button key={t} onClick={() => setProjectType(t)}
                    className={`project-type-option ${active ? "border-[var(--primary)] bg-[var(--primary)]/5 ring-1 ring-[var(--primary)]/30" : "border-[var(--border)] hover:bg-[var(--bg-surface)]"}`}>
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
              <button onClick={onClose} className="btn-secondary">취소</button>
              <button onClick={() => setStep(2)} className="btn-primary">다음 →</button>
            </div>
          </div>
        )}

        {/* 2단계 — 유형별 입력 */}
        {(isEdit || step === 2) && (
          <>
            <div className="project-form-fields">
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
                  <div className="partner-search-field">
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
                      <div className="partner-search-dropdown">
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
                <div className="margin-type-fields">
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
                <div className="goal-kpi-drafts">
                  <div className="flex items-center justify-between">
                    <label className={`${LB} mb-0`}>KPI <span className="font-normal text-[var(--text-dim)]">(1개 이상 — 이름·목표값 필수)</span></label>
                    <button type="button" onClick={addKpi} className="text-[11px] font-semibold text-[var(--primary)] hover:underline">+ KPI 추가</button>
                  </div>
                  {kpiDrafts.map((k, i) => (
                    <div key={i} className="kpi-draft-row">
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
                <div className="delivery-type-fields">
                  <label className={LB}>예산 <span className="font-normal text-[var(--text-dim)]">(선택)</span></label>
                  <div className="flex gap-1">
                    <input value={form.contract_total} onChange={(e) => set({ contract_total: comma(e.target.value) })} inputMode="numeric" placeholder="0" className={`${IN} text-right mono-number`} />
                    <select value={form.vatType} onChange={(e) => set({ vatType: e.target.value as "exclude" | "include" })} className="px-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-[11px] text-[var(--text-muted)]">
                      <option value="exclude">VAT별도</option><option value="include">VAT포함</option>
                    </select>
                  </div>
                </div>
              )}

              <div className="project-date-fields">
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
            <div className="project-form-modal-footer">
              {!isEdit ? (
                <button onClick={() => setStep(1)} className="px-3 py-1.5 text-xs text-[var(--text-muted)]">← 이전</button>
              ) : <span />}
              <div className="flex gap-2">
                <button onClick={onClose} className="btn-secondary">취소</button>
                <button onClick={submit} disabled={saving || !form.name.trim()} className="btn-primary">
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
  const db = supabase;
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
          company_id: companyId as string, entity_type: "deal", entity_id: deal.id, action: "delete",
          before_json: { archived_at: null, name: deal.name },
          after_json: { archived_at: new Date().toISOString() },
          metadata: { soft_delete: true, deal_name: deal.name },
        });
      } catch { /* audit 실패 무시 */ }
      toast("프로젝트가 삭제되었습니다", "success");
      onDeleted();
    } catch (e: any) { toast(e?.message || "삭제 실패", "error"); } finally { setBusy(false); }
  };

  useModalKeys(!busy, () => !busy && onClose(), canDelete && !busy ? del : undefined);

  return (
    <div className="delete-project-modal fixed inset-0" onClick={() => !busy && onClose()}>
      <div className="bg-[var(--bg-card)] border border-red-500/30 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="delete-project-modal-header">
          <div className="text-sm font-bold text-red-400">프로젝트 삭제</div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text)] text-xl leading-none">✕</button>
        </div>
        <div className="delete-project-modal-body">
          <p className="text-xs text-[var(--text-muted)] leading-relaxed">
            <span className="font-bold text-[var(--text)]">{deal.name || "(이름 없음)"}</span> 프로젝트를 삭제하면 목록·보드 어디에서도 보이지 않습니다. (회계·자식 데이터는 보존되며, 복구 가능)
          </p>
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">확인을 위해 프로젝트명을 입력하세요</label>
            <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={target}
              className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm text-[var(--text)]" autoFocus />
          </div>
        </div>
        <div className="delete-project-modal-footer">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-[var(--text-muted)]">취소</button>
          <button onClick={del} disabled={!canDelete || busy} className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-red-500 text-white hover:opacity-90 disabled:opacity-40">
            {busy ? "삭제 중..." : "삭제"}
          </button>
        </div>
      </div>
    </div>
  );
}
