"use client";

// PR3: 프로젝트 슬라이드 패널 (3탭: 개요 / 돈 / 활동)
//   /projects?deal=<id> URL 파라미터로 마운트. 카드 클릭으로 진입.
//   PR4 lib (project-rules.ts) 의 getProjectBadge / getNextAction / getMetaSummary 적극 활용.
//   - 권한 가드 없음: 부모 ProjectsPage 가 AccessDenied 로 차단.
//   - 데이터: getProjectDetail (1회 fetch, 7개 쿼리 병렬).
//   - 닫기: ✕ / ESC / 배경 클릭 — 모두 onClose 호출.
//   - 모바일: sm 이하 전체 화면, 그 위는 우측 슬라이드(max-w-2xl).

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { getProjectDetail } from "@/lib/queries";
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

// stage → 진행률 (%)
const STAGE_PROGRESS: Record<ProjectStage, number> = {
  estimate: 20,
  contract: 40,
  in_progress: 60,
  completed: 80,
  settlement: 100,
};

type Tab = "overview" | "money" | "activity";

interface ProjectSlideOverProps {
  dealId: string;
  companyId: string;
  onClose: () => void;
  onOpenStageModal?: () => void; // 단계 변경 모달 (부모가 관리)
  // PR3.5: 다음액션 CTA 가 ?action=<key> 로 진입 시 패널이 해당 탭/섹션으로 점프.
  //   적용 직후 부모에게 onActionConsumed 콜백으로 알려 URL 클리어.
  pendingAction?: string | null;
  onActionConsumed?: () => void;
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
  'progress':        { tab: 'activity', scroll: 'sec-activity' },
  'move-settlement': { tab: 'overview', scroll: 'sec-stage' },
  'archive':         { tab: 'overview', scroll: 'sec-stage' },
};

