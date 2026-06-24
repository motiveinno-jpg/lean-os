"use client";

// PR3: 프로젝트 슬라이드 패널 (3탭: 개요 / 돈 / 활동)
//   /projects?deal=<id> URL 파라미터로 마운트. 카드 클릭으로 진입.
//   PR4 lib (project-rules.ts) 의 getProjectBadge / getNextAction / getMetaSummary 적극 활용.
//   - 권한 가드 없음: 부모 ProjectsPage 가 AccessDenied 로 차단.
//   - 데이터: getProjectDetail (1회 fetch, 7개 쿼리 병렬).
//   - 닫기: ✕ / ESC / 배경 클릭 — 모두 onClose 호출.
//   - 모바일: sm 이하 전체 화면, 그 위는 우측 슬라이드(max-w-2xl).

import { useEffect, useMemo, useState } from "react";
import { DateField } from "@/components/date-field";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { getProjectDetail, getCompanyUsers } from "@/lib/queries";
import { friendlyError } from "@/lib/friendly-error";
import { useToast } from "@/components/toast";
import { useDocumentViewer } from "@/contexts/document-viewer-context";
import { useUser } from "@/components/user-context";
import {
  getProjectBadge,
  getNextAction,
  getMetaSummary,
  STAGE_LABEL,
  STAGE_COLOR,
  type ProjectStage,
} from "@/lib/project-rules";
import { formatDueLabel } from "@/lib/project-badges";
import { ProjectQuoteStages } from "@/components/project-quote-stages";
import { getLatestApproval, type ApprovalLite } from "@/lib/quote-approvals";
import { ProjectScheduleTab } from "@/components/project-schedule-tab";

// stage → 진행률 (%)
const STAGE_PROGRESS: Record<ProjectStage, number> = {
  estimate: 20,
  contract: 40,
  in_progress: 60,
  completed: 80,
  settlement: 100,
};

type Tab = "overview" | "money" | "activity" | "schedule";

interface ProjectSlideOverProps {
  dealId: string;
  companyId: string;
  onClose: () => void;
  onOpenStageModal?: () => void; // 단계 변경 모달 (부모가 관리)
  // PR3.5: 다음액션 CTA 가 ?action=<key> 로 진입 시 패널이 해당 탭/섹션으로 점프.
  //   적용 직후 부모에게 onActionConsumed 콜백으로 알려 URL 클리어.
  pendingAction?: string | null;
  onActionConsumed?: () => void;
  // 2026-05-21: 직원(role='employee') 컨텍스트 — 돈 탭 + 재무 정보 가림
  isEmployeeLimited?: boolean;
  // 2026-05-22: 'slide' = 우측 슬라이드 패널(기존), 'page' = 전체화면 독립 페이지(/projects/[id])
  variant?: 'slide' | 'page';
}

// PR3.5: action key → 어느 탭의 어느 섹션으로 점프할지.
//   quote/contract/send/cost-review → money 탭, recover → money 탭(받을돈),
//   progress → activity 탭, move-settlement/archive → overview 탭.
const ACTION_TAB: Record<string, { tab: Tab; scroll?: string }> = {
  'quote':           { tab: 'money',    scroll: 'sec-quote' },
  'contract':        { tab: 'money',    scroll: 'sec-quote' },
  'send':            { tab: 'money',    scroll: 'sec-quote' },
  'cost-review':     { tab: 'money',    scroll: 'sec-cost' },
  'recover':         { tab: 'money',    scroll: 'sec-revenue' },
  'progress':        { tab: 'activity', scroll: 'sec-progress' },
  'move-settlement': { tab: 'overview', scroll: 'sec-stage' },
  'archive':         { tab: 'overview', scroll: 'sec-stage' },
};

