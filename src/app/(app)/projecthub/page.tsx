"use client";
import { todayKst, kstDateStr } from "@/lib/kst";
import { Ico } from "@/components/ui-icon";
import { logRead } from "@/lib/log-read";

// 프로젝트(라이프사이클·손익 뷰) — 워크플로우(/projects 보드)와 같은 deals 데이터의 다른 렌즈.
//   2026-06-17 핸드오프 v2: 신규 테이블 없이 기존 deals 재사용. 목록 → 상세(탭) 구조.
//   목록 컬럼: 프로젝트명·거래처·담당자·단계·계약금액·진행률·기간. (직접원가·원가율은 손익 단계에서 추가)

import { useEffect, useMemo, useState } from "react";
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
import { getHeadline, READY_LIST_VIEWS, ANALYSIS_VIEWS, normalizeListView, viewStorageKey, type ProjectSignals } from "@/lib/project-sections";
import { getProjectStatus, daysToEnd, STATUS_RANK, type ProjectStatusKey } from "@/lib/project-status";
import { incVat } from "@/lib/project-money";
import { useCanAccessTab } from "@/lib/tab-access";
import { useMyPermissions } from "@/lib/permissions";
import { PerformanceDashboard } from "./_components/PerformanceDashboard";
import { QuietCheckins } from "./_components/QuietCheckins";
import { PeopleView } from "./_components/PeopleView";
import { rollupProject, listStatusOf, listReasons, LIST_STATUS_LABEL, type ProjectRollup, type ListStatus } from "@/lib/project-list-summary";
// 워크플로우 보드 — 회사 전체 프로젝트를 커스텀 컬럼으로 보는 도구. 실행형 프로젝트 상세 탭에
//   숨어 있던 것을 목록의 '보드' 보기로 끌어올렸다(2026-07-30 사장님 승인).
import { MondayBoard } from "@/components/monday-board";
import { ProjectTimeline, PortfolioCharts, ProjectCalendar } from "./_components/ListViews";
import { useModalKeys } from "@/hooks/use-modal-keys";

const won = (n: number | null | undefined) => `${Math.round(Number(n || 0)).toLocaleString("ko-KR")}원`;
const fmtDate = (d: string | null | undefined) => (d ? String(d).slice(0, 10) : "");

// 묶을 만한 거래 — 후보 기준. 너무 낮게 잡으면 반복 소액 거래처가 목록을 덮는다
//   (실측: 최근 180일 매출 거래처 378곳 → 2건+·300만원+ 로 좁히면 22곳).
const CAND_MIN_COUNT = 2;
const CAND_MIN_AMOUNT = 3_000_000;
const CAND_MAX = 5;
const CAND_HIDE_KEY = "ov.projecthub.candHidden";
const NUDGE_OPEN_KEY = "ov.projecthub.nudgeOpen";
type Candidate = { partnerId: string; name: string; cnt: number; amt: number; first: string; last: string; ids: string[] };

