"use client";

// PR2: /projects 신설 — /deals 와 병행. 칸반(기본) + 리스트 토글.
//   - 데이터: deals.stage (5-enum) 만 사용. 기존 deals 무수정.
//   - 카드 6요소: 프로젝트명·고객사·계약금액·기한·대표담당자·상태배지 1개.
//   - 단계 변경: 카드 클릭 → 라디오 모달 (DnD 외부 패키지 미사용).
//   - PR3 가 이어서 슬라이드 패널 붙임. 현재는 deep link /deals/[id] 가능.
//   - 권한: owner/admin only. employee/partner → AccessDenied.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { getCurrentUser, getDeals, getCompanyUsers } from "@/lib/queries";
import { getPartners } from "@/lib/partners";
import { useUser } from "@/components/user-context";
import { AccessDenied } from "@/components/access-denied";
import { ClassificationBadge } from "@/components/classification-badge";
import { useToast } from "@/components/toast";
import { friendlyError, reportError } from "@/lib/friendly-error";
// PR4 lib 사용 (PR2 의 project-badges 는 lib 안에서 재export 됨)
import {
  getProjectBadge,
  getNextAction,
  formatDueLabel,
  STAGE_LABEL as STAGE_LABEL_LIB,
  STAGE_ORDER,
  type ProjectBadge,
  type ProjectStage,
} from "@/lib/project-rules";
import { autoCreatePartnerFromDeal } from "@/lib/partners";

// ── 5-stage enum ──
type Stage = "estimate" | "contract" | "in_progress" | "completed" | "settlement";

const STAGES: { key: Stage; label: string; color: string }[] = [
  { key: "estimate",    label: "견적", color: "#94A3B8" },
  { key: "contract",    label: "계약", color: "#6366F1" },
  { key: "in_progress", label: "진행", color: "#3B82F6" },
  { key: "completed",   label: "완료", color: "#22C55E" },
  { key: "settlement",  label: "정산", color: "#F59E0B" },
];

// stage 라벨은 lib (project-rules) 에서 import — STAGE_LABEL_LIB
const STAGE_LABEL: Record<Stage, string> = STAGE_LABEL_LIB as Record<Stage, string>;

// ── 타입 (deals row + 가공) ──
interface DealRow {
  id: string;
  name: string;
  stage: Stage | string | null;
  contract_total: number | null;
  end_date: string | null;
  start_date: string | null;
  partner_id: string | null;
  company_id: string | null;
  status: string | null;
  created_at: string | null;
  classification?: string | null; // B2B / B2C / B2G (자유 text, 기본 B2B)
}

interface PartnerLite { id: string; name: string }
interface UserLite { id: string; name: string | null; email: string }

interface AssignmentLite { deal_id: string; user_id: string; role: string | null; is_active: boolean | null }

interface ProjectCard extends DealRow {
  partnerName: string;
  managerName: string;
  badge: ProjectBadge;
}

// 기간 필터 — null 이면 전체 표시, 아니면 [from, to] 범위와 겹치는 deal 만
export type DateFilter = { from: Date; to: Date; label: string } | null;


function dealInPeriod(deal: { start_date?: string | null; end_date?: string | null; created_at?: string | null }, filter: DateFilter): boolean {
  if (!filter) return true;
  const startStr = deal.start_date || deal.created_at;
  const endStr = deal.end_date;
  const start = startStr ? new Date(startStr) : new Date(0);
  // end_date 없으면 진행 중 → 무한대
  const end = endStr ? new Date(endStr) : new Date(8640000000000000);
  return start <= filter.to && end >= filter.from;
}

function parsePeriod(sp: URLSearchParams): DateFilter {
  const period = sp.get("period");
  const yearStr = sp.get("year");
  const year = yearStr ? Number(yearStr) : new Date().getFullYear();
  if (period === "year" && year) {
    return { from: new Date(year, 0, 1), to: new Date(year, 11, 31, 23, 59, 59), label: `${year}년` };
  }
  if (period === "quarter") {
    const q = Number(sp.get("q") || 1);
    if (q >= 1 && q <= 4) {
      const startM = (q - 1) * 3;
      return { from: new Date(year, startM, 1), to: new Date(year, startM + 3, 0, 23, 59, 59), label: `${year} Q${q}` };
    }
  }
  if (period === "month") {
    const m = Number(sp.get("m") || 1);
    if (m >= 1 && m <= 12) {
      return { from: new Date(year, m - 1, 1), to: new Date(year, m, 0, 23, 59, 59), label: `${year}-${String(m).padStart(2, '0')}` };
    }
  }
  const fromStr = sp.get("from");
  const toStr = sp.get("to");
  if (fromStr && toStr) {
    return { from: new Date(fromStr), to: new Date(toStr + "T23:59:59"), label: `${fromStr} ~ ${toStr}` };
  }
  return null;
}

export default function ProjectsPage() {
  const { role, loading } = useUser();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  // 2026-05-22 하위호환: 옛 ?deal=<id> 딥링크 → 새 상세 페이지 /projects/<id> 로 리다이렉트
  const legacyDeal = searchParams.get("deal");
  useEffect(() => {
    if (legacyDeal) {
      const action = searchParams.get("action");
      router.replace(action ? `/projects/${legacyDeal}?action=${action}` : `/projects/${legacyDeal}`);
    }
  }, [legacyDeal, searchParams, router]);

  // ── 새 프로젝트 모달: state 단일 소스. URL ?create 의존 제거.
  //   2026-05-22 핫픽스: 기존엔 "+ 새 프로젝트"가 ?create=1 로 URL push → period 파라미터가 날아가
  //   ProjectsInner→PeriodPicker 분기가 뒤집히며 모달이 언마운트(깜빡임 후 사라짐)되었다.
  //   이제 모달은 분기보다 위(ProjectsPage)에 마운트 → 어느 화면에서 열든 안 사라진다.
  const [showCreate, setShowCreate] = useState(false);
  const [companyId, setCompanyId] = useState<string | null>(null);
  useEffect(() => { getCurrentUser().then((u) => { if (u) setCompanyId(u.company_id); }); }, []);
  // ?create=1 딥링크 1회 수용 후 URL 정리 (state 로 전환).
  useEffect(() => {
    if (searchParams.get("create") === "1") {
      setShowCreate(true);
      const sp = new URLSearchParams(searchParams.toString());
      sp.delete("create");
      const qs = sp.toString();
      router.replace(qs ? `/projects?${qs}` : "/projects", { scroll: false });
    }
  }, [searchParams, router]);

  if (loading) return <div className="p-8 text-sm text-[var(--text-muted)]">로딩 중...</div>;
  if (role !== "owner" && role !== "admin" && role !== "employee") {
    return <AccessDenied detail="프로젝트 메뉴는 대표/관리자/구성원만 접근할 수 있습니다." />;
  }
  const isEmployeeLimited = role === "employee";
  const dateFilter = parsePeriod(new URLSearchParams(searchParams.toString()));
  // ?deal= 리다이렉트 중에는 빈 화면 (useEffect 가 곧 replace)
  if (legacyDeal) {
    return <div className="p-8 text-sm text-[var(--text-muted)]">이동 중...</div>;
  }

  const createModal = showCreate && companyId ? (
    <NewProjectModal
      companyId={companyId}
      onClose={() => setShowCreate(false)}
      onCreated={() => {
        queryClient.invalidateQueries({ queryKey: ["deals"] });
        queryClient.invalidateQueries({ queryKey: ["projects-cards"] });
        queryClient.invalidateQueries({ queryKey: ["partners"] });
        toast("프로젝트가 생성되었습니다", "success");
        setShowCreate(false);
      }}
    />
  ) : null;

  // 2026-05-26 사장님 요청: 기본 진입 = 전체기간 칸반(기간 선택기 먼저 X).
  //   ?period=picker 로 명시 진입할 때만 PeriodPicker. dateFilter=null = 전체기간(dealInPeriod 미적용).
  //   ?period=year&year=.. 등은 그 기간 칸반. 기간 선택기는 헤더 "기간 선택" 버튼으로 접근 유지.
  const showPicker = searchParams.get("period") === "picker";
  return (
    <>
      {showPicker
        ? <PeriodPicker isEmployeeLimited={isEmployeeLimited} onCreate={() => setShowCreate(true)} />
        : <ProjectsInner isEmployeeLimited={isEmployeeLimited} dateFilter={dateFilter} onCreate={() => setShowCreate(true)} />}
      {createModal}
    </>
  );
}

