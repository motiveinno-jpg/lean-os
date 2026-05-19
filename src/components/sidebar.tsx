"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import { useEffect, useState, useRef } from "react";
import { getCurrentUser, getUnreadCounts } from "@/lib/queries";
import { openGlobalSearch } from "@/components/global-search";
import { useSidebar } from "@/components/sidebar-context";
import { OwnerViewIcon, RollingBrandText } from "@/components/brand-logo";
import { useTheme } from "@/components/theme-context";
import { useUser, type UserRole } from "@/components/user-context";

type NavItem = { href: string; label: string; icon: string; badgeKey?: string; roles?: UserRole[]; operatorOnly?: boolean };
type NavGroup = { label: string; items: NavItem[] };

// ── 사이드바 구조 — 3개 큰 카테고리(홈/인사관리/회계관리) + 시스템
const NAV_GROUPS: NavGroup[] = [
  {
    label: "홈",
    items: [
      { href: "/dashboard", label: "대시보드", icon: "grid" },
      { href: "/schedule", label: "일정 / 할 일", icon: "calendar" },
      { href: "/partners", label: "거래처 관리", icon: "users", roles: ["owner", "admin", "employee"] },
      { href: "/deals", label: "프로젝트", icon: "briefcase" },
      { href: "/board", label: "게시판", icon: "message-square" },
      { href: "/notifications", label: "알림", icon: "bell", badgeKey: "notifications" },
    ],
  },
  {
    label: "인사관리",
    items: [
      { href: "/employees", label: "구성원", icon: "user-check", roles: ["owner", "admin"] },
      { href: "/team", label: "팀 디렉토리", icon: "users", roles: ["employee"] },
      { href: "/signatures", label: "전자계약", icon: "edit-3", roles: ["owner", "admin"] },
      { href: "/my-contracts", label: "내 서명 요청", icon: "edit-3", roles: ["employee"] },
      { href: "/attendance", label: "근태 관리", icon: "calendar", roles: ["owner", "admin", "employee"] },
      { href: "/documents", label: "서류", icon: "folder" },
    ],
  },
  {
    label: "회계관리",
    items: [
      { href: "/transactions", label: "통장", icon: "arrow-right-left", roles: ["owner", "admin"] },
      { href: "/cards", label: "카드", icon: "wallet", roles: ["owner", "admin"] },
      { href: "/tax-invoices", label: "세금계산서", icon: "file-text", roles: ["owner", "admin"] },
      { href: "/cash-receipts", label: "현금영수증", icon: "receipt", roles: ["owner", "admin"] },
      { href: "/reports", label: "분석", icon: "bar-chart", roles: ["owner", "admin"] },
      { href: "/partners/ledger", label: "거래처원장", icon: "book", roles: ["owner", "admin"] },
    ],
  },
  {
    label: "시스템",
    items: [
      { href: "/approvals", label: "승인 요청", icon: "clipboard-check", badgeKey: "approvals", roles: ["owner", "admin", "employee"] },
      { href: "/chat", label: "팀 채팅", icon: "message-circle", badgeKey: "chat" },
      { href: "/payments", label: "결제 / 고정비", icon: "credit-card", roles: ["owner", "admin"] },
      { href: "/loans", label: "대출", icon: "trending-up", roles: ["owner"] },
      { href: "/matching", label: "입금 자동매칭", icon: "link", roles: ["owner"] },
      { href: "/vault", label: "자산 / 구독", icon: "shield", roles: ["owner"] },
      { href: "/import-hub", label: "엑셀 가져오기", icon: "upload", roles: ["owner", "admin"] },
      { href: "/mypage", label: "내 계정", icon: "user" },
      { href: "/billing", label: "요금제", icon: "credit-card", roles: ["owner", "admin"] },
      { href: "/guide", label: "사용 가이드", icon: "help-circle" },
      { href: "/error-logs", label: "에러 모니터링", icon: "alert-triangle", operatorOnly: true },
      { href: "/operator-users", label: "유저 계정 관리", icon: "user-cog", operatorOnly: true },
      { href: "/announcements", label: "공지사항", icon: "megaphone" },
      { href: "/settings", label: "회사 설정", icon: "settings", roles: ["owner", "admin"] },
    ],
  },
];

