"use client";

// PR2: /projects 신설 — /deals 와 병행. 칸반(기본) + 리스트 토글.
//   - 데이터: deals.stage (5-enum) 만 사용. 기존 deals 무수정.
//   - 카드 6요소: 프로젝트명·고객사·계약금액·기한·대표담당자·상태배지 1개.
//   - 단계 변경: 카드 클릭 → 라디오 모달 (DnD 외부 패키지 미사용).
//   - PR3 가 이어서 슬라이드 패널 붙임. 현재는 deep link /deals/[id] 가능.
//   - 권한: owner/admin only. employee/partner → AccessDenied.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { getCurrentUser, getDeals, getCompanyUsers } from "@/lib/queries";
import { getPartners } from "@/lib/partners";
import { useUser } from "@/components/user-context";
import { AccessDenied } from "@/components/access-denied";
import { useToast } from "@/components/toast";
import { friendlyError, reportError } from "@/lib/friendly-error";
import { getProjectBadge, formatDueLabel, type ProjectBadge } from "@/lib/project-badges";

// ── 5-stage enum ──
type Stage = "estimate" | "contract" | "in_progress" | "completed" | "settlement";

const STAGES: { key: Stage; label: string; color: string }[] = [
  { key: "estimate",    label: "견적", color: "#94A3B8" },
  { key: "contract",    label: "계약", color: "#6366F1" },
  { key: "in_progress", label: "진행", color: "#3B82F6" },
  { key: "completed",   label: "완료", color: "#22C55E" },
  { key: "settlement",  label: "정산", color: "#F59E0B" },
];

const STAGE_LABEL: Record<Stage, string> = {
  estimate: "견적",
  contract: "계약",
  in_progress: "진행",
  completed: "완료",
  settlement: "정산",
};

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
}

interface PartnerLite { id: string; name: string }
interface UserLite { id: string; name: string | null; email: string }

interface AssignmentLite { deal_id: string; user_id: string; role: string | null; is_active: boolean | null }

interface ProjectCard extends DealRow {
  partnerName: string;
  managerName: string;
  badge: ProjectBadge;
}

export default function ProjectsPage() {
  const { role, loading } = useUser();
  if (loading) return <div className="p-8 text-sm text-[var(--text-muted)]">로딩 중...</div>;
  if (role !== "owner" && role !== "admin") {
    return <AccessDenied detail="프로젝트(신규) 메뉴는 대표/관리자만 접근할 수 있습니다." />;
  }
  return <ProjectsInner />;
}

function ProjectsInner() {
  const router = useRouter();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [companyId, setCompanyId] = useState<string | null>(null);
  useEffect(() => { getCurrentUser().then((u) => { if (u) setCompanyId(u.company_id); }); }, []);

  // ── 데이터 ──
  const { data: deals = [], isLoading: dealsLoading } = useQuery({
    queryKey: ["projects-deals", companyId],
    queryFn: () => getDeals(companyId!),
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
    return (deals as DealRow[]).map((d) => {
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
  }, [deals, partnerMap, userMap, managerByDeal]);

  // ── 검색/필터 state ──
  const [search, setSearch] = useState("");
  const [filterDue, setFilterDue] = useState<"all" | "soon">("all");
  const [filterAmount, setFilterAmount] = useState<"all" | "1m" | "10m">("all");
  const [filterManager, setFilterManager] = useState<string>("");
  const [filterPartner, setFilterPartner] = useState<string>("");
  const [view, setView] = useState<"kanban" | "list">("kanban");

  // 필터 적용
  const filteredCards: ProjectCard[] = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return cards.filter((c) => {
      if (search && !c.name.toLowerCase().includes(search.toLowerCase())) return false;
      if (filterPartner && c.partner_id !== filterPartner) return false;
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
  }, [cards, search, filterDue, filterAmount, filterManager, filterPartner, managerByDeal]);

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
    onSuccess: () => {
      toast("단계가 변경되었습니다", "success");
      setStageModal(null);
      queryClient.invalidateQueries({ queryKey: ["projects-deals", companyId] });
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

  return (
    <div className="p-4 sm:p-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3 mb-5">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-2xl font-extrabold text-[var(--text)]">프로젝트</h1>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--primary)]/15 text-[var(--primary)] font-semibold">신규</span>
          </div>
          <p className="text-xs text-[var(--text-muted)]">5단계 칸반·리스트로 진행 상태를 한눈에. (기존 /deals 와 병행)</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/deals"
            className="px-3 py-2 text-xs font-semibold rounded-xl bg-[var(--bg-surface)] text-[var(--text-muted)] hover:bg-[var(--border)] transition"
          >
            ← 기존 /deals
          </Link>
          <Link
            href="/deals?create=1"
            className="px-3 py-2 text-xs font-semibold rounded-xl bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white transition"
          >
            + 새 프로젝트
          </Link>
        </div>
      </div>

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
        <EmptyState />
      )}

      {!dealsLoading && filteredCards.length > 0 && view === "kanban" && (
        <KanbanView
          byStage={byStage}
          onCardClick={openStageModal}
          onDetail={(id) => router.push(`/deals?detail=${id}`)}
        />
      )}

      {!dealsLoading && filteredCards.length > 0 && view === "list" && (
        <ListView
          cards={filteredCards}
          onRowClick={openStageModal}
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
    </div>
  );
}

// ── EmptyState ──
function EmptyState() {
  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-10 text-center">
      <div className="text-4xl mb-3">📋</div>
      <h2 className="text-base font-bold text-[var(--text)] mb-1">아직 프로젝트가 없습니다</h2>
      <p className="text-xs text-[var(--text-muted)] mb-5">첫 프로젝트를 만들고 5단계 진행 상태를 한눈에 관리해보세요.</p>
      <Link
        href="/deals?create=1"
        className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white text-sm font-semibold transition active:scale-[0.98]"
      >
        + 새 프로젝트 만들기
      </Link>
    </div>
  );
}

// ── Kanban View ──
function KanbanView({
  byStage,
  onCardClick,
  onDetail,
}: {
  byStage: Record<Stage, ProjectCard[]>;
  onCardClick: (c: ProjectCard) => void;
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
  onDetail,
}: {
  card: ProjectCard;
  onClick: () => void;
  onDetail: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left bg-[var(--bg-card)] hover:bg-[var(--bg)] border border-[var(--border)] hover:border-[var(--primary)]/40 rounded-xl p-3 transition active:scale-[0.99]"
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
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
      <div className="mt-2 pt-2 border-t border-[var(--border)] flex items-center justify-between">
        <span className="text-[10px] text-[var(--text-dim)]">클릭 → 단계 변경</span>
        <span
          role="link"
          tabIndex={0}
          onClick={(e) => { e.stopPropagation(); onDetail(); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); onDetail(); } }}
          className="text-[10px] text-[var(--primary)] hover:underline cursor-pointer"
        >
          상세 →
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
