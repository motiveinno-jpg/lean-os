"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { getCurrentUser } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  getNotificationTypeInfo,
} from "@/lib/notifications";

// ── Live (실시간) 알림 — 일정/투두/결재/채팅 통합 ──
interface LiveItem {
  id: string;
  icon: "calendar" | "todo" | "alert" | "clock" | "chat" | "approval";
  title: string;
  subtitle?: string;
  color: string;
  href: string;
  ts?: string;
}

async function fetchLiveItems(userId: string, companyId: string): Promise<LiveItem[]> {
  const db = supabase as any;
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);
  const dayAfter = new Date(); dayAfter.setDate(dayAfter.getDate() + 2);
  const dayAfterStr = dayAfter.toISOString().slice(0, 10);

  // 이상 거래 탐지 (Granter 패턴) — 비동기 import 로 폴백 우아하게
  let anomalies: any[] = [];
  try {
    const mod = await import("@/lib/anomaly-detection");
    anomalies = await mod.detectAnomalies(companyId, 7);
  } catch {}

  const [todayEvents, todos, approvalSteps, docApprovals, paymentPending] = await Promise.all([
    // 오늘 ~ 내일 일정
    db.from("schedule_events")
      .select("id, title, start_at, color")
      .eq("company_id", companyId)
      .gte("start_at", today)
      .lt("start_at", dayAfterStr)
      .order("start_at")
      .limit(10),
    // 오늘 마감 + 지연 투두 (본인)
    db.from("schedule_todos")
      .select("id, title, due_date, priority")
      .eq("user_id", userId)
      .eq("done", false)
      .not("due_date", "is", null)
      .lte("due_date", tomorrowStr)
      .order("due_date")
      .limit(10),
    // 결재 대기 (본인 처리할 step)
    db.from("approval_steps")
      .select("id, stage, approval_requests!inner(id, title, current_stage, status, company_id)")
      .eq("approver_id", userId)
      .eq("status", "pending")
      .eq("approval_requests.status", "pending")
      .eq("approval_requests.company_id", companyId)
      .limit(10),
    // 결재 대기 (문서)
    db.from("doc_approvals")
      .select("id, status")
      .eq("approver_id", userId)
      .eq("status", "pending")
      .limit(1),
    // 결제 대기
    db.from("payment_queue")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("status", "pending"),
  ]);

  const items: LiveItem[] = [];

  // 일정
  for (const e of (todayEvents.data || [])) {
    const startDate = String(e.start_at).slice(0, 10);
    const when = startDate === today ? "오늘" : "내일";
    items.push({
      id: `evt-${e.id}`,
      icon: "calendar",
      title: `${when} 일정: ${e.title}`,
      subtitle: String(e.start_at).slice(11, 16),
      color: "text-blue-500",
      href: "/schedule",
      ts: e.start_at,
    });
  }

  // 투두
  for (const t of (todos.data || [])) {
    const overdue = t.due_date < today;
    items.push({
      id: `todo-${t.id}`,
      icon: overdue ? "alert" : "todo",
      title: `${overdue ? "⚠ 지연" : "오늘 마감"}: ${t.title}`,
      subtitle: t.due_date,
      color: overdue ? "text-red-400" : "text-amber-500",
      href: "/schedule",
      ts: t.due_date,
    });
  }

  // 결재 대기 (내 step)
  const myPendingSteps = (approvalSteps.data || []).filter((s: any) =>
    s.stage === s.approval_requests?.current_stage
  );
  for (const s of myPendingSteps) {
    items.push({
      id: `step-${s.id}`,
      icon: "approval",
      title: `결재 대기: ${s.approval_requests?.title || ""}`,
      color: "text-violet-500",
      href: "/approvals",
    });
  }

  // 문서 결재 대기 (요약)
  const docCount = (docApprovals.data || []).length;
  if (docCount > 0) {
    items.push({
      id: "doc-approvals",
      icon: "approval",
      title: `문서 결재 대기 ${docCount}건`,
      color: "text-violet-500",
      href: "/approvals",
    });
  }

  // 결제 대기 (요약)
  const payCount = (paymentPending as any).count || 0;
  if (payCount > 0) {
    items.push({
      id: "payment-pending",
      icon: "clock",
      title: `결제 승인 대기 ${payCount}건`,
      color: "text-amber-500",
      href: "/payments",
    });
  }

  // 이상 거래 알림 (high/medium 만 노출, 최대 5건)
  const highMed = anomalies.filter((a) => a.severity !== "low").slice(0, 5);
  for (const a of highMed) {
    const isHigh = a.severity === "high";
    const href = a.type === "off_hours" || a.type === "duplicate_amount" ? "/cards" : "/transactions";
    items.push({
      id: `anomaly-${a.id}-${a.type}`,
      icon: "alert",
      title: `⚠ ${a.message}`,
      subtitle: `₩${a.amount.toLocaleString("ko-KR")} · ${a.date}${a.counterparty ? ` · ${a.counterparty}` : ""}`,
      color: isHigh ? "text-red-500" : "text-amber-500",
      href,
    });
  }

  return items;
}

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