// ── 직원(employee) 전용 사이드바 — "직원은 단순해야" 원칙.
//   홈 / 나의 업무 / 소통·도움말 3개 그룹으로 압축. 거래처·프로젝트·회계 미노출.
const EMPLOYEE_NAV_GROUPS: NavGroup[] = [
  {
    label: "홈",
    items: [
      { href: "/dashboard", label: "홈", icon: "grid" },
      { href: "/schedule", label: "일정 / 할 일", icon: "calendar" },
      { href: "/board", label: "게시판", icon: "message-square" },
      { href: "/notifications", label: "알림", icon: "bell", badgeKey: "notifications" },
    ],
  },
  {
    label: "나의 업무",
    items: [
      { href: "/attendance", label: "근태 / 출퇴근", icon: "clock" },
      { href: "/leave", label: "휴가 신청", icon: "umbrella" },
      { href: "/my-contracts", label: "내 서명 요청", icon: "edit-3" },
      { href: "/approvals", label: "결재함", icon: "clipboard-check", badgeKey: "approvals" },
      { href: "/documents", label: "서류", icon: "folder" },
    ],
  },
  {
    label: "소통 · 도움말",
    items: [
      { href: "/chat", label: "팀 채팅", icon: "message-circle", badgeKey: "chat" },
      { href: "/team", label: "팀 디렉토리", icon: "users" },
      { href: "/announcements", label: "공지사항", icon: "megaphone" },
      { href: "/mypage", label: "내 계정", icon: "user" },
      { href: "/guide", label: "사용 가이드", icon: "help-circle" },
    ],
  },
];

function filterNavForRole(role: UserRole, companyName?: string, isOperator?: boolean): NavGroup[] {
  void companyName;
  // 직원은 전용 압축 메뉴 사용 (operator 게이트 무관 — 직원 화면은 운영자 페이지 노출 안 함)
  if (role === "employee") {
    return EMPLOYEE_NAV_GROUPS
      .map((group) => ({ ...group, items: group.items.filter(Boolean) }))
      .filter((group) => group.items.length > 0);
  }
  return NAV_GROUPS
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (item.operatorOnly && !isOperator) return false;
        return !item.roles || item.roles.includes(role);
      }),
    }))
    .filter((group) => group.items.length > 0);
}

