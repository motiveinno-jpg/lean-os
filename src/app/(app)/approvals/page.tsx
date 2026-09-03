"use client";
import { koFallback } from "@/lib/ko-label";

import { kstDateTime, kstDateStr } from "@/lib/kst";
import { Ico } from "@/components/ui-icon";
import { logRead } from "@/lib/log-read";
import { appConfirm } from "@/components/global-confirm";
import { useMyPermissions } from "@/lib/permissions";
import { useEffect, useState, useMemo, useRef, Fragment } from "react";
import { DateField } from "@/components/date-field";
import { friendlyError } from "@/lib/friendly-error";
import { readCachedFavorites, loadApprovalTypeFavorites, saveApprovalTypeFavorites } from "@/lib/approval-type-favorites";
import { useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getCurrentUser } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import { createNotification, notifyOvertimeDecision } from "@/lib/notifications";
import { isCompanyWidePolicy,
  getApprovalPolicies,
  upsertApprovalPolicy,
  deleteApprovalPolicy,
  pickPolicyForRequester,
  policyTargets,
  policyRules,
  pickRuleForRequester,
  rulesNeedEmployeeInfo,
  createApprovalRequest,
  updateApprovalRequest,
  approveStep,
  rejectStep,
  getMyPendingApprovals,
  getMyProcessedApprovals,
  getApprovalTimeline,
  getApprovalRequests,
  getMyRequests,
  getReferencedRequests,
  resubmitRequest,
  getApprovalStats,
  deleteApprovalRequest,
  updateApprovalStepComment,
  REQUEST_TYPE_LABELS,
  type RequestType,
  type ApprovalPolicy,
  type ApprovalRequest,
  type ApprovalStep,
  type ApprovalStageConfig,
  type ApprovalPolicyRule,
  type PolicyRuleTargetMode,
} from "@/lib/approval-workflow";
import { RichEditor, type RichEditorRef } from "@/components/rich-editor";
import { sanitizeDocumentHtml } from "@/lib/sanitize-html";
import { CurrencyInput } from "@/components/currency-input";
import { Avatar } from "@/components/avatar";
import { useToast } from "@/components/toast";
import { SortableTh, nextSort, cmp, type SortState } from "@/components/sortable-th";
import { QueryScreen, QueryHead, QueryBody, QueryBar, ResultStrip, Stat, ChipGroup, QuickSearch, quickSearchHit, ConditionPanel, ConditionRow, TokenField, AmountRange, amountHit, AppliedChips, RowsPerPage, Pager, usePager, SelectionBar, type AppliedChip } from "@/components/query-kit";
import { DateRangeField } from "@/components/date-range-field";
import { ApprovalFormsManager } from "@/components/approval-forms-manager";
import { useConfirm } from "@/components/confirm-dialog";
import { useModalKeys } from "@/hooks/use-modal-keys";
import { useAvatarMap } from "@/hooks/use-avatar-map";
import { listApprovalForms, type ApprovalForm } from "@/lib/approval-forms";
import { computeHalfDaySlot, LEAVE_TYPES, calcLeaveDays } from "@/lib/hr";
import { generateApprovalPdf } from "@/lib/document-generator";
import { openStoredFile, downloadStoredFile, resolveSignedUrl } from "@/lib/file-storage";
import { getCompanyLeaveTypes, defaultCompanyLeaveTypes } from "@/lib/leave-grants";
import { sendApprovalMails } from "@/lib/approval-email";

const db = supabase;

type Tab = "my-approvals" | "my-requests" | "references" | "all" | "new-request" | "policies" | "forms";