export default function ProjectHubPage() {
  const { user, role } = useUser();
  const companyId = user?.company_id ?? null;
  const isManager = true; // (P3) 프로젝트 권한 보유자 전원 관리 뷰
  const router = useRouter();
  const { toast } = useToast();
  const { allowed: tabAllowed, loading: tabLoading } = useCanAccessTab("/projecthub");
  // 열람 범위 — '/projecthub:all' 이 없으면 자기가 담당자인 프로젝트만 보인다(2026-07-31).
  const { isMaster: projMaster, hasPerm: projHasPerm } = useMyPermissions();
  const canViewAllProjects = projMaster || projHasPerm("/projecthub:all");
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false); // 성과 대시보드(사람별·부서별) — 관리자 토글. 유형 폐지로 전 프로젝트 대상
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

  // 세부 프로젝트(캠페인)는 목록에서 숨기고 상위 프로젝트만 노출. 자식 수는 배지로 표시.
  //   전체 열람 권한이 없으면 여기서 내 담당 건으로 좁힌다 — 목록·KPI·칩 카운트가 전부 이 배열을 쓰므로
  //   한 곳만 막아도 화면 전체 스코프가 맞춰진다.
  const topDeals = useMemo(
    () => (deals as any[]).filter((d) => !d.parent_deal_id && (canViewAllProjects || d.internal_manager_id === user?.id)),
    [deals, canViewAllProjects, user?.id],
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
      const data = logRead('projecthub/page:data', await (supabase).from("tax_invoices")
        .select("deal_id, total_amount, supply_amount, settled_amount, status, issue_date")
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
  const [listView, setListView] = useState<string>("card");
  const [calMonth, setCalMonth] = useState(0); // 캘린더 보기 — 이번 달 기준 오프셋
  useEffect(() => {
    if (typeof window === "undefined") return;
    setListView(normalizeListView(window.localStorage.getItem(viewStorageKey("list", user?.id))));
  }, [user?.id]);
  const pickListView = (v: string) => {
    setListView(v);
    if (typeof window !== "undefined") window.localStorage.setItem(viewStorageKey("list", user?.id), v);
  };
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

  // ── 묶을 만한 거래 ─────────────────────────────────────────
  //   프로젝트에 연결되지 않은 매출 계산서를 거래처별로 모아 "프로젝트로 묶을까요?" 를 제안한다.
  //   근거(2026-08-03 실측): 계산서 1,837건 중 프로젝트에 연결된 건 9건(0.5%)이다.
  //   빈 프로젝트를 먼저 만들고 데이터가 붙기를 기다리는 순서로는 매출·비용 자리가 영영 안 열린다.
  //   반대로 이미 쌓인 거래에서 후보를 뽑으면 22곳이 나온다(건수 2건+·합계 300만원+ 기준).
  //   ⚠️ 자동 생성하지 않는다 — 후보만 보여주고 만드는 것은 사람이 누른다.
  //   ⚠️ 회사 전체 매출이 드러나므로 전체 열람 권한자에게만 조회한다.
  const { data: looseInvoices = [] } = useQuery({
    queryKey: ["projecthub-loose-invoices", companyId],
    queryFn: async () => {
      const since = kstDateStr(new Date(Date.now() - 180 * 86_400_000));
      const data = logRead('projecthub/page:data', await (supabase).from("tax_invoices")
        .select("id, partner_id, counterparty_name, total_amount, issue_date")
        .eq("company_id", companyId!).eq("type", "sales")
        .neq("status", "void").neq("status", "draft")
        .is("deal_id", null).not("partner_id", "is", null).gte("issue_date", since));
      return (data || []) as any[];
    },
    enabled: !!companyId && canViewAllProjects,
  });
  // 제안 줄 접힘/펼침 — 기본은 접힘. 목록 위가 길어지면 정작 프로젝트 카드가 밀린다(2026-08-03).
  const [nudge, setNudge] = useState<"" | "cand" | "quiet">("");
  const [quietCount, setQuietCount] = useState(0);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem(NUDGE_OPEN_KEY);
    if (saved === "cand" || saved === "quiet") setNudge(saved);
  }, []);
  const pickNudge = (k: "cand" | "quiet") => {
    setNudge((prev) => {
      const next = prev === k ? "" : k;
      if (typeof window !== "undefined") window.localStorage.setItem(NUDGE_OPEN_KEY, next);
      return next;
    });
  };

  // 안 묶을 거래처는 이 브라우저에서만 숨긴다(테이블을 늘리지 않으려고 localStorage 사용).
  const [hiddenCands, setHiddenCands] = useState<string[]>([]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try { setHiddenCands(JSON.parse(window.localStorage.getItem(CAND_HIDE_KEY) || "[]")); } catch { /* 저장값이 깨져도 무시 */ }
  }, []);
  const hideCandidate = (partnerId: string) => {
    setHiddenCands((prev) => {
      const next = prev.includes(partnerId) ? prev : [...prev, partnerId];
      if (typeof window !== "undefined") window.localStorage.setItem(CAND_HIDE_KEY, JSON.stringify(next));
      return next;
    });
  };
  const candidates = useMemo(() => {
    if (!(looseInvoices as any[]).length) return [] as Candidate[];
    const taken = new Set((deals as any[]).filter((d) => d.partner_id).map((d) => d.partner_id));
    const m = new Map<string, Candidate>();
    for (const iv of looseInvoices as any[]) {
      const pid = iv.partner_id as string;
      const cur = m.get(pid) || {
        partnerId: pid, name: partnerName[pid] || String(iv.counterparty_name || "").replace(/\+/g, " ") || "이름 없는 거래처",
        cnt: 0, amt: 0, first: iv.issue_date, last: iv.issue_date, ids: [] as string[],
      };
      cur.cnt += 1;
      cur.amt += Number(iv.total_amount || 0);
      cur.ids.push(iv.id);
      if (iv.issue_date < cur.first) cur.first = iv.issue_date;
      if (iv.issue_date > cur.last) cur.last = iv.issue_date;
      m.set(pid, cur);
    }
    return [...m.values()]
      .filter((c) => c.cnt >= CAND_MIN_COUNT && c.amt >= CAND_MIN_AMOUNT && !taken.has(c.partnerId) && !hiddenCands.includes(c.partnerId))
      .sort((a, b) => b.amt - a.amt)
      .slice(0, CAND_MAX);
  }, [looseInvoices, deals, partnerName, hiddenCands]);

  // 후보 → 프로젝트. 거래처·기간·금액이 채워진 채로 만들고, 근거가 된 계산서를 그 프로젝트로 옮긴다.
  //   (연결은 세금계산서 화면에서 언제든 해제·변경할 수 있다)
  const [bundling, setBundling] = useState<string | null>(null);
  const bundleCandidate = async (c: Candidate) => {
    if (!companyId || bundling) return;
    setBundling(c.partnerId);
    try {
      const { data, error } = await (supabase).from("deals").insert({
        company_id: companyId, status: "active", stage: "in_progress",
        name: c.name, partner_id: c.partnerId, internal_manager_id: userId,
        start_date: c.first, contract_total: c.amt,
      }).select("id").single();
      if (error) throw new Error(error.message);
      const newId = data?.id as string | undefined;
      if (newId) {
        const { error: linkErr } = await (supabase).from("tax_invoices").update({ deal_id: newId }).in("id", c.ids);
        if (linkErr) throw new Error(linkErr.message);
      }
      qc.invalidateQueries({ queryKey: ["projecthub-deals"] });
      qc.invalidateQueries({ queryKey: ["projecthub-loose-invoices"] });
      qc.invalidateQueries({ queryKey: ["projecthub-settle-rollup"] });
      toast(`'${c.name}' 프로젝트를 만들고 계산서 ${c.cnt}건을 연결했습니다.`, "success");
      if (newId) router.push(`/projecthub/${newId}`);
    } catch (e: any) {
      toast(e?.message || "프로젝트 생성 실패", "error");
    } finally {
      setBundling(null);
    }
  };

  // 제목줄 클릭 정렬 — 콕핏 기본값은 긴급도순(2026-07-22)
  type PSortKey = "urgency" | "name" | "partner" | "manager" | "stage" | "contract" | "direct_cost" | "cost_ratio" | "progress" | "period";
  const [sortKey, setSortKey] = useState<PSortKey>("urgency");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
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
        .select("id, board_id, type, name").in("board_id", pbBoardIds));
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
      const data = logRead("projecthub/page:pbItems", await (supabase as any).from("project_board_items")
        .select("board_id, group_id, values, updated_at").in("board_id", pbBoardIds).limit(5000));
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
  // 급한 순 — 상태 순서(지연→주의→정상→완료)가 곧 긴급도다
  const urgencyRank = (d: any) => ({ late: 0, warn: 1, normal: 2, empty: 3 })[listStatusOfDeal(d)];

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = topDeals.filter((d) => {
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
        default: c = Number(a.contract_total || 0) - Number(b.contract_total || 0);
      }
      if (c === 0) c = Number(a.contract_total || 0) - Number(b.contract_total || 0);
      return sortDir === "asc" ? c : -c;
    });
  }, [topDeals, search, mineOnly, userId, sortKey, sortDir, lens, partnerName, userName, pnlByDeal, headlineByDeal, outstandingByDeal]);

  // 렌즈 카운트 — 내담당·검색 스코프(lens 제외)에서 집계.
  const lensScope = useMemo(() => rows.length === 0 || lens ? topDeals.filter((d) => {
    const q = search.trim().toLowerCase();
    if (mineOnly && d.internal_manager_id !== userId) return false;
    if (q) {
      const hay = `${d.name || ""} ${partnerName[d.partner_id] || ""} ${userName[d.internal_manager_id] || ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }) : rows, [rows, lens, topDeals, mineOnly, userId, search, partnerName, userName]);
  // 상태별 건수 + 한 문장 요약에 쓰는 숫자 — 내담당·검색 스코프(상태 필터 제외)에서 집계
  // 상태 건수 — 표 기준(지연=기한 지남 / 주의=이번 주·오래 조용 / 시작 전=입력 없음)
  const lensCounts = useMemo(() => {
    const st: Record<string, number> = { late: 0, warn: 0, normal: 0, empty: 0 };
    let lateItems = 0, soonItems = 0, boards = 0;
    for (const d of lensScope) {
      st[listStatusOfDeal(d)]++;
      const r = rollupByDeal[d.id];
      if (r) { lateItems += r.lateCount; soonItems += r.soonCount; boards += r.boardCount; }
    }
    return { ...st, total: lensScope.length, lateItems, soonItems, boards } as any;
  }, [lensScope, rollupByDeal]);

  // 유형별 요약 구획(수익형 마진합·목표형 평균달성·실행형 평균진행)은 유형 칩과 함께 폐지했다.
  //   회사 전체 집계는 목록 '차트' 보기에서 다루기로 정리(2026-07-30 기획 v3 3단계).

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
          {/* 전체 열람 권한이 없으면 스코프 전환 자체를 감춘다 — 어차피 내 담당만 조회된다 */}
          {canViewAllProjects && <div className="mine-scope-toggle">
            <button onClick={() => setMineOnly(true)}
              className={`px-3 h-full whitespace-nowrap transition ${mineOnly ? "bg-[var(--primary)] text-white" : "text-[var(--text-muted)] hover:text-[var(--text)]"}`}>
              내 담당
            </button>
            <button onClick={() => setMineOnly(false)}
              className={`px-3 h-full whitespace-nowrap transition border-l border-[var(--border)] ${!mineOnly ? "bg-[var(--primary)] text-white" : "text-[var(--text-muted)] hover:text-[var(--text)]"}`}>
              전체
            </button>
          </div>}
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
          {isManager && (
            <button onClick={() => setShowDashboard((v) => !v)} className={`btn-sm ${showDashboard ? "btn-primary" : "btn-secondary"}`}>성과 대시보드</button>
          )}
          <button onClick={() => setShowCreate(true)} className="btn-primary">+ 프로젝트 생성</button>
        </div>
      </div>

      {/* ① 한 문장 요약 + 제안 칩 — 숫자 타일보다 말이 먼저 온다(2026-08-03 개편 ②).
          지금 챙길 게 없으면 그렇다고 말한다(빈 화면을 만들지 않는다). */}
      <div className="ph-brief">
        <p className="ph-brief-line">
          {lensCounts.lateItems + lensCounts.soonItems === 0
            ? <>프로젝트 <b>{lensCounts.total}건</b> · 표 <b>{lensCounts.boards}개</b>. 기한이 걸린 건 없어요.</>
            : <>
                {lensCounts.lateItems > 0 && <>기한 지난 것 <b>{lensCounts.lateItems}건</b></>}
                {lensCounts.lateItems > 0 && lensCounts.soonItems > 0 && " · "}
                {lensCounts.soonItems > 0 && <>이번 주 <b>{lensCounts.soonItems}건</b></>}
                {" 이 있어요."}
              </>}
        </p>
        {(candidates.length > 0 || quietCount > 0) && (
          <div className="ph-brief-nudge">
            {candidates.length > 0 && (
              <button type="button" onClick={() => pickNudge("cand")}
                className={`ph-nudge-chip ${nudge === "cand" ? "ph-nudge-chip-on" : ""}`}>
                미연결 거래 <em>{candidates.length}</em>
              </button>
            )}
            {quietCount > 0 && (
              <button type="button" onClick={() => pickNudge("quiet")}
                className={`ph-nudge-chip ${nudge === "quiet" ? "ph-nudge-chip-on" : ""}`}>
                변동 없는 프로젝트 <em>{quietCount}</em>
              </button>
            )}
          </div>
        )}
      </div>

      {/* ② 상태 칩 + 보기 — 구 렌즈 4타일과 보기 6종이 이 한 줄로 합쳐졌다.
          상태 단어는 목록·카드·표·상세가 모두 같은 것을 쓴다(project-status.ts). */}
      <div className="ph-statusbar">
        <div className="ph-stchips">
          {([["", "전체", lensCounts.total], ["late", "지연", lensCounts.late], ["warn", "주의", lensCounts.warn],
             ["normal", "정상", lensCounts.normal], ["empty", "시작 전", lensCounts.empty]] as const).map(([k, label, n]) => (
            (k === "empty" && n === 0) ? null : (
              <button key={k || "all"} type="button" onClick={() => setLens((prev) => (prev === k || k === "" ? null : k as any))}
                aria-pressed={k === "" ? lens === null : lens === k}
                className={`ph-stchip ${k ? `ph-stchip-${k}` : ""} ${(k === "" ? lens === null : lens === k) ? "ph-stchip-on" : ""}`}>
                {label}<em>{n}</em>
              </button>
            )
          ))}
        </div>
        {/* 보기는 둘만 — 보드·캘린더·분석은 계약·마감(회계)을 전제로 만든 화면이라
            새 구조에서는 대부분 빈다. 표 데이터가 쌓이면 그때 표 기준으로 다시 만든다(2026-08-03). */}
        <div className="ph-viewpick">
          {([["table", "목록"], ["people", "담당별"]] as const).map(([k, label]) => (
            <button key={k} onClick={() => pickListView(k)} aria-pressed={listView === k}
              className={`ph-view-btn ${listView === k ? "ph-view-btn-on" : ""}`}>{label}</button>
          ))}
        </div>
      </div>

      {/* 묶을 만한 거래 — 후보가 없으면 줄 자체가 사라진다(빈 상태를 만들지 않는다) */}
      {candidates.length > 0 && nudge === "cand" && (
        <section className="ph-cands">
          <div className="ph-cands-head">
            <b>프로젝트에 안 묶인 거래</b>
            <span>묶으면 거래처·기간·금액이 채워진 채로 프로젝트가 만들어져요.</span>
          </div>
          {candidates.map((c) => (
            <div key={c.partnerId} className="ph-cand">
              <span className="ph-cand-main">
                <b>{c.name}</b>
                <span>계산서 {c.cnt}건 · {fmtDate(c.first).slice(2).replace(/-/g, ".")} ~ {fmtDate(c.last).slice(2).replace(/-/g, ".")}</span>
              </span>
              <span className="ph-cand-amt mono-number">{won(c.amt)}</span>
              <button type="button" className="ph-cand-go" disabled={!!bundling} onClick={() => bundleCandidate(c)}>
                {bundling === c.partnerId ? "만드는 중…" : "프로젝트로 묶기"}
              </button>
              <button type="button" className="ph-cand-hide" title="이 거래처는 제안하지 않기" onClick={() => hideCandidate(c.partnerId)}>숨기기</button>
            </div>
          ))}
        </section>
      )}

      {/* 조용한 프로젝트 한 줄 체크인 — 주 1회·최대 3건. 대상이 없으면 아무것도 그리지 않는다.
          접혀 있어도 마운트는 한다 — 위 한 줄에 개수를 띄우려면 판정이 돌아야 한다. */}
      {companyId && (
        <QuietCheckins
          companyId={companyId} userId={userId}
          deals={topDeals as any[]} tasks={tasksRows as any[]}
          outstandingOf={(id) => outstandingByDeal[id] || 0}
          won={won} toast={toast}
          open={nudge === "quiet"} onCount={setQuietCount} />
      )}

      {/* 성과 대시보드 — 사람별·부서별·입력률 집계. 유형 폐지로 전 프로젝트 대상이 됐다 */}
      {showDashboard && companyId && (
        <PerformanceDashboard companyId={companyId} onClose={() => setShowDashboard(false)} />
      )}

      {/* 만들면 바로 '표' 탭으로 — 이름만 받고 템플릿 고르기로 넘긴다(2026-08-03 기획 v2) */}
      {showCreate && companyId && (
        <ProjectFormModal
          companyId={companyId}
          partners={partners as any[]}
          users={users as any[]}
          onClose={() => setShowCreate(false)}
          onSaved={(id) => { setShowCreate(false); qc.invalidateQueries({ queryKey: ["projecthub-deals"] }); if (id) router.push(`/projecthub/${id}?tab=boards&new=1`); }}
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

      {/* 보드 보기 — 회사 전체 프로젝트를 커스텀 컬럼으로. 검색·렌즈·정렬은 보드 자체 툴바가
          담당하므로 여기서는 그대로 임베드한다(구 실행형 상세 '워크플로우' 탭과 동일 컴포넌트). */}
      {listView === "board" && companyId ? (
        <MondayBoard companyId={companyId} users={users as any} />
      ) : isLoading ? (
        <div className="glass-card p-10 text-center text-sm text-[var(--text-muted)]">불러오는 중...</div>
      ) : rows.length === 0 ? (
        /* 빈 상태 — 신규 사용자가 가장 먼저 보는 화면. 검색·필터 때문에 빈 것과
           진짜 아무것도 없는 것을 구분한다(구분 없이 안내하면 있는데 없다고 읽힌다). */
        /* 열람 범위 권한이 없으면(내 담당만 보이는 직원) 회사에 프로젝트가 있어도 목록이 빈다 —
           그 경우 '첫 프로젝트를 만들어 보세요' 는 사실과 다르므로 필터 안내 쪽으로 보낸다. */
        search || mineOnly || !canViewAllProjects ? (
          <div className="glass-card py-14 flex flex-col items-center justify-center text-center gap-2">
            <div className="text-4xl">🔍</div>
            <div className="text-sm font-semibold text-[var(--text)]">
              {search ? "조건에 맞는 프로젝트가 없어요." : "내가 담당한 프로젝트가 없어요."}
            </div>
            {/* '전체 보기' 유도는 전체 열람 권한자에게만 — 없으면 눌러도 결과가 같다 */}
            {mineOnly && canViewAllProjects && (
              <button onClick={() => setMineOnly(false)} className="btn-secondary btn-sm mt-2">전체 프로젝트 보기 →</button>
            )}
          </div>
        ) : (
          <div className="ph-onboard glass-card">
            <div className="ph-onboard-head">
              <h3>첫 프로젝트를 만들어 보세요</h3>
              <p>이름만 적으면 만들어져요. 아래는 만든 다음에 필요할 때 하나씩 채우면 되는 것들이에요.</p>
            </div>
            <div className="ph-onboard-steps">
              <div className="ph-onboard-step">
                <b>매출·비용</b>
                <span>견적서를 만들면 공급가·부가세가 자동 계산되고, 승인되면 계약서 초안까지 만들어져요. 계산서·입금까지 이어져 마진과 미수가 저절로 잡혀요.</span>
              </div>
              <div className="ph-onboard-step">
                <b>업무</b>
                <span>할 일을 적고 담당을 지정하면 진행률이 자동으로 계산돼요. 칸반·간트로 보고, 마감이 지나면 알려줘요.</span>
              </div>
              <div className="ph-onboard-step">
                <b>목표·실적</b>
                <span>매출·건수 같은 목표를 정하면 실적이 회계 데이터에서 자동으로 채워지고, 이번 주 요약 초안까지 만들어져요.</span>
              </div>
            </div>
            <button onClick={() => setShowCreate(true)} className="btn-primary">+ 프로젝트 만들기</button>
            <p className="ph-onboard-note">유형을 고르지 않아요 — 필요한 것만 쓰면 그 자리가 저절로 생겨요.</p>
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
      ) : listView === "people" ? (
        <PeopleView rows={rows as any[]}
          statusOf={(d: any) => statusOf(d)}
          progressOf={(d: any) => (headlineByDeal[d.id]?.raw != null ? headlineByDeal[d.id].pct : null)}
          outstandingOf={(id) => outstandingByDeal[id] || 0}
          userName={(id) => userName[id || ""] || ""}
          won={won}
          onOpen={(id) => router.push(`/projecthub/${id}`)} />
      ) : (
        /* 한 리스트로 본다 — 같은 프로젝트를 위(카드)와 아래(표)로 나누니 헷갈렸다
           (2026-08-03 사장님 지적). 대신 행마다 상태 줄무늬와 '확인 사항' 코멘트를 붙여
           지연·미수를 그 자리에서 읽게 한다. */
        <div className="ph-table-wrap">
          <table className="ph-table">
            <thead>
              <tr>
                <th>프로젝트</th><th>표</th><th>담당</th><th>상태</th><th className="ph-table-n">입력</th>
                <th>확인 사항</th><th>마지막 입력</th><th />
              </tr>
            </thead>
            <tbody>
              {rows.map((d: any) => {
                const r = rollupByDeal[d.id];
                const key = listStatusOfDeal(d);
                const reasons = listReasons(r || { boardCount: 0, boardNames: [], itemCount: 0, quietDays: null, lateCount: 0, soonCount: 0, doneRate: null });
                return (
                  <tr key={d.id} onClick={() => { if (openMenu) { setOpenMenu(null); return; } router.push(`/projecthub/${d.id}`); }}
                    className={`ph-table-row ph-row-${key}`}>
                    <td>
                      <b>{d.name || "(이름 없음)"}</b>
                      {childCount[d.id] > 0 && <span className="ph-sub-badge">하위 {childCount[d.id]}</span>}
                      {partnerName[d.partner_id] && <span className="ph-table-partner">{partnerName[d.partner_id]}</span>}
                    </td>
                    <td>
                      {r && r.boardCount > 0
                        ? <span className="ph-reasons">{r.boardNames.slice(0, 3).map((n) => <span key={n} className="ph-reason ph-reason-dim">{n}</span>)}{r.boardCount > 3 && <span className="ph-reason ph-reason-dim">+{r.boardCount - 3}</span>}</span>
                        : <span className="ph-table-dim">없음</span>}
                    </td>
                    <td className="ph-table-dim">{userName[d.internal_manager_id] || "—"}</td>
                    <td><span className={`ph-st ph-st-${key}`}>{LIST_STATUS_LABEL[key]}</span></td>
                    <td className="ph-table-n">
                      {r && r.itemCount > 0
                        ? <>{r.itemCount}행{r.doneRate != null && <span className="ph-table-dim"> · {r.doneRate}%</span>}</>
                        : "—"}
                    </td>
                    <td>
                      {reasons.length === 0 ? <span className="ph-table-dim">특이사항 없음</span> : (
                        <span className="ph-reasons">
                          {reasons.map((x) => <span key={x.text} className={`ph-reason ph-reason-${x.tone}`}>{x.text}</span>)}
                        </span>
                      )}
                    </td>
                    <td className="ph-table-dim">{r?.quietDays == null ? "—" : r.quietDays === 0 ? "오늘" : `${r.quietDays}일 전`}</td>
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

      {listView !== "board" && (
        <p className="text-[11px] text-[var(--text-dim)]">※ 대표 지표는 그 프로젝트에 있는 데이터에서 자동으로 골라요 — 돈이 걸렸으면 마진율, 목표가 있으면 달성률, 할 일만 있으면 진행률.</p>
      )}
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
  const [showMore, setShowMore] = useState(isEdit);
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
                <p className="text-[11px] text-[var(--text-dim)] mt-1">이름만 있으면 만들 수 있어요. 나머지는 나중에 채워도 돼요.</p>
              </div>
              {!showMore && (
                <button type="button" onClick={() => setShowMore(true)} className="project-form-more">
                  ＋ 거래처·담당·기간·금액 넣기 <span>선택 — 지금 몰라도 돼요</span>
                </button>
              )}
              {showMore && <>
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
