"use client";

// B 핸드오프: stage='progress_report' 전용 본 폼.
//
// 견적·계약과 동일한 quote_approvals 인프라(createApproval/sendApproval) +
// send-signature-email 엣지 재사용. payload schema 만 다름:
//   { report_text, progress_pct }
// /quote/<token> 외부 페이지가 stage='progress_report' 분기로 렌더 (이미 박혀 있음).
//
// 거래처가 승인하면 submit_quote_decision RPC 의 next_stage 매핑에 따라
// deal.stage 가 자동으로 'completed' 로 전환.

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { friendlyError, reportError } from "@/lib/friendly-error";
import { useToast } from "@/components/toast";
import {
  createApproval,
  sendApproval,
  resendApproval,
  getLatestApproval,
  STATUS_LABEL,
  type ApprovalLite,
} from "@/lib/quote-approvals";
import { useModalKeys } from "@/hooks/use-modal-keys";

interface Props {
  dealId: string;
  companyId: string;
  readonly: boolean;
  dealName: string;
  partnerId: string | null;
  partnerName: string;
  partnerEmail: string;
  approval: ApprovalLite | null;
  onApprovalChange: (row: ApprovalLite | null) => void;
}

function buildQuoteUrl(token: string): string {
  const base = (process.env.NEXT_PUBLIC_SITE_URL || (typeof window !== "undefined" ? window.location.origin : "")).replace(/\/$/, "");
  return `${base}/quote/${encodeURIComponent(token)}`;
}