/* ------------------------------------------------------------------ */
/*  NavIcon                                                            */
/* ------------------------------------------------------------------ */
function NavIcon({ name, className = "" }: { name: string; className?: string }) {
  const cn = `w-4 h-4 shrink-0 ${className}`;
  const props = { className: cn, fill: "none", stroke: "currentColor", strokeWidth: 1.8, viewBox: "0 0 24 24", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

  switch (name) {
    case "grid": return <svg {...props}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>;
    case "briefcase": return <svg {...props}><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/></svg>;
    case "users": return <svg {...props}><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>;
    case "credit-card": return <svg {...props}><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>;
    case "wallet": return <svg {...props}><path d="M21 12V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2h14a2 2 0 002-2v-2"/><path d="M16 12h5v4h-5a2 2 0 010-4z"/><circle cx="17.5" cy="14" r="0.8" fill="currentColor"/></svg>;
    case "calendar": return <svg {...props}><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>;
    case "file-text": return <svg {...props}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>;
    case "arrow-right-left": return <svg {...props}><path d="M21 7H3M21 7l-4-4M21 7l-4 4M3 17h18M3 17l4-4M3 17l4 4"/></svg>;
    case "link": return <svg {...props}><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>;
    case "folder": return <svg {...props}><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>;
    case "clipboard-check": return <svg {...props}><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 14l2 2 4-4"/></svg>;
    case "message-circle": return <svg {...props}><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/></svg>;
    case "message-square": return <svg {...props}><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>;
    case "user": return <svg {...props}><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>;
    case "user-check": return <svg {...props}><path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="8.5" cy="7" r="4"/><polyline points="17 11 19 13 23 9"/></svg>;
    case "shield": return <svg {...props}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>;
    case "trending-up": return <svg {...props}><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>;
    case "sparkles": return <svg {...props}><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z"/><path d="M19 13l.75 2.25L22 16l-2.25.75L19 19l-.75-2.25L16 16l2.25-.75L19 13z"/></svg>;
    case "settings": return <svg {...props}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/></svg>;
    case "help-circle": return <svg {...props}><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>;
    case "crown": return <svg {...props}><path d="M2 20h20M4 17l2-12 4 5 2-8 2 8 4-5 2 12"/></svg>;
    case "upload": return <svg {...props}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>;
    case "bar-chart": return <svg {...props}><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg>;
    case "edit-3": return <svg {...props}><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>;
    case "bell": return <svg {...props}><path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>;
    case "megaphone": return <svg {...props}><path d="M3 11l18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 11-5.8-1.6"/></svg>;
    case "alert-triangle": return <svg {...props}><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>;
    case "user-cog": return <svg {...props}><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><circle cx="19" cy="11" r="2"/><path d="M19 8v1M19 13v1M22 11h-1M17 11h-1"/></svg>;
    case "receipt": return <svg {...props}><path d="M20 2v20l-3-2-3 2-3-2-3 2-3-2-3 2V2l3 2 3-2 3 2 3-2 3 2 3-2z"/><line x1="8" y1="9" x2="16" y2="9"/><line x1="8" y1="13" x2="16" y2="13"/></svg>;
    case "book": return <svg {...props}><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>;
    case "clock": return <svg {...props}><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/></svg>;
    case "umbrella": return <svg {...props}><path d="M12 2a9 9 0 019 9H3a9 9 0 019-9z"/><path d="M12 11v8a2.5 2.5 0 005 0"/></svg>;
    default: return <svg {...props}><circle cx="12" cy="12" r="10"/></svg>;
  }
}

/* ------------------------------------------------------------------ */
/*  Tooltip wrapper for collapsed mode                                 */
/* ------------------------------------------------------------------ */
function Tooltip({ label, show, children }: { label: string; show: boolean; children: React.ReactNode }) {
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  if (!show) return <>{children}</>;

  return (
    <div
      ref={ref}
      className="relative"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      {children}
      {visible && (
        <div className="absolute left-full top-1/2 -translate-y-1/2 ml-2 z-[100] whitespace-nowrap px-2.5 py-1.5 rounded-md text-xs font-medium bg-[var(--text)] text-[var(--bg)] shadow-lg pointer-events-none">
          {label}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sidebar                                                            */
/* ------------------------------------------------------------------ */
export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { collapsed, toggleSidebar, mobileOpen, setMobileOpen, pinnedPages, togglePin, isPinned } = useSidebar();
  const { theme, toggleTheme } = useTheme();
  const { user, role } = useUser();
  const [chatUnread, setChatUnread] = useState(0);
  const [approvalsPending, setApprovalsPending] = useState(0);
  const [notificationsUnread, setNotificationsUnread] = useState(0);
  const isOperator = !!user?.email && /@mo-tive\.com$/i.test(user.email);
  const filteredNav = filterNavForRole(role, user?.companies?.name || undefined, isOperator);

  // Build flat lookup for pinned pages
  const allNavItems = filteredNav.flatMap(g => g.items);
  const pinnedItems = pinnedPages
    .map(href => allNavItems.find(item => item.href === href))
    .filter(Boolean) as NavItem[];

  useEffect(() => {
    async function loadCounts() {
      const u = await getCurrentUser();
      if (!u) return;
      try {
        const counts = await getUnreadCounts(u.company_id, u.id);
        const total = Array.from(counts.values()).reduce((s, v) => s + v, 0);
        setChatUnread(total);
      } catch {}
      try {
        const db = supabase as any;
        // 사용자가 /approvals 페이지를 마지막으로 방문한 시각 — 그 이후 created 항목만 카운트.
        const dismissedAt = typeof window !== 'undefined'
          ? localStorage.getItem('approvals-dismissed-at')
          : null;
        let docQ = db.from("doc_approvals").select("id", { count: "exact", head: true })
          .eq("approver_id", u.id).eq("status", "pending");
        let payQ = db.from("payment_queue").select("id", { count: "exact", head: true })
          .eq("company_id", u.company_id).eq("status", "pending");
        let stepQ = db.from("approval_steps")
          .select("id, stage, created_at, approval_requests!inner(current_stage, status, company_id)")
          .eq("approver_id", u.id)
          .eq("status", "pending")
          .eq("approval_requests.status", "pending")
          .eq("approval_requests.company_id", u.company_id);
        if (dismissedAt) {
          docQ = docQ.gt("created_at", dismissedAt);
          payQ = payQ.gt("created_at", dismissedAt);
          stepQ = stepQ.gt("created_at", dismissedAt);
        }
        const [{ count: docCount }, { count: payCount }, { data: pendingSteps }] = await Promise.all([docQ, payQ, stepQ]);
        const myStepCount = (pendingSteps || []).filter(
          (s: any) => s.stage === s.approval_requests?.current_stage
        ).length;
        setApprovalsPending((docCount ?? 0) + (payCount ?? 0) + myStepCount);
      } catch {}
      // notifications unread count — 모든 역할(대표/관리자/직원) 공통
      try {
        const db = supabase as any;
        const { count } = await db
          .from("notifications")
          .select("id", { count: "exact", head: true })
          .eq("user_id", u.id)
          .eq("is_read", false);
        setNotificationsUnread(count ?? 0);
      } catch {}
    }
    loadCounts();
    const interval = setInterval(loadCounts, 30000);
    window.addEventListener("sidebar-refresh-badges", loadCounts);
    return () => { clearInterval(interval); window.removeEventListener("sidebar-refresh-badges", loadCounts); };
  }, []);

  useEffect(() => {
    async function refreshOnNav() {
      const u = await getCurrentUser();
      if (!u) return;
      try {
        const counts = await getUnreadCounts(u.company_id, u.id);
        const total = Array.from(counts.values()).reduce((s, v) => s + v, 0);
        setChatUnread(total);
      } catch {}
      try {
        const db = supabase as any;
        const { count } = await db
          .from("notifications")
          .select("id", { count: "exact", head: true })
          .eq("user_id", u.id)
          .eq("is_read", false);
        setNotificationsUnread(count ?? 0);
      } catch {}
    }
    refreshOnNav();
  }, [pathname]);

  // Close mobile drawer on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname, setMobileOpen]);

  async function handleLogout() {
    await supabase.auth.signOut();
    window.location.href = "/auth";
  }

  const sidebarWidth = collapsed ? "w-[68px]" : "w-60";

  const sidebarContent = (
    <aside
      className={`${sidebarWidth} h-screen bg-[var(--bg-card)] border-r border-[var(--border)] flex flex-col transition-all duration-200 overflow-hidden`}
      style={{ boxShadow: "var(--shadow-sm)" }}
    >
      {/* Logo */}
      <div className={`border-b border-[var(--border)] ${collapsed ? "px-3 py-4" : "px-5 py-4"}`}>
        <div className={`flex items-center ${collapsed ? "justify-center" : "gap-2.5"}`}>
          <OwnerViewIcon size={28} />
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-[var(--text)]"><RollingBrandText /></div>
              <div className="text-[10px] text-[var(--text-dim)] flex items-center gap-1">
                {user?.name || user?.email?.split("@")[0] || ""}
                <span className={`inline-block px-1.5 py-0.5 rounded text-[8px] font-bold text-white ${
                  role === "owner" ? "bg-[#2563EB]" : role === "admin" ? "bg-[#0891B2]" : role === "partner" ? "bg-[#7C3AED]" : "bg-[#059669]"
                }`}>
                  {role === "owner" ? "대표" : role === "admin" ? "관리자" : role === "partner" ? "파트너" : "직원"}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Search */}
      <div className={`pt-3 pb-1 ${collapsed ? "px-2" : "px-3"}`}>
        <Tooltip label="검색 (⌘K)" show={collapsed}>
          <button
            onClick={() => openGlobalSearch()}
            className={`w-full flex items-center rounded-lg text-xs text-[var(--text-dim)] bg-[var(--bg-surface)] hover:bg-[var(--border)] transition border border-[var(--border)] ${
              collapsed ? "justify-center px-0 py-2" : "gap-2 px-3 py-2"
            }`}
          >
            <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" strokeLinecap="round" />
            </svg>
            {!collapsed && (
              <>
                <span>검색</span>
                <kbd className="ml-auto text-[9px] text-[var(--text-dim)] bg-[var(--bg)] px-1.5 py-0.5 rounded border border-[var(--border)]">
                  ⌘K
                </kbd>
              </>
            )}
          </button>
        </Tooltip>
      </div>

      {/* Nav Groups */}
      <nav className={`flex-1 py-2 overflow-y-auto space-y-4 ${collapsed ? "px-2" : "px-3"}`}>
        {/* Pinned Pages */}
        {pinnedItems.length > 0 && (
          <div>
            {!collapsed && (
              <div className="px-2 mb-1 text-[10px] font-semibold text-amber-500 uppercase tracking-wider flex items-center gap-1">
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg>
                즐겨찾기
              </div>
            )}
            {collapsed && <div className="my-1 border-t border-amber-500/30" />}
            <div className="space-y-0.5">
              {pinnedItems.map((item) => {
                const active = pathname === item.href || pathname.startsWith(item.href + "/");
                return (
                  <Tooltip key={`pin-${item.href}`} label={item.label} show={collapsed}>
                    <Link
                      href={item.href}
                      className={`flex items-center rounded-lg text-[13px] transition-all ${
                        collapsed ? "justify-center px-0 py-2.5" : "gap-2.5 px-2.5 py-2"
                      } ${
                        active
                          ? "bg-[var(--primary-light)] text-[var(--primary)] font-semibold"
                          : "text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-surface)]"
                      }`}
                    >
                      <NavIcon name={item.icon} className={active ? "text-[var(--primary)]" : ""} />
                      {!collapsed && <span className="flex-1">{item.label}</span>}
                    </Link>
                  </Tooltip>
                );
              })}
            </div>
          </div>
        )}

        {filteredNav.map((group) => (
          <div key={group.label}>
            {!collapsed && (
              <div className="px-2 mb-1 text-[10px] font-semibold text-[var(--text-dim)] uppercase tracking-wider">
                {group.label}
              </div>
            )}
            {collapsed && <div className="my-1 border-t border-[var(--border)]" />}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(item.href + "/");
                const bk = (item as any).badgeKey;
                const badge = bk === "chat" ? chatUnread : bk === "approvals" ? approvalsPending : bk === "notifications" ? notificationsUnread : 0;
                const pinned = isPinned(item.href);
                return (
                  <Tooltip key={item.href} label={item.label} show={collapsed}>
                    <div className="group relative">
                      <Link
                        href={item.href}
                        className={`flex items-center rounded-lg text-[13px] transition-all ${
                          collapsed
                            ? "justify-center px-0 py-2.5"
                            : "gap-2.5 px-2.5 py-2"
                        } ${
                          active
                            ? "bg-[var(--primary-light)] text-[var(--primary)] font-semibold"
                            : "text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-surface)]"
                        }`}
                      >
                        <span className="relative">
                          <NavIcon name={item.icon} className={active ? "text-[var(--primary)]" : ""} />
                          {collapsed && badge > 0 && (
                            <span className="absolute -top-1.5 -right-1.5 min-w-[14px] h-[14px] flex items-center justify-center bg-[var(--danger)] text-white text-[8px] font-bold rounded-full px-0.5">
                              {badge > 99 ? "!" : badge}
                            </span>
                          )}
                        </span>
                        {!collapsed && (
                          <>
                            <span className="flex-1">{item.label}</span>
                            {badge > 0 && (
                              <span className="min-w-[18px] h-[18px] flex items-center justify-center bg-[var(--danger)] text-white text-[9px] font-bold rounded-full px-1">
                                {badge > 99 ? "99+" : badge}
                              </span>
                            )}
                          </>
                        )}
                      </Link>
                      {/* Pin button — visible on hover (desktop expanded only) */}
                      {!collapsed && (
                        <button
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); togglePin(item.href); }}
                          className={`absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded transition-all ${
                            pinned
                              ? "text-amber-500 opacity-100"
                              : "text-[var(--text-dim)] opacity-0 group-hover:opacity-60 hover:!opacity-100"
                          }`}
                          title={pinned ? "즐겨찾기 해제" : "즐겨찾기 추가"}
                        >
                          <svg className="w-3 h-3" fill={pinned ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z" strokeLinejoin="round" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </Tooltip>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Collapse Toggle (desktop only) */}
      <div className="px-3 py-1 hidden md:block">
        <button
          onClick={toggleSidebar}
          className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-[var(--text-dim)] hover:text-[var(--text)] hover:bg-[var(--bg-surface)] transition text-xs"
          title={collapsed ? "사이드바 펼치기" : "사이드바 접기"}
        >
          <svg
            className={`w-4 h-4 transition-transform duration-200 ${collapsed ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            viewBox="0 0 24 24"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="11 17 6 12 11 7" />
            <polyline points="18 17 13 12 18 7" />
          </svg>
          {!collapsed && <span>접기</span>}
        </button>
      </div>

      {/* Theme Toggle */}
      <div className={`${collapsed ? "px-2" : "px-3"} pb-1`}>
        <Tooltip label={theme === "light" ? "다크 모드" : "라이트 모드"} show={collapsed}>
          <button
            onClick={toggleTheme}
            className={`w-full flex items-center rounded-lg text-[13px] text-[var(--text-dim)] hover:text-[var(--text)] hover:bg-[var(--bg-surface)] transition ${
              collapsed ? "justify-center px-0 py-2" : "gap-2.5 px-2.5 py-2"
            }`}
          >
            {theme === "light" ? (
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
              </svg>
            ) : (
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
              </svg>
            )}
            {!collapsed && <span>{theme === "light" ? "다크 모드" : "라이트 모드"}</span>}
          </button>
        </Tooltip>
      </div>

      {/* Footer */}
      <div className={`border-t border-[var(--border)] ${collapsed ? "p-2" : "p-3"}`}>
        <Tooltip label="로그아웃" show={collapsed}>
          <button
            onClick={handleLogout}
            className={`w-full flex items-center rounded-lg text-[13px] text-[var(--text-dim)] hover:text-[var(--danger)] hover:bg-[var(--danger-dim)] transition ${
              collapsed ? "justify-center px-0 py-2" : "gap-2.5 px-2.5 py-2 text-left"
            }`}
          >
            <svg
              className="w-4 h-4 shrink-0"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              viewBox="0 0 24 24"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            {!collapsed && <span>로그아웃</span>}
          </button>
        </Tooltip>
      </div>
    </aside>
  );

  return (
    <>
      {/* Desktop sidebar: fixed position */}
      <div className="hidden md:block fixed left-0 top-0 z-50 h-screen">
        {sidebarContent}
      </div>

      {/* Mobile overlay backdrop */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile sidebar drawer */}
      <div
        className={`md:hidden fixed left-0 top-0 z-50 h-[100dvh] w-60 max-w-[85vw] transition-transform duration-200 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {/* Force expanded width on mobile */}
        <aside
          className="w-60 h-screen bg-[var(--bg-card)] border-r border-[var(--border)] flex flex-col overflow-hidden"
          style={{ boxShadow: "var(--shadow-sm)" }}
        >
          {/* Mobile close button + Logo */}
          <div className="px-5 py-4 border-b border-[var(--border)]">
            <div className="flex items-center gap-2.5">
              <OwnerViewIcon size={28} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-[var(--text)]"><RollingBrandText /></div>
                <div className="text-[10px] text-[var(--text-dim)]">Company Dashboard OS</div>
              </div>
              <button
                onClick={() => setMobileOpen(false)}
                className="p-2 rounded-md hover:bg-[var(--bg-surface)] text-[var(--text-dim)]"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>

          {/* Mobile Search */}
          <div className="px-3 pt-3 pb-1">
            <button
              onClick={() => {
                setMobileOpen(false);
                openGlobalSearch();
              }}
              className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-xs min-h-[44px] text-[var(--text-dim)] bg-[var(--bg-surface)] hover:bg-[var(--border)] transition border border-[var(--border)]"
            >
              <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <circle cx="11" cy="11" r="8" />
                <path d="M21 21l-4.35-4.35" strokeLinecap="round" strokeWidth="2" />
              </svg>
              <span>검색</span>
              <kbd className="ml-auto text-[9px] text-[var(--text-dim)] bg-[var(--bg)] px-1.5 py-0.5 rounded border border-[var(--border)]">
                ⌘K
              </kbd>
            </button>
          </div>

          {/* Mobile Nav Groups */}
          <nav className="flex-1 px-3 py-2 overflow-y-auto space-y-4">
            {/* Mobile Pinned Pages */}
            {pinnedItems.length > 0 && (
              <div>
                <div className="px-2 mb-1 text-[10px] font-semibold text-amber-500 uppercase tracking-wider flex items-center gap-1">
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg>
                  즐겨찾기
                </div>
                <div className="space-y-0.5">
                  {pinnedItems.map((item) => {
                    const active = pathname === item.href || pathname.startsWith(item.href + "/");
                    return (
                      <Link key={`mpin-${item.href}`} href={item.href}
                        className={`flex items-center gap-2.5 px-2.5 py-2.5 rounded-lg text-[13px] min-h-[44px] transition-all ${
                          active
                            ? "bg-[var(--primary-light)] text-[var(--primary)] font-semibold"
                            : "text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-surface)]"
                        }`}>
                        <NavIcon name={item.icon} className={active ? "text-[var(--primary)]" : ""} />
                        <span className="flex-1">{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}

            {filteredNav.map((group) => (
              <div key={group.label}>
                <div className="px-2 mb-1 text-[10px] font-semibold text-[var(--text-dim)] uppercase tracking-wider">
                  {group.label}
                </div>
                <div className="space-y-0.5">
                  {group.items.map((item) => {
                    const active = pathname === item.href || pathname.startsWith(item.href + "/");
                    const bk = (item as any).badgeKey;
                    const badge = bk === "chat" ? chatUnread : bk === "approvals" ? approvalsPending : bk === "notifications" ? notificationsUnread : 0;
                    const pinned = isPinned(item.href);
                    return (
                      <div key={item.href} className="relative flex items-center">
                        <Link
                          href={item.href}
                          className={`flex-1 flex items-center gap-2.5 px-2.5 py-2.5 rounded-lg text-[13px] min-h-[44px] transition-all ${
                            active
                              ? "bg-[var(--primary-light)] text-[var(--primary)] font-semibold"
                              : "text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-surface)]"
                          }`}
                        >
                          <NavIcon name={item.icon} className={active ? "text-[var(--primary)]" : ""} />
                          <span className="flex-1">{item.label}</span>
                          {badge > 0 && (
                            <span className="min-w-[18px] h-[18px] flex items-center justify-center bg-[var(--danger)] text-white text-[9px] font-bold rounded-full px-1">
                              {badge > 99 ? "99+" : badge}
                            </span>
                          )}
                        </Link>
                        <button
                          onClick={() => togglePin(item.href)}
                          className={`p-2 rounded transition-all ${
                            pinned ? "text-amber-500" : "text-[var(--text-dim)] opacity-40"
                          }`}
                        >
                          <svg className="w-3.5 h-3.5" fill={pinned ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z" strokeLinejoin="round" />
                          </svg>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>

          {/* Mobile Theme Toggle */}
          <div className="px-3 pb-1">
            <button
              onClick={toggleTheme}
              className="w-full flex items-center gap-2.5 px-2.5 py-2.5 rounded-lg text-[13px] min-h-[44px] text-[var(--text-dim)] hover:text-[var(--text)] hover:bg-[var(--bg-surface)] transition text-left"
            >
              {theme === "light" ? (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
                </svg>
              )}
              {theme === "light" ? "다크 모드" : "라이트 모드"}
            </button>
          </div>

          {/* Mobile Footer */}
          <div className="p-3 border-t border-[var(--border)]">
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-2.5 px-2.5 py-2.5 rounded-lg text-[13px] min-h-[44px] text-[var(--text-dim)] hover:text-[var(--danger)] hover:bg-[var(--danger-dim)] transition text-left"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                viewBox="0 0 24 24"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              로그아웃
            </button>
          </div>
        </aside>
      </div>
    </>
  );
}
