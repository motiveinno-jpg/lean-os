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

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
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

  // 1초 디바운스 자동 임시 저장 — 발송 전 edit 모드 + 내용 있을 때만
  useEffect(() => {
    if (approval || readonly) return; // 발송된 행 또는 readonly 는 draft 불요
    if (!reportText && !progressPct) return; // 빈 상태는 저장 안 함
    const t = setTimeout(async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = supabase as any;
        const { data: deal } = await db.from("deals").select("custom_scope").eq("id", dealId).maybeSingle();
        const scope = {
          ...(((deal?.custom_scope as Record<string, unknown>) || {})),
          progress_report: { report_text: reportText, progress_pct: progressPct, updated_at: new Date().toISOString() },
        };
        await db.from("deals").update({ custom_scope: scope }).eq("id", dealId);
      } catch (e) {
        reportError("progress-report.draft.save", e);
      }
    }, 1000);
    return () => clearTimeout(t);
  }, [reportText, progressPct, approval, readonly, dealId]);

  const [mode, setMode] = useState<"edit" | "preview">(approval ? "preview" : "edit");
  const [recipientEmail, setRecipientEmail] = useState<string>(partnerEmail || approval?.recipient_email || "");
  const [sending, setSending] = useState(false);

  const canSend = reportText.trim().length > 0;

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

      {/* 발송 바 */}
      {showSend && (
        <div className="mb-1 pt-3 mt-3 border-t border-[var(--border)]/40">
          <div className="text-[10px] text-[var(--text-dim)] font-medium mb-1.5">
            거래처에 진척 보고서 발송 {partnerName ? `· ${partnerName}` : ""}
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
              onClick={handleSend}
              disabled={sending || !canSend}
              className="px-3 py-1.5 rounded bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white text-[11px] font-bold disabled:opacity-50 transition whitespace-nowrap"
            >
              {sending ? "발송 중…" : "📤 거래처에 진척 보고서 발송"}
            </button>
          </div>
          <div className="mt-1.5 text-[10px] text-[var(--text-dim)]">
            만료: 14일 · 거래처 확인 후 완료 단계로 안내됩니다
          </div>
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
