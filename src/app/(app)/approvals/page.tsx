"use client";

import { useEffect, useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getCurrentUser } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import {
  getApprovalPolicies,
  upsertApprovalPolicy,
  deleteApprovalPolicy,
  createApprovalRequest,
  approveStep,
  rejectStep,
  getMyPendingApprovals,
  getApprovalTimeline,
  getApprovalRequests,
  getMyRequests,
  resubmitRequest,
  getApprovalStats,
  REQUEST_TYPE_LABELS,
  type RequestType,
  type ApprovalPolicy,
  type ApprovalRequest,
  type ApprovalStep,
  type ApprovalStageConfig,
} from "@/lib/approval-workflow";

const db = supabase as any;

type Tab = "my-approvals" | "my-requests" | "all" | "new-request" | "policies";

// ── Status config ──
const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  pending: { label: "대기", bg: "bg-yellow-500/10", text: "text-yellow-500" },
  approved: { label: "승인", bg: "bg-green-500/10", text: "text-green-500" },
  rejected: { label: "반려", bg: "bg-red-500/10", text: "text-red-500" },
  cancelled: { label: "취소", bg: "bg-gray-500/10", text: "text-gray-400" },
  skipped: { label: "건너뜀", bg: "bg-gray-500/10", text: "text-gray-400" },
};

