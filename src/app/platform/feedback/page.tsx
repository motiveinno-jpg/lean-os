"use client";
import { logRead } from "@/lib/log-read";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

const db = supabase;

const FB_STATUS: Record<string, { bg: string; text: string; label: string }> = {
  pending: { bg: "bg-[var(--warning-dim)]", text: "text-[var(--warning)]", label: "접수" },
  reviewed: { bg: "bg-[var(--info-dim)]", text: "text-[var(--info)]", label: "검토중" },
  planned: { bg: "bg-[var(--primary-light)]", text: "text-[var(--primary)]", label: "계획" },
  in_progress: { bg: "bg-[var(--primary)]", text: "text-white", label: "진행중" },
  done: { bg: "bg-[var(--success-dim)]", text: "text-[var(--success)]", label: "완료" },
  rejected: { bg: "bg-[var(--danger-dim)]", text: "text-[var(--danger)]", label: "거절" },
};

const FB_CATEGORY: Record<string, string> = {
  feature_request: "기능 요청",
  bug_report: "버그 제보",
  ux_improvement: "UX 개선",
  general: "일반",
  billing: "결제",
};

export default function FeedbackPage() {
  const qc = useQueryClient();

  const { data: feedback = [] } = useQuery({
    queryKey: ["p-feedback-all"],
    queryFn: async () => {
      const data = logRead('feedback/page:data', await db.from("feedback").select("*, users(name, email), companies(name)").order("created_at", { ascending: false }));
      return data || [];
    },
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await db.from("feedback").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["p-feedback-all"] }),
  });

  return (
    <div className="max-w-5xl space-y-6">
      <div className="platform-feedback-header">
        <h1 className="text-2xl font-extrabold text-[var(--text)]">고객 피드백</h1>
        <div className="platform-feedback-status-summary">
          {Object.entries(FB_STATUS).map(([key, val]) => {
            const count = feedback.filter((f: any) => f.status === key).length;
            return count > 0 ? (
              <span key={key} className={`px-2.5 py-1 rounded-full ${val.bg} ${val.text} font-semibold`}>
                {val.label} {count}
              </span>
            ) : null;
          })}
        </div>
      </div>

      <div className="platform-feedback-list glass-card">
        {feedback.length === 0 ? (
          <div className="text-center py-16 text-sm text-[var(--text-dim)]">피드백이 없습니다</div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {feedback.map((fb: any) => {
              const st = FB_STATUS[fb.status] || FB_STATUS.pending;
              return (
                <div key={fb.id} className="platform-feedback-row">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${st.bg} ${st.text}`}>{st.label}</span>
                        <span className="text-[11px] px-2.5 py-1 rounded-full bg-[var(--bg-surface)] text-[var(--text-muted)] font-medium">
                          {FB_CATEGORY[fb.category] || fb.category}
                        </span>
                      </div>
                      <div className="font-semibold text-[var(--text)]">{fb.title}</div>
                      {fb.description && <div className="text-sm text-[var(--text-muted)] mt-1.5 leading-relaxed">{fb.description}</div>}
                      <div className="text-xs text-[var(--text-dim)] mt-2">
                        {fb.companies?.name || "—"} · {fb.users?.name || fb.users?.email || "익명"} · {new Date(fb.created_at).toLocaleDateString("ko-KR")}
                      </div>
                    </div>
                    <div className="platform-feedback-actions">
                      {["pending", "reviewed", "planned", "in_progress", "done", "rejected"].map((s) => (
                        <button
                          key={s}
                          onClick={() => updateStatus.mutate({ id: fb.id, status: s })}
                          className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition ${
                            fb.status === s
                              ? `${FB_STATUS[s]?.bg} ${FB_STATUS[s]?.text}`
                              : "bg-[var(--bg-surface)] text-[var(--text-dim)] hover:text-[var(--text)]"
                          }`}
                        >
                          {FB_STATUS[s]?.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