// 알림/딥링크(?tab=...)로 진입 가능한 탭 키 — 오타·구 링크는 무시하고 기본 탭 유지
const TAB_KEYS: Tab[] = ["my-approvals", "my-requests", "references", "all", "new-request", "policies", "forms"];

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
    // 2026-07-21 QA: 좁은 표 셀에서 "대기"가 "대/기" 두 줄로 꺾이던 문제 — nowrap
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold leading-none whitespace-nowrap ${config.bg} ${config.text}`}>
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
  purchase: { icon: "cart", bg: "bg-orange-500/12", text: "text-orange-500" },
  equipment: { icon: "monitor", bg: "bg-cyan-600/12", text: "text-cyan-600" },
  contract: { icon: "pen", bg: "bg-[var(--primary)]/12", text: "text-[var(--primary)]" },
  travel: { icon: "plane", bg: "bg-blue-500/12", text: "text-blue-500" },
  approval_doc: { icon: "doc", bg: "bg-rose-500/12", text: "text-rose-500" },
  certificate: { icon: "doc", bg: "bg-teal-500/12", text: "text-teal-600" },
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
      {/*   라벨은 '끝난 단계 수' — 대기 중인 단계는 안 센다. 2단계 중 2번째가 대기면 1/2 (종전 2/2 라 완료처럼 보였다, 2026-09-02 전 화면 점검) */}
      <span className="text-[10px] font-bold text-[var(--text-dim)] mono-number shrink-0">{status === "approved" ? total : Math.max(0, Math.min(current, total) - 1)}/{total}</span>
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

/** 댓글에 붙은 그림 미리보기 — documents 버킷은 **비공개**라 저장된 공개 주소로는 안 그려진다
 *  (2026-08-06: 프로젝트 표에서 같은 원인으로 첨부가 안 열렸다). 띄울 때 서명 주소를 받아 그린다.
 *  ⚠️ 여기서는 downloadName 을 주지 않는다 — 주면 '내려받기'로 바뀌어 그림이 안 보인다. */
function AttachmentThumb({ url, name }: { url: string; name: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    resolveSignedUrl(url).then((u) => { if (alive) setSrc(u); });
    return () => { alive = false; };
  }, [url]);
  if (!src) return <span className="approval-att-thumb-wait">불러오는 중…</span>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={name} className="approval-att-thumb" />;
}

function AttachmentList({ attachments }: { attachments?: string[] }) {
  if (!attachments || attachments.length === 0) return null;
  return (
    <div className="approval-attachment-list">
      <div className="text-[11px] font-semibold text-[var(--text-dim)] mb-1.5">첨부파일 ({attachments.length})</div>
      <div className="flex flex-wrap gap-2">
        {attachments.map((url, i) => (
          <button
            key={i}
            type="button"
            onClick={(e) => { e.stopPropagation(); downloadStoredFile(url, attachmentFileName(url)); }}
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

// 보드 스타일 구조화 필드 행 — 타입별 아이콘 + 라벨 + 값
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
    <div className="approval-form-field-rows">
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

/**
 * 결재 문서의 구조화 필드(라벨+값) 해석.
 *   - 커스텀 양식 문서(form_id 有) → approval_forms.fields
 *   - 기본 유형 문서(form_id 無, 휴가·출장·지출결의 등) → approval_policies.fields
 * 기존엔 앞쪽만 봐서 기본 유형은 필드가 항상 빈 배열이었고(→ 화면·PDF 에서 표 대신 평문),
 * 삭제된 양식도 못 찾아 같은 증상이 났다. 편집 경로(getEditFieldDefs)와 동일 규칙으로 통일.
 */
/** 휴가 구조화 데이터(custom_fields.leave) → 필드 행 (2026-08-12 사장님: 승인자 화면에
 *  평문이 아니라 신청 필드폼처럼 보이게). 종류·단위·기간·시간·일수를 라벨+값으로 푼다. */
function leaveFieldRows(customFields?: Record<string, unknown>): { label: string; type: string; value: string }[] {
  const lv = customFields?.leave as Record<string, unknown> | undefined;
  if (!lv || typeof lv !== "object") return [];
  const typeLabel = LEAVE_TYPES.find((t) => t.value === lv.leave_type)?.label || String(lv.leave_type || "-");
  const unitLabel = lv.leave_unit === "half_day" ? "반차" : lv.leave_unit === "two_hours" ? "시간차" : "종일";
  const start = String(lv.start_date || "");
  const end = String(lv.end_date || "");
  const rows = [
    { label: "휴가 종류", type: "select", value: typeLabel },
    { label: "단위", type: "select", value: unitLabel },
    { label: "기간", type: "date", value: start ? (end && end !== start ? `${start} ~ ${end}` : start) : "-" },
  ];
  if (lv.start_time || lv.end_time) {
    rows.push({ label: "시간", type: "text", value: `${String(lv.start_time || "").slice(0, 5)} ~ ${String(lv.end_time || "").slice(0, 5)}` });
  }
  if (lv.days != null && lv.days !== "") rows.push({ label: "사용 일수", type: "number", value: `${lv.days}일` });
  return rows;
}

/** 초과근무 구조화 데이터(custom_fields.overtime) → 필드 행 (2026-08-20 사장님 제보:
 *  "몇 시까지 할 건지 입력해도 시간이 안 나타난다"). 신청서에 적은 일자·종료시각이
 *  상세·목록·PDF 어디에도 표시되는 경로가 없었다 — 휴가(leaveFieldRows)와 같은 방식으로 푼다. */
function overtimeFieldRows(customFields?: Record<string, unknown>): { label: string; type: string; value: string }[] {
  const ot = customFields?.overtime as Record<string, unknown> | undefined;
  if (!ot || typeof ot !== "object") return [];
  const date = String(ot.date || "");
  const end = String(ot.end_time || "").slice(0, 5);
  const rows: { label: string; type: string; value: string }[] = [];
  if (date) rows.push({ label: "초과근무 일자", type: "date", value: date });
  if (end) rows.push({ label: "종료 예정 시각", type: "text", value: end });
  return rows;
}

function resolveFormFields(
  formId: string | null | undefined,
  customFields: Record<string, unknown> | undefined,
  formsById: Map<string, ApprovalForm>,
  policies?: ApprovalPolicy[],
  requestType?: string
): { label: string; type: string; value: string }[] {
  // 휴가·초과근무는 구조화 데이터가 원본 — 필드 정의 유무와 무관하게 항상 폼 행으로 먼저 푼다.
  const leaveRows = [...leaveFieldRows(customFields), ...overtimeFieldRows(customFields)];
  const defs = formId
    ? formsById.get(formId)?.fields
    : ((policies || []).find((p) => p.document_type === requestType && isCompanyWidePolicy(p)) || (policies || []).find((p) => p.document_type === requestType))?.fields;
  if (!defs || defs.length === 0) return leaveRows;
  // 값이 빈 필드도 포함한다 — 양식에 있는 항목이면 표에 있어야 하고, 빼버리면 본문에
  // 병합돼 있던 "라벨: " 줄이 제거되지 않아 표 밖으로 새어 나온다
  // (2026-07-27 사장님 제보: 관련프로젝트가 표 밖에 찍힘).
  // 빈 값은 "-" 로 표시해 빈 칸이 비어 보이지 않게 한다(사장님 요청). 본문 병합줄
  // 제거는 라벨로만 매칭하므로 이 치환에 영향받지 않는다.
  return [
    ...leaveRows,
    ...defs.map((fd) => {
      const raw = String(customFields?.[fd.key] ?? "").trim();
      return { label: fd.label, type: fd.type, value: raw || "-" };
    }),
  ];
}

/**
 * 결재 문서 PDF 생성 + 저장 — 화면(팝업)과 동일한 구성으로 만든다.
 *   전체 현황 / 내 요청 / 내가 결재한 건 세 화면이 같은 결과물을 내도록 한 곳에 모았다.
 *   (과거 '내 요청'에만 PDF 가 빠져 있었고, 본문 평문화 버그도 화면마다 따로 고쳐야 했다.)
 * @returns 저장 완료 여부 (사용자가 저장 취소하면 false)
 */
async function buildAndSaveApprovalPdf(args: {
  req: {
    id: string; title: string; request_type: string; status: string;
    amount?: number | null; description?: string | null; created_at: string;
    attachments?: string[] | null; form_id?: string | null;
    custom_fields?: Record<string, unknown>;
  };
  requesterName: string;
  formFields: { label: string; type: string; value: string }[];
}): Promise<boolean> {
  const { req, requesterName, formFields } = args;
  const timeline = await getApprovalTimeline(req.id);
  // 상태는 목록 캐시가 아니라 DB 최신값으로 — 최종 승인 직후 목록이 갱신되기 전에 PDF 를
  //   받으면 완결된 결재가 '대기'로 찍혔다 (2026-08-20 사장님 제보).
  const { data: freshReq } = await db.from("approval_requests").select("status").eq("id", req.id).maybeSingle();
  const status = (freshReq as { status?: string } | null)?.status || req.status;
  const attachments = (await Promise.all(
    (req.attachments || []).map(async (url) => {
      const name = attachmentFileName(url);
      const signed = await resolveSignedUrl(url, name);
      if (!signed) return null;
      // PDF 뷰어(Edge/Chrome 내장)는 Supabase 의 filename=%EB%84%A4... 를 디코드하지 않고
      // 그대로 저장하므로, 파일명 헤더를 우리가 제어하는 프록시를 거치게 한다 (2026-08-05).
      const proxied = signed.includes('/storage/v1/object/')
        ? `${window.location.origin}/api/files/download/${encodeURIComponent(name.replace(/[/\\]/g, '_'))}?u=${encodeURIComponent(signed)}`
        : signed;
      return { name, url: proxied };
    })
  )).filter((a): a is { name: string; url: string } => !!a);

  const contentText = contentWithoutFieldLines(req.description || "", formFields);
  const blob = await generateApprovalPdf({
    title: req.title,
    requestTypeLabel: REQUEST_TYPE_LABELS[req.request_type as RequestType] || req.request_type,
    statusLabel: STATUS_CONFIG[status]?.label || status,
    requesterName,
    amount: req.amount || 0,
    // 서식 본문(표·이미지·정렬)은 HTML 그대로 넘겨 PDF 에서 재현한다.
    descriptionHtml: contentText && isHtmlDesc(contentText) ? sanitizeDocumentHtml(contentText) : undefined,
    description: contentText && !isHtmlDesc(contentText) ? contentText : undefined,
    formFields: formFields.length > 0 ? formFields : undefined,
    createdAt: formatDate(req.created_at),
    attachments: attachments.length > 0 ? attachments : undefined,
    steps: timeline.map((st) => ({
      stage: st.stage,
      stageName: st.stage_name,
      approverName: st.approver_name || "담당자",
      statusLabel: STATUS_CONFIG[st.status]?.label || koFallback(st.status),
      comment: st.comment || undefined,
      decidedAt: st.decided_at ? formatDateTime(st.decided_at) : null,
    })),
  });
  return await saveBlobToUserChosenPath(blob, `결재문서_${req.title}_${formatDate(req.created_at)}.pdf`);
}

// ── 상세 내용 서식(HTML) 지원 (2026-07-16) — RichEditor 로 작성한 결재 내용(표·서식 포함) ──
const isHtmlDesc = (s?: string | null) => !!s && /^\s*</.test(String(s).trim());

function escapeHtmlText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** 평문(템플릿 등) → RichEditor 초기값 HTML. 이미 HTML 이면 그대로. */
function plainToHtml(text: string): string {
  if (!text) return "";
  if (isHtmlDesc(text)) return text;
  return text.split("\n").map((line) => (line.trim() === "" ? "<p><br/></p>" : `<p>${escapeHtmlText(line)}</p>`)).join("");
}

/** RichEditor 빈 문서(<p></p> 등) 판별 — 텍스트·이미지·표 전부 없으면 빈 것으로 취급 */
function isEmptyHtml(html: string): boolean {
  if (!html) return true;
  if (/<(img|table)/i.test(html)) return false;
  return html.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim() === "";
}

/** 상세 내용 렌더 — HTML(신규 서식)이면 sanitize 후 렌더, 평문(기존)이면 pre-wrap */
function DescriptionContent({ text, className = "" }: { text: string; className?: string }) {
  if (!text) return null;
  if (isHtmlDesc(text)) {
    return <div className={`approval-desc-html ${className}`} dangerouslySetInnerHTML={{ __html: sanitizeDocumentHtml(text) }} />;
  }
  return <div className={`whitespace-pre-wrap ${className}`}>{text}</div>;
}

// 양식 필드 값이 description 앞부분에 중복 병합돼 있으면(기존 저장 방식) 잘라내 중복 표시 방지
function contentWithoutFieldLines(description: string, formFields: { label: string; value: string }[]): string {
  if (formFields.length === 0) return description;
  // 본문 앞에 병합된 "라벨: 값" 줄을 앞에서부터 하나씩 제거한다.
  //   전체 프리픽스 일치를 요구하던 기존 방식은 값이 비었거나 순서·개수가 조금만
  //   어긋나도 통째로 실패해 필드 줄이 본문에 그대로 남았다(표 밖 노출의 원인).
  const startsWithField = (text: string) =>
    formFields.some((f) => text === `${f.label}:` || text.startsWith(`${f.label}:`));

  if (isHtmlDesc(description)) {
    const P_RE = /^\s*<p[^>]*>([\s\S]*?)<\/p>/i;
    let rest = description;
    for (;;) {
      const m = P_RE.exec(rest);
      if (!m) break;
      const text = m[1]
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .trim();
      if (!startsWithField(text)) break;
      rest = rest.slice(m[0].length);
    }
    return rest;
  }

  // 휴가 신청 (2026-08-12 사장님: 승인자 화면에 평문이 아니라 필드폼처럼) — 구조화 행으로
  //   옮겨진 자동 생성 줄들("[휴가 신청서]"·"- 라벨: 값")을 본문에서 걷어내고 사유만 남긴다.
  //   잔여 연차처럼 행에 없는 정보 줄은 그대로 둔다. 레거시(구조화 데이터 없는 옛 요청)는
  //   leave 행이 없으므로 이 분기를 타지 않는다.
  if (formFields.some((f) => f.label === "휴가 종류")) {
    const STRIP = ["신청자", "휴가 유형", "휴가 종류", "휴가 단위", "휴가 기간", "휴가 일자", "시간"];
    const kept = description.split("\n").filter((line) => {
      const t = line.trim();
      if (t === "[휴가 신청서]") return false;
      const m = /^-\s*([^:]+):/.exec(t);
      return !(m && STRIP.includes(m[1].trim()));
    });
    return kept.join("\n").replace(/^\n+/, "").replace(/\n{3,}/g, "\n\n");
  }

  const lines = description.split("\n");
  let i = 0;
  while (i < lines.length && startsWithField(lines[i].trim())) i++;
  return lines.slice(i).join("\n").replace(/^\n+/, "");
}

// ── 목록 탭 공용 검색조건 (2026-08-18 사장님) ──
//   "전체 유형·경비 청구·결제 요청 … 버튼이 너무 많다 — 유형은 검색조건에서 고르고, 기본은 전체를 한 번에."
//   내 결재함·내 요청·참조·전체 현황이 같은 패널을 쓴다: 유형(다중) · 요청일 · 요청자(다중, 있을 때만) · 금액 · 줄 수.
type LCond = { types: string[]; statuses: string[]; from: string; to: string; requester: string[]; min: string; max: string; rows: number };
const LEMPTY: LCond = { types: [], statuses: [], from: "", to: "", requester: [], min: "", max: "", rows: 50 };
const lCount = (c: LCond) => c.types.length + c.statuses.length + ((c.from || c.to) ? 1 : 0) + c.requester.length + ((c.min || c.max) ? 1 : 0);
const typeLabelOf = (t: string) => REQUEST_TYPE_LABELS[t as RequestType] || t || "";
const L_STATUSES: { value: string; label: string }[] = [
  { value: "pending", label: "대기" }, { value: "approved", label: "승인" }, { value: "rejected", label: "반려" }, { value: "cancelled", label: "취소" },
];
const statusLabelOf = (v: string) => (STATUS_CONFIG[v] || STATUS_CONFIG.pending).label;
//   상태 정렬 순서 — 대기 → 승인 → 반려 → 취소 (처리할 것이 위로)
const statusRank = (v: string) => { const i = ["pending", "first_approved", "approved", "rejected", "cancelled"].indexOf(v); return i < 0 ? 9 : i; };
type LRow = { type: string; title: string; requester?: string; amount: number; created: string; status?: string };
function useListFilter(opts: { types: string[]; requesters?: string[]; withStatus?: boolean }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<LCond>(LEMPTY);
  const [live, setLive] = useState<LCond>(LEMPTY);
  const typeOpts = [...new Set(opts.types.filter(Boolean))].map((t) => ({ value: t, label: typeLabelOf(t) }));
  const reqOpts = [...new Set((opts.requesters || []).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko")).map((v) => ({ value: v, label: v }));
  const hit = (r: LRow) => {
    if (live.types.length && !live.types.includes(r.type)) return false;
    if (live.statuses.length && !live.statuses.includes(r.status || "")) return false;
    if (live.from && String(r.created || "").slice(0, 10) < live.from) return false;
    if (live.to && String(r.created || "").slice(0, 10) > live.to) return false;
    if (live.requester.length && !live.requester.includes(r.requester || "")) return false;
    if (!amountHit(Number(r.amount || 0), live.min, live.max)) return false;
    return quickSearchHit(q, [r.title, r.requester, typeLabelOf(r.type)]);
  };
  const drop = (patch: Partial<LCond>) => { const c = { ...live, ...patch }; setLive(c); setDraft(c); };
  const chips: AppliedChip[] = [
    ...(q ? [{ group: "빠른검색", label: q, onRemove: () => setQ("") }] : []),
    ...live.types.map((t) => ({ group: "유형", label: typeLabelOf(t), onRemove: () => drop({ types: live.types.filter((x) => x !== t) }) })),
    ...live.statuses.map((v) => ({ group: "상태", label: statusLabelOf(v), onRemove: () => drop({ statuses: live.statuses.filter((x) => x !== v) }) })),
    ...((live.from || live.to) ? [{ group: "요청일", label: `${live.from || "…"} ~ ${live.to || "…"}`, onRemove: () => drop({ from: "", to: "" }) }] : []),
    ...live.requester.map((v) => ({ group: "요청자", label: v, onRemove: () => drop({ requester: live.requester.filter((x) => x !== v) }) })),
    ...((live.min || live.max) ? [{ group: "금액", label: `${Number(live.min || 0).toLocaleString("ko")} ~ ${live.max ? Number(live.max).toLocaleString("ko") : "제한없음"}`, onRemove: () => drop({ min: "", max: "" }) }] : []),
  ];
  const clearAll = () => { setQ(""); setLive({ ...LEMPTY, rows: live.rows }); setDraft({ ...LEMPTY, rows: live.rows }); };
  const panel = (
    <ConditionPanel open={open} onOpenChange={(v) => { if (v) setDraft(live); setOpen(v); }} activeCount={lCount(live)}
      foot={<>
        <button type="button" className="btn-secondary btn-sm" disabled={lCount(draft) === 0} onClick={() => setDraft({ ...LEMPTY, rows: draft.rows })}>조건 지우기</button>
        <span className="ml-auto" />
        <RowsPerPage value={draft.rows} onChange={(n) => setDraft((c) => ({ ...c, rows: n }))} />
        <button type="button" className="btn-primary btn-sm" onClick={() => { setLive(draft); setOpen(false); }}>조회</button>
      </>}>
      <ConditionRow label="유형" hint="여러 개 · 아무것도 안 고르면 전체">
        <span className="qk-quicks">
          {typeOpts.map((o) => (
            <button key={o.value} type="button"
              onClick={() => setDraft((c) => ({ ...c, types: c.types.includes(o.value) ? c.types.filter((x) => x !== o.value) : [...c.types, o.value] }))}
              className={draft.types.includes(o.value) ? "qk-quick qk-quick-on" : "qk-quick"}>{o.label}</button>
          ))}
          {typeOpts.length === 0 && <span className="text-[11px] text-[var(--text-dim)]">목록에 아직 유형이 없습니다</span>}
        </span>
      </ConditionRow>
      {opts.withStatus && (
        <ConditionRow label="상태" hint="여러 개 · 아무것도 안 고르면 전체">
          <span className="qk-quicks">
            {L_STATUSES.map((o) => (
              <button key={o.value} type="button"
                onClick={() => setDraft((c) => ({ ...c, statuses: c.statuses.includes(o.value) ? c.statuses.filter((x) => x !== o.value) : [...c.statuses, o.value] }))}
                className={draft.statuses.includes(o.value) ? "qk-quick qk-quick-on" : "qk-quick"}>{o.label}</button>
            ))}
          </span>
        </ConditionRow>
      )}
      <ConditionRow label="요청일" hint="비우면 전체 기간">
        <DateRangeField label={null} from={draft.from} to={draft.to} onChange={(f, t) => setDraft((c) => ({ ...c, from: f, to: t }))} onClear={() => setDraft((c) => ({ ...c, from: "", to: "" }))} />
      </ConditionRow>
      {opts.requesters && (
        <ConditionRow label="요청자" hint="여러 명">
          <TokenField items={reqOpts} value={draft.requester} onChange={(v) => setDraft((c) => ({ ...c, requester: v }))} placeholder="이름 일부" />
        </ConditionRow>
      )}
      <ConditionRow label="금액" hint="한쪽만 적어도 됩니다">
        <AmountRange min={draft.min} max={draft.max} onMin={(v) => setDraft((c) => ({ ...c, min: v }))} onMax={(v) => setDraft((c) => ({ ...c, max: v }))} />
      </ConditionRow>
    </ConditionPanel>
  );
  const quick = <QuickSearch value={q} onApply={setQ} placeholder={opts.requesters ? "제목 · 요청자 · 유형 — 쉼표로 여러 개, Enter" : "제목 · 유형 — 쉼표로 여러 개, Enter"} />;
  const applied = <AppliedChips chips={chips} onClearAll={clearAll} />;
  const key = `${q}|${JSON.stringify(live)}`;
  //   바깥(요약 줄의 상태 버튼 등)에서 상태 조건을 걸 때
  const applyStatuses = (arr: string[]) => { const c = { ...live, statuses: arr }; setLive(c); setDraft(c); };
  return { q, live, hit, panel, quick, applied, key, rows: live.rows, applyStatuses };
}

type PickOpt = { value: string; label: string; sub?: string; icon: React.ReactNode };
// 요청 유형 피커 — 즐겨찾기(★)·검색 (2026-09-02 사장님 "요청건들이 많으면 즐겨찾기").
//   favorites 를 주면 목록 위에 '즐겨찾기' 묶음이 먼저 오고 각 줄 오른쪽 ★ 로 넣고 뺀다.
//   항목이 SEARCH_FROM 개 이상이면 목록 맨 위에 검색칸이 열린다(이름·부제로 거른다).
const PICK_SEARCH_FROM = 8;
function TypePicker({ value, options, placeholder, onChange, emptyText, favorites, onToggleFavorite }: {
  value: string; options: PickOpt[]; placeholder: string; onChange: (v: string) => void; emptyText?: string;
  favorites?: string[]; onToggleFavorite?: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) { setQ(""); return; }
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away); document.addEventListener("keydown", esc);
    setTimeout(() => searchRef.current?.focus(), 0);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  const cur = options.find((o) => o.value === value);
  const favSet = new Set(favorites || []);
  const canFav = !!onToggleFavorite;
  const searchable = options.length >= PICK_SEARCH_FROM;
  const nq = q.trim().toLowerCase();
  const hit = (o: PickOpt) => !nq || o.label.toLowerCase().includes(nq) || (o.sub || "").toLowerCase().includes(nq);
  const favItems = canFav && !nq ? options.filter((o) => favSet.has(o.value)) : [];
  const rest = options.filter(hit);
  const row = (o: PickOpt, keyPrefix = "") => (
    <div key={keyPrefix + o.value} className="ap-pick-line">
      <button type="button" role="option" aria-selected={o.value === value}
        className={o.value === value ? "ap-pick-item ap-pick-item-on" : "ap-pick-item"}
        onClick={() => { onChange(o.value); setOpen(false); }}>
        {o.icon}<span className="ap-pick-label">{o.label}</span>{o.sub && <span className="ap-pick-sub">{o.sub}</span>}
      </button>
      {canFav && (
        <button type="button" className={favSet.has(o.value) ? "ap-pick-star ap-pick-star-on" : "ap-pick-star"}
          title={favSet.has(o.value) ? "즐겨찾기에서 빼기" : "즐겨찾기에 넣기"} aria-label={favSet.has(o.value) ? "즐겨찾기에서 빼기" : "즐겨찾기에 넣기"} aria-pressed={favSet.has(o.value)}
          onClick={(e) => { e.stopPropagation(); onToggleFavorite?.(o.value); }}>
          {favSet.has(o.value) ? "★" : "☆"}
        </button>
      )}
    </div>
  );
  return (
    <div className="ap-pick" ref={box}>
      <button type="button" className={cur ? "ap-pick-btn ap-pick-btn-on" : "ap-pick-btn"} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {cur ? (<>{cur.icon}<span className="ap-pick-label">{cur.label}</span>{cur.sub && <span className="ap-pick-sub">{cur.sub}</span>}</>) : <span className="ap-pick-ph">{placeholder}</span>}
        <span className="qk-caret ml-auto">▾</span>
      </button>
      {open && (
        <div className="ap-pick-menu" role="listbox">
          {searchable && (
            <input ref={searchRef} type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="유형 이름으로 찾기"
              className="ap-pick-search" aria-label="요청 유형 검색"
              onKeyDown={(e) => { if (e.key === "Enter" && rest.length === 1) { onChange(rest[0].value); setOpen(false); } }} />
          )}
          {options.length === 0 && <div className="ap-pick-empty">{emptyText || "고를 것이 없습니다"}</div>}
          {favItems.length > 0 && (
            <>
              <div className="ap-pick-group">즐겨찾기</div>
              {favItems.map((o) => row(o, "fav:"))}
              <div className="ap-pick-group">전체</div>
            </>
          )}
          {canFav && favItems.length === 0 && !nq && options.length >= PICK_SEARCH_FROM && (
            <div className="ap-pick-hint">자주 쓰는 유형은 오른쪽 ☆ 를 눌러 맨 위에 두세요</div>
          )}
          {rest.length === 0 && options.length > 0 && <div className="ap-pick-empty">"{q.trim()}" 에 맞는 유형이 없습니다</div>}
          {rest.map((o) => row(o))}
        </div>
      )}
    </div>
  );
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return "-";
  return kstDateStr(new Date(dateStr)); // 앱 표준 YYYY-MM-DD (점표기 혼용 정리)
}

// PDF 등 다운로드 시 저장 경로를 사용자가 직접 고를 수 있게 — 지원 브라우저(Chrome/Edge)는
// File System Access API 로 "다른 이름으로 저장" 다이얼로그 사용, 미지원 브라우저는 기존
// <a download> 방식(브라우저 기본 다운로드 폴더)으로 자동 폴백.
async function saveBlobToUserChosenPath(blob: Blob, suggestedName: string): Promise<boolean> {
  const w = window as any;
  if (typeof w.showSaveFilePicker === "function") {
    try {
      const handle = await w.showSaveFilePicker({
        suggestedName,
        types: [{ description: "PDF 문서", accept: { "application/pdf": [".pdf"] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return true;
    } catch (err: any) {
      if (err?.name === "AbortError") return false; // 사용자가 저장 취소
      // 그 외 실패 시 기존 방식으로 폴백
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = suggestedName;
  a.click();
  URL.revokeObjectURL(url);
  return true;
}

function formatDateTime(dateStr: string | null) {
  if (!dateStr) return "-";
  return kstDateTime(dateStr) || "-";
}

// ══════════════════════════════════════════════
// Main Page
// ══════════════════════════════════════════════

export default function ApprovalsPage() {
  const sp = useSearchParams();
  const newType = sp?.get('new'); // expense / payment / general — 대시보드 quick action 에서 전달
  // 알림에서 ?tab=... 로 진입 (notification-routes.ts) — 참조 통보는 references(→ 2026-08-18 부터 내 결재함의 '나를 참조한 건' 보기),
  //   결재 승인·반려 결과는 my-requests + ?request=<id> (해당 건 상세 자동 열림)
  const tabParam = sp?.get('tab');
  const deepLinkTab = tabParam === "references" ? "my-approvals" : tabParam && TAB_KEYS.includes(tabParam as Tab) ? (tabParam as Tab) : null;
  const initialInboxView = tabParam === "references" ? "referenced" : undefined;
  const focusRequestId = sp?.get('request') || null;
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(newType ? "new-request" : deepLinkTab ?? "my-approvals");
  const [presetType, setPresetType] = useState<string | null>(newType);
  const [allTabStatusFilter, setAllTabStatusFilter] = useState<string>("");
  const queryClient = useQueryClient();

  // KPI 카드 클릭 → "전체 현황" 탭으로 이동 + 해당 상태 필터 적용
  const goToAllWithStatus = (status: string) => {
    setAllTabStatusFilter(status);
    setTab("all");
  };

  // URL ?new=... 가 바뀌면 탭 + 타입 동기화 (대시보드 → approvals 이동 시)
  useEffect(() => {
    if (newType) {
      setTab("new-request");
      setPresetType(newType);
    }
  }, [newType]);

  // URL ?tab=... (알림 클릭) → 해당 탭 동기화. 이미 /approvals 에 머문 상태에서 알림을 눌러도 이동한다.
  useEffect(() => {
    if (!newType && deepLinkTab) setTab(deepLinkTab);
  }, [deepLinkTab, newType]);

  useEffect(() => {
    getCurrentUser().then((u) => {
      if (u) {
        setCompanyId(u.company_id);
        setUserId(u.id);
        setUserRole(u.role);
        // 직원 계정은 결재 권한이 거의 없어 '내 결재함'이 비어있음 → 기본 탭을 '새 요청'으로.
        //   단, 알림에서 ?tab=... 로 명시 진입한 경우는 그 탭을 유지.
        // (P3) 구 직원 기본탭 분기 제거 — 미허용 탭 자동 이동 effect 가 첫 허용 탭으로 보정
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
    //   2026-08-31: 결재 처리 후 대시보드·마이페이지·프로젝트의 결재 캐시가 최대 1분 낡아
    //   "이미 처리한 결재가 계속 떠 있다"가 됐다 — 같은 테이블을 읽는 키 전부 + 사이드바 배지.
    ["my-pending-approvals", "my-processed-approvals", "my-requests", "my-requests-pending", "referenced-requests",
     "all-requests", "approval-stats", "approval-policies", "approval-timeline",
     "approvals-pending-dashboard", "dash-approvals-pending", "ceo-pending-actions", "ceo-approval-summary", "ceo-queue-count",
     "projecthub-approvals", "deal-approvals"].forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }));
    window.dispatchEvent(new Event("sidebar-refresh-badges"));
  };

  // Stats — 2026-07-21 QA: 전체 현황·양식/정책(관리 탭)에서만 회사 전체 집계,
  //   개인 탭(내 결재함·내 요청·새 요청)에서는 내가 올린 요청만 집계 (남의 결재 건수가 섞여 보이던 혼란 제거)
  const statsCompanyScope = tab === "all" || tab === "forms" || tab === "policies";
  const { data: stats } = useQuery({
    queryKey: ["approval-stats", companyId, statsCompanyScope ? "company" : userId],
    queryFn: () => getApprovalStats(companyId!, statsCompanyScope ? undefined : userId!),
    enabled: !!companyId && (statsCompanyScope || !!userId),
  });

  // ⚠️ 마이페이지와 **같은 캐시**를 쓴다 — 종전엔 같은 키(my-pending-count)에 이 화면은 숫자를,
  //   마이페이지는 배열을 넣어, 결재허브를 먼저 본 뒤 마이페이지로 가면 캐시에 담긴 숫자에
  //   .slice() 를 호출해 화면이 통째로 깨졌다 (2026-08-20 정다정님 3회 발생).
  //   이제 배열 하나만 캐싱하고 개수는 select 로 파생시킨다.
  const { data: myPendingCount } = useQuery({
    queryKey: ["my-pending-approvals", userId, companyId],
    queryFn: () => getMyPendingApprovals(userId!, companyId!),
    select: (items: unknown[]) => items.length,
    enabled: !!userId && !!companyId,
  });

  // (2026-07-30 개편 P3) 세부탭 권한 게이트 — 마스터=전체, 멤버=부여받은 탭만.
  //   perm key 는 카탈로그(/approvals:내부탭키)와 1:1. 구 isAdmin 분기 대체.
  const { isMaster, hasPerm } = useMyPermissions();
  const tabAllowed = (k: Tab) => isMaster || hasPerm(`/approvals:${k}`);
  const isAdmin = isMaster || hasPerm("/approvals:all"); // 전체 현황 권한 = 관리 조회 성격 분기 유지용

  // 탭 순서(2026-07-23 재편) — 개인 업무 3종(받고·보내고·올리고) → 회사 전체 → 설정.
  const TABS: { key: Tab; label: string; icon: string; count?: number }[] = ([
    { key: "my-approvals", label: "내 결재함", icon: "inbox", count: myPendingCount },
    { key: "my-requests", label: "내 요청", icon: "send" },
    // 참조 탭은 2026-08-18 사장님 지시로 내 결재함 안 '나를 참조한 건' 보기로 합쳤다 (별도 탭 불필요)
    { key: "new-request", label: "새 요청", icon: "plus" },
    { key: "all", label: "전체 현황", icon: "chart" },
    { key: "forms", label: "양식 관리", icon: "layout" },
    { key: "policies", label: "결재선 관리", icon: "route" },
  ] as { key: Tab; label: string; icon: string; count?: number }[]).filter((t) => tabAllowed(t.key));
  // 현재 탭이 미허용(권한 없음)이면 첫 허용 탭으로 — 딥링크/기본값 가드
  useEffect(() => {
    if (TABS.length > 0 && !TABS.some((t) => t.key === tab)) setTab(TABS[0].key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [TABS.map((t) => t.key).join(","), tab]);
  const tabIcon = (name: string) => {
    const p = { className: "w-3.5 h-3.5", fill: "none", stroke: "currentColor", strokeWidth: 2, viewBox: "0 0 24 24", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
    switch (name) {
      case "inbox": return <svg {...p}><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/></svg>;
      case "send": return <svg {...p}><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>;
      case "chart": return <svg {...p}><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg>;
      case "plus": return <svg {...p}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>;
      case "layout": return <svg {...p}><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>;
      case "eye": return <svg {...p}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>;
      case "clock": return <svg {...p}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>;
      default: return <svg {...p}><circle cx="6" cy="19" r="3"/><circle cx="18" cy="5" r="3"/><path d="M12 19h4.5a3.5 3.5 0 000-7h-9a3.5 3.5 0 010-7H12"/></svg>;
    }
  };

  return (
    <div className="qk-shell">
      {/* ── 조회 화면 표준 뼈대 (2026-08-18 Wave 3) — 갈래 탭은 상자 안 맨 위 파란 밑줄, 본문은 상자 안에서 스크롤 ── */}
      <QueryScreen>
        <QueryHead>
          <div className="collect-tabs no-print">
            {TABS.map((t) => (
              <button key={t.key} type="button" onClick={() => setTab(t.key)}
                className={tab === t.key ? "collect-tab collect-tab-on" : "collect-tab"}>
                <span className="inline-flex items-center gap-1.5">{tabIcon(t.icon)}{t.label}</span>
                {t.count !== undefined && t.count > 0 && <span className="collect-tab-cnt ap-tab-alert">{t.count}</span>}
              </button>
            ))}
          </div>
          {/* 요청 현황 요약 — '요청 현황' 지표라 요청 탭(내 요청·전체 현황)에만. 누르면 그 상태로 좁혀 본다 */}
          {(tab === "my-requests" || tab === "all") && (
            <ResultStrip>
              {([
                ["대기 중", stats?.pending ?? 0, "pending", "minus"],
                ["승인 완료", stats?.approved ?? 0, "approved", "plus"],
                ["반려", stats?.rejected ?? 0, "rejected", undefined],
                [statsCompanyScope ? "전체 요청" : "내 요청 전체", stats?.total ?? 0, "", undefined],
              ] as const).map(([label, value, status, tone]) => (
                <button key={label} type="button" className="ap-stat-btn"
                  onClick={() => { if (statsCompanyScope) goToAllWithStatus(status); else setTab("my-requests"); }}>
                  <Stat label={label} value={`${value}건`} tone={tone as "plus" | "minus" | undefined} />
                </button>
              ))}
            </ResultStrip>
          )}
        </QueryHead>
        <QueryBody>
         <div className="ap-scroll">
      {/* Tab content */}
      {tab === "my-approvals" && companyId && userId && (
        <MyApprovalsTab companyId={companyId} userId={userId} invalidate={invalidate} onGoToMyRequests={() => setTab("my-requests")} initialView={initialInboxView} />
      )}
      {tab === "my-requests" && companyId && userId && (
        <MyRequestsTab companyId={companyId} userId={userId} invalidate={invalidate} focusRequestId={focusRequestId} />
      )}
      {tab === "all" && companyId && (
        <AllRequestsTab companyId={companyId} initialStatusFilter={allTabStatusFilter} userId={userId} userRole={userRole} invalidate={invalidate} />
      )}
      {tab === "new-request" && companyId && userId && (
        <div className="ap-pad"><NewRequestTab companyId={companyId} userId={userId} invalidate={invalidate} onComplete={() => setTab("my-requests")} presetType={presetType} /></div>
      )}
      {tab === "forms" && companyId && (
        <ApprovalFormsManager companyId={companyId} />
      )}
      {tab === "policies" && companyId && (
        <PoliciesTab companyId={companyId} invalidate={invalidate} />
      )}
         </div>
        </QueryBody>
      </QueryScreen>
    </div>
  );
}

// ══════════════════════════════════════════════
// Tab 1: 내 결재함
// ══════════════════════════════════════════════

function MyApprovalsTab({ companyId, userId, invalidate, onGoToMyRequests, initialView }: {
  initialView?: "pending" | "processed" | "referenced";
  companyId: string; userId: string; invalidate: () => void; onGoToMyRequests?: () => void;
}) {
  const { toast } = useToast();
  const [comment, setComment] = useState("");
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  //   일괄 승인·반려 — 줄을 골라 바닥 선택 바에서 (2026-08-19 조회 표준: 확정 버튼은 SelectionBar 하나)
  const [pickedSteps, setPickedSteps] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchRejectOpen, setBatchRejectOpen] = useState(false);
  const [batchReason, setBatchReason] = useState("");

  // 대기중 / 처리완료 전환 — 승인하고 나면 목록에서 사라져 다시 볼 수 없던 문제
  //   (2026-07-27 사장님 제보). 결재선에 올랐던 건은 처리 후에도 확인 가능해야 한다.
  const [view, setView] = useState<"pending" | "processed" | "referenced">(initialView || "pending");

  const { data: pendingApprovals = [], isLoading } = useQuery({
    queryKey: ["my-pending-approvals", userId, companyId],
    queryFn: () => getMyPendingApprovals(userId, companyId),
    enabled: !!userId && !!companyId,
  });

  const { data: processedApprovals = [], isLoading: processedLoading } = useQuery({
    queryKey: ["my-processed-approvals", userId, companyId],
    queryFn: () => getMyProcessedApprovals(userId, companyId),
    enabled: !!userId && !!companyId && view === "processed",
  });
  //   나를 참조한 건 — 예전 '참조' 탭. 결재선에 없는 참조자는 여기서만 내용을 본다 (2026-07-27 → 2026-08-18 내 결재함으로 합침)
  const { data: referencedRequests = [] } = useQuery({
    queryKey: ["referenced-requests", userId, companyId],
    queryFn: () => getReferencedRequests(userId, companyId),
    enabled: !!userId && !!companyId,
  });

  // 커스텀 결재 양식 필드 정의 (label·type) — custom_fields 값과 짝지어 구조화된 항목으로 표시
  //   이미 기안된 문서를 보는 화면이므로 삭제(비활성)된 양식도 포함해야 라벨을 되찾는다.
  const { data: customForms = [] } = useQuery({
    queryKey: ["approval-forms", companyId, "all"],
    queryFn: () => listApprovalForms({ includeInactive: true }),
    enabled: !!companyId,
  });
  // 기본 유형(form_id 없는 휴가·출장·지출결의 등)의 필드 정의는 정책에 있다.
  const { data: fieldPolicies = [] } = useQuery({
    queryKey: ["approval-policies", companyId],
    queryFn: () => getApprovalPolicies(companyId),
    enabled: !!companyId,
  });
  const formsById = useMemo(() => {
    const map = new Map<string, ApprovalForm>();
    (customForms as ApprovalForm[]).forEach((f) => map.set(f.id, f));
    return map;
  }, [customForms]);

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

  const runBatch = async (kind: "approve" | "reject", reason?: string) => {
    const ids = [...pickedSteps].filter((id) => (pendingApprovals as any[]).some((p) => p.stepId === id));
    if (ids.length === 0) return;
    setBatchBusy(true);
    let ok = 0, fail = 0;
    for (const id of ids) {
      try {
        if (kind === "approve") await approveStep(id, userId, undefined);
        else await rejectStep(id, userId, reason || "");
        ok += 1;
      } catch { fail += 1; }
    }
    setBatchBusy(false);
    setPickedSteps(new Set());
    setBatchRejectOpen(false); setBatchReason("");
    invalidate();
    window.dispatchEvent(new Event("sidebar-refresh-badges"));
    toast(`${kind === "approve" ? "승인" : "반려"} ${ok}건 처리${fail ? ` · 실패 ${fail}건` : ""}`, fail ? "error" : "success");
  };

  // 목록이 바뀌면(처리 완료 등으로 사라지면) 열려 있던 상세 팝업 닫기
  useEffect(() => {
    if (selectedStepId && !pendingApprovals.some((p: any) => p.stepId === selectedStepId)) {
      setSelectedStepId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingApprovals]);

  const selected = pendingApprovals.find((p: any) => p.stepId === selectedStepId) || null;

  // 상세 팝업이 열려 있는 동안: ESC=닫기, Enter=승인(의견은 선택 입력).
  //   반려는 사유 필수 확인이 이미 버튼 클릭 시 별도 검증되므로 Enter 단축키는 승인에만 연결.
  useModalKeys(
    !!selected,
    () => { setSelectedStepId(null); setComment(""); },
    selected && !approveMut.isPending
      ? () => approveMut.mutate({ stepId: selected.stepId, comment: comment || undefined })
      : undefined,
  );

  // 검색조건(유형·요청일·기안자·금액) + 빠른검색 — 전체 현황과 같은 패널 (2026-08-18 사장님: 유형 버튼 줄 제거)
  const lf = useListFilter({
    types: [...(pendingApprovals as any[]), ...(processedApprovals as any[])].map((i) => i.requestType).concat((referencedRequests as any[]).map((r) => r.request_type)),
    requesters: [...(pendingApprovals as any[]), ...(processedApprovals as any[])].map((i) => i.requesterName).concat((referencedRequests as any[]).map((r) => r.users?.name || r.users?.email || "")),
    withStatus: true,
  });
  const matchesFilters = (item: any) => lf.hit({ type: item.requestType, title: item.title, requester: item.requesterName, amount: item.amount, created: item.createdAt || item.created_at || item.requestedAt || "" });
  const visiblePending = (pendingApprovals as any[]).filter(matchesFilters);
  const visibleProcessed = (processedApprovals as any[]).filter(matchesFilters);
  const visibleReferenced = (referencedRequests as any[]).filter((r) => lf.hit({ type: r.request_type, title: r.title, requester: r.users?.name || r.users?.email || "", amount: r.amount, created: r.created_at, status: r.status }));

  // 조회 줄 — 전체 현황과 동일 구성 (조회 표준 부품: 검색조건 + 빠른검색 + 보기 칩 + 건수)
  const filterBar = (
    <>
      <QueryBar right={<span className="text-xs font-semibold text-[var(--text-dim)] mono-number">{(view === "pending" ? visiblePending : view === "processed" ? visibleProcessed : visibleReferenced).length}건</span>}>
        {lf.panel}
        {lf.quick}
        <ChipGroup value={view} onChange={setView}
          options={[
            { value: "pending", label: `대기중${pendingApprovals.length > 0 ? ` (${pendingApprovals.length})` : ""}` },
            { value: "processed", label: "내가 결재한 건" },
            { value: "referenced", label: `나를 참조한 건${(referencedRequests as any[]).length > 0 ? ` (${(referencedRequests as any[]).length})` : ""}` },
          ]} />
      </QueryBar>
      {lf.applied}
    </>
  );

  if (view === "referenced") {
    return (
      <div className="ap-list">
        {filterBar}
        <ReferencedRequestsTab companyId={companyId} userId={userId} embedded={{ hit: lf.hit, rows: lf.rows, key: lf.key }} />
      </div>
    );
  }

  if (view === "processed") {
    return (
      <div className="ap-list">
        {filterBar}
        {(processedApprovals as any[]).length > 0 && visibleProcessed.length === 0 ? (
          <div className="ap-empty">
            <div className="text-sm font-bold mb-1">검색 결과가 없습니다</div>
            <div className="text-xs text-[var(--text-muted)]">검색어나 유형 필터를 바꿔보세요</div>
          </div>
        ) : (
          <ProcessedApprovalsList
            items={visibleProcessed}
            isLoading={processedLoading}
            formsById={formsById}
            policies={fieldPolicies as ApprovalPolicy[]}
            onGoToMyRequests={onGoToMyRequests}
          />
        )}
      </div>
    );
  }

  if (isLoading) {
    return <div>{filterBar}<div className="text-center py-12 text-[var(--text-muted)]">로딩 중...</div></div>;
  }

  if (pendingApprovals.length === 0) {
    return (
      <div>
        {filterBar}
        <div className="ap-empty">
          <div className="mx-auto w-16 h-16 mb-4 rounded-2xl bg-[var(--success-dim)] text-[var(--success)] flex items-center justify-center">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          </div>
          <div className="text-base font-bold mb-1.5">모두 처리했습니다</div>
          <div className="text-sm text-[var(--text-muted)]">
            새 결재 요청이 배정되면 이곳에 표시됩니다. 내가 승인·반려한 건은 <b>내가 결재한 건</b>에서 볼 수 있습니다.
          </div>
        </div>
      </div>
    );
  }

  const selectedFormFields = selected
    ? resolveFormFields(selected.formId, selected.customFields, formsById, fieldPolicies as ApprovalPolicy[], selected.requestType)
    : [];
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
    <div className="ap-list">
    {filterBar}

    {/* Table — 전체 현황과 동일 디자인 (2026-08-04 사장님: 내 결재함도 똑같이) */}
    <div className="approval-table-wrap ev-scroll">
      <table className="ev-table ev-lined approval-table">
        <thead>
          <tr>
            <th className="w-10">
              <button type="button" aria-label="이 목록 전체 선택"
                onClick={() => { const all = visiblePending.length > 0 && visiblePending.every((p: any) => pickedSteps.has(p.stepId)); const next = new Set(pickedSteps); if (all) visiblePending.forEach((p: any) => next.delete(p.stepId)); else visiblePending.forEach((p: any) => next.add(p.stepId)); setPickedSteps(next); }}
                className={visiblePending.length > 0 && visiblePending.every((p: any) => pickedSteps.has(p.stepId)) ? "collect-chk collect-chk-on" : "collect-chk"}>
                {visiblePending.length > 0 && visiblePending.every((p: any) => pickedSteps.has(p.stepId)) ? "✓" : ""}
              </button>
            </th>
            <SortableTh label="상태" />
            <SortableTh label="제목" />
            <SortableTh label="요청자" />
            <SortableTh label="금액" />
            <SortableTh label="진행" />
            <SortableTh label="요청일" />
          </tr>
        </thead>
        <tbody>
          {visiblePending.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-4 py-16 text-center">
                <div className="text-sm font-bold mb-1">검색 결과가 없습니다</div>
                <div className="text-xs text-[var(--text-muted)]">검색어나 유형 필터를 바꿔보세요</div>
              </td>
            </tr>
          ) : (
            visiblePending.map((item: any) => {
              const m = typeMeta(item.requestType);
              return (
                <tr
                  key={item.stepId}
                  className={pickedSteps.has(item.stepId) ? "approval-table-row ap-row-open" : "approval-table-row"}
                  onClick={() => { setSelectedStepId(item.stepId); setComment(""); }}
                >
                  <td className="px-4 py-3.5 text-center" onClick={(e) => e.stopPropagation()}>
                    <button type="button" aria-label="선택" onClick={() => setPickedSteps((s) => { const n = new Set(s); if (n.has(item.stepId)) n.delete(item.stepId); else n.add(item.stepId); return n; })}
                      className={pickedSteps.has(item.stepId) ? "collect-chk collect-chk-on" : "collect-chk"}>{pickedSteps.has(item.stepId) ? "✓" : ""}</button>
                  </td>
                  <td className="px-4 py-3.5 text-center">
                    <span className="approval-need-badge"><span className="approval-need-badge-dot" />승인 필요</span>
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${m.bg} ${m.text}`}>
                        <TypeIcon name={m.icon} className="w-4 h-4" />
                      </span>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold truncate max-w-[240px]">{item.title}</div>
                        <div className="text-[10px] text-[var(--text-dim)]">{REQUEST_TYPE_LABELS[item.requestType as RequestType] || item.requestType}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-2">
                      <Avatar name={item.requesterName || "?"} size={24} />
                      <span className="text-xs text-[var(--text-muted)] truncate max-w-[100px]">{item.requesterName || "-"}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3.5 text-sm font-bold mono-number text-right">{formatAmount(item.amount)}</td>
                  <td className="px-4 py-3.5 w-[140px]">
                    <StageProgress current={item.currentStage} total={item.totalStages} status="pending" />
                  </td>
                  <td className="px-4 py-3.5 text-xs text-[var(--text-muted)] whitespace-nowrap">{formatDate(item.createdAt)}</td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>

    {/* 일괄 승인·반려 — 고른 순간에만 뜨는 바닥 바. 파란(확정) 버튼은 여기 하나 */}
    <SelectionBar count={pickedSteps.size} summary="승인 대기 결재" onClear={() => setPickedSteps(new Set())}>
      <button type="button" className="btn-secondary btn-sm text-[var(--danger)]" disabled={batchBusy} onClick={() => setBatchRejectOpen(true)}>선택 반려</button>
      <button type="button" className="btn-primary btn-sm" disabled={batchBusy} onClick={() => runBatch("approve")}>{batchBusy ? "처리 중…" : `선택 승인 (${pickedSteps.size})`}</button>
    </SelectionBar>
    {batchRejectOpen && (
      <div className="approval-detail-modal" onClick={() => !batchBusy && setBatchRejectOpen(false)}>
        <div className="approval-policy-form ap-pol-modal max-w-md" onClick={(e) => e.stopPropagation()}>
          <h3 className="section-title">선택 {pickedSteps.size}건 반려</h3>
          <p className="text-xs text-[var(--text-muted)] mb-2">반려 사유는 요청자에게 그대로 전달됩니다 (모든 건에 같은 사유).</p>
          <textarea value={batchReason} onChange={(e) => setBatchReason(e.target.value)} rows={3} placeholder="반려 사유 (필수)" className="field-input w-full" />
          <div className="flex gap-2 mt-3">
            <button type="button" className="btn-primary btn-sm" disabled={batchBusy || batchReason.trim().length < 2} onClick={() => runBatch("reject", batchReason.trim())}>{batchBusy ? "처리 중…" : "반려"}</button>
            <button type="button" className="btn-secondary btn-sm" onClick={() => setBatchRejectOpen(false)}>취소</button>
          </div>
        </div>
      </div>
    )}

    {/* 결재 상세 팝업 — 전체 현황 상세와 동일 구성 + 승인/반려 처리 */}
    {selected && (() => {
      const m = typeMeta(selected.requestType);
      return (
        <div className="approval-detail-modal fixed inset-0" onClick={() => setSelectedStepId(null)}>
          <div className="glass-card p-6 w-full max-w-lg shadow-xl animate-count-up max-h-[88vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 mb-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${m.bg} ${m.text}`}>
                  <TypeIcon name={m.icon} className="w-4 h-4" />
                </span>
                <span className="approval-need-badge"><span className="approval-need-badge-dot" />승인 필요</span>
              </div>
              <button onClick={() => setSelectedStepId(null)} className="text-[var(--text-dim)] hover:text-[var(--text)] transition text-xl leading-none px-1">✕</button>
            </div>
            <h3 className="text-[20px] font-extrabold leading-tight mt-2 mb-1.5">{selected.title}</h3>
            <div className="text-xs text-[var(--text-dim)] mb-1.5">
              {REQUEST_TYPE_LABELS[selected.requestType as RequestType] || selected.requestType} · {selected.requesterName || "알 수 없음"} · {formatDate(selected.createdAt)}
            </div>
            <div className="approval-reference-line text-[11px] text-[var(--text-dim)] mb-5">
              {Array.isArray(selected.referenceUsers) && selected.referenceUsers.length > 0
                ? `참조: ${selected.referenceUsers.map((u: { id: string; name: string }) => u.name).join(", ")}`
                : null}
            </div>

            {selected.amount > 0 && (
              <div className="text-xl font-extrabold mono-number mb-4">{formatAmount(selected.amount)}</div>
            )}

            {selectedFormFields.length > 0 && (
              <div className="mb-4 pb-4 border-b border-[var(--border)]/60">
                <FormFieldRows fields={selectedFormFields} />
              </div>
            )}
            {selectedContent && (
              <DescriptionContent text={selectedContent} className="mb-2 text-sm text-[var(--text)] leading-8" />
            )}
            <AttachmentList attachments={selected.attachments} />

            {/* 결재 의견 + 승인/반려 */}
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
              <ApprovalTimelineView
                requestId={selected.requestId}
                currentStage={selected.currentStage}
                totalStages={selected.totalStages}
                requestStatus="pending"
                currentUserId={userId}
              />
            </div>
            {/* 댓글 스레드 — 기존 내 결재함(활동 타임라인)에 있던 대화 기능 유지 */}
            <div className="mt-6 pt-5 border-t border-[var(--border)]">
              <ApprovalCommentThread requestId={selected.requestId} />
            </div>
          </div>
        </div>
      );
    })()}
    </div>
  );
}