function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${config.bg} ${config.text}`}>
      {config.label}
    </span>
  );
}

function formatAmount(amount: number) {
  if (!amount) return "-";
  return `₩${amount.toLocaleString()}`;
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function formatDateTime(dateStr: string | null) {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ══════════════════════════════════════════════
// Main Page
// ══════════════════════════════════════════════

export default function ApprovalsPage() {
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("my-approvals");
  const queryClient = useQueryClient();

  useEffect(() => {
    getCurrentUser().then((u) => {
      if (u) {
        setCompanyId(u.company_id);
        setUserId(u.id);
        setUserRole(u.role);
      }
    });
  }, []);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["my-pending-approvals"] });
    queryClient.invalidateQueries({ queryKey: ["my-requests"] });
    queryClient.invalidateQueries({ queryKey: ["all-requests"] });
    queryClient.invalidateQueries({ queryKey: ["approval-stats"] });
    queryClient.invalidateQueries({ queryKey: ["approval-policies"] });
  };

  // Stats
  const { data: stats } = useQuery({
    queryKey: ["approval-stats", companyId],
    queryFn: () => getApprovalStats(companyId!),
    enabled: !!companyId,
  });

  const isAdmin = userRole === "ceo" || userRole === "admin" || userRole === "owner";

  const TABS: { key: Tab; label: string; count?: number }[] = [
    { key: "my-approvals", label: "내 결재함", count: stats?.pending },
    { key: "my-requests", label: "내 요청" },
    ...(isAdmin ? [{ key: "all" as Tab, label: "전체 현황" }] : []),
    { key: "new-request", label: "새 요청" },
    ...(isAdmin ? [{ key: "policies" as Tab, label: "정책 관리" }] : []),
  ];

  return (
    <div className="max-w-[1100px]">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold">결재 관리</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">다단계 결재 워크플로우 + 승인/반려 + 정책 관리</p>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
          <div className="text-xs text-[var(--text-dim)]">대기 중</div>
          <div className="text-lg font-bold text-yellow-500 mt-1">{stats?.pending ?? 0}건</div>
        </div>
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
          <div className="text-xs text-[var(--text-dim)]">승인 완료</div>
          <div className="text-lg font-bold text-green-500 mt-1">{stats?.approved ?? 0}건</div>
        </div>
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
          <div className="text-xs text-[var(--text-dim)]">반려</div>
          <div className="text-lg font-bold text-red-500 mt-1">{stats?.rejected ?? 0}건</div>
        </div>
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
          <div className="text-xs text-[var(--text-dim)]">전체 요청</div>
          <div className="text-lg font-bold mt-1">{stats?.total ?? 0}건</div>
        </div>
      </div>

      {/* Tab navigation */}
      <div className="flex gap-1 mb-6 bg-[var(--bg-card)] rounded-xl p-1 border border-[var(--border)]">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 px-4 py-2.5 rounded-lg text-xs font-semibold transition ${
              tab === t.key
                ? "bg-[var(--primary)] text-white"
                : "text-[var(--text-muted)] hover:text-[var(--text)]"
            }`}
          >
            {t.label}
            {t.count !== undefined && t.count > 0 && (
              <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-white/20">{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "my-approvals" && companyId && userId && (
        <MyApprovalsTab companyId={companyId} userId={userId} invalidate={invalidate} />
      )}
      {tab === "my-requests" && companyId && userId && (
        <MyRequestsTab companyId={companyId} userId={userId} invalidate={invalidate} />
      )}
      {tab === "all" && companyId && (
        <AllRequestsTab companyId={companyId} />
      )}
      {tab === "new-request" && companyId && userId && (
        <NewRequestTab companyId={companyId} userId={userId} invalidate={invalidate} onComplete={() => setTab("my-requests")} />
      )}
      {tab === "policies" && companyId && (
        <PoliciesTab companyId={companyId} invalidate={invalidate} />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════
// Tab 1: 내 결재함
// ══════════════════════════════════════════════

function MyApprovalsTab({ companyId, userId, invalidate }: {
  companyId: string; userId: string; invalidate: () => void;
}) {
  const [actionModal, setActionModal] = useState<{ stepId: string; action: "approve" | "reject"; title: string } | null>(null);
  const [comment, setComment] = useState("");

  const { data: pendingApprovals = [], isLoading } = useQuery({
    queryKey: ["my-pending-approvals", userId, companyId],
    queryFn: () => getMyPendingApprovals(userId, companyId),
    enabled: !!userId && !!companyId,
  });

  const approveMut = useMutation({
    mutationFn: ({ stepId, comment }: { stepId: string; comment?: string }) =>
      approveStep(stepId, userId, comment),
    onSuccess: () => {
      invalidate();
      setActionModal(null);
      setComment("");
    },
  });

  const rejectMut = useMutation({
    mutationFn: ({ stepId, comment }: { stepId: string; comment: string }) =>
      rejectStep(stepId, userId, comment),
    onSuccess: () => {
      invalidate();
      setActionModal(null);
      setComment("");
    },
  });

  if (isLoading) {
    return <div className="text-center py-12 text-[var(--text-muted)]">로딩 중...</div>;
  }

  return (
    <div>
      {pendingApprovals.length === 0 ? (
        <div className="text-center py-16 bg-[var(--bg-card)] rounded-2xl border border-[var(--border)]">
          <div className="text-3xl mb-3">&#10003;</div>
          <div className="text-[var(--text-muted)] text-sm">처리할 결재가 없습니다</div>
        </div>
      ) : (
        <div className="space-y-3">
          {pendingApprovals.map((item: any) => (
            <div key={item.stepId} className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-[var(--primary)]/10 text-[var(--primary)]">
                      {REQUEST_TYPE_LABELS[item.requestType as RequestType] || item.requestType}
                    </span>
                    <span className="text-[11px] text-[var(--text-dim)]">
                      {item.currentStage}/{item.totalStages}단계 - {item.stageName}
                    </span>
                  </div>
                  <div className="font-semibold text-sm truncate">{item.title}</div>
                  <div className="flex items-center gap-3 mt-2 text-xs text-[var(--text-muted)]">
                    <span>요청자: {item.requesterName || "알 수 없음"}</span>
                    {item.amount > 0 && <span className="font-semibold text-[var(--text)]">{formatAmount(item.amount)}</span>}
                    <span>{formatDate(item.createdAt)}</span>
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => setActionModal({ stepId: item.stepId, action: "approve", title: item.title })}
                    className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs font-semibold transition"
                  >
                    승인
                  </button>
                  <button
                    onClick={() => setActionModal({ stepId: item.stepId, action: "reject", title: item.title })}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-semibold transition"
                  >
                    반려
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Approve/Reject Modal */}
      {actionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setActionModal(null)}>
          <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6 w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-1">
              {actionModal.action === "approve" ? "결재 승인" : "결재 반려"}
            </h3>
            <p className="text-sm text-[var(--text-muted)] mb-4 truncate">{actionModal.title}</p>

            <div className="mb-4">
              <label className="block text-xs text-[var(--text-muted)] mb-1">
                {actionModal.action === "approve" ? "코멘트 (선택)" : "반려 사유 (필수)"}
              </label>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={3}
                placeholder={actionModal.action === "approve" ? "승인 의견을 입력하세요..." : "반려 사유를 입력하세요..."}
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)] resize-none"
              />
            </div>

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => { setActionModal(null); setComment(""); }}
                className="px-4 py-2 text-[var(--text-muted)] text-sm hover:text-[var(--text)] transition"
              >
                취소
              </button>
              {actionModal.action === "approve" ? (
                <button
                  onClick={() => approveMut.mutate({ stepId: actionModal.stepId, comment: comment || undefined })}
                  disabled={approveMut.isPending}
                  className="px-5 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50 transition"
                >
                  {approveMut.isPending ? "처리 중..." : "승인"}
                </button>
              ) : (
                <button
                  onClick={() => comment.trim() && rejectMut.mutate({ stepId: actionModal.stepId, comment })}
                  disabled={!comment.trim() || rejectMut.isPending}
                  className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50 transition"
                >
                  {rejectMut.isPending ? "처리 중..." : "반려"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════
// Tab 2: 내 요청
// ══════════════════════════════════════════════

function MyRequestsTab({ companyId, userId, invalidate }: {
  companyId: string; userId: string; invalidate: () => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ["my-requests", userId, companyId],
    queryFn: () => getMyRequests(userId, companyId),
    enabled: !!userId && !!companyId,
  });

  const resubmitMut = useMutation({
    mutationFn: (requestId: string) => resubmitRequest(requestId),
    onSuccess: invalidate,
  });

  if (isLoading) {
    return <div className="text-center py-12 text-[var(--text-muted)]">로딩 중...</div>;
  }

  return (
    <div>
      {requests.length === 0 ? (
        <div className="text-center py-16 bg-[var(--bg-card)] rounded-2xl border border-[var(--border)]">
          <div className="text-[var(--text-muted)] text-sm">제출한 결재 요청이 없습니다</div>
        </div>
      ) : (
        <div className="space-y-3">
          {requests.map((req: any) => (
            <div key={req.id} className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden">
              <div
                className="p-5 cursor-pointer hover:bg-[var(--bg-surface)] transition"
                onClick={() => setExpandedId(expandedId === req.id ? null : req.id)}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <StatusBadge status={req.status} />
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-[var(--bg-surface)] text-[var(--text-muted)]">
                        {REQUEST_TYPE_LABELS[req.request_type as RequestType] || req.request_type}
                      </span>
                    </div>
                    <div className="font-semibold text-sm truncate">{req.title}</div>
                    <div className="flex items-center gap-3 mt-2 text-xs text-[var(--text-muted)]">
                      {req.amount > 0 && <span className="font-semibold text-[var(--text)]">{formatAmount(req.amount)}</span>}
                      <span>{formatDate(req.created_at)}</span>
                      <span>{req.current_stage}/{req.total_stages}단계</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {req.status === "rejected" && (
                      <button
                        onClick={(e) => { e.stopPropagation(); resubmitMut.mutate(req.id); }}
                        disabled={resubmitMut.isPending}
                        className="px-3 py-1.5 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-lg text-xs font-semibold disabled:opacity-50 transition"
                      >
                        재제출
                      </button>
                    )}
                    <svg className={`w-4 h-4 text-[var(--text-muted)] transition-transform ${expandedId === req.id ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>
              </div>

              {/* Expanded: Timeline */}
              {expandedId === req.id && (
                <div className="border-t border-[var(--border)] px-5 py-4 bg-[var(--bg)]">
                  <ApprovalTimelineView requestId={req.id} currentStage={req.current_stage} totalStages={req.total_stages} requestStatus={req.status} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════
// Tab 3: 전체 현황 (Admin)
// ══════════════════════════════════════════════

function AllRequestsTab({ companyId }: { companyId: string }) {
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: allRequests = [], isLoading } = useQuery({
    queryKey: ["all-requests", companyId, statusFilter, typeFilter],
    queryFn: () => getApprovalRequests(companyId, {
      status: statusFilter || undefined,
      requestType: typeFilter || undefined,
    }),
    enabled: !!companyId,
  });

  // Enrich with requester names
  const requesterNames = useMemo(() => {
    const map = new Map<string, string>();
    allRequests.forEach((r: any) => {
      if (r.users) map.set(r.requester_id, r.users.name || r.users.email || "");
    });
    return map;
  }, [allRequests]);

  if (isLoading) {
    return <div className="text-center py-12 text-[var(--text-muted)]">로딩 중...</div>;
  }

  const statusOptions = [
    { value: "", label: "전체 상태" },
    { value: "pending", label: "대기" },
    { value: "approved", label: "승인" },
    { value: "rejected", label: "반려" },
    { value: "cancelled", label: "취소" },
  ];

  const typeOptions = [
    { value: "", label: "전체 유형" },
    ...Object.entries(REQUEST_TYPE_LABELS).map(([k, v]) => ({ value: k, label: v })),
  ];

  return (
    <div>
      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
        >
          {statusOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="px-3 py-2 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
        >
          {typeOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <div className="flex-1" />
        <div className="text-xs text-[var(--text-muted)] self-center">{allRequests.length}건</div>
      </div>

      {/* Table */}
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-[var(--border)]">
              <th className="px-4 py-3 text-xs font-semibold text-[var(--text-muted)]">상태</th>
              <th className="px-4 py-3 text-xs font-semibold text-[var(--text-muted)]">유형</th>
              <th className="px-4 py-3 text-xs font-semibold text-[var(--text-muted)]">제목</th>
              <th className="px-4 py-3 text-xs font-semibold text-[var(--text-muted)]">요청자</th>
              <th className="px-4 py-3 text-xs font-semibold text-[var(--text-muted)] text-right">금액</th>
              <th className="px-4 py-3 text-xs font-semibold text-[var(--text-muted)]">진행</th>
              <th className="px-4 py-3 text-xs font-semibold text-[var(--text-muted)]">요청일</th>
            </tr>
          </thead>
          <tbody>
            {allRequests.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-sm text-[var(--text-muted)]">
                  결재 요청이 없습니다
                </td>
              </tr>
            ) : (
              allRequests.map((req: any) => (
                <tr
                  key={req.id}
                  className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--bg-surface)] cursor-pointer transition"
                  onClick={() => setExpandedId(expandedId === req.id ? null : req.id)}
                >
                  <td className="px-4 py-3"><StatusBadge status={req.status} /></td>
                  <td className="px-4 py-3 text-xs text-[var(--text-muted)]">
                    {REQUEST_TYPE_LABELS[req.request_type as RequestType] || req.request_type}
                  </td>
                  <td className="px-4 py-3 text-sm font-medium truncate max-w-[200px]">{req.title}</td>
                  <td className="px-4 py-3 text-xs text-[var(--text-muted)]">
                    {requesterNames.get(req.requester_id) || "-"}
                  </td>
                  <td className="px-4 py-3 text-sm font-medium text-right">{formatAmount(req.amount)}</td>
                  <td className="px-4 py-3 text-xs text-[var(--text-muted)]">
                    {req.current_stage}/{req.total_stages}
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--text-muted)]">{formatDate(req.created_at)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Inline expanded timeline */}
        {expandedId && (
          <div className="border-t border-[var(--border)] px-5 py-4 bg-[var(--bg)]">
            {(() => {
              const req = allRequests.find((r: any) => r.id === expandedId);
              if (!req) return null;
              return (
                <ApprovalTimelineView
                  requestId={req.id}
                  currentStage={req.current_stage}
                  totalStages={req.total_stages}
                  requestStatus={req.status}
                />
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Description templates per request type ──
const DESCRIPTION_TEMPLATES: Partial<Record<RequestType, string>> = {
  expense: "1. 지출 항목:\n2. 지출 사유:\n3. 비용 세부내역:\n4. 증빙 서류: 첨부파일 참조",
  payment: "1. 결제 대상:\n2. 결제 사유:\n3. 결제 방법 (계좌이체/카드):",
  overtime: "1. 초과근무 일시:\n2. 초과근무 사유:\n3. 예상 시간:",
  purchase: "1. 구매 품목:\n2. 구매 사유:\n3. 수량 및 단가:\n4. 납품 예정일:",
  contract: "1. 계약 상대방:\n2. 계약 내용 요약:\n3. 계약 기간:\n4. 계약 금액:",
  travel: "1. 출장지:\n2. 출장 기간:\n3. 출장 목적:\n4. 예상 경비 내역:",
  card_expense: "1. 사용처:\n2. 사용 일시:\n3. 사용 사유:\n4. 증빙: 첨부파일 참조",
  equipment: "1. 장비명/사양:\n2. 용도:\n3. 수량:",
  approval_doc: "1. 품의 내용:\n2. 추진 배경 및 사유:\n3. 기대 효과:\n4. 소요 예산:",
  expense_report: "1. 지출 항목 및 내역:\n2. 지출 목적:\n3. 증빙 서류: 첨부파일 참조",
};

const LEAVE_TYPE_OPTIONS = [
  { value: "annual", label: "연차" },
  { value: "sick", label: "병가" },
  { value: "personal", label: "경조사" },
  { value: "maternity", label: "출산휴가" },
  { value: "paternity", label: "배우자출산휴가" },
  { value: "compensation", label: "대체휴무" },
];

const LEAVE_UNIT_OPTIONS = [
  { value: "full_day", label: "종일", days: 1 },
  { value: "half_day", label: "반차 (0.5일)", days: 0.5 },
  { value: "two_hours", label: "2시간 (0.25일)", days: 0.25 },
];

// ══════════════════════════════════════════════
// Tab 4: 새 요청
// ══════════════════════════════════════════════

function NewRequestTab({ companyId, userId, invalidate, onComplete }: {
  companyId: string; userId: string; invalidate: () => void; onComplete: () => void;
}) {
  const [form, setForm] = useState({
    requestType: "expense" as RequestType,
    title: "",
    amount: "",
    description: "",
  });
  // Leave-specific fields
  const [leaveForm, setLeaveForm] = useState({
    leaveType: "annual",
    leaveUnit: "full_day",
    startDate: "",
    endDate: "",
    startTime: "",
    endTime: "",
    reason: "",
  });
  const [files, setFiles] = useState<File[]>([]);
  const [descriptionInited, setDescriptionInited] = useState<string>(""); // track which type was last inited

  const isLeave = form.requestType === "leave";

  // Fetch current user's employee record (match by email)
  const { data: currentEmployee } = useQuery({
    queryKey: ["my-employee", companyId, userId],
    queryFn: async () => {
      // Get user email
      const { data: user } = await db.from("users").select("email, name").eq("id", userId).single();
      if (!user?.email) return null;
      // Find matching employee
      const { data: emp } = await db.from("employees").select("id, name, email, department").eq("company_id", companyId).eq("email", user.email).maybeSingle();
      return emp ? { ...emp, userName: user.name } : { id: null, name: user.name, userName: user.name };
    },
    enabled: !!companyId && !!userId,
  });

  // Fetch leave balance for current year
  const currentYear = new Date().getFullYear();
  const { data: leaveBalance } = useQuery({
    queryKey: ["my-leave-balance", currentEmployee?.id, currentYear],
    queryFn: async () => {
      const { data } = await db.from("leave_balances").select("total_days, used_days").eq("employee_id", currentEmployee!.id).eq("year", currentYear).maybeSingle();
      return data;
    },
    enabled: !!currentEmployee?.id && isLeave,
  });

  const remainingLeave = leaveBalance ? Number(leaveBalance.total_days) - Number(leaveBalance.used_days) : null;

  // Calculate leave days
  const leaveDays = useMemo(() => {
    if (leaveForm.leaveUnit === "half_day") return 0.5;
    if (leaveForm.leaveUnit === "two_hours") return 0.25;
    if (!leaveForm.startDate) return 0;
    const start = new Date(leaveForm.startDate);
    const end = leaveForm.endDate ? new Date(leaveForm.endDate) : start;
    return Math.ceil(Math.abs(end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  }, [leaveForm.leaveUnit, leaveForm.startDate, leaveForm.endDate]);

  // Auto-generate leave title
  const leaveTitle = useMemo(() => {
    const typeLabel = LEAVE_TYPE_OPTIONS.find((t) => t.value === leaveForm.leaveType)?.label || "휴가";
    const unitLabel = LEAVE_UNIT_OPTIONS.find((u) => u.value === leaveForm.leaveUnit)?.label?.split(" ")[0] || "";
    const empName = currentEmployee?.name || "";

    if (!leaveForm.startDate) return `${empName} ${typeLabel} 신청`;
    const startStr = leaveForm.startDate.replace(/-/g, ".");
    if (leaveForm.leaveUnit !== "full_day") {
      return `${empName} ${typeLabel} 신청 (${startStr}, ${unitLabel})`;
    }
    const endStr = (leaveForm.endDate || leaveForm.startDate).replace(/-/g, ".");
    if (startStr === endStr) return `${empName} ${typeLabel} 신청 (${startStr}, ${leaveDays}일)`;
    return `${empName} ${typeLabel} 신청 (${startStr}~${endStr}, ${leaveDays}일)`;
  }, [leaveForm, leaveDays, currentEmployee]);

  // Auto-generate leave description
  const leaveDescription = useMemo(() => {
    const typeLabel = LEAVE_TYPE_OPTIONS.find((t) => t.value === leaveForm.leaveType)?.label || "";
    const unitLabel = LEAVE_UNIT_OPTIONS.find((u) => u.value === leaveForm.leaveUnit)?.label || "";
    const startStr = leaveForm.startDate ? leaveForm.startDate.replace(/-/g, ".") : "미선택";
    const endStr = leaveForm.endDate ? leaveForm.endDate.replace(/-/g, ".") : startStr;

    let lines = `[휴가 신청서]\n\n`;
    lines += `- 신청자: ${currentEmployee?.name || ""}\n`;
    lines += `- 휴가 유형: ${typeLabel}\n`;
    lines += `- 휴가 단위: ${unitLabel}\n`;
    if (leaveForm.leaveUnit === "full_day") {
      lines += `- 휴가 기간: ${startStr} ~ ${endStr} (${leaveDays}일)\n`;
    } else if (leaveForm.leaveUnit === "half_day") {
      lines += `- 휴가 일자: ${startStr} (반차)\n`;
    } else {
      lines += `- 휴가 일자: ${startStr}\n`;
      if (leaveForm.startTime && leaveForm.endTime) {
        lines += `- 시간: ${leaveForm.startTime} ~ ${leaveForm.endTime}\n`;
      }
    }
    if (remainingLeave !== null && leaveForm.leaveType === "annual") {
      lines += `- 잔여 연차: ${remainingLeave}일 (사용 후 ${Math.max(0, remainingLeave - leaveDays)}일)\n`;
    }
    lines += `\n사유:\n${leaveForm.reason || ""}`;
    return lines;
  }, [leaveForm, leaveDays, remainingLeave, currentEmployee]);

  // Auto-fill description template when type changes
  useEffect(() => {
    if (isLeave || form.requestType === descriptionInited) return;
    const template = DESCRIPTION_TEMPLATES[form.requestType] || "";
    setForm((prev) => ({ ...prev, description: template }));
    setDescriptionInited(form.requestType);
  }, [form.requestType, isLeave, descriptionInited]);

  // Load policies for preview
  const { data: policies = [] } = useQuery({
    queryKey: ["approval-policies", companyId],
    queryFn: () => getApprovalPolicies(companyId),
    enabled: !!companyId,
  });

  // Find matching policy for preview
  const matchedPolicy = useMemo(() => {
    const byType = policies.find((p: ApprovalPolicy) => p.document_type === form.requestType && p.is_active);
    if (byType) return byType;
    return policies.find((p: ApprovalPolicy) => p.document_type === "default" && p.is_active) || null;
  }, [policies, form.requestType]);

  const effectiveTitle = isLeave ? leaveTitle : form.title;
  const effectiveDescription = isLeave ? leaveDescription : form.description;
  const effectiveAmount = isLeave ? 0 : (Number(form.amount) || 0);

  const canSubmit = isLeave
    ? !!leaveForm.startDate && !!leaveForm.leaveType
    : !!form.title.trim();

  const createMut = useMutation({
    mutationFn: async () => {
      // Upload attachments if any
      let attachmentUrls: string[] = [];
      if (files.length > 0) {
        for (const file of files) {
          const path = `approvals/${companyId}/${Date.now()}_${file.name}`;
          const { error } = await supabase.storage.from("documents").upload(path, file);
          if (!error) {
            const { data: urlData } = supabase.storage.from("documents").getPublicUrl(path);
            attachmentUrls.push(urlData.publicUrl);
          }
        }
      }

      return createApprovalRequest({
        companyId,
        requestType: form.requestType,
        requesterId: userId,
        title: effectiveTitle,
        amount: effectiveAmount,
        description: effectiveDescription || undefined,
        attachments: attachmentUrls.length > 0 ? attachmentUrls : undefined,
      });
    },
    onSuccess: () => {
      invalidate();
      setForm({ requestType: "expense", title: "", amount: "", description: "" });
      setLeaveForm({ leaveType: "annual", leaveUnit: "full_day", startDate: "", endDate: "", startTime: "", endTime: "", reason: "" });
      setFiles([]);
      setDescriptionInited("");
      onComplete();
    },
  });

  return (
    <div className="grid grid-cols-3 gap-6">
      {/* Form */}
      <div className="col-span-2">
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6">
          <h3 className="text-sm font-bold mb-5">새 결재 요청</h3>

          <div className="space-y-4">
            {/* Request Type */}
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">요청 유형 *</label>
              <select
                value={form.requestType}
                onChange={(e) => setForm({ ...form, requestType: e.target.value as RequestType })}
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
              >
                {Object.entries(REQUEST_TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>

            {/* ── Leave-specific fields ── */}
            {isLeave ? (
              <>
                {/* Leave balance info */}
                {leaveForm.leaveType === "annual" && (
                  <div className="flex items-center gap-3 px-4 py-3 bg-blue-500/5 rounded-xl border border-blue-500/20">
                    <div className="text-2xl font-extrabold text-blue-500">
                      {remainingLeave !== null ? remainingLeave : "-"}
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-blue-500">잔여 연차</div>
                      {leaveBalance && (
                        <div className="text-[11px] text-[var(--text-muted)]">
                          총 {leaveBalance.total_days}일 중 {leaveBalance.used_days}일 사용
                        </div>
                      )}
                      {!leaveBalance && currentEmployee?.id && (
                        <div className="text-[11px] text-[var(--text-dim)]">연차 정보가 없습니다 (인력관리에서 설정)</div>
                      )}
                    </div>
                    {remainingLeave !== null && leaveDays > 0 && (
                      <div className="ml-auto text-right">
                        <div className="text-xs text-[var(--text-muted)]">신청 후 잔여</div>
                        <div className={`text-sm font-bold ${remainingLeave - leaveDays < 0 ? "text-red-500" : "text-green-500"}`}>
                          {Math.max(0, remainingLeave - leaveDays)}일
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Leave type + unit */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-[var(--text-muted)] mb-1">휴가 유형 *</label>
                    <select
                      value={leaveForm.leaveType}
                      onChange={(e) => setLeaveForm({ ...leaveForm, leaveType: e.target.value })}
                      className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
                    >
                      {LEAVE_TYPE_OPTIONS.map((t) => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--text-muted)] mb-1">휴가 단위 *</label>
                    <select
                      value={leaveForm.leaveUnit}
                      onChange={(e) => setLeaveForm({ ...leaveForm, leaveUnit: e.target.value })}
                      className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
                    >
                      {LEAVE_UNIT_OPTIONS.map((u) => (
                        <option key={u.value} value={u.value}>{u.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Date selection */}
                <div className={`grid ${leaveForm.leaveUnit === "full_day" ? "grid-cols-2" : ""} gap-3`}>
                  <div>
                    <label className="block text-xs text-[var(--text-muted)] mb-1">
                      {leaveForm.leaveUnit === "full_day" ? "시작일 *" : "휴가일 *"}
                    </label>
                    <input
                      type="date"
                      value={leaveForm.startDate}
                      onChange={(e) => setLeaveForm({ ...leaveForm, startDate: e.target.value, endDate: leaveForm.leaveUnit !== "full_day" ? e.target.value : leaveForm.endDate })}
                      className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
                    />
                  </div>
                  {leaveForm.leaveUnit === "full_day" && (
                    <div>
                      <label className="block text-xs text-[var(--text-muted)] mb-1">종료일 *</label>
                      <input
                        type="date"
                        value={leaveForm.endDate}
                        min={leaveForm.startDate}
                        onChange={(e) => setLeaveForm({ ...leaveForm, endDate: e.target.value })}
                        className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
                      />
                    </div>
                  )}
                </div>

                {/* Time selection for 2-hour leave */}
                {leaveForm.leaveUnit === "two_hours" && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-[var(--text-muted)] mb-1">시작 시간</label>
                      <input
                        type="time"
                        value={leaveForm.startTime}
                        onChange={(e) => setLeaveForm({ ...leaveForm, startTime: e.target.value })}
                        className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-[var(--text-muted)] mb-1">종료 시간</label>
                      <input
                        type="time"
                        value={leaveForm.endTime}
                        onChange={(e) => setLeaveForm({ ...leaveForm, endTime: e.target.value })}
                        className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
                      />
                    </div>
                  </div>
                )}

                {/* Leave days summary */}
                {leaveForm.startDate && (
                  <div className="flex items-center gap-2 px-3 py-2 bg-[var(--bg-surface)] rounded-lg">
                    <span className="text-xs text-[var(--text-muted)]">사용 일수:</span>
                    <span className="text-sm font-bold text-[var(--primary)]">{leaveDays}일</span>
                    {remainingLeave !== null && leaveDays > remainingLeave && leaveForm.leaveType === "annual" && (
                      <span className="text-xs text-red-500 font-semibold ml-2">잔여 연차 초과</span>
                    )}
                  </div>
                )}

                {/* Auto-generated title preview */}
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">제목 (자동 생성)</label>
                  <div className="px-3 py-2.5 bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl text-sm text-[var(--text)]">
                    {leaveTitle || "날짜를 선택하면 자동으로 생성됩니다"}
                  </div>
                </div>

                {/* Reason */}
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">사유</label>
                  <textarea
                    value={leaveForm.reason}
                    onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })}
                    rows={2}
                    placeholder="휴가 사유를 입력하세요..."
                    className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)] resize-none"
                  />
                </div>
              </>
            ) : (
              /* ── Non-leave fields ── */
              <>
                {/* Title */}
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">제목 *</label>
                  <input
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    placeholder="결재 요청 제목을 입력하세요"
                    className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
                  />
                </div>

                {/* Amount */}
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">금액 (원)</label>
                  <input
                    type="number"
                    value={form.amount}
                    onChange={(e) => setForm({ ...form, amount: e.target.value })}
                    placeholder="0"
                    className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
                  />
                </div>

                {/* Description with template */}
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">상세 내용</label>
                  <textarea
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    rows={6}
                    placeholder="결재 요청에 대한 상세 설명을 입력하세요..."
                    className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)] resize-none"
                  />
                </div>
              </>
            )}

            {/* File upload (shared) */}
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">첨부파일</label>
              <input
                type="file"
                multiple
                onChange={(e) => setFiles(Array.from(e.target.files || []))}
                className="w-full text-sm text-[var(--text-muted)] file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-[var(--primary)]/10 file:text-[var(--primary)] hover:file:bg-[var(--primary)]/20 cursor-pointer"
              />
              {files.length > 0 && (
                <div className="mt-2 text-xs text-[var(--text-muted)]">
                  {files.map((f, i) => (
                    <div key={i} className="flex items-center gap-1">
                      <span>&#128206;</span> {f.name} ({(f.size / 1024).toFixed(1)}KB)
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-2 mt-6">
            <button
              onClick={() => canSubmit && createMut.mutate()}
              disabled={!canSubmit || createMut.isPending}
              className="px-6 py-2.5 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl text-sm font-semibold disabled:opacity-50 transition"
            >
              {createMut.isPending ? "제출 중..." : "결재 요청"}
            </button>
          </div>

          {createMut.isError && (
            <div className="mt-3 text-xs text-red-500">
              오류: {(createMut.error as Error)?.message || "요청 제출에 실패했습니다."}
            </div>
          )}
        </div>
      </div>

      {/* Right sidebar */}
      <div className="space-y-4">
        {/* Auto-generated document preview (leave) */}
        {isLeave && leaveForm.startDate && (
          <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-5">
            <h4 className="text-xs font-bold text-[var(--text-muted)] mb-3 uppercase tracking-wider">문서 미리보기</h4>
            <pre className="text-xs text-[var(--text)] whitespace-pre-wrap leading-relaxed bg-[var(--bg)] rounded-xl p-3 border border-[var(--border)]">
              {leaveDescription}
            </pre>
          </div>
        )}

        {/* Policy Preview */}
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-5 sticky top-4">
          <h4 className="text-xs font-bold text-[var(--text-muted)] mb-3 uppercase tracking-wider">결재 흐름 미리보기</h4>

          {matchedPolicy ? (
            <div>
              <div className="text-sm font-semibold mb-1">{matchedPolicy.name}</div>
              {matchedPolicy.auto_approve_below > 0 && (
                <div className="text-[11px] text-[var(--text-muted)] mb-3">
                  {formatAmount(matchedPolicy.auto_approve_below)} 미만 자동 승인
                </div>
              )}
              <div className="space-y-0">
                {(matchedPolicy.stages as ApprovalStageConfig[]).map((stage, idx) => (
                  <div key={idx} className="relative pl-6 pb-4">
                    {/* Connector line */}
                    {idx < (matchedPolicy.stages as ApprovalStageConfig[]).length - 1 && (
                      <div className="absolute left-[9px] top-5 bottom-0 w-px bg-[var(--border)]" />
                    )}
                    {/* Circle */}
                    <div className="absolute left-0 top-0.5 w-[18px] h-[18px] rounded-full border-2 border-[var(--border)] bg-[var(--bg-card)] flex items-center justify-center text-[10px] font-bold text-[var(--text-muted)]">
                      {stage.stage}
                    </div>
                    <div>
                      <div className="text-xs font-semibold">{stage.name}</div>
                      <div className="text-[11px] text-[var(--text-muted)]">
                        승인자: {stage.approver_role}
                        {(stage.required_count ?? 1) > 1 && ` (${stage.required_count}명)`}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Auto-approve indicator */}
              {matchedPolicy.auto_approve_below > 0 && effectiveAmount > 0 && effectiveAmount < matchedPolicy.auto_approve_below && (
                <div className="mt-2 px-3 py-2 bg-green-500/10 rounded-lg text-xs text-green-500 font-semibold">
                  자동 승인 대상 (금액 기준 충족)
                </div>
              )}
            </div>
          ) : (
            <div className="text-xs text-[var(--text-muted)]">
              <p className="mb-2">매칭되는 결재 정책이 없습니다.</p>
              <p>기본 정책(최종 승인 1단계)이 적용됩니다.</p>
              <div className="mt-3 relative pl-6">
                <div className="absolute left-0 top-0.5 w-[18px] h-[18px] rounded-full border-2 border-[var(--border)] bg-[var(--bg-card)] flex items-center justify-center text-[10px] font-bold text-[var(--text-muted)]">
                  1
                </div>
                <div>
                  <div className="text-xs font-semibold text-[var(--text)]">최종 승인</div>
                  <div className="text-[11px]">승인자: CEO</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════
// Tab 5: 정책 관리 (Admin)
// ══════════════════════════════════════════════

function PoliciesTab({ companyId, invalidate }: { companyId: string; invalidate: () => void }) {
  const [showForm, setShowForm] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<ApprovalPolicy | null>(null);
  const [form, setForm] = useState({
    name: "",
    documentType: "expense",
    autoApproveBelow: "",
    stages: [{ stage: 1, name: "팀장 승인", approver_role: "manager" }] as ApprovalStageConfig[],
  });

  const { data: policies = [], isLoading } = useQuery({
    queryKey: ["approval-policies", companyId],
    queryFn: () => getApprovalPolicies(companyId),
    enabled: !!companyId,
  });

  const upsertMut = useMutation({
    mutationFn: () =>
      upsertApprovalPolicy({
        id: editingPolicy?.id,
        company_id: companyId,
        name: form.name,
        document_type: form.documentType,
        stages: form.stages,
        auto_approve_below: Number(form.autoApproveBelow) || 0,
        is_active: true,
      }),
    onSuccess: () => {
      invalidate();
      resetForm();
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteApprovalPolicy(id),
    onSuccess: invalidate,
  });

  function resetForm() {
    setShowForm(false);
    setEditingPolicy(null);
    setForm({
      name: "",
      documentType: "expense",
      autoApproveBelow: "",
      stages: [{ stage: 1, name: "팀장 승인", approver_role: "manager" }],
    });
  }

  function startEdit(policy: ApprovalPolicy) {
    setEditingPolicy(policy);
    setForm({
      name: policy.name,
      documentType: policy.document_type,
      autoApproveBelow: policy.auto_approve_below ? String(policy.auto_approve_below) : "",
      stages: policy.stages as ApprovalStageConfig[],
    });
    setShowForm(true);
  }

  function addStage() {
    const nextStage = form.stages.length + 1;
    setForm({
      ...form,
      stages: [...form.stages, { stage: nextStage, name: "", approver_role: "ceo" }],
    });
  }

  function removeStage(idx: number) {
    if (form.stages.length <= 1) return;
    const updated = form.stages.filter((_, i) => i !== idx).map((s, i) => ({ ...s, stage: i + 1 }));
    setForm({ ...form, stages: updated });
  }

  function updateStage(idx: number, field: keyof ApprovalStageConfig, value: string | number) {
    const updated = [...form.stages];
    (updated[idx] as any)[field] = value;
    setForm({ ...form, stages: updated });
  }

  const ROLE_OPTIONS = [
    { value: "manager", label: "팀장" },
    { value: "director", label: "이사" },
    { value: "ceo", label: "대표" },
    { value: "admin", label: "관리자" },
    { value: "owner", label: "소유자" },
    { value: "finance", label: "재무" },
  ];

  if (isLoading) {
    return <div className="text-center py-12 text-[var(--text-muted)]">로딩 중...</div>;
  }

  return (
    <div>
      <div className="flex justify-end mb-4">
        <button
          onClick={() => { resetForm(); setShowForm(true); }}
          className="px-4 py-2.5 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl text-sm font-semibold transition"
        >
          + 정책 추가
        </button>
      </div>

      {/* Policy Form */}
      {showForm && (
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6 mb-6">
          <h3 className="text-sm font-bold mb-4">{editingPolicy ? "정책 수정" : "새 결재 정책"}</h3>

          <div className="grid grid-cols-3 gap-4 mb-4">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">정책 이름 *</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="예: 경비 결재 정책"
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">적용 문서 유형 *</label>
              <select
                value={form.documentType}
                onChange={(e) => setForm({ ...form, documentType: e.target.value })}
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
              >
                {Object.entries(REQUEST_TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
                <option value="default">기본 (전체)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">자동승인 기준 금액 (원)</label>
              <input
                type="number"
                value={form.autoApproveBelow}
                onChange={(e) => setForm({ ...form, autoApproveBelow: e.target.value })}
                placeholder="0 (비활성)"
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
              />
            </div>
          </div>

          {/* Stages */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-[var(--text-muted)]">결재 단계</label>
              <button
                onClick={addStage}
                className="text-xs text-[var(--primary)] hover:underline font-semibold"
              >
                + 단계 추가
              </button>
            </div>
            <div className="space-y-2">
              {form.stages.map((stage, idx) => (
                <div key={idx} className="flex items-center gap-3 bg-[var(--bg)] rounded-xl p-3 border border-[var(--border)]">
                  <div className="w-8 h-8 rounded-full bg-[var(--primary)]/10 flex items-center justify-center text-xs font-bold text-[var(--primary)] shrink-0">
                    {stage.stage}
                  </div>
                  <input
                    value={stage.name}
                    onChange={(e) => updateStage(idx, "name", e.target.value)}
                    placeholder="단계 이름"
                    className="flex-1 px-3 py-2 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]"
                  />
                  <select
                    value={stage.approver_role}
                    onChange={(e) => updateStage(idx, "approver_role", e.target.value)}
                    className="w-32 px-3 py-2 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]"
                  >
                    {ROLE_OPTIONS.map((r) => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                  {form.stages.length > 1 && (
                    <button
                      onClick={() => removeStage(idx)}
                      className="text-red-400 hover:text-red-500 text-sm font-bold px-1"
                    >
                      &#10005;
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => form.name.trim() && upsertMut.mutate()}
              disabled={!form.name.trim() || form.stages.some((s) => !s.name.trim()) || upsertMut.isPending}
              className="px-5 py-2 bg-[var(--primary)] text-white rounded-lg text-sm font-semibold disabled:opacity-50 transition"
            >
              {upsertMut.isPending ? "저장 중..." : editingPolicy ? "수정" : "저장"}
            </button>
            <button onClick={resetForm} className="px-4 py-2 text-[var(--text-muted)] text-sm">취소</button>
          </div>
        </div>
      )}

      {/* Policy List */}
      {policies.length === 0 && !showForm ? (
        <div className="text-center py-16 bg-[var(--bg-card)] rounded-2xl border border-[var(--border)]">
          <div className="text-[var(--text-muted)] text-sm mb-2">등록된 결재 정책이 없습니다</div>
          <div className="text-xs text-[var(--text-dim)]">정책을 추가하면 결재 요청 시 자동으로 적용됩니다</div>
        </div>
      ) : (
        <div className="space-y-3">
          {policies.map((policy: ApprovalPolicy) => (
            <div key={policy.id} className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-sm">{policy.name}</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${policy.is_active ? "bg-green-500/10 text-green-500" : "bg-gray-500/10 text-gray-400"}`}>
                      {policy.is_active ? "활성" : "비활성"}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-[var(--text-muted)] mt-1">
                    <span>유형: {REQUEST_TYPE_LABELS[policy.document_type as RequestType] || policy.document_type}</span>
                    <span>{(policy.stages as ApprovalStageConfig[]).length}단계</span>
                    {policy.auto_approve_below > 0 && (
                      <span>자동승인: {formatAmount(policy.auto_approve_below)} 미만</span>
                    )}
                  </div>
                  {/* Stage flow preview */}
                  <div className="flex items-center gap-1 mt-2">
                    {(policy.stages as ApprovalStageConfig[]).map((stage, idx) => (
                      <div key={idx} className="flex items-center gap-1">
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-[var(--bg-surface)] text-[var(--text-muted)]">
                          {stage.name}
                        </span>
                        {idx < (policy.stages as ApprovalStageConfig[]).length - 1 && (
                          <svg className="w-3 h-3 text-[var(--text-dim)]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                            <path d="M9 5l7 7-7 7" />
                          </svg>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => startEdit(policy)}
                    className="px-3 py-1.5 text-xs text-[var(--primary)] hover:bg-[var(--primary)]/10 rounded-lg font-semibold transition"
                  >
                    수정
                  </button>
                  <button
                    onClick={() => { if (confirm("이 정책을 삭제하시겠습니까?")) deleteMut.mutate(policy.id); }}
                    disabled={deleteMut.isPending}
                    className="px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 rounded-lg font-semibold transition disabled:opacity-50"
                  >
                    삭제
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════
// Approval Timeline Component
// ══════════════════════════════════════════════

function ApprovalTimelineView({ requestId, currentStage, totalStages, requestStatus }: {
  requestId: string;
  currentStage: number;
  totalStages: number;
  requestStatus: string;
}) {
  const { data: timeline = [], isLoading } = useQuery({
    queryKey: ["approval-timeline", requestId],
    queryFn: () => getApprovalTimeline(requestId),
    enabled: !!requestId,
  });

  if (isLoading) {
    return <div className="text-xs text-[var(--text-muted)] py-2">타임라인 로딩 중...</div>;
  }

  if (timeline.length === 0) {
    return <div className="text-xs text-[var(--text-muted)] py-2">결재 이력이 없습니다</div>;
  }

  // Group by stage
  const stageGroups = new Map<number, ApprovalStep[]>();
  timeline.forEach((step) => {
    if (!stageGroups.has(step.stage)) stageGroups.set(step.stage, []);
    stageGroups.get(step.stage)!.push(step);
  });

  const stages = Array.from(stageGroups.entries()).sort((a, b) => a[0] - b[0]);

  return (
    <div>
      <div className="text-xs font-semibold text-[var(--text-muted)] mb-3">결재 타임라인</div>

      {/* Horizontal stage indicator */}
      <div className="flex items-center gap-0 mb-4 overflow-x-auto pb-1">
        {stages.map(([stageNum, steps], idx) => {
          const allApproved = steps.every((s) => s.status === "approved");
          const anyRejected = steps.some((s) => s.status === "rejected");
          const isCurrent = stageNum === currentStage && requestStatus === "pending";

          let circleClass = "border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-muted)]";
          let lineClass = "bg-[var(--border)]";

          if (allApproved) {
            circleClass = "border-green-500 bg-green-500 text-white";
            lineClass = "bg-green-500";
          } else if (anyRejected) {
            circleClass = "border-red-500 bg-red-500 text-white";
          } else if (isCurrent) {
            circleClass = "border-[var(--primary)] bg-[var(--primary)] text-white";
          }

          return (
            <div key={stageNum} className="flex items-center">
              <div className="flex flex-col items-center min-w-[80px]">
                <div className={`w-7 h-7 rounded-full border-2 flex items-center justify-center text-[11px] font-bold ${circleClass}`}>
                  {allApproved ? (
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
                      <path d="M5 13l4 4L19 7" />
                    </svg>
                  ) : anyRejected ? (
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
                      <path d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  ) : (
                    stageNum
                  )}
                </div>
                <div className={`text-[10px] mt-1 font-semibold whitespace-nowrap ${isCurrent ? "text-[var(--primary)]" : "text-[var(--text-muted)]"}`}>
                  {steps[0]?.stage_name || `${stageNum}단계`}
                </div>
              </div>
              {idx < stages.length - 1 && (
                <div className={`h-[2px] w-8 ${allApproved ? lineClass : "bg-[var(--border)]"} -mt-4`} />
              )}
            </div>
          );
        })}
      </div>

      {/* Detailed steps */}
      <div className="space-y-2">
        {timeline.map((step) => (
          <div key={step.id} className="flex items-start gap-3 text-xs">
            <StatusBadge status={step.status} />
            <div className="flex-1 min-w-0">
              <span className="font-semibold">{step.approver_name || "담당자"}</span>
              <span className="text-[var(--text-muted)] ml-1">({step.stage_name})</span>
              {step.comment && (
                <div className="text-[var(--text-muted)] mt-0.5 italic">&ldquo;{step.comment}&rdquo;</div>
              )}
            </div>
            <div className="text-[var(--text-dim)] shrink-0">
              {step.decided_at ? formatDateTime(step.decided_at) : "대기 중"}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