export function ProgressReportStageCard({
  dealId,
  readonly,
  dealName,
  partnerId,
  partnerName,
  partnerEmail,
  approval,
  onApprovalChange,
}: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // 폼 상태 — approval.id 가 있으면 quote_approvals.payload 에서 복원 (재수정 케이스).
  // ApprovalLite 에 payload 가 없어 별도 fetch.
  const [reportText, setReportText] = useState<string>("");
  const [progressPct, setProgressPct] = useState<number>(0);

  // 초기 로드 — 우선순위:
  //   1) approval.id 있음 (발송된 행) → quote_approvals.payload 복원
  //   2) approval 없음 (발송 전 draft) → deals.custom_scope.progress_report 복원
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = supabase as any;
      if (approval?.id) {
        const { data } = await db.from("quote_approvals").select("payload").eq("id", approval.id).maybeSingle();
        if (cancelled || !data) return;
        const p = (data.payload as any) || {};
        if (typeof p.report_text === "string") setReportText(p.report_text);
        if (typeof p.progress_pct === "number") setProgressPct(p.progress_pct);
        return;
      }
      // 발송 전 draft 복원 (탭 전환·새로고침 회복)
      const { data: deal } = await db.from("deals").select("custom_scope").eq("id", dealId).maybeSingle();
      if (cancelled || !deal) return;
      const draft = (deal.custom_scope as { progress_report?: { report_text?: string; progress_pct?: number } } | null)?.progress_report;
      if (draft) {
        if (typeof draft.report_text === "string") setReportText(draft.report_text);
        if (typeof draft.progress_pct === "number") setProgressPct(draft.progress_pct);
      }
    })();
    return () => { cancelled = true; };
  }, [approval?.id, dealId]);

  // v6 사장님 요청: 자동 디바운스 저장 제거 — 명시 "💾 저장하기" 누를 때만 quote_approvals 행 생성.
  //   기존 deals.custom_scope.progress_report 단일 객체 패턴은 누적 스택 모델로 폐기.

  const [mode, setMode] = useState<"edit" | "preview">(approval ? "preview" : "edit");
  const [recipientEmail, setRecipientEmail] = useState<string>(partnerEmail || approval?.recipient_email || "");
  const [sending, setSending] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);

  // 2026-05-21 누적 스택 상세 모달 (사장님 요청 — 클릭 시 본문 전문 확인).
  const [detailOpen, setDetailOpen] = useState<StackItem | null>(null);

  const canSend = reportText.trim().length > 0;

  // 2026-05-21 v6: 진척보고서 누적 스택 (사장님 요청).
  //   "저장하기" 누를 때마다 새 quote_approvals draft 행 추가 → 시간 역순 리스트.
  //   각 행: 진척% + 보고 요약 + 시각 + 발송 버튼 (draft 만).
  type StackItem = {
    id: string;
    status: string;
    payload: { report_text?: string; progress_pct?: number } | null;
    created_at: string;
    sent_at: string | null;
    decided_at: string | null;
    recipient_email: string | null;
  };
  const { data: stack = [] } = useQuery<StackItem[]>({
    queryKey: ["deal-progress-reports", dealId],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from("quote_approvals")
        .select("id, status, payload, created_at, sent_at, decided_at, recipient_email")
        .eq("deal_id", dealId)
        .eq("stage", "progress_report")
        .order("created_at", { ascending: false });
      return (data || []) as StackItem[];
    },
    enabled: !!dealId,
  });

  // 다음 보고서 기본 진척% — 가장 최근 저장본 + 10% (max 100)
  const suggestedPct = useMemo(() => {
    if (stack.length === 0) return 10;
    const top = Number(stack[0]?.payload?.progress_pct || 0);
    return Math.min(100, top + 10);
  }, [stack]);

  // "💾 저장하기" — quote_approvals draft 새 행 INSERT (sendApproval 안 함)
  async function saveDraft() {
    if (readonly || savingDraft) return;
    if (!reportText.trim()) {
      toast("보고 내용을 입력해 주세요", "error");
      return;
    }
    setSavingDraft(true);
    try {
      const payload = { report_text: reportText.trim(), progress_pct: progressPct };
      await createApproval({ dealId, stage: "progress_report", payload, partnerId });
      // 폼 리셋 — 다음 보고서 작성용 빈 상태
      setReportText("");
      setProgressPct(suggestedPct);
      // 기존 approval 단일 흐름 (위 발송 카드) — 사용자가 "현재 활성" 으로 보던 draft 가 더 이상 의미 없으니
      //   onApprovalChange(null) 안 보냄 (rejected 재발송 등 기존 흐름 회귀 0)
      queryClient.invalidateQueries({ queryKey: ["deal-progress-reports", dealId] });
      queryClient.invalidateQueries({ queryKey: ["deal-approvals", dealId] });
      queryClient.invalidateQueries({ queryKey: ["project-detail", dealId] });
      toast("진척 보고서가 저장되었습니다", "success");
    } catch (e: unknown) {
      toast(`저장 실패: ${friendlyError(e, "저장에 실패했습니다")}`, "error");
      reportError("progress-report.saveDraft", e);
    } finally {
      setSavingDraft(false);
    }
  }

  async function handleSend() {
    if (readonly || sending) return;
    const email = recipientEmail.trim();
    if (!email) {
      toast("거래처 이메일을 입력해 주세요", "error");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast("올바른 이메일 형식이 아닙니다", "error");
      return;
    }
    setSending(true);
    try {
      const newPayload = {
        report_text: reportText,
        progress_pct: Math.max(0, Math.min(100, Number(progressPct) || 0)),
      };

      let approvalId = approval?.id || null;
      let _token: string | null = null;
      if (!approvalId || approval?.status !== "draft") {
        const created = await createApproval({
          dealId,
          stage: "progress_report",
          payload: newPayload,
          partnerId,
        });
        approvalId = created.id;
        _token = created.token;
      }
      if (!_token && approvalId) {
        const { data: row } = await (supabase as any)
          .from("quote_approvals")
          .select("approval_token")
          .eq("id", approvalId)
          .maybeSingle();
        _token = row?.approval_token ?? null;
      }
      if (!_token) {
        throw new Error("서명 링크 생성 실패 — 잠시 후 다시 시도해 주세요");
      }

      await sendApproval({
        approvalId: approvalId!,
        recipientEmail: email,
        recipientName: partnerName || undefined,
        expiresInDays: 14,
      });

      try {
        await (supabase as any).functions.invoke("send-signature-email", {
          body: {
            type: "quote",
            stage: "progress_report",
            to: email,
            signerName: partnerName || undefined,
            title: dealName ? `${dealName} — 진척 보고서 확인 요청` : "진척 보고서 확인 요청",
            signUrl: buildQuoteUrl(_token),
          },
        });
      } catch (e) {
        reportError("progress-report.send.edge", e);
      }

      const latest = await getLatestApproval(dealId, "progress_report");
      if (latest) onApprovalChange(latest);
      queryClient.invalidateQueries({ queryKey: ["deal-approvals", dealId] });
      // 발송 완료 후 deals.custom_scope.progress_report draft 정리 (다음 보고서 작성 시 빈 상태)
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = supabase as any;
        const { data: deal } = await db.from("deals").select("custom_scope").eq("id", dealId).maybeSingle();
        const cur = (deal?.custom_scope as Record<string, unknown>) || {};
        const { progress_report: _drop, ...rest } = cur as { progress_report?: unknown };
        void _drop;
        await db.from("deals").update({ custom_scope: rest }).eq("id", dealId);
      } catch (e) {
        reportError("progress-report.draft.clear", e);
      }
      setMode("preview");
      toast(`거래처에 진척 보고서 발송되었습니다 (${email})`, "success");
    } catch (e: unknown) {
      toast(`발송 실패: ${friendlyError(e, "거래처 발송에 실패했습니다")}`, "error");
    }
    setSending(false);
  }

  async function handleResend() {
    if (!approval?.id || sending) return;
    const email = recipientEmail.trim() || partnerEmail;
    if (!email) {
      toast("거래처 이메일을 입력해 주세요", "error");
      return;
    }
    setSending(true);
    try {
      const newPayload = {
        report_text: reportText,
        progress_pct: Math.max(0, Math.min(100, Number(progressPct) || 0)),
      };
      const { id: newId, token } = await resendApproval({ prevId: approval.id, payload: newPayload });
      await sendApproval({
        approvalId: newId,
        recipientEmail: email,
        recipientName: partnerName || undefined,
        expiresInDays: 14,
      });
      try {
        await (supabase as any).functions.invoke("send-signature-email", {
          body: {
            type: "quote",
            stage: "progress_report",
            to: email,
            signerName: partnerName || undefined,
            title: dealName ? `${dealName} — 진척 보고서 재발송` : "진척 보고서 재발송",
            signUrl: buildQuoteUrl(token),
          },
        });
      } catch (e) {
        reportError("progress-report.resend.edge", e);
      }
      const latest = await getLatestApproval(dealId, "progress_report");
      if (latest) onApprovalChange(latest);
      queryClient.invalidateQueries({ queryKey: ["deal-approvals", dealId] });
      setMode("preview");
      toast(`재발송되었습니다 (${email})`, "success");
    } catch (e: unknown) {
      toast(`재발송 실패: ${friendlyError(e, "재발송에 실패했습니다")}`, "error");
    }
    setSending(false);
  }

  const status = approval?.status;
  const showSend = !readonly && mode === "preview" && (!approval || status === "draft");
  const showResend = !readonly && mode === "preview" && status === "rejected";

  return (
    <div className="bg-[var(--bg-surface)] rounded-xl p-4">
      <div className="flex items-center justify-between mb-3 gap-2">
        <h3 className="text-xs font-bold text-[var(--text-muted)]">📊 진척 보고서</h3>
        <div className="flex items-center gap-2">
          {approval && mode === "preview" && (
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${statusTone(status)}`}>
              {STATUS_LABEL[status as keyof typeof STATUS_LABEL] || status}
            </span>
          )}
          {!readonly && mode === "preview" && (
            <button
              type="button"
              onClick={() => setMode("edit")}
              className="text-[10px] px-2 py-1 rounded-lg bg-[var(--bg)] hover:bg-[var(--border)] text-[var(--text-muted)] font-semibold transition"
            >
              ✏️ 수정
            </button>
          )}
          {!readonly && mode === "edit" && (
            <button
              type="button"
              onClick={() => setMode("preview")}
              disabled={!canSend}
              className="text-[10px] px-3 py-1 rounded-lg bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white font-semibold disabled:opacity-50 transition"
            >
              ✓ 미리보기
            </button>
          )}
        </div>
      </div>

      {/* 거절 사유 — rejected 일 때만 */}
      {status === "rejected" && approval?.decision_note && (
        <div className="mb-3 rounded-lg bg-red-500/10 border border-red-500/30 p-3">
          <div className="text-[10px] font-bold text-red-400 mb-1">❌ 거래처가 거절했습니다</div>
          <div className="text-xs text-[var(--text)] whitespace-pre-wrap">{approval.decision_note}</div>
          <button
            type="button"
            onClick={() => setMode("edit")}
            className="mt-2 text-[10px] text-[var(--primary)] hover:underline"
          >
            수정하기 →
          </button>
        </div>
      )}

      {mode === "edit" ? (
        <div className="space-y-3">
          <div>
            <label className="text-[10px] font-bold text-[var(--text-muted)] block mb-1">
              진행률 (%)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={100}
                value={progressPct}
                onChange={(e) => setProgressPct(Number(e.target.value))}
                className="w-20 px-2 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded text-[11px] focus:outline-none focus:border-[var(--primary)]"
              />
              <div className="flex-1 h-2 bg-[var(--bg)] rounded overflow-hidden">
                <div
                  className="h-full bg-[var(--primary)] transition-all"
                  style={{ width: `${Math.max(0, Math.min(100, progressPct))}%` }}
                />
              </div>
            </div>
          </div>
          <div>
            <label className="text-[10px] font-bold text-[var(--text-muted)] block mb-1">
              보고 내용
            </label>
            <textarea
              value={reportText}
              onChange={(e) => setReportText(e.target.value)}
              placeholder="완료된 작업·진행률·남은 일정·이슈 등을 자유롭게 작성해 주세요"
              rows={8}
              className="w-full px-2 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded text-[11px] focus:outline-none focus:border-[var(--primary)] resize-y"
            />
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="bg-[var(--bg)] rounded-lg p-3">
            <div className="text-[10px] text-[var(--text-dim)] font-medium mb-1">진행률</div>
            <div className="flex items-center gap-2">
              <div className="text-base font-bold text-[var(--primary)]">{progressPct}%</div>
              <div className="flex-1 h-2 bg-[var(--bg-surface)] rounded overflow-hidden">
                <div
                  className="h-full bg-[var(--primary)] transition-all"
                  style={{ width: `${Math.max(0, Math.min(100, progressPct))}%` }}
                />
              </div>
            </div>
          </div>
          <div className="bg-[var(--bg)] rounded-lg p-3">
            <div className="text-[10px] text-[var(--text-dim)] font-medium mb-1">보고 내용</div>
            <div className="text-xs text-[var(--text)] whitespace-pre-wrap break-words">
              {reportText || <span className="text-[var(--text-dim)]">(비어 있음)</span>}
            </div>
          </div>
        </div>
      )}

      {/* 💾 저장하기 (발송 없이 박제) + 발송 바 */}
      {!readonly && (mode === "edit" || (mode === "preview" && (!approval || approval?.status === "draft"))) && (
        <div className="mb-1 pt-3 mt-3 border-t border-[var(--border)]/40 space-y-2">
          <div className="flex gap-2 flex-wrap">
            <button
              type="button"
              onClick={saveDraft}
              disabled={savingDraft || !canSend}
              className="flex-1 min-w-[120px] px-3 py-2 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold disabled:opacity-50 transition"
            >
              {savingDraft ? "저장 중…" : "💾 저장하기"}
            </button>
            {showSend && (
              <button
                type="button"
                onClick={handleSend}
                disabled={sending || !canSend || !recipientEmail.trim()}
                className="flex-1 min-w-[160px] px-3 py-2 rounded bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white text-[11px] font-bold disabled:opacity-50 transition"
              >
                {sending ? "발송 중…" : "📤 거래처에 발송"}
              </button>
            )}
          </div>
          {showSend && (
            <>
              <input
                type="email"
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
                placeholder="recipient@example.com"
                className="w-full px-2 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded text-[11px] focus:outline-none focus:border-[var(--primary)]"
              />
              <div className="caption">
                💾 저장 = 우리 쪽 박제만 · 📤 발송 = 거래처 승인 요청 (만료 14일)
              </div>
            </>
          )}
        </div>
      )}

      {/* 누적 스택 — 저장된 진척보고서 시간 역순 (사장님 요청: "쭉쭉 쌓이게") */}
      {stack.length > 0 && (
        <div className="mt-4 pt-3 border-t border-[var(--border)]/40">
          <div className="text-[10px] text-[var(--text-dim)] font-medium mb-2">
            저장된 진척 보고서 ({stack.length}건)
          </div>
          <ul className="space-y-1.5">
            {stack.map((s) => {
              const pct = Number(s.payload?.progress_pct || 0);
              const text = String(s.payload?.report_text || "");
              const statusLabel = STATUS_LABEL[s.status as keyof typeof STATUS_LABEL] || s.status;
              const at = s.decided_at || s.sent_at || s.created_at;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => setDetailOpen(s)}
                    className="w-full text-left bg-[var(--bg)] border border-[var(--border)] rounded-lg p-2.5 hover:border-[var(--primary)]/40 hover:bg-[var(--bg-surface)] transition cursor-pointer"
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-[11px] font-bold text-[var(--primary)] tabular-nums">{pct}%</span>
                      <div className="flex-1 h-1 bg-[var(--bg-surface)] rounded overflow-hidden">
                        <div className="h-full bg-[var(--primary)]" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
                      </div>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded ${statusTone(s.status)}`}>{statusLabel}</span>
                      <span className="text-[9px] text-[var(--text-dim)]">
                        {at ? new Date(at).toLocaleDateString("ko-KR") : ""}
                      </span>
                    </div>
                    {text && (
                      <div className="text-[10px] text-[var(--text-muted)] whitespace-pre-wrap break-words line-clamp-3">
                        {text}
                      </div>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {showResend && (
        <div className="mb-1 pt-3 mt-3 border-t border-[var(--border)]/40">
          <div className="text-[10px] text-amber-400 font-medium mb-1.5">
            거절된 진척 보고서입니다 — 같은 내용으로 재발송 (수정하려면 ✏️ 수정)
          </div>
          <div className="flex flex-col sm:flex-row gap-1.5">
            <input
              type="email"
              value={recipientEmail}
              onChange={(e) => setRecipientEmail(e.target.value)}
              placeholder="recipient@example.com"
              className="flex-1 px-2 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded text-[11px] focus:outline-none focus:border-[var(--primary)]"
            />
            <button
              type="button"
              onClick={handleResend}
              disabled={sending}
              className="px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-bold disabled:opacity-50 transition whitespace-nowrap"
            >
              {sending ? "재발송 중…" : "🔁 재발송"}
            </button>
          </div>
        </div>
      )}

      {/* 누적 스택 상세 모달 — 본문 전문 + 발송 정보 (읽기 전용) */}
      {detailOpen && (
        <ProgressDetailModal item={detailOpen} onClose={() => setDetailOpen(null)} />
      )}
    </div>
  );
}

// 누적 스택 항목의 progress_pct + report_text 전문을 보여주는 읽기 전용 모달.
function ProgressDetailModal({
  item,
  onClose,
}: {
  item: {
    id: string;
    status: string;
    payload: { report_text?: string; progress_pct?: number } | null;
    created_at: string;
    sent_at: string | null;
    decided_at: string | null;
    recipient_email: string | null;
  };
  onClose: () => void;
}) {
  useModalKeys(true, onClose);

  const pct = Math.max(0, Math.min(100, Number(item.payload?.progress_pct || 0)));
  const text = String(item.payload?.report_text || "");
  const statusLabel = STATUS_LABEL[item.status as keyof typeof STATUS_LABEL] || item.status;
  const fmt = (s: string | null) => (s ? new Date(s).toLocaleString("ko-KR") : "—");

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-[2px] p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full sm:max-w-lg bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl shadow-2xl max-h-[90vh] overflow-hidden flex flex-col"
      >
        {/* 헤더 */}
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-0.5 flex-wrap">
              <span className="text-sm font-bold text-[var(--text)]">📊 진척 보고서 상세</span>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${statusTone(item.status)}`}>
                {statusLabel}
              </span>
            </div>
            <div className="text-[11px] text-[var(--text-dim)]">
              저장 {fmt(item.created_at)}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="w-8 h-8 flex items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-surface)] hover:text-[var(--text)] transition"
          >
            ✕
          </button>
        </div>

        {/* 본문 */}
        <div className="p-5 overflow-y-auto space-y-4">
          {/* 진행률 바 (크게) */}
          <div>
            <div className="flex items-baseline justify-between mb-1.5">
              <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider">진행률</span>
              <span className="text-2xl font-extrabold text-[var(--primary)] tabular-nums">{pct}%</span>
            </div>
            <div className="h-3 bg-[var(--bg)] rounded-lg overflow-hidden">
              <div className="h-full bg-[var(--primary)] transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>

          {/* 보고 내용 전문 */}
          <div>
            <div className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1.5">보고 내용</div>
            <div className="bg-[var(--bg)] border border-[var(--border)] rounded-lg p-3 text-xs text-[var(--text)] whitespace-pre-wrap break-words">
              {text || <span className="text-[var(--text-dim)]">(내용 없음)</span>}
            </div>
          </div>

          {/* 발송 정보 — 발송됐을 때만 */}
          {(item.sent_at || item.decided_at || item.recipient_email) && (
            <div>
              <div className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1.5">발송 정보</div>
              <dl className="bg-[var(--bg)] border border-[var(--border)] rounded-lg p-3 text-xs space-y-1.5">
                {item.recipient_email && (
                  <div className="flex items-start gap-3">
                    <dt className="w-16 shrink-0 text-[var(--text-dim)]">수신자</dt>
                    <dd className="text-[var(--text)] break-all">{item.recipient_email}</dd>
                  </div>
                )}
                {item.sent_at && (
                  <div className="flex items-start gap-3">
                    <dt className="w-16 shrink-0 text-[var(--text-dim)]">발송</dt>
                    <dd className="text-[var(--text)]">{fmt(item.sent_at)}</dd>
                  </div>
                )}
                {item.decided_at && (
                  <div className="flex items-start gap-3">
                    <dt className="w-16 shrink-0 text-[var(--text-dim)]">응답</dt>
                    <dd className="text-[var(--text)]">{fmt(item.decided_at)} · {statusLabel}</dd>
                  </div>
                )}
              </dl>
            </div>
          )}

          <div className="text-[10px] text-[var(--text-dim)] text-center pt-2">
            읽기 전용 · 수정/재발송은 상단 폼에서 진행
          </div>
        </div>
      </div>
    </div>
  );
}

function statusTone(status?: string): string {
  switch (status) {
    case "approved":
    case "fully_signed":
      return "bg-emerald-500/15 text-emerald-400";
    case "rejected":
      return "bg-red-500/15 text-red-400";
    case "sent":
    case "viewed":
    case "pending_our_signature":
      return "bg-blue-500/15 text-blue-400";
    default:
      return "bg-[var(--border)] text-[var(--text-muted)]";
  }
}