/**
 * 내가 이미 처리(승인·반려)한 결재 목록 — 읽기 전용.
 *   내 결정(승인/반려)·처리일시·의견과, 문서의 최종 상태를 함께 보여준다.
 *   내가 승인했어도 다음 단계에서 반려될 수 있어 둘을 구분해 표시한다.
 */
function ProcessedApprovalsList({ items, isLoading, formsById, policies, onGoToMyRequests }: {
  items: any[];
  isLoading: boolean;
  formsById: Map<string, ApprovalForm>;
  policies: ApprovalPolicy[];
  onGoToMyRequests?: () => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const { toast } = useToast();
  const [pdfLoadingId, setPdfLoadingId] = useState<string | null>(null);

  // 내가 결재한 건도 문서로 보관할 수 있어야 한다(2026-07-27 사장님 요청).
  //   목록 항목은 step 기준이라 PDF 생성이 기대하는 request 모양으로 맞춰 넘긴다.
  const handlePdf = async (item: any) => {
    setPdfLoadingId(item.stepId);
    try {
      const fields = resolveFormFields(item.formId, item.customFields, formsById, policies, item.requestType);
      const saved = await buildAndSaveApprovalPdf({
        req: {
          id: item.requestId,
          title: item.title,
          request_type: item.requestType,
          status: item.requestStatus,
          amount: item.amount,
          description: item.description,
          created_at: item.createdAt,
          attachments: item.attachments,
          form_id: item.formId,
          custom_fields: item.customFields,
        },
        requesterName: item.requesterName || "-",
        formFields: fields,
      });
      if (saved) toast("PDF 다운로드 완료", "success");
    } catch (err: any) {
      toast(`PDF 생성 실패: ${friendlyError(err, "알 수 없는 오류")}`, "error");
    }
    setPdfLoadingId(null);
  };

  // 이 화면은 "내가 결재자로서 승인·반려한 건"이다. 내가 올린 결재와 헷갈리기 쉬워
  //   (2026-07-27 사장님 제보: 올린 8건이 안 보인다 → 실제로는 '내 요청' 탭에 있었음)
  //   어디로 가야 하는지 항상 안내한다.
  const hint = (
    <div className="text-xs text-[var(--text-muted)] mb-3">
      내가 <b>결재자로서</b> 승인·반려한 건입니다. 내가 올린 결재는{" "}
      {onGoToMyRequests ? (
        <button onClick={onGoToMyRequests} className="text-[var(--primary)] font-semibold underline underline-offset-2">
          내 요청
        </button>
      ) : (
        <b>내 요청</b>
      )}{" "}
      탭에서 볼 수 있습니다.
    </div>
  );

  // 상세 팝업 — ESC로 닫기 (전체 현황 상세와 동일한 조작감)
  const selected = items.find((i) => i.stepId === openId) || null;
  useModalKeys(!!selected, () => setOpenId(null));

  if (isLoading) {
    return <div className="text-center py-12 text-[var(--text-muted)]">로딩 중...</div>;
  }
  if (items.length === 0) {
    return (
      <div>
        {hint}
        <div className="ap-empty">
          <div className="text-base font-bold mb-1.5">아직 결재한 건이 없습니다</div>
          <div className="text-sm text-[var(--text-muted)]">
            내가 승인하거나 반려한 결재가 여기에 쌓입니다
          </div>
        </div>
      </div>
    );
  }

  // 내가 이 단계에서 내린 결정 pill (문서 최종 상태와 다를 수 있음)
  const myDecisionPill = (item: any) => (
    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold whitespace-nowrap ${
      item.myDecision === "approved"
        ? "bg-[var(--success-dim)] text-[var(--success)]"
        : "bg-[var(--danger)]/10 text-[var(--danger)]"
    }`}>
      {item.myDecision === "approved" ? "승인" : "반려"}
    </span>
  );

  return (
    <div className="ap-list">
    {hint}

    {/* Table — 전체 현황과 동일 디자인 (2026-08-04 사장님: 내가 결재한 건도 똑같이) */}
    <div className="approval-table-wrap ev-scroll">
      <table className="ev-table ev-lined approval-table">
        <thead>
          <tr>
            <SortableTh label="상태" />
            <SortableTh label="내 결재" />
            <SortableTh label="제목" />
            <SortableTh label="요청자" />
            <SortableTh label="금액" />
            <SortableTh label="진행" />
            <SortableTh label="요청일" />
            <SortableTh label="내 처리일" />
            <SortableTh label="문서" />
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const m = typeMeta(item.requestType);
            return (
              <tr
                key={item.stepId}
                className="approval-table-row"
                onClick={() => setOpenId(item.stepId)}
              >
                <td className="px-4 py-3.5"><StatusBadge status={item.requestStatus} /></td>
                <td className="px-4 py-3.5">{myDecisionPill(item)}</td>
                <td className="px-4 py-3.5">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${m.bg} ${m.text}`}>
                      <TypeIcon name={m.icon} className="w-4 h-4" />
                    </span>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold truncate max-w-[240px]">{item.title}</div>
                      <div className="text-[10px] text-[var(--text-dim)]">{REQUEST_TYPE_LABELS[item.requestType as RequestType] || item.requestType}</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3.5">
                  <div className="flex items-center gap-2">
                    <Avatar name={item.requesterName || "?"} size={24} />
                    <span className="text-xs text-[var(--text-muted)] truncate max-w-[100px]">{item.requesterName || "-"}</span>
                  </div>
                </td>
                <td className="px-4 py-3.5 text-sm font-bold mono-number text-right">{formatAmount(item.amount)}</td>
                <td className="px-4 py-3.5 w-[140px]">
                  <StageProgress current={item.currentStage} total={item.totalStages} status={item.requestStatus} />
                </td>
                <td className="px-4 py-3.5 text-xs text-[var(--text-muted)] whitespace-nowrap">{formatDate(item.createdAt)}</td>
                <td className="px-4 py-3.5 text-xs text-[var(--text-muted)] whitespace-nowrap">{item.decidedAt ? formatDate(item.decidedAt) : "-"}</td>
                <td className="px-4 py-3.5">
                  <button
                    onClick={(e) => { e.stopPropagation(); handlePdf(item); }}
                    disabled={pdfLoadingId === item.stepId}
                    title="결재 문서 PDF 다운로드"
                    className="approval-modal-pdf-btn"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
                    </svg>
                    {pdfLoadingId === item.stepId ? "생성 중..." : "PDF"}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>

    {/* 상세 팝업 — 전체 현황 상세와 동일 구성 + 내 처리 정보 */}
    {selected && (() => {
      const m = typeMeta(selected.requestType);
      const fields = resolveFormFields(selected.formId, selected.customFields, formsById, policies, selected.requestType);
      const content = contentWithoutFieldLines(selected.description || "", fields);
      return (
        <div className="approval-detail-modal fixed inset-0" onClick={() => setOpenId(null)}>
          <div className="glass-card p-6 w-full max-w-lg shadow-xl animate-count-up max-h-[88vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 mb-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${m.bg} ${m.text}`}>
                  <TypeIcon name={m.icon} className="w-4 h-4" />
                </span>
                <StatusBadge status={selected.requestStatus} />
                {myDecisionPill(selected)}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handlePdf(selected)}
                  disabled={pdfLoadingId === selected.stepId}
                  title="결재 문서 PDF 저장"
                  className="approval-modal-pdf-btn"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
                  </svg>
                  {pdfLoadingId === selected.stepId ? "생성 중..." : "PDF 저장"}
                </button>
                <button onClick={() => setOpenId(null)} className="text-[var(--text-dim)] hover:text-[var(--text)] transition text-xl leading-none px-1">✕</button>
              </div>
            </div>
            <h3 className="text-[20px] font-extrabold leading-tight mt-2 mb-1.5">{selected.title}</h3>
            <div className="text-xs text-[var(--text-dim)] mb-1.5">
              {REQUEST_TYPE_LABELS[selected.requestType as RequestType] || selected.requestType} · 기안 {selected.requesterName || "알 수 없음"} · {formatDate(selected.createdAt)}
            </div>
            <div className="text-[11px] text-[var(--text-dim)] mb-5">
              {selected.decidedAt ? `내 처리 ${formatDateTime(selected.decidedAt)} · ` : ""}{selected.stage}단계 {selected.stageName || ""}
              {selected.myComment ? ` · 내 의견: ${selected.myComment}` : ""}
            </div>

            {selected.amount > 0 && (
              <div className="text-xl font-extrabold mono-number mb-4">{formatAmount(selected.amount)}</div>
            )}

            {fields.length > 0 && (
              <div className="mb-4 pb-4 border-b border-[var(--border)]/60">
                <FormFieldRows fields={fields} />
              </div>
            )}
            {!isEmptyHtml(content) && (
              <DescriptionContent text={content} className="mb-2 text-sm text-[var(--text)] leading-8" />
            )}
            <AttachmentList attachments={selected.attachments} />

            <div className="mt-6 pt-5 border-t border-[var(--border)]">
              <ApprovalTimelineView
                requestId={selected.requestId}
                currentStage={selected.currentStage}
                totalStages={selected.totalStages}
                requestStatus={selected.requestStatus}
              />
            </div>
          </div>
        </div>
      );
    })()}
    </div>
  );
}

// ══════════════════════════════════════════════
// Tab 2: 내 요청
// ══════════════════════════════════════════════

function MyRequestsTab({ companyId, userId, invalidate, focusRequestId }: {
  companyId: string; userId: string; invalidate: () => void; focusRequestId?: string | null;
}) {
  const { toast } = useToast();
  const { confirm, confirmElement } = useConfirm();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ["my-requests", userId, companyId],
    queryFn: () => getMyRequests(userId, companyId),
    enabled: !!userId && !!companyId,
  });

  // 승인·반려 알림에서 ?request=<id> 로 진입 → 그 건의 상세(결재선·결과)를 바로 연다.
  //   목록 로딩 후 1회만 열고, 사용자가 닫으면 다시 열지 않는다.
  const focusedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!focusRequestId || focusedRef.current === focusRequestId) return;
    if ((requests as any[]).some((r) => r.id === focusRequestId)) {
      focusedRef.current = focusRequestId;
      setExpandedId(focusRequestId);
    }
  }, [focusRequestId, requests]);

  // 2026-07-16 QA: 참조자(reference_user_ids)가 "내 요청" 화면엔 전혀 표시 안 되던 버그 —
  //   이름 매핑용 회사 사용자 목록 조회.
  const { data: companyUsers = [] } = useQuery({
    queryKey: ["approval-company-users", companyId],
    queryFn: async () => {
      const data = logRead('approvals/page:users', await (supabase).from("users").select("id, name, email").eq("company_id", companyId));
      return data || [];
    },
    enabled: !!companyId,
  });
  const userName = (id: string) => {
    const u = (companyUsers as any[]).find((x) => x.id === id);
    return u?.name || u?.email || "구성원";
  };

  // ── 대기중 요청 본인 수정 (2026-07-16 사장님 요청) ──
  //   양식/정책 필드 정의를 되찾아 생성 화면과 동일한 입력으로 편집.
  const { data: editForms = [] } = useQuery({ queryKey: ["approval-forms", companyId, "all"], queryFn: () => listApprovalForms({ includeInactive: true }), enabled: !!companyId });
  const { data: editPolicies = [] } = useQuery({ queryKey: ["approval-policies", companyId], queryFn: () => getApprovalPolicies(companyId), enabled: !!companyId });
  // 상세 팝업에서 필드표·본문을 그리기 위한 양식 정의 맵 (편집용으로 이미 불러온 것을 재사용)
  const detailFormsById = useMemo(() => {
    const map = new Map<string, ApprovalForm>();
    (editForms as ApprovalForm[]).forEach((f) => map.set(f.id, f));
    return map;
  }, [editForms]);

  // 상세 팝업에서 결재 문서 PDF 저장 — '전체 현황' 탭과 동일한 생성 경로를 쓴다
  //   (2026-07-27 사장님 요청: 직원이 본인이 올린 결재를 PDF 로 보관할 수 있게).
  const [pdfLoadingId, setPdfLoadingId] = useState<string | null>(null);
  const handleDownloadApprovalPdf = async (req: any) => {
    setPdfLoadingId(req.id);
    try {
      const formFields = resolveFormFields(req.form_id, req.custom_fields, detailFormsById, editPolicies as ApprovalPolicy[], req.request_type);
      const saved = await buildAndSaveApprovalPdf({ req, requesterName: userName(req.requester_id), formFields });
      if (saved) toast("PDF 다운로드 완료", "success");
    } catch (err: any) {
      toast(`PDF 생성 실패: ${friendlyError(err, "알 수 없는 오류")}`, "error");
    }
    setPdfLoadingId(null);
  };
  const [editReq, setEditReq] = useState<any | null>(null);
  const [editForm, setEditForm] = useState({ title: "", amount: "", description: "" });
  const [editFieldValues, setEditFieldValues] = useState<Record<string, string>>({});
  const [savingEdit, setSavingEdit] = useState(false);
  // 첨부파일 편집 — 유지할 기존 첨부 URL + 새로 추가할 파일 (2026-07-20 사장님 요청)
  const [editAttachments, setEditAttachments] = useState<string[]>([]);
  const [editNewFiles, setEditNewFiles] = useState<File[]>([]);
  const [editDragging, setEditDragging] = useState(false);
  const editFieldsFor = (req: any) => {
    if (req.request_type === "leave") return [] as ApprovalForm["fields"];
    if (req.form_id) return (editForms as ApprovalForm[]).find((f) => f.id === req.form_id)?.fields || [];
    return (editPolicies as ApprovalPolicy[]).find((p) => p.is_active && p.document_type === req.request_type)?.fields || [];
  };
  const openEdit = (req: any) => {
    const fields = editFieldsFor(req);
    const pairs = fields.map((fd) => ({ label: fd.label, value: String(req.custom_fields?.[fd.key] ?? "") })).filter((p) => p.value);
    setEditFieldValues(Object.fromEntries(fields.map((fd) => [fd.key, String(req.custom_fields?.[fd.key] ?? (fd.type === "fixed" ? fd.default_value || "" : ""))])));
    const stripped = contentWithoutFieldLines(req.description || "", pairs);
    setEditForm({
      title: req.title || "",
      amount: req.amount ? String(req.amount) : "",
      description: req.request_type === "leave" ? stripped : plainToHtml(stripped),
    });
    setEditAttachments(Array.isArray(req.attachments) ? req.attachments : []);
    setEditNewFiles([]);
    setEditDragging(false);
    setEditReq(req);
  };
  const saveEdit = async () => {
    if (!editReq || savingEdit) return;
    setSavingEdit(true);
    try {
      // 새 첨부 업로드 — 생성 화면(createMut)과 동일한 경로 규칙
      const uploadedUrls: string[] = [];
      const failedUploads: string[] = [];
      for (const file of editNewFiles) {
        const path = `approvals/${companyId}/${Date.now()}_${toBase64Url(file.name)}`;
        const { error } = await supabase.storage.from("documents").upload(path, file);
        if (!error) {
          const { data: urlData } = supabase.storage.from("documents").getPublicUrl(path);
          uploadedUrls.push(urlData.publicUrl);
        } else {
          failedUploads.push(`${file.name}: ${error.message}`);
        }
      }
      if (failedUploads.length > 0) {
        toast(`첨부파일 업로드 실패 — ${failedUploads.join(" / ")}`, "error");
      }
      const fields = editFieldsFor(editReq);
      const isLeaveReq = editReq.request_type === "leave";
      let finalDesc: string;
      if (isLeaveReq) {
        finalDesc = editForm.description;
      } else {
        const descHtml = isEmptyHtml(editForm.description) ? "" : plainToHtml(editForm.description);
        const fieldHtml = fields.map((fd) => `<p>${escapeHtmlText(`${fd.label}: ${editFieldValues[fd.key] || ""}`)}</p>`).join("");
        finalDesc = fieldHtml + descHtml;
      }
      const amountField = fields.find((fd) => fd.type === "amount");
      const amount = isLeaveReq
        ? undefined
        : fields.length > 0
          ? (amountField ? (Number(String(editFieldValues[amountField.key] ?? "").replace(/[^0-9.-]/g, "")) || 0) : undefined)
          : (Number(String(editForm.amount).replace(/[^0-9.-]/g, "")) || 0);
      await updateApprovalRequest({
        requestId: editReq.id,
        userId,
        title: editForm.title.trim() || editReq.title,
        amount,
        description: finalDesc,
        // 구조화 데이터(휴가·초과근무)는 양식 필드 목록에 없으므로 여기서 살려 둬야 한다 —
        //   안 그러면 수정 한 번에 초과근무 일자·종료시각이 날아가고 근태 반영도 끊긴다 (2026-08-20).
        customFields: fields.length > 0
          ? {
              ...(editReq.custom_fields?.leave ? { leave: editReq.custom_fields.leave } : {}),
              ...(editReq.custom_fields?.overtime ? { overtime: editReq.custom_fields.overtime } : {}),
              ...editFieldValues,
            }
          : undefined,
        attachments: [...editAttachments, ...uploadedUrls],
      });
      toast("요청을 수정했습니다", "success");
      setEditReq(null);
      invalidate();
    } catch (e: any) {
      toast("수정 실패: " + friendlyError(e, "알 수 없는 오류"), "error");
    } finally {
      setSavingEdit(false);
    }
  };

  const resubmitMut = useMutation({
    mutationFn: (requestId: string) => resubmitRequest(requestId),
    onSuccess: invalidate,
    onError: (err: any) => toast("재제출 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
  });

  // 대기중 요청 본인 삭제 (2026-07-20 사장님 요청) — 승인 진행 전에만 노출
  const handleDeleteMine = async (req: any) => {
    const { ok } = await confirm({
      title: "결재 요청 삭제",
      desc: `"${req.title}"을(를) 삭제할까요? 결재선·의견도 함께 삭제되며 되돌릴 수 없습니다.`,
      confirmLabel: "삭제",
      danger: true,
    });
    if (!ok) return;
    setDeletingId(req.id);
    try {
      await deleteApprovalRequest(req.id);
      if (expandedId === req.id) setExpandedId(null);
      toast("삭제했습니다", "success");
      invalidate();
    } catch (err: any) {
      toast(`삭제 실패: ${friendlyError(err, "알 수 없는 오류")}`, "error");
    } finally {
      setDeletingId(null);
    }
  };

  //   상태는 검색조건 안(다중), 정렬은 머리단 (2026-08-18 사장님: "우측 상태 탭은 검색조건에 넣고 목록에 상태 정렬")
  const lf = useListFilter({ types: (requests as any[]).map((r) => r.request_type), withStatus: true });
  type MySort = "status" | "title" | "amount" | "created";
  const [mySort, setMySort] = useState<SortState<MySort>>({ key: "created", dir: "desc" });
  const onMySort = (k: MySort) => setMySort((c) => nextSort(c, k));

  const visibleMine = (requests as any[]).filter((r) => lf.hit({ type: r.request_type, title: r.title, amount: r.amount, created: r.created_at, status: r.status }))
    .sort((a, b) => {
      const d = mySort.dir === "asc" ? 1 : -1;
      if (mySort.key === "status") return (statusRank(a.status) - statusRank(b.status)) * d || cmp(b.created_at || "", a.created_at || "");
      if (mySort.key === "amount") return (Number(a.amount || 0) - Number(b.amount || 0)) * d;
      if (mySort.key === "title") return cmp(a.title || "", b.title || "") * d;
      return cmp(a.created_at || "", b.created_at || "") * d;
    });
  const pager = usePager(visibleMine, lf.rows, `${JSON.stringify(mySort)}|${lf.key}`);
  if (isLoading) {
    return <div className="text-center py-12 text-[var(--text-muted)]">로딩 중...</div>;
  }


  return (
    <div className="ap-list">
      {/* 조회 줄 — 목록 탭 공용: 검색조건(유형·상태·요청일·금액·줄 수) + 빠른검색 + 건수 (2026-08-18) */}
      <QueryBar right={<span className="text-xs font-semibold text-[var(--text-dim)] mono-number">{visibleMine.length}건</span>}>
        {lf.panel}
        {lf.quick}
      </QueryBar>
      {lf.applied}

      {requests.length === 0 ? (
        <div className="ap-empty">
          <div className="mx-auto w-16 h-16 mb-4 rounded-2xl bg-[var(--primary-light)] text-[var(--primary)] flex items-center justify-center">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          </div>
          <div className="text-base font-bold mb-1.5">제출한 결재 요청이 없습니다</div>
          <div className="text-sm text-[var(--text-muted)]">&ldquo;새 요청&rdquo; 탭에서 결재를 요청할 수 있습니다</div>
        </div>
      ) : visibleMine.length === 0 ? (
        <div className="ap-empty"><div className="text-sm font-bold mb-1">이 조건에 맞는 요청이 없습니다</div><div className="text-xs text-[var(--text-muted)]">검색조건을 풀어 보세요</div></div>
      ) : (
        <>
        {/* 표 — 전체 현황과 같은 뼈대. 줄을 누르면 상세 팝업 */}
        <div className="approval-table-wrap ev-scroll">
          <table className="ev-table ev-lined approval-table">
            <thead>
              <tr>
                <SortableTh label="상태" sortKey="status" sort={mySort} onSort={onMySort} />
                <SortableTh label="제목" sortKey="title" sort={mySort} onSort={onMySort} />
                <SortableTh label="금액" sortKey="amount" sort={mySort} onSort={onMySort} />
                <SortableTh label="진행" />
                <SortableTh label="요청일" sortKey="created" sort={mySort} onSort={onMySort} />
                <SortableTh label="참조" />
                <SortableTh label="관리" />
              </tr>
            </thead>
            <tbody>
              {(pager.view as any[]).map((req: any) => {
                const m = typeMeta(req.request_type);
                return (
                  <tr key={req.id} className="approval-table-row" onClick={() => setExpandedId(req.id)}>
                    <td className="px-4 py-3.5 text-center"><StatusBadge status={req.status} /></td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${m.bg} ${m.text}`}>
                          <TypeIcon name={m.icon} className="w-4 h-4" />
                        </span>
                        <div className="min-w-0">
                          <div className="text-sm font-semibold truncate max-w-[280px]">{req.title}</div>
                          <div className="text-[10px] text-[var(--text-dim)]">{REQUEST_TYPE_LABELS[req.request_type as RequestType] || req.request_type}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-sm font-bold mono-number text-right">{req.amount > 0 ? formatAmount(req.amount) : "-"}</td>
                    <td className="px-4 py-3.5 w-[140px]"><StageProgress current={req.current_stage} total={req.total_stages} status={req.status} /></td>
                    <td className="px-4 py-3.5 text-xs text-[var(--text-muted)] whitespace-nowrap">{formatDate(req.created_at)}</td>
                    <td className="px-4 py-3.5 text-xs text-[var(--text-dim)]">
                      {Array.isArray(req.reference_user_ids) && req.reference_user_ids.length > 0 ? req.reference_user_ids.map((id: string) => userName(id)).join(", ") : "-"}
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-1.5">
                        {req.status === "rejected" && (
                          <button onClick={(e) => { e.stopPropagation(); resubmitMut.mutate(req.id); }} disabled={resubmitMut.isPending} className="btn-primary btn-sm">재제출</button>
                        )}
                        {req.status === "pending" && (
                          <>
                            <button onClick={(e) => { e.stopPropagation(); openEdit(req); }} className="btn-secondary btn-sm" title="대기중인 동안 요청 내용을 수정할 수 있습니다">수정</button>
                            <button onClick={(e) => { e.stopPropagation(); handleDeleteMine(req); }} disabled={deletingId === req.id} className="btn-secondary btn-sm text-[var(--danger)] disabled:opacity-50" title="대기중인 동안 요청을 삭제할 수 있습니다">
                              {deletingId === req.id ? "삭제 중…" : "삭제"}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Pager page={pager.page} pages={pager.pages} total={visibleMine.length} size={lf.rows} from={pager.from} to={pager.to} onPage={pager.setPage} />
        </>
      )}

      {/* 상세 팝업 — 올린 결재의 전체 내용(필드표·본문·첨부·결재선) 확인.
          2026-07-27 사장님 요청: 눌러도 내용이 안 보였음(기존 펼침은 결재 진행단계만). */}
      {expandedId && (() => {
        const req = (requests as any[]).find((r) => r.id === expandedId);
        if (!req) return null;
        const m = typeMeta(req.request_type);
        const fields = resolveFormFields(req.form_id, req.custom_fields, detailFormsById, editPolicies as ApprovalPolicy[], req.request_type);
        const content = contentWithoutFieldLines(req.description || "", fields);
        return (
          <div className="approval-detail-modal fixed inset-0" onClick={() => setExpandedId(null)}>
            <div className="glass-card p-6 w-full max-w-lg shadow-xl animate-count-up max-h-[88vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-start justify-between gap-3 mb-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${m.bg} ${m.text}`}>
                    <TypeIcon name={m.icon} className="w-4 h-4" />
                  </span>
                  <StatusBadge status={req.status} />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleDownloadApprovalPdf(req)}
                    disabled={pdfLoadingId === req.id}
                    title="결재 문서 PDF 저장"
                    className="approval-modal-pdf-btn"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
                    </svg>
                    {pdfLoadingId === req.id ? "생성 중..." : "PDF 저장"}
                  </button>
                  <button onClick={() => setExpandedId(null)} className="text-[var(--text-dim)] hover:text-[var(--text)] transition text-xl leading-none px-1">✕</button>
                </div>
              </div>
              <h3 className="text-[20px] font-extrabold leading-tight mt-2 mb-1.5">{req.title}</h3>
              <div className="text-xs text-[var(--text-dim)] mb-1.5">
                {REQUEST_TYPE_LABELS[req.request_type as RequestType] || req.request_type} · {formatDate(req.created_at)}
              </div>
              {Array.isArray(req.reference_user_ids) && req.reference_user_ids.length > 0 && (
                <div className="approval-reference-line text-[11px] text-[var(--text-dim)] mb-5">
                  참조: {req.reference_user_ids.map((id: string) => userName(id)).join(", ")}
                </div>
              )}

              {req.amount > 0 && (
                <div className="text-xl font-extrabold mono-number mb-4">{formatAmount(req.amount)}</div>
              )}

              {fields.length > 0 && (
                <div className="mb-4 pb-4 border-b border-[var(--border)]/60">
                  <FormFieldRows fields={fields} />
                </div>
              )}
              {!isEmptyHtml(content) && (
                <DescriptionContent text={content} className="mb-2 text-sm text-[var(--text)] leading-8" />
              )}
              <AttachmentList attachments={req.attachments} />

              <div className="mt-6 pt-5 border-t border-[var(--border)]">
                <ApprovalTimelineView
                  requestId={req.id}
                  currentStage={req.current_stage}
                  totalStages={req.total_stages}
                  requestStatus={req.status}
                  currentUserId={userId}
                />
              </div>
              {/* 본인 요청 건 댓글 — 진행중/완료 무관, 사진·파일 첨부 가능 (2026-07-30 사장님) */}
              <div className="mt-5 pt-4 border-t border-[var(--border)]/60">
                <ApprovalCommentThread requestId={req.id} />
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── 대기중 요청 수정 모달 — 요청자 본인만, 생성 화면과 동일한 입력 구성 ── */}
      {editReq && (() => {
        const fields = editFieldsFor(editReq);
        const isLeaveReq = editReq.request_type === "leave";
        const amountField = fields.find((fd) => fd.type === "amount");
        return (
          <div className="approval-detail-modal fixed inset-0" onClick={() => setEditReq(null)}>
            <div className="glass-card p-6 w-full max-w-lg shadow-xl animate-count-up max-h-[88vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-sm font-bold mb-1">요청 수정</h3>
              <p className="text-[11px] text-[var(--text-dim)] mb-4">대기중인 동안만 수정할 수 있으며, 수정 내용은 승인자에게 그대로 표시됩니다.</p>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">제목</label>
                  <input value={editForm.title} onChange={(e) => setEditForm((s) => ({ ...s, title: e.target.value }))} className="field-input" />
                </div>
                {/* 금액 칸은 새 요청에서 없앴다(2026-08-20 사장님) — 여기서는 이미 금액이 들어간
                    예전 결재를 고칠 때만 보인다. 앞으로 금액은 양식의 '금액' 입력 필드로 받는다. */}
                {!isLeaveReq && fields.length === 0 && Number(editReq?.amount || 0) > 0 && (
                  <div>
                    <label className="block text-xs text-[var(--text-muted)] mb-1">금액 (원)</label>
                    <CurrencyInput
                      value={editForm.amount}
                      onValueChange={(raw) => setEditForm((s) => ({ ...s, amount: raw }))}
                      placeholder="0"
                      className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)] text-right"
                    />
                  </div>
                )}
                {fields.map((fd) => (
                  <div key={fd.key}>
                    <label className="block text-xs text-[var(--text-muted)] mb-1">{fd.label}{fd.required ? " *" : ""}</label>
                    {fd.type === "textarea" ? (
                      <textarea value={editFieldValues[fd.key] || ""} onChange={(e) => setEditFieldValues((s) => ({ ...s, [fd.key]: e.target.value }))} rows={2} className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm" />
                    ) : fd.type === "select" ? (
                      <SelectWithEtc
                        value={editFieldValues[fd.key] || ""}
                        options={fd.options || []}
                        onChange={(v) => setEditFieldValues((s) => ({ ...s, [fd.key]: v }))}
                      />
                    ) : fd.type === "fixed" ? (
                      <input type="text" value={fd.default_value || ""} readOnly disabled
                        className="w-full px-3 py-2 bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl text-sm text-[var(--text-muted)]" />
                    ) : fd.type === "amount" && fd === amountField ? (
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-dim)] text-sm">₩</span>
                        <input inputMode="numeric" value={editFieldValues[fd.key] || ""}
                          onChange={(e) => { const raw = e.target.value.replace(/[^0-9]/g, ""); setEditFieldValues((s) => ({ ...s, [fd.key]: raw ? Number(raw).toLocaleString("ko-KR") : "" })); }}
                          placeholder="0" className="w-full pl-7 pr-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm mono-number text-right" />
                      </div>
                    ) : fd.type === "date" ? (
                      <DateField value={editFieldValues[fd.key] || ""} onChange={(e) => setEditFieldValues((s) => ({ ...s, [fd.key]: e.target.value }))} className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm" />
                    ) : fd.type === "period" ? (
                      <PeriodFieldInput value={editFieldValues[fd.key] || ""} onChange={(v) => setEditFieldValues((s) => ({ ...s, [fd.key]: v }))} />
                    ) : (
                      <input type={fd.type === "number" ? "number" : "text"} value={editFieldValues[fd.key] || ""} onChange={(e) => setEditFieldValues((s) => ({ ...s, [fd.key]: e.target.value }))} className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm" />
                    )}
                  </div>
                ))}
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">상세 내용</label>
                  {isLeaveReq ? (
                    <textarea value={editForm.description} onChange={(e) => setEditForm((s) => ({ ...s, description: e.target.value }))} rows={6}
                      className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)] resize-none" />
                  ) : (
                    <div className="approval-desc-editor">
                      <RichEditor key={editReq.id} content={editForm.description}
                        onChange={(html) => setEditForm((s) => ({ ...s, description: html }))}
                        placeholder="결재 요청에 대한 상세 설명을 입력하세요..." maxHeight="280px" />
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">첨부파일</label>
                  {editAttachments.length > 0 && (
                    <div className="space-y-1.5 mb-2">
                      {editAttachments.map((url, i) => (
                        <div key={url} className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-[var(--bg-surface)] text-xs">
                          <span className="w-7 h-7 rounded-lg bg-[var(--primary)]/10 text-[var(--primary)] flex items-center justify-center shrink-0">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>
                          </span>
                          <span className="truncate flex-1 font-medium text-[var(--text)]">{attachmentFileName(url)}</span>
                          <button type="button" onClick={() => setEditAttachments(prev => prev.filter((_, idx) => idx !== i))} className="text-[var(--text-dim)] hover:text-[var(--danger)] font-bold px-1 transition">✕</button>
                        </div>
                      ))}
                    </div>
                  )}
                  {editNewFiles.length > 0 && (
                    <div className="space-y-1.5 mb-2">
                      {editNewFiles.map((f, i) => (
                        <div key={i} className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-[var(--bg-surface)] text-xs">
                          <span className="w-7 h-7 rounded-lg bg-[var(--success)]/10 text-[var(--success)] flex items-center justify-center shrink-0">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>
                          </span>
                          <span className="truncate flex-1 font-medium text-[var(--text)]">{f.name}</span>
                          <span className="text-[10px] text-[var(--text-dim)] mono-number shrink-0">{(f.size / 1024).toFixed(1)}KB</span>
                          <button type="button" onClick={() => setEditNewFiles(prev => prev.filter((_, idx) => idx !== i))} className="text-[var(--text-dim)] hover:text-[var(--danger)] font-bold px-1 transition">✕</button>
                        </div>
                      ))}
                    </div>
                  )}
                  <label
                    className={`flex flex-col items-center justify-center gap-1 px-4 py-4 rounded-xl border-2 border-dashed transition cursor-pointer ${
                      editDragging
                        ? "border-[var(--primary)] bg-[var(--primary)]/8"
                        : "border-[var(--border)] bg-[var(--bg)]/50 hover:border-[var(--primary)]/50 hover:bg-[var(--primary)]/4"
                    }`}
                    onDragOver={(e) => { e.preventDefault(); setEditDragging(true); }}
                    onDragLeave={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node)) setEditDragging(false);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      setEditDragging(false);
                      const dropped = Array.from(e.dataTransfer.files || []);
                      if (dropped.length > 0) setEditNewFiles(prev => [...prev, ...dropped]);
                    }}
                  >
                    <svg className="w-5 h-5 text-[var(--text-dim)]" fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                    <span className="text-xs font-semibold text-[var(--text-muted)]">{editDragging ? "여기에 놓아서 첨부" : "클릭하거나 파일을 끌어다 첨부"}</span>
                    <input
                      type="file"
                      multiple
                      onChange={(e) => {
                        const picked = Array.from(e.target.files || []);
                        if (picked.length > 0) setEditNewFiles(prev => [...prev, ...picked]);
                        e.target.value = "";
                      }}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>
              <div className="flex gap-2 mt-5">
                <button onClick={() => setEditReq(null)} className="btn-secondary flex-1">취소</button>
                <button onClick={saveEdit} disabled={savingEdit} className="btn-primary flex-1">{savingEdit ? "저장 중…" : "수정 저장"}</button>
              </div>
            </div>
          </div>
        );
      })()}
      {confirmElement}
    </div>
  );
}

