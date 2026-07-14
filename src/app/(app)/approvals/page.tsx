"use client";

import { useEffect, useState, useMemo, Fragment } from "react";
import { DateField } from "@/components/date-field";
import { friendlyError } from "@/lib/friendly-error";
import { useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getCurrentUser } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import { notifyOvertimeDecision } from "@/lib/notifications";
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
  deleteApprovalRequest,
  REQUEST_TYPE_LABELS,
  type RequestType,
  type ApprovalPolicy,
  type ApprovalRequest,
  type ApprovalStep,
  type ApprovalStageConfig,
} from "@/lib/approval-workflow";
import { CurrencyInput } from "@/components/currency-input";
import { Avatar } from "@/components/avatar";
import { useToast } from "@/components/toast";
import { ApprovalFormsManager } from "@/components/approval-forms-manager";
import { useConfirm } from "@/components/confirm-dialog";
import { listApprovalForms, type ApprovalForm } from "@/lib/approval-forms";
import { generateApprovalPdf } from "@/lib/document-generator";
import { openStoredFile, resolveSignedUrl } from "@/lib/file-storage";

const db = supabase as any;

type Tab = "my-approvals" | "my-requests" | "all" | "new-request" | "policies" | "forms";

// ── 2026-07-03 결재관리 리디자인 — 유형·상태·진행 프리미티브 ──

// 상태: 점 + 라벨 pill (대기는 은은한 펄스)
const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; dot: string; pulse?: boolean }> = {
  pending: { label: "대기", bg: "bg-[var(--warning-dim)]", text: "text-[var(--warning)]", dot: "bg-[var(--warning)]", pulse: true },
  approved: { label: "승인", bg: "bg-[var(--success-dim)]", text: "text-[var(--success)]", dot: "bg-[var(--success)]" },
  rejected: { label: "반려", bg: "bg-[var(--danger-dim)]", text: "text-[var(--danger)]", dot: "bg-[var(--danger)]" },
  cancelled: { label: "취소", bg: "bg-[var(--bg-surface)]", text: "text-[var(--text-dim)]", dot: "bg-[var(--text-dim)]" },
  skipped: { label: "건너뜀", bg: "bg-[var(--bg-surface)]", text: "text-[var(--text-dim)]", dot: "bg-[var(--text-dim)]" },
};

function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold leading-none ${config.bg} ${config.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${config.dot} ${config.pulse ? "animate-pulse" : ""}`} />
      {config.label}
    </span>
  );
}

// 유형별 아이콘·컬러 아이덴티티 — 리스트를 훑을 때 유형이 한눈에 구분되게.
const TYPE_META: Record<string, { icon: string; bg: string; text: string }> = {
  expense: { icon: "wallet", bg: "bg-violet-500/12", text: "text-violet-500" },
  expense_report: { icon: "wallet", bg: "bg-violet-500/12", text: "text-violet-500" },
  card_expense: { icon: "card", bg: "bg-fuchsia-500/12", text: "text-fuchsia-500" },
  payment: { icon: "banknote", bg: "bg-sky-500/12", text: "text-sky-500" },
  leave: { icon: "sun", bg: "bg-[var(--success-dim)]", text: "text-[var(--success)]" },
  overtime: { icon: "clock", bg: "bg-amber-500/12", text: "text-amber-500" },
  purchase: { icon: "cart", bg: "bg-orange-500/12", text: "text-orange-500" },
  equipment: { icon: "monitor", bg: "bg-cyan-600/12", text: "text-cyan-600" },
  contract: { icon: "pen", bg: "bg-[var(--primary)]/12", text: "text-[var(--primary)]" },
  travel: { icon: "plane", bg: "bg-blue-500/12", text: "text-blue-500" },
  approval_doc: { icon: "doc", bg: "bg-rose-500/12", text: "text-rose-500" },
};
const TYPE_FALLBACK = { icon: "doc", bg: "bg-[var(--primary)]/12", text: "text-[var(--primary)]" };
const typeMeta = (t: string) => TYPE_META[t] || TYPE_FALLBACK;

function TypeIcon({ name, className = "w-4 h-4" }: { name: string; className?: string }) {
  const p = { className, fill: "none", stroke: "currentColor", strokeWidth: 1.8, viewBox: "0 0 24 24", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (name) {
    case "wallet": return <svg {...p}><path d="M21 12V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2h14a2 2 0 002-2v-2"/><path d="M16 12h5v4h-5a2 2 0 010-4z"/></svg>;
    case "card": return <svg {...p}><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>;
    case "banknote": return <svg {...p}><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/></svg>;
    case "sun": return <svg {...p}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>;
    case "clock": return <svg {...p}><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/></svg>;
    case "cart": return <svg {...p}><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6"/></svg>;
    case "monitor": return <svg {...p}><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>;
    case "pen": return <svg {...p}><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>;
    case "plane": return <svg {...p}><path d="M17.8 19.2L16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/></svg>;
    default: return <svg {...p}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>;
  }
}

// 유형 칩 — 아이콘 + 라벨 틴트 pill
function TypeChip({ type, label }: { type: string; label: string }) {
  const m = typeMeta(type);
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold leading-none ${m.bg} ${m.text}`}>
      <TypeIcon name={m.icon} className="w-3 h-3" />
      {label}
    </span>
  );
}

// 결재선 진행 — 세그먼트 바 (완료=채움, 현재=펄스, 반려=빨강)
function StageProgress({ current, total, status }: { current: number; total: number; status: string }) {
  const segs = Array.from({ length: Math.max(1, total) });
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1 flex-1 max-w-[160px]">
        {segs.map((_, i) => {
          const n = i + 1;
          let cls = "bg-[var(--border)]";
          if (status === "approved" || n < current) cls = "bg-[var(--success)]";
          else if (status === "rejected" && n === current) cls = "bg-[var(--danger)]";
          else if (n === current && status === "pending") cls = "bg-[var(--primary)] animate-pulse";
          return <div key={i} className={`h-1.5 flex-1 rounded-full transition-colors ${cls}`} />;
        })}
      </div>
      <span className="text-[10px] font-bold text-[var(--text-dim)] mono-number shrink-0">{Math.min(current, total)}/{total}</span>
    </div>
  );
}

function formatAmount(amount: number) {
  if (!amount) return "-";
  return `₩${amount.toLocaleString()}`;
}

