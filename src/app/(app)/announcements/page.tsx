"use client";
import { Ico } from "@/components/ui-icon";
import { logRead } from "@/lib/log-read";

// 사용자 화면 — **열람 전용** (2026-08-06 사장님 지시).
//   공지 작성·수정·삭제는 운영자 페이지(/platform/announcements)에서만 한다.
//   DB 도 announcements_*_operator 정책으로 쓰기를 is_platform_operator() 로 막아 두었다.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

type Announcement = {
  id: string;
  title: string;
  content: string;
  category: string;
  pinned: boolean;
  author_email: string | null;
  author_name: string | null;
  created_at: string;
  updated_at: string;
};

const CATEGORY_META: Record<string, { label: string; color: string }> = {
  notice: { label: "공지", color: "bg-[var(--info-dim)] text-[var(--info)]" },
  update: { label: "업데이트", color: "bg-[var(--success-dim)] text-[var(--success)]" },
  maintenance: { label: "점검", color: "bg-[var(--warning-dim)] text-[var(--warning)]" },
  event: { label: "이벤트", color: "bg-[var(--primary-light)] text-[var(--primary)]" },
};

export default function AnnouncementsPage() {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["announcements"],
    queryFn: async () => {
      const data = logRead('announcements/page:data', await supabase
        .from("announcements")
        .select("*")
        .order("pinned", { ascending: false })
        .order("created_at", { ascending: false }));
      return (data || []) as Announcement[];
    },
  });

  const pinnedRows = useMemo(() => rows.filter((r) => r.pinned), [rows]);
  const normalRows = useMemo(() => rows.filter((r) => !r.pinned), [rows]);

  return (
    <div className="">
      {isLoading ? (
        <div className="p-12 text-center text-sm text-[var(--text-muted)]">불러오는 중...</div>
      ) : rows.length === 0 ? (
        <div className="announcement-empty glass-card">
          <div className="text-4xl mb-3"><Ico e="📢" /></div>
          <div className="text-sm font-semibold text-[var(--text)]">등록된 공지가 없습니다</div>
          <div className="text-[11px] text-[var(--text-dim)] mt-1.5">서비스 공지·업데이트 소식이 등록되면 여기에 표시됩니다.</div>
        </div>
      ) : (
        <div className="announcement-list glass-card">
          {[...pinnedRows, ...normalRows].map((a) => {
            const cat = CATEGORY_META[a.category] || CATEGORY_META.notice;
            const expanded = expandedId === a.id;
            return (
              <div key={a.id} className={`announcement-item ${a.pinned ? "bg-[var(--primary)]/[0.03]" : ""}`}>
                <button
                  onClick={() => setExpandedId(expanded ? null : a.id)}
                  className="w-full text-left px-5 py-4 flex items-start gap-3 hover:bg-[var(--bg-surface)]/60 transition"
                >
                  <div className="w-9 h-9 rounded-full bg-[var(--primary)]/10 text-[var(--primary)] flex items-center justify-center text-sm font-bold shrink-0">
                    {(a.author_name || a.author_email || "운")[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      {a.pinned && <span className="text-[10px]"><Ico e="📌" /></span>}
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${cat.color}`}>{cat.label}</span>
                      <span className="text-sm font-bold text-[var(--text)] truncate">{a.title}</span>
                    </div>
                    <div className="text-[11px] text-[var(--text-dim)]">
                      {a.author_name || a.author_email || "운영자"} · {new Date(a.created_at).toLocaleString("ko-KR")}
                      {a.updated_at !== a.created_at && " (수정됨)"}
                    </div>
                  </div>
                  <svg className={`w-4 h-4 shrink-0 text-[var(--text-dim)] transition-transform ${expanded ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
                {expanded && (
                  <div className="px-5 pb-4">
                    <div className="text-sm text-[var(--text-muted)] whitespace-pre-wrap leading-relaxed border-t border-[var(--border)] pt-3">
                      {a.content}
                    </div>
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