export function ProjectSlideOver({ dealId, companyId, onClose, onOpenStageModal, pendingAction, onActionConsumed, isEmployeeLimited = false, variant = 'slide' }: ProjectSlideOverProps) {
  const [tab, setTab] = useState<Tab>("overview");
  const isPage = variant === 'page';

  // ESC 닫기 — 슬라이드 모드에서만 (페이지 모드는 라우터 뒤로가기)
  useEffect(() => {
    if (isPage) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, isPage]);

  // PR3.5: pendingAction 1회 적용 — 탭 전환 + 섹션 스크롤. 직후 onActionConsumed.
  useEffect(() => {
    if (!pendingAction) return;
    const map = ACTION_TAB[pendingAction];
    if (map) {
      setTab(map.tab);
      // 탭 렌더 후 scrollIntoView
      if (map.scroll) {
        setTimeout(() => {
          const el = document.getElementById(map.scroll!);
          if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "start" });
            el.classList.add("ring-2", "ring-[var(--primary)]");
            setTimeout(() => el.classList.remove("ring-2", "ring-[var(--primary)]"), 1500);
          }
        }, 50);
      }
    }
    onActionConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAction]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["project-detail", dealId],
    queryFn: () => getProjectDetail(dealId, companyId),
    enabled: !!dealId && !!companyId,
  });

  // ── 페이지 모드 — 전체화면 독립 페이지 (/projects/[id]) ──
  if (isPage) {
    return (
      <div className="min-h-screen bg-[var(--bg)]">
        {isLoading && (
          <div className="max-w-5xl mx-auto px-6 py-20 text-center text-sm text-[var(--text-muted)]">불러오는 중...</div>
        )}
        {error && (
          <div className="max-w-5xl mx-auto px-6 py-20 flex flex-col items-center gap-3 text-sm text-[var(--text-muted)]">
            <span>프로젝트를 불러올 수 없습니다</span>
            <button onClick={onClose} className="text-xs text-[var(--primary)] hover:underline">← 프로젝트 목록</button>
          </div>
        )}
        {data && data.deal && (
          <PanelBody
            data={data}
            tab={tab}
            onTabChange={setTab}
            onClose={onClose}
            onOpenStageModal={onOpenStageModal}
            dealId={dealId}
            companyId={companyId}
            isEmployeeLimited={isEmployeeLimited}
            variant="page"
          />
        )}
        {data && !data.deal && (
          <div className="max-w-5xl mx-auto px-6 py-20 flex flex-col items-center gap-3 text-sm text-[var(--text-muted)]">
            <span>프로젝트를 찾을 수 없습니다</span>
            <button onClick={onClose} className="text-xs text-[var(--primary)] hover:underline">← 프로젝트 목록</button>
          </div>
        )}
      </div>
    );
  }

  // ── 모달 모드 (2026-05-26 화면 중앙 팝업 — 우측 슬라이드 → 중앙 모달) ──
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4" aria-modal="true" role="dialog">
      {/* Backdrop */}
      <button
        type="button"
        onClick={onClose}
        aria-label="닫기"
        className="absolute inset-0 bg-black/50 backdrop-blur-[1px]"
      />
      {/* Panel — 모바일 전체, sm+ 화면 중앙 모달 */}
      <div className="relative w-full max-w-3xl max-h-[90vh] bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {isLoading && (
          <div className="flex-1 flex items-center justify-center text-sm text-[var(--text-muted)]">
            불러오는 중...
          </div>
        )}
        {error && (
          <div className="flex-1 flex flex-col items-center justify-center text-sm text-[var(--text-muted)] gap-2">
            <span>프로젝트를 불러올 수 없습니다</span>
            <button onClick={onClose} className="text-xs text-[var(--primary)] hover:underline">
              닫기
            </button>
          </div>
        )}
        {data && data.deal && (
          <PanelBody
            data={data}
            tab={tab}
            onTabChange={setTab}
            onClose={onClose}
            onOpenStageModal={onOpenStageModal}
            dealId={dealId}
            companyId={companyId}
            isEmployeeLimited={isEmployeeLimited}
          />
        )}
        {data && !data.deal && (
          <div className="flex-1 flex flex-col items-center justify-center text-sm text-[var(--text-muted)] gap-2">
            <span>프로젝트를 찾을 수 없습니다</span>
            <button onClick={onClose} className="text-xs text-[var(--primary)] hover:underline">
              닫기
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────
// Body
// ────────────────────────────────────────────────

interface PanelData {
  deal: any;
  partner: { id: string; name: string } | null;
  revenue: any[];
  costs: any[];
  subDeals: any[];
  assignments: any[];
  documents: any[];
  auditLogs: any[];
}

function PanelBody({
  data,
  tab,
  onTabChange,
  onClose,
  onOpenStageModal,
  dealId,
  companyId,
  isEmployeeLimited = false,
  variant = 'slide',
}: {
  data: PanelData;
  tab: Tab;
  onTabChange: (t: Tab) => void;
  onClose: () => void;
  onOpenStageModal?: () => void;
  dealId: string;
  companyId: string;
  isEmployeeLimited?: boolean;
  variant?: 'slide' | 'page';
}) {
  const deal = data.deal;
  const stage = (deal.stage || "estimate") as ProjectStage;
  const stageColor = STAGE_COLOR[stage] || STAGE_COLOR.estimate;
  const isPage = variant === 'page';
  const progress = STAGE_PROGRESS[stage] || 20;

  const tabs = (isEmployeeLimited
    ? [
        { key: "overview", label: "개요" },
        { key: "activity", label: "활동" },
        { key: "schedule", label: "일정 관리" },
      ]
    : [
        { key: "overview", label: "개요" },
        { key: "money", label: "돈" },
        { key: "activity", label: "활동" },
        { key: "schedule", label: "일정 관리" },
      ]) as { key: Tab; label: string }[];

  // 본문 탭 컨텐츠 — slide/page 공통 재사용 (로직 동일)
  const tabContent = (
    <>
      {tab === "overview" && <OverviewTab data={data} stage={stage} isEmployeeLimited={isEmployeeLimited} onClose={onClose} />}
      {tab === "money" && !isEmployeeLimited && <MoneyTab data={data} dealId={dealId} companyId={companyId} />}
      {tab === "activity" && <ActivityTab data={data} dealId={dealId} />}
      {tab === "schedule" && <ProjectScheduleTab dealId={dealId} />}
    </>
  );

  // ── 페이지 모드 — 전체화면 헤더바 + 넓은 본문 ──
  if (isPage) {
    return (
      <>
        <div className="sticky top-0 z-20 bg-[var(--bg-card)] border-b border-[var(--border)]">
          <div className="max-w-6xl mx-auto px-6 pt-4">
            <button onClick={onClose} className="text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text)] mt-1 mb-2 inline-flex items-center gap-1.5 px-2.5 py-1.5 -ml-2 rounded-lg border border-[var(--border)] hover:bg-[var(--bg-surface)] transition">
              <span className="text-sm leading-none">←</span> 프로젝트 목록
            </button>
            <div className="flex items-start justify-between gap-4 mb-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                  <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold inline-flex items-center gap-1 ${stageColor.bg} ${stageColor.text}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${stageColor.dot}`} />
                    {STAGE_LABEL[stage] || stage}
                  </span>
                  <span className="text-xs text-[var(--text-dim)]">{deal.partner_id ? data.partner?.name || "—" : "—"}</span>
                </div>
                <h1 className="text-2xl font-extrabold text-[var(--text)] truncate">{deal.name || "(이름 없음)"}</h1>
                <div className="flex items-center gap-3 mt-1.5 text-xs text-[var(--text-muted)] flex-wrap">
                  <span>📅 {formatRange(deal.start_date, deal.end_date)}</span>
                  {!isEmployeeLimited && deal.contract_total != null && (
                    <span>💰 {Number(deal.contract_total).toLocaleString()}원</span>
                  )}
                </div>
              </div>
              {onOpenStageModal && (
                <button
                  type="button"
                  onClick={onOpenStageModal}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[var(--bg-surface)] hover:bg-[var(--border)] text-[var(--text-muted)] transition shrink-0"
                >
                  단계 변경
                </button>
              )}
            </div>
            {/* 진행률 */}
            <div className="flex items-center gap-2 mb-3">
              <div className="flex-1 h-1.5 rounded-full bg-[var(--bg-surface)] overflow-hidden">
                <div className="h-full bg-[var(--primary)] rounded-full transition-all" style={{ width: `${progress}%` }} />
              </div>
              <span className="text-[10px] font-bold text-[var(--text-muted)] tabular-nums">{progress}%</span>
            </div>
            {/* 탭 */}
            <div className="flex items-center gap-1 -mb-px overflow-x-auto">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => onTabChange(t.key)}
                  className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition whitespace-nowrap ${
                    tab === t.key
                      ? "border-[var(--primary)] text-[var(--text)]"
                      : "border-transparent text-[var(--text-muted)] hover:text-[var(--text)]"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="max-w-6xl mx-auto px-6 py-6">{tabContent}</div>
      </>
    );
  }

  // ── 슬라이드 모드 (기존) ──
  return (
    <>
      {/* Header */}
      <div className="px-5 py-4 border-b border-[var(--border)] bg-[var(--bg-card)]">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span
                className={`text-[10px] px-2 py-0.5 rounded-full font-semibold inline-flex items-center gap-1 ${stageColor.bg} ${stageColor.text}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${stageColor.dot}`} />
                {STAGE_LABEL[stage] || stage}
              </span>
              <span className="caption">
                {deal.partner_id ? data.partner?.name || "—" : "—"}
              </span>
            </div>
            <h2 className="text-lg font-bold text-[var(--text)] truncate">{deal.name || "(이름 없음)"}</h2>
          </div>
          <div className="flex items-center gap-1">
            {onOpenStageModal && (
              <button
                type="button"
                onClick={onOpenStageModal}
                className="px-2.5 py-1.5 text-[11px] font-semibold rounded-lg bg-[var(--bg-surface)] hover:bg-[var(--border)] text-[var(--text-muted)] transition"
              >
                단계 변경
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="닫기"
              className="w-8 h-8 flex items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-surface)] hover:text-[var(--text)] transition"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Tabs — 직원은 돈 탭 미노출 (재무 가림) */}
        <div className="flex items-center gap-1 -mb-px">
          {(
            (isEmployeeLimited
              ? [
                  { key: "overview", label: "개요" },
                  { key: "activity", label: "활동" },
                  { key: "schedule", label: "일정 관리" },
                ]
              : [
                  { key: "overview", label: "개요" },
                  { key: "money", label: "돈" },
                  { key: "activity", label: "활동" },
                  { key: "schedule", label: "일정 관리" },
                ]) as { key: Tab; label: string }[]
          ).map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => onTabChange(t.key)}
              className={`px-3 py-2 text-xs font-semibold border-b-2 transition ${
                tab === t.key
                  ? "border-[var(--primary)] text-[var(--text)]"
                  : "border-transparent text-[var(--text-muted)] hover:text-[var(--text)]"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Body — 직원이 직접 URL 로 money 진입 시도해도 차단 */}
      <div className="flex-1 overflow-y-auto p-5">
        {tabContent}
      </div>
    </>
  );
}

// ────────────────────────────────────────────────
// 개요 탭
// ────────────────────────────────────────────────

function OverviewTab({ data, stage, isEmployeeLimited = false, onClose }: { data: PanelData; stage: ProjectStage; isEmployeeLimited?: boolean; onClose: () => void }) {
  const deal = data.deal;
  const progress = STAGE_PROGRESS[stage] || 20;
  // 2026-05-21 프로젝트 삭제 — owner/admin 전용 (직원·매니저 노출 X).
  const { role } = useUser();
  const canDelete = role === 'owner' || role === 'admin';
  const [deleteOpen, setDeleteOpen] = useState(false);

  // 2026-05-21 사장님 요청: 편집 버튼 → 옛 /deals?detail= 점프 X, 인라인 모달로 기본 정보 수정.
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({
    name: deal.name || '',
    contract_total: String(deal.contract_total || ''),
    start_date: deal.start_date || '',
    end_date: deal.end_date || '',
    status: deal.status || 'active',
    priority: deal.priority || 'medium',
  });
  const [editSaving, setEditSaving] = useState(false);
  const editQc = useQueryClient();
  const { toast: editToast } = useToast();
  const openEdit = () => {
    setEditForm({
      name: deal.name || '',
      contract_total: String(deal.contract_total || ''),
      start_date: deal.start_date || '',
      end_date: deal.end_date || '',
      status: deal.status || 'active',
      priority: deal.priority || 'medium',
    });
    setEditOpen(true);
  };
  const submitEdit = async () => {
    if (!editForm.name.trim()) { editToast('프로젝트명을 입력해 주세요', 'error'); return; }
    setEditSaving(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = supabase as any;
      const { error } = await db.from('deals').update({
        name: editForm.name.trim(),
        contract_total: Number(editForm.contract_total) || 0,
        start_date: editForm.start_date || null,
        end_date: editForm.end_date || null,
        status: editForm.status,
        priority: editForm.priority,
      }).eq('id', deal.id);
      if (error) throw error;
      editToast('프로젝트 정보가 수정되었습니다', 'success');
      editQc.invalidateQueries({ queryKey: ['project-detail', deal.id] });
      editQc.invalidateQueries({ queryKey: ['projects-deals'] });
      setEditOpen(false);
    } catch (e) {
      editToast(friendlyError(e, '수정 실패'), 'error');
    } finally {
      setEditSaving(false);
    }
  };

  // STEP 4 (PR-E): 견적 단계 외부 승인 latest approval — getNextAction 에 prop 전달.
  //   estimate stage 만 의미 있음. 다른 stage 는 null 이라도 동작 동일.
  const [latestApproval, setLatestApproval] = useState<ApprovalLite | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (deal.stage !== 'estimate') {
        if (!cancelled) setLatestApproval(null);
        return;
      }
      const a = await getLatestApproval(deal.id, 'estimate');
      if (!cancelled) setLatestApproval(a);
    })();
    return () => { cancelled = true; };
  }, [deal.id, deal.stage]);

  // 진척 가공
  const totalCost = useMemo(() => {
    return (data.costs || []).reduce((acc: number, c: any) => acc + Number(c.amount || 0), 0);
  }, [data.costs]);

  // PR4 lib 활용 — 배지 / 다음액션 / 메타
  const badge = getProjectBadge(
    { stage: deal.stage, end_date: deal.end_date, contract_total: deal.contract_total },
    data.revenue,
    { totalCost },
  );

  const hasQuoteDoc = (data.documents || []).some((d: any) => {
    const t = d?.content_json?.type || "";
    return /quote|견적/i.test(String(t)) || /견적/i.test(String(d?.name || ""));
  });
  const hasContractDoc = (data.documents || []).some((d: any) => {
    const t = d?.content_json?.type || "";
    return /contract|계약/i.test(String(t)) || /계약/i.test(String(d?.name || ""));
  });

  const action = getNextAction(
    {
      id: deal.id,
      name: deal.name,
      stage: deal.stage,
      end_date: deal.end_date,
      contract_total: deal.contract_total,
    },
    data.revenue,
    { totalCost },
    hasQuoteDoc,
    hasContractDoc,
    latestApproval,
  );

  const meta = getMetaSummary({
    id: deal.id,
    name: deal.name,
    stage: deal.stage,
    priority: deal.priority,
    risk_label: deal.risk_label,
    classification: deal.classification,
  });

  // 대표 담당자 — role=manager 우선
  const managerAssign = useMemo(() => {
    const a = data.assignments || [];
    return a.find((x: any) => x.role === "manager") || a[0] || null;
  }, [data.assignments]);
  const managerName = managerAssign?.users?.name || managerAssign?.users?.email || "—";

  const [advancedOpen, setAdvancedOpen] = useState(false);

  // 액션 색상
  const actionColor =
    action.level === "critical"
      ? "bg-red-500/15 text-red-400 border-red-500/30 hover:bg-red-500/25"
      : action.level === "recommended"
      ? "bg-[var(--primary)]/15 text-[var(--primary)] border-[var(--primary)]/30 hover:bg-[var(--primary)]/25"
      : "bg-[var(--bg-surface)] text-[var(--text-muted)] border-[var(--border)] hover:bg-[var(--border)]";

  return (
    <div className="flex flex-col gap-4">
      {/* 다음 액션 CTA */}
      <Link
        href={action.href || `/projects/${deal.id}`}
        className={`block px-4 py-3 rounded-xl border ${actionColor} transition`}
        title={action.reason}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-base shrink-0">{action.icon}</span>
            <span className="text-sm font-semibold truncate">{action.text}</span>
          </div>
          <span className="text-[10px] uppercase tracking-wider opacity-70 shrink-0">
            {action.level === "critical" ? "긴급" : action.level === "recommended" ? "추천" : "선택"}
          </span>
        </div>
        {action.reason && (
          <div className="mt-1 text-[11px] opacity-80">{action.reason}</div>
        )}
      </Link>

      {/* 자동 배지 1개 */}
      {badge.key !== "none" && (
        <div
          className="px-3 py-2 rounded-lg border text-xs flex items-center gap-2"
          style={{ color: badge.color, backgroundColor: badge.bg, borderColor: badge.bg }}
        >
          <span>{badge.emoji}</span>
          <span className="font-semibold">{badge.label}</span>
          {badge.reason && (
            <span className="text-[11px] opacity-80 ml-auto">{badge.reason}</span>
          )}
        </div>
      )}

      {/* 진행률 바 + stage 컨트롤 영역 (PR3.5 action='move-settlement'/'archive' 점프 대상) */}
      <div id="sec-stage" className="bg-[var(--bg-surface)] rounded-xl p-4 transition-shadow">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-[var(--text-muted)]">진행률</span>
          <span className="text-xs text-[var(--text)] font-bold">{progress}%</span>
        </div>
        <div className="h-2 bg-[var(--bg)] rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${progress}%`,
              background:
                "linear-gradient(90deg, var(--primary), var(--primary-hover, var(--primary)))",
            }}
          />
        </div>
        <div className="mt-2 flex justify-between text-[10px] text-[var(--text-dim)]">
          <span>견적</span><span>계약</span><span>진행</span><span>완료</span><span>정산</span>
        </div>
      </div>

      {/* 기본 정보 카드 */}
      <div className="bg-[var(--bg-surface)] rounded-xl p-4">
        <h3 className="text-xs font-bold text-[var(--text-muted)] mb-3">기본 정보</h3>
        <dl className="grid grid-cols-2 gap-3 text-xs">
          <InfoRow label="고객사" value={data.partner?.name || "—"} />
          <InfoRow label="대표 담당자" value={managerName} />
          <InfoRow label="시작일" value={deal.start_date || "—"} />
          <InfoRow label="종료일" value={deal.end_date || "—"} />
          <InfoRow label="기간" value={formatRange(deal.start_date, deal.end_date)} />
          <InfoRow label="기한" value={formatDueLabel(deal.end_date)} />
          {!isEmployeeLimited && (
            <InfoRow label="계약금액" value={`₩${Number(deal.contract_total || 0).toLocaleString()}`} />
          )}
          <InfoRow label="상태" value={deal.status || "—"} />
        </dl>
      </div>

      {/* 액션 버튼 */}
      {!isEmployeeLimited && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={openEdit}
            className="flex-1 px-3 py-2 text-xs font-semibold rounded-xl bg-[var(--bg-surface)] hover:bg-[var(--border)] text-[var(--text)] text-center transition"
          >
            편집
          </button>
        </div>
      )}

      {/* 인라인 편집 모달 — 옛 /deals?detail= 화면 대체 (2026-05-21 사장님 요청) */}
      {editOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
          onClick={() => !editSaving && setEditOpen(false)}
        >
          <div
            className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
              <div className="text-sm font-bold">프로젝트 정보 편집</div>
              <button onClick={() => !editSaving && setEditOpen(false)} disabled={editSaving} className="text-[var(--text-muted)] hover:text-[var(--text)] text-xl leading-none">✕</button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="block text-[11px] text-[var(--text-muted)] mb-1">프로젝트명 *</label>
                <input
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs"
                />
              </div>
              <div>
                <label className="block text-[11px] text-[var(--text-muted)] mb-1">계약금액 (원)</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={editForm.contract_total ? Number(editForm.contract_total).toLocaleString('ko-KR') : ''}
                  onChange={(e) => setEditForm({ ...editForm, contract_total: e.target.value.replace(/[^\d]/g, '') })}
                  placeholder="5,000,000"
                  className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-[var(--text-muted)] mb-1">시작일</label>
                  <DateField value={editForm.start_date} onChange={(e) => setEditForm({ ...editForm, start_date: e.target.value })}
                    className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs" />
                </div>
                <div>
                  <label className="block text-[11px] text-[var(--text-muted)] mb-1">종료일</label>
                  <DateField value={editForm.end_date} onChange={(e) => setEditForm({ ...editForm, end_date: e.target.value })} min={editForm.start_date || undefined}
                    className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs" />
                </div>
                <div>
                  <label className="block text-[11px] text-[var(--text-muted)] mb-1">우선순위</label>
                  <select value={editForm.priority} onChange={(e) => setEditForm({ ...editForm, priority: e.target.value })}
                    className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs">
                    <option value="low">낮음</option>
                    <option value="medium">보통</option>
                    <option value="high">높음</option>
                    <option value="urgent">긴급</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-[var(--text-muted)] mb-1">상태</label>
                  <select value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                    className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs">
                    <option value="active">활성</option>
                    <option value="paused">일시중지</option>
                    <option value="completed">완료</option>
                    <option value="cancelled">취소</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="px-5 py-3 border-t border-[var(--border)] flex justify-end gap-2">
              <button onClick={() => setEditOpen(false)} disabled={editSaving} className="px-4 py-1.5 text-xs text-[var(--text-muted)] rounded-lg">취소</button>
              <button onClick={submitEdit} disabled={editSaving || !editForm.name.trim()} className="px-4 py-1.5 text-xs bg-[var(--primary)] hover:bg-[var(--primary-hover)] disabled:opacity-50 text-white rounded-lg font-semibold">
                {editSaving ? '저장 중…' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 고급 토글 (메타) */}
      {meta.hasAny && (
        <div className="bg-[var(--bg-surface)] rounded-xl">
          <button
            type="button"
            onClick={() => setAdvancedOpen((v) => !v)}
            className="w-full px-4 py-2.5 flex items-center justify-between text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text)] transition"
          >
            <span>고급 (우선순위·위험·분류)</span>
            <span className="text-[10px]">{advancedOpen ? "▲" : "▼"}</span>
          </button>
          {advancedOpen && (
            <div className="px-4 pb-3 flex flex-col gap-2 text-xs">
              {meta.priority && (
                <div className="flex items-center gap-2">
                  <span className="text-[var(--text-dim)] w-16">우선순위</span>
                  <span className={meta.priority.color}>
                    {meta.priority.emoji} {meta.priority.label}
                  </span>
                </div>
              )}
              {meta.risk && (
                <div className="flex items-center gap-2">
                  <span className="text-[var(--text-dim)] w-16">위험도</span>
                  <span className={meta.risk.color}>
                    {meta.risk.emoji} {meta.risk.label}
                  </span>
                </div>
              )}
              {meta.classification && (
                <div className="flex items-center gap-2">
                  <span className="text-[var(--text-dim)] w-16">분류</span>
                  <span className="text-[var(--text-muted)]">{meta.classification}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 위험 영역 — owner/admin 만 노출 */}
      {canDelete && (
        <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/5 p-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-red-500 mb-1">⚠ 위험 영역</div>
          <div className="text-[11px] text-[var(--text-muted)] mb-3">
            프로젝트를 삭제하면 칸반·리스트·활동 어디에서도 보이지 않게 됩니다.
            회계 데이터(매출·비용·정산서·계약서)는 보존됩니다.
          </div>
          <button
            type="button"
            onClick={() => setDeleteOpen(true)}
            className="px-3 py-1.5 rounded-lg border border-red-500/40 text-red-500 hover:bg-red-500/10 text-[11px] font-semibold transition"
          >
            🗑 프로젝트 삭제
          </button>
        </div>
      )}

      {deleteOpen && (
        <DeleteProjectModal
          dealId={deal.id}
          dealName={deal.name || ""}
          companyId={deal.company_id}
          onClose={() => setDeleteOpen(false)}
          onDeleted={() => {
            setDeleteOpen(false);
            onClose();
          }}
        />
      )}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col">
      <dt className="caption mb-0.5">{label}</dt>
      <dd className="text-[var(--text)] font-medium truncate">{value}</dd>
    </div>
  );
}

function formatRange(start?: string | null, end?: string | null) {
  if (!start || !end) return "—";
  try {
    const s = new Date(start);
    const e = new Date(end);
    const days = Math.floor((e.getTime() - s.getTime()) / 86400000);
    if (days < 0) return "—";
    return `${days}일`;
  } catch {
    return "—";
  }
}

// ────────────────────────────────────────────────
// 돈 탭
// ────────────────────────────────────────────────

// ProjectStage(deals.stage) → QuoteApprovalStage 매핑
//   in_progress 는 progress_report 로(진척 보고서 단계),
//   completed 는 completion 으로(완료 확인서 단계).
//   동일 키(estimate/contract/settlement)는 그대로.
function dealStageToApprovalStage(s: string | null | undefined): 'estimate' | 'contract' | 'progress_report' | 'completion' | 'settlement' {
  switch (s) {
    case 'contract':     return 'contract';
    case 'in_progress':  return 'progress_report';
    case 'completed':    return 'completion';
    case 'settlement':   return 'settlement';
    case 'estimate':
    default:             return 'estimate';
  }
}

function MoneyTab({ data, dealId, companyId }: { data: PanelData; dealId: string; companyId: string }) {
  const contract = Number(data.deal.contract_total || 0);

  const paid = (data.revenue || []).filter((r: any) => r.status === "paid");
  const paidSum = paid.reduce((a: number, r: any) => a + Number(r.amount || 0), 0);
  // 미수금 = 계약가 - 입금완료 (자동 차감, 사장님 직관).
  //   2026-05-21 사장님 호소: 수금 추가해도 미수금 갱신 안 됨 → 계약가 기반 단순 차감으로 변경.
  //   expected 행은 향후 수금 일정 표시용 (목록 ul 에 그대로 유지) — 계산엔 미사용.
  const expectedSum = Math.max(0, contract - paidSum);

  // 2026-05-21 받을 돈 인라인 수금 입력 모달 (사장님 요청: 화면 이탈 X)
  const moneyQc = useQueryClient();
  const { toast: moneyToast } = useToast();
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentDate, setPaymentDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [paymentAmount, setPaymentAmount] = useState<string>("");
  const [paymentSaving, setPaymentSaving] = useState(false);

  // 2026-05-21 줄돈 인라인 비용 입력 모달 (사장님 요청: 받을 돈과 동일 패턴)
  const [costModalOpen, setCostModalOpen] = useState(false);
  const [costDate, setCostDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [costAmount, setCostAmount] = useState<string>("");
  const [costMemo, setCostMemo] = useState<string>("");
  const [costSaving, setCostSaving] = useState(false);

  const submitCost = async () => {
    const amt = Number(costAmount);
    if (!costDate) { moneyToast("지급 날짜를 입력해 주세요", "error"); return; }
    if (!amt || amt <= 0) { moneyToast("금액은 1원 이상", "error"); return; }
    setCostSaving(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db2 = supabase as any;
      // deal_cost_schedule 는 deal_node_id 통해 deal 와 연결 (RLS + getProjectDetail !inner JOIN).
      //   해당 dealId 의 첫 node 사용 → 없으면 자동 생성 (root '기본 비용').
      let nodeId: string | null = null;
      const { data: nodes } = await db2
        .from("deal_nodes").select("id").eq("deal_id", dealId).limit(1);
      if (nodes && nodes.length > 0) {
        nodeId = nodes[0].id;
      } else {
        // deal_nodes 컬럼: name(NOT NULL) 필수. node_type 같은 컬럼 없음.
        const { data: newNode, error: nodeErr } = await db2
          .from("deal_nodes")
          .insert({ deal_id: dealId, name: "기본 비용" })
          .select("id")
          .single();
        if (nodeErr) throw nodeErr;
        nodeId = newNode.id;
      }
      const { error } = await db2.from("deal_cost_schedule").insert({
        deal_node_id: nodeId,
        company_id: companyId,
        status: "paid",
        approved: true,
        approved_at: new Date().toISOString(),
        due_date: costDate,
        amount: Math.round(amt),
        condition_text: costMemo.trim() || null,
      });
      if (error) throw error;
      moneyToast(`비용 ₩${Math.round(amt).toLocaleString()} 추가됨`, "success");
      moneyQc.invalidateQueries({ queryKey: ["project-detail", dealId] });
      moneyQc.invalidateQueries({ queryKey: ["deal-detail", dealId] });
      setCostModalOpen(false);
      setCostAmount("");
      setCostMemo("");
      setCostDate(new Date().toISOString().slice(0, 10));
    } catch (e) {
      moneyToast(friendlyError(e, "비용 추가에 실패했습니다"), "error");
    } finally {
      setCostSaving(false);
    }
  };

  const submitPayment = async () => {
    const amt = Number(paymentAmount);
    if (!paymentDate) { moneyToast("받은 날짜를 입력해 주세요", "error"); return; }
    if (!amt || amt <= 0) { moneyToast("금액은 1원 이상", "error"); return; }
    setPaymentSaving(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db2 = supabase as any;
      // 2026-05-21 핫픽스: deal_revenue_schedule 에 company_id 컬럼 없음 — RLS 는 deals JOIN 으로 회사격리.
      //   페이로드에서 company_id 제거 + received_at 추가 (status='paid' 의미 명확화).
      const { error } = await db2.from("deal_revenue_schedule").insert({
        deal_id: dealId,
        status: "paid",
        due_date: paymentDate,
        received_at: new Date(paymentDate + "T00:00:00").toISOString(),
        amount: Math.round(amt),
      });
      if (error) throw error;
      moneyToast(`수금 ₩${Math.round(amt).toLocaleString()} 추가됨`, "success");
      // 패널 데이터 + 관련 영역 갱신 — 받을 돈 섹션 즉시 재계산
      moneyQc.invalidateQueries({ queryKey: ["project-detail", dealId] });
      moneyQc.invalidateQueries({ queryKey: ["deal-detail", dealId] });
      setPaymentModalOpen(false);
      setPaymentAmount("");
      setPaymentDate(new Date().toISOString().slice(0, 10));
    } catch (e) {
      moneyToast(friendlyError(e, "수금 추가에 실패했습니다"), "error");
    } finally {
      setPaymentSaving(false);
    }
  };

  const costSum = (data.costs || []).reduce((a: number, c: any) => a + Number(c.amount || 0), 0);
  const subSum = (data.subDeals || []).reduce((a: number, s: any) => a + Number(s.total_amount || 0), 0);
  const costTotal = costSum + subSum;

  const margin = contract - costTotal;
  const marginPct = contract > 0 ? Math.round((margin / contract) * 100) : 0;

  // deal.stage 따라 ProjectQuoteStages 의 stage prop 결정. stage 가 바뀌면 key 로 재마운트
  //   → approval 재조회·Realtime 구독 갱신.
  const approvalStage = dealStageToApprovalStage(data.deal.stage);

  return (
    <div className="flex flex-col gap-4">
      {/* PR3.5 + 일반화: deal.stage 따라 견적서/계약서/완료확인서/정산 폼 자동 전환.
          2026-05-21 진척보고서(progress_report) 는 활동 탭으로 이동 (사용자 호소).
          돈 탭은 금액/계약가 흐름만 — 진척 보고는 활동 흐름. */}
      {approvalStage !== 'progress_report' && (
        <div id="sec-quote" className="transition-shadow">
          <ProjectQuoteStages
            key={approvalStage}
            dealId={dealId}
            companyId={companyId}
            stage={approvalStage}
          />
        </div>
      )}
      {/* 받을 돈 */}
      <div id="sec-revenue" className="bg-[var(--bg-surface)] rounded-xl p-4 transition-shadow">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-bold text-[var(--text-muted)]">받을 돈 (수금)</h3>
          <button
            type="button"
            onClick={() => setPaymentModalOpen(true)}
            className="text-[10px] text-[var(--primary)] hover:underline font-semibold"
            title="수금 추가 — 받은 날짜와 금액 입력"
          >
            + 수금 추가
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <KV label="계약가" value={`₩${contract.toLocaleString()}`} />
          <KV label="입금완료" value={`₩${paidSum.toLocaleString()}`} tone="positive" />
          <KV label="미수금" value={`₩${expectedSum.toLocaleString()}`} tone={expectedSum > 0 ? "warn" : undefined} />
          <KV label="회수율" value={contract > 0 ? `${Math.round((paidSum / contract) * 100)}%` : "—"} />
        </div>
        {(data.revenue || []).length === 0 ? (
          <div className="text-[11px] text-[var(--text-dim)] text-center py-2">수금 일정 없음</div>
        ) : (
          <ul className="flex flex-col gap-1.5 text-[11px]">
            {(data.revenue as any[]).slice(0, 8).map((r: any) => (
              <li
                key={r.id}
                className="flex items-center justify-between px-2 py-1.5 rounded-lg bg-[var(--bg)] border border-[var(--border)]"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={`text-[9px] px-1.5 py-0.5 rounded font-semibold ${
                      r.status === "paid"
                        ? "bg-green-500/15 text-green-400"
                        : "bg-amber-500/15 text-amber-400"
                    }`}
                  >
                    {r.status === "paid" ? "입금" : "예정"}
                  </span>
                  <span className="text-[var(--text-muted)] truncate">{r.due_date || "—"}</span>
                </div>
                <span className="text-[var(--text)] font-medium">₩{Number(r.amount || 0).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 줄 돈 */}
      <div id="sec-cost" className="bg-[var(--bg-surface)] rounded-xl p-4 transition-shadow">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-bold text-[var(--text-muted)]">줄 돈 (비용 + 외주)</h3>
          <button
            type="button"
            onClick={() => setCostModalOpen(true)}
            className="text-[10px] text-[var(--primary)] hover:underline font-semibold"
            title="비용 추가 — 지급 날짜와 금액 입력"
          >
            + 비용 추가
          </button>
        </div>
        <div className="grid grid-cols-1 gap-3 mb-3">
          <KV label="비용 합계" value={`₩${costTotal.toLocaleString()}`} />
        </div>
        {(data.costs || []).length === 0 && (data.subDeals || []).length === 0 ? (
          <div className="text-[11px] text-[var(--text-dim)] text-center py-2">비용 항목 없음</div>
        ) : (
          <ul className="flex flex-col gap-1.5 text-[11px]">
            {(data.subDeals as any[]).slice(0, 4).map((s: any) => (
              <li
                key={s.id}
                className="flex items-center justify-between px-2 py-1.5 rounded-lg bg-[var(--bg)] border border-[var(--border)]"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[9px] px-1.5 py-0.5 rounded font-semibold bg-purple-500/15 text-purple-400">
                    외주
                  </span>
                  <span className="text-[var(--text-muted)] truncate">{s.name || s.vendors?.name || "—"}</span>
                </div>
                <span className="text-[var(--text)] font-medium">
                  ₩{Number(s.total_amount || 0).toLocaleString()}
                </span>
              </li>
            ))}
            {(data.costs as any[]).slice(0, 4).map((c: any) => (
              <li
                key={c.id}
                className="flex items-center justify-between px-2 py-1.5 rounded-lg bg-[var(--bg)] border border-[var(--border)]"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[9px] px-1.5 py-0.5 rounded font-semibold bg-orange-500/15 text-orange-400">
                    비용
                  </span>
                  <span className="text-[var(--text-muted)] truncate">{c.condition_text || c.due_date || "—"}</span>
                </div>
                <span className="text-[var(--text)] font-medium">₩{Number(c.amount || 0).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 마진 */}
      <div className="bg-[var(--bg-surface)] rounded-xl p-4">
        <h3 className="text-xs font-bold text-[var(--text-muted)] mb-3">예상 마진</h3>
        <div className="grid grid-cols-3 gap-3">
          <KV label="계약가" value={`₩${contract.toLocaleString()}`} />
          <KV label="비용합" value={`₩${costTotal.toLocaleString()}`} />
          <KV
            label="마진"
            value={`₩${margin.toLocaleString()} (${marginPct}%)`}
            tone={margin < 0 ? "warn" : margin > 0 ? "positive" : undefined}
          />
        </div>
      </div>

      {/* 받을 돈 수금 추가 모달 (인라인) */}
      {paymentModalOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
          onClick={() => !paymentSaving && setPaymentModalOpen(false)}
        >
          <div
            className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl w-full max-w-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
              <div>
                <div className="text-sm font-bold">+ 수금 추가</div>
                <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
                  받은 날짜·금액 입력 → 미수금·회수율 즉시 갱신
                </div>
              </div>
              <button
                type="button"
                onClick={() => !paymentSaving && setPaymentModalOpen(false)}
                disabled={paymentSaving}
                className="text-[var(--text-muted)] hover:text-[var(--text)] text-xl leading-none"
              >
                ✕
              </button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="block text-[11px] text-[var(--text-muted)] mb-1">받은 날짜</label>
                <DateField
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  className="field-input-sm"
                />
              </div>
              <div>
                <label className="block text-[11px] text-[var(--text-muted)] mb-1">받은 금액 (원)</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={paymentAmount ? Number(paymentAmount).toLocaleString("ko-KR") : ""}
                  onChange={(e) => setPaymentAmount(e.target.value.replace(/[^\d]/g, ""))}
                  placeholder="5,000,000"
                  className="field-input-sm"
                />
                {Number(paymentAmount) > 0 && (
                  <div className="text-[10px] text-[var(--text-dim)] mt-1">
                    저장 후 미수금: ₩{Math.max(0, expectedSum - Number(paymentAmount)).toLocaleString()}
                  </div>
                )}
              </div>
            </div>
            <div className="px-5 py-3 border-t border-[var(--border)] flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPaymentModalOpen(false)}
                disabled={paymentSaving}
                className="px-4 py-1.5 text-xs text-[var(--text-muted)] rounded-lg"
              >
                취소
              </button>
              <button
                type="button"
                onClick={submitPayment}
                disabled={paymentSaving || !paymentDate || !paymentAmount || Number(paymentAmount) <= 0}
                className="px-4 py-1.5 text-xs bg-[var(--primary)] hover:bg-[var(--primary-hover)] disabled:opacity-50 text-white rounded-lg font-semibold"
              >
                {paymentSaving ? "저장 중…" : "저장"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 줄 돈 비용 추가 모달 (받을 돈 모달과 동일 패턴) */}
      {costModalOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
          onClick={() => !costSaving && setCostModalOpen(false)}
        >
          <div
            className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl w-full max-w-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
              <div>
                <div className="text-sm font-bold">+ 비용 추가</div>
                <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
                  지급 날짜·금액 입력 → 줄 돈/마진 즉시 갱신
                </div>
              </div>
              <button
                type="button"
                onClick={() => !costSaving && setCostModalOpen(false)}
                disabled={costSaving}
                className="text-[var(--text-muted)] hover:text-[var(--text)] text-xl leading-none"
              >
                ✕
              </button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="block text-[11px] text-[var(--text-muted)] mb-1">지급 날짜</label>
                <DateField
                  value={costDate}
                  onChange={(e) => setCostDate(e.target.value)}
                  className="field-input-sm"
                />
              </div>
              <div>
                <label className="block text-[11px] text-[var(--text-muted)] mb-1">지급 금액 (원)</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={costAmount ? Number(costAmount).toLocaleString("ko-KR") : ""}
                  onChange={(e) => setCostAmount(e.target.value.replace(/[^\d]/g, ""))}
                  placeholder="1,000,000"
                  className="field-input-sm"
                />
              </div>
              <div>
                <label className="block text-[11px] text-[var(--text-muted)] mb-1">항목/메모 <span className="text-[var(--text-dim)]">(선택)</span></label>
                <input
                  type="text"
                  value={costMemo}
                  onChange={(e) => setCostMemo(e.target.value)}
                  placeholder="예: 외주 디자인 / 광고비"
                  className="field-input-sm"
                />
              </div>
            </div>
            <div className="px-5 py-3 border-t border-[var(--border)] flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCostModalOpen(false)}
                disabled={costSaving}
                className="px-4 py-1.5 text-xs text-[var(--text-muted)] rounded-lg"
              >
                취소
              </button>
              <button
                type="button"
                onClick={submitCost}
                disabled={costSaving || !costDate || !costAmount || Number(costAmount) <= 0}
                className="px-4 py-1.5 text-xs bg-[var(--primary)] hover:bg-[var(--primary-hover)] disabled:opacity-50 text-white rounded-lg font-semibold"
              >
                {costSaving ? "저장 중…" : "저장"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function KV({ label, value, tone }: { label: string; value: string; tone?: "positive" | "warn" }) {
  const color =
    tone === "positive"
      ? "text-green-400"
      : tone === "warn"
      ? "text-red-400"
      : "text-[var(--text)]";
  return (
    <div className="flex flex-col">
      <span className="caption mb-0.5">{label}</span>
      <span className={`text-sm font-bold ${color}`}>{value}</span>
    </div>
  );
}

// ────────────────────────────────────────────────
// 활동 탭
// ────────────────────────────────────────────────

const ROLE_LABEL: Record<string, string> = {
  manager: "담당자",
  reviewer: "검토자",
  participant: "참여자",
  contributor: "참여자",
};

// approval stage → 한국어 라벨 (견적/계약 외 진척·완료 포함)
const APPROVAL_STAGE_LABEL: Record<string, string> = {
  estimate: "견적서",
  contract: "계약서",
  progress_report: "진척보고서",
  completion: "완료확인서",
  settlement: "정산서",
};

type ApprovalRow = {
  id: string;
  stage: string;
  status: string;
  sent_at: string | null;
  viewed_at: string | null;
  decided_at: string | null;
  our_signed_at: string | null;
  recipient_name: string | null;
  recipient_email: string | null;
  signed_contract_url: string | null;
  fully_signed_contract_url: string | null;
  updated_at?: string | null;
};

type ActivityEvent = {
  key: string;
  icon: string;
  action: string;
  target: string | null;
  at: string;
};

function ActivityTab({ data, dealId }: { data: PanelData; dealId: string }) {
  // 2026-05-21 진척보고서 위치 이동 — deal.stage='in_progress' (=approval stage 'progress_report') 일 때
  //   돈 탭이 아니라 활동 탭 최상단에서 ProjectQuoteStages 렌더.
  //   companyId 는 본문 아래의 기존 const (data.deal.company_id) 사용 — 동일 값.
  const approvalStage = dealStageToApprovalStage(data.deal.stage);
  const { open: openDocViewer } = useDocumentViewer();

  // quote_approvals — 견적/계약/진척/완료 stage 의 sent/viewed/decided/our_signed 이벤트 + 서명본 PDF
  const { data: approvals = [] } = useQuery<ApprovalRow[]>({
    queryKey: ["deal-approvals", dealId],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("quote_approvals")
        .select(
          "id, stage, status, sent_at, viewed_at, decided_at, our_signed_at, recipient_name, recipient_email, signed_contract_url, fully_signed_contract_url",
        )
        .eq("deal_id", dealId)
        .order("created_at", { ascending: false });
      return (data || []) as ApprovalRow[];
    },
    enabled: !!dealId,
  });

  // quote_approvals → 활동 이벤트 변환
  const approvalEvents: ActivityEvent[] = useMemo(() => {
    const ev: ActivityEvent[] = [];
    approvals.forEach((a) => {
      const stageLabel = APPROVAL_STAGE_LABEL[a.stage] || a.stage;
      if (a.sent_at) ev.push({ key: `${a.id}-sent`, icon: "📤", action: `${stageLabel} 발송`, target: a.recipient_email || a.recipient_name, at: a.sent_at });
      if (a.viewed_at) ev.push({ key: `${a.id}-viewed`, icon: "👁", action: `${stageLabel} 거래처 열람`, target: a.recipient_name, at: a.viewed_at });
      if (a.status === "approved" && a.decided_at) ev.push({ key: `${a.id}-approved`, icon: "✅", action: `${stageLabel} 거래처 승인`, target: a.recipient_name, at: a.decided_at });
      if (a.status === "rejected" && a.decided_at) ev.push({ key: `${a.id}-rejected`, icon: "❌", action: `${stageLabel} 거래처 거절`, target: a.recipient_name, at: a.decided_at });
      if (a.our_signed_at) ev.push({ key: `${a.id}-our-signed`, icon: "✍️", action: `${stageLabel} 우리 서명 완료`, target: null, at: a.our_signed_at });
    });
    return ev.sort((x, y) => new Date(y.at).getTime() - new Date(x.at).getTime());
  }, [approvals]);

  // auditLogs + approvalEvents 시간순 통합
  const combinedActivity: ActivityEvent[] = useMemo(() => {
    const auditEvents: ActivityEvent[] = (data.auditLogs || []).map((l: any) => ({
      key: `audit-${l.id}`,
      icon: "📝",
      action: formatAction(l.action || l.entity_type || ""),
      target: l.metadata?.entity_name || null,
      at: l.created_at,
    }));
    return [...auditEvents, ...approvalEvents].sort(
      (x, y) => new Date(y.at).getTime() - new Date(x.at).getTime(),
    );
  }, [data.auditLogs, approvalEvents]);

  // 파일 섹션 (quote_approvals stage 별 모든 상태) — 사장님 요청 v5 Q1·Q2.
  //   draft (저장만) / sent / viewed / approved / fully_signed 모두 표시.
  //   stage 별 아이콘 + status 라벨로 사용자 구분.
  const STAGE_ICON: Record<string, string> = {
    estimate: '📋',
    contract: '📝',
    progress_report: '📊',
    completion: '✅',
    settlement: '💰',
  };
  const STATUS_LABEL_KO: Record<string, string> = {
    draft: '임시저장',
    sent: '발송됨',
    viewed: '거래처 확인',
    approved: '승인됨',
    rejected: '거절',
    fully_signed: '양측 서명',
  };
  const signedFiles = useMemo(() => {
    const arr: { id: string; name: string; icon: string; href: string; at: string; status: string }[] = [];
    approvals.forEach((a) => {
      // 2026-05-21 진척보고서는 활동탭 파일에 표시하지 않음.
      //   /contracts/signed/<id> 는 서명 본문 페이지라 progress_report 행에는 본문이 없어
      //   "본문이 저장되지 않았습니다" 안내가 나옴 → 사장님 호소.
      //   같은 데이터는 진척 카드 누적 스택(클릭 시 상세 모달)에서 표시됨.
      //   활동 로그(combinedActivity)의 sent/viewed/decided 이벤트는 그대로 유지 — 흐름 추적용.
      if (a.stage === 'progress_report') return;
      const stageLabel = APPROVAL_STAGE_LABEL[a.stage] || a.stage;
      const recipient = a.recipient_name || a.recipient_email || '거래처';
      const statusKo = STATUS_LABEL_KO[a.status] || a.status;
      arr.push({
        id: a.id,
        name: `${stageLabel} · ${recipient}`,
        icon: STAGE_ICON[a.stage] || '📄',
        href: `/contracts/signed/${a.id}`,
        at: a.our_signed_at || a.decided_at || a.sent_at || a.updated_at || '',
        status: statusKo,
      });
    });
    return arr;
  }, [approvals]);

  const totalFiles = data.documents.length + signedFiles.length;

  // 담당자 추가/제거 (핸드오프 v5 Q3) — admin/owner 만
  const { role: userRole } = useUser();
  const canEditAssignments = userRole === 'owner' || userRole === 'admin';
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showAddAssignee, setShowAddAssignee] = useState(false);
  const [assigneeSearch, setAssigneeSearch] = useState('');
  const [pendingRole, setPendingRole] = useState<'manager' | 'reviewer' | 'participant'>('manager');
  const companyId = data.deal?.company_id || '';
  const { data: companyUsers = [] } = useQuery({
    queryKey: ['company-users', companyId],
    queryFn: () => getCompanyUsers(companyId),
    enabled: !!companyId && showAddAssignee,
  });
  const addAssigneeMut = useMutation({
    mutationFn: async (userId: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db2 = supabase as any;
      const { error } = await db2.from('deal_assignments').insert({
        deal_id: dealId,
        user_id: userId,
        role: pendingRole,
        is_active: true,
        assigned_at: new Date().toISOString(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-detail', dealId] });
      setShowAddAssignee(false);
      setAssigneeSearch('');
      toast('담당자가 추가되었습니다', 'success');
    },
    onError: (err: Error) => toast(`담당자 추가 실패: ${friendlyError(err, '알 수 없는 오류')}`, 'error'),
  });
  const removeAssigneeMut = useMutation({
    mutationFn: async (assignmentId: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db2 = supabase as any;
      const { error } = await db2.from('deal_assignments')
        .update({ is_active: false, removed_at: new Date().toISOString() })
        .eq('id', assignmentId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-detail', dealId] });
      toast('담당자가 제거되었습니다', 'success');
    },
    onError: (err: Error) => toast(`담당자 제거 실패: ${friendlyError(err, '알 수 없는 오류')}`, 'error'),
  });
  const assignedUserIds = new Set(data.assignments.map((a: { user_id: string }) => a.user_id));
  const filteredUsers = (companyUsers as { id: string; name?: string; email?: string }[]).filter((u) => {
    if (assignedUserIds.has(u.id)) return false;
    if (!assigneeSearch.trim()) return true;
    const q = assigneeSearch.toLowerCase();
    return (u.name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q);
  });

  return (
    <div id="sec-activity" className="flex flex-col gap-4 transition-shadow">
      {/* 진척보고서 — deal.stage='in_progress' 일 때만 표시.
          2026-05-21 돈 탭에서 활동 탭으로 이동 (사용자 호소).
          나머지 stage 의 견적/계약/완료/정산 폼은 그대로 돈 탭. */}
      {approvalStage === 'progress_report' && (
        <div id="sec-progress" className="transition-shadow">
          <ProjectQuoteStages
            key={approvalStage}
            dealId={dealId}
            companyId={companyId}
            stage={approvalStage}
          />
        </div>
      )}

      {/* 담당자 목록 + 추가/제거 (v5 Q3) */}
      <Section
        title={`담당자 (${data.assignments.length})`}
        right={canEditAssignments ? (
          <button
            onClick={() => setShowAddAssignee(true)}
            className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--primary)]/10 text-[var(--primary)] hover:bg-[var(--primary)]/20 font-semibold"
          >
            + 추가
          </button>
        ) : null}
      >
        {data.assignments.length === 0 ? (
          <Empty text={canEditAssignments ? '배정된 담당자 없음 — "+ 추가" 클릭' : '배정된 담당자 없음'} />
        ) : (
          <ul className="flex flex-col gap-1.5">
            {data.assignments.map((a: { id?: string; deal_id: string; user_id: string; role: string; users?: { name?: string; email?: string } }) => (
              <li
                key={`${a.deal_id}-${a.user_id}`}
                className="flex items-center justify-between px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-xs"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-7 h-7 rounded-full bg-[var(--primary)]/15 text-[var(--primary)] flex items-center justify-center font-bold text-[11px]">
                    {(a.users?.name || a.users?.email || "?").slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <div className="text-[var(--text)] font-medium truncate">{a.users?.name || "—"}</div>
                    <div className="text-[10px] text-[var(--text-dim)] truncate">{a.users?.email}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[10px] px-2 py-0.5 rounded bg-[var(--bg-surface)] text-[var(--text-muted)] font-semibold">
                    {ROLE_LABEL[a.role] || a.role || "참여자"}
                  </span>
                  {canEditAssignments && a.id && (
                    <button
                      onClick={() => {
                        if (confirm(`${a.users?.name || '담당자'}을(를) 제거하시겠습니까?`)) {
                          removeAssigneeMut.mutate(a.id!);
                        }
                      }}
                      disabled={removeAssigneeMut.isPending}
                      className="text-[var(--text-dim)] hover:text-red-400 text-xs"
                      title="제거"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* 담당자 추가 모달 */}
      {showAddAssignee && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onClick={() => setShowAddAssignee(false)}>
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
              <div className="text-sm font-bold">+ 담당자 추가</div>
              <button onClick={() => setShowAddAssignee(false)} className="text-[var(--text-muted)] text-xl leading-none">✕</button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">역할</label>
                <div className="flex gap-1">
                  {[
                    { v: 'manager' as const, label: '담당' },
                    { v: 'reviewer' as const, label: '검토' },
                    { v: 'participant' as const, label: '참여' },
                  ].map((opt) => (
                    <button
                      key={opt.v}
                      onClick={() => setPendingRole(opt.v)}
                      className={`flex-1 px-3 py-1.5 text-xs rounded-lg ${pendingRole === opt.v ? 'bg-[var(--primary)] text-white' : 'bg-[var(--bg)] text-[var(--text-muted)]'}`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">사용자 검색</label>
                <input
                  value={assigneeSearch}
                  onChange={(e) => setAssigneeSearch(e.target.value)}
                  placeholder="이름·이메일"
                  className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs"
                />
              </div>
              <div className="max-h-48 overflow-auto border border-[var(--border)] rounded-lg">
                {filteredUsers.length === 0 ? (
                  <div className="p-4 text-center text-xs text-[var(--text-muted)]">사용자 없음</div>
                ) : (
                  filteredUsers.map((u) => (
                    <button
                      key={u.id}
                      onClick={() => addAssigneeMut.mutate(u.id)}
                      disabled={addAssigneeMut.isPending}
                      className="w-full text-left px-3 py-2 hover:bg-[var(--bg-surface)] border-b border-[var(--border)]/30 last:border-b-0 text-xs"
                    >
                      <div className="font-medium">{u.name || '(이름 없음)'}</div>
                      <div className="caption">{u.email}</div>
                    </button>
                  ))
                )}
              </div>
            </div>
            <div className="px-5 py-3 border-t border-[var(--border)] flex justify-end">
              <button onClick={() => setShowAddAssignee(false)} className="px-4 py-1.5 text-xs text-[var(--text-muted)] rounded-lg">취소</button>
            </div>
          </div>
        </div>
      )}

      {/* 파일 — documents + quote_approvals 서명본 PDF 통합 */}
      <Section
        title={`파일 (${totalFiles})`}
        right={
          <Link href={`/documents?deal=${data.deal.id}`} className="text-[10px] text-[var(--primary)] hover:underline">
            전체보기 →
          </Link>
        }
      >
        {totalFiles === 0 ? (
          <Empty text="문서 없음" />
        ) : (
          <ul className="flex flex-col gap-1.5">
            {signedFiles.map((f) => (
              <li
                key={`signed-${f.id}`}
                className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-xs"
              >
                <button onClick={() => openDocViewer({ type: 'contract', id: f.id })} className="flex items-center gap-2 min-w-0 hover:underline flex-1 text-left">
                  <span>{f.icon}</span>
                  <span className="text-[var(--text)] truncate">{f.name}</span>
                </button>
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--bg-surface)] text-[var(--text-muted)] shrink-0">
                  {f.status}
                </span>
                <span className="text-[10px] text-[var(--text-dim)] shrink-0">
                  {f.at ? new Date(f.at).toLocaleDateString("ko-KR") : ""}
                </span>
              </li>
            ))}
            {data.documents.map((d: any) => (
              <li
                key={d.id}
                className="flex items-center justify-between px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-xs"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[var(--text-dim)]">📄</span>
                  <span className="text-[var(--text)] truncate">{d.name || "(이름 없음)"}</span>
                </div>
                <span className="text-[10px] text-[var(--text-dim)] shrink-0">
                  {d.created_at ? new Date(d.created_at).toLocaleDateString("ko-KR") : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* 채팅 (deep link) */}
      <Section
        title="채팅"
        right={
          <Link href={`/chat?deal=${data.deal.id}`} className="text-[10px] text-[var(--primary)] hover:underline">
            채널 열기 →
          </Link>
        }
      >
        <div className="text-[11px] text-[var(--text-dim)] px-1 py-2">
          이 프로젝트의 채팅 채널로 이동합니다.
        </div>
      </Section>

      {/* 활동로그 — auditLogs + quote_approvals 이벤트 통합 */}
      <Section title={`활동 로그 (${combinedActivity.length})`}>
        {combinedActivity.length === 0 ? (
          <Empty text="활동 기록 없음" />
        ) : (
          <ul className="flex flex-col gap-1.5">
            {combinedActivity.map((e) => (
              <li
                key={e.key}
                className="flex items-start gap-2 px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-xs"
              >
                <span className="shrink-0">{e.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-[var(--text)]">
                    <span className="font-semibold">{e.action}</span>
                    {e.target && <span className="text-[var(--text-muted)]"> — {e.target}</span>}
                  </div>
                  <div className="text-[10px] text-[var(--text-dim)] mt-0.5">
                    {e.at ? new Date(e.at).toLocaleString("ko-KR") : ""}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function Section({
  title,
  right,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-[var(--bg-surface)] rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-bold text-[var(--text-muted)]">{title}</h3>
        {right}
      </div>
      {children}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="text-[11px] text-[var(--text-dim)] text-center py-3">{text}</div>;
}

function formatAction(a: string) {
  const map: Record<string, string> = {
    create: "생성", update: "수정", delete: "삭제",
    approve: "승인", reject: "반려", sign: "서명",
    send: "발송", lock: "잠금", unlock: "잠금해제",
    remind: "리마인드", revoke: "취소", view: "조회", export: "내보내기",
  };
  return map[a] || a;
}

// ────────────────────────────────────────────────
// 프로젝트 삭제 모달 — 이름 입력 확인 게이트 (소프트 삭제 archived_at)
// ────────────────────────────────────────────────
function DeleteProjectModal({
  dealId, dealName, companyId, onClose, onDeleted,
}: {
  dealId: string;
  dealName: string;
  companyId: string | null;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [typed, setTyped] = useState("");
  const target = (dealName || "").trim();
  const canDelete = typed.trim() === target && target.length > 0;

  const del = useMutation({
    mutationFn: async () => {
      // 1) soft delete — archived_at 만 갱신, 자식 데이터(quote_approvals/revenue/cost) 전부 보존
      const { error } = await (supabase as any)
        .from("deals")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", dealId);
      if (error) throw error;
      // 2) 감사 로그 (실패해도 본 흐름 비차단)
      //    audit_logs 컬럼: id/company_id/user_id/entity_type/entity_id/action/before_json/after_json/metadata.
      //    entity_name 은 metadata 에 포함 (별도 컬럼 없음).
      try {
        await (supabase as any).from("audit_logs").insert({
          company_id: companyId,
          entity_type: "deal",
          entity_id: dealId,
          action: "delete",
          before_json: { archived_at: null, name: dealName },
          after_json: { archived_at: new Date().toISOString() },
          metadata: { soft_delete: true, deal_name: dealName },
        });
      } catch { /* audit 실패 무시 — 비차단 */ }
    },
    onSuccess: () => {
      // 캐시 무효화 — 칸반·리스트·상세·검색·대시보드 위젯 등 일괄
      queryClient.invalidateQueries({ queryKey: ["projects-deals"] });
      queryClient.invalidateQueries({ queryKey: ["project-detail", dealId] });
      queryClient.invalidateQueries({ queryKey: ["deal-detail", dealId] });
      queryClient.invalidateQueries({ queryKey: ["deals"] });
      queryClient.invalidateQueries({ queryKey: ["my-assigned-deal-ids"] });
      queryClient.invalidateQueries({ queryKey: ["owner-dashboard"] });
      toast("프로젝트가 삭제되었습니다", "success");
      onDeleted();
    },
    onError: (e) => {
      toast(friendlyError(e, "삭제에 실패했습니다"), "error");
    },
  });

  // ESC 닫기 — 진행 중에는 잠금
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !del.isPending) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, del.isPending]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-[2px] p-4"
      onClick={() => !del.isPending && onClose()}
      role="dialog"
      aria-modal="true"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full sm:max-w-md bg-[var(--bg-card)] border border-red-500/30 rounded-2xl shadow-2xl overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between gap-3">
          <div className="text-sm font-bold text-red-500">⚠️ 프로젝트 삭제</div>
          <button
            type="button"
            onClick={onClose}
            disabled={del.isPending}
            aria-label="닫기"
            className="w-7 h-7 flex items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-surface)] hover:text-[var(--text)] transition disabled:opacity-50"
          >
            ✕
          </button>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-xs text-[var(--text-muted)] leading-relaxed">
            이 작업은 칸반·리스트·활동 어디에서도 더 이상 보이지 않게 합니다.
            <br />회계 데이터(매출·비용·정산서·계약서)는 <span className="text-[var(--text)] font-semibold">보존</span>됩니다.
          </p>
          <div>
            <div className="text-[10px] text-[var(--text-dim)] mb-1">
              삭제할 프로젝트: <span className="text-[var(--text)] font-bold break-all">{target || "(이름 없음)"}</span>
            </div>
            <input
              type="text"
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="프로젝트명을 정확히 입력하세요"
              disabled={del.isPending}
              className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm text-[var(--text)] focus:outline-none focus:border-red-500 disabled:opacity-50"
            />
            {typed.length > 0 && !canDelete && (
              <div className="text-[10px] text-amber-500 mt-1">프로젝트명이 일치하지 않습니다</div>
            )}
          </div>
        </div>
        <div className="px-5 py-3 border-t border-[var(--border)] flex justify-end gap-2 bg-[var(--bg-surface)]/40">
          <button
            type="button"
            onClick={onClose}
            disabled={del.isPending}
            className="px-3 py-1.5 rounded-lg bg-[var(--bg)] hover:bg-[var(--bg-elevated)] text-[var(--text-muted)] text-xs font-semibold transition disabled:opacity-50"
          >
            취소
          </button>
          <button
            type="button"
            onClick={() => del.mutate()}
            disabled={!canDelete || del.isPending}
            className="px-4 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-bold transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {del.isPending ? "삭제 중…" : "🗑 삭제"}
          </button>
        </div>
      </div>
    </div>
  );
}
