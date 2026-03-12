"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

const db = supabase as any;

const FB_STATUS: Record<string, { bg: string; text: string; label: string }> = {
  pending: { bg: "bg-yellow-500/20", text: "text-yellow-400", label: "접수" },
  reviewed: { bg: "bg-blue-500/20", text: "text-blue-400", label: "검토중" },
  planned: { bg: "bg-purple-500/20", text: "text-purple-400", label: "계획" },
  in_progress: { bg: "bg-indigo-500/20", text: "text-indigo-400", label: "진행중" },
  done: { bg: "bg-emerald-500/20", text: "text-emerald-400", label: "완료" },
  rejected: { bg: "bg-red-500/20", text: "text-red-400", label: "거절" },
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
      const { data } = await db.from("feedback").select("*, users(name, email), companies(name)").order("created_at", { ascending: false });
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
    <div className="max-w-5xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-extrabold text-white">고객 피드백</h1>
          <p className="text-sm text-[#64748b] mt-1">기능 요청, 버그 제보, UX 개선</p>
        </div>
        <div className="flex gap-2 text-xs">
          {Object.entries(FB_STATUS).map(([key, val]) => {
            const count = feedback.filter((f: any) => f.status === key).length;
            return count > 0 ? (
              <span key={key} className={`px-2.5 py-1 rounded-lg ${val.bg} ${val.text} font-semibold`}>
                {val.label} {count}
              </span>
            ) : null;
          })}
        </div>
      </div>

      <div className="bg-[#111827] rounded-2xl border border-[#1e293b] overflow-hidden">
        {feedback.length === 0 ? (
          <div className="text-center py-16 text-sm text-[#64748b]">피드백이 없습니다</div>
        ) : (
          <div className="divide-y divide-[#1e293b]">
            {feedback.map((fb: any) => {
              const st = FB_STATUS[fb.status] || FB_STATUS.pending;
              return (
                <div key={fb.id} className="p-5 hover:bg-[#1e293b]/30 transition">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className={`px-2 py-0.5 rounded text-xs font-semibold ${st.bg} ${st.text}`}>{st.label}</span>
                        <span className="text-xs px-2 py-0.5 rounded bg-[#1e293b] text-[#94a3b8] font-medium">
                          {FB_CATEGORY[fb.category] || fb.category}
                        </span>
                      </div>
                      <div className="font-semibold text-white">{fb.title}</div>
                      {fb.description && <div className="text-sm text-[#94a3b8] mt-1.5 leading-relaxed">{fb.description}</div>}
                      <div className="text-xs text-[#64748b] mt-2">
                        {fb.companies?.name} · {fb.users?.name || fb.users?.email} · {new Date(fb.created_at).toLocaleDateString("ko-KR")}
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      {["reviewed", "planned", "in_progress", "done", "rejected"].map((s) => (
                        <button
                          key={s}
                          onClick={() => updateStatus.mutate({ id: fb.id, status: s })}
                          className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition ${
                            fb.status === s
                              ? `${FB_STATUS[s]?.bg} ${FB_STATUS[s]?.text}`
                              : "bg-[#0b0f1a] text-[#64748b] hover:text-white hover:bg-[#1e293b]"
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
