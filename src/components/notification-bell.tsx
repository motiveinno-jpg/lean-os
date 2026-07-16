"use client";
import { logRead } from "@/lib/log-read";

// 헤더 우측 알림 벨 — 클릭 시 현재 페이지를 유지한 채 최근 알림을 팝오버로 간소하게 보여줌
//   (기존엔 /notifications 로 즉시 이동해버려 지금 보던 화면을 잃었음). "전체 알림 보기" 로 이동.
//   팝오버는 document.body 로 포털 + fixed 배치, 백드롭이 패널을 감싸는 구조(모달과 동일 관례)라
//   round10 CSS 규칙(fixed+inset-0 직계 자식 .glass-card → 불투명)을 자동으로 물려받아 또렷하게 보임.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/queries";
import { resolveNotificationHref, type NotificationRow } from "@/lib/notification-routes";
import { useUser } from "@/components/user-context";

const RECENT_LIMIT = 6;

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  return `${day}일 전`;
}

export function NotificationBell() {
  const { user } = useUser();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [rows, setRows] = useState<NotificationRow[] | null>(null);
  const [quoteMap, setQuoteMap] = useState<Record<string, { deal_id: string; stage: string }>>({});
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  // 안읽음 배지 — 기존 app-shell 로직 이관 (60초 폴링 + sidebar-refresh-badges 이벤트)
  useEffect(() => {
    let alive = true;
    async function loadBell() {
      if (!user) return;
      try {
        const { count } = await (supabase as any)
          .from("notifications")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .eq("is_read", false);
        if (alive) setUnread(count ?? 0);
      } catch {}
    }
    loadBell();
    const iv = setInterval(loadBell, 60000);
    window.addEventListener("sidebar-refresh-badges", loadBell);
    return () => { alive = false; clearInterval(iv); window.removeEventListener("sidebar-refresh-badges", loadBell); };
  }, [user]);

  // 열릴 때만 최근 목록 조회 (평소엔 배지 카운트만 가벼운 폴링)
  useEffect(() => {
    if (!open) return;
    let alive = true;
    (async () => {
      const u = await getCurrentUser();
      if (!u) return;
      const nRows = logRead('components/notification-bell:nRows', await (supabase as any)
        .from("notifications")
        .select("id, type, title, message, entity_type, entity_id, is_read, created_at")
        .eq("user_id", u.id)
        .eq("is_read", false)
        .order("created_at", { ascending: false })
        .limit(RECENT_LIMIT));
      const list = (nRows || []) as NotificationRow[];
      const quoteIds = Array.from(new Set(
        list.filter(n => n.entity_type === "quote_approval" && n.entity_id).map(n => n.entity_id as string),
      ));
      const map: Record<string, { deal_id: string; stage: string }> = {};
      if (quoteIds.length > 0) {
        const qaRows = logRead('components/notification-bell:qaRows', await (supabase as any)
          .from("quote_approvals")
          .select("id, deal_id, stage")
          .in("id", quoteIds));
        for (const r of (qaRows || []) as Array<{ id: string; deal_id: string; stage: string }>) {
          map[r.id] = { deal_id: r.deal_id, stage: r.stage };
        }
      }
      if (alive) { setRows(list); setQuoteMap(map); }
    })();
    return () => { alive = false; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const reposition = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (!r) return;
      // 패널 폭(min(92vw,380))을 고려해 왼쪽으로 화면 밖을 넘지 않도록 right 를 클램프.
      //   (모바일에서 벨 기준 right 만 쓰면 패널이 화면 왼쪽으로 삐져나가 잘렸음 — IMG_0573)
      const panelW = Math.min(window.innerWidth * 0.92, 380);
      const desiredRight = Math.max(8, window.innerWidth - r.right);
      const maxRight = Math.max(8, window.innerWidth - panelW - 8);
      setPos({ top: r.bottom + 8, right: Math.min(desiredRight, maxRight) });
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const goTo = async (n: NotificationRow) => {
    if (!n.is_read) {
      await (supabase as any).from("notifications").update({ is_read: true }).eq("id", n.id);
      // 읽음 처리된 항목은 목록에서 즉시 사라지도록 (안읽은 알림만 보여주는 목록이라 유지 안 함)
      setRows((prev) => prev?.filter((r) => r.id !== n.id) ?? prev);
      setUnread((v) => Math.max(0, v - 1));
      window.dispatchEvent(new Event("sidebar-refresh-badges"));
    }
    setOpen(false);
    router.push(resolveNotificationHref(n, quoteMap));
  };

  // 개별 읽음 — 이동하지 않고 그 알림만 읽음 처리
  const markRead = async (n: NotificationRow, e: React.MouseEvent) => {
    e.stopPropagation();
    if (n.is_read) return;
    await (supabase as any).from("notifications").update({ is_read: true }).eq("id", n.id);
    setRows((prev) => prev?.filter((r) => r.id !== n.id) ?? prev);
    setUnread((v) => Math.max(0, v - 1));
    window.dispatchEvent(new Event("sidebar-refresh-badges"));
  };

  // 모두 읽음 — 이 사용자의 안읽은 알림 전체 읽음 처리
  const markAllRead = async () => {
    const u = await getCurrentUser();
    if (!u) return;
    await (supabase as any).from("notifications").update({ is_read: true }).eq("user_id", u.id).eq("is_read", false);
    setRows([]);
    setUnread(0);
    window.dispatchEvent(new Event("sidebar-refresh-badges"));
  };

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        className="notification-bell-btn"
        aria-label="알림"
        aria-expanded={open}
        title="알림"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 01-3.46 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 flex items-center justify-center bg-[var(--danger)] text-white text-[9px] font-bold rounded-full px-1">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && pos && typeof document !== "undefined" && createPortal(
        <div className="notification-panel-backdrop fixed inset-0" onClick={() => setOpen(false)}>
          <div
            className="notification-panel glass-card"
            style={{ top: pos.top, right: pos.right, boxShadow: "var(--shadow-lg, 0 12px 32px rgba(0,0,0,0.18))" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="notification-panel-header">
              <span className="text-sm font-bold text-[var(--text)]">알림</span>
              <div className="flex items-center gap-2">
                {rows && rows.length > 0 && (
                  <button onClick={markAllRead} className="text-[11px] font-semibold text-[var(--primary)] hover:underline" title="모든 알림 읽음 처리">모두 읽음</button>
                )}
                <button onClick={() => setOpen(false)} className="text-[var(--text-muted)] hover:text-[var(--text)] text-lg leading-none px-1" aria-label="닫기">✕</button>
              </div>
            </div>

            {rows === null ? (
              <div className="px-4 py-8 text-center text-xs text-[var(--text-dim)]">불러오는 중...</div>
            ) : rows.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-[var(--text-dim)]">읽지 않은 알림이 없습니다.</div>
            ) : (
              <div className="notification-panel-list">
                {rows.map((n) => (
                  <div
                    key={n.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => goTo(n)}
                    onKeyDown={(e) => { if (e.key === "Enter") goTo(n); }}
                    className="notification-panel-item"
                  >
                    <span className="flex-1 min-w-0">
                      <span className="block text-[13px] font-semibold text-[var(--text)]">
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--primary)] mr-1.5 align-middle" />
                        {n.title}
                      </span>
                      {n.message && (
                        <span className="block text-[11px] text-[var(--text-dim)] mt-0.5 line-clamp-2">{n.message}</span>
                      )}
                    </span>
                    <span className="flex flex-col items-end gap-1 shrink-0">
                      <span className="text-[10px] text-[var(--text-dim)] whitespace-nowrap">{timeAgo(n.created_at)}</span>
                      <button
                        onClick={(e) => markRead(n, e)}
                        className="text-[10px] font-semibold text-[var(--text-muted)] hover:text-[var(--primary)] whitespace-nowrap"
                        title="이 알림만 읽음 처리 (이동 안 함)"
                      >읽음</button>
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="px-4 py-2.5 border-t border-[var(--border)]">
              <button
                onClick={() => { setOpen(false); router.push("/notifications"); }}
                className="w-full flex items-center justify-center gap-1.5 text-[12px] font-semibold text-[var(--primary)] hover:underline"
              >
                전체 알림 보기 →
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