export function ProjectSlideOver({ dealId, companyId, onClose, onOpenStageModal, pendingAction, onActionConsumed }: ProjectSlideOverProps) {
  const [tab, setTab] = useState<Tab>("overview");

  // ESC 닫기
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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

  return (
    <div className="fixed inset-0 z-40 flex" aria-modal="true" role="dialog">
      {/* Backdrop */}
      <button
        type="button"
        onClick={onClose}
        aria-label="닫기"
        className="absolute inset-0 bg-black/40 backdrop-blur-[1px]"
      />
      {/* Panel — 모바일 전체, sm+ 우측 슬라이드 */}
      <div className="relative ml-auto w-full sm:max-w-2xl bg-[var(--bg-card)] border-l border-[var(--border)] shadow-2xl flex flex-col h-full overflow-hidden">
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
}: {
  data: PanelData;
  tab: Tab;
  onTabChange: (t: Tab) => void;
  onClose: () => void;
  onOpenStageModal?: () => void;
  dealId: string;
  companyId: string;
}) {
  const deal = data.deal;
  const stage = (deal.stage || "estimate") as ProjectStage;
  const stageColor = STAGE_COLOR[stage] || STAGE_COLOR.estimate;

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
              <span className="text-[10px] text-[var(--text-dim)]">
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

        {/* Tabs */}
        <div className="flex items-center gap-1 -mb-px">
          {(
            [
              { key: "overview", label: "개요" },
              { key: "money", label: "돈" },
              { key: "activity", label: "활동" },
            ] as { key: Tab; label: string }[]
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

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-5">
        {tab === "overview" && <OverviewTab data={data} stage={stage} />}
        {tab === "money" && <MoneyTab data={data} dealId={dealId} companyId={companyId} />}
        {tab === "activity" && <ActivityTab data={data} />}
      </div>
    </>
  );
}

// ────────────────────────────────────────────────
// 개요 탭
// ────────────────────────────────────────────────

function OverviewTab({ data, stage }: { data: PanelData; stage: ProjectStage }) {
  const deal = data.deal;
  const progress = STAGE_PROGRESS[stage] || 20;

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
        href={action.href || `/deals?detail=${deal.id}`}
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
          <InfoRow label="계약금액" value={`₩${Number(deal.contract_total || 0).toLocaleString()}`} />
          <InfoRow label="상태" value={deal.status || "—"} />
        </dl>
      </div>

      {/* 액션 버튼 */}
      <div className="flex items-center gap-2">
        <Link
          href={`/deals?detail=${deal.id}`}
          className="flex-1 px-3 py-2 text-xs font-semibold rounded-xl bg-[var(--bg-surface)] hover:bg-[var(--border)] text-[var(--text)] text-center transition"
        >
          편집 (상세)
        </Link>
        <Link
          href={`/deals?detail=${deal.id}&archive=1`}
          className="px-3 py-2 text-xs font-semibold rounded-xl bg-[var(--bg-surface)] hover:bg-[var(--border)] text-[var(--text-muted)] text-center transition"
        >
          아카이브
        </Link>
      </div>

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
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col">
      <dt className="text-[10px] text-[var(--text-dim)] mb-0.5">{label}</dt>
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

function MoneyTab({ data, dealId, companyId }: { data: PanelData; dealId: string; companyId: string }) {
  const contract = Number(data.deal.contract_total || 0);

  const expected = (data.revenue || []).filter((r: any) => r.status === "expected");
  const paid = (data.revenue || []).filter((r: any) => r.status === "paid");
  const expectedSum = expected.reduce((a: number, r: any) => a + Number(r.amount || 0), 0);
  const paidSum = paid.reduce((a: number, r: any) => a + Number(r.amount || 0), 0);

  const costSum = (data.costs || []).reduce((a: number, c: any) => a + Number(c.amount || 0), 0);
  const subSum = (data.subDeals || []).reduce((a: number, s: any) => a + Number(s.total_amount || 0), 0);
  const costTotal = costSum + subSum;

  const margin = contract - costTotal;
  const marginPct = contract > 0 ? Math.round((margin / contract) * 100) : 0;

  return (
    <div className="flex flex-col gap-4">
      {/* PR3.5: 견적 품목 / 결제 단계 — 패널 안에서 직접 편집·저장 */}
      <div id="sec-quote" className="transition-shadow">
        <ProjectQuoteStages dealId={dealId} companyId={companyId} />
      </div>
      {/* 받을 돈 */}
      <div id="sec-revenue" className="bg-[var(--bg-surface)] rounded-xl p-4 transition-shadow">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-bold text-[var(--text-muted)]">받을 돈 (수금)</h3>
          <Link href={`/deals?detail=${data.deal.id}`} className="text-[10px] text-[var(--primary)] hover:underline">
            편집 →
          </Link>
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
          <Link href={`/deals?detail=${data.deal.id}`} className="text-[10px] text-[var(--primary)] hover:underline">
            편집 →
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <KV label="비용 합계" value={`₩${costSum.toLocaleString()}`} />
          <KV label="외주 합계" value={`₩${subSum.toLocaleString()}`} />
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
                  <span className="text-[var(--text-muted)] truncate">{c.note || c.due_date || "—"}</span>
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
      <span className="text-[10px] text-[var(--text-dim)] mb-0.5">{label}</span>
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

function ActivityTab({ data }: { data: PanelData }) {
  return (
    <div id="sec-activity" className="flex flex-col gap-4 transition-shadow">
      {/* 담당자 목록 */}
      <Section title={`담당자 (${data.assignments.length})`}>
        {data.assignments.length === 0 ? (
          <Empty text="배정된 담당자 없음" />
        ) : (
          <ul className="flex flex-col gap-1.5">
            {data.assignments.map((a: any) => (
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
                <span className="text-[10px] px-2 py-0.5 rounded bg-[var(--bg-surface)] text-[var(--text-muted)] font-semibold">
                  {ROLE_LABEL[a.role] || a.role || "참여자"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* 파일 */}
      <Section
        title={`파일 (${data.documents.length})`}
        right={
          <Link href={`/documents?deal=${data.deal.id}`} className="text-[10px] text-[var(--primary)] hover:underline">
            전체보기 →
          </Link>
        }
      >
        {data.documents.length === 0 ? (
          <Empty text="문서 없음" />
        ) : (
          <ul className="flex flex-col gap-1.5">
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

      {/* 활동로그 */}
      <Section title={`활동 로그 (${data.auditLogs.length})`}>
        {data.auditLogs.length === 0 ? (
          <Empty text="활동 기록 없음" />
        ) : (
          <ul className="flex flex-col gap-1.5">
            {data.auditLogs.map((l: any) => (
              <li
                key={l.id}
                className="flex items-start gap-2 px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-xs"
              >
                <span className="text-[var(--text-dim)] shrink-0">·</span>
                <div className="flex-1 min-w-0">
                  <div className="text-[var(--text)]">
                    <span className="font-semibold">{formatAction(l.action)}</span>
                    {l.entity_name && <span className="text-[var(--text-muted)]"> — {l.entity_name}</span>}
                  </div>
                  <div className="text-[10px] text-[var(--text-dim)] mt-0.5">
                    {l.created_at ? new Date(l.created_at).toLocaleString("ko-KR") : ""}
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