// ── Entity / Type route mapper ──
// entity_type 우선 → 없으면 notification type 매칭. 모두 안 맞으면 type prefix 로 추정.
function getEntityRoute(entityType?: string, entityId?: string, notifType?: string): string {
  // 1) entity_type 매핑 (entity 가 있을 때)
  if (entityType) {
    switch (entityType) {
      case "document": return entityId ? `/documents?id=${entityId}` : "/documents";
      case "deal":
      case "milestone": return entityId ? `/deals?id=${entityId}` : "/deals";
      case "signature": return "/documents?tab=signatures";
      case "chat":
      case "chat_channel":
      case "chat_message": return entityId ? `/chat?channel=${entityId}` : "/chat";
      case "payment":
      case "payment_queue":
      case "payment_batch":
      case "recurring_payment": return "/payments";
      case "approval_request":
      case "approval_step":
      case "doc_approval": return "/approvals";
      case "expense":
      case "expense_request": return "/approvals?tab=expense";
      case "leave":
      case "leave_request": return "/leave";
      case "tax_invoice": return "/tax-invoices";
      case "cash_receipt": return "/cash-receipts";
      case "bank_transaction": return "/transactions";
      case "card_transaction": return "/cards";
      case "schedule_event":
      case "schedule_todo": return "/schedule";
      case "employee":
      case "employee_invitation": return "/settings?tab=invite";
      case "partner":
      case "partner_invitation": return entityId ? `/partners?id=${entityId}` : "/partners";
      case "vault_asset":
      case "vault_doc": return "/vault";
      case "loan":
      case "loan_payment": return "/loans";
      case "hometax_sync_job": return "/tax-invoices";
    }
  }
  // 2) notification type prefix 로 추정
  const t = (notifType || "").toLowerCase();
  if (t.includes("approval") || t.includes("결재") || t.includes("승인")) return "/approvals";
  if (t.includes("chat") || t.includes("mention")) return "/chat";
  if (t.includes("payment") || t.includes("payroll") || t.includes("고정비") || t.includes("결제")) return "/payments";
  if (t.includes("expense") || t.includes("경비")) return "/approvals?tab=expense";
  if (t.includes("tax") || t.includes("세금")) return "/tax-invoices";
  if (t.includes("schedule") || t.includes("event") || t.includes("todo") || t.includes("일정")) return "/schedule";
  if (t.includes("bank") || t.includes("통장")) return "/transactions";
  if (t.includes("card") || t.includes("카드")) return "/cards";
  if (t.includes("deal") || t.includes("프로젝트")) return "/deals";
  if (t.includes("partner") || t.includes("거래처")) return "/partners";
  if (t.includes("employee") || t.includes("직원") || t.includes("급여")) return "/employees";
  if (t.includes("signature") || t.includes("서명")) return "/documents?tab=signatures";
  if (t.includes("doc") || t.includes("문서") || t.includes("contract")) return "/documents";
  if (t.includes("vault") || t.includes("자산")) return "/vault";
  if (t.includes("loan") || t.includes("대출")) return "/loans";
  // 3) fallback — 알림 클릭 시 무조건 어디든 이동
  return "/dashboard";
}

// ── NotificationCenter Component ──
export function NotificationCenter() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [liveItems, setLiveItems] = useState<LiveItem[]>([]);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Initialize user
  useEffect(() => {
    getCurrentUser().then((u) => {
      if (u) { setUserId(u.id); setCompanyId(u.company_id); }
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

  // Fetch live (실시간) 알림 — 일정/투두/결재/결제 대기
  const fetchLive = useCallback(async () => {
    if (!userId || !companyId) return;
    try {
      const items = await fetchLiveItems(userId, companyId);
      setLiveItems(items);
    } catch {}
  }, [userId, companyId]);

  // Poll every 30 seconds — unread count + live items
  useEffect(() => {
    fetchUnreadCount();
    fetchLive();
    const interval = setInterval(() => { fetchUnreadCount(); fetchLive(); }, 30000);
    return () => clearInterval(interval);
  }, [fetchUnreadCount, fetchLive]);

  // Fetch notifications + live when dropdown opens
  useEffect(() => {
    if (open) {
      fetchNotifications();
      fetchLive();
    }
  }, [open, fetchNotifications, fetchLive]);

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

    const route = getEntityRoute(notification.entity_type, notification.entity_id, notification.type);
    router.push(route);
    setOpen(false);
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
        {(unreadCount + liveItems.length) > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full px-1 leading-none">
            {(unreadCount + liveItems.length) > 99 ? "99+" : (unreadCount + liveItems.length)}
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
          <div className="max-h-[480px] overflow-y-auto">
            {/* Live items (일정/투두/결재) — 항상 최상단 */}
            {liveItems.length > 0 && (
              <div>
                <div className="px-4 py-2 text-[10px] font-semibold text-[var(--text-dim)] uppercase tracking-wider bg-[var(--bg-surface)]">
                  지금 처리할 일 ({liveItems.length})
                </div>
                {liveItems.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => { router.push(item.href); setOpen(false); }}
                    className="w-full flex items-start gap-3 px-4 py-3 text-left transition hover:bg-[var(--bg-surface)] border-b border-[var(--border)]/50"
                  >
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 bg-[var(--bg-surface)]`}>
                      <LiveItemIcon icon={item.icon} className={item.color} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[var(--text)] leading-snug">{item.title}</p>
                      {item.subtitle && (
                        <p className="text-[10px] text-[var(--text-dim)] mt-0.5">{item.subtitle}</p>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
            {loading ? (
              <div className="p-8 text-center text-sm text-[var(--text-muted)]">
                로딩 중...
              </div>
            ) : notifications.length === 0 && liveItems.length === 0 ? (
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

// ── Live Item Icon ──
function LiveItemIcon({ icon, className = "" }: { icon: LiveItem["icon"]; className?: string }) {
  const p = { className: `w-4 h-4 ${className}`, fill: "none", stroke: "currentColor", strokeWidth: 1.8, viewBox: "0 0 24 24", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (icon) {
    case "calendar": return <svg {...p}><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>;
    case "todo": return <svg {...p}><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>;
    case "alert": return <svg {...p}><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>;
    case "clock": return <svg {...p}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>;
    case "chat": return <svg {...p}><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>;
    case "approval": return <svg {...p}><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 14l2 2 4-4"/></svg>;
    default: return null;
  }
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
