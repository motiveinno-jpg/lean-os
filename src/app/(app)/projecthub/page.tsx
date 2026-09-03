"use client";
import { todayKst, kstDateStr } from "@/lib/kst";
import { Ico } from "@/components/ui-icon";
import { logRead } from "@/lib/log-read";
import { fetchPaged } from "@/lib/fetch-paged";

// 프로젝트(라이프사이클·손익 뷰) — 워크플로우(/projects 보드)와 같은 deals 데이터의 다른 렌즈.
//   2026-06-17 핸드오프 v2: 신규 테이블 없이 기존 deals 재사용. 목록 → 상세(탭) 구조.
//   목록 컬럼: 프로젝트명·거래처·담당자·단계·계약금액·진행률·기간. (직접원가·원가율은 손익 단계에서 추가)

import React, { useCallback, useEffect, useMemo, useState } from "react";
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
// 유형(margin/goal/delivery) 참조는 이 화면에서 전부 사라졌다 — 달성률 산식만 남는다.
import { getOverallAchievement } from "@/lib/project-types";
// 유형 3분할 폐지(2026-07-30) — 목록은 유형으로 걸러지지 않는다. 대표 지표는 있는 데이터에서 고른다.
import { getHeadline, READY_LIST_VIEWS, ANALYSIS_VIEWS, type ProjectSignals } from "@/lib/project-sections";
import { getProjectStatus, daysToEnd, STATUS_RANK, type ProjectStatusKey } from "@/lib/project-status";
import { incVat } from "@/lib/project-money";
import { useCanAccessTab } from "@/lib/tab-access";
import { useMyPermissions } from "@/lib/permissions";
import { CreateProjectV3 } from "./_components/CreateProjectV3";
import { QuietCheckins } from "./_components/QuietCheckins";
import { rollupProject, listStatusOf, listReasons, type ProjectRollup, type ListStatus } from "@/lib/project-list-summary";
import { BOARD_TEMPLATES } from "@/lib/project-boards";
// 워크플로우 보드 — 회사 전체 프로젝트를 커스텀 컬럼으로 보는 도구. 실행형 프로젝트 상세 탭에
//   숨어 있던 것을 목록의 '보드' 보기로 끌어올렸다(2026-07-30 사장님 승인).
import { MondayBoard } from "@/components/monday-board";
import { ProjectTimeline, PortfolioCharts, ProjectCalendar } from "./_components/ListViews";
import { useModalKeys } from "@/hooks/use-modal-keys";
import { SortableTh, nextSort, type SortState, useColFilters } from "@/components/sortable-th";
import {
  QueryScreen, QueryHead, QueryBody, QueryBar, ResultStrip, Stat, ChipGroup, SavedTabs, ConditionSave,
  ConditionPanel, ConditionRow, TokenField, AppliedChips, QuickSearch, quickSearchHit, quickTerms,
  RowsPerPage, Pager, usePager, useSavedQueries,
  type AppliedChip,
} from "@/components/query-kit";

const won = (n: number | null | undefined) => `${Math.round(Number(n || 0)).toLocaleString("ko-KR")}원`;
const fmtDate = (d: string | null | undefined) => (d ? String(d).slice(0, 10) : "");

const NUDGE_OPEN_KEY = "ov.projecthub.nudgeOpen";
/** 검색조건 (조회 화면 표준, 2026-08-18 Wave 3). ★ '조회'를 눌러야 반영. 빠른검색·상태 칩·내 담당은 즉시. */
type Cond = { manager: string[]; partner: string[]; template: string[]; rows: number };
const EMPTY_COND: Cond = { manager: [], partner: [], template: [], rows: 50 };
const condCount = (c: Cond) => c.manager.length + c.partner.length + c.template.length;
const LENS_OPTS = [["", "전체"], ["late", "기한 지남"], ["warn", "이번 주"], ["empty", "입력 전"]] as const;

