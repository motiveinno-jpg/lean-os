"use client";
import { Ico } from "@/components/ui-icon";
import { logRead } from "@/lib/log-read";

// 사용자 화면 — **열람 전용** (2026-08-06 사장님 지시).
//   공지 작성·수정·삭제는 운영자 페이지(/platform/announcements)에서만 한다.
//   DB 도 announcements_*_operator 정책으로 쓰기를 is_platform_operator() 로 막아 두었다.

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";

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

// 방금 "안 읽음"이었던 공지 스냅샷 — 읽음 처리 직후 컴포넌트가 다시 마운트돼도(개발 이중 마운트,
//   뒤로가기 재진입) NEW 표시가 사라지지 않게 잠깐 들고 있는다. 다시 조회하면 이미 읽음이라 빈다.
const RECENT_NEW = new Map<string, { ids: Set<string>; at: number }>();
const RECENT_NEW_TTL_MS = 15_000;

const CATEGORY_META: Record<string, { label: string; color: string }> = {
  notice: { label: "공지", color: "bg-[var(--info-dim)] text-[var(--info)]" },
  update: { label: "업데이트", color: "bg-[var(--success-dim)] text-[var(--success)]" },
  maintenance: { label: "점검", color: "bg-[var(--warning-dim)] text-[var(--warning)]" },
  event: { label: "이벤트", color: "bg-[var(--primary-light)] text-[var(--primary)]" },
};

export default function AnnouncementsPage() {
  const { user } = useUser();
  const userId = user?.id ?? null;
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // 이 화면에 들어온 순간 안 읽은 상태였던 공지 — 읽음 처리 후에도 "NEW" 를 계속 보여주기 위한 스냅샷.
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const markedRef = useRef(false);

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

  // 공지사항 탭에 들어오면 = 확인한 것 → 안 읽은 공지를 모두 읽음 처리하고 사이드바 배지를 지운다.
  useEffect(() => {
    if (!userId || rows.length === 0 || markedRef.current) return;
    markedRef.current = true;
    const recent = RECENT_NEW.get(userId);
    if (recent && Date.now() - recent.at < RECENT_NEW_TTL_MS) {
      setNewIds(recent.ids);
      return;
    }
    (async () => {
      const read = logRead('announcements/page:read', await supabase
        .from("announcement_reads")
        .select("announcement_id")
        .eq("user_id", userId));
      const readIds = new Set((read || []).map((r: { announcement_id: string }) => r.announcement_id));
      const unread = rows.filter((r) => !readIds.has(r.id));
      if (unread.length === 0) return;
      const ids = new Set(unread.map((r) => r.id));
      RECENT_NEW.set(userId, { ids, at: Date.now() });
      setNewIds(ids);
      // 이미 있으면 무시 — DO NOTHING 이라 RETURNING(SELECT 정책) 을 타지 않는다.
      await supabase.from("announcement_reads").upsert(
        unread.map((r) => ({ announcement_id: r.id, user_id: userId })),
        { onConflict: "announcement_id,user_id", ignoreDuplicates: true },
      );
      window.dispatchEvent(new Event("sidebar-refresh-badges"));
    })();
  }, [userId, rows]);

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
                      {newIds.has(a.id) && <span className="announcement-new-tag">NEW</span>}
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