// 파일명(한글 포함) → Storage key에 안전한 base64url. Supabase Storage key는 한글·공백은
//   물론 encodeURIComponent가 만드는 "%"조차 거부해 원본 그대로도 %인코딩도 못 씀 (2026-07-14 확인).
//   base64url(A-Za-z0-9-_)만 쓰면 키 검증도 통과하고 원본 파일명도 그대로 복원 가능.
function toBase64Url(str: string): string {
  const bin = encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, p1) => String.fromCharCode(parseInt(p1, 16)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromBase64Url(b64url: string): string {
  let b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  const bin = atob(b64);
  return decodeURIComponent(Array.from(bin).map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0")).join(""));
}

// 첨부파일 URL(`{timestamp}_{base64url 인코딩된 원본파일명}`)에서 원본 파일명 복원
//   구버전(화이트리스트 치환) 파일은 base64 디코딩이 실패하므로 원문 그대로 폴백.
function attachmentFileName(url: string): string {
  try {
    const last = decodeURIComponent(url.split("/").pop() || "");
    const idx = last.indexOf("_");
    const raw = idx >= 0 ? last.slice(idx + 1) : last;
    try { return fromBase64Url(raw); } catch { return raw; }
  } catch {
    return url;
  }
}

function AttachmentList({ attachments }: { attachments?: string[] }) {
  if (!attachments || attachments.length === 0) return null;
  return (
    <div className="mt-3">
      <div className="text-[11px] font-semibold text-[var(--text-dim)] mb-1.5">첨부파일 ({attachments.length})</div>
      <div className="flex flex-wrap gap-2">
        {attachments.map((url, i) => (
          <button
            key={i}
            type="button"
            onClick={(e) => { e.stopPropagation(); openStoredFile(url); }}
            className="inline-flex items-center gap-2 pl-2 pr-3 py-2 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] text-[12px] font-medium text-[var(--text-muted)] hover:text-[var(--primary)] hover:border-[var(--primary)]/40 transition"
          >
            <span className="w-6 h-6 rounded-lg bg-[var(--success)]/12 text-[var(--success)] flex items-center justify-center shrink-0">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>
            </span>
            <span className="truncate max-w-[180px]">{attachmentFileName(url)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// Flex 스타일 구조화 필드 행 — 타입별 아이콘 + 라벨 + 값
function fieldTypeIcon(type: string) {
  if (type === "date") {
    return <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>;
  }
  if (type === "amount") {
    return <span className="text-[11px] font-bold">₩</span>;
  }
  if (type === "select") {
    return <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg>;
  }
  return <span className="text-[11px] font-bold">Tr</span>;
}

function FormFieldRows({ fields }: { fields: { label: string; type: string; value: string }[] }) {
  if (fields.length === 0) return null;
  return (
    <div className="py-1">
      {fields.map((f, i) => (
        <div key={i} className="flex items-center gap-3 py-2">
          <span className="w-7 h-7 rounded-lg bg-[var(--bg-surface)] text-[var(--text-dim)] flex items-center justify-center shrink-0">
            {fieldTypeIcon(f.type)}
          </span>
          <span className="w-[120px] shrink-0 text-[13px] text-[var(--text-muted)]">{f.label}</span>
          <span className="text-sm font-semibold text-[var(--text)] truncate">{f.value}</span>
        </div>
      ))}
    </div>
  );
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
  const sp = useSearchParams();
  const newType = sp?.get('new'); // expense / payment / general — 대시보드 quick action 에서 전달
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(newType ? "new-request" : "my-approvals");
  const [presetType, setPresetType] = useState<string | null>(newType);
  const queryClient = useQueryClient();

  // URL ?new=... 가 바뀌면 탭 + 타입 동기화 (대시보드 → approvals 이동 시)
  useEffect(() => {
    if (newType) {
      setTab("new-request");
      setPresetType(newType);
    }
  }, [newType]);

  useEffect(() => {
    getCurrentUser().then((u) => {
      if (u) {
        setCompanyId(u.company_id);
        setUserId(u.id);
        setUserRole(u.role);
        // 직원 계정은 결재 권한이 거의 없어 '내 결재함'이 비어있음 → 기본 탭을 '새 요청'으로.
        if (!newType && u.role === "employee") setTab("new-request");
      }
    });
  }, []);

  // 결재 페이지 진입 시 dismissed 시각 저장 → sidebar 배지 사라짐.
  // 그 이후 새로 생성된 결재만 다음 polling에서 다시 카운트됨.
  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("approvals-dismissed-at", new Date().toISOString());
    window.dispatchEvent(new Event("sidebar-refresh-badges"));
  }, []);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["my-pending-approvals"] });
    queryClient.invalidateQueries({ queryKey: ["my-pending-count"] });
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

  const { data: myPendingCount } = useQuery({
    queryKey: ["my-pending-count", userId, companyId],
    queryFn: async () => {
      const items = await getMyPendingApprovals(userId!, companyId!);
      return items.length;
    },
    enabled: !!userId && !!companyId,
  });

  const isAdmin = userRole === "admin" || userRole === "owner";

  // 연장근무 결재는 근태관리로 이관 — approvals 에서 제거(2026-07-01)

  const TABS: { key: Tab; label: string; icon: string; count?: number }[] = [
    { key: "my-approvals", label: "내 결재함", icon: "inbox", count: myPendingCount },
    { key: "my-requests", label: "내 요청", icon: "send" },
    ...(isAdmin ? [{ key: "all" as Tab, label: "전체 현황", icon: "chart" }] : []),
    { key: "new-request", label: "새 요청", icon: "plus" },
    ...(isAdmin ? [{ key: "forms" as Tab, label: "양식 관리", icon: "layout" }] : []),
    ...(isAdmin ? [{ key: "policies" as Tab, label: "정책 관리", icon: "route" }] : []),
  ];
  const tabIcon = (name: string) => {
    const p = { className: "w-3.5 h-3.5", fill: "none", stroke: "currentColor", strokeWidth: 2, viewBox: "0 0 24 24", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
    switch (name) {
      case "inbox": return <svg {...p}><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/></svg>;
      case "send": return <svg {...p}><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>;
      case "chart": return <svg {...p}><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg>;
      case "plus": return <svg {...p}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>;
      case "layout": return <svg {...p}><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>;
      default: return <svg {...p}><circle cx="6" cy="19" r="3"/><circle cx="18" cy="5" r="3"/><path d="M12 19h4.5a3.5 3.5 0 000-7h-9a3.5 3.5 0 010-7H12"/></svg>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Toolbar — icon tab navigation */}
      <div className="page-sticky-header flex flex-wrap items-center justify-between gap-2">
        <div className="seg-bar">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`seg-item inline-flex items-center gap-1.5 ${tab === t.key ? "seg-item-active" : ""}`}
            >
              {tabIcon(t.icon)}
              {t.label}
              {t.count !== undefined && t.count > 0 && (
                <span className={`min-w-[18px] h-[18px] px-1 inline-flex items-center justify-center rounded-full text-[10px] font-bold ${tab === t.key ? "bg-white/25 text-white" : "bg-[var(--danger)] text-white"}`}>{t.count}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Summary stats — 클릭 시 해당 뷰로 (전체 현황은 admin 전용이라 KPI 자체는 통계만) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "대기 중", value: stats?.pending ?? 0, tone: "warning", valueCls: "text-[var(--warning)]", icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 2" /></svg> },
          { label: "승인 완료", value: stats?.approved ?? 0, tone: "success", valueCls: "text-[var(--success)]", icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg> },
          { label: "반려", value: stats?.rejected ?? 0, tone: "danger", valueCls: "text-[var(--danger)]", icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg> },
          { label: "전체 요청", value: stats?.total ?? 0, tone: "", valueCls: "text-[var(--text)]", icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.008v.008H3.75V6.75zm0 5.25h.008v.008H3.75V12zm0 5.25h.008v.008H3.75v-.008z" /></svg> },
        ].map((k) => (
          <div key={k.label} className="glass-card card-hover p-5 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-semibold text-[var(--text-muted)]">{k.label}</span>
              <span className={`kpi-icon ${k.tone}`}>{k.icon}</span>
            </div>
            <div className="flex items-end gap-1">
              <span className={`text-[26px] leading-8 font-extrabold mono-number truncate ${k.valueCls}`}>{k.value}</span>
              <span className="text-xs font-semibold text-[var(--text-dim)] mb-1">건</span>
            </div>
          </div>
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
        <NewRequestTab companyId={companyId} userId={userId} invalidate={invalidate} onComplete={() => setTab("my-requests")} presetType={presetType} />
      )}
      {tab === "forms" && companyId && (
        <ApprovalFormsManager companyId={companyId} />
      )}
      {tab === "policies" && companyId && (
        <PoliciesTab companyId={companyId} invalidate={invalidate} />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════
// Tab: 연장근무 승인 (admin/owner)
// ══════════════════════════════════════════════
// pending overtime_requests 만 표시. 직원명은 employees JOIN 으로 fetch.
// 승인: rpc('approve_overtime'). 반려: rpc('reject_overtime', p_reason ≥ 3자)
// RLS 가 회사 격리 자동 처리.
function OvertimeApprovalsTab({ companyId }: { companyId: string }) {
  const { toast } = useToast();
  const { confirm, confirmElement } = useConfirm();
  const qc = useQueryClient();

  const { data: rows = [], isLoading } = useQuery<any[]>({
    queryKey: ["overtime-pending", companyId],
    queryFn: async () => {
      const { data, error } = await db
        .from("overtime_requests")
        .select("id, requested_date, requested_end_time, reason, status, created_at, employee_id, employees(name, user_id)")
        .eq("status", "pending")
        .order("requested_date", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!companyId,
    staleTime: 30_000,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["overtime-pending"] });
    qc.invalidateQueries({ queryKey: ["overtime-pending-count"] });
  };

  const approveMut = useMutation({
    mutationFn: async (row: any) => {
      const { error } = await db.rpc("approve_overtime", { p_request_id: row.id });
      if (error) throw error;
      return row;
    },
    onSuccess: (row: any) => {
      toast("연장근무 승인 처리 완료", "success");
      refresh();
      const targetUserId = row?.employees?.user_id;
      if (targetUserId) {
        void notifyOvertimeDecision({
          companyId,
          requestId: row.id,
          targetUserId,
          decision: "approved",
          requestedDate: row.requested_date,
          requestedEndTime: String(row.requested_end_time || "").slice(0, 5),
        }).catch(() => { /* silent */ });
      }
    },
    onError: (err: any) => toast(friendlyError(err, "승인 처리 실패"), "error"),
  });

  const rejectMut = useMutation({
    mutationFn: async ({ row, reason }: { row: any; reason: string }) => {
      const { error } = await db.rpc("reject_overtime", { p_request_id: row.id, p_reason: reason });
      if (error) throw error;
      return { row, reason };
    },
    onSuccess: ({ row, reason }: { row: any; reason: string }) => {
      toast("연장근무 반려 처리 완료", "success");
      refresh();
      const targetUserId = row?.employees?.user_id;
      if (targetUserId) {
        void notifyOvertimeDecision({
          companyId,
          requestId: row.id,
          targetUserId,
          decision: "rejected",
          requestedDate: row.requested_date,
          requestedEndTime: String(row.requested_end_time || "").slice(0, 5),
          rejectedReason: reason,
        }).catch(() => { /* silent */ });
      }
    },
    onError: (err: any) => toast(friendlyError(err, "반려 처리 실패"), "error"),
  });

  const handleReject = async (row: any) => {
    const { ok, input } = await confirm({
      title: "연장근무 반려",
      withInput: "반려 사유를 입력하세요 (3자 이상)",
      confirmLabel: "반려",
      danger: true,
    });
    if (!ok) return;
    const trimmed = (input || "").trim();
    if (trimmed.length < 3) {
      toast("반려 사유는 3자 이상 입력해 주세요", "error");
      return;
    }
    rejectMut.mutate({ row, reason: trimmed });
  };

  // KST 표시
  const fmtDateKst = (s: string | null) => (s ? s : "-");
  const fmtTimeHhmm = (t: string | null) => (t ? String(t).slice(0, 5) : "-");
  const fmtCreated = (ts: string | null) =>
    ts
      ? new Date(ts).toLocaleString("ko-KR", {
          year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
        })
      : "-";

  if (isLoading) {
    return <div className="text-center py-12 text-[var(--text-muted)]">로딩 중...</div>;
  }

  return (
    <div>
      {confirmElement}
      {rows.length === 0 ? (
        <div className="text-center py-16 glass-card">
          <div className="text-3xl mb-3">&#10003;</div>
          <div className="text-[var(--text-muted)] text-sm">대기 중인 연장근무 신청이 없습니다</div>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => {
            const empName: string = row?.employees?.name || "(이름 없음)";
            return (
              <div key={row.id} className="glass-card p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-500/15 text-amber-500 border border-amber-500/30">
                        연장근무
                      </span>
                      <span className="text-[11px] text-[var(--text-dim)]">신청일 {fmtCreated(row.created_at)}</span>
                    </div>
                    <div className="font-semibold text-sm text-[var(--text)] mb-1">{empName}</div>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--text-muted)] mb-2">
                      <span>
                        예정일 <span className="font-mono text-[var(--text)]">{fmtDateKst(row.requested_date)}</span>
                      </span>
                      <span>
                        종료시각 <span className="font-mono text-[var(--text)]">~{fmtTimeHhmm(row.requested_end_time)}</span>
                      </span>
                    </div>
                    <div
                      className="px-3 py-2 bg-[var(--bg-surface)] rounded-lg text-xs text-[var(--text-muted)] whitespace-pre-wrap line-clamp-3"
                      title={row.reason}
                    >
                      {row.reason}
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2 shrink-0">
                    <button
                      onClick={() => approveMut.mutate(row)}
                      disabled={approveMut.isPending}
                      className="btn-primary"
                    >
                      승인
                    </button>
                    <button
                      onClick={() => handleReject(row)}
                      disabled={rejectMut.isPending}
                      className="btn-danger"
                    >
                      반려
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
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
  const { toast } = useToast();
  const [comment, setComment] = useState("");
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);

  const { data: pendingApprovals = [], isLoading } = useQuery({
    queryKey: ["my-pending-approvals", userId, companyId],
    queryFn: () => getMyPendingApprovals(userId, companyId),
    enabled: !!userId && !!companyId,
  });

  // 커스텀 결재 양식 필드 정의 (label·type) — custom_fields 값과 짝지어 구조화된 항목으로 표시
  const { data: customForms = [] } = useQuery({
    queryKey: ["approval-forms", companyId],
    queryFn: () => listApprovalForms(),
    enabled: !!companyId,
  });
  const formsById = useMemo(() => {
    const map = new Map<string, ApprovalForm>();
    (customForms as ApprovalForm[]).forEach((f) => map.set(f.id, f));
    return map;
  }, [customForms]);

  // item(양식 필드 정의 + 저장된 값) → [{label, type, value}] · 빈 값 제외
  function getFormFields(item: any): { label: string; type: string; value: string }[] {
    if (!item.formId) return [];
    const form = formsById.get(item.formId);
    if (!form) return [];
    return form.fields
      .map((fd) => ({ label: fd.label, type: fd.type, value: String(item.customFields?.[fd.key] ?? "") }))
      .filter((f) => f.value);
  }

  // 양식 필드 값이 description 앞부분에 중복 병합돼 있으면(기존 저장 방식) 잘라내 중복 표시 방지
  function contentWithoutFieldLines(description: string, formFields: { label: string; value: string }[]): string {
    if (formFields.length === 0) return description;
    const fieldLines = formFields.map((f) => `${f.label}: ${f.value}`).join("\n");
    if (description.startsWith(fieldLines)) {
      return description.slice(fieldLines.length).replace(/^\n+/, "");
    }
    return description;
  }

  const approveMut = useMutation({
    mutationFn: ({ stepId, comment }: { stepId: string; comment?: string }) =>
      approveStep(stepId, userId, comment),
    onSuccess: () => {
      invalidate();
      setComment("");
      toast("승인 처리했습니다", "success");
      window.dispatchEvent(new Event("sidebar-refresh-badges"));
    },
    onError: (err: any) => toast("승인 처리 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
  });

  const rejectMut = useMutation({
    mutationFn: ({ stepId, comment }: { stepId: string; comment: string }) =>
      rejectStep(stepId, userId, comment),
    onSuccess: () => {
      invalidate();
      setComment("");
      toast("반려 처리했습니다", "success");
      window.dispatchEvent(new Event("sidebar-refresh-badges"));
    },
    onError: (err: any) => toast("반려 처리 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
  });

  // 목록이 바뀌면(로드·처리 완료) 선택 유지 or 첫 항목으로
  useEffect(() => {
    if (pendingApprovals.length === 0) { setSelectedStepId(null); return; }
    if (!pendingApprovals.some((p: any) => p.stepId === selectedStepId)) {
      setSelectedStepId(pendingApprovals[0].stepId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingApprovals]);

  if (isLoading) {
    return <div className="text-center py-12 text-[var(--text-muted)]">로딩 중...</div>;
  }

  if (pendingApprovals.length === 0) {
    return (
      <div className="text-center py-20 px-6 glass-card">
        <div className="mx-auto w-16 h-16 mb-4 rounded-2xl bg-[var(--success-dim)] text-[var(--success)] flex items-center justify-center">
          <svg className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        </div>
        <div className="text-base font-bold mb-1.5">모두 처리했어요</div>
        <div className="text-sm text-[var(--text-muted)]">새 결재 요청이 배정되면 이곳에 표시됩니다</div>
      </div>
    );
  }

  const selected = pendingApprovals.find((p: any) => p.stepId === selectedStepId) || null;
  const selectedFormFields = selected ? getFormFields(selected) : [];
  const selectedContent = selected ? contentWithoutFieldLines(selected.description || "", selectedFormFields) : "";

  const handleApprove = () => {
    if (!selected) return;
    approveMut.mutate({ stepId: selected.stepId, comment: comment || undefined });
  };
  const handleReject = () => {
    if (!selected) return;
    if (!comment.trim()) { toast("반려 사유를 입력하세요", "error"); return; }
    rejectMut.mutate({ stepId: selected.stepId, comment });
  };

  return (
    <div className="flex flex-col lg:flex-row gap-4 items-start">
      {/* LEFT — 결재 대기 목록 (분할 패널: 목록 컬럼) */}
      <div className="w-full lg:w-[300px] shrink-0 space-y-2">
        {pendingApprovals.map((item: any) => {
          const m = typeMeta(item.requestType);
          const active = item.stepId === selectedStepId;
          return (
            <button
              key={item.stepId}
              onClick={() => { setSelectedStepId(item.stepId); setComment(""); }}
              className={`w-full text-left p-3.5 rounded-xl border transition ${active ? "border-[var(--primary)] bg-[var(--primary)]/6" : "border-[var(--border)] bg-[var(--bg-card)] hover:border-[var(--primary)]/30"}`}
            >
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 ${m.bg} ${m.text}`}>
                  <TypeIcon name={m.icon} className="w-3 h-3" />
                </span>
                <span className="text-[10px] font-semibold text-[var(--text-dim)] truncate">{REQUEST_TYPE_LABELS[item.requestType as RequestType] || item.requestType}</span>
              </div>
              <div className="text-sm font-bold truncate mb-0.5">{item.title}</div>
              <div className="text-[11px] text-[var(--text-dim)] truncate">{item.requesterName || "알 수 없음"} · {formatDate(item.createdAt)}</div>
              {item.amount > 0 && <div className="text-xs font-bold mono-number mt-1.5">{formatAmount(item.amount)}</div>}
            </button>
          );
        })}
      </div>

      {/* RIGHT — 문서 패널 + 승인·참조 사이드바 */}
      {selected && (
        <div className="flex-1 w-full min-w-0 flex flex-col xl:flex-row gap-4 items-start">
          <div className="flex-1 w-full min-w-0 glass-card p-6">
            <span className="inline-flex items-center px-3 py-1 rounded-full text-[11px] font-bold mb-3 bg-[var(--warning-dim)] text-[var(--warning)]">
              승인 필요
            </span>
            <h2 className="text-[22px] font-extrabold leading-tight mb-1.5">{selected.title}</h2>
            <div className="text-xs text-[var(--text-dim)] mb-5">
              {REQUEST_TYPE_LABELS[selected.requestType as RequestType] || selected.requestType} · {selected.requesterName || "알 수 없음"} · {formatDate(selected.createdAt)}
            </div>

            {selected.amount > 0 && (
              <div className="text-2xl font-extrabold mono-number mb-4">{formatAmount(selected.amount)}</div>
            )}

            {selectedFormFields.length > 0 && (
              <div className="mb-4 pb-4 border-b border-[var(--border)]/60">
                <FormFieldRows fields={selectedFormFields} />
              </div>
            )}
            {selectedContent && (
              <div className="mb-2 text-sm text-[var(--text)] leading-8 whitespace-pre-wrap">{selectedContent}</div>
            )}
            <AttachmentList attachments={selected.attachments} />

            {/* 결재 의견 + 승인/반려 — 팝업 없이 패널 안에서 바로 처리 */}
            <div className="mt-6 pt-5 border-t border-[var(--border)]">
              <label className="field-label">결재 의견 (반려 시 필수)</label>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={2}
                placeholder="의견을 입력하세요..."
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)] resize-none mb-4"
              />
              <div className="flex gap-2.5">
                <button
                  onClick={handleReject}
                  disabled={rejectMut.isPending}
                  className="flex-1 py-3.5 rounded-full text-sm font-bold text-[var(--danger)] bg-[var(--danger-dim)] hover:opacity-90 disabled:opacity-50 transition"
                >
                  {rejectMut.isPending ? "처리 중..." : "반려"}
                </button>
                <button
                  onClick={handleApprove}
                  disabled={approveMut.isPending}
                  className="flex-1 py-3.5 rounded-full text-sm font-bold text-white bg-[var(--success)] hover:opacity-90 disabled:opacity-50 transition inline-flex items-center justify-center gap-1.5"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7"/></svg>
                  {approveMut.isPending ? "처리 중..." : "승인"}
                </button>
              </div>
            </div>

            <div className="mt-6 pt-5 border-t border-[var(--border)]">
              <ActivityTimeline requestId={selected.requestId} />
            </div>
          </div>

          {/* 승인·참조 사이드바 */}
          <div className="w-full xl:w-[240px] shrink-0 glass-card p-4">
            <ApprovalStageSidebar requestId={selected.requestId} referenceUsers={selected.referenceUsers} />
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
  const { toast } = useToast();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ["my-requests", userId, companyId],
    queryFn: () => getMyRequests(userId, companyId),
    enabled: !!userId && !!companyId,
  });

  const resubmitMut = useMutation({
    mutationFn: (requestId: string) => resubmitRequest(requestId),
    onSuccess: invalidate,
    onError: (err: any) => toast("재제출 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
  });

  if (isLoading) {
    return <div className="text-center py-12 text-[var(--text-muted)]">로딩 중...</div>;
  }

  return (
    <div>
      {requests.length === 0 ? (
        <div className="text-center py-20 px-6 glass-card">
          <div className="mx-auto w-16 h-16 mb-4 rounded-2xl bg-[var(--primary-light)] text-[var(--primary)] flex items-center justify-center">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          </div>
          <div className="text-base font-bold mb-1.5">제출한 결재 요청이 없습니다</div>
          <div className="text-sm text-[var(--text-muted)]">&ldquo;새 요청&rdquo; 탭에서 결재를 요청할 수 있습니다</div>
        </div>
      ) : (
        <div className="space-y-3">
          {requests.map((req: any) => {
            const m = typeMeta(req.request_type);
            const open = expandedId === req.id;
            return (
              <div key={req.id} className="glass-card card-hover overflow-hidden animate-slide-in">
                <div
                  className="p-5 cursor-pointer"
                  onClick={() => setExpandedId(open ? null : req.id)}
                >
                  <div className="flex items-start gap-4">
                    <span className={`hidden sm:flex w-10 h-10 rounded-xl items-center justify-center shrink-0 ${m.bg} ${m.text}`}>
                      <TypeIcon name={m.icon} className="w-5 h-5" />
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1.5">
                        <StatusBadge status={req.status} />
                        <TypeChip type={req.request_type} label={REQUEST_TYPE_LABELS[req.request_type as RequestType] || req.request_type} />
                        <span className="text-[11px] text-[var(--text-dim)]">{formatDate(req.created_at)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-[15px] leading-6 truncate">{req.title}</span>
                        <svg className={`w-3.5 h-3.5 shrink-0 text-[var(--text-dim)] transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                      <div className="mt-3">
                        <StageProgress current={req.current_stage} total={req.total_stages} status={req.status} />
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-3 shrink-0">
                      {req.amount > 0 && (
                        <div className="text-right">
                          <div className="text-[10px] font-semibold text-[var(--text-dim)] uppercase tracking-wider">금액</div>
                          <div className="text-lg font-extrabold mono-number leading-6">{formatAmount(req.amount)}</div>
                        </div>
                      )}
                      {req.status === "rejected" && (
                        <button
                          onClick={(e) => { e.stopPropagation(); resubmitMut.mutate(req.id); }}
                          disabled={resubmitMut.isPending}
                          className="btn-primary"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
                          재제출
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Expanded: Timeline */}
                {open && (
                  <div className="border-t border-[var(--border)] px-5 py-4 bg-[var(--bg)]/60">
                    <ApprovalTimelineView requestId={req.id} currentStage={req.current_stage} totalStages={req.total_stages} requestStatus={req.status} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════
// Tab 3: 전체 현황 (Admin)
// ══════════════════════════════════════════════

function AllRequestsTab({ companyId }: { companyId: string }) {
  const { toast } = useToast();
  const { confirm, confirmElement } = useConfirm();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pdfLoadingId, setPdfLoadingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const { data: allRequests = [], isLoading } = useQuery({
    queryKey: ["all-requests", companyId, statusFilter, typeFilter],
    queryFn: () => getApprovalRequests(companyId, {
      status: statusFilter || undefined,
      requestType: typeFilter || undefined,
    }),
    enabled: !!companyId,
  });

  const handleDelete = async (req: any) => {
    const { ok } = await confirm({
      title: "결재 요청 삭제",
      desc: `"${req.title}"을(를) 완전히 삭제할까요? 이 작업은 되돌릴 수 없습니다.`,
      confirmLabel: "삭제",
      danger: true,
    });
    if (!ok) return;
    setDeletingId(req.id);
    try {
      await deleteApprovalRequest(req.id);
      if (expandedId === req.id) setExpandedId(null);
      queryClient.invalidateQueries({ queryKey: ["all-requests", companyId] });
      toast("삭제했습니다", "success");
    } catch (err: any) {
      toast(`삭제 실패: ${friendlyError(err, "알 수 없는 오류")}`, "error");
    }
    setDeletingId(null);
  };

  // Enrich with requester names
  const requesterNames = useMemo(() => {
    const map = new Map<string, string>();
    allRequests.forEach((r: any) => {
      if (r.users) map.set(r.requester_id, r.users?.name || r.users?.email || "");
    });
    return map;
  }, [allRequests]);

  // 승인 완료된 결재 문서 PDF 다운로드
  const handleDownloadApprovalPdf = async (req: any) => {
    setPdfLoadingId(req.id);
    try {
      const timeline = await getApprovalTimeline(req.id);
      const rawAttachments: string[] = req.attachments || [];
      const attachments = (await Promise.all(
        rawAttachments.map(async (url) => {
          const signed = await resolveSignedUrl(url);
          return signed ? { name: attachmentFileName(url), url: signed } : null;
        })
      )).filter((a): a is { name: string; url: string } => !!a);
      const blob = await generateApprovalPdf({
        title: req.title,
        requestTypeLabel: REQUEST_TYPE_LABELS[req.request_type as RequestType] || req.request_type,
        statusLabel: STATUS_CONFIG[req.status]?.label || req.status,
        requesterName: requesterNames.get(req.requester_id) || "-",
        amount: req.amount || 0,
        description: req.description || undefined,
        createdAt: formatDate(req.created_at),
        attachments: attachments.length > 0 ? attachments : undefined,
        steps: timeline.map((s) => ({
          stage: s.stage,
          stageName: s.stage_name,
          approverName: s.approver_name || "담당자",
          statusLabel: STATUS_CONFIG[s.status]?.label || s.status,
          comment: s.comment || undefined,
          decidedAt: s.decided_at ? formatDateTime(s.decided_at) : null,
        })),
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `결재문서_${req.title}_${formatDate(req.created_at)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast("PDF 다운로드 완료", "success");
    } catch (err: any) {
      toast(`PDF 생성 실패: ${err.message}`, "error");
    }
    setPdfLoadingId(null);
  };

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
      {/* Filters — 상태는 필 칩, 유형은 pill select */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="seg-bar">
          {statusOptions.map((o) => (
            <button
              key={o.value}
              onClick={() => setStatusFilter(o.value)}
              className={`seg-item ${statusFilter === o.value ? "seg-item-active" : ""}`}
            >
              {o.label}
            </button>
          ))}
        </div>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="px-3.5 py-2 bg-[var(--bg-card)] border border-[var(--border)] rounded-full text-xs font-semibold focus:outline-none focus:border-[var(--primary)]"
        >
          {typeOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <div className="flex-1" />
        <div className="text-xs font-semibold text-[var(--text-dim)] self-center mono-number">{allRequests.length}건</div>
      </div>

      {/* Table */}
      <div className="glass-card overflow-x-auto">
        <table className="w-full text-left min-w-[720px]">
          <thead>
            <tr className="border-b border-[var(--border)]">
              <th className="px-4 py-3 text-[11px] font-semibold text-[var(--text-dim)] tracking-wide">상태</th>
              <th className="px-4 py-3 text-[11px] font-semibold text-[var(--text-dim)] tracking-wide">제목</th>
              <th className="px-4 py-3 text-[11px] font-semibold text-[var(--text-dim)] tracking-wide">요청자</th>
              <th className="px-4 py-3 text-[11px] font-semibold text-[var(--text-dim)] tracking-wide text-right">금액</th>
              <th className="px-4 py-3 text-[11px] font-semibold text-[var(--text-dim)] tracking-wide">진행</th>
              <th className="px-4 py-3 text-[11px] font-semibold text-[var(--text-dim)] tracking-wide">요청일</th>
              <th className="px-4 py-3 text-[11px] font-semibold text-[var(--text-dim)] tracking-wide">문서</th>
            </tr>
          </thead>
          <tbody>
            {allRequests.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-16 text-center">
                  <div className="mx-auto w-14 h-14 mb-3 rounded-2xl bg-[var(--bg-surface)] text-[var(--text-dim)] flex items-center justify-center">
                    <svg className="w-7 h-7" fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/></svg>
                  </div>
                  <div className="text-sm font-bold mb-1">결재 요청이 없습니다</div>
                  <div className="text-xs text-[var(--text-muted)]">필터 조건을 바꾸거나 새 요청을 기다려 보세요</div>
                </td>
              </tr>
            ) : (
              allRequests.map((req: any) => {
                const m = typeMeta(req.request_type);
                return (
                  <Fragment key={req.id}>
                  <tr
                    className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--bg-surface)]/60 cursor-pointer transition"
                    onClick={() => setExpandedId(expandedId === req.id ? null : req.id)}
                  >
                    <td className="px-4 py-3.5"><StatusBadge status={req.status} /></td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${m.bg} ${m.text}`}>
                          <TypeIcon name={m.icon} className="w-4 h-4" />
                        </span>
                        <div className="min-w-0">
                          <div className="text-sm font-semibold truncate max-w-[240px]">{req.title}</div>
                          <div className="text-[10px] text-[var(--text-dim)]">{REQUEST_TYPE_LABELS[req.request_type as RequestType] || req.request_type}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2">
                        <Avatar name={requesterNames.get(req.requester_id) || "?"} size={24} />
                        <span className="text-xs text-[var(--text-muted)] truncate max-w-[100px]">{requesterNames.get(req.requester_id) || "-"}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-sm font-bold mono-number text-right">{formatAmount(req.amount)}</td>
                    <td className="px-4 py-3.5 w-[140px]">
                      <StageProgress current={req.current_stage} total={req.total_stages} status={req.status} />
                    </td>
                    <td className="px-4 py-3.5 text-xs text-[var(--text-muted)] whitespace-nowrap">{formatDate(req.created_at)}</td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-1.5">
                        {req.status === "approved" && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDownloadApprovalPdf(req); }}
                            disabled={pdfLoadingId === req.id}
                            title="결재 문서 PDF 다운로드"
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--primary)] hover:bg-[var(--primary-light)] border border-[var(--border)] transition disabled:opacity-50"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
                            </svg>
                            {pdfLoadingId === req.id ? "생성 중..." : "PDF"}
                          </button>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(req); }}
                          disabled={deletingId === req.id}
                          title="결재 요청 삭제"
                          className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-[var(--text-dim)] hover:text-[var(--danger)] hover:bg-[var(--danger-dim)] border border-[var(--border)] transition disabled:opacity-50"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                  {expandedId === req.id && (
                    <tr className="border-b border-[var(--border)] last:border-0 bg-[var(--bg)]">
                      <td colSpan={7} className="px-5 py-4">
                        <ApprovalTimelineView
                          requestId={req.id}
                          currentStage={req.current_stage}
                          totalStages={req.total_stages}
                          requestStatus={req.status}
                        />
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {confirmElement}
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

function NewRequestTab({ companyId, userId, invalidate, onComplete, presetType }: {
  companyId: string; userId: string; invalidate: () => void; onComplete: () => void; presetType?: string | null;
}) {
  const { toast } = useToast();
  // URL ?new=expense|payment|general 등 → presetType 으로 들어옴. 'leave' 도 지원.
  const initialType: RequestType = (() => {
    if (presetType === 'expense' || presetType === 'payment' || presetType === 'leave') return presetType as RequestType;
    return 'expense';
  })();
  const [form, setForm] = useState({
    requestType: initialType,
    title: "",
    amount: "",
    description: "",
  });
  // presetType 이 바뀌면 requestType 동기화 (대시보드에서 들어올 때)
  useEffect(() => {
    if (presetType && (presetType === 'expense' || presetType === 'payment' || presetType === 'leave' || presetType === 'general')) {
      const t = presetType === 'general' ? 'expense' : presetType;
      setForm(f => ({ ...f, requestType: t as RequestType }));
    }
  }, [presetType]);
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
  const [descriptionInited, setDescriptionInited] = useState<string>("");
  const [selectedApprovers, setSelectedApprovers] = useState<{ userId: string; name: string }[]>([]);
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, string>>({});
  const { data: customForms = [] } = useQuery({ queryKey: ["approval-forms", companyId], queryFn: () => listApprovalForms(), enabled: !!companyId });
  const selectedForm = (customForms as ApprovalForm[]).find((f) => `form:${f.id}` === form.requestType) || null;
  const [draftLoaded, setDraftLoaded] = useState(false);

  useEffect(() => {
    if (draftLoaded || !companyId) return;
    const draftKey = `ov-approval-draft-${companyId}`;
    const saved = localStorage.getItem(draftKey);
    if (saved) {
      try {
        const draft = JSON.parse(saved);
        if (draft.form) setForm(draft.form);
        if (draft.leaveForm) setLeaveForm(draft.leaveForm);
      } catch { /* ignore corrupt draft */ }
    }
    setDraftLoaded(true);
  }, [companyId, draftLoaded]);

  const isLeave = form.requestType === "leave";

  // Fetch current user's employee record (이메일 매칭 → user_id 폴백)
  const { data: currentEmployee } = useQuery({
    queryKey: ["my-employee", companyId, userId],
    queryFn: async () => {
      const { data: user } = await db.from("users").select("email, name").eq("id", userId).maybeSingle();
      if (!user?.email) return null;
      // 이메일로 매칭
      let { data: emp } = await db.from("employees").select("id, name, email, department").eq("company_id", companyId).eq("email", user.email).maybeSingle();
      // 이메일 실패 시 user_id로 폴백
      if (!emp) {
        const { data: empById } = await db.from("employees").select("id, name, email, department").eq("company_id", companyId).eq("user_id", userId).maybeSingle();
        emp = empById;
      }
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
    enabled: !!currentEmployee?.id,
  });

  const remainingLeave = leaveBalance ? Number(leaveBalance.total_days || 0) - Number(leaveBalance.used_days || 0) : null;

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

  // 설명 템플릿 자동입력은 matchedPolicy(아래) 정의 후 effect 로 처리 — 정책 템플릿 우선.

  // Fetch company users for approver selection
  const { data: companyUsers = [] } = useQuery({
    queryKey: ["company-users-approvers", companyId],
    queryFn: async () => {
      const { data } = await db.from("users").select("id, name, email, role").eq("company_id", companyId).order("name");
      return (data || []).filter((u: any) => u.id !== userId);
    },
    enabled: !!companyId,
  });

  // Load policies for preview
  const { data: policies = [] } = useQuery({
    queryKey: ["approval-policies", companyId],
    queryFn: () => getApprovalPolicies(companyId),
    enabled: !!companyId,
  });

  // Find matching policy for preview — 요청자 전용 정책 우선, 없으면 회사 공통(requester_id null).
  const matchedPolicy = useMemo(() => {
    const active = policies.filter((p: ApprovalPolicy) => p.is_active);
    const pick = (docType: string) => {
      const cands = active.filter((p: ApprovalPolicy) => p.document_type === docType);
      return (userId ? cands.find((p: ApprovalPolicy) => p.requester_id === userId) : undefined)
        || cands.find((p: ApprovalPolicy) => !p.requester_id) || null;
    };
    return pick(form.requestType) || pick("default");
  }, [policies, form.requestType, userId]);
  // 승인라인 변경 허용 여부 — 정책이 불허면 요청자는 승인자 지정 불가.
  const canEditLine = matchedPolicy?.allow_line_edit !== false;

  // 요청 유형 변경 시 설명란 자동 입력 — 정책의 설명 템플릿 우선, 없으면 내장 템플릿.
  useEffect(() => {
    if (isLeave || form.requestType.startsWith("form:") || form.requestType === descriptionInited) return;
    const tpl = matchedPolicy?.description_template || DESCRIPTION_TEMPLATES[form.requestType as RequestType] || "";
    setForm((prev) => ({ ...prev, description: tpl }));
    setDescriptionInited(form.requestType);
  }, [form.requestType, isLeave, descriptionInited, matchedPolicy]);

  // 커스텀 결재 양식 선택 시 — 내용 템플릿 프리필 + 결재선을 승인자로 적용
  useEffect(() => {
    if (!selectedForm || descriptionInited === form.requestType) return;
    setForm((prev) => ({ ...prev, description: selectedForm.content_template || "" }));
    setDescriptionInited(form.requestType);
    // 직원 QA #11 — 고정값(fixed) 필드는 양식 지정값으로 프리필해 제출에 포함
    const initFields: Record<string, string> = {};
    for (const fd of selectedForm.fields || []) if (fd.type === "fixed") initFields[fd.key] = fd.default_value || "";
    setCustomFieldValues(initFields);
    const approvers: { userId: string; name: string }[] = [];
    for (const st of selectedForm.stages || []) {
      if (st.approver_type === "user") {
        for (const uidv of st.approver_user_ids || []) {
          const u = (companyUsers as any[]).find((x) => x.id === uidv);
          if (u && !approvers.some((a) => a.userId === u.id)) approvers.push({ userId: u.id, name: u.name || u.email });
        }
      } else if (st.approver_role) {
        const u = (companyUsers as any[]).find((x) => x.role === st.approver_role);
        if (u && !approvers.some((a) => a.userId === u.id)) approvers.push({ userId: u.id, name: u.name || u.email });
      }
    }
    setSelectedApprovers(approvers.slice(0, 3));
  }, [selectedForm, form.requestType, descriptionInited, companyUsers]);

  const effectiveTitle = isLeave ? leaveTitle : form.title;
  const effectiveDescription = isLeave ? leaveDescription : form.description;
  // 커스텀 결재양식은 양식 자체 필드가 기준 — 일반 '금액' 입력은 숨기고(중복·혼란),
  //   양식에 금액 타입 필드가 있으면 그 값을 결재 금액으로 사용, 없으면 금액 없는 결재(0).
  const formAmountField = selectedForm ? (selectedForm.fields || []).find((fd: any) => fd.type === "amount") : null;
  const effectiveAmount = isLeave ? 0
    : selectedForm
      ? (formAmountField ? (Number(String(customFieldValues[formAmountField.key] ?? "").replace(/[^0-9.-]/g, "")) || 0) : 0)
      : (Number(form.amount) || 0);

  const canSubmit = isLeave
    ? !!leaveForm.startDate && !!leaveForm.leaveType
    : !!form.title.trim();

  const createMut = useMutation({
    mutationFn: async () => {
      // Upload attachments if any
      let attachmentUrls: string[] = [];
      const failedUploads: string[] = [];
      if (files.length > 0) {
        for (const file of files) {
          // QA 2026-07-14: 화이트리스트 치환은 업로드는 되지만 한글 파일명이 언더스코어로
          //   뭉개져 표시됨 — base64url 인코딩으로 교체(Storage key 안전 + 원본 파일명 복원 가능)
          const path = `approvals/${companyId}/${Date.now()}_${toBase64Url(file.name)}`;
          const { error } = await supabase.storage.from("documents").upload(path, file);
          if (!error) {
            const { data: urlData } = supabase.storage.from("documents").getPublicUrl(path);
            attachmentUrls.push(urlData.publicUrl);
          } else {
            // QA 2026-07-14: 업로드 실패가 조용히 무시돼 첨부파일이 항상 빠지던 문제 진단용 — 원인 노출
            failedUploads.push(`${file.name}: ${error.message}`);
          }
        }
        if (failedUploads.length > 0) {
          toast(`첨부파일 업로드 실패 — ${failedUploads.join(" / ")}`, "error");
        }
      }

      const fieldLines = selectedForm ? (selectedForm.fields || []).map((fd) => `${fd.label}: ${customFieldValues[fd.key] || ""}`).join("\n") : "";
      // 입력 필드(양식 필드) 값을 기본 템플릿 문구보다 위에 — 결재자가 실제 입력값을 먼저 보게 (2026-07-14)
      const finalDesc = [fieldLines, effectiveDescription].filter(Boolean).join("\n\n");
      return createApprovalRequest({
        companyId,
        requestType: selectedForm ? selectedForm.name : form.requestType,
        requesterId: userId,
        title: effectiveTitle,
        amount: effectiveAmount,
        description: finalDesc || undefined,
        attachments: attachmentUrls.length > 0 ? attachmentUrls : undefined,
        customApprovers: (canEditLine && selectedApprovers.length > 0) ? selectedApprovers : undefined,
        formId: selectedForm?.id,
        customFields: selectedForm ? customFieldValues : undefined,
        referenceUserIds: selectedForm?.reference_user_ids?.length ? selectedForm.reference_user_ids : undefined,
      });
    },
    onSuccess: () => {
      invalidate();
      setForm({ requestType: "expense" as RequestType, title: "", amount: "", description: "" });
      setLeaveForm({ leaveType: "annual", leaveUnit: "full_day", startDate: "", endDate: "", startTime: "", endTime: "", reason: "" });
      setFiles([]);
      setSelectedApprovers([]); setCustomFieldValues({});
      setDescriptionInited("");
      localStorage.removeItem(`ov-approval-draft-${companyId}`);
      onComplete();
    },
    onError: (err: any) => toast("결재 요청 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Form */}
      <div className="lg:col-span-2">
        <div className="glass-card p-6">
          <h3 className="text-sm font-bold mb-5">새 결재 요청</h3>

          <div className="space-y-4">
            {/* Request Type — 아이콘 칩 피커 */}
            <div>
              <label className="field-label">요청 유형 *</label>
              <div className="flex flex-wrap gap-2">
                {Object.entries(REQUEST_TYPE_LABELS).map(([k, v]) => {
                  const m = typeMeta(k);
                  const on = form.requestType === k;
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setForm({ ...form, requestType: k as RequestType })}
                      className={`inline-flex items-center gap-1.5 pl-1.5 pr-3 py-1.5 rounded-xl text-xs font-bold border transition ${
                        on
                          ? "border-[var(--primary)] bg-[var(--primary)]/8 text-[var(--primary)] shadow-sm"
                          : "border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-muted)] hover:border-[var(--primary)]/50 hover:text-[var(--text)]"
                      }`}
                    >
                      <span className={`w-6 h-6 rounded-lg flex items-center justify-center ${m.bg} ${m.text}`}>
                        <TypeIcon name={m.icon} className="w-3.5 h-3.5" />
                      </span>
                      {v}
                    </button>
                  );
                })}
                {/* 관리자가 만든 커스텀 정책 유형 — 내장 유형/기본 제외 */}
                {(policies as ApprovalPolicy[])
                  .filter((p) => p.is_active && p.document_type !== "default" && !(p.document_type in REQUEST_TYPE_LABELS))
                  .map((p) => {
                    const on = form.requestType === p.document_type;
                    return (
                      <button
                        key={p.document_type}
                        type="button"
                        onClick={() => setForm({ ...form, requestType: p.document_type as RequestType })}
                        className={`inline-flex items-center gap-1.5 pl-1.5 pr-3 py-1.5 rounded-xl text-xs font-bold border transition ${
                          on
                            ? "border-[var(--primary)] bg-[var(--primary)]/8 text-[var(--primary)] shadow-sm"
                            : "border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-muted)] hover:border-[var(--primary)]/50 hover:text-[var(--text)]"
                        }`}
                      >
                        <span className={`w-6 h-6 rounded-lg flex items-center justify-center ${TYPE_FALLBACK.bg} ${TYPE_FALLBACK.text}`}>
                          <TypeIcon name="doc" className="w-3.5 h-3.5" />
                        </span>
                        {p.label || p.name}
                      </button>
                    );
                  })}
              </div>
              {(customForms as ApprovalForm[]).length > 0 && (
                <div className="mt-3">
                  <div className="text-[11px] font-bold text-[var(--text-dim)] uppercase tracking-wider mb-1.5">회사 결재 양식</div>
                  <div className="flex flex-wrap gap-2">
                    {(customForms as ApprovalForm[]).map((f) => {
                      const on = form.requestType === `form:${f.id}`;
                      return (
                        <button
                          key={f.id}
                          type="button"
                          onClick={() => setForm({ ...form, requestType: `form:${f.id}` as RequestType })}
                          className={`inline-flex items-center gap-1.5 pl-1.5 pr-3 py-1.5 rounded-xl text-xs font-bold border transition ${
                            on
                              ? "border-[var(--primary)] bg-[var(--primary)]/8 text-[var(--primary)] shadow-sm"
                              : "border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-muted)] hover:border-[var(--primary)]/50 hover:text-[var(--text)]"
                          }`}
                        >
                          <span className="w-6 h-6 rounded-lg flex items-center justify-center bg-[var(--primary)]/12 text-[var(--primary)]">
                            <TypeIcon name="layout" className="w-3.5 h-3.5" />
                          </span>
                          {f.name}
                          {f.category && <span className="text-[10px] font-semibold text-[var(--text-dim)]">{f.category}</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* ── Leave-specific fields ── */}
            {isLeave ? (
              <>
                {/* Leave balance info */}
                {leaveForm.leaveType === "annual" && (
                  <div className="flex items-center gap-3 px-4 py-3 bg-blue-500/5 rounded-xl border border-blue-500/20 shadow-sm">
                    <div className="text-2xl font-extrabold text-blue-500">
                      {remainingLeave !== null ? remainingLeave : "-"}
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-blue-500">잔여 연차</div>
                      {leaveBalance && (
                        <div className="text-[11px] text-[var(--text-muted)]">
                          총 {leaveBalance.total_days ?? 0}일 중 {leaveBalance.used_days ?? 0}일 사용
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
                      className="field-input"
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
                      className="field-input"
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
                    <DateField
                      value={leaveForm.startDate}
                      onChange={(e) => setLeaveForm({ ...leaveForm, startDate: e.target.value, endDate: leaveForm.leaveUnit !== "full_day" ? e.target.value : leaveForm.endDate })}
                      className="field-input"
                    />
                  </div>
                  {leaveForm.leaveUnit === "full_day" && (
                    <div>
                      <label className="block text-xs text-[var(--text-muted)] mb-1">종료일 *</label>
                      <DateField
                        value={leaveForm.endDate}
                        min={leaveForm.startDate}
                        onChange={(e) => setLeaveForm({ ...leaveForm, endDate: e.target.value })}
                        className="field-input"
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
                        className="field-input"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-[var(--text-muted)] mb-1">종료 시간</label>
                      <input
                        type="time"
                        value={leaveForm.endTime}
                        onChange={(e) => setLeaveForm({ ...leaveForm, endTime: e.target.value })}
                        className="field-input"
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
                    className="field-input"
                  />
                </div>

                {/* Amount — 커스텀 양식 선택 시 숨김(양식 자체의 금액 필드가 기준, 없으면 금액 없는 결재). 선택 입력. */}
                {!selectedForm && (
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">금액 (원) <span className="text-[var(--text-dim)]">— 선택, 금액 없는 결재는 비워두세요</span></label>
                  <CurrencyInput
                    value={form.amount}
                    onValueChange={(raw) => { setForm({ ...form, amount: raw }); }}
                    placeholder="0"
                    className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)] text-right"
                  />
                </div>
                )}

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
                {selectedForm && (selectedForm.fields || []).length > 0 && (
                  <div className="space-y-2">
                    {(selectedForm.fields || []).map((fd) => (
                      <div key={fd.key}>
                        <label className="block text-xs text-[var(--text-muted)] mb-1">{fd.label}{fd.required ? " *" : ""}</label>
                        {fd.type === "textarea" ? (
                          <textarea value={customFieldValues[fd.key] || ""} onChange={(e) => setCustomFieldValues((s) => ({ ...s, [fd.key]: e.target.value }))} rows={2} className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm" />
                        ) : fd.type === "select" ? (
                          <select value={customFieldValues[fd.key] || ""} onChange={(e) => setCustomFieldValues((s) => ({ ...s, [fd.key]: e.target.value }))} className="field-input">
                            <option value="">선택</option>
                            {(fd.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
                          </select>
                        ) : fd.type === "fixed" ? (
                          /* 직원 QA #11 — 직접입력 고정값: 양식이 지정한 값 그대로(작성자 수정 불가) */
                          <input type="text" value={fd.default_value || ""} readOnly disabled
                            className="w-full px-3 py-2 bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl text-sm text-[var(--text-muted)]" />
                        ) : fd.type === "amount" ? (
                          /* 직원 QA #11 — 금액: ₩ + 천단위 콤마 */
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-dim)] text-sm">₩</span>
                            <input inputMode="numeric" value={customFieldValues[fd.key] || ""}
                              onChange={(e) => { const raw = e.target.value.replace(/[^0-9]/g, ""); setCustomFieldValues((s) => ({ ...s, [fd.key]: raw ? Number(raw).toLocaleString("ko-KR") : "" })); }}
                              placeholder="0" className="w-full pl-7 pr-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm mono-number text-right" />
                          </div>
                        ) : fd.type === "date" ? (
                          <DateField value={customFieldValues[fd.key] || ""} onChange={(e) => setCustomFieldValues((s) => ({ ...s, [fd.key]: e.target.value }))} className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm" />
                        ) : (
                          <input type={fd.type === "number" ? "number" : "text"} value={customFieldValues[fd.key] || ""} onChange={(e) => setCustomFieldValues((s) => ({ ...s, [fd.key]: e.target.value }))} className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm" />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* Approver Selection — 정책이 승인라인 변경을 불허하면 잠금 안내 */}
            {!canEditLine ? (
            <div>
              <label className="field-label">승인자 지정</label>
              <p className="text-[11px] text-[var(--text-dim)] px-3 py-2.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)]">이 양식은 결재 정책의 승인라인을 그대로 사용합니다 (요청자 변경 불가).</p>
            </div>
            ) : (
            <div>
              <label className="field-label">승인자 지정 (선택)</label>
              <div className="space-y-2">
                {selectedApprovers.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {selectedApprovers.map((a, idx) => (
                      <div key={idx} className="flex items-center gap-1.5">
                        <div className="inline-flex items-center gap-2 pl-1.5 pr-2 py-1.5 rounded-full bg-[var(--primary)]/8 border border-[var(--primary)]/25">
                          <Avatar name={a.name} size={22} />
                          <span className="text-xs font-bold text-[var(--text)]">{a.name}</span>
                          <span className="text-[10px] font-bold text-[var(--primary)]">{idx + 1}차</span>
                          <button
                            onClick={() => setSelectedApprovers(prev => prev.filter((_, i) => i !== idx))}
                            className="w-4 h-4 rounded-full flex items-center justify-center text-[var(--text-dim)] hover:text-[var(--danger)] hover:bg-[var(--danger-dim)] transition"
                            aria-label="승인자 삭제"
                          >
                            <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                          </button>
                        </div>
                        {idx < selectedApprovers.length - 1 && (
                          <svg className="w-3.5 h-3.5 text-[var(--text-dim)]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5l7 7-7 7"/></svg>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {selectedApprovers.length < 3 && companyUsers.length > 0 && (
                  <select
                    value=""
                    onChange={(e) => {
                      const u = companyUsers.find((u: any) => u.id === e.target.value);
                      if (u && !selectedApprovers.some(a => a.userId === u.id)) {
                        setSelectedApprovers(prev => [...prev, { userId: u.id, name: u.name || u.email }]);
                      }
                    }}
                    className="field-input"
                  >
                    <option value="">+ {selectedApprovers.length === 0 ? "1차" : selectedApprovers.length === 1 ? "2차" : "최종"} 승인자 추가</option>
                    {companyUsers.filter((u: any) => !selectedApprovers.some(a => a.userId === u.id)).map((u: any) => (
                      <option key={u.id} value={u.id}>{u.name || u.email} ({u.role})</option>
                    ))}
                  </select>
                )}
                {selectedApprovers.length === 0 && (
                  <p className="text-[11px] text-[var(--text-dim)]">미지정 시 결재 정책에 따라 자동 배정됩니다</p>
                )}
              </div>
            </div>
            )}

            {/* File upload — 드롭존 스타일 */}
            <div>
              <label className="field-label">첨부파일</label>
              <label className="flex flex-col items-center justify-center gap-1.5 px-4 py-6 rounded-xl border-2 border-dashed border-[var(--border)] bg-[var(--bg)]/50 hover:border-[var(--primary)]/50 hover:bg-[var(--primary)]/4 transition cursor-pointer">
                <svg className="w-6 h-6 text-[var(--text-dim)]" fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                <span className="text-xs font-semibold text-[var(--text-muted)]">클릭해서 파일 첨부</span>
                <span className="text-[10px] text-[var(--text-dim)]">여러 개 선택 가능</span>
                <input
                  type="file"
                  multiple
                  onChange={(e) => setFiles(Array.from(e.target.files || []))}
                  className="hidden"
                />
              </label>
              {files.length > 0 && (
                <div className="mt-2 space-y-1.5">
                  {files.map((f, i) => (
                    <div key={i} className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-[var(--bg-surface)] text-xs">
                      <span className="w-7 h-7 rounded-lg bg-[var(--primary)]/10 text-[var(--primary)] flex items-center justify-center shrink-0">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>
                      </span>
                      <span className="truncate flex-1 font-medium text-[var(--text)]">{f.name}</span>
                      <span className="text-[10px] text-[var(--text-dim)] mono-number shrink-0">{(f.size / 1024).toFixed(1)}KB</span>
                      <button type="button" onClick={() => setFiles(prev => prev.filter((_, idx) => idx !== i))} className="text-[var(--text-dim)] hover:text-[var(--danger)] font-bold px-1 transition">✕</button>
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
              className="btn-primary disabled:opacity-50"
            >
              {createMut.isPending ? "제출 중..." : "결재 요청"}
            </button>
            <button
              type="button"
              onClick={() => {
                const draftKey = `ov-approval-draft-${companyId}`;
                const draft = { form, leaveForm, description: form.description };
                localStorage.setItem(draftKey, JSON.stringify(draft));
                alert("임시저장되었습니다");
              }}
              className="btn-secondary"
            >
              임시저장
            </button>
            <button
              type="button"
              onClick={() => {
                setForm({ requestType: "expense" as RequestType, title: "", amount: "", description: "" });
                setLeaveForm({ leaveType: "annual", leaveUnit: "full_day", startDate: "", endDate: "", startTime: "", endTime: "", reason: "" });
                setFiles([]);
                setSelectedApprovers([]);
                localStorage.removeItem(`ov-approval-draft-${companyId}`);
              }}
              className="px-4 py-2.5 text-[var(--text-dim)] text-sm hover:text-red-400 transition"
            >
              초기화
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
          <div className="glass-card p-5">
            <div className="flex items-center gap-2 mb-3">
              <span className="w-6 h-6 rounded-lg bg-[var(--primary)]/10 text-[var(--primary)] flex items-center justify-center">
                <TypeIcon name="doc" className="w-3.5 h-3.5" />
              </span>
              <h4 className="text-sm font-bold">문서 미리보기</h4>
            </div>
            <pre className="text-xs text-[var(--text)] whitespace-pre-wrap leading-relaxed bg-[var(--bg-surface)] rounded-xl p-3.5">
              {leaveDescription}
            </pre>
          </div>
        )}

        {/* Policy Preview — 결재선 스텝퍼 */}
        <div className="glass-card p-5 sticky top-4">
          <div className="flex items-center gap-2 mb-4">
            <span className="w-6 h-6 rounded-lg bg-[var(--primary)]/10 text-[var(--primary)] flex items-center justify-center">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="19" r="3"/><circle cx="18" cy="5" r="3"/><path d="M12 19h4.5a3.5 3.5 0 000-7h-9a3.5 3.5 0 010-7H12"/></svg>
            </span>
            <h4 className="text-sm font-bold">이 요청의 결재선</h4>
          </div>

          {matchedPolicy ? (
            <div>
              <div className="flex items-center gap-2 mb-4">
                <span className="text-xs font-semibold text-[var(--text-muted)]">{matchedPolicy.name}</span>
                {matchedPolicy.auto_approve_below > 0 && (
                  <span className="badge badge-muted">{formatAmount(matchedPolicy.auto_approve_below)} 미만 자동승인</span>
                )}
              </div>
              <div className="space-y-0">
                {/* 시작: 나 */}
                <div className="relative pl-8 pb-4">
                  <div className="absolute left-[13px] top-6 bottom-0 w-px bg-[var(--border)]" />
                  <div className="absolute left-0 top-0 w-[26px] h-[26px] rounded-full bg-[var(--primary)] text-white flex items-center justify-center">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                  </div>
                  <div className="text-xs font-bold pt-1">요청 제출</div>
                  <div className="text-[11px] text-[var(--text-dim)]">나</div>
                </div>
                {(matchedPolicy.stages as ApprovalStageConfig[]).map((stage, idx) => (
                  <div key={idx} className="relative pl-8 pb-4 last:pb-0">
                    {idx < (matchedPolicy.stages as ApprovalStageConfig[]).length - 1 && (
                      <div className="absolute left-[13px] top-6 bottom-0 w-px bg-[var(--border)]" />
                    )}
                    <div className="absolute left-0 top-0 w-[26px] h-[26px] rounded-full border-2 border-[var(--primary)]/40 bg-[var(--primary)]/8 flex items-center justify-center text-[11px] font-extrabold text-[var(--primary)]">
                      {stage.stage}
                    </div>
                    <div className="text-xs font-bold pt-1">{stage.name}</div>
                    <div className="text-[11px] text-[var(--text-dim)]">
                      {(stage as any).approver_name || stage.approver_role}
                      {(stage.required_count ?? 1) > 1 && ` · ${stage.required_count}명 승인 필요`}
                    </div>
                  </div>
                ))}
              </div>

              {/* Auto-approve indicator */}
              {matchedPolicy.auto_approve_below > 0 && effectiveAmount > 0 && effectiveAmount < matchedPolicy.auto_approve_below && (
                <div className="kpi-callout success mt-3">이 금액은 <b>자동 승인</b> 대상이에요</div>
              )}
            </div>
          ) : selectedApprovers.length > 0 ? (
            /* 직원 QA #11 — 양식 결재선이 지정돼 있으면 그걸 미리보기에 반영(대표/CEO 강제 표시 제거).
               실제 라우팅은 이미 customApprovers(양식 결재선)로 처리됨 — 미리보기만 정합화. */
            <div className="text-xs text-[var(--text-muted)]">
              <div className="kpi-callout mb-4">이 양식의 <b>결재선</b>이 적용돼요 — 지정한 승인자에서 종료(대표 결재 없음)</div>
              <div className="space-y-0">
                <div className="relative pl-8 pb-4">
                  <div className="absolute left-[13px] top-6 bottom-0 w-px bg-[var(--border)]" />
                  <div className="absolute left-0 top-0 w-[26px] h-[26px] rounded-full bg-[var(--primary)] text-white flex items-center justify-center">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                  </div>
                  <div className="text-xs font-bold pt-1">요청 제출</div>
                  <div className="text-[11px] text-[var(--text-dim)]">나</div>
                </div>
                {selectedApprovers.map((a, idx) => (
                  <div key={a.userId} className="relative pl-8 pb-4 last:pb-0">
                    {idx < selectedApprovers.length - 1 && <div className="absolute left-[13px] top-6 bottom-0 w-px bg-[var(--border)]" />}
                    <div className="absolute left-0 top-0 w-[26px] h-[26px] rounded-full border-2 border-[var(--primary)]/40 bg-[var(--primary)]/8 flex items-center justify-center text-[11px] font-extrabold text-[var(--primary)]">{idx + 1}</div>
                    <div className="text-xs font-bold pt-1">{idx + 1}차 승인</div>
                    <div className="text-[11px] text-[var(--text-dim)]">{a.name}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-xs text-[var(--text-muted)]">
              <div className="kpi-callout mb-4">매칭 정책이 없어 <b>기본 결재선(1단계)</b>이 적용돼요</div>
              <div className="relative pl-8">
                <div className="absolute left-0 top-0 w-[26px] h-[26px] rounded-full border-2 border-[var(--primary)]/40 bg-[var(--primary)]/8 flex items-center justify-center text-[11px] font-extrabold text-[var(--primary)]">
                  1
                </div>
                <div className="text-xs font-bold pt-1 text-[var(--text)]">최종 승인</div>
                <div className="text-[11px] text-[var(--text-dim)]">승인자: CEO</div>
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
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<ApprovalPolicy | null>(null);
  const [form, setForm] = useState({
    name: "",
    documentType: "expense",
    customType: "",
    label: "",
    descriptionTemplate: "",
    autoApproveBelow: "",
    allowLineEdit: true,
    requesterId: "",
    stages: [{ stage: 1, name: "팀장 승인", approver_role: "manager" }] as ApprovalStageConfig[],
  });

  const { data: policies = [], isLoading } = useQuery({
    queryKey: ["approval-policies", companyId],
    queryFn: () => getApprovalPolicies(companyId),
    enabled: !!companyId,
  });

  // 단계별 '특정 인물' 승인자 선택용 회사 구성원
  const { data: orgUsers = [] } = useQuery({
    queryKey: ["policy-org-users", companyId],
    queryFn: async () => {
      const { data } = await db.from("users").select("id, name, email, role").eq("company_id", companyId).order("name");
      return (data || []) as { id: string; name: string | null; email: string; role: string }[];
    },
    enabled: !!companyId,
  });

  const upsertMut = useMutation({
    mutationFn: () =>
      upsertApprovalPolicy({
        id: editingPolicy?.id,
        company_id: companyId,
        name: form.name,
        document_type: form.documentType === "__custom__" ? (form.customType.trim() || "custom") : form.documentType,
        label: form.label.trim() || undefined,
        description_template: form.descriptionTemplate.trim() || undefined,
        stages: form.stages,
        auto_approve_below: Number(form.autoApproveBelow) || 0,
        allow_line_edit: form.allowLineEdit,
        requester_id: form.requesterId || null,
        is_active: true,
      }),
    onSuccess: () => {
      invalidate();
      resetForm();
    },
    onError: (err: any) => toast("정책 저장 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteApprovalPolicy(id),
    onSuccess: invalidate,
    onError: (err: any) => toast("정책 삭제 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
  });

  function resetForm() {
    setShowForm(false);
    setEditingPolicy(null);
    setForm({
      name: "",
      documentType: "expense",
      customType: "",
      label: "",
      descriptionTemplate: "",
      autoApproveBelow: "",
      allowLineEdit: true,
      requesterId: "",
      stages: [{ stage: 1, name: "팀장 승인", approver_role: "manager" }],
    });
  }

  function startEdit(policy: ApprovalPolicy) {
    setEditingPolicy(policy);
    const isBuiltin = policy.document_type === "default" || policy.document_type in REQUEST_TYPE_LABELS;
    setForm({
      name: policy.name,
      documentType: isBuiltin ? policy.document_type : "__custom__",
      customType: isBuiltin ? "" : policy.document_type,
      label: policy.label || "",
      descriptionTemplate: policy.description_template || "",
      autoApproveBelow: policy.auto_approve_below ? String(policy.auto_approve_below) : "",
      allowLineEdit: policy.allow_line_edit !== false,
      requesterId: policy.requester_id || "",
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
          className="btn-primary"
        >
          + 정책 추가
        </button>
      </div>

      {/* Policy Form */}
      {showForm && (
        <div className="glass-card p-6 mb-6">
          <h3 className="section-title">{editingPolicy ? "양식 · 결재선 수정" : "새 양식 · 결재선"}</h3>

          <div className="grid grid-cols-3 gap-4 mb-4">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">정책 이름 *</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="예: 경비 결재 정책"
                className="field-input"
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">적용 문서 유형 *</label>
              <select
                value={form.documentType}
                onChange={(e) => setForm({ ...form, documentType: e.target.value })}
                className="field-input"
              >
                {Object.entries(REQUEST_TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
                <option value="default">기본 (전체)</option>
                <option value="__custom__">+ 커스텀 유형(직접 입력)</option>
              </select>
              {form.documentType === "__custom__" && (
                <input
                  value={form.customType}
                  onChange={(e) => setForm({ ...form, customType: e.target.value.replace(/\s/g, "_") })}
                  placeholder="커스텀 유형 키 (영문/숫자, 예: media_buy)"
                  className="field-input mt-2"
                />
              )}
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">자동승인 기준 금액 (원)</label>
              <CurrencyInput
                value={form.autoApproveBelow}
                onValueChange={(raw) => { setForm({ ...form, autoApproveBelow: raw }); }}
                placeholder="0 (비활성)"
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)] text-right"
              />
            </div>
          </div>

          {/* 양식(요청자 화면) 표시 이름 + 설명 템플릿 */}
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">양식 표시 이름 (선택)</label>
              <input
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder="새 요청 유형에 보일 이름 (미입력 시 기본)"
                className="field-input"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-[var(--text-muted)] mb-1">설명 템플릿 (선택)</label>
              <textarea
                value={form.descriptionTemplate}
                onChange={(e) => setForm({ ...form, descriptionTemplate: e.target.value })}
                placeholder="이 양식 선택 시 요청 설명란에 자동 입력될 내용"
                rows={3}
                className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)] resize-y"
              />
            </div>
            {/* 요청자별 정책 + 승인라인 변경 허용 (2026-07-10) */}
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">적용 대상 요청자 (선택)</label>
              <select value={form.requesterId} onChange={(e) => setForm({ ...form, requesterId: e.target.value })} className="field-input">
                <option value="">회사 전체 (기본)</option>
                {orgUsers.map((u) => (
                  <option key={u.id} value={u.id}>{u.name || u.email}</option>
                ))}
              </select>
              <p className="text-[10px] text-[var(--text-dim)] mt-1">특정 요청자를 고르면 그 사람 요청에만 이 정책이 우선 적용됩니다.</p>
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">승인라인 변경</label>
              <label className="flex items-center gap-2 mt-1.5 cursor-pointer">
                <input type="checkbox" checked={form.allowLineEdit} onChange={(e) => setForm({ ...form, allowLineEdit: e.target.checked })} className="w-4 h-4 accent-[var(--primary)]" />
                <span className="text-sm text-[var(--text)]">요청자가 승인자(승인라인)를 바꿀 수 있음</span>
              </label>
              <p className="text-[10px] text-[var(--text-dim)] mt-1">해제 시 요청자는 정책의 승인라인을 그대로 사용해야 합니다.</p>
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
                  {/* 승인자 유형: 역할 / 특정 인물(플렉스식) */}
                  <select
                    value={stage.approver_id ? "person" : "role"}
                    onChange={(e) => {
                      const updated = [...form.stages];
                      if (e.target.value === "role") { delete (updated[idx] as any).approver_id; delete (updated[idx] as any).approver_name; updated[idx].approver_role = updated[idx].approver_role || "ceo"; }
                      else { const u = orgUsers[0]; (updated[idx] as any).approver_id = u?.id || ""; (updated[idx] as any).approver_name = u?.name || u?.email || ""; }
                      setForm({ ...form, stages: updated });
                    }}
                    className="w-24 px-2 py-2 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]"
                  >
                    <option value="role">역할</option>
                    <option value="person">특정 인물</option>
                  </select>
                  {stage.approver_id ? (
                    <select
                      value={stage.approver_id}
                      onChange={(e) => {
                        const u = orgUsers.find((x) => x.id === e.target.value);
                        const updated = [...form.stages];
                        (updated[idx] as any).approver_id = e.target.value;
                        (updated[idx] as any).approver_name = u?.name || u?.email || "";
                        setForm({ ...form, stages: updated });
                      }}
                      className="w-40 px-2 py-2 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]"
                    >
                      {orgUsers.map((u) => (
                        <option key={u.id} value={u.id}>{u.name || u.email}</option>
                      ))}
                    </select>
                  ) : (
                    <select
                      value={stage.approver_role}
                      onChange={(e) => updateStage(idx, "approver_role", e.target.value)}
                      className="w-32 px-3 py-2 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]"
                    >
                      {ROLE_OPTIONS.map((r) => (
                        <option key={r.value} value={r.value}>{r.label}</option>
                      ))}
                    </select>
                  )}
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
              className="btn-primary disabled:opacity-50"
            >
              {upsertMut.isPending ? "저장 중..." : editingPolicy ? "수정" : "저장"}
            </button>
            <button onClick={resetForm} className="px-4 py-2 text-[var(--text-muted)] text-sm">취소</button>
          </div>
        </div>
      )}

      {/* Policy List — 결재선 플로우 카드 */}
      {policies.length === 0 && !showForm ? (
        <div className="text-center py-20 px-6 glass-card">
          <div className="mx-auto w-16 h-16 mb-4 rounded-2xl bg-[var(--primary-light)] text-[var(--primary)] flex items-center justify-center">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="19" r="3"/><circle cx="18" cy="5" r="3"/><path d="M12 19h4.5a3.5 3.5 0 000-7h-9a3.5 3.5 0 010-7H12"/></svg>
          </div>
          <div className="text-base font-bold mb-1.5">등록된 결재 정책이 없습니다</div>
          <div className="text-sm text-[var(--text-muted)] mb-5">정책을 추가하면 결재 요청 시 자동으로 적용됩니다</div>
          <button onClick={() => { resetForm(); setShowForm(true); }} className="btn-primary">+ 정책 추가</button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {policies.map((policy: ApprovalPolicy) => {
            const m = typeMeta(policy.document_type);
            const stages = policy.stages as ApprovalStageConfig[];
            return (
              <div key={policy.id} className="glass-card card-hover p-5 group">
                <div className="flex items-start gap-3 mb-4">
                  <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${m.bg} ${m.text}`}>
                    <TypeIcon name={m.icon} className="w-5 h-5" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm truncate">{policy.name}</span>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${policy.is_active ? "bg-[var(--success-dim)] text-[var(--success)]" : "bg-[var(--bg-surface)] text-[var(--text-dim)]"}`}>
                        <span className={`w-1 h-1 rounded-full ${policy.is_active ? "bg-[var(--success)]" : "bg-[var(--text-dim)]"}`} />
                        {policy.is_active ? "활성" : "비활성"}
                      </span>
                    </div>
                    <div className="text-[11px] text-[var(--text-dim)] mt-0.5">
                      {REQUEST_TYPE_LABELS[policy.document_type as RequestType] || policy.document_type} · {stages.length}단계
                      {policy.auto_approve_below > 0 && ` · ${formatAmount(policy.auto_approve_below)} 미만 자동승인`}
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => startEdit(policy)}
                      className="p-2 rounded-lg text-[var(--text-muted)] hover:text-[var(--primary)] hover:bg-[var(--primary)]/10 transition"
                      title="수정"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                    </button>
                    <button
                      onClick={() => { if (confirm("이 정책을 삭제하시겠습니까?")) deleteMut.mutate(policy.id); }}
                      disabled={deleteMut.isPending}
                      className="p-2 rounded-lg text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--danger-dim)] transition disabled:opacity-50"
                      title="삭제"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                    </button>
                  </div>
                </div>
                {/* Stage flow — 번호 서클 + 화살표 */}
                <div className="flex items-center gap-1.5 flex-wrap px-3 py-2.5 rounded-xl bg-[var(--bg-surface)]/70">
                  {stages.map((stage, idx) => (
                    <div key={idx} className="flex items-center gap-1.5">
                      <span className="inline-flex items-center gap-1.5 pl-1 pr-2.5 py-1 rounded-full bg-[var(--bg-card)] border border-[var(--border)]">
                        <span className="w-4.5 h-4.5 min-w-[18px] min-h-[18px] rounded-full bg-[var(--primary)]/10 text-[var(--primary)] flex items-center justify-center text-[9px] font-extrabold">{stage.stage}</span>
                        <span className="text-[11px] font-semibold text-[var(--text)]">{stage.name}</span>
                      </span>
                      {idx < stages.length - 1 && (
                        <svg className="w-3 h-3 text-[var(--text-dim)]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M9 5l7 7-7 7" />
                        </svg>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
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
      <div className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-4">결재 타임라인</div>

      {/* Horizontal stage stepper */}
      <div className="flex items-center gap-0 mb-5 overflow-x-auto pb-1">
        {stages.map(([stageNum, steps], idx) => {
          const allApproved = steps.every((s) => s.status === "approved");
          const anyRejected = steps.some((s) => s.status === "rejected");
          const isCurrent = stageNum === currentStage && requestStatus === "pending";

          let circleClass = "border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-dim)]";
          if (allApproved) circleClass = "border-[var(--success)] bg-[var(--success)] text-white shadow-sm";
          else if (anyRejected) circleClass = "border-[var(--danger)] bg-[var(--danger)] text-white shadow-sm";
          else if (isCurrent) circleClass = "border-[var(--primary)] bg-[var(--primary)] text-white shadow-sm ring-4 ring-[var(--primary)]/15";

          return (
            <div key={stageNum} className="flex items-center">
              <div className="flex flex-col items-center min-w-[84px]">
                <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center text-[11px] font-extrabold transition ${circleClass}`}>
                  {allApproved ? (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 13l4 4L19 7" />
                    </svg>
                  ) : anyRejected ? (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  ) : (
                    stageNum
                  )}
                </div>
                <div className={`text-[10px] mt-1.5 font-bold whitespace-nowrap ${isCurrent ? "text-[var(--primary)]" : allApproved ? "text-[var(--success)]" : "text-[var(--text-muted)]"}`}>
                  {steps[0]?.stage_name || `${stageNum}단계`}
                </div>
              </div>
              {idx < stages.length - 1 && (
                <div className={`h-[3px] w-10 rounded-full -mt-5 ${allApproved ? "bg-[var(--success)]" : "bg-[var(--border)]"}`} />
              )}
            </div>
          );
        })}
      </div>

      {/* Detailed steps */}
      <div className="space-y-2.5">
        {timeline.map((step) => (
          <div key={step.id} className="flex items-start gap-3 text-xs">
            <Avatar name={step.approver_name || "담당자"} size={26} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold">{step.approver_name || "담당자"}</span>
                <span className="text-[var(--text-dim)]">{step.stage_name}</span>
                <StatusBadge status={step.status} />
              </div>
              {step.comment && (
                <div className="mt-1.5 inline-block px-3 py-2 rounded-xl rounded-tl-sm bg-[var(--bg-surface)] text-[var(--text-muted)] whitespace-pre-wrap">{step.comment}</div>
              )}
            </div>
            <div className="text-[var(--text-dim)] shrink-0 mono-number">
              {step.decided_at ? formatDateTime(step.decided_at) : "대기 중"}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// 분할 패널 우측 — 플렉스 스타일 "승인·참조" 사이드바 (담당자별 단계·상태 요약)
function ApprovalStageSidebar({ requestId, referenceUsers }: { requestId: string; referenceUsers?: { id: string; name: string }[] }) {
  const { data: steps = [] } = useQuery({
    queryKey: ["activity-timeline", requestId],
    queryFn: () => getApprovalTimeline(requestId),
    enabled: !!requestId,
  });
  if (steps.length === 0 && (!referenceUsers || referenceUsers.length === 0)) return null;
  return (
    <div className="space-y-5">
      {referenceUsers && referenceUsers.length > 0 && (
        <div>
          <div className="text-[11px] font-bold text-[var(--text-dim)] uppercase tracking-wider mb-3">참조</div>
          <div className="space-y-3">
            {referenceUsers.map((u) => (
              <div key={u.id} className="flex items-center gap-2.5">
                <Avatar name={u.name} size={26} />
                <div className="flex-1 min-w-0 text-[13px] font-bold truncate">{u.name}</div>
                <span className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold bg-[var(--bg-surface)] text-[var(--text-dim)]">참조</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {steps.length > 0 && (
        <div>
          <div className="text-[11px] font-bold text-[var(--text-dim)] uppercase tracking-wider mb-3">승인선</div>
          <div className="space-y-3.5">
            {steps.map((s) => (
              <div key={s.id} className="flex items-start gap-2.5">
                <Avatar name={s.approver_name || "담당자"} size={28} />
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-bold truncate">{s.approver_name || "담당자"}</div>
                  <div className="text-[10px] text-[var(--text-dim)] truncate">{s.stage_name}</div>
                </div>
                <div className="shrink-0 mt-0.5"><StatusBadge status={s.status} /></div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── D-7: 워크플로우 활동 타임라인 (vertical) ──
function ActivityTimeline({ requestId }: { requestId: string }) {
  const { data: steps = [], isLoading } = useQuery({
    queryKey: ["activity-timeline", requestId],
    queryFn: () => getApprovalTimeline(requestId),
    enabled: !!requestId,
  });

  // 결재 댓글 스레드 — 승인/반려 후에도 회사 구성원 누구든 대화 (approval_comments, 2026-07-10)
  const qc = useQueryClient();
  const { toast } = useToast();
  const [commentText, setCommentText] = useState("");
  const [me, setMe] = useState<{ id: string; company_id: string } | null>(null);
  useEffect(() => { getCurrentUser().then((u) => u && setMe({ id: u.id, company_id: u.company_id })).catch(() => {}); }, []);
  const { data: comments = [] } = useQuery({
    queryKey: ["approval-comments", requestId],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("approval_comments")
        .select("id, user_id, body, created_at, users:user_id(name, email)")
        .eq("request_id", requestId)
        .order("created_at", { ascending: true });
      return (data || []) as any[];
    },
    enabled: !!requestId,
  });
  const postComment = async () => {
    if (!me || !commentText.trim()) return;
    const { error } = await (supabase as any).from("approval_comments").insert({
      company_id: me.company_id, request_id: requestId, user_id: me.id, body: commentText.trim(),
    });
    if (error) { toast("댓글 등록 실패: " + error.message, "error"); return; }
    setCommentText("");
    qc.invalidateQueries({ queryKey: ["approval-comments", requestId] });
  };
  const deleteComment = async (id: string) => {
    await (supabase as any).from("approval_comments").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["approval-comments", requestId] });
  };

  if (isLoading) {
    return <div className="text-xs text-[var(--text-muted)] py-2">활동 이력 로딩 중...</div>;
  }

  if (steps.length === 0 && comments.length === 0) {
    return <div className="text-xs text-[var(--text-muted)] py-2">활동 이력이 없습니다</div>;
  }

  // 상태별 아이콘 서클 (체크/엑스/시계)
  const stepVisual = (status: string) => {
    if (status === "approved") return { cls: "bg-[var(--success-dim)] text-[var(--success)]", icon: <path d="M5 13l4 4L19 7" /> };
    if (status === "rejected") return { cls: "bg-[var(--danger-dim)] text-[var(--danger)]", icon: <path d="M6 18L18 6M6 6l12 12" /> };
    if (status === "pending") return { cls: "bg-[var(--warning-dim)] text-[var(--warning)]", icon: <><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15.5 14" /></> };
    return { cls: "bg-[var(--bg-surface)] text-[var(--text-dim)]", icon: <path d="M5 12h14" /> };
  };

  return (
    <div>
      <div className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-4">활동 타임라인</div>
      <div className="space-y-0">
        {steps.map((step, i) => {
          const v = stepVisual(step.status);
          return (
            <div key={step.id} className="flex gap-3">
              {/* Vertical line + icon circle */}
              <div className="flex flex-col items-center">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${v.cls}`}>
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">{v.icon}</svg>
                </div>
                {i < steps.length - 1 && <div className="w-px flex-1 bg-[var(--border)] my-0.5" />}
              </div>
              {/* Content */}
              <div className="pb-4 flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-bold text-[var(--text)]">{step.approver_name || "담당자"}</span>
                  <StatusBadge status={step.status} />
                  <span className="caption">{step.stage_name}</span>
                </div>
                <div className="text-[10px] text-[var(--text-dim)] mt-0.5 mono-number">
                  {step.decided_at ? formatDateTime(step.decided_at) : step.created_at ? `${formatDateTime(step.created_at)} 배정` : "대기 중"}
                </div>
                {step.comment && (
                  <div className="mt-1.5 inline-block px-3 py-2 rounded-xl rounded-tl-sm bg-[var(--bg-surface)] text-xs text-[var(--text-muted)] whitespace-pre-wrap">{step.comment}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 댓글 스레드 — 결정 후에도 대화 가능 */}
      <div className="mt-4 pt-3 border-t border-[var(--border)]/60">
        <div className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">댓글 {comments.length > 0 && <span className="text-[var(--text-dim)]">{comments.length}</span>}</div>
        {comments.length > 0 && (
          <div className="space-y-2 mb-3">
            {comments.map((c: any) => (
              <div key={c.id} className="flex items-start gap-2">
                <Avatar name={c.users?.name || c.users?.email || "?"} size={22} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold text-[var(--text)]">{c.users?.name || c.users?.email || "구성원"}</span>
                    <span className="text-[10px] text-[var(--text-dim)] mono-number">{formatDateTime(c.created_at)}</span>
                    {me?.id === c.user_id && (
                      <button onClick={() => deleteComment(c.id)} className="text-[10px] text-[var(--text-dim)] hover:text-[var(--danger)]">삭제</button>
                    )}
                  </div>
                  <div className="mt-0.5 inline-block px-3 py-1.5 rounded-xl rounded-tl-sm bg-[var(--bg-surface)] text-xs text-[var(--text)] whitespace-pre-wrap">{c.body}</div>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          <input
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) postComment(); }}
            placeholder="댓글을 입력하세요 (Enter로 등록)"
            className="flex-1 px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-xs focus:outline-none focus:border-[var(--primary)]"
          />
          <button onClick={postComment} disabled={!commentText.trim()}
            className="px-3 py-2 rounded-xl text-xs font-semibold bg-[var(--primary)] text-white hover:opacity-90 disabled:opacity-40">등록</button>
        </div>
      </div>
    </div>
  );
}