export default function ProjectHubPage() {
  const { user, role } = useUser();
  const companyId = user?.company_id ?? null;
  const router = useRouter();
  const { toast } = useToast();
  const { allowed: tabAllowed, loading: tabLoading } = useCanAccessTab("/projecthub");
  // 열람 범위 — '/projecthub:all' 이 없으면 자기가 담당자인 프로젝트만 보인다(2026-07-31).
  const { isMaster: projMaster, hasPerm: projHasPerm } = useMyPermissions();
  const canViewAllProjects = projMaster || projHasPerm("/projecthub:all");
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editDeal, setEditDeal] = useState<any | null>(null);
  const [delDeal, setDelDeal] = useState<any | null>(null);
  // 콕핏(2026-07-22) — "지금 챙길 것" 렌즈 필터 + 카드 ⋯메뉴 열림 상태
  //   유형별로 갈렸던 4번째 렌즈(달성 저조·지연 과제)는 폐지 — 미수금으로 통일하고
  //   지연은 '위험' 렌즈가 이미 포함한다(2026-07-30).
  // 상태 필터 — 지연·주의·정상·완료 중 하나만 보기(구 렌즈 4종을 대체, 2026-08-03)
  const [lens, setLens] = useState<ProjectStatusKey | null>(null);
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

  // 참여자 — 대표담당자 한 명 대신 여럿(2026-08-03). '내 담당' 도 이걸 기준으로 본다.
  const { data: phMembers = [] } = useQuery({
    queryKey: ["ph-members", companyId],
    queryFn: async () => {
      const data = logRead("projecthub/page:members", await (supabase as any).from("project_members")
        .select("deal_id, user_id").eq("company_id", companyId!));
      return (data || []) as { deal_id: string; user_id: string }[];
    },
    enabled: !!companyId,
  });
  const membersByDeal = useMemo(() => {
    const m: Record<string, string[]> = {};
    for (const r of phMembers as any[]) (m[r.deal_id] = m[r.deal_id] || []).push(r.user_id);
    return m;
  }, [phMembers]);
  //   참여자 표가 비어 있는 옛 프로젝트는 대표담당자를 참여자 한 명으로 본다(백필 후에도 안전판)
  const membersOfDeal = useCallback((d: any): string[] => {
    const list = membersByDeal[d?.id] || [];
    if (list.length > 0) return list;
    return d?.internal_manager_id ? [d.internal_manager_id] : [];
  }, [membersByDeal]);
  //   내 담당 항목이 있는 프로젝트 — 참여자 표에 없어도 항목 담당자로 지정됐으면 그 프로젝트는
  //   보여야 한다 (2026-09-01 사장님: "참여자로 지정된 것들 많은데 하나도 안 보여" — 항목 담당만
  //   지정되고 참여자 표는 비어 있어 직원 목록에서 통째로 빠졌다).
  const { data: myItemDealIds = [] } = useQuery({
    queryKey: ["ph-my-item-deals", companyId, user?.id],
    enabled: !!companyId && !!user?.id,
    queryFn: async () => {
      //   다중 담당(assignee_ids)도 내 것 — cs = 배열 포함 (2026-09-01)
      const data = logRead("projecthub/page:my-item-deals", await (supabase as any).from("project_items")
        .select("deal_id").eq("company_id", companyId!)
        .or(`assignee_id.eq.${user!.id},assignee_ids.cs.{${user!.id}}`).is("archived_at", null));
      return [...new Set(((data || []) as { deal_id: string }[]).map((r) => r.deal_id))];
    },
  });
  const dealById = useMemo(() => {
    const m: Record<string, any> = {};
    for (const d of deals as any[]) m[d.id] = d;
    return m;
  }, [deals]);
  //   자식(캠페인)에 담당 항목이 있으면 목록에 뜨는 건 상위 프로젝트이므로 부모 id 까지 포함
  const myItemDealSet = useMemo(() => {
    const s = new Set<string>();
    for (const id of myItemDealIds as string[]) {
      s.add(id);
      const parent = dealById[id]?.parent_deal_id;
      if (parent) s.add(parent);
    }
    return s;
  }, [myItemDealIds, dealById]);
  //   '이 프로젝트가 내 것인가' — 참여자이거나 내 담당 항목이 있으면 내 것. 목록 스코프와 '내 담당' 칩이 같이 쓴다.
  const isMyDeal = useCallback((d: any) => membersOfDeal(d).includes(user?.id || "") || myItemDealSet.has(d?.id), [membersOfDeal, user?.id, myItemDealSet]);

  // 세부 프로젝트(캠페인)는 목록에서 숨기고 상위 프로젝트만 노출. 자식 수는 배지로 표시.
  //   전체 열람 권한이 없으면 여기서 내 담당 건으로 좁힌다 — 목록·KPI·칩 카운트가 전부 이 배열을 쓰므로
  //   한 곳만 막아도 화면 전체 스코프가 맞춰진다.
  const topDeals = useMemo(
    () => (deals as any[]).filter((d) => !d.parent_deal_id
      && (canViewAllProjects || isMyDeal(d))),
    [deals, canViewAllProjects, isMyDeal],
  );
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
      const data = await fetchPaged<any>("projecthub/page:settle-rollup", () => (supabase).from("tax_invoices")
        .select("deal_id, total_amount, supply_amount, settled_amount, status, issue_date")
        .eq("company_id", companyId!).eq("type", "sales").neq("status", "void").not("deal_id", "is", null).order("id"), 50000);
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
  // 미수 에이징 — 발행일 기준 경과일 구간별 합계. '차트' 보기에서 사용.
  const agingBuckets = useMemo(() => {
    const defs = [
      { label: "0-30일", min: 0, max: 30 },
      { label: "31-60일", min: 31, max: 60 },
      { label: "61-90일", min: 61, max: 90 },
      { label: "90일+", min: 91, max: Infinity },
    ];
    const out = defs.map((d) => ({ label: d.label, amount: 0, count: 0 }));
    const todayMs = new Date(`${todayKst()}T00:00:00`).getTime();
    for (const r of settleRows as any[]) {
      if (r.status === "draft") continue;
      const bal = Number(r.total_amount || r.supply_amount || 0) - Number(r.settled_amount || 0);
      if (bal <= 1) continue;
      const issued = r.issue_date ? String(r.issue_date).slice(0, 10) : null;
      const days = issued ? Math.floor((todayMs - new Date(`${issued}T00:00:00`).getTime()) / 86_400_000) : 0;
      const i = defs.findIndex((d) => days >= d.min && days <= d.max);
      const slot = out[i < 0 ? 0 : i];
      slot.amount += bal;
      slot.count += 1;
    }
    return out;
  }, [settleRows]);

  // ⚠️ 2026-07-30 유형 3분할 폐지 — KPI·태스크를 "목표형·실행형" 프로젝트만 조회하던 것을
  //    전체 프로젝트로 넓혔다. 수익형으로 만든 프로젝트 30개가 진행률·달성률을 아예 갖지
  //    못했던 원인이 이 필터였다(실측: 태스크는 2개, KPI는 3개 프로젝트에만 존재).
  const allDealIds = useMemo(() => topDeals.map((d) => d.id), [topDeals]);

  // KPI 정의 (다중 KPI 성과관리 모델) — 전 프로젝트
  const { data: goalKpis = [] } = useQuery({
    queryKey: ["projecthub-kpis", companyId, allDealIds.length],
    queryFn: async () => {
      if (allDealIds.length === 0) return [];
      const data = logRead('projecthub/page:data', await (supabase).from("project_kpis").select("id, deal_id, target_value, direction, source").in("deal_id", allDealIds));
      return (data || []) as any[];
    },
    enabled: !!companyId && allDealIds.length > 0,
  });
  // 수동 KPI 실적(kpi_id 별 합)
  const { data: goalEntries = [] } = useQuery({
    queryKey: ["projecthub-kpi-entries", companyId, allDealIds.length],
    queryFn: async () => {
      if (allDealIds.length === 0) return [];
      const data = logRead('projecthub/page:data', await (supabase).from("project_kpi_entries").select("kpi_id, value").in("deal_id", allDealIds));
      return (data || []) as any[];
    },
    enabled: !!companyId && allDealIds.length > 0,
  });
  // 자동 실적(v_deal_kpi_auto — 매출/이익/건수)
  const { data: goalAutos = [] } = useQuery({
    queryKey: ["projecthub-kpi-autos", companyId, allDealIds.length],
    queryFn: async () => {
      if (allDealIds.length === 0) return [];
      const data = logRead('projecthub/page:data', await (supabase).from("v_deal_kpi_auto").select("deal_id, revenue_actual, profit_actual, output_count").in("deal_id", allDealIds));
      return (data || []) as any[];
    },
    enabled: !!companyId && allDealIds.length > 0,
  });
  // 태스크(진행률·지연) — 전 프로젝트
  const { data: tasksRows = [] } = useQuery({
    queryKey: ["projecthub-tasks", companyId, allDealIds.length],
    queryFn: async () => {
      if (allDealIds.length === 0) return [];
      const data = logRead('projecthub/page:data', await (supabase).from("project_tasks").select("deal_id, status, due_date, updated_at").in("deal_id", allDealIds).is("archived_at", null));
      return (data || []) as any[];
    },
    enabled: !!companyId && allDealIds.length > 0,
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
      // KPI 가 없는 프로젝트는 달성률 자체가 없다(유형이 아니라 데이터로 판정).
      if (!kpisByDeal[d.id]?.length) continue;
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

  // 프로젝트가 실제로 가진 데이터 신호 — 유형(project_type) 대신 이걸로 판단한다.
  //   돈: 계약금액·태그된 매출·미수 중 하나라도 / 일: 태스크 / 성과: KPI
  const signalsByDeal = useMemo(() => {
    const m: Record<string, ProjectSignals> = {};
    for (const d of topDeals) {
      const p = pnlByDeal[d.id];
      m[d.id] = {
        hasMoney: Number(d.contract_total || 0) > 0 || Number(p?.revenue || 0) > 0 || (outstandingByDeal[d.id] || 0) > 1,
        hasWork: (taskStatsByDeal[d.id]?.total || 0) > 0,
        hasGoal: goalOverallByDeal[d.id] != null,
      };
    }
    return m;
  }, [topDeals, pnlByDeal, outstandingByDeal, taskStatsByDeal, goalOverallByDeal]);

  // 대표 지표(0~100 정규화) — 있는 데이터에서 자동 선택(돈>성과>일). 사용자가 고르지 않는다.
  //   지연 태스크가 있으면 지표 종류와 무관하게 위험으로 표시한다.
  const headlineByDeal = useMemo(() => {
    const m: Record<string, ReturnType<typeof getHeadline> & { delayed?: boolean }> = {};
    for (const d of topDeals) {
      const s = signalsByDeal[d.id] || {};
      const p = pnlByDeal[d.id];
      const delayed = (taskStatsByDeal[d.id]?.delayed || 0) > 0;
      const h = getHeadline(s, {
        revenue: Number(d.contract_total || 0) || Number(p?.revenue || 0),
        cost: Number(p?.direct_cost || 0),
        taskTotal: taskStatsByDeal[d.id]?.total || 0,
        taskDone: taskStatsByDeal[d.id]?.done || 0,
        achievement: goalOverallByDeal[d.id] ?? null,
      });
      m[d.id] = { ...h, delayed, risk: h.risk || delayed };
    }
    return m;
  }, [topDeals, signalsByDeal, pnlByDeal, taskStatsByDeal, goalOverallByDeal]);

  // 보기 전환(2026-07-30) — 유형 칩이 있던 자리를 대신한다. 카드=기본(처음 쓰는 사람),
  //   표=정렬·비교, 보드=회사가 만든 컬럼(구 워크플로우 탭). 고른 보기는 사람별로 기억한다.
  //   보기(목록/담당별)는 상자 안 갈래 탭. ★ 기억하지 않는다 — 조회 화면 표준(조회값 자동 기억 금지). 기본은 목록.
  const [listView, setListView] = useState<string>("table");
  const [calMonth, setCalMonth] = useState(0); // 캘린더 보기 — 이번 달 기준 오프셋
  // 2026-07-20 QA: 전역 검색(⌘K)에서 프로젝트 결과 클릭 시 ?q=<이름> 딥링크로 진입 —
  //   검색어를 초기값으로 물려받고, 남의 담당 프로젝트도 보이도록 내담당 필터는 해제 상태로 시작.
  const searchParams = useSearchParams();
  const initialQ = searchParams?.get("q") ?? "";
  const [search, setSearch] = useState(initialQ);   // 빠른검색 — 프로젝트·거래처·참여자 (쉼표 = 또는, Enter 로 반영)
  const [mineOnly, setMineOnly] = useState(false); // 기본 = 전체 (2026-09-01 사장님: "처음 들어가면 범위 기본값을 전체로") — '내 담당'으로 좁힐 수 있다
  //   ── 조회 화면 표준 — 검색조건(담당·거래처·템플릿)·내 조건 ──
  const [panelOpen, setPanelOpen] = useState(false);
  const [draft, setDraft] = useState<Cond>(EMPTY_COND);
  const [live, setLive] = useState<Cond>(EMPTY_COND);
  const setD = <K extends keyof Cond>(k: K) => (v: Cond[K]) => setDraft((c) => ({ ...c, [k]: v }));
  //   담당 범위(내 담당/전체)·상태(전체/기한 지남/이번 주/입력 전)도 검색조건 안에서 고르고 '조회'로 반영한다
  //   (2026-08-18 사장님: "검색조건 안에 담당, 전체, 기한지남 등 박스 안으로 들어가게 해야 통일성"). 초안 → 조회 시 확정.
  const [dMine, setDMine] = useState(false);
  const [dLens, setDLens] = useState<ProjectStatusKey | null>(null);
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

  // 제안 줄 접힘/펼침 — 기본은 접힘. 목록 위가 길어지면 정작 프로젝트 카드가 밀린다(2026-08-03).
  const [nudge, setNudge] = useState<"" | "quiet">("");
  const [quietCount, setQuietCount] = useState(0);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem(NUDGE_OPEN_KEY);
    if (saved === "quiet") setNudge(saved);
  }, []);
  const pickNudge = (k: "quiet") => {
    setNudge((prev) => {
      const next = prev === k ? "" : k;
      if (typeof window !== "undefined") window.localStorage.setItem(NUDGE_OPEN_KEY, next);
      return next;
    });
  };


  // 제목줄 클릭 정렬 — 콕핏 기본값은 긴급도순(2026-07-22)
  type PSortKey = "urgency" | "name" | "partner" | "manager" | "stage" | "contract" | "direct_cost" | "cost_ratio" | "progress" | "period" | "items" | "quiet";
  //   머리단 정렬 — 공용 부품(SortableTh). 기본 긴급도(급한 게 위).
  const [sort, setSort] = useState<SortState<PSortKey>>({ key: "urgency", dir: "desc" });
  const sortKey = sort.key, sortDir = sort.dir;
  const onSort = (k: PSortKey) => setSort((c) => nextSort(c, k, k === "urgency" ? "desc" : "asc"));
  // 카드 뷰 정렬 옵션 — 모든 유형 공통
  const SORT_OPTIONS: [PSortKey, string][] = [
    ["urgency", "긴급도"], ["contract", "계약금액"], ["progress", "진행·달성률"], ["stage", "단계"], ["name", "프로젝트명"], ["period", "시작일"],
  ];
  const isDone = (d: any) => d.stage === "completed" || d.stage === "settlement";
  const ddOf = (d: any) => daysToEnd(d.end_date, todayStr);

  // ── 상태(정상·주의·지연) — 화면 전체가 이 한 곳에서 받는다(2026-08-03 개편 ①) ──
  //   프로젝트별 마지막 움직임: 업무 변경 / 생성 시각 중 최신.
  //   (deals 에는 updated_at 컬럼이 없다 — 그래서 프로젝트 자체 수정 시각은 알 수 없다)
  const lastActByDeal = useMemo(() => {
    const m: Record<string, number> = {};
    const touch = (id: string, iso?: string | null) => {
      if (!id || !iso) return;
      const t = new Date(iso).getTime();
      if (!m[id] || t > m[id]) m[id] = t;
    };
    for (const d of topDeals as any[]) touch(d.id, d.created_at);
    for (const t of tasksRows as any[]) touch(t.deal_id, t.updated_at);
    return m;
  }, [topDeals, tasksRows]);
  // 가장 오래된 미수 계산서의 경과일 — 60일 넘으면 '주의'가 아니라 '지연'
  const oldestUnpaidByDeal = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of settleRows as any[]) {
      if (!r.deal_id || !r.issue_date) continue;
      const left = Number(r.total_amount || 0) - Number(r.settled_amount || 0);
      if (left <= 1) continue;
      const days = Math.floor((new Date(`${todayStr}T00:00:00`).getTime() - new Date(`${String(r.issue_date).slice(0, 10)}T00:00:00`).getTime()) / 86_400_000);
      if (!(m[r.deal_id] >= days)) m[r.deal_id] = days;
    }
    return m;
  }, [settleRows, todayStr]);
  const statusByDeal = useMemo(() => {
    const m: Record<string, ReturnType<typeof getProjectStatus>> = {};
    for (const d of topDeals as any[]) {
      const last = lastActByDeal[d.id];
      m[d.id] = getProjectStatus({
        stage: d.stage, endDate: d.end_date, today: todayStr,
        overdueTasks: !!headlineByDeal[d.id]?.delayed,
        outstanding: outstandingByDeal[d.id] || 0,
        oldestUnpaidDays: oldestUnpaidByDeal[d.id] ?? null,
        quietDays: last ? Math.floor((Date.now() - last) / 86_400_000) : null,
        metricRisk: !!headlineByDeal[d.id]?.risk,
      });
    }
    return m;
  }, [topDeals, todayStr, headlineByDeal, outstandingByDeal, oldestUnpaidByDeal, lastActByDeal]);
  const statusOf = (d: any): ProjectStatusKey => statusByDeal[d.id]?.key || "normal";
  const isRisk = (d: any) => statusOf(d) === "late";
  // 카드 "다음 액션" 줄 — 기존 데이터(마감일·단계·미수·지연태스크)만으로 구성.
  const nextAction = (d: any): { icon: string; text: string; dday: string; tone: "risk" | "soon" | "ok" } => {
    const dd = ddOf(d);
    const out = outstandingByDeal[d.id] || 0;
    if (isDone(d)) {
      if (out > 1) return { icon: "💵", text: "정산 대기 · 미수 있음", dday: won(out), tone: "soon" };
      return { icon: "✅", text: d.stage === "settlement" ? "정산 단계" : "완료", dday: "완료", tone: "ok" };
    }
    if (dd != null && dd < 0) return { icon: "⏰", text: "마감 기한 초과", dday: `D+${-dd}`, tone: "risk" };
    if (headlineByDeal[d.id]?.delayed) return { icon: "💤", text: "지연된 할 일 있음", dday: "지연", tone: "risk" };
    if (dd != null && dd <= 7) return { icon: "⏰", text: "마감 임박", dday: `D-${dd}`, tone: "soon" };
    if (out > 1) return { icon: "💵", text: "미수금 회수 필요", dday: won(out), tone: "soon" };
    if (dd != null) return { icon: "🗓", text: "다음 마감", dday: `D-${dd}`, tone: "ok" };
    return { icon: "🗓", text: "기간 미정", dday: "—", tone: "ok" };
  };

  // ── 표(보드) 집계 — 목록 지표를 **입력된 표**에서 뽑는다(2026-08-03 기획 v2 5단계) ──
  //   계약·미수 기반 지표는 새 구조에서 대부분 비어서, 템플릿이 무엇이든 공통인 것만 쓴다.
  const { data: pbBoards = [] } = useQuery({
    queryKey: ["ph-boards", companyId],
    queryFn: async () => {
      const data = logRead("projecthub/page:pbBoards", await (supabase as any).from("project_boards")
        .select("id, deal_id, name, template_key").eq("company_id", companyId!).is("archived_at", null));
      return (data || []) as any[];
    },
    enabled: !!companyId,
  });
  const pbBoardIds = useMemo(() => (pbBoards as any[]).map((b) => b.id), [pbBoards]);
  const { data: pbCols = [] } = useQuery({
    queryKey: ["ph-board-cols", pbBoardIds.length],
    queryFn: async () => {
      if (!pbBoardIds.length) return [];
      const data = logRead("projecthub/page:pbCols", await (supabase as any).from("project_board_columns")
        // settings 까지 — 상태 옵션 라벨을 봐야 '완료된 행'을 지연에서 뺄 수 있다
        .select("id, board_id, type, name, settings").in("board_id", pbBoardIds));
      return (data || []) as any[];
    },
    enabled: pbBoardIds.length > 0,
  });
  const { data: pbGroups = [] } = useQuery({
    queryKey: ["ph-board-groups", pbBoardIds.length],
    queryFn: async () => {
      if (!pbBoardIds.length) return [];
      const data = logRead("projecthub/page:pbGroups", await (supabase as any).from("project_board_groups")
        .select("id, board_id, name, position").in("board_id", pbBoardIds));
      return (data || []) as any[];
    },
    enabled: pbBoardIds.length > 0,
  });
  const { data: pbItems = [] } = useQuery({
    queryKey: ["ph-board-items", pbBoardIds.length],
    queryFn: async () => {
      if (!pbBoardIds.length) return [];
      const data = await fetchPaged<any>("projecthub/page:pbItems", () => (supabase as any).from("project_board_items")
        .select("board_id, group_id, values, updated_at").in("board_id", pbBoardIds).order("id"), 50000);
      return (data || []) as any[];
    },
    enabled: pbBoardIds.length > 0,
  });

  const rollupByDeal = useMemo(() => {
    const m: Record<string, ProjectRollup> = {};
    for (const d of topDeals as any[]) {
      const mine = (pbBoards as any[]).filter((b) => b.deal_id === d.id);
      m[d.id] = rollupProject(mine, pbCols as any[], pbGroups as any[], pbItems as any[], todayStr);
    }
    return m;
  }, [topDeals, pbBoards, pbCols, pbGroups, pbItems, todayStr]);
  const listStatusOfDeal = (d: any): ListStatus => listStatusOf(rollupByDeal[d.id] || { boardCount: 0, boardNames: [], itemCount: 0, quietDays: null, lateCount: 0, soonCount: 0, doneRate: null });

  // ── 목록 '요약'(규칙 기반 — 토큰 0, 2026-09-01 사장님 A안) ──
  //   '입력·확인 사항·마지막 입력' 열이 옛 보드(project_board_items)를 읽어 v3 표와 끊겨 있었다.
  //   v3 project_items 를 집계해 요약 문장과 '마지막 업데이트'를 만든다 — AI 호출 없이 숫자를 문장 틀에 끼운다.
  const { data: v3Items = [] } = useQuery({
    queryKey: ["ph-v3items", companyId],
    queryFn: async () => {
      const data = logRead("projecthub/page:v3items", await (supabase as any).from("project_items")
        .select("id, deal_id, name, status, due_date, updated_at, fields, assignee_id, assignee_ids, parent_id").is("archived_at", null).eq("company_id", companyId!));
      return (data || []) as { id: string; deal_id: string; name: string; status: string; due_date: string | null; updated_at: string; fields: Record<string, unknown> | null; assignee_id: string | null; assignee_ids: string[] | null; parent_id: string | null }[];
    },
    enabled: !!companyId,
  });
  const v3ByDeal = useMemo(() => {
    const m: Record<string, { total: number; done: number; overdue: { name: string; days: number }[]; soon: number; lastAt: number | null }> = {};
    //   완료 판정 = 그 프로젝트 단계의 마지막 그룹(간트·표와 같은 규칙). item_stages 가 null 이면 기본 3단계의 'done'.
    const lastStage: Record<string, string> = {};
    for (const d of topDeals as any[]) {
      const st = Array.isArray(d.item_stages) ? d.item_stages : null;
      lastStage[d.id] = st?.length ? String(st[st.length - 1].id) : "done";
    }
    const day = 86400000;
    for (const it of v3Items) {
      const e = (m[it.deal_id] ||= { total: 0, done: 0, overdue: [], soon: 0, lastAt: null });
      e.total += 1;
      const isDone = it.status === (lastStage[it.deal_id] ?? "done");
      if (isDone) e.done += 1;
      if (it.due_date && !isDone) {
        const dd = it.due_date.slice(0, 10);
        if (dd < todayStr) e.overdue.push({ name: it.name, days: Math.max(1, Math.round((+new Date(todayStr) - +new Date(dd)) / day)) });
        else if ((+new Date(dd) - +new Date(todayStr)) / day <= 7) e.soon += 1;
      }
      const t = +new Date(it.updated_at);
      if (!e.lastAt || t > e.lastAt) e.lastAt = t;
    }
    for (const k in m) m[k].overdue.sort((a, b) => b.days - a.days);
    return m;
  }, [v3Items, topDeals, todayStr]);
  //   가로 단계 병목(2026-09-01 사장님 추천 2 승인) — select 컬럼을 순서대로 놓고,
  //   앞 단계는 끝(마지막 선택지)에 도달했는데 뒷 단계는 못 간 건수 차가 가장 큰 곳을 문장으로.
  const { data: v3Cols = [] } = useQuery({
    queryKey: ["ph-v3cols", companyId],
    queryFn: async () => {
      const data = logRead("projecthub/page:v3cols", await (supabase as any).from("project_item_columns")
        .select("deal_id, key, name, type, settings, position").is("archived_at", null)
        .eq("company_id", companyId!).order("position"));
      return (data || []) as { deal_id: string; key: string; name: string; type: string; settings: { options?: { id: string; label: string; color?: string }[] } | null; position: number }[];
    },
    enabled: !!companyId,
  });
  const bottleneckByDeal = useMemo(() => {
    const colsByDeal: Record<string, typeof v3Cols> = {};
    for (const c of v3Cols) {
      const opts = c.settings?.options || [];
      //   흐름 컬럼만 — 마지막 선택지가 초록(완료 톤)인 select. '유형·채널' 같은 분류 select 는
      //   마지막 값이 완료가 아니라 병목 오탐이 난다(실측에서 '유형 2건 끝났는데…' 발견).
      const flowish = opts.length >= 2 && (opts[opts.length - 1].color || "").toLowerCase() === "#00c875";
      if (c.type === "select" && flowish) (colsByDeal[c.deal_id] ||= []).push(c);
    }
    const itemsByDeal: Record<string, typeof v3Items> = {};
    for (const it of v3Items) (itemsByDeal[it.deal_id] ||= []).push(it);
    const m: Record<string, { aName: string; bName: string; doneA: number; doneB: number; gap: number }> = {};
    for (const dealId in colsByDeal) {
      const cs = colsByDeal[dealId];
      const its = itemsByDeal[dealId] || [];
      if (cs.length < 2 || its.length === 0) continue;
      const doneCount = (c: (typeof cs)[number]) => {
        const opts = c.settings!.options!;
        const lastId = opts[opts.length - 1].id;
        return its.filter((it) => (it.fields || {})[c.key] === lastId).length;
      };
      let best: { aName: string; bName: string; doneA: number; doneB: number; gap: number } | null = null;
      for (let i = 0; i < cs.length - 1; i++) {
        const doneA = doneCount(cs[i]); const doneB = doneCount(cs[i + 1]);
        const gap = doneA - doneB;
        if (doneA > 0 && gap > 0 && (!best || gap > best.gap)) best = { aName: cs[i].name, bName: cs[i + 1].name, doneA, doneB, gap };
      }
      if (best) m[dealId] = best;
    }
    return m;
  }, [v3Cols, v3Items]);

  const v3QuietDays = (d: any): number | null => {
    const at = v3ByDeal[d.id]?.lastAt;
    return at ? Math.floor((Date.now() - at) / 86400000) : null;
  };
  // ── 전체 현황판(결정 141·142) — 기본 판 + 내 판(위젯 카탈로그, 홈 대시보드와 같은 문법·같은 그릇) ──
  const DASH_KEY = "pjv3-board";
  const DASH_DEFAULT = ["nums", "progress", "load", "signal"];
  const DASH_CATALOG: { id: string; name: string; desc: string }[] = [
    { id: "nums", name: "숫자 카드 줄", desc: "진행 중·지남·이번 주·끝낸" },
    { id: "progress", name: "프로젝트별 진행", desc: "완료율 낮고 지남 많은 순" },
    { id: "load", name: "담당별 남은 일", desc: "부하가 쏠린 사람이 위" },
    { id: "signal", name: "신호등 현황", desc: "상태 보고의 신호등 합계" },
    { id: "due", name: "다음 마감 리스트", desc: "가까운 순 — 누르면 그 줄" },
    { id: "money", name: "돈 흐름 띠", desc: "견적→계약(₩ 켠 프로젝트)" },
  ];
  const [dashOpen, setDashOpen] = useState(false);
  const [dashEdit, setDashEdit] = useState(false);
  const [dashCat, setDashCat] = useState(false);
  const [dashWidgets, setDashWidgets] = useState<string[]>(DASH_DEFAULT);
  const [dashLoaded, setDashLoaded] = useState(false);
  //   저장 그릇은 홈 대시보드와 동일: user_preferences.dashboard_grid(화면별 키 맵) —
  //   user_id 는 auth uid, (user_id, company_id) 유니크라 upsert 에 둘 다 + onConflict 필수
  //   (2026-09-01 실측: onConflict 없이 upsert 하면 조용히 실패해 새로고침 후 날아간다 — dashboard-grid.tsx 와 같은 문법)
  useEffect(() => {
    if (!dashOpen || dashLoaded || !companyId) return;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) return;
      const { data } = await (supabase as any).from("user_preferences").select("dashboard_grid")
        .eq("user_id", uid).eq("company_id", companyId).maybeSingle();
      const saved = data?.dashboard_grid?.[DASH_KEY]?.widgets;
      if (Array.isArray(saved) && saved.length > 0) setDashWidgets(saved.filter((w: string) => DASH_CATALOG.some((c) => c.id === w)));
      setDashLoaded(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashOpen, dashLoaded, companyId]);
  const saveDash = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const uid = session?.user?.id;
    if (!uid || !companyId) { toast("저장 실패 — 로그인을 확인해주세요", "error"); return; }
    //   읽고-합치고-쓰기 — 다른 화면(홈 대시보드) 키를 보존한다
    const { data } = await (supabase as any).from("user_preferences").select("dashboard_grid")
      .eq("user_id", uid).eq("company_id", companyId).maybeSingle();
    const merged = { ...(data?.dashboard_grid || {}), [DASH_KEY]: { widgets: dashWidgets } };
    const { error } = await (supabase as any).from("user_preferences").upsert(
      { user_id: uid, company_id: companyId, dashboard_grid: merged, updated_at: new Date().toISOString() },
      { onConflict: "user_id,company_id" });
    if (error) { toast("저장 실패 — 잠시 후 다시 시도해주세요", "error"); return; }
    setDashEdit(false); setDashCat(false);
    toast("내 판으로 저장했습니다 — 다른 사람은 기본 판 그대로입니다", "success");
  };
  const { data: dealSignals = [] } = useQuery({
    queryKey: ["ph-signals", companyId],
    enabled: !!companyId && dashOpen,
    queryFn: async () => (logRead("projecthub/page:signals", await (supabase as any).from("project_status_reports")
      .select("deal_id, signal, created_at").eq("company_id", companyId!)
      .order("created_at", { ascending: false }).limit(300)) || []) as { deal_id: string; signal: "blue" | "orange" | "red"; created_at: string }[],
  });
  const dashData = useMemo(() => {
    const dealName: Record<string, string> = {};
    const lastStage: Record<string, string> = {};
    for (const d of topDeals as any[]) {
      dealName[d.id] = d.name || "";
      const st = Array.isArray(d.item_stages) ? d.item_stages : null;
      lastStage[d.id] = st?.length ? String(st[st.length - 1].id) : "done";
    }
    const parents = v3Items.filter((it) => !it.parent_id && dealName[it.deal_id] !== undefined);
    const isDone = (it: (typeof parents)[number]) => it.status === (lastStage[it.deal_id] ?? "done");
    const td = new Date();
    const ymd = (t: Date) => `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
    const todayStr = ymd(td);
    const in7d = new Date(); in7d.setDate(in7d.getDate() + 7);
    const in7 = ymd(in7d);
    const monday = new Date(); monday.setHours(0, 0, 0, 0); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    const isLate = (it: (typeof parents)[number]) => !isDone(it) && !!it.due_date && it.due_date.slice(0, 10) < todayStr;
    const isWeek = (it: (typeof parents)[number]) => !isDone(it) && !!it.due_date && it.due_date.slice(0, 10) >= todayStr && it.due_date.slice(0, 10) <= in7;
    const late = parents.filter(isLate);
    const week = parents.filter(isWeek);
    const weekDone = parents.filter((it) => isDone(it) && new Date(it.updated_at) >= monday);
    //   프로젝트별 진행 — 지남 많고 완료율 낮은 순(손 갈 곳이 위)
    const per = (topDeals as any[]).map((d) => {
      const list = parents.filter((it) => it.deal_id === d.id);
      const dn = list.filter(isDone).length;
      return {
        id: d.id, name: d.name || "", total: list.length, done: dn,
        pct: list.length ? Math.round(dn / list.length * 100) : 0,
        late: list.filter(isLate).length, week: list.filter(isWeek).length,
      };
    }).filter((p) => p.total > 0).sort((a, b) => (b.late - a.late) || (a.pct - b.pct)).slice(0, 8);
    //   담당별 남은 일(대표 기준)
    const am = new Map<string, { name: string; open: number }>();
    for (const it of parents) {
      if (isDone(it)) continue;
      const key = it.assignee_id || "";
      const cur = am.get(key) || { name: userName[it.assignee_id || ""] || "담당 없음", open: 0 };
      cur.open += 1; am.set(key, cur);
    }
    const load = [...am.values()].sort((a, b) => b.open - a.open).slice(0, 8);
    //   신호등 — 프로젝트별 최신 보고 하나(정렬이 최신순이라 처음 만난 것)
    const sig = new Map<string, string>();
    for (const r of dealSignals) if (dealName[r.deal_id] !== undefined && !sig.has(r.deal_id)) sig.set(r.deal_id, r.signal);
    const withItems = new Set(parents.map((it) => it.deal_id));
    const signal = {
      blue: [...sig.values()].filter((s) => s === "blue").length,
      orange: [...sig.values()].filter((s) => s === "orange").length,
      red: [...sig.values()].filter((s) => s === "red").length,
      none: [...withItems].filter((id) => !sig.has(id)).length,
    };
    const nextDue = parents.filter((it) => !isDone(it) && it.due_date)
      .sort((a, b) => (a.due_date! < b.due_date! ? -1 : 1)).slice(0, 6)
      .map((it) => ({ ...it, dealName: dealName[it.deal_id], who: userName[it.assignee_id || ""] || "" }));
    const quoteN = parents.filter((it) => (it.fields || {})["__quote"]).length;
    const contractN = parents.filter((it) => (it.fields || {})["__contract"]).length;
    return { activeN: (topDeals as any[]).length, late, week, weekDone, per, load, signal, nextDue, quoteN, contractN, todayStr };
  }, [topDeals, v3Items, userName, dealSignals]);

  // ── 내 작업(오두 갭 2차, 2026-09-01 승인) — 전 프로젝트에서 내 담당 미완 줄만 급한 순 한 표 ──
  const [myWorkOpen, setMyWorkOpen] = useState(false);
  const myWork = useMemo(() => {
    if (!userId) return [];
    const lastStage: Record<string, string> = {};
    const dealName: Record<string, string> = {};
    for (const d of topDeals as any[]) {
      const st = Array.isArray(d.item_stages) ? d.item_stages : null;
      lastStage[d.id] = st?.length ? String(st[st.length - 1].id) : "done";
      dealName[d.id] = d.name || "";
    }
    return v3Items
      .filter((it) => (it.assignee_id === userId || (it.assignee_ids || []).includes(userId)) && dealName[it.deal_id] !== undefined && it.status !== (lastStage[it.deal_id] ?? "done"))
      .map((it) => ({
        ...it, dealName: dealName[it.deal_id],
        overdue: !!it.due_date && it.due_date.slice(0, 10) < todayStr,
      }))
      .sort((a, b) => {
        if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
        return (a.due_date || "9999") < (b.due_date || "9999") ? -1 : 1;
      });
  }, [v3Items, topDeals, userId, todayStr]);

  const v3Summary = (d: any): React.ReactNode => {
    const v = v3ByDeal[d.id];
    if (!v || v.total === 0) return <span className="ph-sum-dim">아직 표에 적은 것이 없습니다</span>;
    const parts: React.ReactNode[] = [`${v.total}건 중 ${v.done}건 완료`];
    if (v.overdue.length > 0) parts.push(
      <span className="ph-sum-warn">{`'${v.overdue[0].name}' ${v.overdue[0].days}일 지남${v.overdue.length > 1 ? ` 외 ${v.overdue.length - 1}건` : ""}`}</span>
    );
    const bn = bottleneckByDeal[d.id];
    if (bn) parts.push(`${bn.aName} ${bn.doneA}건 끝났는데 ${bn.bName}은 ${bn.doneB}건 — ${bn.gap}건 걸림`);
    if (v.soon > 0) parts.push(`7일 안 마감 ${v.soon}건`);
    const quiet = v3QuietDays(d);
    if (quiet != null && quiet >= 14 && v.overdue.length === 0) parts.push(<span className="ph-sum-warn">{`${quiet}일째 조용`}</span>);
    return <>{parts.map((p, i) => <React.Fragment key={i}>{i > 0 && <span className="ph-sum-dim"> · </span>}{p}</React.Fragment>)}</>;
  };

  // 확인 사항 — 걸리는 것을 짧은 칩으로 모은다(해당되는 것 전부).
  //   상태(project-status)는 대표 사유 하나만 주므로 목록에서는 여기서 다시 모은다.
  const reasonsOf = (d: any): { text: string; tone: "risk" | "warn" | "dim" }[] => {
    const list: { text: string; tone: "risk" | "warn" | "dim" }[] = [];
    if (isDone(d)) return list;
    const dd = ddOf(d);
    if (dd != null && dd < 0) list.push({ text: `마감 ${-dd}일 지남`, tone: "risk" });
    else if (dd != null && dd <= 7) list.push({ text: `마감 D-${dd}`, tone: "warn" });
    if (headlineByDeal[d.id]?.delayed) list.push({ text: "지연된 업무 있음", tone: "risk" });
    const out = outstandingByDeal[d.id] || 0;
    if (out > 1) {
      const days = oldestUnpaidByDeal[d.id];
      const old = days != null && days > 60;
      list.push({ text: old ? `미수금 ${days}일째` : "미수금 있음", tone: old ? "risk" : "warn" });
    }
    const last = lastActByDeal[d.id];
    const quiet = last ? Math.floor((Date.now() - last) / 86_400_000) : null;
    if (quiet != null && quiet >= 14) list.push({ text: `${quiet}일째 변동 없음`, tone: "dim" });
    if (headlineByDeal[d.id]?.risk) list.push({ text: "마진 적자", tone: "risk" });
    return list;
  };

  // 상태 칩 필터 — 지연·주의·정상 중 하나만 보기(구 렌즈 4타일을 대체, 2026-08-03)
  const matchesLens = (d: any) => !lens || listStatusOfDeal(d) === (lens as any);
  // 내 담당·검색만 보는 스코프 — 목록과 칩 카운트가 **같은 조건**을 쓰게 한 곳에 모은다.
  //   (2026-08-04: 두 군데 따로 적혀 있다가 참여자 전환 때 한쪽만 고쳐져 칩이 사라졌다)
  const inScope = useCallback((d: any) => {
    if (mineOnly && !isMyDeal(d)) return false;   // 내 담당 = 참여자 또는 내 담당 항목 보유 (2026-09-01)
    if (!quickSearchHit(search, [d.name, partnerName[d.partner_id], ...membersOfDeal(d).map((id: string) => userName[id] || "")])) return false;
    return true;
  }, [mineOnly, isMyDeal, membersOfDeal, search, partnerName, userName]);
  //   검색조건 — 담당(주담당)·거래처·템플릿(그 표가 붙은 프로젝트)
  const condHit = useCallback((d: any, c: Cond) => {
    if (c.manager.length && !c.manager.includes(userName[d.internal_manager_id] || "")) return false;
    if (c.partner.length && !c.partner.includes(partnerName[d.partner_id] || "")) return false;
    if (c.template.length) { const names = rollupByDeal[d.id]?.boardNames || []; if (!c.template.some((t) => names.includes(t))) return false; }
    return true;
  }, [userName, partnerName, rollupByDeal]);
  // 급한 순 — 상태 순서(지연→주의→정상→완료)가 곧 긴급도다
  const urgencyRank = (d: any) => ({ late: 0, warn: 1, normal: 2, empty: 3 })[listStatusOfDeal(d)];

  //   머리단 ≡ 필터 — 프로젝트·담당(주담당)·템플릿(첫 표)
  const cf = useColFilters();
  const colVal = (d: any) => ({ name: d.name || "", manager: userName[d.internal_manager_id] || "", template: (rollupByDeal[d.id]?.boardNames || [])[0] || "" });
  const cfSpec = (k: keyof ReturnType<typeof colVal>) => cf.spec(k, topDeals.filter((d) => inScope(d) && matchesLens(d) && condHit(d, live)).map((d) => colVal(d)[k]));
  const rows = useMemo(() => {
    const filtered = topDeals.filter((d) => inScope(d) && matchesLens(d) && condHit(d, live) && cf.hit(colVal(d)));
    return filtered.slice().sort((a, b) => {
      // 긴급도 정렬 — 랭크 오름차순 + 마감 임박 우선. 방향 토글과 무관하게 항상 급한 게 위로.
      if (sortKey === "urgency") {
        const ra = urgencyRank(a), rb = urgencyRank(b);
        if (ra !== rb) return ra - rb;
        const da = ddOf(a), db = ddOf(b);
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
        case "progress": c = (headlineByDeal[a.id]?.pct ?? -1) - (headlineByDeal[b.id]?.pct ?? -1); break;
        case "period": c = (a.start_date || "").localeCompare(b.start_date || ""); break;
        case "items": c = (rollupByDeal[a.id]?.itemCount || 0) - (rollupByDeal[b.id]?.itemCount || 0); break;
        case "quiet": c = (v3ByDeal[b.id]?.lastAt ?? 0) - (v3ByDeal[a.id]?.lastAt ?? 0); break; // 최근 움직인 것 먼저 — v3 표 기준
        default: c = Number(a.contract_total || 0) - Number(b.contract_total || 0);
      }
      if (c === 0) c = Number(a.contract_total || 0) - Number(b.contract_total || 0);
      return sortDir === "asc" ? c : -c;
    });
  }, [topDeals, inScope, condHit, live, sortKey, sortDir, lens, partnerName, userName, pnlByDeal, headlineByDeal, outstandingByDeal, rollupByDeal, v3ByDeal, cf.key]);
  const pager = usePager(rows, live.rows, `${listView}|${search}|${mineOnly}|${lens}|${JSON.stringify(live)}|${cf.key}`);
  const previewCount = useMemo(() => topDeals.filter((d) => inScope(d) && matchesLens(d) && condHit(d, draft)).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [topDeals, inScope, draft, lens]);
  const managerOpts = useMemo(() => [...new Set((topDeals as any[]).map((d) => userName[d.internal_manager_id]).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), "ko")).map((v) => ({ value: v as string, label: v as string })), [topDeals, userName]);
  const partnerOpts = useMemo(() => [...new Set((topDeals as any[]).map((d) => partnerName[d.partner_id]).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), "ko")).map((v) => ({ value: v as string, label: v as string })), [topDeals, partnerName]);
  const templateOpts = useMemo(() => [...new Set((topDeals as any[]).flatMap((d) => rollupByDeal[d.id]?.boardNames || []))].map((v) => ({ value: v, label: v })), [topDeals, rollupByDeal]);
  //   내 조건 — ★ 하나가 이 화면의 기본값
  const saved = useSavedQueries("projecthub", companyId);
  const paramsNow = { view: listView, q: search, mine: mineOnly, lens, cond: live };
  const paramsBasic = { view: "table", q: "", mine: false, lens: null, cond: EMPTY_COND };
  const applySaved = (p: Record<string, unknown>) => {
    if (p.view === "table") setListView(p.view); // '담당별'은 2026-08-31 제거 — 저장된 내 조건에 남아 있어도 목록으로
    if (typeof p.q === "string") setSearch(p.q);
    if (typeof p.mine === "boolean") setMineOnly(p.mine);
    if (p.lens === null || typeof p.lens === "string") setLens((p.lens as ProjectStatusKey | null) ?? null);
    const c = { ...EMPTY_COND, ...(p.cond as Partial<Cond> | undefined) };
    setDraft(c); setLive(c);
  };
  const [defDone, setDefDone] = useState(false);
  useEffect(() => {
    if (defDone || !saved.isFetched) return;
    setDefDone(true);
    if (saved.def && !initialQ) applySaved(saved.def.params || {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved.isFetched, saved.def, defDone]);
  const suggestName = () => [draft.manager[0], draft.partner[0], draft.template[0], mineOnly ? "내 담당" : "전체"].filter(Boolean).slice(0, 3).join(" · ") || "내 조건";
  const dropCond = (patch: Partial<Cond>) => { const c = { ...live, ...patch }; setLive(c); setDraft(c); };
  const chips: AppliedChip[] = [
    ...quickTerms(search).map((t, i) => ({ group: "빠른검색", label: t, onRemove: () => setSearch(quickTerms(search).filter((_, j) => j !== i).join(", ")) })),
    ...(mineOnly ? [{ group: "범위", label: "내 담당", onRemove: () => { setMineOnly(false); setDMine(false); } }] : []),
    ...(lens ? [{ group: "상태", label: LENS_OPTS.find(([k]) => k === lens)?.[1] || lens, onRemove: () => { setLens(null); setDLens(null); } }] : []),
    ...live.manager.map((v) => ({ group: "담당", label: v, onRemove: () => dropCond({ manager: live.manager.filter((x) => x !== v) }) })),
    ...live.partner.map((v) => ({ group: "거래처", label: v, onRemove: () => dropCond({ partner: live.partner.filter((x) => x !== v) }) })),
    ...live.template.map((v) => ({ group: "템플릿", label: v, onRemove: () => dropCond({ template: live.template.filter((x) => x !== v) }) })),
  ];
  const clearAll = () => { setSearch(""); setLive(EMPTY_COND); setDraft(EMPTY_COND); };

  // 칩 카운트는 **상태 필터를 뺀** 같은 스코프에서 센다 — 그래야 칩을 눌러도 숫자가 그대로다.
  const lensScope = useMemo(() => topDeals.filter(inScope), [topDeals, inScope]);
  // 상태별 건수 + 한 문장 요약에 쓰는 숫자 — 내담당·검색 스코프(상태 필터 제외)에서 집계
  // 상태 건수 — 표 기준(지연=기한 지남 / 주의=이번 주·오래 조용 / 시작 전=입력 없음)
  const lensCounts = useMemo(() => {
    const st: Record<string, number> = { late: 0, warn: 0, normal: 0, empty: 0 };
    //   숫자도 v3 표 기준(2026-09-01) — 옛 보드 집계는 표와 끊겨 0만 보였다
    let lateItems = 0, soonItems = 0;
    for (const d of lensScope) {
      st[listStatusOfDeal(d)]++;
      const v = v3ByDeal[d.id];
      if (v) { lateItems += v.overdue.length; soonItems += v.soon; }
    }
    return { ...st, total: lensScope.length, lateItems, soonItems } as any;
  }, [lensScope, v3ByDeal]);

  // 유형별 요약 구획(수익형 마진합·목표형 평균달성·실행형 평균진행)은 유형 칩과 함께 폐지했다.
  //   회사 전체 집계는 목록 '차트' 보기에서 다루기로 정리(2026-07-30 기획 v3 3단계).

  if (tabLoading) return null;
  if (!tabAllowed) return <AccessDenied detail="프로젝트 접근 권한이 없습니다. 마스터에게 권한을 요청하세요." />;

  return (
    <div className="qk-shell projecthub-page">
      {/* 카드 ⋯메뉴 바깥 클릭 닫기 */}
      {openMenu && <div className="fixed inset-0 z-10" onClick={() => setOpenMenu(null)} />}
      {/* ── 조회 화면 표준 — 보기 탭 · 조회 줄 · 걸린 조건 · 결과 요약 · 표 · 쪽 넘김 (2026-08-18 Wave 3) ── */}
      <QueryScreen>
        <QueryHead>
          {/* 보기 탭·성과 대시보드는 뺐다 (2026-08-31 사장님: "성과 대시보드 필요 없을 것 같아, 담당별도") — 목록 하나만 */}
          <QueryBar right={<>
            <button type="button" onClick={() => setDashOpen(true)} className="btn-secondary btn-sm"
              title="회사의 모든 프로젝트를 한 판으로 — 기본 판, 원하면 내 판으로">현황판</button>
            <button type="button" onClick={() => setMyWorkOpen(true)} className="btn-secondary btn-sm"
              title="모든 프로젝트에서 내가 담당한 줄만 급한 순으로">내 작업{myWork.length > 0 ? ` ${myWork.length}` : ""}</button>
            <button type="button" onClick={() => setShowCreate(true)} className="btn-primary btn-sm">+ 프로젝트 생성</button>
          </>}>
            {/* 프로젝트는 기간이 없는 목록이라 조회 줄이 [검색조건] 으로 시작한다 */}
            <ConditionPanel open={panelOpen} onOpenChange={(v) => { if (v) { setDMine(mineOnly); setDLens(lens); } setPanelOpen(v); }} activeCount={condCount(live) + (lens ? 1 : 0) + (mineOnly ? 1 : 0)}
              tabs={<SavedTabs list={saved.list} current={paramsNow} basic={paramsBasic}
                onApply={(sv) => { applySaved(sv.params || {}); setPanelOpen(false); }}
                onBasic={() => { setListView("table"); setMineOnly(false); setLens(null); setDMine(false); setDLens(null); clearAll(); }}
                onRemove={saved.remove} onSetDefault={saved.setDefault} />}
              foot={<>
                <button type="button" className="btn-secondary btn-sm" disabled={condCount(draft) === 0 && dLens === null && !dMine} onClick={() => { setDraft({ ...EMPTY_COND, rows: draft.rows }); setDLens(null); setDMine(false); }}>조건 지우기</button>
                <ConditionSave suggest={suggestName}
                  onSave={(name, asDefault) => { saved.save(name, { view: listView, q: search, mine: dMine, lens: dLens, cond: draft }, asDefault); setLive(draft); setMineOnly(dMine); setLens(dLens); setPanelOpen(false); }} />
                <span className="ml-auto text-[11px] text-[var(--text-dim)]">{previewCount.toLocaleString("ko")}건</span>
                <RowsPerPage value={draft.rows} onChange={setD("rows")} />
                <button type="button" className="btn-primary btn-sm" onClick={() => { setLive(draft); setMineOnly(dMine); setLens(dLens); setPanelOpen(false); }}>조회</button>
              </>}>
              {canViewAllProjects && (
                <ConditionRow label="범위">
                  <ChipGroup value={dMine ? "mine" : "all"} onChange={(v) => setDMine(v === "mine")}
                    options={[{ value: "mine", label: "내 담당" }, { value: "all", label: "전체" }]} />
                </ConditionRow>
              )}
              <ConditionRow label="상태" hint="판정이 아니라 센 사실 — 0이면 안 보인다">
                <span className="qk-quicks">
                  {LENS_OPTS.map(([k, label]) => {
                    const n = k === "" ? lensCounts.total : lensCounts[k];
                    if (k !== "" && n === 0 && dLens !== k) return null;
                    const on = k === "" ? dLens === null : dLens === k;
                    return (
                      <button key={k || "all"} type="button" onClick={() => setDLens(k === "" ? null : (k as ProjectStatusKey))}
                        className={`qk-quick ${on ? "qk-quick-on" : ""} ${k ? `ph-stchip-${k}` : ""}`}>{label} <em className="not-italic font-extrabold">{n}</em></button>
                    );
                  })}
                </span>
              </ConditionRow>
              <ConditionRow label="담당" hint="주담당 · 여러 명">
                <TokenField items={managerOpts} value={draft.manager} onChange={setD("manager")} placeholder="이름 일부" />
              </ConditionRow>
              <ConditionRow label="거래처" hint="여러 곳">
                <TokenField items={partnerOpts} value={draft.partner} onChange={setD("partner")} placeholder="거래처 이름 일부" />
              </ConditionRow>
              <ConditionRow label="템플릿" hint="그 표가 붙은 프로젝트">
                <TokenField items={templateOpts} value={draft.template} onChange={setD("template")} placeholder="예: 예산 · 지출" />
              </ConditionRow>
            </ConditionPanel>
            <QuickSearch value={search} onApply={setSearch} placeholder="프로젝트 · 거래처 · 참여자 — 쉼표로 여러 개, Enter" />
          </QueryBar>

          <AppliedChips chips={chips} onClearAll={clearAll} />

          {/* 결과 요약 — 한 문장이었던 것을 숫자 칸으로. 아래 칩은 '프로젝트'를 세고 여기 '줄'은 행을 센다 (단위 명시) */}
          <ResultStrip right={quietCount > 0 ? (
            <button type="button" onClick={() => pickNudge("quiet")}
              className={`ph-nudge-chip ${nudge === "quiet" ? "ph-nudge-chip-on" : ""}`}>
              변동 없는 프로젝트 <em>{quietCount}</em>
            </button>
          ) : undefined}>
            <Stat label="프로젝트" value={`${rows.length.toLocaleString("ko")}건${rows.length !== lensCounts.total ? ` / ${lensCounts.total}` : ""}`} />
            <Stat label="기한 지난 줄" value={`${lensCounts.lateItems}건`} tone={lensCounts.lateItems > 0 ? "minus" : undefined} />
            <Stat label="이번 주 마감 줄" value={`${lensCounts.soonItems}건`} />
            <span className="text-[10.5px] text-[var(--text-dim)]">대표 지표는 그 프로젝트에 있는 데이터에서 자동으로 골라요 — 돈이 걸렸으면 마진율, 목표가 있으면 달성률, 할 일만 있으면 진행률</span>
          </ResultStrip>
          {/* 조용한 프로젝트 한 줄 체크인 — 주 1회·최대 3건. 접혀 있어도 마운트한다(위 칩 개수) */}
          {companyId && (
            <QuietCheckins
              companyId={companyId} userId={userId}
              deals={topDeals as any[]} tasks={tasksRows as any[]}
              outstandingOf={(id) => outstandingByDeal[id] || 0}
              won={won} toast={toast}
              open={nudge === "quiet"} onCount={setQuietCount} />
          )}
        </QueryHead>

        <QueryBody>
         <div className={listView === "table" && rows.length > 0 && !isLoading ? "ev-scroll" : "ph-scroll"}>

      {/* ── 전체 현황판(결정 141·142) — 기본 판 + 위젯 카탈로그로 내 판 ── */}
      {dashOpen && (
        <div className="phv3-overlay" onClick={(e) => { if (e.target === e.currentTarget) setDashOpen(false); }}>
          <div className="phv3-modal pjv3-dash-modal" role="dialog" aria-modal="true" aria-label="전체 현황판">
            <div className="pjv3-dash-head">
              <h3 className="phv3-modal-title !mb-0">전체 현황판 — 회사의 모든 프로젝트 한 눈</h3>
              <button type="button" className="btn-secondary btn-sm ml-auto"
                onClick={() => { setDashEdit((v) => !v); setDashCat(false); }}>{dashEdit ? "편집 그만" : "내 판으로 고치기"}</button>
              <button type="button" className="btn-secondary btn-sm" onClick={() => setDashOpen(false)}>닫기</button>
            </div>
            {dashEdit && (
              <div className="pjv3-dash-editbar">
                <b>편집 중 — 홈 대시보드와 같은 문법(＋위젯·↑↓·✕)</b>
                <button type="button" className="btn-secondary btn-sm ml-auto" onClick={() => setDashCat((v) => !v)}>＋ 위젯</button>
                <button type="button" className="btn-secondary btn-sm" onClick={() => setDashWidgets([...DASH_DEFAULT])}>기본 판으로 되돌리기</button>
                <button type="button" className="btn-primary btn-sm" onClick={saveDash}>저장 — 내 판으로</button>
              </div>
            )}
            {dashEdit && dashCat && (
              <div className="pjv3-dash-cat">
                {DASH_CATALOG.map((c) => (
                  <button key={c.id} type="button" onClick={() => { setDashWidgets((w) => [...w, c.id]); setDashCat(false); }}>
                    <b>{c.name}</b><small>{c.desc}</small>
                  </button>
                ))}
              </div>
            )}
            <div className="pjv3-dash-body">
              {dashWidgets.map((w, i) => (
                <div key={`${w}-${i}`} className={`pjv3-dw ${dashEdit ? "editing" : ""}`}>
                  {dashEdit && (
                    <div className="pjv3-dwbar">
                      <b>{DASH_CATALOG.find((c) => c.id === w)?.name}</b>
                      <span className="acts">
                        <button type="button" title="위로" disabled={i === 0}
                          onClick={() => setDashWidgets((arr) => { const n = [...arr]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; return n; })}>↑</button>
                        <button type="button" title="아래로" disabled={i === dashWidgets.length - 1}
                          onClick={() => setDashWidgets((arr) => { const n = [...arr]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; return n; })}>↓</button>
                        <button type="button" className="x" title="빼기"
                          onClick={() => setDashWidgets((arr) => arr.filter((_, j) => j !== i))}>✕</button>
                      </span>
                    </div>
                  )}
                  {w === "nums" && (
                    <div className="pjv3-strow !mb-0">
                      <span className="pjv3-stcard" title="목록의 프로젝트 수와 같은 출처"><span className="k">진행 중 프로젝트</span><b className="v num">{dashData.activeN}</b></span>
                      <span className="pjv3-stcard warn"><span className="k">기한 지난 줄</span><b className="v num">{dashData.late.length}</b></span>
                      <span className="pjv3-stcard"><span className="k">7일 안 마감 줄</span><b className="v num">{dashData.week.length}</b></span>
                      <span className="pjv3-stcard good"><span className="k">이번 주 끝낸 줄</span><b className="v num">{dashData.weekDone.length}</b></span>
                    </div>
                  )}
                  {w === "progress" && (
                    <div className="pjv3-stpanel">
                      <h3>프로젝트별 진행 <small>지남 많고 완료율 낮은 순 — 이름을 누르면 그 프로젝트</small></h3>
                      {dashData.per.length === 0 && <div className="pjv3-stempty">표에 줄이 있는 프로젝트가 없습니다</div>}
                      {dashData.per.map((p) => (
                        <button key={p.id} type="button" className="pjv3-dprow" onClick={() => router.push(`/projecthub/${p.id}`)}>
                          <span className="min-w-0 flex-1 truncate text-left">{p.name}</span>
                          <span className="track"><span className="fill" style={{ width: `${p.pct}%` }} /></span>
                          <span className="pct num">{p.pct}%</span>
                          <span className="flags">
                            {p.late > 0 && <em className="late num">지남 {p.late}</em>}
                            {p.late === 0 && p.week > 0 && <em className="week num">주 {p.week}</em>}
                            {p.late === 0 && p.week === 0 && <em className="ok">순항</em>}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                  {w === "load" && (
                    <div className="pjv3-stpanel">
                      <h3>담당별 남은 일 <small>많은 순 — 부하가 쏠린 사람이 위(대표 담당 기준)</small></h3>
                      {dashData.load.length === 0 && <div className="pjv3-stempty">남은 일이 없습니다</div>}
                      {dashData.load.map((a) => {
                        const max = Math.max(1, ...dashData.load.map((x) => x.open));
                        return (
                          <div key={a.name} className="pjv3-sthbar" style={{ cursor: "default" }}>
                            <span className="nm">{a.name}</span>
                            <span className="track"><span className="fill" style={{ width: `${a.open / max * 100}%`, background: "var(--primary)" }} /></span>
                            <span className="n num">{a.open}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {w === "signal" && (
                    <div className="pjv3-stpanel">
                      <h3>신호등 현황 <small>각 프로젝트의 최신 상태 보고 — 보고 안 쓴 프로젝트는 ⚪</small></h3>
                      <div className="pjv3-stmoney">
                        <span className="mstep"><span className="t">🔵 순항</span><b className="n num">{dashData.signal.blue}</b></span>
                        <span className="mstep"><span className="t">🟠 주의</span><b className="n num">{dashData.signal.orange}</b></span>
                        <span className="mstep"><span className="t">🔴 지연</span><b className="n num">{dashData.signal.red}</b></span>
                        <span className="mstep"><span className="t">⚪ 보고 없음</span><b className="n num">{dashData.signal.none}</b></span>
                      </div>
                    </div>
                  )}
                  {w === "due" && (
                    <div className="pjv3-stpanel">
                      <h3>다음 마감 <small>모든 프로젝트에서 가까운 순 — 누르면 그 줄 서랍</small></h3>
                      {dashData.nextDue.length === 0 && <div className="pjv3-stempty">마감일 있는 미완 줄이 없습니다</div>}
                      {dashData.nextDue.map((it) => (
                        <button key={it.id} type="button" className="pjv3-stdue" onClick={() => router.push(`/projecthub/${it.deal_id}?item=${it.id}`)}>
                          <span className={`d num ${it.due_date!.slice(0, 10) < dashData.todayStr ? "late" : ""}`}>{it.due_date!.slice(5, 10)}</span>
                          <span className="min-w-0 flex-1 truncate text-left">{it.name}</span>
                          {it.due_date!.slice(0, 10) < dashData.todayStr && <span className="late">지남</span>}
                          <span className="who">{it.dealName}{it.who ? ` · ${it.who}` : ""}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {w === "money" && (
                    <div className="pjv3-stpanel">
                      <h3>돈 흐름 <small>견적·청구(₩)를 켠 프로젝트 합산</small></h3>
                      <div className="pjv3-stmoney">
                        <span className="mstep"><span className="t">견적</span><b className="n num">{dashData.quoteN}건</b></span>
                        <span className="ar">→</span>
                        <span className="mstep hot"><span className="t">계약</span><b className="n num">{dashData.contractN}건</b></span>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {dashWidgets.length === 0 && <div className="pjv3-stempty">위젯을 다 뺐습니다 — [기본 판으로 되돌리기] 또는 ＋ 위젯</div>}
            </div>
            <p className="pjv3-stnote">저장하면 내 계정에만 적용됩니다 · 진행률 = 마지막 그룹(끝남) 비율, 표 집계와 같은 셈법 · 팀 공유 판은 다음 단계</p>
          </div>
        </div>
      )}

      {/* 내 작업 — 전 프로젝트 한 표. 줄을 누르면 그 프로젝트의 서랍이 열린다(?item=) */}
      {myWorkOpen && (
        <div className="phv3-overlay" onClick={(e) => { if (e.target === e.currentTarget) setMyWorkOpen(false); }}>
          <div className="phv3-modal pjv3-tpl-modal" role="dialog" aria-modal="true" aria-label="내 작업">
            <h3 className="phv3-modal-title">내 작업 — 모든 프로젝트에서 내 담당, 급한 순</h3>
            {myWork.length === 0 && <div className="pjv3-tpl-mine">지금 담당한 미완 작업이 없습니다</div>}
            {myWork.length > 0 && (
              <table className="ph-mywork">
                <thead><tr><th className="!text-left">이름</th><th>프로젝트</th><th>마감</th></tr></thead>
                <tbody>
                  {myWork.slice(0, 50).map((w) => (
                    <tr key={w.id} onClick={() => router.push(`/projecthub/${w.deal_id}?item=${w.id}`)}>
                      <td className="!text-left">{w.parent_id ? "└ " : ""}{w.name}</td>
                      <td><span className="ph-mywork-pj">{w.dealName}</span></td>
                      <td className={`num ${w.overdue ? "ph-mywork-late" : ""}`}>
                        {w.due_date ? (w.overdue ? `D+${Math.round((+new Date(todayStr) - +new Date(w.due_date.slice(0, 10))) / 86400000)}` : w.due_date.slice(5, 10)) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {myWork.length > 50 && <div className="pjv3-tpl-mine">50건까지만 — 급한 것부터 처리하면 줄어듭니다</div>}
            <div className="phv3-modal-actions"><button type="button" className="btn-secondary btn-sm" onClick={() => setMyWorkOpen(false)}>닫기</button></div>
          </div>
        </div>
      )}

      {/* 생성 v3 — 시작 꾸러미(기획 v2.6 결정 0-7). 2026-09-03 v3 5단계 전체 오픈으로 옛 템플릿 고르기 흐름(ProjectFormModal 생성)은 지웠다 — 수정 팝업으로만 남는다 */}
      {showCreate && companyId && (
        <CreateProjectV3 companyId={companyId} userId={userId} onClose={() => setShowCreate(false)} />
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

      {/* 보드 보기 — 회사 전체 프로젝트를 커스텀 컬럼으로. 검색·렌즈·정렬은 보드 자체 툴바가
          담당하므로 여기서는 그대로 임베드한다(구 실행형 상세 '워크플로우' 탭과 동일 컴포넌트). */}
      {listView === "board" && companyId ? (
        <MondayBoard companyId={companyId} users={users as any} />
      ) : isLoading ? (
        <div className="collect-empty">불러오는 중…</div>
      ) : rows.length === 0 ? (
        /* 빈 상태 — 신규 사용자가 가장 먼저 보는 화면. 검색·필터 때문에 빈 것과
           진짜 아무것도 없는 것을 구분한다(구분 없이 안내하면 있는데 없다고 읽힌다). */
        /* 열람 범위 권한이 없으면(내 담당만 보이는 직원) 회사에 프로젝트가 있어도 목록이 빈다 —
           그 경우 '첫 프로젝트를 만들어 보세요' 는 사실과 다르므로 필터 안내 쪽으로 보낸다. */
        search || mineOnly || !canViewAllProjects ? (
          <div className="collect-empty ph-empty">
            <div className="text-4xl">🔍</div>
            <div className="text-sm font-semibold text-[var(--text)]">
              {search ? "조건에 맞는 프로젝트가 없습니다." : "내가 담당한 프로젝트가 없습니다."}
            </div>
            {/* '전체 보기' 유도는 전체 열람 권한자에게만 — 없으면 눌러도 결과가 같다 */}
            {mineOnly && canViewAllProjects && (
              <button onClick={() => setMineOnly(false)} className="btn-secondary btn-sm mt-2">전체 프로젝트 보기 →</button>
            )}
          </div>
        ) : (
          /* 빈 화면 = 새 구조 설명서. 옛 문구(매출·비용/업무/목표·실적)는 지금 화면에 없는 것을
             설명하고 있었다(2026-08-03 사장님 지적). 지금 실제로 하게 되는 세 걸음만 적는다.
             표 이름은 BOARD_TEMPLATES 에서 직접 읽어 템플릿이 바뀌어도 문구가 어긋나지 않게 한다. */
          <div className="ph-onboard">
            <div className="ph-onboard-head">
              <h3>첫 프로젝트를 만들어 보세요</h3>
              <p>이름만 입력하면 만들어집니다. 그다음 하는 일에 맞는 템플릿을 고르면 됩니다.</p>
            </div>
            <div className="ph-onboard-steps">
              <div className="ph-onboard-step">
                <b>① 이름만 적기</b>
                <span>거래처·금액·기간은 안 물어봅니다. 프로젝트명 하나면 만들어져요.</span>
              </div>
              <div className="ph-onboard-step">
                <b>② 템플릿 고르기</b>
                <span>{BOARD_TEMPLATES.map((t) => t.name).join(" · ")} 중에 필요한 것만. ＋ 로 한 프로젝트에 여러 개 붙일 수 있습니다.</span>
              </div>
              <div className="ph-onboard-step">
                <b>③ 정리 보기</b>
                <span>입력한 칸만 골라 합계·진행·기한을 자동으로 요약합니다. 안 쓴 칸은 아예 안 나옵니다.</span>
              </div>
            </div>
            <button onClick={() => setShowCreate(true)} className="btn-primary">+ 프로젝트 만들기</button>
            <p className="ph-onboard-note">템플릿은 부서가 아니라 &apos;일의 형태&apos;로 나눠요 — 마케팅 캠페인·전시회·지원사업이 같은 &apos;예산 · 지출&apos; 템플릿을 씁니다.</p>
          </div>
        )
      ) : listView === "timeline" ? (
        <ProjectTimeline rows={rows as any[]}
          headlineOf={(id) => headlineByDeal[id]}
          outstandingOf={(id) => outstandingByDeal[id] || 0}
          onOpen={(id) => router.push(`/projecthub/${id}`)} />
      ) : listView === "chart" ? (
        <PortfolioCharts rows={rows as any[]}
          pnlOf={(id) => pnlByDeal[id]}
          outstandingOf={(id) => outstandingByDeal[id] || 0}
          agingBuckets={agingBuckets}
          userName={(id) => userName[id || ""] || ""} />
      ) : listView === "cal" ? (
        <ProjectCalendar rows={rows as any[]} monthOffset={calMonth}
          onMonth={(d) => setCalMonth((m) => m + d)}
          onOpen={(id) => router.push(`/projecthub/${id}`)} />
      ) : (
        /* 한 리스트로 본다 — 같은 프로젝트를 위(카드)와 아래(표)로 나누니 헷갈렸다
           (2026-08-03 사장님 지적). 대신 행마다 상태 줄무늬와 '확인 사항' 코멘트를 붙여
           지연·미수를 그 자리에서 읽게 한다. */
        <div className="ph-table-wrap">
          <table className="ev-table ev-lined ph-table">
            <thead>
              <tr>
                {/* '상태(지연/주의/정상)' 열을 뺐다 — 옆 '확인 사항'이 같은 내용을 근거와 함께 적고,
                    행 왼쪽 줄무늬가 색을 이미 맡는다. 판정 단어가 셋이면 셋 다 안 읽힌다. */}
                {/* 4열 재구성(2026-09-01 사장님): 템플릿(정체 아님)·입력(안 읽힘)·확인 사항(장문 칩) 삭제,
                    요약(규칙 기반)이 현재 상태·특이사항을 말한다 */}
                <SortableTh label="프로젝트" sortKey="name" sort={sort} onSort={onSort} filter={cfSpec("name")} />
                <SortableTh label="참여자" sortKey="manager" sort={sort} onSort={onSort} filter={cfSpec("manager")} />
                <SortableTh label="마지막 업데이트" sortKey="quiet" sort={sort} onSort={onSort} />
                <SortableTh label="요약 — 현재 상태·특이사항" />
                <SortableTh label="" />
              </tr>
            </thead>
            <tbody>
              {pager.view.map((d: any) => {
                const r = rollupByDeal[d.id];
                const key = listStatusOfDeal(d);
                return (
                  <tr key={d.id} onClick={() => { if (openMenu) { setOpenMenu(null); return; } router.push(`/projecthub/${d.id}`); }}
                    className={`ph-table-row ph-row-${key}`}>
                    <td>
                      <b>{d.name || "(이름 없음)"}</b>
                      {childCount[d.id] > 0 && <span className="ph-sub-badge">하위 {childCount[d.id]}</span>}
                      {partnerName[d.partner_id] && <span className="ph-table-partner">{partnerName[d.partner_id]}</span>}
                    </td>
                    <td className="ph-table-dim">
                      {(() => {
                        const ids = membersOfDeal(d);
                        if (ids.length === 0) return "—";
                        const names = ids.map((id: string) => userName[id] || "").filter(Boolean);
                        return names.length <= 2 ? names.join(", ") : `${names.slice(0, 2).join(", ")} 외 ${names.length - 2}`;
                      })()}
                    </td>
                    <td className={`ph-table-dim ${(v3QuietDays(d) ?? 0) >= 14 ? "ph-quiet-old" : ""}`}>
                      {(() => { const qd = v3QuietDays(d); return qd == null ? "—" : qd === 0 ? "오늘" : `${qd}일 전`; })()}
                    </td>
                    <td className="ph-sum">{v3Summary(d)}</td>
                    <td className="ph-table-kebab">
                      <button onClick={(e) => { e.stopPropagation(); setOpenMenu(openMenu === d.id ? null : d.id); }} className="ph-kebab" title="수정·삭제" aria-label="더보기">⋯</button>
                      {openMenu === d.id && (
                        <div className="ph-card-menu" onClick={(e) => e.stopPropagation()}>
                          <button onClick={() => { setOpenMenu(null); setEditDeal(d); }}>✏ 수정</button>
                          <button onClick={() => { setOpenMenu(null); setDelDeal(d); }} className="!text-[var(--danger)]"><Ico e="🗑" /> 삭제</button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

         </div>
        </QueryBody>
        {listView === "table" && (
          <Pager page={pager.page} pages={pager.pages} total={rows.length} size={live.rows}
            from={pager.from} to={pager.to} onPage={pager.setPage} />
        )}
      </QueryScreen>
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
  // ⚠️ 유형 선택 단계 폐지(2026-07-30) — 상세 화면이 유형을 더는 참조하지 않으므로 고르게 하면
  //    아무 효과 없는 되돌릴 수 없는 질문만 남는다. deals.project_type 은 NOT NULL(기본 'margin')
  //    이라 컬럼째 드롭하는 4단계까지는 기본값으로 들어간다.
  //    KPI 는 생성 때 강제하지 않는다 — 프로젝트 상세 '성과' 자리에서 필요할 때 정한다.
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
  // 생성은 이름 하나로 끝난다 — 나머지는 접어 둔다(실측: 분류는 9/9 기본값 그대로,
  //   계약금액은 6/9 가 0원. 늘 보이면 "금액 없는 프로젝트는 어떻게 하지?" 로 막힌다).
  //   수정은 값을 고치러 들어온 것이므로 처음부터 펼친다.
  //   생성에서는 이름만 받는다 — 접어둔 칸도 없앴다(2026-08-03 사장님: "프로젝트명 밑에
  //   거래처·담당 등 내용이 있어, 이것도 없어져야 할 것 같다"). 거래처·담당·기간·금액은
  //   '수정'에서만 보인다(값을 고치러 들어온 화면이니 거기서는 처음부터 펼쳐 둔다).
  const [ptSearch, setPtSearch] = useState(() => (editDeal?.partner_id ? ((partners as any[]).find((p) => p.id === editDeal.partner_id)?.name || "") : ""));
  const [ptOpen, setPtOpen] = useState(false);
  const ptMatches = useMemo(() => {
    const t = ptSearch.trim().toLowerCase();
    if (!t) return (partners as any[]).slice(0, 30);
    const tn = t.replace(/-/g, "");
    return (partners as any[]).filter((p) => (p.name || "").toLowerCase().includes(t) || (p.business_number || "").replace(/-/g, "").includes(tn)).slice(0, 200);
  }, [partners, ptSearch]);


  const submit = async () => {
    if (!form.name.trim()) { toast("프로젝트명을 입력하세요", "error"); return; }
    const raw = Number(String(form.contract_total).replace(/[^0-9]/g, ""));
    setSaving(true);
    try {
      const contractAmount = form.vatType === "include" ? Math.round(raw / 1.1) : raw;
      // 유형 분기 없는 단일 payload — 모든 프로젝트가 같은 칸을 갖는다(안 쓰면 비어 있을 뿐).
      const payload: any = {
        name: form.name.trim(),
        start_date: form.start_date || null, end_date: form.end_date || null,
        internal_manager_id: form.manager_id || null,
        partner_id: form.partner_id || null,
        classification: form.classification,
        contract_total: contractAmount || 0,
      };
      if (isEdit) {
        // 단계(stage)·상태(status)는 건드리지 않음 — 기본 정보만 수정
        const { error } = await db.from("deals").update(payload).eq("id", editDeal.id);
        if (error) throw new Error(error.message);
        toast("프로젝트가 수정되었습니다", "success");
        onSaved();
      } else {
        const { data, error } = await db.from("deals").insert({
          company_id: companyId, status: "active", stage: "estimate", ...payload,
        }).select("id").single();
        if (error) throw new Error(error.message);
        toast("프로젝트가 생성되었습니다", "success");
        onSaved(data?.id);
      }
    } catch (e: any) { toast(e?.message || (isEdit ? "수정 실패" : "생성 실패"), "error"); } finally { setSaving(false); }
  };

  const IN = "field-input";
  const LB = "block text-xs text-[var(--text-muted)] mb-1";

  useModalKeys(true, onClose, saving || !form.name.trim() ? undefined : submit);

  return (
    <div className="project-form-modal fixed inset-0">
      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="project-form-modal-header">
          <div className="text-sm font-bold text-[var(--text)]">{isEdit ? "프로젝트 수정" : "+ 프로젝트 만들기"}</div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text)] text-xl leading-none">✕</button>
        </div>

        <>
            <div className="project-form-fields">
              <div>
                <label className={LB}>무슨 일인가요? *</label>
                <input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="프로젝트명" className={IN} autoFocus />
                <p className="text-[11px] text-[var(--text-dim)] mt-1">{isEdit ? "이름만 입력하면 됩니다. 나머지는 비워 두어도 됩니다." : "만든 뒤에 하는 일에 맞는 템플릿을 고르게 됩니다."}</p>
              </div>
              {isEdit && <>
              <div className="grid grid-cols-2 gap-3">
                {/* 거래처 — 내부 프로젝트면 비워두면 된다 */}
                {(
                  <div className="partner-search-field">
                    <label className={LB}>거래처 <span className="font-normal text-[var(--text-dim)]">(선택)</span></label>
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
                <div>
                  <label className={LB}>담당자 <span className="font-normal text-[var(--text-dim)]">(선택)</span></label>
                  <select value={form.manager_id} onChange={(e) => set({ manager_id: e.target.value })} className={IN}>
                    <option value="">미지정</option>
                    {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                </div>
              </div>

              {/* 분류는 생성 때 묻지 않는다 — 실측 9/9 가 기본값(B2B) 그대로였다. 수정에서만 고친다.
                  계약금액도 '없으면 비워두는 칸' 임을 라벨·플레이스홀더로 분명히 한다. */}
              {(
                <div className="margin-type-fields">
                  {isEdit && (
                    <div>
                      <label className={LB}>분류</label>
                      <select value={form.classification} onChange={(e) => set({ classification: e.target.value })} className={IN}>
                        <option value="B2B">B2B</option><option value="B2C">B2C</option><option value="B2G">B2G</option>
                      </select>
                    </div>
                  )}
                  <div className={isEdit ? "" : "col-span-2"}>
                    <label className={LB}>계약금액 <span className="font-normal text-[var(--text-dim)]">(선택 — 견적·계약을 만들면 자동으로 잡혀요)</span></label>
                    <div className="flex gap-1">
                      <input value={form.contract_total} onChange={(e) => set({ contract_total: comma(e.target.value) })} inputMode="numeric" placeholder="비워두면 나중에" className={`${IN} text-right mono-number`} />
                      <select value={form.vatType} onChange={(e) => set({ vatType: e.target.value as "exclude" | "include" })} className="px-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-[11px] text-[var(--text-muted)]">
                        <option value="exclude">VAT별도</option><option value="include">VAT포함</option>
                      </select>
                    </div>
                    {/* 화면에는 VAT 포함으로 표기되므로, 입력값이 얼마로 잡히는지 바로 보여준다
                        (2026-08-03 사장님: "입력은 공급가로도 되게, 최종은 VAT 합산 표기") */}
                    {(() => {
                      const raw = Number(String(form.contract_total).replace(/[^0-9]/g, ""));
                      if (!raw) return null;
                      const net = form.vatType === "include" ? Math.round(raw / 1.1) : raw;
                      return (
                        <p className="text-[11px] text-[var(--text-dim)] mt-1">
                          VAT 포함 <b className="text-[var(--text)] mono-number">{incVat(net).toLocaleString("ko-KR")}원</b>
                          <span className="ml-1">· 공급가 {net.toLocaleString("ko-KR")}원</span>
                        </p>
                      );
                    })()}
                  </div>
                </div>
              )}

              {/* 목표(KPI)는 생성 때 묻지 않는다 — 프로젝트 상세 '성과' 자리에서 필요할 때 정한다.
                  실행형 전용 '예산' 칸도 계약금액과 중복이라 없앴다(2026-07-30). */}
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
              </>}
            </div>
            <div className="project-form-modal-footer">
              <span />
              <div className="flex gap-2">
                <button onClick={onClose} className="btn-secondary">취소</button>
                <button onClick={submit} disabled={saving || !form.name.trim()} className="btn-primary">
                  {saving ? "저장 중..." : isEdit ? "저장" : "생성"}
                </button>
              </div>
            </div>
          </>
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
