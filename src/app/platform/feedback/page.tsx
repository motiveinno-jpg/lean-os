"use client";
import { kstDateStr } from "@/lib/kst";
import { logRead } from "@/lib/log-read";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useMemo, useState } from "react";
import { OpsSearch, OpsCompanySelect, OpsExportButton, exportCsv } from "../_components/ops-kit";

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
    refetchInterval: 60_000,
  });

  // 검색 (2026-07-28 전면 정비) — 제목·내용·회사·작성자
  const [search, setSearch] = useState("");
  const [companyFilter, setCompanyFilter] = useState("all");
  const companyOptions = useMemo(() => {
    const set = new Set<string>();
    feedback.forEach((f: any) => { if (f.companies?.name) set.add(f.companies.name); });
    return [...set].sort((a: string, b: string) => a.localeCompare(b, "ko"));
  }, [feedback]);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return feedback.filter((f: any) => {
      if (companyFilter !== "all" && (f.companies?.name || "") !== companyFilter) return false;
      if (!q) return true;
      return (f.title || "").toLowerCase().includes(q) ||
        (f.description || "").toLowerCase().includes(q) ||
        (f.companies?.name || "").toLowerCase().includes(q) ||
        (f.users?.name || f.users?.email || "").toLowerCase().includes(q);
    });
  }, [feedback, search, companyFilter]);

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
        <div className="flex items-center gap-2">
          <OpsCompanySelect value={companyFilter} onChange={setCompanyFilter} options={companyOptions} />
          <OpsSearch value={search} onChange={setSearch} placeholder="제목·내용·회사 검색" />
          <OpsExportButton
            disabled={shown.length === 0}
            onClick={() => exportCsv(shown.map((f: any) => ({
              상태: FB_STATUS[f.status]?.label || f.status, 분류: FB_CATEGORY[f.category] || f.category,
              제목: f.title || "", 내용: (f.description || "").slice(0, 200),
              회사: f.companies?.name || "", 작성자: f.users?.name || f.users?.email || "",
              접수일: kstDateStr(new Date(f.created_at)),
            })), "고객피드백")}
          />
        </div>
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
        {shown.length === 0 ? (
          <div className="text-center py-16 text-sm text-[var(--text-dim)]">피드백이 없습니다</div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {shown.map((fb: any) => {
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
                        {fb.companies?.name || "—"} · {fb.users?.name || fb.users?.email || "익명"} · {kstDateStr(new Date(fb.created_at))}
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
