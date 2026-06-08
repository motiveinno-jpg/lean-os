"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/toast";
import { sendSignatureReminder } from "@/lib/signatures";
import { friendlyError } from "@/lib/friendly-error";

// ── Failure Panel (최근 7일 발송 실패) ──
const FAILURE_CODE_LABEL: Record<string, string> = {
  INVALID_EMAIL: "이메일 형식 오류",
  MISSING_EMAIL: "이메일 누락",
  SMTP_TIMEOUT: "메일 서버 응답 없음",
  BOUNCED: "메일 반송",
  UNAUTHORIZED: "발송 권한 오류",
  RATE_LIMIT: "발송 한도 초과",
  UNKNOWN: "알 수 없는 오류",
};

const FAILURE_SEND_TYPE_LABEL: Record<string, string> = {
  initial: "최초 발송",
  bulk_initial: "단체 일괄",
  reminder: "리마인더",
};

export function FailurePanel({
  summary,
  onClose,
  onRetried,
}: {
  summary: { error_code: string; count: number; latest_failed_at: string }[];
  onClose: () => void;
  onRetried: () => void;
}) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const total = summary.reduce((acc, r) => acc + Number(r.count || 0), 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="glass-card w-full max-h-[80vh] overflow-auto rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 px-5 py-4 border-b border-[var(--border)] bg-[var(--bg-card)]/95 backdrop-blur flex items-center justify-between">
          <div>
            <div className="text-sm font-bold text-[var(--text)]">⚠️ 최근 7일 발송 실패 ({total}건)</div>
            <div className="text-[11px] text-[var(--text-muted)] mt-0.5">사유별로 묶어 표시 · 펼치면 수신자별 상세 + 재발송</div>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text)] text-xl leading-none">✕</button>
        </div>
        <div className="p-4 space-y-2">
          {summary.length === 0 ? (
            <div className="p-8 text-center text-sm text-[var(--text-muted)]">최근 7일간 실패한 발송이 없습니다.</div>
          ) : (
            summary.map((g) => (
              <FailureGroupRow key={g.error_code} group={g} onRetried={onRetried} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function FailureGroupRow({
  group,
  onRetried,
}: {
  group: { error_code: string; count: number; latest_failed_at: string };
  onRetried: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const label = FAILURE_CODE_LABEL[group.error_code] || group.error_code;

  type FailureRow = {
    id: string;
    signature_request_id: string | null;
    batch_id: string | null;
    partner_id: string | null;
    recipient_email: string;
    recipient_name: string | null;
    send_type: string;
    error_code: string;
    error_message: string;
    failed_at: string;
    retried: boolean;
  };

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["signature-failure-rows", group.error_code],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("list_send_failures_by_code", {
        p_error_code: group.error_code,
        p_days: 7,
      });
      if (error) throw error;
      return ((data || []) as FailureRow[]).filter((r) => !r.retried);
    },
    enabled: open,
  });

  const retryMut = useMutation({
    mutationFn: async (row: FailureRow) => {
      if (!row.signature_request_id) throw new Error("재발송할 서명 요청이 없습니다.");
      const r = await sendSignatureReminder(row.signature_request_id);
      if (!r.success) throw new Error(r.error || "재발송 실패");
      const { error: mErr } = await (supabase as any).rpc("mark_failure_retried", {
        p_failure_id: row.id,
        p_new_request_id: row.signature_request_id,
      });
      if (mErr) throw mErr;
    },
    onSuccess: () => {
      toast("재발송 완료", "success");
      qc.invalidateQueries({ queryKey: ["signature-failure-rows", group.error_code] });
      onRetried();
    },
    onError: (e: any) => toast(friendlyError(e, "재발송 실패"), "error"),
  });

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)]/60 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-3.5 py-2.5 hover:bg-[var(--bg-surface)] transition"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className={`transition inline-block ${open ? "rotate-90" : ""}`}>▶</span>
          <span className="text-sm font-semibold text-[var(--text)] truncate">{label}</span>
          <span className="text-[11px] text-[var(--text-dim)] truncate">
            최근 {new Date(group.latest_failed_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}
          </span>
        </div>
        <span className="shrink-0 px-2 py-0.5 rounded-full bg-red-500/15 text-red-500 text-[11px] font-bold tabular-nums">
          {group.count}건
        </span>
      </button>
      {open && (
        <div className="border-t border-[var(--border)] divide-y divide-[var(--border)]">
          {isLoading ? (
            <div className="px-3.5 py-6 text-center text-xs text-[var(--text-muted)]">불러오는 중...</div>
          ) : rows.length === 0 ? (
            <div className="px-3.5 py-6 text-center text-xs text-[var(--text-muted)]">모든 실패가 재발송 완료되었습니다.</div>
          ) : (
            rows.map((r) => (
              <div key={r.id} className="px-3.5 py-2.5 flex items-center gap-3 hover:bg-[var(--bg-surface)]/40">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-[var(--text)] truncate">
                      {r.recipient_name || "이름 없음"}
                    </span>
                    <span className="text-[11px] text-[var(--text-dim)] truncate">{r.recipient_email || "(이메일 없음)"}</span>
                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-[var(--primary)]/10 text-[var(--primary)] font-semibold">
                      {FAILURE_SEND_TYPE_LABEL[r.send_type] || r.send_type}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] text-[var(--text-dim)]">
                      {new Date(r.failed_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}
                    </span>
                    {r.error_message && (
                      <span className="text-[10px] text-[var(--text-muted)] line-clamp-1" title={r.error_message}>
                        {r.error_message}
                      </span>
                    )}
                  </div>
                </div>
                {r.signature_request_id ? (
                  <button
                    onClick={() => retryMut.mutate(r)}
                    disabled={retryMut.isPending}
                    className="shrink-0 px-2.5 py-1.5 text-[11px] font-semibold bg-[var(--primary)]/10 text-[var(--primary)] rounded-lg hover:bg-[var(--primary)]/20 disabled:opacity-50"
                    title="이 요청에 리마인더 발송 + 재시도 처리"
                  >
                    🔄 재발송
                  </button>
                ) : (
                  <span className="shrink-0 text-[10px] text-[var(--text-dim)]">요청 없음</span>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