// ══════════════════════════════════════════════
// Tab 3: 참조 (나를 참조로 지정한 결재건)
// ══════════════════════════════════════════════
// 2026-07-27 QA(사장님): 참조자는 결재선에도 요청자에도 없어 '내 결재함'·'내 요청'에 안 잡히고
//   '전체 현황'은 관리자 전용 → 참조로 걸린 결재의 내용을 볼 수 있는 화면이 아예 없었다.
//   여기서 문서 본문·양식 필드·첨부·결재 진행을 읽기 전용으로 제공한다(승인/반려 액션 없음).

function ReferencedRequestsTab({ companyId, userId, embedded }: { companyId: string; userId: string;
  /** 내 결재함 안에 끼워질 때 — 조회 줄은 부모(내 결재함)가 그리고, 거르기 규칙만 받는다 (2026-08-18) */
  embedded?: { hit: (r: LRow) => boolean; rows: number; key: string };
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [refStatus, setRefStatus] = useState("");

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ["referenced-requests", userId, companyId],
    queryFn: () => getReferencedRequests(userId, companyId),
    enabled: !!userId && !!companyId,
  });

  // 양식 필드 정의 — custom_fields 값과 짝지어 구조화 항목으로 표시 (다른 탭과 동일 규칙)
  const { data: customForms = [] } = useQuery({
    queryKey: ["approval-forms", companyId, "all"],
    queryFn: () => listApprovalForms({ includeInactive: true }),
    enabled: !!companyId,
  });
  const { data: fieldPolicies = [] } = useQuery({
    queryKey: ["approval-policies", companyId],
    queryFn: () => getApprovalPolicies(companyId),
    enabled: !!companyId,
  });
  const formsById = useMemo(() => {
    const map = new Map<string, ApprovalForm>();
    (customForms as ApprovalForm[]).forEach((f) => map.set(f.id, f));
    return map;
  }, [customForms]);
  const lf = useListFilter({ types: (requests as any[]).map((r) => r.request_type), requesters: (requests as any[]).map((r) => r.users?.name || r.users?.email || "") });

  const refName = (req: any) => req.users?.name || req.users?.email || "알 수 없음";
  const hitFn = embedded ? embedded.hit : lf.hit;
  const rowsN = embedded ? embedded.rows : lf.rows;
  const visibleRefs = (requests as any[]).filter((r) => (embedded || !refStatus || r.status === refStatus) && hitFn({ type: r.request_type, title: r.title, requester: refName(r), amount: r.amount, created: r.created_at, status: r.status }));
  const pager = usePager(visibleRefs, rowsN, `${refStatus}|${embedded ? embedded.key : lf.key}`);
  if (isLoading) {
    return <div className="text-center py-12 text-[var(--text-muted)]">로딩 중...</div>;
  }

  const refStatusOptions = [
    { value: "", label: "전체 상태" }, { value: "pending", label: "대기" }, { value: "approved", label: "승인" }, { value: "rejected", label: "반려" }, { value: "cancelled", label: "취소" },
  ];

  return (
    <div className="ap-list">
      {/* 조회 줄 — 목록 탭 공용 (2026-08-18). 내 결재함 안(embedded)에서는 부모가 그리고 상태 칩만 여기 남는다 */}
      {embedded ? null : (<>
      <QueryBar right={<span className="text-xs font-semibold text-[var(--text-dim)] mono-number">{visibleRefs.length}건</span>}>
        {lf.panel}
        {lf.quick}
        <ChipGroup value={refStatus} onChange={setRefStatus} options={refStatusOptions} />
      </QueryBar>
      {lf.applied}
      </>)}

      {requests.length === 0 ? (
        <div className="ap-empty">
          <div className="mx-auto w-16 h-16 mb-4 rounded-2xl bg-[var(--bg-surface)] text-[var(--text-dim)] flex items-center justify-center">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          </div>
          <div className="text-base font-bold mb-1.5">참조로 지정된 결재가 없습니다</div>
          <div className="text-sm text-[var(--text-muted)]">다른 구성원이 결재를 올리며 나를 참조로 지정하면 이곳에 표시됩니다</div>
        </div>
      ) : visibleRefs.length === 0 ? (
        <div className="ap-empty"><div className="text-sm font-bold mb-1">이 조건에 맞는 요청이 없습니다</div><div className="text-xs text-[var(--text-muted)]">검색조건을 풀어 보세요</div></div>
      ) : (
        <>
        <div className="approval-table-wrap ev-scroll">
          <table className="ev-table ev-lined approval-table">
            <thead>
              <tr>
                <SortableTh label="상태" />
                <SortableTh label="제목" />
                <SortableTh label="요청자" />
                <SortableTh label="금액" />
                <SortableTh label="진행" />
                <SortableTh label="요청일" />
              </tr>
            </thead>
            <tbody>
              {(pager.view as any[]).map((req: any) => {
                const m = typeMeta(req.request_type);
                const open = expandedId === req.id;
                // 네이티브 휴가 건은 양식 필드·결재 타임라인이 없음(내용은 description 으로 전달)
                const isNativeLeave = !!req.is_native_leave;
                const formFields = isNativeLeave ? [] : resolveFormFields(req.form_id, req.custom_fields, formsById, fieldPolicies as ApprovalPolicy[], req.request_type);
                const contentText = contentWithoutFieldLines(req.description || "", formFields);
                return (
                  <Fragment key={req.id}>
                    <tr className={open ? "approval-table-row ap-row-open" : "approval-table-row"} onClick={() => setExpandedId(open ? null : req.id)}>
                      <td className="px-4 py-3.5 text-center"><StatusBadge status={req.status} /></td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${m.bg} ${m.text}`}>
                            <TypeIcon name={m.icon} className="w-4 h-4" />
                          </span>
                          <div className="min-w-0">
                            <div className="text-sm font-semibold truncate max-w-[280px]">{req.title}</div>
                            <div className="text-[10px] text-[var(--text-dim)]">{REQUEST_TYPE_LABELS[req.request_type as RequestType] || req.request_type}</div>
                          </div>
                          <svg className={`w-3.5 h-3.5 shrink-0 text-[var(--text-dim)] transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path d="M19 9l-7 7-7-7" /></svg>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-xs text-[var(--text-muted)]">{refName(req)}</td>
                      <td className="px-4 py-3.5 text-sm font-bold mono-number text-right">{req.amount > 0 ? formatAmount(req.amount) : "-"}</td>
                      <td className="px-4 py-3.5 w-[140px]"><StageProgress current={req.current_stage} total={req.total_stages} status={req.status} /></td>
                      <td className="px-4 py-3.5 text-xs text-[var(--text-muted)] whitespace-nowrap">{formatDate(req.created_at)}</td>
                    </tr>
                    {open && (
                      <tr className="ap-detail-row">
                        <td colSpan={6}>
                          <div className="approval-timeline-panel">
                            {formFields.length > 0 && (
                              <div className="mb-4 pb-4 border-b border-[var(--border)]/60">
                                <FormFieldRows fields={formFields} />
                              </div>
                            )}
                            {contentText && (
                              <DescriptionContent text={contentText} className="mb-3 text-sm text-[var(--text)] leading-8" />
                            )}
                            <AttachmentList attachments={req.attachments} />
                            {!isNativeLeave && (
                              <div className="mt-5 pt-4 border-t border-[var(--border)]">
                                <ApprovalTimelineView
                                  requestId={req.id}
                                  currentStage={req.current_stage}
                                  totalStages={req.total_stages}
                                  requestStatus={req.status}
                                  currentUserId={userId}
                                />
                              </div>
                            )}
                            {/* 댓글 — 참조자에게만 안 보였다 (2026-09-01 사장님: "참조인도 댓글 다 확인 가능하게").
                                내 결재함·내 요청·전체 현황과 같은 공용 스레드 그대로 — 읽기·쓰기 모두 가능 */}
                            {!isNativeLeave && (
                              <div className="mt-5 pt-4 border-t border-[var(--border)]">
                                <ApprovalCommentThread requestId={req.id} />
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <Pager page={pager.page} pages={pager.pages} total={visibleRefs.length} size={rowsN} from={pager.from} to={pager.to} onPage={pager.setPage} />
        </>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════
// Tab 4: 전체 현황 (Admin)
// ══════════════════════════════════════════════

function AllRequestsTab({ companyId, initialStatusFilter, userId, userRole, invalidate }: { invalidate: () => void; companyId: string; initialStatusFilter?: string; userId?: string | null; userRole?: string | null }) {
  // 직원 계정은 회사 전체가 아니라 본인이 신청한 요청만 조회 (관리자/대표는 전체)
  // (P3) 전체 현황 권한(:all)이 없으면 본인 신청분만 — 구 employee 분기 대체
  const { isMaster: rMaster, hasPerm: rHasPerm } = useMyPermissions();
  const restrictToOwn = !(rMaster || rHasPerm("/approvals:all"));
  const { toast } = useToast();
  const { confirm, confirmElement } = useConfirm();
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pdfLoadingId, setPdfLoadingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // 확인(열람) 표시 — 클릭해 본 건은 목록에서 제목을 연하게 (2026-08-04 사장님: 광고비 지출결의서처럼
  //   제목이 똑같으면 어디까지 확인했는지 구분이 안 됨). 처음엔 localStorage(기기별)였는데
  //   같은 날 "계정별로 하자" 지시로 DB(approval_request_views, 본인 행 RLS)로 전환 — 기기 간 공유.
  const { data: viewedRows = [] } = useQuery({
    queryKey: ["approval-request-views", userId],
    queryFn: async () => {
      const data = logRead('approvals/page:viewed', await (supabase as any)
        .from("approval_request_views").select("request_id").eq("user_id", userId!));
      return (data || []) as { request_id: string }[];
    },
    enabled: !!userId,
  });
  const viewedIds = useMemo(() => new Set(viewedRows.map((r) => r.request_id)), [viewedRows]);
  const markViewed = (id: string) => {
    if (!userId || viewedIds.has(id)) return;
    // 낙관적 반영(연해지는 게 즉시 보여야 함) 후 DO NOTHING upsert — 재클릭·동시탭 충돌 무해.
    queryClient.setQueryData(["approval-request-views", userId], (old: { request_id: string }[] | undefined) =>
      [...(old || []), { request_id: id }]);
    void (supabase as any).from("approval_request_views")
      .upsert({ user_id: userId, request_id: id }, { onConflict: "user_id,request_id", ignoreDuplicates: true })
      .then(({ error }: { error: unknown }) => {
        if (error) queryClient.invalidateQueries({ queryKey: ["approval-request-views", userId] });
      });
  };

  // 전체 현황에서도 결재 처리 (2026-08-04 사장님: 내 결재함까지 안 가고 여기서 바로 승인/반려).
  //   팝업이 이미 쓰는 타임라인 쿼리(ApprovalTimelineView 와 같은 키 → 캐시 공유)로
  //   "지금 내 차례인 단계"를 찾고, 있을 때만 승인/반려 UI 를 노출한다.
  //   서버(approveStep/rejectStep)가 결재자 본인·pending 여부를 재검증하므로 표시는 편의일 뿐 권한 경계가 아니다.
  const { data: expandedTimeline = [] } = useQuery({
    queryKey: ["approval-timeline", expandedId],
    queryFn: () => getApprovalTimeline(expandedId!),
    enabled: !!expandedId,
  });
  const [decisionComment, setDecisionComment] = useState("");
  useEffect(() => { setDecisionComment(""); }, [expandedId]);
  const decideApproveMut = useMutation({
    mutationFn: ({ stepId, comment }: { stepId: string; comment?: string }) => approveStep(stepId, userId!, comment),
    onSuccess: () => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["approval-timeline", expandedId] });
      setDecisionComment("");
      toast("승인 처리했습니다", "success");
      window.dispatchEvent(new Event("sidebar-refresh-badges"));
    },
    onError: (err: any) => toast("승인 처리 실패: " + friendlyError(err, "알 수 없는 오류"), "error"),
  });
  const decideRejectMut = useMutation({
    mutationFn: ({ stepId, comment }: { stepId: string; comment: string }) => rejectStep(stepId, userId!, comment),
    onSuccess: () => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["approval-timeline", expandedId] });
      setDecisionComment("");
      toast("반려 처리했습니다", "success");
      window.dispatchEvent(new Event("sidebar-refresh-badges"));
    },
    onError: (err: any) => toast("반려 처리 실패: " + friendlyError(err, "알 수 없는 오류"), "error"),
  });

  //   유형·상태는 검색조건 패널에서 여러 개 고른다(클라이언트 필터) — 서버는 전체를 한 번에 (2026-08-18 사장님: 상태 칩 줄도 검색조건으로)
  const { data: allRequests = [], isLoading } = useQuery({
    queryKey: ["all-requests", companyId, restrictToOwn ? userId : null],
    queryFn: () => getApprovalRequests(companyId, {
      requesterId: restrictToOwn ? userId || undefined : undefined,
    }),
    enabled: !!companyId && (!restrictToOwn || !!userId),
  });

  // 커스텀 결재 양식 필드 정의 — custom_fields 값과 짝지어 펼침 패널에 구조화된 항목으로 표시
  const { data: customForms = [] } = useQuery({
    queryKey: ["approval-forms", companyId, "all"],
    queryFn: () => listApprovalForms({ includeInactive: true }),
    enabled: !!companyId,
  });
  const { data: fieldPolicies = [] } = useQuery({
    queryKey: ["approval-policies", companyId],
    queryFn: () => getApprovalPolicies(companyId),
    enabled: !!companyId,
  });
  const formsById = useMemo(() => {
    const map = new Map<string, ApprovalForm>();
    (customForms as ApprovalForm[]).forEach((f) => map.set(f.id, f));
    return map;
  }, [customForms]);

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

  // 2026-07-16 QA: 참조자(reference_user_ids)가 "전체 현황"에도 전혀 표시 안 되던 버그 —
  //   요청자 목록만으론 참조 전용 인원 이름을 못 찾아 회사 전체 사용자 목록을 별도 조회.
  const { data: companyUsers = [] } = useQuery({
    queryKey: ["approval-company-users", companyId],
    queryFn: async () => {
      const data = logRead('approvals/page:users-avatar', await (supabase).from("users").select("id, name, email, avatar_url").eq("company_id", companyId));
      return data || [];
    },
    enabled: !!companyId,
  });
  const referenceUserName = (id: string) => {
    const u = (companyUsers as any[]).find((x) => x.id === id);
    return u?.name || u?.email || "구성원";
  };
  const userAvatar = (id: string) => (companyUsers as any[]).find((x) => x.id === id)?.avatar_url || null;

  // 승인 완료된 결재 문서 PDF 다운로드
  const handleDownloadApprovalPdf = async (req: any) => {
    setPdfLoadingId(req.id);
    try {
      const formFields = resolveFormFields(req.form_id, req.custom_fields, formsById, fieldPolicies as ApprovalPolicy[], req.request_type);
      const saved = await buildAndSaveApprovalPdf({ req, requesterName: requesterNames.get(req.requester_id) || "-", formFields });
      if (saved) toast("PDF 다운로드 완료", "success");
    } catch (err: any) {
      toast(`PDF 생성 실패: ${friendlyError(err, "알 수 없는 오류")}`, "error");
    }
    setPdfLoadingId(null);
  };

  // 요청 상세 팝업(읽기 전용) — ESC로만 닫기, 별도 확인 액션 없음
  useModalKeys(!!expandedId, () => setExpandedId(null));
  const lf = useListFilter({
    types: (allRequests as any[]).map((r) => r.request_type),
    requesters: (allRequests as any[]).map((r) => requesterNames.get(r.requester_id) || ""),
    withStatus: true,
  });
  // 요약 줄(대기 중·승인 완료·반려)의 상태 버튼 → 검색조건 '상태' 로 (이미 이 탭에 있어도 갱신)
  useEffect(() => {
    if (initialStatusFilter !== undefined) lf.applyStatuses(initialStatusFilter ? [initialStatusFilter] : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialStatusFilter]);
  type AllSort = "status" | "title" | "requester" | "amount" | "created" | "approved";
  const [aSort, setASort] = useState<SortState<AllSort>>({ key: "created", dir: "desc" });
  const onASort = (k: AllSort) => setASort((c) => nextSort(c, k));

  // 검색조건(유형·요청일·요청자·금액·줄 수) + 빠른검색 — 목록 탭 공용 패널 (2026-08-18)
  const visibleRequests = allRequests.filter((r: any) => lf.hit({ type: r.request_type, title: r.title, requester: requesterNames.get(r.requester_id) || "", amount: r.amount, created: r.created_at, status: r.status }))
    .sort((a: any, b: any) => {
      const d = aSort.dir === "asc" ? 1 : -1;
      switch (aSort.key) {
        case "status": return (statusRank(a.status) - statusRank(b.status)) * d || cmp(b.created_at || "", a.created_at || "");
        case "title": return cmp(a.title || "", b.title || "") * d;
        case "requester": return cmp(requesterNames.get(a.requester_id) || "", requesterNames.get(b.requester_id) || "") * d;
        case "amount": return (Number(a.amount || 0) - Number(b.amount || 0)) * d;
        case "approved": return cmp(a.status === "approved" ? a.updated_at || "" : "", b.status === "approved" ? b.updated_at || "" : "") * d;
        default: return cmp(a.created_at || "", b.created_at || "") * d;
      }
    });
  const pager = usePager(visibleRequests, lf.rows, `${JSON.stringify(aSort)}|${lf.key}`);

  if (isLoading) {
    return <div className="text-center py-12 text-[var(--text-muted)]">로딩 중...</div>;
  }

  return (
    <div className="ap-list">
      {/* 조회 줄 — 조회 표준 부품: 검색조건(유형·상태·요청일·요청자·금액·줄 수) + 빠른검색 + 건수 */}
      <QueryBar right={<span className="text-xs font-semibold text-[var(--text-dim)] mono-number">{visibleRequests.length}건</span>}>
        {lf.panel}
        {lf.quick}
      </QueryBar>
      {lf.applied}

      {/* Table */}
      <div className="approval-table-wrap ev-scroll">
        <table className="ev-table ev-lined approval-table">
          <thead>
            <tr>
              <SortableTh label="상태" sortKey="status" sort={aSort} onSort={onASort} />
              <SortableTh label="제목" sortKey="title" sort={aSort} onSort={onASort} />
              <SortableTh label="요청자" sortKey="requester" sort={aSort} onSort={onASort} />
              <SortableTh label="금액" sortKey="amount" sort={aSort} onSort={onASort} />
              <SortableTh label="진행" />
              <SortableTh label="요청일" sortKey="created" sort={aSort} onSort={onASort} />
              <SortableTh label="승인일" sortKey="approved" sort={aSort} onSort={onASort} />
              <SortableTh label="문서" />
            </tr>
          </thead>
          <tbody>
            {visibleRequests.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-16 text-center">
                  <div className="mx-auto w-14 h-14 mb-3 rounded-2xl bg-[var(--bg-surface)] text-[var(--text-dim)] flex items-center justify-center">
                    <svg className="w-7 h-7" fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/></svg>
                  </div>
                  <div className="text-sm font-bold mb-1">결재 요청이 없습니다</div>
                  <div className="text-xs text-[var(--text-muted)]">검색어·필터 조건을 바꾸거나 새 요청을 기다려 보세요</div>
                </td>
              </tr>
            ) : (
              (pager.view as any[]).map((req: any) => {
                const m = typeMeta(req.request_type);
                return (
                  <tr
                    key={req.id}
                    className="approval-table-row"
                    onClick={() => { setExpandedId(req.id); markViewed(req.id); }}
                  >
                    <td className="px-4 py-3.5 text-center"><StatusBadge status={req.status} /></td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${m.bg} ${m.text}`}>
                          <TypeIcon name={m.icon} className="w-4 h-4" />
                        </span>
                        <div className="min-w-0">
                          {/* 확인한 건은 연하게 — 같은 제목이 반복될 때 진행 위치 구분용 */}
                          <div className={`text-sm truncate max-w-[240px] ${viewedIds.has(req.id) ? "font-normal text-[var(--text-dim)]" : "font-semibold"}`}>{req.title}</div>
                          <div className="text-[10px] text-[var(--text-dim)]">{REQUEST_TYPE_LABELS[req.request_type as RequestType] || req.request_type}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2">
                        <Avatar name={requesterNames.get(req.requester_id) || "?"} src={userAvatar(req.requester_id)} size={24} />
                        <span className="text-xs text-[var(--text-muted)] truncate max-w-[100px]">{requesterNames.get(req.requester_id) || "-"}</span>
                      </div>
                    </td>
                    {/* 금액 없는 결재가 ₩0 으로 보이지 않게 — 다른 표와 같은 규칙 (2026-08-20) */}
                    <td className="px-4 py-3.5 text-sm font-bold mono-number text-right">{req.amount > 0 ? formatAmount(req.amount) : "-"}</td>
                    <td className="px-4 py-3.5 w-[140px]">
                      <StageProgress current={req.current_stage} total={req.total_stages} status={req.status} />
                    </td>
                    <td className="px-4 py-3.5 text-xs text-[var(--text-muted)] whitespace-nowrap">{formatDate(req.created_at)}</td>
                    <td className="px-4 py-3.5 text-xs text-[var(--text-muted)] whitespace-nowrap">{req.status === "approved" ? formatDate(req.updated_at) : "-"}</td>
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
                        {/* 승인·반려가 끝난 건은 삭제 버튼 자체를 감춘다 (2026-08-21 감사) —
                            지우면 차감된 연차·지급 건이 근거 없이 남는다. 기록은 취소로 남긴다. */}
                        {["pending", "cancelled"].includes(String(req.status)) && (
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
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <Pager page={pager.page} pages={pager.pages} total={visibleRequests.length} size={lf.rows} from={pager.from} to={pager.to} onPage={pager.setPage} />

      {/* 요청 상세 팝업 — 클릭한 행의 내용·구조화 필드·첨부파일·결재 타임라인 */}
      {expandedId && (() => {
        const req = allRequests.find((r: any) => r.id === expandedId);
        if (!req) return null;
        const m = typeMeta(req.request_type);
        const reqFormFields = resolveFormFields(req.form_id, req.custom_fields, formsById, fieldPolicies as ApprovalPolicy[], req.request_type);
        const reqContentText = contentWithoutFieldLines(req.description || "", reqFormFields);
        return (
          <div className="approval-detail-modal fixed inset-0" onClick={() => setExpandedId(null)}>
            <div className="glass-card p-6 w-full max-w-lg shadow-xl animate-count-up max-h-[88vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-start justify-between gap-3 mb-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${m.bg} ${m.text}`}>
                    <TypeIcon name={m.icon} className="w-4 h-4" />
                  </span>
                  <StatusBadge status={req.status} />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleDownloadApprovalPdf(req)}
                    disabled={pdfLoadingId === req.id}
                    title="결재 문서 PDF 저장"
                    className="approval-modal-pdf-btn"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
                    </svg>
                    {pdfLoadingId === req.id ? "생성 중..." : "PDF 저장"}
                  </button>
                  <button onClick={() => setExpandedId(null)} className="text-[var(--text-dim)] hover:text-[var(--text)] transition text-xl leading-none px-1">✕</button>
                </div>
              </div>
              <h3 className="text-[20px] font-extrabold leading-tight mt-2 mb-1.5">{req.title}</h3>
              <div className="text-xs text-[var(--text-dim)] mb-1.5">
                {REQUEST_TYPE_LABELS[req.request_type as RequestType] || req.request_type} · {requesterNames.get(req.requester_id) || "알 수 없음"} · {formatDate(req.created_at)}
              </div>
              <div className="approval-reference-line text-[11px] text-[var(--text-dim)] mb-5">
                {Array.isArray(req.reference_user_ids) && req.reference_user_ids.length > 0
                  ? `참조: ${req.reference_user_ids.map((id: string) => referenceUserName(id)).join(", ")}`
                  : null}
              </div>

              {req.amount > 0 && (
                <div className="text-xl font-extrabold mono-number mb-4">{formatAmount(req.amount)}</div>
              )}

              {reqFormFields.length > 0 && (
                <div className="mb-4 pb-4 border-b border-[var(--border)]/60">
                  <FormFieldRows fields={reqFormFields} />
                </div>
              )}
              {reqContentText && (
                <DescriptionContent text={reqContentText} className="mb-2 text-sm text-[var(--text)] leading-8" />
              )}
              <AttachmentList attachments={req.attachments} />

              {/* 내 차례인 대기 건이면 여기서 바로 승인/반려 — 내 결재함과 동일 처리 경로(approveStep/rejectStep) */}
              {(() => {
                const myStep = req.status === "pending"
                  ? (expandedTimeline as any[]).find((st) => st.status === "pending" && st.approver_id === userId && st.stage === req.current_stage)
                  : null;
                if (!myStep) return null;
                return (
                  <div className="mt-6 pt-5 border-t border-[var(--border)]">
                    <label className="field-label">결재 의견 (반려 시 필수)</label>
                    <textarea
                      value={decisionComment}
                      onChange={(e) => setDecisionComment(e.target.value)}
                      rows={2}
                      placeholder="의견을 입력하세요..."
                      className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)] resize-none mb-4"
                    />
                    <div className="flex gap-2.5">
                      <button
                        onClick={() => {
                          if (!decisionComment.trim()) { toast("반려 사유를 입력하세요", "error"); return; }
                          decideRejectMut.mutate({ stepId: myStep.id, comment: decisionComment });
                        }}
                        disabled={decideRejectMut.isPending || decideApproveMut.isPending}
                        className="flex-1 py-3.5 rounded-full text-sm font-bold text-[var(--danger)] bg-[var(--danger-dim)] hover:opacity-90 disabled:opacity-50 transition"
                      >
                        {decideRejectMut.isPending ? "처리 중..." : "반려"}
                      </button>
                      <button
                        onClick={() => decideApproveMut.mutate({ stepId: myStep.id, comment: decisionComment || undefined })}
                        disabled={decideApproveMut.isPending || decideRejectMut.isPending}
                        className="flex-1 py-3.5 rounded-full text-sm font-bold text-white bg-[var(--success)] hover:opacity-90 disabled:opacity-50 transition inline-flex items-center justify-center gap-1.5"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7"/></svg>
                        {decideApproveMut.isPending ? "처리 중..." : "승인"}
                      </button>
                    </div>
                  </div>
                );
              })()}

              <div className="mt-6 pt-5 border-t border-[var(--border)]">
                <ApprovalTimelineView
                  requestId={req.id}
                  currentStage={req.current_stage}
                  totalStages={req.total_stages}
                  requestStatus={req.status}
                  currentUserId={userId}
                />
              </div>
              {/* 댓글 — 전체 현황 상세에는 스레드가 없어 참조 건 대화를 못 봤다 (2026-09-01 사장님:
                  "전체현황에서도 참조건에 댓글 보이도록"). 다른 탭과 같은 공용 스레드 그대로 */}
              <div className="mt-6 pt-5 border-t border-[var(--border)]">
                <ApprovalCommentThread requestId={req.id} />
              </div>
            </div>
          </div>
        );
      })()}
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
// Tab 5: 새 요청
// ══════════════════════════════════════════════

// 기간 필드 (2026-07-30 사장님 — 결재 양식에서 기간 설정): 값은 "시작 ~ 종료" 한 문자열로
//   customFieldValues 에 저장 — 상세/목록/PDF 등 기존 문자열 표시 경로가 그대로 통한다.
function PeriodFieldInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [start = "", end = ""] = (value || "").split("~").map((x) => x.trim());
  const emit = (ns: string, ne: string) => onChange(ns || ne ? `${ns} ~ ${ne}`.trim() : "");
  return (
    <div className="grid grid-cols-2 gap-2">
      <DateField value={start} onChange={(e) => emit(e.target.value, end)} className="field-input" />
      <DateField value={end} min={start || undefined} onChange={(e) => emit(start, e.target.value)} className="field-input" />
    </div>
  );
}

// 입력 필드 블록 — 고정 순서 렌더.
//   2026-07-30 재배치 기능(드래그·↑↓·localStorage 순서 저장)은 2026-08-20 사장님 지시로 제거:
//   "요청을 하는 사람은 입력필드의 위치를 변경하거나 옮기는게 안되게 해야돼".
// ── 드롭다운 '기타' 선택 시 내용 입력칸 (2026-08-20 사장님 요청) ────────────────────
//   양식 옵션에 '기타'(또는 그 외·직접입력)가 있으면, 그걸 고른 순간 옆에 내용 칸이 열린다.
//   저장 형식은 "기타: 실제내용" 한 문자열 — 목록·상세·PDF 등 기존 표시 경로가 그대로 통한다.
//   '기타'가 아닌 옵션은 예전과 완전히 같은 값으로 저장된다(호환 유지).
const isEtcOption = (o: string) => /^(기타|그\s*외|직접\s*입력)/.test((o || "").trim());

function SelectWithEtc({ value, options, onChange, placeholder = "선택" }: {
  value: string; options: string[]; onChange: (v: string) => void; placeholder?: string;
}) {
  const raw = value || "";
  const picked = options.find((o) => raw === o) || options.find((o) => isEtcOption(o) && raw.startsWith(o)) || "";
  const etc = !!picked && isEtcOption(picked);
  const detail = etc ? raw.slice(picked.length).replace(/^\s*[:：—-]\s*/, "") : "";
  //   '기타'를 고르면 **아래에 전체폭 입력칸**을 연다 (2026-09-01 사장님: 옆에 붙이면 field-input 의
  //   w-full 때문에 실낱같이 찌부러져 글씨가 안 써 보였다). 세로 스택이라 크기·위치 문제도 사라진다.
  return (
    <div className={etc ? "space-y-2" : ""}>
      <select
        value={picked}
        onChange={(e) => onChange(e.target.value)}
        className="field-input"
      >
        <option value="">{placeholder}</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      {etc && (
        <input
          type="text"
          value={detail}
          onChange={(e) => { const t = e.target.value; onChange(t.trim() ? `${picked}: ${t}` : picked); }}
          placeholder={`${picked} 내용을 직접 입력하세요`}
          className="field-input"
          autoFocus
        />
      )}
    </div>
  );
}

function FieldBlocks({ blocks }: { blocks: { key: string; node: React.ReactNode }[] }) {
  return (
    <>
      {blocks.map((b) => (
        <div key={b.key}>{b.node}</div>
      ))}
    </>
  );
}

function NewRequestTab({ companyId, userId, invalidate, onComplete, presetType }: {
  companyId: string; userId: string; invalidate: () => void; onComplete: () => void; presetType?: string | null;
}) {
  // 요청 유형 즐겨찾기 — 캐시로 즉시 그리고, 계정 저장값이 오면 덮는다 (2026-09-02 사장님)
  const [typeFavorites, setTypeFavorites] = useState<string[]>(() => (typeof window !== "undefined" && companyId ? readCachedFavorites(companyId) : []));
  //   화면이 뜨자마자 ★ 를 누르면 그 뒤 도착한 계정 로드값(옛 상태)이 방금 누른 것을 덮어썼다(2026-09-02 QA 실측).
  //   사용자가 한 번이라도 손대면 늦게 온 로드값은 버린다 — 저장은 토글 때마다 하니 계정값도 곧 같아진다.
  const typeFavTouched = useRef(false);
  useEffect(() => {
    if (!companyId) return;
    let alive = true;
    loadApprovalTypeFavorites(companyId).then((favs) => { if (alive && favs && !typeFavTouched.current) setTypeFavorites(favs); });
    return () => { alive = false; };
  }, [companyId]);
  const toggleTypeFavorite = (v: string) => {
    typeFavTouched.current = true;
    setTypeFavorites((prev) => {
      const next = prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v];
      void saveApprovalTypeFavorites(companyId, next);
      return next;
    });
  };
  // 휴가 유형은 회사 설정을 따른다 — 구성원 > 휴가 탭에서 이름·일수를 고치면 여기도 같이 바뀐다.
  //   queryKey 는 휴가 탭과 동일해 캐시를 공유한다. (2026-08-06)
  const { data: companyLeaveTypes = defaultCompanyLeaveTypes() } = useQuery({
    queryKey: ["company-leave-types", companyId],
    queryFn: () => getCompanyLeaveTypes(companyId),
    enabled: !!companyId,
  });
  const { toast } = useToast();
  // URL ?new=expense|payment|general 등 → presetType 으로 들어옴. 'leave' 도 지원.
  //   지정이 없으면 빈 값 — 유형을 고르기 전에는 유형 피커만 보인다 (2026-08-05 사장님:
  //   경비 청구가 선택된 것처럼 보이면서 상세 내용은 안 뜨고, 다른 유형을 눌렀다 돌아와야
  //   나오던 문제. 처음부터 고르게 하면 그 혼란이 사라진다).
  const initialType = (() => {
    if (presetType && presetType in REQUEST_TYPE_LABELS && presetType !== 'custom') return presetType as RequestType;   //   2026-08-19: 마이페이지에서 오는 certificate 등 모든 기본 유형
    return "" as const;
  })();
  const [form, setForm] = useState<{ requestType: RequestType | ""; title: string; amount: string; description: string }>({
    requestType: initialType,
    title: "",
    amount: "",
    description: "",
  });
  const typeChosen = !!form.requestType; // 유형을 고르기 전에는 아래 입력들을 감춘다
  // presetType 이 바뀌면 requestType 동기화 (대시보드에서 들어올 때)
  useEffect(() => {
    if (presetType && ((presetType in REQUEST_TYPE_LABELS && presetType !== 'custom') || presetType === 'general')) {
      const t = presetType === 'general' ? 'expense' : presetType;
      setForm(f => ({ ...f, requestType: t as RequestType }));
    }
  }, [presetType]);
  // Leave-specific fields
  const [leaveForm, setLeaveForm] = useState({
    leaveType: "annual",
    leaveUnit: "full_day",
    halfDayPeriod: "am" as "am" | "pm", // 반차 오전/오후 — 미저장 시 워크보드·지각 보정이 방향을 몰랐다 (2026-08-11)
    startDate: "",
    endDate: "",
    startTime: "",
    endTime: "",
    reason: "",
  });
  const [files, setFiles] = useState<File[]>([]);
  // 임시저장된 첨부 — File 은 localStorage 에 못 담아 임시저장 때 사라졌다(2026-08-20 사장님 제보).
  //   임시저장 시 스토리지에 올려 URL 로 보존하고, 제출 때 함께 붙인다.
  const [draftAttachmentUrls, setDraftAttachmentUrls] = useState<string[]>([]);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [descriptionInited, setDescriptionInited] = useState<string>("");
  const [selectedApprovers, setSelectedApprovers] = useState<{ userId: string; name: string }[]>([]);
  // 참조(CC) — 결재선과 별개로 결과를 통보만 받는 인원. 양식·정책 기본값을 프리필한 뒤 요청자가 가감할 수 있다.
  const [selectedReferences, setSelectedReferences] = useState<{ userId: string; name: string }[]>([]);
  const [referencesInited, setReferencesInited] = useState<string>("");
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, string>>({});
  // 부서-이름·기안일·결제요청일 자동 프리필 완료 표시 — 유형(양식) 전환 시 재실행 (2026-07-21 사장님 요청)
  const [autoFieldsInited, setAutoFieldsInited] = useState<string>("");
  // 상세 내용 서식 편집기(표 등) — tiptap 은 마운트 후 content prop 변경을 반영하지 않아
  //   템플릿 프리필/임시저장 복원/제출 초기화 때 ref 로 직접 setContent 한다.
  const descEditorRef = useRef<RichEditorRef>(null);
  // 양식 선택으로 자동 채운 제목 — 사용자가 직접 고친 제목과 구분하려고 들고 있는다.
  //   이게 없으면 양식을 바꿔도 처음 양식 이름이 제목에 그대로 남는다(2026-08-06 사장님 제보).
  const autoTitleRef = useRef<string>("");
  const { data: customForms = [] } = useQuery({ queryKey: ["approval-forms", companyId], queryFn: () => listApprovalForms(), enabled: !!companyId });
  const selectedForm = (customForms as ApprovalForm[]).find((f) => `form:${f.id}` === form.requestType) || null;
  const [draftLoaded, setDraftLoaded] = useState(false);

  useEffect(() => {
    if (draftLoaded || !companyId) return;
    // userId 포함 (2026-08-19 감사): 회사 단위 키는 공용 브라우저에서 남의 임시저장(휴가 사유 등)이 보였다
  const draftKey = `ov-approval-draft-${companyId}-${userId || "anon"}`;
    const saved = localStorage.getItem(draftKey);
    if (saved) {
      try {
        const draft = JSON.parse(saved);
        if (draft.form) {
          setForm(draft.form);
          // tiptap 은 마운트 후 content prop 을 안 따라감 — 임시저장 복원분을 에디터에 직접 주입
          if (draft.form.description) descEditorRef.current?.setContent(plainToHtml(draft.form.description));
        }
        if (draft.leaveForm) setLeaveForm({ halfDayPeriod: "am", ...draft.leaveForm }); // 구 임시저장엔 halfDayPeriod 가 없다
        if (Array.isArray(draft.attachmentUrls)) setDraftAttachmentUrls(draft.attachmentUrls);
      } catch { /* ignore corrupt draft */ }
    }
    setDraftLoaded(true);
  }, [companyId, draftLoaded]);

  const isLeave = form.requestType === "leave";
  // 초과근무는 승인되면 근태(퇴근시간 이후 출근 허용)로 이어지므로 날짜·종료시각을 구조화해서 받는다.
  //   (2026-08-20 사장님: 연장근무 탭을 없애고 결재로 일원화 — "승인되면 근태에 정확히 반영")
  const isOvertime = form.requestType === "overtime";
  const [overtimeForm, setOvertimeForm] = useState({ date: "", endTime: "" });

  // Fetch current user's employee record (이메일 매칭 → user_id 폴백)
  const { data: currentEmployee } = useQuery({
    queryKey: ["my-employee", companyId, userId],
    queryFn: async () => {
      const { data: user } = await db.from("users").select("email, name").eq("id", userId).maybeSingle();
      if (!user?.email) return null;
      // 이메일로 매칭
      //   work_end_time = 초과근무 종료시각 기본값(2026-08-20), position = 적용 대상 '직급' 매칭(2026-08-20)
      let { data: emp } = await db.from("employees").select("id, name, email, department, work_end_time, position").eq("company_id", companyId).eq("email", user.email).maybeSingle();
      // 이메일 실패 시 user_id로 폴백
      if (!emp) {
        const { data: empById } = await db.from("employees").select("id, name, email, department, work_end_time, position").eq("company_id", companyId).eq("user_id", userId).maybeSingle();
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
      const data = logRead('approvals/page:leave-balance', await db.from("leave_balances").select("total_days, used_days").eq("employee_id", currentEmployee!.id as string).eq("year", currentYear).maybeSingle());
      return data;
    },
    enabled: !!currentEmployee?.id,
  });

  const remainingLeave = leaveBalance ? Number(leaveBalance.total_days || 0) - Number(leaveBalance.used_days || 0) : null;

  // Calculate leave days
  // 근무일 기준 (2026-08-19 감사): 달력 일수는 금~월 휴가를 4일로 차감했다(실제 1일).
  const { data: leaveBizDays } = useQuery({
    queryKey: ["leave-days", companyId, leaveForm.startDate, leaveForm.endDate],
    enabled: !!companyId && !!leaveForm.startDate && leaveForm.leaveUnit === "full_day",
    queryFn: () => calcLeaveDays(companyId, leaveForm.startDate, leaveForm.endDate || leaveForm.startDate),
  });
  const leaveDays = leaveForm.leaveUnit === "half_day" ? 0.5
    : leaveForm.leaveUnit === "two_hours" ? 0.25
    : !leaveForm.startDate ? 0
    : (leaveBizDays ?? 0);

  // Auto-generate leave title
  const leaveTitle = useMemo(() => {
    const typeLabel = companyLeaveTypes.find((t) => t.value === leaveForm.leaveType)?.label || "휴가";
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
    const typeLabel = companyLeaveTypes.find((t) => t.value === leaveForm.leaveType)?.label || "";
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
      lines += `- 휴가 일자: ${startStr} (${leaveForm.halfDayPeriod === "pm" ? "오후" : "오전"} 반차)\n`;
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
      const data = logRead('approvals/page:members', await db.from("users").select("id, name, email, role, avatar_url").eq("company_id", companyId).order("name"));
      return (data || []).filter((u: any) => u.id !== userId);
    },
    enabled: !!companyId,
  });
  const approverAvatar = (uid: string) => (companyUsers as any[]).find((u) => u.id === uid)?.avatar_url || null;

  // Load policies for preview
  const { data: policies = [] } = useQuery({
    queryKey: ["approval-policies", companyId],
    queryFn: () => getApprovalPolicies(companyId),
    enabled: !!companyId,
  });

  // Find matching policy for preview — 직원 지정(복수) > 팀(부서) > 회사 공통 (2026-08-11 확장).
  //   createApprovalRequest 서버 매칭(pickPolicyForRequester)과 동일 규칙.
  const matchedPolicy = useMemo(() => {
    const active = policies.filter((p: ApprovalPolicy) => p.is_active);
    const dept = (currentEmployee as any)?.department || null;
    const pick = (docType: string) =>
      pickPolicyForRequester(active.filter((p: ApprovalPolicy) => p.document_type === docType), userId, dept);
    //   회사 양식 선택 시 requestType 은 "form:id" 라 정책 매칭이 항상 기본으로 빠졌다 (2026-09-01).
    //   서버(createApprovalRequest)는 양식 이름을 requestType 으로 받아 매칭하므로 미리보기도 이름으로 찾는다.
    return pick(selectedForm ? selectedForm.name : form.requestType) || pick("default");
  }, [policies, form.requestType, selectedForm, userId, currentEmployee]);

  // 그 결재선 안에서 나에게 적용되는 규칙 — 미리보기 단계·참조 프리필의 기준.
  //   createApprovalRequest 서버 매칭(pickRuleForRequester)과 같은 규칙이어야 화면과 실제가 안 어긋난다. (2026-08-20)
  const matchedRule = useMemo(() => {
    if (!matchedPolicy) return null;
    const rules = policyRules(matchedPolicy);
    const emp = currentEmployee as { department?: string; position?: string } | null | undefined;
    return pickRuleForRequester(rules, userId, emp?.department, emp?.position);
  }, [matchedPolicy, userId, currentEmployee]);
  // 미리보기·프리필에 쓸 실제 단계 — 규칙이 있으면 규칙 것, 없으면 결재선 기본.
  const matchedStages = (matchedRule?.stages?.length ? matchedRule.stages : (matchedPolicy?.stages as ApprovalStageConfig[])) || [];
  // 승인라인 변경 허용 여부 — 정책이 불허면 요청자는 승인자 지정 불가.
  const canEditLine = matchedPolicy?.allow_line_edit !== false;

  // 요청 유형 변경 시 설명란 자동 입력 — 정책의 설명 템플릿 우선, 없으면 내장 템플릿.
  useEffect(() => {
    if (isLeave || form.requestType.startsWith("form:") || form.requestType === descriptionInited) return;
    const tpl = plainToHtml(matchedPolicy?.description_template || DESCRIPTION_TEMPLATES[form.requestType as RequestType] || "");
    // 양식에서 일반 유형으로 옮겨 오면, 앞 양식이 자동으로 넣었던 제목은 지운다(직접 쓴 제목은 유지).
    //   ref 는 갱신 함수 밖에서 미리 읽는다 — 안에서 읽으면 이미 지워진 값과 비교하게 된다.
    const prevAutoTitle = autoTitleRef.current;
    autoTitleRef.current = "";
    setForm((prev) => ({
      ...prev,
      title: prev.title && prev.title === prevAutoTitle ? "" : prev.title,
      description: tpl,
    }));
    descEditorRef.current?.setContent(tpl);
    setDescriptionInited(form.requestType);
  }, [form.requestType, isLeave, descriptionInited, matchedPolicy]);

  // 커스텀 결재 양식 선택 시 — 제목·내용 템플릿 프리필 + 결재선을 승인자로 적용
  useEffect(() => {
    if (!selectedForm || descriptionInited === form.requestType) return;
    const tplHtml = plainToHtml(selectedForm.content_template || "");
    // ⚠️ 갱신 함수 안에서 ref 를 읽으면 안 된다 — 그 함수는 렌더 때 실행돼, 그 시점엔 ref 가
    //   이미 새 양식 이름으로 바뀌어 있다(비교가 항상 어긋나 제목이 첫 양식으로 굳던 원인).
    const prevAutoTitle = autoTitleRef.current;
    autoTitleRef.current = selectedForm.name;
    setForm((prev) => {
      // 비어 있거나 앞 양식이 자동으로 넣어 준 제목이면 새 양식 이름으로 교체.
      //   요청자가 직접 쓴 제목은 양식을 바꿔도 지우지 않는다.
      const keepUserTitle = !!prev.title && prev.title !== prevAutoTitle;
      return {
        ...prev,
        title: keepUserTitle ? prev.title : selectedForm.name,
        description: tplHtml,
      };
    });
    descEditorRef.current?.setContent(tplHtml);
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

  // 참조자 프리필 — 양식(우선) 또는 기본 유형 정책에 지정된 참조 인원을 칩으로 미리 채운다.
  //   기존엔 제출 시점에만 조용히 붙어 요청자가 누가 참조로 들어가는지 볼 수 없었다(2026-07-20).
  //   유형이 바뀔 때만 재프리필 — 이후 요청자가 지우거나 추가한 내용은 유지.
  useEffect(() => {
    // 구성원 목록 로딩 전에는 프리필하지 않는다 — 빈 배열로 확정돼 기본 참조자가 사라지는 것 방지.
    if (referencesInited === form.requestType || companyUsers.length === 0) return;
    // 2026-08-20: 결재선 참조는 '나에게 적용되는 규칙'의 참조를 쓴다(규칙 없는 옛 결재선은 종전과 동일).
    const defaults = selectedForm?.reference_user_ids?.length
      ? selectedForm.reference_user_ids
      : matchedRule?.reference_user_ids?.length
        ? matchedRule.reference_user_ids
        : matchedPolicy?.reference_user_ids?.length
          ? matchedPolicy.reference_user_ids
          : [];
    setSelectedReferences(
      defaults
        .map((rid: string) => (companyUsers as any[]).find((u) => u.id === rid))
        .filter(Boolean)
        .map((u: any) => ({ userId: u.id, name: u.name || u.email })),
    );
    setReferencesInited(form.requestType);
  }, [form.requestType, referencesInited, selectedForm, matchedPolicy, matchedRule, companyUsers]);

  // 2026-07-16: 기본 제공 유형에 정책 입력 필드가 있으면 — 유형 전환 시 고정값(fixed) 필드 프리필 +
  //   필드 없는 유형으로 바뀌면 이전 값 정리.
  useEffect(() => {
    if (selectedForm) return; // 커스텀 양식은 위 effect 가 처리
    const fields = matchedPolicy?.fields || [];
    if (fields.length === 0) { setCustomFieldValues({}); return; }
    const initFields: Record<string, string> = {};
    for (const fd of fields) if (fd.type === "fixed") initFields[fd.key] = fd.default_value || "";
    setCustomFieldValues(initFields);
  }, [selectedForm, matchedPolicy, form.requestType]);

  const effectiveDescription = isLeave ? leaveDescription : form.description;
  // 2026-07-16: 기본 제공 유형(경비청구 등)도 정책(matchedPolicy)에 입력 필드를 정의해두면
  //   커스텀 양식과 동일하게 필드를 보여준다. 휴가는 전용 구조화 입력(leaveForm)이 있어 제외.
  const activeFields = !isLeave ? (selectedForm?.fields || matchedPolicy?.fields || []) : [];
  // 광고비 지출결의서만: 업체명 필드 값을 제목 뒤에 붙인다 (2026-08-19 사장님: 어느 업체 건인지
  //   제목만으로 구분되게. "다른 건 건들지 말고 광고비지출결의서만"). 이미 제목에 들어 있으면 중복 방지.
  const vendorFieldVal = (() => {
    if (!String(selectedForm?.name || "").replace(/\s/g, "").includes("광고비지출결의서")) return "";
    const fd = (activeFields as any[]).find((f) => /업체명/.test(String(f?.label || "")));
    return fd ? String(customFieldValues[fd.key] || "").trim() : "";
  })();
  const effectiveTitle = isLeave
    ? leaveTitle
    : (vendorFieldVal && form.title.trim() && !form.title.includes(vendorFieldVal)
        ? `${form.title.trim()} — ${vendorFieldVal}`
        : form.title);
  // 커스텀 결재양식은 양식 자체 필드가 기준 — 일반 '금액' 입력은 숨기고(중복·혼란),
  //   양식(또는 기본 유형 정책)에 금액 타입 필드가 있으면 그 값을 결재 금액으로 사용, 없으면 금액 없는 결재(0).
  const formAmountField = activeFields.find((fd: any) => fd.type === "amount") || null;

  // 2026-07-21 사장님 요청 — 양식 필드 자동 프리필(수정 가능한 기본값):
  //   "부서-이름" 텍스트 필드 → 내 직원 정보의 부서 - 이름, 기안일·결제요청일 date 필드 → 오늘(KST).
  //   직원 정보 로딩이 끝난 뒤 1회만 실행, 이미 값이 있는 필드는 덮어쓰지 않는다.
  useEffect(() => {
    if (isLeave || activeFields.length === 0 || autoFieldsInited === form.requestType) return;
    if (currentEmployee === undefined) return; // 직원 정보 로딩 중 — 완료 후 실행
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
    const dept = (currentEmployee as { department?: string } | null)?.department || "";
    const empName = currentEmployee?.name || "";
    const updates: Record<string, string> = {};
    for (const fd of activeFields) {
      if (fd.type === "date" && /기안일|요청일/.test(fd.label)) updates[fd.key] = today;
      else if (fd.type === "text" && fd.label.includes("부서") && fd.label.includes("이름"))
        updates[fd.key] = dept && empName ? `${dept} - ${empName}` : empName || dept;
    }
    if (Object.keys(updates).length > 0) {
      setCustomFieldValues((s) => {
        const next = { ...s };
        for (const [k, v] of Object.entries(updates)) if (!next[k]) next[k] = v;
        return next;
      });
    }
    setAutoFieldsInited(form.requestType);
  }, [isLeave, activeFields, autoFieldsInited, form.requestType, currentEmployee]);
  // 금액은 양식의 '금액' 입력 필드에서만 온다 — 기본 금액 칸은 제거했다 (2026-08-20 사장님 지시).
  const effectiveAmount = isLeave ? 0
    : (activeFields.length > 0 && formAmountField)
      ? (Number(String(customFieldValues[formAmountField.key] ?? "").replace(/[^0-9.-]/g, "")) || 0)
      : 0;

  // 초과근무는 일자·종료시각이 그대로 근태로 넘어간다 — 둘 다 있어야 제출 (2026-08-20 사장님).
  const canSubmit = isLeave
    ? !!leaveForm.startDate && !!leaveForm.leaveType
    : isOvertime
      ? !!form.title.trim() && !!overtimeForm.date && !!overtimeForm.endTime
      : !!form.title.trim();

  // 종료시각 기본값은 본인이 설정한 퇴근시각 — 없으면 비워 두고 직접 고르게 한다(임의 시각 금지).
  const myWorkEnd = useMemo(() => {
    const m = String((currentEmployee as { work_end_time?: string } | null)?.work_end_time || "").match(/^([0-2]?\d):([0-5]\d)/);
    return m ? `${m[1].padStart(2, "0")}:${m[2]}` : "";
  }, [currentEmployee]);
  useEffect(() => {
    if (!isOvertime || overtimeForm.endTime || !myWorkEnd) return;
    setOvertimeForm((f) => ({ ...f, endTime: myWorkEnd }));
  }, [isOvertime, myWorkEnd, overtimeForm.endTime]);

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

      // 입력 필드(양식 필드) 값을 기본 템플릿 문구보다 위에 — 결재자가 실제 입력값을 먼저 보게 (2026-07-14)
      //   2026-07-16: 상세 내용이 리치에디터 HTML 이 되면서 필드 라인도 HTML <p> 로 병합
      //   (contentWithoutFieldLines 가 동일 규칙으로 중복 제거).
      let finalDesc: string;
      if (isLeave) {
        finalDesc = effectiveDescription;
      } else {
        const descHtml = isEmptyHtml(effectiveDescription) ? "" : plainToHtml(effectiveDescription);
        const fieldHtml = activeFields.map((fd) => `<p>${escapeHtmlText(`${fd.label}: ${customFieldValues[fd.key] || ""}`)}</p>`).join("");
        finalDesc = fieldHtml + descHtml;
      }
      // 반차 오전/오후 → 시간 산정 (직원탭 신청과 동일 규칙 computeHalfDaySlot) —
      //   시간이 leave_requests 에 저장돼야 워크보드 반차 게이지·지각 보정이 방향을 안다 (2026-08-11)
      let leaveTimes: { start_time?: string; end_time?: string } = {};
      if (isLeave && leaveForm.leaveUnit === "half_day") {
        const slot = await computeHalfDaySlot(companyId, leaveForm.halfDayPeriod);
        leaveTimes = { start_time: slot.start, end_time: slot.end };
      } else if (isLeave && leaveForm.leaveUnit === "two_hours" && leaveForm.startTime && leaveForm.endTime) {
        leaveTimes = { start_time: leaveForm.startTime, end_time: leaveForm.endTime };
      }
      return createApprovalRequest({
        companyId,
        requestType: selectedForm ? selectedForm.name : form.requestType,
        requesterId: userId,
        title: effectiveTitle,
        amount: effectiveAmount,
        description: finalDesc || undefined,
        attachments: draftAttachmentUrls.length + attachmentUrls.length > 0 ? [...draftAttachmentUrls, ...attachmentUrls] : undefined,
        customApprovers: (canEditLine && selectedApprovers.length > 0) ? selectedApprovers : undefined,
        formId: selectedForm?.id,
        // 휴가는 승인 시 연차 차감에 쓰이는 구조화 데이터를 저장(description 텍스트 파싱 의존 제거).
        //   기본 유형 정책 필드는 activeFields 로 커스텀 폼과 동일하게 customFieldValues 사용.
        //   구조화 값(휴가·초과근무)은 양식 필드가 있어도 **함께** 넣는다 — 종전엔 필드를 하나라도
        //   추가하면 customFieldValues 로 통째로 덮여 일자·종료시각이 사라졌고, 근태 반영도 끊겼다
        //   (2026-08-21 감사). 입력칸은 필수로 막아 놓고 값은 안 저장하던 상태.
        customFields: (() => {
          const structured: Record<string, unknown> = {};
          if (isLeave) {
            structured.leave = { leave_type: leaveForm.leaveType, leave_unit: leaveForm.leaveUnit, start_date: leaveForm.startDate, end_date: leaveForm.endDate || leaveForm.startDate, days: leaveDays, ...leaveTimes };
          }
          if (isOvertime && overtimeForm.date) {
            structured.overtime = { date: overtimeForm.date, end_time: overtimeForm.endTime };
          }
          const merged = { ...(activeFields.length > 0 ? customFieldValues : {}), ...structured };
          return Object.keys(merged).length > 0 ? merged : undefined;
        })(),
        // 참조: 요청자가 화면에서 지정한 인원(양식·정책 기본값이 프리필돼 있고 가감 가능)
        referenceUserIds: selectedReferences.length > 0 ? selectedReferences.map((r) => r.userId) : undefined,
      });
    },
    onSuccess: () => {
      invalidate();
      setForm({ requestType: "", title: "", amount: "", description: "" }); // 제출 후에도 유형 선택 화면으로
      descEditorRef.current?.setContent("");
      setLeaveForm({ leaveType: "annual", leaveUnit: "full_day", halfDayPeriod: "am", startDate: "", endDate: "", startTime: "", endTime: "", reason: "" });
      setFiles([]);
      setDraftAttachmentUrls([]);
      setSelectedApprovers([]); setCustomFieldValues({});
      setSelectedReferences([]); setReferencesInited("");
      setDescriptionInited("");
      localStorage.removeItem(`ov-approval-draft-${companyId}-${userId || "anon"}`);
      localStorage.removeItem(`ov-approval-draft-${companyId}`);   // 구 키 정리 (2026-08-19 이전 저장분)
      onComplete();
    },
    onError: (err: any) => toast("결재 요청 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Form */}
      <div className="approval-new-request-form">
        <div className="glass-card p-6">
          <h3 className="text-sm font-bold mb-5">새 결재 요청</h3>

          <div className="space-y-4">
            {/* Request Type — 한 줄 고르기(누르면 아래로 목록) — 2026-08-18 사장님. 예전 아이콘 칩 격자는 버튼이 너무 많았다 */}
            {(() => {
              // 2026-07-16 QA: "정책 관리"에서 기본 유형(경비청구 등)에 지정한 "양식 표시 이름"이
              //   여기(새 요청 유형 피커)에 반영 안 되던 버그 — 매칭 정책의 label 을 우선 사용.
              const builtin: PickOpt[] = Object.entries(REQUEST_TYPE_LABELS).map(([k, v]) => {
                const m = typeMeta(k);
                const matchedPolicy = (policies as ApprovalPolicy[]).find((p) => p.is_active && p.document_type === k && isCompanyWidePolicy(p)) || (policies as ApprovalPolicy[]).find((p) => p.is_active && p.document_type === k);
                return { value: k, label: matchedPolicy?.label || v, icon: <span className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${m.bg} ${m.text}`}><TypeIcon name={m.icon} className="w-3.5 h-3.5" /></span> };
              });
              //   회사 결재 양식은 요청 유형 목록에 합친다 (2026-08-18 사장님). 기본 유형에 연결된 양식(base_type)은
              //   그 유형 자리에 대신 들어가고(경비 청구를 고르면 회사 양식이 나온다), 연결 없는 양식은 뒤에 '회사 양식'으로.
              const activeForms = (customForms as ApprovalForm[]);
              const formIcon = <span className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0 bg-[var(--primary)]/12 text-[var(--primary)]"><TypeIcon name="layout" className="w-3.5 h-3.5" /></span>;
              // 관리자가 만든 커스텀 정책 유형 — 내장 유형/기본 제외.
              //   2026-09-01 사장님: 같은 이름의 회사 양식이 있으면(예: '경조휴가' 결재선 + '경조휴가' 양식)
              //   목록에 두 개로 떠서 헷갈렸다 — 양식 제출은 requestType=양식 이름이라 그 결재선과 자동
              //   매칭되므로, 동명이면 **양식 항목 하나만** 보여 준다(입력 필드도 양식 쪽에 있다).
              const formByName = new Map(activeForms.filter((f) => !f.base_type).map((f) => [f.name.trim(), f]));
              const mergedIntoForm = new Set<string>();
              const custom: PickOpt[] = (policies as ApprovalPolicy[])
                .filter((p) => p.is_active && p.document_type !== "default" && p.document_type !== "line" && !(p.document_type in REQUEST_TYPE_LABELS))
                .map((p) => {
                  const nm = (p.label || p.name).trim();
                  const f = formByName.get(nm) || formByName.get(String(p.document_type).trim());
                  if (f) { mergedIntoForm.add(f.id); return { value: `form:${f.id}`, label: nm, sub: "회사 양식", icon: formIcon }; }
                  return { value: p.document_type, label: p.label || p.name, icon: <span className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${TYPE_FALLBACK.bg} ${TYPE_FALLBACK.text}`}><TypeIcon name="doc" className="w-3.5 h-3.5" /></span> };
                });
              const merged: PickOpt[] = [];
              for (const b of builtin) {
                const linked = activeForms.filter((f) => f.base_type === b.value);
                if (linked.length === 0) { merged.push(b); continue; }
                linked.forEach((f) => merged.push({ value: `form:${f.id}`, label: b.label, sub: `회사 양식 · ${f.name}`, icon: b.icon }));
              }
              merged.push(...custom);
              activeForms.filter((f) => (!f.base_type || !(f.base_type in REQUEST_TYPE_LABELS)) && !mergedIntoForm.has(f.id)).forEach((f) => merged.push({ value: `form:${f.id}`, label: f.name, sub: f.category ? `회사 양식 · ${f.category}` : "회사 양식", icon: formIcon }));
              return (
                <div className="ap-pick-row">
                  <label className="field-label">요청 유형 *</label>
                  <TypePicker value={String(form.requestType || "")} options={merged} placeholder="유형을 고르세요 — 경비 청구 · 결제 요청 · 휴가 신청 · 회사 양식 …"
                    onChange={(v) => setForm({ ...form, requestType: v as RequestType })}
                    favorites={typeFavorites} onToggleFavorite={toggleTypeFavorite} />
                  {/* 즐겨찾기 칩 — 목록을 열지 않고 한 번에 고른다. 지워진 양식 값은 목록에 없으므로 자연히 빠진다. */}
                  {(() => {
                    const favs = typeFavorites.map((v) => merged.find((o) => o.value === v)).filter((o): o is PickOpt => !!o);
                    if (favs.length === 0) return null;
                    return (
                      <div className="ap-fav-row" aria-label="즐겨찾기 유형">
                        <span className="ap-fav-cap">★ 즐겨찾기</span>
                        {favs.map((o) => (
                          <button key={o.value} type="button" className={String(form.requestType || "") === o.value ? "qk-quick qk-quick-on" : "qk-quick"}
                            onClick={() => setForm({ ...form, requestType: o.value as RequestType })} title={o.sub ? `${o.label} · ${o.sub}` : o.label}>
                            {o.label}
                          </button>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              );
            })()}

            {/* 유형 선택 전 — 아래 입력을 감추고 안내만 (2026-08-05 사장님) */}
            {!typeChosen && (
              <div className="approval-type-empty-hint">
                위에서 <b>요청 유형</b>을 먼저 선택하세요. 유형을 고르면 제목·내용·결재선 입력이 나타납니다.
              </div>
            )}

            {/* ── Leave-specific fields ── */}
            {!typeChosen ? null : isLeave ? (
              <>
                {/* Leave balance info */}
                {leaveForm.leaveType === "annual" && (
                  <div className="approval-leave-balance-card">
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

                {/* 휴가 입력 블록 — 순서 고정 (2026-08-20 사장님: 요청자는 필드 이동 불가) */}
                <FieldBlocks
                  blocks={[
                    {
                      key: "leave-type-unit",
                      node: (
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs text-[var(--text-muted)] mb-1">휴가 유형 *</label>
                            <select
                              value={leaveForm.leaveType}
                              onChange={(e) => setLeaveForm({ ...leaveForm, leaveType: e.target.value })}
                              className="field-input"
                            >
                              {companyLeaveTypes.map((t) => (
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
                      ),
                    },
                    {
                      key: "leave-dates",
                      node: (
                        <div className="space-y-4">
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
                          {leaveForm.leaveUnit === "half_day" && (
                            <div>
                              <label className="block text-xs text-[var(--text-muted)] mb-1">반차 시간대</label>
                              <div className="flex gap-1">
                                {([
                                  { v: "am" as const, label: "오전 반차" },
                                  { v: "pm" as const, label: "오후 반차" },
                                ]).map((opt) => (
                                  <button
                                    key={opt.v}
                                    type="button"
                                    onClick={() => setLeaveForm({ ...leaveForm, halfDayPeriod: opt.v })}
                                    className={`flex-1 px-2 py-2.5 rounded-xl text-xs font-semibold border transition ${
                                      leaveForm.halfDayPeriod === opt.v
                                        ? "border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)]"
                                        : "border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]"
                                    }`}
                                  >
                                    {opt.label}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
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
                          {leaveForm.startDate && (
                            <div className="flex items-center gap-2 px-3 py-2 bg-[var(--bg-surface)] rounded-lg">
                              <span className="text-xs text-[var(--text-muted)]">사용 일수:</span>
                              <span className="text-sm font-bold text-[var(--primary)]">{leaveDays}일</span>
                              {remainingLeave !== null && leaveDays > remainingLeave && leaveForm.leaveType === "annual" && (
                                <span className="text-xs text-red-500 font-semibold ml-2">잔여 연차 초과</span>
                              )}
                            </div>
                          )}
                        </div>
                      ),
                    },
                    {
                      key: "leave-title",
                      node: (
                        <div>
                          <label className="block text-xs text-[var(--text-muted)] mb-1">제목 (자동 생성)</label>
                          <div className="px-3 py-2.5 bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl text-sm text-[var(--text)]">
                            {leaveTitle || "날짜를 선택하면 자동으로 생성됩니다"}
                          </div>
                        </div>
                      ),
                    },
                    {
                      key: "leave-reason",
                      node: (
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
                      ),
                    },
                  ]}
                />
              </>
            ) : (
              /* ── Non-leave fields — 순서 고정 (2026-08-20 사장님: 요청자는 필드 이동 불가) ── */
              <>
              {isOvertime && (
                <div className="mb-4 p-3 rounded-xl bg-[var(--bg-surface)] space-y-3">
                  <div className="text-xs font-bold text-[var(--text-muted)]">근태 반영 정보</div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-[var(--text-muted)] mb-1">초과근무 일자 *</label>
                      <DateField value={overtimeForm.date} onChange={(e) => setOvertimeForm({ ...overtimeForm, date: e.target.value })} className="field-input" />
                    </div>
                    <div>
                      <label className="block text-xs text-[var(--text-muted)] mb-1">종료 예정 시각 *</label>
                      <input type="time" value={overtimeForm.endTime} onChange={(e) => setOvertimeForm({ ...overtimeForm, endTime: e.target.value })} className="field-input" />
                    </div>
                  </div>
                  <div className="text-[11px] text-[var(--text-dim)]">
                    승인되면 여기 적은 날짜·시각 그대로 근태에 반영됩니다 — 퇴근시간 이후 출근이 이 시각까지 허용됩니다.
                    {myWorkEnd && <> 기본값은 내 퇴근시각({myWorkEnd})이며 필요한 만큼 늦춰 잡으세요.</>}
                  </div>
                </div>
              )}
              <FieldBlocks
                blocks={[
                  {
                    key: "title",
                    node: (
                      <div>
                        <label className="block text-xs text-[var(--text-muted)] mb-1">제목 *</label>
                        <input
                          value={form.title}
                          onChange={(e) => setForm({ ...form, title: e.target.value })}
                          placeholder="결재 요청 제목을 입력하세요"
                          className="field-input"
                        />
                      </div>
                    ),
                  },
                  // 금액 칸은 없앴다 (2026-08-20 사장님 지시) — 금액 없는 결재에도 항상 떠 있어
                  //   0 으로 둬야 하는 게 불편했다. 금액이 필요한 결재는 양식의 '금액' 입력 필드로 받는다.
                  //   (effectiveAmount 는 그 필드값에서 뽑는다 — 아래 activeFields 참조)
                  ...activeFields.map((fd) => ({
                    key: `cf:${fd.key}`,
                    node: (
                      <div key={fd.key}>
                        <label className="block text-xs text-[var(--text-muted)] mb-1">{fd.label}{fd.required ? " *" : ""}</label>
                        {fd.type === "textarea" ? (
                          <textarea value={customFieldValues[fd.key] || ""} onChange={(e) => setCustomFieldValues((s) => ({ ...s, [fd.key]: e.target.value }))} rows={2} className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm" />
                        ) : fd.type === "select" ? (
                          <SelectWithEtc
                            value={customFieldValues[fd.key] || ""}
                            options={fd.options || []}
                            onChange={(v) => setCustomFieldValues((s) => ({ ...s, [fd.key]: v }))}
                          />
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
                        ) : fd.type === "period" ? (
                          <PeriodFieldInput value={customFieldValues[fd.key] || ""} onChange={(v) => setCustomFieldValues((s) => ({ ...s, [fd.key]: v }))} />
                        ) : (
                          <input type={fd.type === "number" ? "number" : "text"} value={customFieldValues[fd.key] || ""} onChange={(e) => setCustomFieldValues((s) => ({ ...s, [fd.key]: e.target.value }))} className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm" />
                        )}
                      </div>
                    ),
                  })),
                  {
                    key: "description",
                    node: (
                      // Description with template — 2026-07-16: 표·서식 지원 리치에디터 (사장님 요청)
                      <div>
                        <label className="block text-xs text-[var(--text-muted)] mb-1">상세 내용</label>
                        {/* 표는 한글(HWP) 문서 서식 그대로 — .approval-desc-editor 스코프에서 globals.css 가 적용 (2026-07-27) */}
                        <div className="approval-desc-editor">
                          <RichEditor
                            ref={descEditorRef}
                            content={form.description}
                            onChange={(html) => setForm((prev) => ({ ...prev, description: html }))}
                            placeholder="결재 요청에 대한 상세 설명을 입력하세요..."
                            maxHeight="320px"
                          />
                        </div>
                      </div>
                    ),
                  },
                ]}
              />
              </>
            )}

            {typeChosen && (<>
            {/* File upload — 드롭존 스타일. 2026-07-21 사장님 요청으로 승인자/참조자 위로 이동 */}
            <div className="approval-file-upload">
              <label className="field-label">첨부파일</label>
              <label
                className={`flex flex-col items-center justify-center gap-1.5 px-4 py-6 rounded-xl border-2 border-dashed transition cursor-pointer ${
                  isDraggingFile
                    ? "border-[var(--primary)] bg-[var(--primary)]/8"
                    : "border-[var(--border)] bg-[var(--bg)]/50 hover:border-[var(--primary)]/50 hover:bg-[var(--primary)]/4"
                }`}
                onDragOver={(e) => { e.preventDefault(); setIsDraggingFile(true); }}
                onDragLeave={(e) => {
                  // 자식 요소(아이콘·텍스트)로 이동할 때 깜빡이지 않게 — 진짜 영역 밖으로 나갈 때만 해제
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDraggingFile(false);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDraggingFile(false);
                  const dropped = Array.from(e.dataTransfer.files || []);
                  if (dropped.length > 0) setFiles(prev => [...prev, ...dropped]);
                }}
              >
                <svg className="w-6 h-6 text-[var(--text-dim)]" fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                <span className="text-xs font-semibold text-[var(--text-muted)]">{isDraggingFile ? "여기에 놓아서 첨부" : "클릭하거나 파일을 끌어다 첨부"}</span>
                <span className="text-[10px] text-[var(--text-dim)]">여러 개 선택 가능</span>
                <input
                  type="file"
                  multiple
                  onChange={(e) => {
                    // 드래그로 넣은 파일이 클릭 첨부 시 사라지지 않게 교체 대신 추가
                    const picked = Array.from(e.target.files || []);
                    if (picked.length > 0) setFiles(prev => [...prev, ...picked]);
                    e.target.value = "";
                  }}
                  className="hidden"
                />
              </label>
              {draftAttachmentUrls.length > 0 && (
                <div className="mt-2 space-y-1.5">
                  {draftAttachmentUrls.map((url, i) => (
                    <div key={url} className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-[var(--bg-surface)] text-xs">
                      <span className="w-7 h-7 rounded-lg bg-[var(--success)]/12 text-[var(--success)] flex items-center justify-center shrink-0">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>
                      </span>
                      <span className="truncate flex-1 font-medium text-[var(--text)]">{attachmentFileName(url)}</span>
                      <span className="text-[10px] text-[var(--text-dim)] shrink-0">임시저장됨</span>
                      <button type="button" onClick={() => setDraftAttachmentUrls(prev => prev.filter((_, idx) => idx !== i))} className="text-[var(--text-dim)] hover:text-[var(--danger)] font-bold px-1 transition">✕</button>
                    </div>
                  ))}
                </div>
              )}
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

            {/* Approver Selection — 정책이 승인라인 변경을 불허하면 잠금 안내 */}
            {!canEditLine ? (
            <div>
              <label className="field-label">승인자 지정</label>
              <p className="text-[11px] text-[var(--text-dim)] px-3 py-2.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)]">이 양식은 결재 정책의 승인라인을 그대로 사용합니다 (요청자 변경 불가).</p>
            </div>
            ) : (
            <div className="approval-approver-picker">
              <label className="field-label">승인자 지정 (선택)</label>
              <div className="space-y-2">
                {selectedApprovers.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {selectedApprovers.map((a, idx) => (
                      <div key={idx} className="flex items-center gap-1.5">
                        <div className="inline-flex items-center gap-2 pl-1.5 pr-2 py-1.5 rounded-full bg-[var(--primary)]/8 border border-[var(--primary)]/25">
                          <Avatar name={a.name} src={approverAvatar(a.userId)} size={22} />
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

            {/* Reference(CC) Selection — 결재선과 무관하게 결과를 통보받는 인원. 승인라인 잠금과 무관하게 항상 지정 가능 */}
            <div className="approval-reference-picker">
              <label className="field-label">참조자 지정 (선택)</label>
              <div className="space-y-2">
                {selectedReferences.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {selectedReferences.map((r, idx) => (
                      <div key={r.userId} className="inline-flex items-center gap-2 pl-1.5 pr-2 py-1.5 rounded-full bg-[var(--bg-surface)] border border-[var(--border)]">
                        <Avatar name={r.name} src={approverAvatar(r.userId)} size={22} />
                        <span className="text-xs font-bold text-[var(--text)]">{r.name}</span>
                        <span className="text-[10px] font-bold text-[var(--text-dim)]">참조</span>
                        <button
                          onClick={() => setSelectedReferences((prev) => prev.filter((_, i) => i !== idx))}
                          className="w-4 h-4 rounded-full flex items-center justify-center text-[var(--text-dim)] hover:text-[var(--danger)] hover:bg-[var(--danger-dim)] transition"
                          aria-label="참조자 삭제"
                        >
                          <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {companyUsers.length > 0 && (
                  <select
                    value=""
                    onChange={(e) => {
                      const u = companyUsers.find((u: any) => u.id === e.target.value);
                      if (u && !selectedReferences.some((r) => r.userId === u.id)) {
                        setSelectedReferences((prev) => [...prev, { userId: u.id, name: u.name || u.email }]);
                      }
                    }}
                    className="field-input"
                  >
                    <option value="">+ 참조자 추가</option>
                    {companyUsers
                      .filter((u: any) => !selectedReferences.some((r) => r.userId === u.id) && !selectedApprovers.some((a) => a.userId === u.id))
                      .map((u: any) => (
                        <option key={u.id} value={u.id}>{u.name || u.email} ({u.role})</option>
                      ))}
                  </select>
                )}
                <p className="text-[11px] text-[var(--text-dim)]">
                  {selectedReferences.length === 0
                    ? "참조자는 결재에 참여하지 않고 요청·결과 알림만 받습니다"
                    : "승인자로 지정된 인원은 목록에서 제외됩니다"}
                </p>
              </div>
            </div>
            </>)}

          </div>

          {typeChosen && (
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
              onClick={async () => {
                // userId 포함 (2026-08-19 감사): 회사 단위 키는 공용 브라우저에서 남의 임시저장(휴가 사유 등)이 보였다
                const draftKey = `ov-approval-draft-${companyId}-${userId || "anon"}`;
                // 첨부도 보존 (2026-08-20 사장님: 끌어놓은 첨부가 임시저장하면 사라졌다) —
                //   File 은 localStorage 에 못 담으므로 지금 업로드해 URL 로 남긴다.
                const urls = [...draftAttachmentUrls];
                const failed: string[] = [];
                for (const file of files) {
                  const path = `approvals/${companyId}/${Date.now()}_${toBase64Url(file.name)}`;
                  const { error } = await supabase.storage.from("documents").upload(path, file);
                  if (!error) urls.push(supabase.storage.from("documents").getPublicUrl(path).data.publicUrl);
                  else failed.push(file.name);
                }
                if (failed.length > 0) toast(`첨부 저장 실패 — ${failed.join(", ")}`, "error");
                setDraftAttachmentUrls(urls);
                setFiles([]);
                const draft = { form, leaveForm, description: form.description, attachmentUrls: urls };
                localStorage.setItem(draftKey, JSON.stringify(draft));
                toast(urls.length > 0 ? `임시저장되었습니다 — 첨부 ${urls.length}개 포함` : "임시저장되었습니다", "success");
              }}
              className="btn-secondary"
            >
              임시저장
            </button>
            <button
              type="button"
              onClick={() => {
                // 초기화하면 유형 선택 전 상태로 되돌린다 (경비 청구로 되돌아가지 않음)
                setForm({ requestType: "", title: "", amount: "", description: "" });
                setDescriptionInited("");
                setLeaveForm({ leaveType: "annual", leaveUnit: "full_day", halfDayPeriod: "am", startDate: "", endDate: "", startTime: "", endTime: "", reason: "" });
                setFiles([]);
                // 임시저장 때 이미 스토리지에 올린 첨부는 여기서 같이 지운다 — 안 지우면
                //   아무 화면에서도 안 보이는 고아 파일로 남는다 (2026-08-20 감사).
                void (async () => {
                  for (const url of draftAttachmentUrls) {
                    const m = url.match(/\/object\/(?:public|sign|authenticated)\/documents\/([^?]+)/);
                    if (m) await supabase.storage.from("documents").remove([decodeURIComponent(m[1])]).catch(() => {});
                  }
                })();
                setDraftAttachmentUrls([]);
                setSelectedApprovers([]);
                setSelectedReferences([]); setReferencesInited("");
                localStorage.removeItem(`ov-approval-draft-${companyId}-${userId || "anon"}`);
      localStorage.removeItem(`ov-approval-draft-${companyId}`);   // 구 키 정리 (2026-08-19 이전 저장분)
              }}
              className="px-4 py-2.5 text-[var(--text-dim)] text-sm hover:text-red-400 transition"
            >
              초기화
            </button>
          </div>
          )}

          {createMut.isError && (
            <div className="mt-3 text-xs text-red-500">
              오류: {(createMut.error as Error)?.message || "요청 제출에 실패했습니다."}
            </div>
          )}
        </div>
      </div>

      {/* Right sidebar */}
      {/* 유형을 골라야 결재선이 정해지므로, 고르기 전에는 오른쪽 미리보기도 감춘다 */}
      <div className="approval-new-request-sidebar">
        {!typeChosen && (
          <div className="approval-policy-preview glass-card text-xs text-[var(--text-muted)]">
            요청 유형을 선택하면 이 요청에 적용될 <b>결재선</b>이 여기에 표시됩니다.
          </div>
        )}
        {/* Auto-generated document preview (leave) */}
        {typeChosen && isLeave && leaveForm.startDate && (
          <div className="approval-document-preview glass-card">
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
        {typeChosen && (
        <div className="approval-policy-preview glass-card">
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
                {matchedStages.map((stage, idx) => (
                  <div key={idx} className="relative pl-8 pb-4 last:pb-0">
                    {idx < matchedStages.length - 1 && (
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
                <div className="kpi-callout success mt-3">이 금액은 <b>자동 승인</b> 대상입니다</div>
              )}
            </div>
          ) : selectedApprovers.length > 0 ? (
            /* 직원 QA #11 — 양식 결재선이 지정돼 있으면 그걸 미리보기에 반영(대표/CEO 강제 표시 제거).
               실제 라우팅은 이미 customApprovers(양식 결재선)로 처리됨 — 미리보기만 정합화. */
            <div className="text-xs text-[var(--text-muted)]">
              <div className="kpi-callout mb-4">이 양식의 <b>결재선</b>이 적용됩니다 — 지정한 승인자에서 종료(대표 결재 없음)</div>
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
              <div className="kpi-callout mb-4">매칭 정책이 없어 <b>기본 결재선(1단계)</b>이 적용됩니다</div>
              <div className="relative pl-8">
                <div className="absolute left-0 top-0 w-[26px] h-[26px] rounded-full border-2 border-[var(--primary)]/40 bg-[var(--primary)]/8 flex items-center justify-center text-[11px] font-extrabold text-[var(--primary)]">
                  1
                </div>
                <div className="text-xs font-bold pt-1 text-[var(--text)]">최종 승인</div>
                <div className="text-[11px] text-[var(--text-dim)]">승인자: CEO</div>
              </div>
            </div>
          )}

          {/* 참조 — 결재선 아래에 통보 대상 요약(요청 상세 사이드바의 '참조' 블록과 동일 표기) */}
          {selectedReferences.length > 0 && (
            <div className="approval-preview-references mt-4 pt-4 border-t border-[var(--border)]">
              <div className="text-[11px] font-bold text-[var(--text-dim)] uppercase tracking-wider mb-2">참조</div>
              <div className="flex flex-wrap gap-1.5">
                {selectedReferences.map((r) => (
                  <span key={r.userId} className="inline-flex items-center gap-1.5 pl-1 pr-2 py-1 rounded-full bg-[var(--bg-surface)] border border-[var(--border)] text-[11px] font-medium text-[var(--text-muted)]">
                    <Avatar name={r.name} src={approverAvatar(r.userId)} size={18} />
                    {r.name}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════
// Tab 6: 정책 관리 (Admin)
// ══════════════════════════════════════════════

// 결재선 폼에서 편집 중인 규칙 한 줄 — 저장 시 ApprovalPolicyRule 로 접힌다. (2026-08-20)
//   mode 별로 쓰는 칸이 다르지만(users→userIds, department→department, position→position)
//   모드를 오갈 때 값이 날아가지 않게 draft 는 네 칸을 다 들고 있는다.
type RuleDraft = {
  key: string;
  mode: PolicyRuleTargetMode;
  userIds: string[];
  department: string;
  position: string;
  stages: ApprovalStageConfig[];
  referenceIds: string[];
};

let ruleKeySeq = 0;
function newRuleDraft(mode: PolicyRuleTargetMode): RuleDraft {
  return {
    key: `rule-${++ruleKeySeq}`,
    mode,
    userIds: [],
    department: "",
    position: "",
    stages: [{ stage: 1, name: "팀장 승인", approver_role: "manager" }],
    referenceIds: [],
  };
}

const RULE_MODE_LABELS: Record<PolicyRuleTargetMode, string> = {
  all: "회사 전체",
  users: "특정 직원",
  department: "팀 (부서)",
  position: "직급",
};

/** 목록 표에 적는 적용 대상 한 줄. (2026-08-20) */
function ruleTargetText(rule: ApprovalPolicyRule, orgUsers: { id: string; name: string | null; email: string }[]): string {
  const t = rule.target;
  if (t.mode === "department") return `${t.department} 팀`;
  if (t.mode === "position") return `${t.position} 직급`;
  if (t.mode === "users") {
    const names = (t.userIds || []).map((id) => { const u = orgUsers.find((x) => x.id === id); return u?.name || u?.email || "?"; });
    if (names.length === 0) return "—";
    return `${names.slice(0, 2).join("·")}${names.length > 2 ? ` 외 ${names.length - 2}명` : ""}`;
  }
  return "그 외 전체";
}

/** 폼 draft → 저장 형태. 단계 번호·이름을 여기서 정규화한다(빈 이름은 'N차 승인'). (2026-08-20) */
function draftsToRules(drafts: RuleDraft[]): ApprovalPolicyRule[] {
  return drafts.map((d) => ({
    id: d.key,
    target:
      d.mode === "users" ? { mode: "users" as const, userIds: d.userIds }
      : d.mode === "department" ? { mode: "department" as const, department: d.department.trim() }
      : d.mode === "position" ? { mode: "position" as const, position: d.position.trim() }
      : { mode: "all" as const },
    stages: d.stages.map((st, si) => ({ ...st, stage: si + 1, name: (st.name || "").trim() || `${si + 1}차 승인` })),
    reference_user_ids: d.referenceIds,
  }));
}

/** 저장 형태 → 폼 draft. '회사 전체' 규칙은 항상 마지막에 하나 있도록 보정한다. (2026-08-20) */
function rulesToDrafts(rules: ApprovalPolicyRule[]): RuleDraft[] {
  const drafts = rules.map((r) => ({
    key: `rule-${++ruleKeySeq}`,
    mode: r.target?.mode || "all",
    userIds: r.target?.userIds || [],
    department: r.target?.department || "",
    position: r.target?.position || "",
    stages: r.stages?.length ? r.stages : [{ stage: 1, name: "팀장 승인", approver_role: "manager" }],
    referenceIds: r.reference_user_ids || [],
  })) as RuleDraft[];
  const others = drafts.filter((d) => d.mode !== "all");
  const fallback = drafts.find((d) => d.mode === "all") || newRuleDraft("all");
  return [...others, fallback];
}

function PoliciesTab({ companyId, invalidate }: { companyId: string; invalidate: () => void }) {
  const [pq, setPq] = useState("");
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
    // 적용 대상별 규칙 (2026-08-20 사장님: "적용대상을 여러개 생성하고 그 대상마다 각각의
    //   누구한테결재받나·참조를 하나의 결재선에서 관리") — 한 결재선 안에 [대상 → 단계 → 참조] N개.
    //   종전엔 대상 1묶음 + 단계 1세트 + 참조 1세트라 사람마다 결재선을 따로 만들어야 했다.
    //   맨 아래 '회사 전체' 규칙은 항상 있고 지울 수 없다(어느 규칙에도 안 걸리는 요청자의 몫).
    rules: [newRuleDraft("all")] as RuleDraft[],
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
      const data = logRead('approvals/page:members-role', await db.from("users").select("id, name, email, role").eq("company_id", companyId).order("name"));
      return (data || []) as { id: string; name: string | null; email: string; role: string }[];
    },
    enabled: !!companyId,
  });

  // 회사가 만든 양식 — '적용 양식' 선택지 (2026-08-19 사장님: 우리가 만든 양식도 결재선에 나오게).
  //   커스텀 양식으로 올린 요청의 request_type 은 양식 이름이므로, document_type = 양식 이름이면 자동 매칭된다.
  const { data: companyForms = [] } = useQuery({
    queryKey: ["approval-forms-for-policies", companyId],
    queryFn: () => listApprovalForms(),
    enabled: !!companyId,
  });

  // 팀(부서) 단위 적용 대상 선택지 — employees.department 고유값 (2026-08-11)
  const { data: departments = [] } = useQuery({
    queryKey: ["policy-departments", companyId],
    queryFn: async () => {
      const data = logRead('approvals/page:departments', await db.from("employees").select("department").eq("company_id", companyId).not("department", "is", null));
      return [...new Set((data || []).map((r: { department: string | null }) => String(r.department || "").trim()).filter(Boolean))].sort() as string[];
    },
    enabled: !!companyId,
  });

  // 직급 단위 적용 대상 선택지 — employees.position 고유값 (2026-08-20).
  //   ⚠️ users.role(마스터/멤버/파트너)이 아니라 인사기록의 직급이다 — 팀장·사원 같은 직책 개념은 여기에만 있다.
  const { data: positions = [] } = useQuery({
    queryKey: ["policy-positions", companyId],
    queryFn: async () => {
      const data = logRead('approvals/page:positions', await db.from("employees").select("position").eq("company_id", companyId).not("position", "is", null));
      return [...new Set((data || []).map((r: { position: string | null }) => String(r.position || "").trim()).filter(Boolean))].sort() as string[];
    },
    enabled: !!companyId,
  });

  const upsertMut = useMutation({
    mutationFn: () => {
      const rules = draftsToRules(form.rules);
      // 규칙을 쓰는 결재선은 정책 자체가 회사 전체에 걸리고(대상 칸 null), 누구에게 갈지는 규칙이 가른다.
      //   그래야 pickPolicyForRequester 가 이 결재선을 '회사 공통'으로 집어 규칙 매칭까지 도달한다. (2026-08-20)
      const fallback = rules.find((r) => r.target.mode === "all") || rules[0];
      return upsertApprovalPolicy({
        id: editingPolicy?.id,
        company_id: companyId,
        name: form.name,
        document_type: form.documentType === "__custom__" ? (form.customType.trim() || "custom") : form.documentType,
        label: form.label.trim() || undefined,
        description_template: form.descriptionTemplate.trim() || undefined,
        rules,
        // 아래 세 칸은 규칙을 못 읽는 옛 경로(요청 상세·PDF 등)를 위한 거울 — '회사 전체' 규칙을 복사해 둔다.
        stages: fallback.stages,
        reference_user_ids: fallback.reference_user_ids,
        auto_approve_below: Number(form.autoApproveBelow) || 0,
        allow_line_edit: form.allowLineEdit,
        requester_id: null,
        requester_ids: null,
        requester_department: null,
        is_active: true,
      });
    },
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
      documentType: "line",
      customType: "",
      label: "",
      descriptionTemplate: "",
      autoApproveBelow: "",
      allowLineEdit: true,
      rules: [newRuleDraft("all")],
    });
  }

  function startEdit(policy: ApprovalPolicy) {
    setEditingPolicy(policy);
    const isBuiltin = policy.document_type === "default" || policy.document_type in REQUEST_TYPE_LABELS;
    setForm({
      name: policy.name,
      documentType: policy.document_type,
      customType: isBuiltin ? "" : policy.document_type,
      label: policy.label || "",
      descriptionTemplate: policy.description_template || "",
      autoApproveBelow: policy.auto_approve_below ? String(policy.auto_approve_below) : "",
      allowLineEdit: policy.allow_line_edit !== false,
      // 개편 전 결재선은 policyRules() 가 기존 대상·단계·참조를 규칙 1개로 돌려준다 — 열면 그대로 보인다.
      rules: rulesToDrafts(policyRules(policy)),
    });
    setShowForm(true);
  }

  // ── 규칙(적용 대상 묶음) 조작 ───────────────────────────────
  function patchRule(idx: number, patch: Partial<RuleDraft>) {
    setForm((st) => ({ ...st, rules: st.rules.map((r, i) => (i === idx ? { ...r, ...patch } : r)) }));
  }
  function addRule() {
    // 새 규칙은 '회사 전체'(맨 아래 기본 규칙) 바로 앞에 끼워 넣는다 — 기본 규칙은 항상 마지막.
    setForm((st) => ({ ...st, rules: [...st.rules.slice(0, -1), newRuleDraft("users"), st.rules[st.rules.length - 1]] }));
  }
  function removeRule(idx: number) {
    setForm((st) => (st.rules[idx]?.mode === "all" ? st : { ...st, rules: st.rules.filter((_, i) => i !== idx) }));
  }

  // ── 규칙 안의 결재 단계 조작 ─────────────────────────────────
  //   단계 수를 고르면 그 수에 맞춰 늘리고 줄인다 (2026-08-18 사장님: "몇 단계인지 설정하고 누구한테")
  function setStageCount(ruleIdx: number, n: number) {
    const cur = form.rules[ruleIdx].stages;
    const next = Array.from({ length: n }, (_, i) => cur[i] || { stage: i + 1, name: `${i + 1}차 승인`, approver_role: "manager" } as ApprovalStageConfig).map((st, i) => ({ ...st, stage: i + 1 }));
    patchRule(ruleIdx, { stages: next });
  }

  function updateStage(ruleIdx: number, idx: number, patch: Partial<ApprovalStageConfig>) {
    patchRule(ruleIdx, { stages: form.rules[ruleIdx].stages.map((st, i) => (i === idx ? { ...st, ...patch } : st)) });
  }

  function toggleRuleUser(ruleIdx: number, userId: string) {
    const cur = form.rules[ruleIdx].userIds;
    patchRule(ruleIdx, { userIds: cur.includes(userId) ? cur.filter((id) => id !== userId) : [...cur, userId] });
  }

  function toggleRuleReference(ruleIdx: number, userId: string) {
    const cur = form.rules[ruleIdx].referenceIds;
    patchRule(ruleIdx, { referenceIds: cur.includes(userId) ? cur.filter((id) => id !== userId) : [...cur, userId] });
  }

  useModalKeys(showForm, () => { if (!upsertMut.isPending) resetForm(); });

  // 대상을 안 고른 규칙은 저장해도 아무에게도 안 걸린다 — 조용히 새지 않게 저장을 막고 이유를 적는다. (2026-08-20)
  const ruleError = (() => {
    for (const r of form.rules) {
      if (r.mode === "users" && r.userIds.length === 0) return "'특정 직원' 적용 대상에 직원을 한 명 이상 고르세요.";
      if (r.mode === "department" && !r.department.trim()) return "'팀 (부서)' 적용 대상에 부서를 고르세요.";
      if (r.mode === "position" && !r.position.trim()) return "'직급' 적용 대상에 직급을 고르세요.";
    }
    return "";
  })();

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

  //   2026-08-18 조회 표준 — 카드 격자 → 조회 줄(빠른검색 ‖ + 정책 추가) + 표(공용 머리단)
  const visiblePolicies = (policies as ApprovalPolicy[]).filter((p) => quickSearchHit(pq, [p.name, p.label, p.document_type === "line" ? "결재선" : REQUEST_TYPE_LABELS[p.document_type as RequestType] || p.document_type]));
  const approverLabel = (st: ApprovalStageConfig) => (st as any).approver_id
    ? ((st as any).approver_name || orgUsers.find((u) => u.id === (st as any).approver_id)?.name || "구성원")
    : (ROLE_OPTIONS.find((r) => r.value === st.approver_role)?.label || st.approver_role || "");

  return (
    <div className="ap-list">
      <QueryBar right={<button onClick={() => { resetForm(); setShowForm(true); }} className="btn-primary btn-sm whitespace-nowrap">+ 결재선 추가</button>}>
        <QuickSearch value={pq} onApply={setPq} placeholder="결재선 이름 — 쉼표로 여러 개, Enter" />
        <span className="text-[11px] text-[var(--text-dim)]">결재선 = 몇 단계로 누구에게 결재받고 누구를 참조할지. 양식 관리에서 양식에 붙여 씁니다.</span>
      </QueryBar>

      {/* 결재선 폼 — 이름 · 단계 수 · 단계별 승인자 · 참조 · (선택) 적용 대상 (2026-08-18 사장님: 유형·자동승인·설명 템플릿 제거) */}
      {/* 결재선 폼은 팝업 — 목록 줄이 밀리지 않게 (2026-08-18 사장님) */}
      {showForm && (
        <div className="approval-detail-modal" onClick={() => !upsertMut.isPending && resetForm()}>
        <div className="approval-policy-form ap-pol-modal" onClick={(e) => e.stopPropagation()}>
          <div className="ap-pol-head">
            <h3 className="section-title">{editingPolicy ? "결재선 수정" : "새 결재선"}</h3>
          </div>

          <div className="ap-pol-grid">
            <div>
              <label className="field-label">결재선 이름 *</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="예: 팀장 → 대표 2단계" className="field-input" />
            </div>
            {/* 적용 양식 (2026-08-19 사장님) — 유형을 고르면 그 유형의 새 요청에 자동 적용된다.
                종전엔 이 칸이 없어 새 결재선이 전부 '공용'으로 만들어졌고, 부서 대상 결재선이
                휴가신청에 자동 적용되지 않는 사고(전략운영팀 휴가)가 났다. */}
            <div>
              <label className="field-label">적용 양식</label>
              <select value={form.documentType} onChange={(e) => setForm({ ...form, documentType: e.target.value })} className="field-input">
                <option value="line">공용 — 양식 관리에서 불러와 사용</option>
                <optgroup label="기본 양식">
                  {Object.entries(REQUEST_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </optgroup>
                {(companyForms as ApprovalForm[]).length > 0 && (
                  <optgroup label="회사 양식">
                    {(companyForms as ApprovalForm[]).map((f) => <option key={f.id} value={f.name}>{f.name}</option>)}
                  </optgroup>
                )}
                {form.documentType === "default" && <option value="default">기본(공통)</option>}
                {/* 삭제(비활성)된 양식 이름으로 남은 정책 — 옵션이 없으면 셀렉트가 빈 값으로 보인다 */}
                {form.documentType !== "line" && form.documentType !== "default"
                  && !(form.documentType in REQUEST_TYPE_LABELS)
                  && !(companyForms as ApprovalForm[]).some((f) => f.name === form.documentType) && (
                  <option value={form.documentType}>{form.documentType} (삭제된 양식)</option>
                )}
              </select>
            </div>
          </div>
          <p className="mt-1.5 text-[10px] text-[var(--text-dim)]">
            {form.documentType === "line"
              ? "공용 결재선은 자동 적용되지 않습니다 — 양식 관리 > 편집에서 불러와 붙일 때만 쓰입니다."
              : "선택한 양식의 새 요청에 자동 적용됩니다 — 요청자에게 맞는 적용 대상의 결재선이 쓰입니다."}
          </p>

          {/* 적용 대상별 규칙 — [대상 → 누구에게 결재받나 → 참조] 묶음을 필요한 만큼 (2026-08-20 사장님) */}
          <div className="ap-pol-rules">
            <div className="ap-pol-rules-head">
              <label className="field-label">적용 대상별 결재선</label>
              <button type="button" onClick={addRule} className="btn-secondary btn-sm">+ 적용 대상 추가</button>
            </div>
            <p className="ap-pol-rules-hint">
              위에서부터 먼저 맞는 대상이 적용됩니다 — 특정 직원 &gt; 팀 &gt; 직급 &gt; 회사 전체.
            </p>

            <div className="ap-pol-rule-list">
            {form.rules.map((rule, ruleIdx) => (
              <div key={rule.key} className={`ap-pol-rule ${rule.mode === "all" ? "ap-pol-rule-fallback" : ""}`}>
                <div className="ap-pol-rule-head">
                  {rule.mode === "all" ? (
                    <span className="ap-pol-rule-title">그 외 전체 (기본)</span>
                  ) : (
                    <select value={rule.mode}
                      onChange={(e) => patchRule(ruleIdx, { mode: e.target.value as PolicyRuleTargetMode })}
                      className="field-input ap-pol-rule-mode">
                      {(["users", "department", "position"] as PolicyRuleTargetMode[]).map((m) => (
                        <option key={m} value={m}>{RULE_MODE_LABELS[m]}</option>
                      ))}
                    </select>
                  )}
                  {rule.mode !== "all" && (
                    <button type="button" onClick={() => removeRule(ruleIdx)} className="ap-pol-rule-del" aria-label="이 적용 대상 삭제">&#10005;</button>
                  )}
                </div>

                {/* 대상 지정 — 모드별로 칸이 다르다 */}
                {rule.mode === "users" && (
                  <div className="policy-target-people">
                    {orgUsers.map((u) => (
                      <button key={u.id} type="button" onClick={() => toggleRuleUser(ruleIdx, u.id)}
                        className={`policy-target-chip ${rule.userIds.includes(u.id) ? "policy-target-chip-on" : ""}`}>{u.name || u.email}</button>
                    ))}
                  </div>
                )}
                {rule.mode === "department" && (
                  departments.length > 0 ? (
                    <select value={rule.department} onChange={(e) => patchRule(ruleIdx, { department: e.target.value })} className="field-input ap-pol-rule-pick">
                      <option value="">부서 선택</option>
                      {departments.map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>
                  ) : (
                    <p className="ap-pol-rule-warn">등록된 부서가 없습니다 — 구성원 화면에서 직원의 부서를 먼저 입력하세요.</p>
                  )
                )}
                {rule.mode === "position" && (
                  positions.length > 0 ? (
                    <select value={rule.position} onChange={(e) => patchRule(ruleIdx, { position: e.target.value })} className="field-input ap-pol-rule-pick">
                      <option value="">직급 선택</option>
                      {positions.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  ) : (
                    <p className="ap-pol-rule-warn">등록된 직급이 없습니다 — 구성원 화면에서 직원의 직급을 먼저 입력하세요.</p>
                  )
                )}

                {/* 이 대상의 결재 단계 — 한 줄에 [N차] 단계 이름 · 누구에게(역할 또는 구성원) */}
                <div className="ap-pol-stages">
                  <div className="ap-pol-stages-head">
                    <label className="field-label">누구에게 결재받나</label>
                    <select value={rule.stages.length} onChange={(e) => setStageCount(ruleIdx, Number(e.target.value))} className="field-input ap-pol-stage-count">
                      {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}단계</option>)}
                    </select>
                  </div>
                  {rule.stages.map((stage, idx) => (
                    <div key={idx} className="ap-pol-stage">
                      <span className="ap-pol-stage-no">{stage.stage}차</span>
                      <input value={stage.name} onChange={(e) => updateStage(ruleIdx, idx, { name: e.target.value })} placeholder={`${stage.stage}차 승인`} className="field-input ap-pol-stage-name" />
                      <select
                        value={stage.approver_id ? `u:${stage.approver_id}` : `r:${stage.approver_role || "manager"}`}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v.startsWith("u:")) {
                            const u = orgUsers.find((x) => x.id === v.slice(2));
                            updateStage(ruleIdx, idx, { approver_id: v.slice(2), approver_name: u?.name || u?.email || "" });
                          } else {
                            updateStage(ruleIdx, idx, { approver_id: undefined, approver_name: undefined, approver_role: v.slice(2) });
                          }
                        }}
                        className="field-input ap-pol-stage-who">
                        <optgroup label="역할로">
                          {ROLE_OPTIONS.map((r) => <option key={r.value} value={`r:${r.value}`}>{r.label}</option>)}
                        </optgroup>
                        <optgroup label="특정 구성원">
                          {orgUsers.map((u) => <option key={u.id} value={`u:${u.id}`}>{u.name || u.email}</option>)}
                        </optgroup>
                      </select>
                    </div>
                  ))}
                </div>

                {/* 이 대상의 참조 — 결재선과 별개로 결과를 통보받는 사람 */}
                <div className="ap-pol-rule-refs">
                  <label className="field-label">참조 <span className="text-[var(--text-dim)] font-normal">(선택 · 여러 명)</span></label>
                  <div className="policy-target-people">
                    {orgUsers.map((u) => (
                      <button key={u.id} type="button" onClick={() => toggleRuleReference(ruleIdx, u.id)}
                        className={`policy-target-chip ${rule.referenceIds.includes(u.id) ? "policy-target-chip-on" : ""}`}>{u.name || u.email}</button>
                    ))}
                  </div>
                </div>
              </div>
            ))}
            </div>
          </div>

          {ruleError && <p className="ap-pol-rule-warn mt-3">{ruleError}</p>}
          <div className="flex gap-2 mt-4">
            <button
              onClick={() => (form.name || "").trim() && !ruleError && upsertMut.mutate()}
              disabled={!(form.name || "").trim() || !!ruleError || upsertMut.isPending}
              className="btn-primary btn-sm disabled:opacity-50">
              {upsertMut.isPending ? "저장 중..." : editingPolicy ? "수정" : "저장"}
            </button>
            <button onClick={resetForm} className="btn-secondary btn-sm">취소</button>
          </div>
        </div>
        </div>
      )}

      {/* Policy List — 표 (2026-08-18) */}
      {policies.length === 0 && !showForm ? (
        <div className="ap-empty">
          <div className="mx-auto w-16 h-16 mb-4 rounded-2xl bg-[var(--primary-light)] text-[var(--primary)] flex items-center justify-center">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="19" r="3"/><circle cx="18" cy="5" r="3"/><path d="M12 19h4.5a3.5 3.5 0 000-7h-9a3.5 3.5 0 010-7H12"/></svg>
          </div>
          <div className="text-base font-bold mb-1.5">등록된 결재선이 없습니다</div>
          <div className="text-sm text-[var(--text-muted)] mb-5">결재선을 만들어 두면 양식 관리에서 양식에 붙일 수 있습니다</div>
          <button onClick={() => { resetForm(); setShowForm(true); }} className="btn-primary btn-sm">+ 결재선 추가</button>
        </div>
      ) : (
        <div className="ev-scroll">
          <table className="ev-table ev-lined ap-policy-table">
            <thead><tr><th>결재선</th><th>단계 · 승인자</th><th>참조</th><th>적용 대상</th><th>상태</th><th>관리</th></tr></thead>
            <tbody>
              {/* 결재선 한 줄이 아니라 '적용 대상 한 줄' — 이름·상태·관리는 rowSpan 으로 묶는다. (2026-08-20) */}
              {visiblePolicies.flatMap((policy: ApprovalPolicy) => {
                const m = typeMeta(policy.document_type);
                const rules = policyRules(policy);
                return rules.map((rule, ruleIdx) => (
                  <tr key={`${policy.id}-${rule.id}`}>
                    {ruleIdx === 0 && (
                      <td className="text-left" rowSpan={rules.length}>
                        <span className="inline-flex items-center gap-2">
                          <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${m.bg} ${m.text}`}><TypeIcon name={policy.document_type === "line" ? "route" : m.icon} className="w-3.5 h-3.5" /></span>
                          <span className="min-w-0">
                            <span className="block font-semibold">{policy.name}</span>
                            {policy.document_type !== "line" && <span className="block text-[10px] text-[var(--text-dim)]">{REQUEST_TYPE_LABELS[policy.document_type as RequestType] || policy.document_type} 유형에 자동 적용</span>}
                            {rules.length > 1 && <span className="block text-[10px] text-[var(--text-dim)]">적용 대상 {rules.length}개</span>}
                          </span>
                        </span>
                      </td>
                    )}
                    <td className="text-left">
                      <span className="inline-flex items-center gap-1 flex-wrap">
                        {rule.stages.map((stage, idx) => (
                          <span key={idx} className="inline-flex items-center gap-1">
                            <span className="ap-stage-pill" title={stage.name}><b>{stage.stage}</b>{approverLabel(stage)}</span>
                            {idx < rule.stages.length - 1 && <span className="text-[var(--text-dim)]">›</span>}
                          </span>
                        ))}
                      </span>
                    </td>
                    <td className="text-center text-[var(--text-muted)]">
                      {rule.reference_user_ids.length > 0
                        ? rule.reference_user_ids.map((id) => { const u = orgUsers.find((x) => x.id === id); return u?.name || u?.email || "?"; }).join(", ")
                        : "—"}
                    </td>
                    <td className="text-center text-[var(--text-muted)]">{ruleTargetText(rule, orgUsers)}</td>
                    {ruleIdx === 0 && (
                      <td className="text-center" rowSpan={rules.length}>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${policy.is_active ? "bg-[var(--success-dim)] text-[var(--success)]" : "bg-[var(--bg-surface)] text-[var(--text-dim)]"}`}>
                          {policy.is_active ? "활성" : "비활성"}
                        </span>
                      </td>
                    )}
                    {ruleIdx === 0 && (
                      <td className="text-center" rowSpan={rules.length}>
                        <span className="inline-flex gap-1">
                          <button onClick={() => startEdit(policy)} className="btn-secondary btn-sm">수정</button>
                          <button onClick={async () => { if (await appConfirm("이 정책을 삭제하시겠습니까?", { danger: true })) deleteMut.mutate(policy.id); }} disabled={deleteMut.isPending} className="btn-secondary btn-sm text-[var(--danger)] disabled:opacity-50">삭제</button>
                        </span>
                      </td>
                    )}
                  </tr>
                ));
              })}
              {visiblePolicies.length === 0 && <tr><td colSpan={6} className="ap-empty text-xs text-[var(--text-muted)]">이 조건에 맞는 정책이 없습니다</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════
// Approval Timeline Component
// ══════════════════════════════════════════════

function ApprovalTimelineView({ requestId, currentStage, totalStages, requestStatus, currentUserId }: {
  requestId: string;
  currentStage: number;
  totalStages: number;
  requestStatus: string;
  currentUserId?: string | null;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [editingStepId, setEditingStepId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const { data: timeline = [], isLoading } = useQuery({
    queryKey: ["approval-timeline", requestId],
    queryFn: () => getApprovalTimeline(requestId),
    enabled: !!requestId,
  });
  const avatarMap = useAvatarMap(timeline.map((s: any) => s.approver_id));

  // 승인자 변경 (2026-08-04 사장님: 결재 올린 뒤에도 승인자를 바꿀 수 있게) —
  //   마스터/전체 현황 권한자만, 대기(pending) 단계만. 서버(reassign_approval_step RPC)가
  //   회사·권한·상태·새 승인자(같은 회사, 파트너 제외)를 재검증한다.
  const [tlCompanyId, setTlCompanyId] = useState<string | null>(null);
  useEffect(() => { getCurrentUser().then((u) => u && setTlCompanyId(u.company_id)).catch(() => {}); }, []);
  const { isMaster: tlMaster, hasPerm: tlHasPerm } = useMyPermissions();
  const canReassign = (tlMaster || tlHasPerm("/approvals:all")) && requestStatus === "pending";
  const [reassignStepId, setReassignStepId] = useState<string | null>(null);
  const [reassignTo, setReassignTo] = useState("");
  const { data: tlMembers = [] } = useQuery({
    queryKey: ["approval-members-for-reassign", tlCompanyId],
    queryFn: async () => {
      const data = logRead('approvals/page:tl-members', await (supabase).from("users")
        .select("id, name, email, avatar_url, role").eq("company_id", tlCompanyId!));
      return data || [];
    },
    enabled: !!tlCompanyId && canReassign,
  });
  const reassignMut = useMutation({
    mutationFn: async ({ stepId, newApproverId }: { stepId: string; newApproverId: string }) => {
      const { error } = await (supabase as any).rpc("reassign_approval_step", {
        p_step_id: stepId, p_new_approver_id: newApproverId,
      });
      if (error) throw error;
      // 새 승인자 알림 — 기존 결재 요청 알림과 같은 type/entity 라 클릭 시 내 결재함으로 이동.
      //   notifications INSERT 트리거가 웹푸시까지 자동 발송. 알림 실패는 변경 자체를 막지 않는다.
      try {
        const reqRow = logRead('approvals/page:reassign-title', await (supabase)
          .from("approval_requests").select("title, amount, request_type").eq("id", requestId).maybeSingle());
        if (tlCompanyId) {
          await createNotification({
            companyId: tlCompanyId,
            userId: newApproverId,
            type: "approval_request",
            title: `결재 요청: ${(reqRow as any)?.title || "결재 건"}`,
            message: "승인자로 지정되었습니다 — 내 결재함에서 확인하세요.",
            entityType: "approval_request",
            entityId: requestId,
          });
          // 메일도 함께 (2026-08-06) — 설정에서 끈 사람은 내부에서 걸러진다
          await sendApprovalMails({
            userIds: [newApproverId],
            kind: "reassigned",
            title: (reqRow as any)?.title || "결재 건",
            requestId,
            amount: Number((reqRow as any)?.amount || 0),
            requestType: (reqRow as any)?.request_type || "approval",
          });
        }
      } catch { /* 알림 실패는 표시만 못 할 뿐 — 변경은 이미 완료 */ }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["approval-timeline", requestId] });
      qc.invalidateQueries({ queryKey: ["activity-timeline", requestId] });
      qc.invalidateQueries({ queryKey: ["my-pending-approvals"] });
      qc.invalidateQueries({ queryKey: ["my-pending-approvals"] });
      qc.invalidateQueries({ queryKey: ["all-requests"] });
      setReassignStepId(null);
      setReassignTo("");
      toast("승인자를 변경했습니다", "success");
      window.dispatchEvent(new Event("sidebar-refresh-badges"));
    },
    onError: (e: any) => toast(friendlyError(e, "승인자 변경 실패"), "error"),
  });

  async function saveComment(stepId: string) {
    try {
      await updateApprovalStepComment(stepId, editText.trim());
      qc.invalidateQueries({ queryKey: ["approval-timeline", requestId] });
      setEditingStepId(null);
    } catch (e: any) {
      toast(friendlyError(e, "코멘트 수정 실패"), "error");
    }
  }

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
    <div className="approval-timeline-view">
      <div className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-4">결재 타임라인</div>

      {/* Horizontal stage stepper */}
      <div className="approval-timeline-stepper overflow-x-auto">
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
        {timeline.map((step) => {
          const canEdit = !!currentUserId && step.approver_id === currentUserId && !!step.decided_at;
          const isEditing = editingStepId === step.id;
          const isReassigning = reassignStepId === step.id;
          return (
            <div key={step.id} className="flex items-start gap-3 text-xs">
              <Avatar name={step.approver_name || "담당자"} src={avatarMap[step.approver_id]} size={26} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold">{step.approver_name || "담당자"}</span>
                  <span className="text-[var(--text-dim)]">{step.stage_name}</span>
                  <StatusBadge status={step.status} />
                  {canEdit && !isEditing && (
                    <button
                      onClick={() => { setEditingStepId(step.id); setEditText(step.comment || ""); }}
                      className="text-[10px] font-semibold text-[var(--primary)] hover:underline"
                    >
                      코멘트 {step.comment ? "수정" : "추가"}
                    </button>
                  )}
                  {canReassign && step.status === "pending" && !isReassigning && (
                    <button
                      onClick={() => { setReassignStepId(step.id); setReassignTo(""); }}
                      className="text-[10px] font-semibold text-[var(--primary)] hover:underline"
                    >
                      승인자 변경
                    </button>
                  )}
                </div>
                {isReassigning && (
                  <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                    <select
                      value={reassignTo}
                      onChange={(e) => setReassignTo(e.target.value)}
                      autoFocus
                      className="px-2.5 py-1.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] text-xs text-[var(--text)] focus:outline-none focus:border-[var(--primary)]"
                    >
                      <option value="">새 승인자 선택...</option>
                      {(tlMembers as any[])
                        .filter((m) => m.role !== "partner" && m.id !== step.approver_id)
                        .map((m) => (
                          <option key={m.id} value={m.id}>{m.name || m.email}</option>
                        ))}
                    </select>
                    <button
                      onClick={() => reassignTo && reassignMut.mutate({ stepId: step.id, newApproverId: reassignTo })}
                      disabled={!reassignTo || reassignMut.isPending}
                      className="px-2.5 py-1.5 text-[10px] font-semibold text-white bg-[var(--primary)] hover:bg-[var(--primary-hover)] rounded-lg transition disabled:opacity-50"
                    >
                      {reassignMut.isPending ? "변경 중..." : "변경"}
                    </button>
                    <button
                      onClick={() => { setReassignStepId(null); setReassignTo(""); }}
                      className="px-2 py-1.5 text-[10px] font-semibold text-[var(--text-dim)] hover:text-[var(--text)] transition"
                    >
                      취소
                    </button>
                  </div>
                )}
                {isEditing ? (
                  <div className="mt-1.5">
                    <textarea
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      rows={2}
                      autoFocus
                      className="w-full px-3 py-2 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl text-xs focus:outline-none focus:border-[var(--primary)] resize-none"
                    />
                    <div className="flex gap-2 mt-1.5">
                      <button onClick={() => setEditingStepId(null)} className="px-2.5 py-1 text-[10px] font-semibold text-[var(--text-dim)] hover:text-[var(--text)] transition">취소</button>
                      <button onClick={() => saveComment(step.id)} className="px-2.5 py-1 text-[10px] font-semibold text-white bg-[var(--primary)] hover:bg-[var(--primary-hover)] rounded-lg transition">저장</button>
                    </div>
                  </div>
                ) : step.comment ? (
                  <div className="mt-1.5 inline-block px-3 py-2 rounded-xl rounded-tl-sm bg-[var(--bg-surface)] text-[var(--text-muted)] whitespace-pre-wrap">{step.comment}</div>
                ) : null}
              </div>
              <div className="text-[var(--text-dim)] shrink-0 mono-number">
                {step.decided_at ? formatDateTime(step.decided_at) : "대기 중"}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── 결재 댓글 스레드 (공용) — 승인/반려 후에도 대화 (approval_comments, 2026-07-10)
//   2026-07-30 사장님: 관리자 화면(전체 현황)에만 있어 직원은 댓글을 못 달았다 →
//   '내 요청' 상세에도 부착(본인 요청 건 한정), 사진·파일 첨부 지원.
function ApprovalCommentThread({ requestId }: { requestId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [commentText, setCommentText] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [posting, setPosting] = useState(false);
  const [me, setMe] = useState<{ id: string; company_id: string } | null>(null);
  useEffect(() => { getCurrentUser().then((u) => u && setMe({ id: u.id, company_id: u.company_id })).catch(() => {}); }, []);
  const { data: comments = [] } = useQuery({
    queryKey: ["approval-comments", requestId],
    queryFn: async () => {
      const data = logRead('approvals/page:comments', await (supabase)
        .from("approval_comments")
        .select("id, user_id, body, attachments, created_at, users:user_id(name, email, avatar_url)")
        .eq("request_id", requestId)
        .order("created_at", { ascending: true }));
      return (data || []) as any[];
    },
    enabled: !!requestId,
  });
  const isImageUrl = (url: string) => /\.(png|jpe?g|gif|webp|heic|bmp)$/i.test(attachmentFileName(url));
  const postComment = async () => {
    if (!me || (!commentText.trim() && pendingFiles.length === 0) || posting) return;
    setPosting(true);
    try {
      const urls: string[] = [];
      for (const file of pendingFiles) {
        const path = `approvals/${me.company_id}/comments/${Date.now()}_${toBase64Url(file.name)}`;
        const { error } = await supabase.storage.from("documents").upload(path, file);
        if (error) { toast(`첨부 업로드 실패 — ${file.name}: ${error.message}`, "error"); return; }
        const { data: urlData } = supabase.storage.from("documents").getPublicUrl(path);
        urls.push(urlData.publicUrl);
      }
      // attachments 컬럼은 2026-07-30 마이그레이션 추가분 — database.ts 타입 재생성 전까지 캐스팅
      const { error } = await (supabase).from("approval_comments").insert({
        company_id: me.company_id, request_id: requestId, user_id: me.id, body: commentText.trim(), attachments: urls,
      } as any);
      if (error) { toast("댓글 등록 실패: " + error.message, "error"); return; }
      setCommentText(""); setPendingFiles([]);
      qc.invalidateQueries({ queryKey: ["approval-comments", requestId] });
    } finally { setPosting(false); }
  };
  const deleteComment = async (id: string) => {
    // 첨부도 같이 지운다 (2026-08-20 감사): 종전엔 행만 지워 파일이 스토리지에 영구히 남았다.
    const target = (comments as any[]).find((c) => c.id === id);
    const { error } = await (supabase).from("approval_comments").delete().eq("id", id);
    if (error) { toast("댓글 삭제 실패: " + friendlyError(error, "알 수 없는 오류"), "error"); return; }
    for (const url of (target?.attachments || []) as string[]) {
      const m = String(url).match(/\/object\/(?:public|sign|authenticated)\/documents\/([^?]+)/);
      if (m) await supabase.storage.from("documents").remove([decodeURIComponent(m[1])]).catch(() => {});
    }
    qc.invalidateQueries({ queryKey: ["approval-comments", requestId] });
  };
  return (
    <div className="approval-comment-thread">
      <div className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">댓글 {comments.length > 0 && <span className="text-[var(--text-dim)]">{comments.length}</span>}</div>
      {comments.length > 0 && (
        <div className="space-y-2 mb-3">
          {comments.map((c: any) => (
            <div key={c.id} className="flex items-start gap-2">
              <Avatar name={c.users?.name || c.users?.email || "?"} src={c.users?.avatar_url} size={22} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-[var(--text)]">{c.users?.name || c.users?.email || "구성원"}</span>
                  <span className="text-[10px] text-[var(--text-dim)] mono-number">{formatDateTime(c.created_at)}</span>
                  {me?.id === c.user_id && (
                    <button onClick={() => deleteComment(c.id)} className="text-[10px] text-[var(--text-dim)] hover:text-[var(--danger)]">삭제</button>
                  )}
                </div>
                {c.body && (
                  <div className="mt-0.5 inline-block px-3 py-1.5 rounded-xl rounded-tl-sm bg-[var(--bg-surface)] text-xs text-[var(--text)] whitespace-pre-wrap">{c.body}</div>
                )}
                {(c.attachments || []).length > 0 && (
                  <div className="mt-1.5 flex flex-wrap items-start gap-1.5">
                    {(c.attachments as string[]).map((url, i) => isImageUrl(url) ? (
                      <button key={i} type="button" onClick={() => openStoredFile(url, attachmentFileName(url))} className="block" title={attachmentFileName(url)}>
                        <AttachmentThumb url={url} name={attachmentFileName(url)} />
                      </button>
                    ) : (
                      <button key={i} type="button" onClick={() => downloadStoredFile(url, attachmentFileName(url))}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-[11px] font-medium text-[var(--text-muted)] hover:text-[var(--primary)] hover:border-[var(--primary)]/40">
                        <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>
                        <span className="truncate max-w-[160px]">{attachmentFileName(url)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {pendingFiles.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {pendingFiles.map((f, i) => (
            <span key={i} className="inline-flex items-center gap-1 pl-2 pr-1 py-1 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-[11px] text-[var(--text-muted)]">
              {f.name}
              <button type="button" onClick={() => setPendingFiles((arr) => arr.filter((_, j) => j !== i))} className="px-1 text-[var(--text-dim)] hover:text-[var(--danger)]">✕</button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <label className="shrink-0 w-8 h-8 rounded-xl border border-[var(--border)] bg-[var(--bg)] flex items-center justify-center cursor-pointer text-[var(--text-dim)] hover:text-[var(--primary)] hover:border-[var(--primary)]/40" title="사진/파일 첨부">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>
          <input type="file" multiple className="hidden" onChange={(e) => { const fs = Array.from(e.target.files || []); if (fs.length) setPendingFiles((arr) => [...arr, ...fs]); e.target.value = ""; }} />
        </label>
        <input
          value={commentText}
          onChange={(e) => setCommentText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) postComment(); }}
          placeholder="댓글을 입력하세요 (Enter로 등록)"
          className="flex-1 px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-xs focus:outline-none focus:border-[var(--primary)]"
        />
        <button onClick={postComment} disabled={posting || (!commentText.trim() && pendingFiles.length === 0)}
          className="px-3 py-2 rounded-xl text-xs font-semibold bg-[var(--primary)] text-white hover:opacity-90 disabled:opacity-40">{posting ? "등록 중..." : "등록"}</button>
      </div>
    </div>
  );
}