function ProjectsInner({ isEmployeeLimited = false, dateFilter = null, onCreate }: { isEmployeeLimited?: boolean; dateFilter?: DateFilter; onCreate: () => void }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [companyId, setCompanyId] = useState<string | null>(null);
  useEffect(() => { getCurrentUser().then((u) => { if (u) setCompanyId(u.company_id); }); }, []);

  // ── URL ?deal=<id>&action=<key> → 슬라이드 패널 (PR3.5) ──
  //   action 쿼리는 패널이 1회 적용 후 자동 클리어 (router.replace, history 안 늘림).
  const dealParam = searchParams.get("deal");
  const actionParam = searchParams.get("action");
  // 2026-05-22 슬라이드 패널 → 독립 페이지(/projects/[id])로 이동.
  function openSlide(dealId: string, action?: string) {
    router.push(action ? `/projects/${dealId}?action=${action}` : `/projects/${dealId}`);
  }
  function closeSlide() {
    const sp = new URLSearchParams(searchParams.toString());
    sp.delete("deal");
    sp.delete("action");
    const qs = sp.toString();
    router.push(qs ? `/projects?${qs}` : "/projects", { scroll: false });
  }
  // PR3.5: action 1회 적용 후 URL 클리어 (open 은 유지).
  //   pendingAction 상태로 전달 후, useEffect 가 action 만 URL 에서 제거.
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  useEffect(() => {
    if (actionParam) {
      setPendingAction(actionParam);
      const sp = new URLSearchParams(searchParams.toString());
      sp.delete("action");
      const qs = sp.toString();
      router.replace(qs ? `/projects?${qs}` : "/projects", { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionParam]);

  // ── 데이터 ──
  //   employee 는 get_my_assigned_deals RPC 로 본인 담당딜만 (SECDEF, 재무 컬럼 미반환)
  //   owner/admin 은 getDeals 전사 fetch
  const { data: deals = [], isLoading: dealsLoading } = useQuery({
    queryKey: ["projects-deals", companyId, isEmployeeLimited ? "limited" : "full"],
    queryFn: async () => {
      if (isEmployeeLimited) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data } = await (supabase as any).rpc("get_my_assigned_deals");
        return (data || []) as DealRow[];
      }
      return getDeals(companyId!);
    },
    enabled: !!companyId,
  });

  const { data: partners = [] } = useQuery<PartnerLite[]>({
    queryKey: ["projects-partners", companyId],
    queryFn: async () => {
      const rows = await getPartners(companyId!);
      return (rows as Array<{ id: string; name: string }>).map((p) => ({ id: p.id, name: p.name }));
    },
    enabled: !!companyId,
  });

  const { data: users = [] } = useQuery<UserLite[]>({
    queryKey: ["projects-users", companyId],
    queryFn: async () => {
      const rows = await getCompanyUsers(companyId!);
      return (rows as Array<{ id: string; name: string | null; email: string }>).map((u) => ({ id: u.id, name: u.name, email: u.email }));
    },
    enabled: !!companyId,
  });

  // deal_assignments — 대표 담당자 1명 산출용 (role='manager' 우선)
  const { data: assignments = [] } = useQuery<AssignmentLite[]>({
    queryKey: ["projects-assignments", companyId, deals.length],
    queryFn: async () => {
      const dealIds = (deals as DealRow[]).map((d) => d.id);
      if (dealIds.length === 0) return [];
      const { data, error } = await supabase
        .from("deal_assignments")
        .select("deal_id, user_id, role, is_active")
        .in("deal_id", dealIds)
        .eq("is_active", true);
      if (error) { reportError("projects.assignments", error); return []; }
      return (data || []) as AssignmentLite[];
    },
    enabled: !!companyId && deals.length > 0,
  });

  // ── 매핑 인덱스 ──
  const partnerMap = useMemo(() => {
    const m = new Map<string, string>();
    partners.forEach((p) => m.set(p.id, p.name));
    return m;
  }, [partners]);

  const userMap = useMemo(() => {
    const m = new Map<string, string>();
    users.forEach((u) => m.set(u.id, u.name || u.email));
    return m;
  }, [users]);

  const managerByDeal = useMemo(() => {
    const m = new Map<string, string>(); // deal_id → user_id
    // role=manager 먼저 채우고, 비어있으면 첫 assignee 로
    assignments.forEach((a) => {
      if (a.role === "manager" && !m.has(a.deal_id)) m.set(a.deal_id, a.user_id);
    });
    assignments.forEach((a) => {
      if (!m.has(a.deal_id)) m.set(a.deal_id, a.user_id);
    });
    return m;
  }, [assignments]);

  // ── 가공: 카드 목록 ──
  const cards: ProjectCard[] = useMemo(() => {
    return (deals as DealRow[])
      // 기간 필터 적용 (사장님 요청 2026-05-21): dateFilter 와 활성 구간 겹치는 deal 만
      .filter((d) => dealInPeriod(d, dateFilter))
      .map((d) => {
        const managerId = managerByDeal.get(d.id);
        const badge = getProjectBadge({
          stage: d.stage,
          end_date: d.end_date,
          contract_total: d.contract_total,
        });
        return {
          ...d,
          partnerName: d.partner_id ? (partnerMap.get(d.partner_id) || "—") : "—",
          managerName: managerId ? (userMap.get(managerId) || "—") : "—",
          badge,
        };
      });
  }, [deals, partnerMap, userMap, managerByDeal, dateFilter]);

  // ── 검색/필터 state ──
  const [search, setSearch] = useState("");
  const [filterDue, setFilterDue] = useState<"all" | "soon">("all");
  const [filterAmount, setFilterAmount] = useState<"all" | "1m" | "10m">("all");
  const [filterManager, setFilterManager] = useState<string>("");
  const [filterPartner, setFilterPartner] = useState<string>("");
  const [filterClass, setFilterClass] = useState<string>("all"); // 전체 / B2B / B2C / B2G
  const [view, setView] = useState<"kanban" | "list">("kanban");
  const [chipDetail, setChipDetail] = useState<"count" | "contract" | "revenue" | "cost" | "margin" | "done" | null>(null); // 요약 칩 출처 팝업

  // 필터 적용
  const filteredCards: ProjectCard[] = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return cards.filter((c) => {
      if (search && !c.name.toLowerCase().includes(search.toLowerCase())) return false;
      if (filterPartner && c.partner_id !== filterPartner) return false;
      if (filterClass !== "all" && (c.classification || "B2B").toUpperCase() !== filterClass) return false;
      if (filterManager) {
        const mid = managerByDeal.get(c.id);
        if (mid !== filterManager) return false;
      }
      if (filterAmount === "1m" && (c.contract_total ?? 0) <= 1_000_000) return false;
      if (filterAmount === "10m" && (c.contract_total ?? 0) <= 10_000_000) return false;
      if (filterDue === "soon") {
        if (!c.end_date) return false;
        const end = new Date(c.end_date); end.setHours(0, 0, 0, 0);
        const diff = Math.floor((end.getTime() - today.getTime()) / 86400000);
        if (diff < 0 || diff > 7) return false;
      }
      return true;
    });
  }, [cards, search, filterDue, filterAmount, filterManager, filterPartner, filterClass, managerByDeal]);

  // ── 단계 변경 모달 ──
  const [stageModal, setStageModal] = useState<{ deal: ProjectCard } | null>(null);
  const [stageDraft, setStageDraft] = useState<Stage>("estimate");

  const updateStageMut = useMutation({
    mutationFn: async ({ dealId, newStage }: { dealId: string; newStage: Stage }) => {
      // deals.stage 만 변경 — 기존 deals 테이블·RLS 그대로 사용 (lean-os PR2).
      // supabase 클라이언트 타입 deep instantiation 회피 위해 any 캐스트 (기존 /deals 패턴과 동일).
      const { error } = await (supabase as unknown as { from: (t: string) => { update: (v: Record<string, unknown>) => { eq: (c: string, v: string) => Promise<{ error: { message?: string } | null }> } } })
        .from("deals")
        .update({ stage: newStage })
        .eq("id", dealId);
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      toast("단계가 변경되었습니다", "success");
      setStageModal(null);
      queryClient.invalidateQueries({ queryKey: ["projects-deals", companyId] });
      // 슬라이드 패널 detail 캐시도 invalidate (열려 있으면 갱신)
      queryClient.invalidateQueries({ queryKey: ["project-detail", vars.dealId] });
    },
    onError: (err) => {
      reportError("projects.updateStage", err);
      toast(friendlyError(err, "단계 변경에 실패했습니다"), "error");
    },
  });

  function openStageModal(card: ProjectCard) {
    setStageModal({ deal: card });
    setStageDraft((card.stage as Stage) || "estimate");
  }

  // ── 칸반 컬럼 그룹화 ──
  const byStage: Record<Stage, ProjectCard[]> = useMemo(() => {
    const out: Record<Stage, ProjectCard[]> = {
      estimate: [], contract: [], in_progress: [], completed: [], settlement: [],
    };
    filteredCards.forEach((c) => {
      const s = (c.stage as Stage) || "estimate";
      if (out[s]) out[s].push(c);
      else out.estimate.push(c);
    });
    return out;
  }, [filteredCards]);

  // 2026-05-22 기간 칸반 요약 — 기간 필터된 cards 기준 client 집계 (추가 fetch 0).
  const summary = useMemo(() => {
    const byStageCount: Record<string, number> = {};
    let total = 0;
    for (const c of cards) {
      const st = c.stage || "estimate";
      byStageCount[st] = (byStageCount[st] || 0) + 1;
      total += c.contract_total ?? 0;
    }
    const doneCount = (byStageCount["completed"] || 0) + (byStageCount["settlement"] || 0);
    return { count: cards.length, total, byStageCount, doneCount };
  }, [cards]);

  // 2026-05-22 정밀 수익/비용/마진 — 기간 cards 의 deal 들에 대해 실입금(수금)·실비용 집계.
  //   직원(재무 가림)에겐 fetch·표시 안 함. 기간 바뀌면 dealIds 변경으로 자동 갱신.
  const dealIds = useMemo(() => cards.map((c) => c.id), [cards]);
  const { data: periodPnl } = useQuery({
    queryKey: ["projects-period-pnl", companyId, dealIds],
    queryFn: async () => {
      if (!companyId || dealIds.length === 0) return { revenue: 0, cost: 0 };
      const idSet = new Set(dealIds);
      const [revRes, costRes] = await Promise.all([
        (supabase as any)
          .from("deal_revenue_schedule")
          .select("deal_id, amount")
          .in("deal_id", dealIds)
          .eq("status", "paid"),
        (supabase as any)
          .from("deal_cost_schedule")
          .select("amount, deal_nodes:deal_node_id(deal_id), sub_deals:sub_deal_id(parent_deal_id)")
          .eq("company_id", companyId),
      ]);
      const revenue = ((revRes.data || []) as any[]).reduce((s, r) => s + Number(r.amount || 0), 0);
      const cost = ((costRes.data || []) as any[]).reduce((s, r) => {
        const did = r.deal_nodes?.deal_id || r.sub_deals?.parent_deal_id;
        return did && idSet.has(did) ? s + Number(r.amount || 0) : s;
      }, 0);
      return { revenue, cost };
    },
    // 2026-05-26 전체기간(dateFilter=null)에도 수익/비용/마진 칩 표시 — dealIds 기준 집계라 기간 무관.
    enabled: !!companyId && !isEmployeeLimited && dealIds.length > 0,
    staleTime: 60_000,
  });

  return (
    <div className="p-4 sm:p-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3 mb-5">
        <div>
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h1 className="text-2xl font-extrabold text-[var(--text)]">프로젝트</h1>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--primary)]/15 text-[var(--primary)] font-semibold">신규</span>
            {dateFilter ? (
              <>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 font-semibold">
                  📅 {dateFilter.label}
                </span>
                <button
                  onClick={() => router.push("/projects")}
                  className="text-[10px] text-[var(--primary)] hover:underline font-semibold"
                >
                  전체 기간으로
                </button>
              </>
            ) : (
              <>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--bg-surface)] text-[var(--text-muted)] font-semibold">
                  📅 전체 기간
                </span>
                <button
                  onClick={() => router.push("/projects?period=picker")}
                  className="text-[10px] text-[var(--primary)] hover:underline font-semibold"
                >
                  기간 선택
                </button>
              </>
            )}
          </div>
          <p className="text-xs text-[var(--text-muted)]">
            {dateFilter
              ? `${dateFilter.from.toISOString().slice(0,10)} ~ ${dateFilter.to.toISOString().slice(0,10)} 활성 프로젝트만 표시`
              : "전체 기간 · 5단계 칸반·리스트로 진행 상태를 한눈에"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCreate}
            className="px-3 py-2 text-xs font-semibold rounded-xl bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white transition"
          >
            + 새 프로젝트
          </button>
        </div>
      </div>

      {/* 요약 칩 — 전체기간/특정기간 모두 표시. 직원은 금액 가림(건수·단계만). 클릭 시 출처·계산식 팝업 */}
      {summary.count > 0 && (
        <div className="flex flex-wrap items-stretch gap-2 mb-4">
          <button type="button" onClick={() => setChipDetail("count")} title="현재 보이는 프로젝트 건수 — 클릭하면 단계별 분포·출처" className="text-left rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] px-3 py-2 hover:border-[var(--primary)]/50 transition cursor-pointer">
            <div className="text-[10px] text-[var(--text-dim)] uppercase tracking-wide">총 계약 ⓘ</div>
            <div className="text-base font-extrabold text-[var(--text)] tabular-nums">{summary.count}건</div>
          </button>
          {!isEmployeeLimited && (
            <button type="button" onClick={() => setChipDetail("contract")} title="프로젝트 계약금액 합계 — 클릭하면 출처·상위 프로젝트" className="text-left rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] px-3 py-2 hover:border-[var(--primary)]/50 transition cursor-pointer">
              <div className="text-[10px] text-[var(--text-dim)] uppercase tracking-wide">총 계약금액 ⓘ</div>
              <div className="text-base font-extrabold text-[var(--text)] tabular-nums">₩{summary.total.toLocaleString("ko-KR")}</div>
            </button>
          )}
          {/* 정밀 수익/비용/마진 — 직원 가림 */}
          {!isEmployeeLimited && periodPnl && (() => {
            const margin = periodPnl.revenue - periodPnl.cost;
            const marginPct = periodPnl.revenue > 0 ? Math.round((margin / periodPnl.revenue) * 100) : 0;
            return (
              <>
                <button type="button" onClick={() => setChipDetail("revenue")} title="수금 완료 금액 합계 — 클릭하면 출처" className="text-left rounded-xl bg-cyan-500/8 border border-cyan-500/20 px-3 py-2 hover:border-cyan-500/50 transition cursor-pointer">
                  <div className="text-[10px] text-cyan-500/80 uppercase tracking-wide">총 수익(수금) ⓘ</div>
                  <div className="text-base font-extrabold text-cyan-500 tabular-nums">₩{periodPnl.revenue.toLocaleString("ko-KR")}</div>
                </button>
                <button type="button" onClick={() => setChipDetail("cost")} title="비용+외주비 합계 — 클릭하면 출처" className="text-left rounded-xl bg-rose-500/8 border border-rose-500/20 px-3 py-2 hover:border-rose-500/50 transition cursor-pointer">
                  <div className="text-[10px] text-rose-500/80 uppercase tracking-wide">총 비용 ⓘ</div>
                  <div className="text-base font-extrabold text-rose-500 tabular-nums">₩{periodPnl.cost.toLocaleString("ko-KR")}</div>
                </button>
                <button type="button" onClick={() => setChipDetail("margin")} title="총 수익 − 총 비용 — 클릭하면 계산식" className={`text-left rounded-xl px-3 py-2 border transition cursor-pointer ${margin >= 0 ? "bg-emerald-500/8 border-emerald-500/20 hover:border-emerald-500/50" : "bg-rose-500/8 border-rose-500/20 hover:border-rose-500/50"}`}>
                  <div className={`text-[10px] uppercase tracking-wide ${margin >= 0 ? "text-emerald-500/80" : "text-rose-500/80"}`}>마진 · 마진율 ⓘ</div>
                  <div className={`text-base font-extrabold tabular-nums ${margin >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
                    ₩{margin.toLocaleString("ko-KR")} <span className="text-xs">({marginPct}%)</span>
                  </div>
                </button>
              </>
            );
          })()}
          <button type="button" onClick={() => setChipDetail("done")} title="완료·정산 건수 — 클릭하면 출처" className="text-left rounded-xl bg-emerald-500/8 border border-emerald-500/20 px-3 py-2 hover:border-emerald-500/50 transition cursor-pointer">
            <div className="text-[10px] text-emerald-500/80 uppercase tracking-wide">완료·정산 ⓘ</div>
            <div className="text-base font-extrabold text-emerald-500 tabular-nums">{summary.doneCount}건</div>
          </button>
          {/* 단계별 분포 — 표시만 */}
          <div className="flex flex-wrap items-center gap-1.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] px-3 py-2">
            {STAGE_ORDER.map((s) => {
              const n = summary.byStageCount[s] || 0;
              return (
                <span key={s} className={`text-[11px] whitespace-nowrap ${n > 0 ? "text-[var(--text)]" : "text-[var(--text-dim)]"}`}>
                  {STAGE_LABEL[s as Stage] || s} <span className="font-bold tabular-nums">{n}</span>
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* 요약 칩 출처·계산식 팝업 — 비전공자도 "어디서 어떻게 나온 값"인지 알게 */}
      {chipDetail && (() => {
        const stageLabels = STAGE_ORDER.map((s) => `${STAGE_LABEL[s as Stage] || s} ${summary.byStageCount[s] || 0}`).join(" · ");
        const topContract = [...cards].sort((a, b) => (b.contract_total ?? 0) - (a.contract_total ?? 0)).slice(0, 5);
        const margin = periodPnl ? periodPnl.revenue - periodPnl.cost : 0;
        const marginPct = periodPnl && periodPnl.revenue > 0 ? Math.round((margin / periodPnl.revenue) * 100) : 0;
        const INFO = {
          count: {
            title: "총 계약 (건수)",
            desc: "현재 화면에 보이는 프로젝트의 개수입니다. (선택한 기간·필터 기준)",
            formula: `프로젝트 ${summary.count}건`,
            extra: <div className="text-[11px] text-[var(--text-muted)]">단계별 분포: {stageLabels}</div>,
          },
          contract: {
            title: "총 계약금액",
            desc: `프로젝트 ${summary.count}건에 입력된 계약금액을 모두 더한 값입니다.`,
            formula: `프로젝트 계약금액 합계 = ₩${summary.total.toLocaleString("ko-KR")}`,
            extra: topContract.length > 0 ? (
              <div className="space-y-1">
                <div className="text-[10px] text-[var(--text-dim)] uppercase tracking-wide">상위 기여 프로젝트</div>
                {topContract.map((c) => (
                  <div key={c.id} className="flex justify-between text-[11px]">
                    <span className="truncate mr-2 text-[var(--text-muted)]">{c.name}</span>
                    <span className="tabular-nums font-semibold text-[var(--text)]">₩{(c.contract_total ?? 0).toLocaleString("ko-KR")}</span>
                  </div>
                ))}
              </div>
            ) : null,
          },
          revenue: {
            title: "총 수익 (수금)",
            desc: "실제로 입금이 완료된 금액의 합계입니다. 수금 일정 중 '완료(paid)' 처리된 것만 더합니다.",
            formula: `수금 완료액 합계 = ₩${(periodPnl?.revenue ?? 0).toLocaleString("ko-KR")}`,
            extra: null as React.ReactNode,
          },
          cost: {
            title: "총 비용",
            desc: "프로젝트에 들어간 비용과 외주비(하도급)의 합계입니다.",
            formula: `프로젝트 비용 + 외주비 = ₩${(periodPnl?.cost ?? 0).toLocaleString("ko-KR")}`,
            extra: null as React.ReactNode,
          },
          margin: {
            title: "마진 · 마진율",
            desc: "총 수익에서 총 비용을 뺀, 실제로 남는 돈입니다. 마진율은 수익 대비 남는 비율입니다.",
            formula: `₩${(periodPnl?.revenue ?? 0).toLocaleString("ko-KR")} − ₩${(periodPnl?.cost ?? 0).toLocaleString("ko-KR")} = ₩${margin.toLocaleString("ko-KR")} (마진율 ${marginPct}%)`,
            extra: null as React.ReactNode,
          },
          done: {
            title: "완료 · 정산",
            desc: "마무리된 프로젝트 수입니다. 완료 단계와 정산 단계를 합칩니다.",
            formula: `완료 ${summary.byStageCount["completed"] || 0}건 + 정산 ${summary.byStageCount["settlement"] || 0}건 = ${summary.doneCount}건`,
            extra: null as React.ReactNode,
          },
        };
        const info = INFO[chipDetail];
        if (!info) return null;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setChipDetail(null)}>
            <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl w-full max-w-sm max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
                <div className="text-sm font-bold text-[var(--text)]">{info.title}</div>
                <button onClick={() => setChipDetail(null)} className="text-[var(--text-muted)] hover:text-[var(--text)] text-xl leading-none">✕</button>
              </div>
              <div className="p-5 space-y-3">
                <p className="text-xs text-[var(--text-muted)] leading-relaxed">{info.desc}</p>
                <div className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] px-3 py-2.5">
                  <div className="text-[10px] text-[var(--text-dim)] uppercase tracking-wide mb-1">계산식</div>
                  <div className="text-xs font-semibold text-[var(--text)] tabular-nums break-keep">{info.formula}</div>
                </div>
                {info.extra}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Filter Bar */}
      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-3 mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="프로젝트명 검색"
            className="flex-1 min-w-[180px] px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-xs focus:outline-none focus:border-[var(--primary)]"
          />
          <select
            value={filterDue}
            onChange={(e) => setFilterDue(e.target.value as "all" | "soon")}
            className="px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-xs focus:outline-none"
          >
            <option value="all">기한 전체</option>
            <option value="soon">7일 이내 임박</option>
          </select>
          <select
            value={filterAmount}
            onChange={(e) => setFilterAmount(e.target.value as "all" | "1m" | "10m")}
            className="px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-xs focus:outline-none"
          >
            <option value="all">금액 전체</option>
            <option value="1m">100만원 초과</option>
            <option value="10m">1,000만원 초과</option>
          </select>
          <select
            value={filterManager}
            onChange={(e) => setFilterManager(e.target.value)}
            className="px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-xs focus:outline-none max-w-[160px]"
          >
            <option value="">담당자 전체</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.name || u.email}</option>
            ))}
          </select>
          <select
            value={filterPartner}
            onChange={(e) => setFilterPartner(e.target.value)}
            className="px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-xs focus:outline-none max-w-[160px]"
          >
            <option value="">고객사 전체</option>
            {partners.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <select
            value={filterClass}
            onChange={(e) => setFilterClass(e.target.value)}
            className="px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-xs focus:outline-none"
          >
            <option value="all">분류 전체</option>
            <option value="B2B">B2B</option>
            <option value="B2C">B2C</option>
            <option value="B2G">B2G</option>
          </select>
          <div className="ml-auto flex items-center gap-1 bg-[var(--bg)] border border-[var(--border)] rounded-xl p-1">
            <button
              type="button"
              onClick={() => setView("kanban")}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${view === "kanban" ? "bg-[var(--primary)] text-white" : "text-[var(--text-muted)] hover:bg-[var(--bg-surface)]"}`}
            >
              칸반
            </button>
            <button
              type="button"
              onClick={() => setView("list")}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${view === "list" ? "bg-[var(--primary)] text-white" : "text-[var(--text-muted)] hover:bg-[var(--bg-surface)]"}`}
            >
              리스트
            </button>
          </div>
        </div>
      </div>

      {/* Body */}
      {dealsLoading && (
        <div className="text-center py-12 text-sm text-[var(--text-muted)]">불러오는 중...</div>
      )}

      {!dealsLoading && filteredCards.length === 0 && (
        <EmptyState onCreate={onCreate} />
      )}

      {!dealsLoading && filteredCards.length > 0 && view === "kanban" && (
        <KanbanView
          byStage={byStage}
          onCardClick={(c) => openSlide(c.id)}
          onStageMenu={openStageModal}
          onDetail={(id) => openSlide(id)}
        />
      )}

      {!dealsLoading && filteredCards.length > 0 && view === "list" && (
        <ListView
          cards={filteredCards}
          onRowClick={(c) => openSlide(c.id)}
          onInlineStageChange={(dealId, newStage) => updateStageMut.mutate({ dealId, newStage })}
        />
      )}

      {/* Stage 변경 모달 */}
      {stageModal && (
        <StageModal
          card={stageModal.deal}
          draft={stageDraft}
          onDraftChange={setStageDraft}
          onClose={() => setStageModal(null)}
          onConfirm={() => updateStageMut.mutate({ dealId: stageModal.deal.id, newStage: stageDraft })}
          submitting={updateStageMut.isPending}
        />
      )}

      {/* 프로젝트 상세는 독립 페이지 /projects/[id] 로 이동 (슬라이드 패널 제거) */}
      {/* 새 프로젝트 모달은 ProjectsPage 레벨로 승격 (분기 언마운트 방지) */}
    </div>
  );
}

// ── New Project Modal (인라인, /projects ?create=1 진입 시) ──
//   /deals 페이지의 createDeal mutationFn 과 동일 로직.
//   deals 테이블 직접 insert + autoCreatePartnerFromDeal (거래처 자동등록) 재사용.
//   필드: 분류·이름·계약금액(VAT inclusion)·기간·우선순위·거래처.
function NewProjectModal({
  companyId,
  onClose,
  onCreated,
}: {
  companyId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    classification: "B2B" as string,
    name: "",
    contract_total: "",
    start_date: "",
    end_date: "",
    counterparty: "",
    partner_id: null as string | null,
    priority: "medium" as "low" | "medium" | "high" | "urgent",
    vatType: "exclude" as "exclude" | "include",
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  // 거래처 자동완성 (deals/page.tsx searchDealPartners 패턴 미러 — RLS 회사격리 그대로)
  const [partnerResults, setPartnerResults] = useState<Array<{
    id: string; name: string;
    contact_email: string | null; business_number: string | null; contact_phone: string | null;
  }>>([]);
  const [partnerFocused, setPartnerFocused] = useState(false);
  const searchPartners = async (q: string) => {
    if (!companyId || !q.trim()) { setPartnerResults([]); return; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const { data } = await db
      .from('partners')
      .select('id, name, contact_email, business_number, contact_phone')
      .eq('company_id', companyId)
      .ilike('name', `%${q}%`)
      .limit(8);
    setPartnerResults((data || []) as typeof partnerResults);
  };

  const onSubmit = async () => {
    setErr("");
    const rawAmount = Number(form.contract_total);
    if (!form.name.trim()) {
      setErr("프로젝트명을 입력해주세요.");
      return;
    }
    if (!rawAmount || rawAmount <= 0) {
      setErr("계약금액은 1원 이상이어야 합니다.");
      return;
    }
    setSaving(true);
    try {
      const contractAmount = form.vatType === "include" ? Math.round(rawAmount / 1.1) : rawAmount;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = supabase as any;
      const { data: newDeal, error } = await db
        .from("deals")
        .insert({
          company_id: companyId,
          name: form.name.trim(),
          classification: form.classification,
          contract_total: contractAmount,
          status: "active",
          start_date: form.start_date || null,
          end_date: form.end_date || null,
          priority: form.priority,
          // 기존 거래처 선택 시 즉시 매핑 (자동완성 결과 click)
          partner_id: form.partner_id ?? null,
          counterparty: form.counterparty.trim() || null,
        })
        .select()
        .single();
      if (error) throw error;
      // partner_id 매핑 없이 신규 텍스트만 입력 시: 기존 흐름대로 autoCreatePartnerFromDeal
      if (!form.partner_id && form.counterparty.trim() && newDeal) {
        try {
          await autoCreatePartnerFromDeal(companyId, newDeal.id, form.counterparty.trim());
        } catch (e) {
          reportError("projects.new.autoCreatePartner", e);
        }
      }
      onCreated();
    } catch (e) {
      const msg = friendlyError(e, "프로젝트 생성에 실패했습니다.");
      setErr(msg);
      toast(msg, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
          <div className="text-sm font-bold">+ 새 프로젝트</div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text)] text-xl leading-none">✕</button>
        </div>
        <div className="p-5 grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">분류 *</label>
            <select
              value={form.classification}
              onChange={(e) => setForm({ ...form, classification: e.target.value })}
              className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
            >
              <option value="B2B">B2B</option>
              <option value="B2C">B2C</option>
              <option value="B2G">B2G</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">프로젝트명 *</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="예: 수출바우처 - A기업"
              className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
            />
          </div>
          <div className="col-span-2">
            <label className="block text-xs text-[var(--text-muted)] mb-1">계약금액 *</label>
            <div className="flex gap-2">
              <select
                value={form.vatType}
                onChange={(e) => setForm({ ...form, vatType: e.target.value as "exclude" | "include" })}
                className="px-2 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)]"
              >
                <option value="exclude">VAT 별도</option>
                <option value="include">VAT 포함</option>
              </select>
              <input
                type="text"
                inputMode="numeric"
                value={form.contract_total ? Number(form.contract_total).toLocaleString("ko-KR") : ""}
                onChange={(e) => setForm({ ...form, contract_total: e.target.value.replace(/[^\d]/g, "") })}
                placeholder="15,000,000"
                className="flex-1 px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">시작일</label>
            <input
              type="date"
              value={form.start_date}
              onChange={(e) => setForm({ ...form, start_date: e.target.value })}
              className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
            />
          </div>
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">종료일</label>
            <input
              type="date"
              value={form.end_date}
              onChange={(e) => setForm({ ...form, end_date: e.target.value })}
              min={form.start_date || undefined}
              className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
            />
          </div>
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">우선순위</label>
            <select
              value={form.priority}
              onChange={(e) => setForm({ ...form, priority: e.target.value as "low" | "medium" | "high" | "urgent" })}
              className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
            >
              <option value="low">낮음</option>
              <option value="medium">보통</option>
              <option value="high">높음</option>
              <option value="urgent">긴급</option>
            </select>
          </div>
          <div className="relative">
            <label className="block text-xs text-[var(--text-muted)] mb-1">
              거래처명
              {form.partner_id && (
                <span className="ml-2 text-[10px] text-[var(--primary)]">기존 거래처 선택됨</span>
              )}
            </label>
            <input
              value={form.counterparty}
              onChange={(e) => {
                // 직접 편집 시 기존 매핑 해제 (텍스트 신규 거래처 흐름으로 전환)
                setForm({ ...form, counterparty: e.target.value, partner_id: null });
                searchPartners(e.target.value);
              }}
              onFocus={() => setPartnerFocused(true)}
              onBlur={() => setTimeout(() => setPartnerFocused(false), 200)}
              placeholder="거래처명 검색 (입력 후 선택, 없으면 신규 등록)"
              className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
            />
            {partnerFocused && partnerResults.length > 0 && (
              <ul className="absolute top-full left-0 right-0 mt-1 max-h-48 overflow-auto bg-[var(--bg-card)] border border-[var(--border)] rounded-xl z-10 shadow-lg">
                {partnerResults.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setForm((prev) => ({ ...prev, counterparty: p.name, partner_id: p.id }));
                        setPartnerResults([]);
                        setPartnerFocused(false);
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-[var(--bg-surface)] transition"
                    >
                      <div className="text-xs font-semibold">{p.name}</div>
                      {(p.contact_email || p.business_number) && (
                        <div className="text-[10px] text-[var(--text-dim)] mt-0.5">
                          {p.business_number ? p.business_number + (p.contact_email ? ' · ' : '') : ''}
                          {p.contact_email || ''}
                        </div>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {partnerFocused && partnerResults.length === 0 && form.counterparty.trim() && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl z-10 shadow-lg px-3 py-2 text-[10px] text-[var(--primary)]">
                + &ldquo;{form.counterparty}&rdquo; 신규 거래처로 등록 (프로젝트 생성 시 자동 등록)
              </div>
            )}
          </div>
          {err && (
            <div className="col-span-2 text-xs text-red-400">{err}</div>
          )}
        </div>
        <div className="px-5 py-4 border-t border-[var(--border)] flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-[var(--text-muted)] hover:text-[var(--text)] rounded-lg"
          >
            취소
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={saving || !form.name || !form.contract_total || Number(form.contract_total) <= 0}
            className="px-4 py-2 bg-[var(--primary)] hover:bg-[var(--primary-hover)] disabled:opacity-50 text-white rounded-lg text-sm font-semibold"
          >
            {saving ? "생성 중..." : "프로젝트 생성"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── EmptyState ──
function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-10 text-center">
      <div className="text-4xl mb-3">📋</div>
      <h2 className="text-base font-bold text-[var(--text)] mb-1">아직 프로젝트가 없습니다</h2>
      <p className="text-xs text-[var(--text-muted)] mb-5">첫 프로젝트를 만들고 5단계 진행 상태를 한눈에 관리해보세요.</p>
      <button
        type="button"
        onClick={onCreate}
        className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white text-sm font-semibold transition active:scale-[0.98]"
      >
        + 새 프로젝트 만들기
      </button>
    </div>
  );
}

// ── Kanban View ──
function KanbanView({
  byStage,
  onCardClick,
  onStageMenu,
  onDetail,
}: {
  byStage: Record<Stage, ProjectCard[]>;
  onCardClick: (c: ProjectCard) => void;
  onStageMenu: (c: ProjectCard) => void;
  onDetail: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
      {STAGES.map((s) => {
        const cards = byStage[s.key] || [];
        const sum = cards.reduce((acc, c) => acc + (c.contract_total ?? 0), 0);
        return (
          <div key={s.key} className="bg-[var(--bg-surface)] rounded-2xl p-3 min-h-[300px]">
            <div className="flex items-center justify-between mb-3 px-1">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
                <h3 className="text-xs font-bold text-[var(--text)]">{s.label}</h3>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg)] text-[var(--text-muted)] font-semibold">{cards.length}</span>
              </div>
              <span className="text-[10px] text-[var(--text-dim)]">₩{sum.toLocaleString()}</span>
            </div>
            <div className="flex flex-col gap-2">
              {cards.length === 0 && (
                <div className="text-[11px] text-[var(--text-dim)] text-center py-6">없음</div>
              )}
              {cards.map((c) => (
                <ProjectCardView
                  key={c.id}
                  card={c}
                  onClick={() => onCardClick(c)}
                  onStageMenu={() => onStageMenu(c)}
                  onDetail={() => onDetail(c.id)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Card ──
function ProjectCardView({
  card,
  onClick,
  onStageMenu,
  onDetail,
}: {
  card: ProjectCard;
  onClick: () => void;
  onStageMenu: () => void;
  onDetail: () => void;
}) {
  // PR4 lib: critical 다음액션이면 본문에 1줄 표시 (recommended/optional 은 패널에서만)
  const action = useMemo(
    () =>
      getNextAction({
        id: card.id,
        name: card.name,
        stage: card.stage,
        end_date: card.end_date,
        contract_total: card.contract_total,
      }),
    [card],
  );
  const showCriticalAction = action.level === "critical";

  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left bg-[var(--bg-card)] hover:bg-[var(--bg)] border border-[var(--border)] hover:border-[var(--primary)]/40 rounded-xl p-3 transition active:scale-[0.99] w-full"
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
            {card.classification && <ClassificationBadge classification={card.classification} />}
            {card.badge.key !== "none" && (
              <span
                className="text-[9px] px-1.5 py-0.5 rounded font-semibold inline-flex items-center gap-0.5"
                style={{ color: card.badge.color, backgroundColor: card.badge.bg }}
                title={card.badge.reason}
              >
                <span>{card.badge.emoji}</span>{card.badge.label}
              </span>
            )}
          </div>
          <h4 className="text-sm font-semibold text-[var(--text)] truncate">{card.name}</h4>
        </div>
        {/* 단계 변경 빠른 버튼 (⋮) */}
        <span
          role="button"
          tabIndex={0}
          aria-label="단계 변경"
          onClick={(e) => { e.stopPropagation(); onStageMenu(); }}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); onStageMenu(); } }}
          className="text-[var(--text-dim)] hover:text-[var(--text)] hover:bg-[var(--bg-surface)] rounded px-1 cursor-pointer text-xs leading-none select-none"
          title="단계 변경"
        >
          ⋮
        </span>
      </div>
      <div className="flex flex-col gap-1 text-[11px] text-[var(--text-muted)]">
        <div className="flex items-center gap-1.5 truncate">
          <span className="text-[var(--text-dim)]">🏢</span>
          <span className="truncate">{card.partnerName}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[var(--text-dim)]">💰</span>
          <span>₩{(card.contract_total ?? 0).toLocaleString()}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[var(--text-dim)]">⏰</span>
          <span>{formatDueLabel(card.end_date)}</span>
        </div>
        <div className="flex items-center gap-1.5 truncate">
          <span className="text-[var(--text-dim)]">👤</span>
          <span className="truncate">{card.managerName}</span>
        </div>
      </div>
      {showCriticalAction && (
        <div
          className="mt-2 px-2 py-1 rounded-md bg-red-500/10 text-red-400 text-[10px] flex items-center gap-1 truncate"
          title={action.reason}
        >
          <span>{action.icon}</span>
          <span className="truncate">{action.text}</span>
        </div>
      )}
      <div className="mt-2 pt-2 border-t border-[var(--border)] flex items-center justify-between">
        <span className="text-[10px] text-[var(--text-dim)]">클릭 → 상세 패널</span>
        <span
          role="link"
          tabIndex={0}
          onClick={(e) => { e.stopPropagation(); onDetail(); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); onDetail(); } }}
          className="text-[10px] text-[var(--primary)] hover:underline cursor-pointer"
        >
          편집 →
        </span>
      </div>
    </button>
  );
}

// ── List View ──
function ListView({
  cards,
  onRowClick,
  onInlineStageChange,
}: {
  cards: ProjectCard[];
  onRowClick: (c: ProjectCard) => void;
  onInlineStageChange: (dealId: string, newStage: Stage) => void;
}) {
  const [sortKey, setSortKey] = useState<"end_date" | "contract_total" | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [pageSize, setPageSize] = useState<10 | 25 | 50>(25);
  const [page, setPage] = useState(1);

  const sorted = useMemo(() => {
    if (!sortKey) return cards;
    const arr = [...cards];
    arr.sort((a, b) => {
      let av: number;
      let bv: number;
      if (sortKey === "contract_total") {
        av = a.contract_total ?? 0; bv = b.contract_total ?? 0;
      } else {
        av = a.end_date ? new Date(a.end_date).getTime() : Number.MAX_SAFE_INTEGER;
        bv = b.end_date ? new Date(b.end_date).getTime() : Number.MAX_SAFE_INTEGER;
      }
      return sortDir === "asc" ? av - bv : bv - av;
    });
    return arr;
  }, [cards, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const pageSafe = Math.min(page, totalPages);
  const pageCards = sorted.slice((pageSafe - 1) * pageSize, pageSafe * pageSize);

  function toggleSort(k: "end_date" | "contract_total") {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("asc"); }
  }

  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-[var(--bg-surface)] text-[var(--text-muted)]">
            <tr>
              <th className="text-left px-3 py-2 font-semibold">프로젝트명</th>
              <th className="text-left px-3 py-2 font-semibold">고객사</th>
              <th className="text-left px-3 py-2 font-semibold">단계</th>
              <th className="text-right px-3 py-2 font-semibold cursor-pointer select-none" onClick={() => toggleSort("contract_total")}>
                금액 {sortKey === "contract_total" ? (sortDir === "asc" ? "↑" : "↓") : ""}
              </th>
              <th className="text-left px-3 py-2 font-semibold cursor-pointer select-none" onClick={() => toggleSort("end_date")}>
                기한 {sortKey === "end_date" ? (sortDir === "asc" ? "↑" : "↓") : ""}
              </th>
              <th className="text-left px-3 py-2 font-semibold">담당자</th>
              <th className="text-left px-3 py-2 font-semibold">상태</th>
            </tr>
          </thead>
          <tbody>
            {pageCards.map((c) => (
              <tr key={c.id} className="border-t border-[var(--border)] hover:bg-[var(--bg-surface)]/40 transition">
                <td className="px-3 py-2">
                  <button onClick={() => onRowClick(c)} className="text-left text-[var(--text)] font-medium hover:text-[var(--primary)]">
                    {c.name}
                  </button>
                </td>
                <td className="px-3 py-2 text-[var(--text-muted)]">{c.partnerName}</td>
                <td className="px-3 py-2">
                  <select
                    value={(c.stage as Stage) || "estimate"}
                    onChange={(e) => onInlineStageChange(c.id, e.target.value as Stage)}
                    className="px-2 py-1 bg-[var(--bg)] border border-[var(--border)] rounded-md text-[11px] focus:outline-none focus:border-[var(--primary)]"
                  >
                    {STAGES.map((s) => (
                      <option key={s.key} value={s.key}>{s.label}</option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2 text-right text-[var(--text)]">₩{(c.contract_total ?? 0).toLocaleString()}</td>
                <td className="px-3 py-2 text-[var(--text-muted)]">{formatDueLabel(c.end_date)}</td>
                <td className="px-3 py-2 text-[var(--text-muted)]">{c.managerName}</td>
                <td className="px-3 py-2">
                  {c.badge.key !== "none" ? (
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded font-semibold inline-flex items-center gap-0.5"
                      style={{ color: c.badge.color, backgroundColor: c.badge.bg }}
                      title={c.badge.reason}
                    >
                      <span>{c.badge.emoji}</span>{c.badge.label}
                    </span>
                  ) : (
                    <span className="text-[10px] text-[var(--text-dim)]">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Pagination */}
      <div className="flex items-center justify-between px-3 py-2 border-t border-[var(--border)] bg-[var(--bg-surface)]/30 text-[11px] text-[var(--text-muted)]">
        <div className="flex items-center gap-2">
          <span>페이지당</span>
          <select
            value={pageSize}
            onChange={(e) => { setPageSize(Number(e.target.value) as 10 | 25 | 50); setPage(1); }}
            className="px-2 py-1 bg-[var(--bg)] border border-[var(--border)] rounded-md text-[11px] focus:outline-none"
          >
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
          </select>
          <span>· 총 {sorted.length}건</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={pageSafe <= 1}
            className="px-2 py-1 rounded-md bg-[var(--bg)] border border-[var(--border)] disabled:opacity-40 hover:bg-[var(--bg-surface)]"
          >
            ←
          </button>
          <span>{pageSafe} / {totalPages}</span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={pageSafe >= totalPages}
            className="px-2 py-1 rounded-md bg-[var(--bg)] border border-[var(--border)] disabled:opacity-40 hover:bg-[var(--bg-surface)]"
          >
            →
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Stage Modal ──
function StageModal({
  card,
  draft,
  onDraftChange,
  onClose,
  onConfirm,
  submitting,
}: {
  card: ProjectCard;
  draft: Stage;
  onDraftChange: (s: Stage) => void;
  onClose: () => void;
  onConfirm: () => void;
  submitting: boolean;
}) {
  const current = (card.stage as Stage) || "estimate";
  const unchanged = draft === current;
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl max-w-md w-full p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="text-base font-bold text-[var(--text)]">단계 변경</h3>
            <p className="text-[11px] text-[var(--text-muted)] mt-0.5 truncate">{card.name}</p>
          </div>
          <button onClick={onClose} className="text-xs text-[var(--text-muted)] hover:text-[var(--text)]">닫기</button>
        </div>
        <div className="mb-2 text-[11px] text-[var(--text-dim)]">
          현재 단계: <strong className="text-[var(--text-muted)]">{STAGE_LABEL[current] || current}</strong>
        </div>
        <div className="flex flex-col gap-1.5 mb-5">
          {STAGES.map((s) => (
            <label
              key={s.key}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl border cursor-pointer transition ${
                draft === s.key
                  ? "border-[var(--primary)] bg-[var(--primary)]/5"
                  : "border-[var(--border)] hover:bg-[var(--bg-surface)]"
              }`}
            >
              <input
                type="radio"
                name="stage"
                value={s.key}
                checked={draft === s.key}
                onChange={() => onDraftChange(s.key)}
                className="accent-[var(--primary)]"
              />
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
              <span className="text-sm font-medium text-[var(--text)]">{s.label}</span>
              {s.key === current && <span className="text-[10px] text-[var(--text-dim)] ml-auto">현재</span>}
            </label>
          ))}
        </div>
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 text-xs font-semibold rounded-xl bg-[var(--bg-surface)] text-[var(--text-muted)] hover:bg-[var(--border)] transition"
          >
            취소
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={unchanged || submitting}
            className="px-4 py-2 text-xs font-semibold rounded-xl bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white transition disabled:opacity-50"
          >
            {submitting ? "변경 중..." : "변경"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────
// PeriodPicker — /projects 진입 시 기간 선택 화면 (2026-05-21 사장님 요청)
//   상단 토글 [년 / 분기 / 월] (기본 분기) + 년도 드롭다운
//   카드 그리드: 년=3장, 분기=4장, 월=12장 — 각 카드에 그 기간 활성 프로젝트 건수
// ────────────────────────────────────────────────
function PeriodPicker({ isEmployeeLimited = false, onCreate }: { isEmployeeLimited?: boolean; onCreate: () => void }) {
  const router = useRouter();
  const [unit, setUnit] = useState<"year" | "quarter" | "month">("quarter");
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentQuarter = Math.floor(now.getMonth() / 3) + 1;
  const currentMonth = now.getMonth() + 1;

  // 회사 id + deals 1회 fetch — 각 기간 카드의 건수 미리보기용
  const [companyId, setCompanyId] = useState<string | null>(null);
  useEffect(() => { getCurrentUser().then((u) => { if (u) setCompanyId(u.company_id); }); }, []);

  const { data: deals = [] } = useQuery({
    queryKey: ["period-picker-deals", companyId, isEmployeeLimited ? "limited" : "full"],
    queryFn: async () => {
      if (isEmployeeLimited) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data } = await (supabase as any).rpc("get_my_assigned_deals");
        return (data || []) as DealRow[];
      }
      return getDeals(companyId!);
    },
    enabled: !!companyId,
  });

  function buildFilter(y: number, q?: number, m?: number): DateFilter {
    if (m !== undefined) return { from: new Date(y, m - 1, 1), to: new Date(y, m, 0, 23, 59, 59), label: `${y}-${String(m).padStart(2, '0')}` };
    if (q !== undefined) { const s = (q - 1) * 3; return { from: new Date(y, s, 1), to: new Date(y, s + 3, 0, 23, 59, 59), label: `${y} Q${q}` }; }
    return { from: new Date(y, 0, 1), to: new Date(y, 11, 31, 23, 59, 59), label: `${y}년` };
  }
  function countFor(filter: DateFilter): number {
    return (deals as DealRow[]).filter((d) => dealInPeriod(d, filter)).length;
  }

  const yearOptions = [currentYear - 2, currentYear - 1, currentYear, currentYear + 1];

  const cards: { key: string; label: string; current: boolean; count: number; href: string }[] = (() => {
    if (unit === "year") {
      return yearOptions.map((y) => ({
        key: `y-${y}`,
        label: `${y}년`,
        current: y === currentYear,
        count: countFor(buildFilter(y)),
        href: `/projects?period=year&year=${y}`,
      }));
    }
    if (unit === "quarter") {
      return [1, 2, 3, 4].map((q) => ({
        key: `q-${q}`,
        label: `${q}분기`,
        current: year === currentYear && q === currentQuarter,
        count: countFor(buildFilter(year, q)),
        href: `/projects?period=quarter&year=${year}&q=${q}`,
      }));
    }
    return Array.from({ length: 12 }, (_, i) => i + 1).map((m) => ({
      key: `m-${m}`,
      label: `${m}월`,
      current: year === currentYear && m === currentMonth,
      count: countFor(buildFilter(year, undefined, m)),
      href: `/projects?period=month&year=${year}&m=${m}`,
    }));
  })();

  return (
    <div className="p-4 sm:p-6 max-w-[1200px] mx-auto">
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-[var(--text)]">프로젝트 — 기간 선택</h1>
          <p className="text-xs text-[var(--text-muted)] mt-1">기간을 선택하면 그 기간에 활성이었던 프로젝트만 칸반에 표시됩니다.</p>
        </div>
        <button
          type="button"
          onClick={onCreate}
          className="shrink-0 px-3 py-2 text-xs font-semibold rounded-xl bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white transition"
        >
          + 새 프로젝트
        </button>
      </div>

      {/* 단위 토글 + 년도 드롭다운 */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <div className="flex gap-1 bg-[var(--bg-card)] rounded-lg p-0.5 border border-[var(--border)]">
          {(["year", "quarter", "month"] as const).map((u) => (
            <button
              key={u}
              onClick={() => setUnit(u)}
              className={`px-4 py-1.5 text-xs font-semibold rounded ${unit === u ? 'bg-[var(--primary)] text-white' : 'text-[var(--text-muted)]'}`}
            >
              {u === "year" ? "년" : u === "quarter" ? "분기" : "월"}
            </button>
          ))}
        </div>
        {unit !== "year" && (
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="px-3 py-1.5 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg text-xs"
          >
            {yearOptions.map((y) => (
              <option key={y} value={y}>{y}년</option>
            ))}
          </select>
        )}
      </div>

      {/* 카드 그리드 */}
      <div className={`grid gap-3 ${unit === "month" ? "grid-cols-3 sm:grid-cols-4 md:grid-cols-6" : "grid-cols-2 sm:grid-cols-4"}`}>
        {cards.map((c) => (
          <button
            key={c.key}
            onClick={() => router.push(c.href)}
            className={`bg-[var(--bg-card)] rounded-xl border p-4 text-left hover:border-[var(--primary)] transition ${
              c.current ? 'border-[var(--primary)] ring-1 ring-[var(--primary)]/30' : 'border-[var(--border)]'
            }`}
          >
            <div className="flex items-center gap-2 mb-2">
              <span className={`text-base font-bold ${c.current ? 'text-[var(--primary)]' : 'text-[var(--text)]'}`}>
                {c.label}
              </span>
              {c.current && <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--primary)]/15 text-[var(--primary)] font-semibold">현재</span>}
            </div>
            <div className="text-xs text-[var(--text-muted)]">
              <span className="font-semibold text-[var(--text)]">{c.count}</span>건 활성
            </div>
          </button>
        ))}
      </div>

      {/* 빠른 진입 */}
      <div className="mt-6 flex flex-wrap gap-2">
        <Link
          href={`/projects?period=year&year=${currentYear}`}
          className="px-3 py-1.5 text-xs rounded-lg bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--primary)]"
        >
          올해 전체
        </Link>
        <Link
          href={`/projects?period=quarter&year=${currentYear}&q=${currentQuarter}`}
          className="px-3 py-1.5 text-xs rounded-lg bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--primary)]"
        >
          이번 분기
        </Link>
        <Link
          href={`/projects?period=month&year=${currentYear}&m=${currentMonth}`}
          className="px-3 py-1.5 text-xs rounded-lg bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--primary)]"
        >
          이번 달
        </Link>
      </div>
    </div>
  );
}
