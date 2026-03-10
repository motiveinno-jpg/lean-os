"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { getCurrentUser } from "@/lib/queries";
import {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  getNotificationTypeInfo,
} from "@/lib/notifications";

// ── Relative time helper ──
function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "방금";
  if (minutes < 60) return `${minutes}분 전`;
  if (hours < 24) return `${hours}시간 전`;
  if (days < 7) return `${days}일 전`;
  return new Date(dateStr).toLocaleDateString("ko");
}

// ── Is today check ──
function isToday(dateStr: string): boolean {
  const d = new Date(dateStr);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

// ── Notification Icon ──
function NotificationIcon({ type }: { type: string }) {
  const info = getNotificationTypeInfo(type);
  const cn = `w-4 h-4 ${info.color}`;
  const svgProps = {
    className: cn,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    viewBox: "0 0 24 24",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  switch (info.icon) {
    case "pen":
      return (
        <svg {...svgProps}>
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
        </svg>
      );
    case "check-circle":
      return (
        <svg {...svgProps}>
          <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
      );
    case "x-circle":
      return (
        <svg {...svgProps}>
          <circle cx="12" cy="12" r="10" />
          <line x1="15" y1="9" x2="9" y2="15" />
          <line x1="9" y1="9" x2="15" y2="15" />
        </svg>
      );
    case "file-check":
      return (
        <svg {...svgProps}>
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <path d="M9 15l2 2 4-4" />
        </svg>
      );
    case "file-search":
      return (
        <svg {...svgProps}>
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <circle cx="11.5" cy="14.5" r="2.5" />
          <line x1="13.25" y1="16.25" x2="15" y2="18" />
        </svg>
      );
    case "briefcase":
      return (
        <svg {...svgProps}>
          <rect x="2" y="7" width="20" height="14" rx="2" />
          <path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2" />
        </svg>
      );
    case "credit-card":
      return (
        <svg {...svgProps}>
          <rect x="1" y="4" width="22" height="16" rx="2" />
          <line x1="1" y1="10" x2="23" y2="10" />
        </svg>
      );
    case "clock":
      return (
        <svg {...svgProps}>
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      );
    case "at-sign":
      return (
        <svg {...svgProps}>
          <circle cx="12" cy="12" r="4" />
          <path d="M16 8v5a3 3 0 006 0v-1a10 10 0 10-3.92 7.94" />
        </svg>
      );
    case "flag":
      return (
        <svg {...svgProps}>
          <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
          <line x1="4" y1="22" x2="4" y2="15" />
        </svg>
      );
    case "message-circle":
      return (
        <svg {...svgProps}>
          <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" />
        </svg>
      );
    case "info":
    default:
      return (
        <svg {...svgProps}>
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
      );
  }
}

// ── Entity route mapper ──
function getEntityRoute(entityType?: string, entityId?: string): string | null {
  if (!entityType || !entityId) return null;
  switch (entityType) {
    case "document":
      return `/documents?id=${entityId}`;
    case "deal":
      return `/deals?id=${entityId}`;
    case "signature":
      return `/documents?tab=signatures`;
    case "chat":
      return `/chat?channel=${entityId}`;
    case "payment":
      return `/payments`;
    case "approval_request":
      return `/approvals`;
    case "milestone":
      return `/deals`;
    default:
      return null;
  }
}

// ── NotificationCenter Component ──
export function NotificationCenter() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Initialize user
  useEffect(() => {
    getCurrentUser().then((u) => {
      if (u) setUserId(u.id);
    });
  }, []);

  // Fetch unread count
  const fetchUnreadCount = useCallback(async () => {
    if (!userId) return;
    try {
      const count = await getUnreadCount(userId);
      setUnreadCount(count);
    } catch {}
  }, [userId]);

  // Fetch notifications
  const fetchNotifications = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const data = await getNotifications(userId, 30);
      setNotifications(data);
    } catch {}
    setLoading(false);
  }, [userId]);

  // Poll every 30 seconds
  useEffect(() => {
    fetchUnreadCount();
    const interval = setInterval(fetchUnreadCount, 30000);
    return () => clearInterval(interval);
  }, [fetchUnreadCount]);

  // Fetch notifications when dropdown opens
  useEffect(() => {
    if (open) {
      fetchNotifications();
    }
  }, [open, fetchNotifications]);

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    function handleEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    if (open) {
      document.addEventListener("keydown", handleEsc);
    }
    return () => document.removeEventListener("keydown", handleEsc);
  }, [open]);

  // Handle mark all read
  async function handleMarkAllRead() {
    if (!userId) return;
    try {
      await markAllAsRead(userId);
      setUnreadCount(0);
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    } catch {}
  }

  // Handle notification click
  async function handleNotificationClick(notification: any) {
    if (!notification.is_read) {
      try {
        await markAsRead(notification.id);
        setUnreadCount((prev) => Math.max(0, prev - 1));
        setNotifications((prev) =>
          prev.map((n) =>
            n.id === notification.id ? { ...n, is_read: true } : n
          )
        );
      } catch {}
    }

    const route = getEntityRoute(notification.entity_type, notification.entity_id);
    if (route) {
      router.push(route);
      setOpen(false);
    }
  }

  // Group notifications
  const todayNotifications = notifications.filter((n) =>
    isToday(n.created_at)
  );
  const earlierNotifications = notifications.filter(
    (n) => !isToday(n.created_at)
  );

  return (
    <div ref={panelRef} className="relative">
      {/* Bell Button */}
      <button
        onClick={() => setOpen(!open)}
        className="relative p-2 rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-surface)] transition"
        aria-label="알림"
      >
        <svg
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          viewBox="0 0 24 24"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 01-3.46 0" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full px-1 leading-none">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown Panel */}
      {open && (
        <div
          className="absolute right-0 top-full mt-2 w-[380px] bg-[var(--bg-card)] border border-[var(--border)] rounded-xl overflow-hidden z-50"
          style={{ boxShadow: "0 8px 30px rgba(0,0,0,0.12)" }}
        >
          {/* Header */}
          <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between">
            <h3 className="text-sm font-bold text-[var(--text)]">알림</h3>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/10 text-red-500 font-semibold">
                  {unreadCount}개 미읽음
                </span>
              )}
              <button
                onClick={handleMarkAllRead}
                className="text-xs text-[var(--primary)] hover:text-[var(--primary-hover)] font-medium transition"
              >
                모두 읽음
              </button>
            </div>
          </div>

          {/* Notification List */}
          <div className="max-h-[400px] overflow-y-auto">
            {loading ? (
              <div className="p-8 text-center text-sm text-[var(--text-muted)]">
                로딩 중...
              </div>
            ) : notifications.length === 0 ? (
              <div className="p-8 text-center">
                <svg
                  className="w-10 h-10 mx-auto mb-3 text-[var(--text-dim)]"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.2}
                  viewBox="0 0 24 24"
                >
                  <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M13.73 21a2 2 0 01-3.46 0" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <div className="text-sm font-medium text-[var(--text-muted)]">
                  알림이 없습니다
                </div>
                <div className="text-xs text-[var(--text-dim)] mt-1">
                  새로운 알림이 오면 여기에 표시됩니다
                </div>
              </div>
            ) : (
              <>
                {/* Today */}
                {todayNotifications.length > 0 && (
                  <div>
                    <div className="px-4 py-2 text-[10px] font-semibold text-[var(--text-dim)] uppercase tracking-wider bg-[var(--bg-surface)]">
                      오늘
                    </div>
                    {todayNotifications.map((n) => (
                      <NotificationItem
                        key={n.id}
                        notification={n}
                        onClick={() => handleNotificationClick(n)}
                      />
                    ))}
                  </div>
                )}

                {/* Earlier */}
                {earlierNotifications.length > 0 && (
                  <div>
                    <div className="px-4 py-2 text-[10px] font-semibold text-[var(--text-dim)] uppercase tracking-wider bg-[var(--bg-surface)]">
                      이전
                    </div>
                    {earlierNotifications.map((n) => (
                      <NotificationItem
                        key={n.id}
                        notification={n}
                        onClick={() => handleNotificationClick(n)}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Notification Item ──
function NotificationItem({
  notification,
  onClick,
}: {
  notification: any;
  onClick: () => void;
}) {
  const typeInfo = getNotificationTypeInfo(notification.type);

  return (
    <button
      onClick={onClick}
      className={`w-full flex items-start gap-3 px-4 py-3 text-left transition hover:bg-[var(--bg-surface)] border-b border-[var(--border)]/50 ${
        !notification.is_read ? "bg-[var(--primary)]/[0.02]" : ""
      }`}
    >
      {/* Icon */}
      <div
        className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${typeInfo.bg}`}
      >
        <NotificationIcon type={notification.type} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p
            className={`text-sm leading-snug ${
              !notification.is_read
                ? "font-semibold text-[var(--text)]"
                : "text-[var(--text-muted)]"
            }`}
          >
            {notification.title}
          </p>
          {!notification.is_read && (
            <span className="w-2 h-2 rounded-full bg-[var(--primary)] shrink-0 mt-1.5" />
          )}
        </div>
        {notification.message && (
          <p className="text-xs text-[var(--text-dim)] mt-0.5 line-clamp-2">
            {notification.message}
          </p>
        )}
        <p className="text-[10px] text-[var(--text-dim)] mt-1">
          {relativeTime(notification.created_at)}
        </p>
      </div>
    </button>
  );
}
