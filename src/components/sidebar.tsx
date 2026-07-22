"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import { useEffect, useState, useRef } from "react";
import { useModalKeys } from "@/hooks/use-modal-keys";
import { getCurrentUser, getUnreadCounts } from "@/lib/queries";
import { openGlobalSearch } from "@/components/global-search";
import { useSidebar } from "@/components/sidebar-context";
import { OwnerViewIcon, RollingBrandText } from "@/components/brand-logo";
import { useTheme } from "@/components/theme-context";
import { useUser, type UserRole } from "@/components/user-context";
import { matchGrantableRoute, effectiveTabAccess, useMyTabOverrides } from "@/lib/tab-access";
import { usePopups } from "@/components/popup-windows";

type NavItem = { href: string; label: string; icon: string; badgeKey?: string; roles?: UserRole[]; operatorOnly?: boolean; children?: NavItem[] };
type NavGroup = { label: string; items: NavItem[] };

// ── 사이드바 구조 (2026-06-04 갱신) — 홈 → 파이낸스 → 워크스페이스 → 인사관리 → 자산관리 → 설정.
//   파이낸스(구 회계관리) 홈 바로 아래. 워크스페이스(구 그룹웨어): 게시판·채팅·승인·일정·프로젝트·전자계약.
//   인사관리: 구성원·근태·서류. 자산관리: 통장·카드·정기결제 등. (employee 는 EMPLOYEE_NAV_GROUPS 별도 유지)
const NAV_GROUPS: NavGroup[] = [
  {
    label: "홈",
    items: [
      { href: "/dashboard", label: "대시보드", icon: "grid" },
      { href: "/copilot", label: "대표 참모", icon: "sparkles", roles: ["owner", "admin"] },
      { href: "/mypage", label: "마이페이지", icon: "user" },
      { href: "/notifications", label: "알림", icon: "bell", badgeKey: "notifications" },
    ],
  },
  {
    label: "파이낸스",
    items: [
      // 2026-07-08 분석 IA 개선: "경영 흐름"을 분석(/reports) 서브탭으로 통합 — 사이드바에선 "분석" 하나로.
      //   분석 진입 시 경영 흐름이 기본 화면. (이전엔 경영흐름·분석이 사이드바에 분리돼 있었음)
      { href: "/partners", label: "거래처 관리", icon: "users", roles: ["owner", "admin"] },
      { href: "/tax-invoices", label: "세금계산서", icon: "file-text", roles: ["owner", "admin"] },
      { href: "/cash-receipts", label: "현금영수증", icon: "receipt", roles: ["owner", "admin"] },
      // 2026-06-12 메뉴 분리: 원장(조회 — 매출처·매입처 잔액) / 거래 대사(작업 — 입금·계산서 매칭)
      { href: "/partners/ledger", label: "거래처 원장", icon: "book", roles: ["owner", "admin"] },
      // 2026-07-15 파이낸스로 이동: 거래 자동화(지출 분류) → 거래 매칭(입금 정산) → 전표입력 → 원장 흐름. 분류=회계처리라 파이낸스가 적합.
      { href: "/transactions", label: "거래 자동화", icon: "sparkles", roles: ["owner", "admin"] },
      { href: "/partners/reconciliation", label: "거래 매칭", icon: "clipboard-check", roles: ["owner", "admin"] },
      { href: "/partners/reconciliation/voucher-entry", label: "전표입력", icon: "edit-3", roles: ["owner", "admin"] },
      { href: "/reports", label: "분석", icon: "bar-chart", roles: ["owner", "admin"] },
    ],
  },
  {
    label: "워크스페이스",
    items: [
      // 메뉴 순서: 일정/할일 → 프로젝트 → 승인요청 → 게시판 → 메신저 (전자계약은 끝 유지)
      //   '워크플로우'(전사 칸반 /projects)는 실행형 프로젝트 상세 마지막 탭으로 이동 (2026-06-30).
      { href: "/schedule", label: "일정 / 할 일", icon: "calendar" },
      { href: "/projecthub", label: "프로젝트", icon: "briefcase", roles: ["owner", "admin"] },
      { href: "/approvals", label: "결재관리", icon: "clipboard-check", badgeKey: "approvals", roles: ["owner", "admin"] },
      { href: "/board", label: "게시판", icon: "message-square" },
      { href: "/chat", label: "메신저", icon: "message-circle", badgeKey: "chat" },
      { href: "/signatures", label: "전자계약", icon: "edit-3", roles: ["owner", "admin"] },
    ],
  },
  {
    label: "인사관리",
    items: [
      { href: "/employees", label: "구성원", icon: "user-check", roles: ["owner", "admin"] },
      { href: "/attendance", label: "근태 관리", icon: "calendar", roles: ["owner", "admin"] },
      { href: "/hr-templates", label: "양식 관리", icon: "file-text", roles: ["owner", "admin"] },
      { href: "/documents", label: "파일보관함", icon: "folder" },
    ],
  },
  {
    label: "자산관리",
    items: [
      { href: "/bank", label: "통장", icon: "arrow-right-left", roles: ["owner", "admin"] },
      { href: "/cards", label: "카드", icon: "wallet", roles: ["owner", "admin"] },
      // 2026-07-08 "정기 지출" 재편 — 자동 추천 중심. 지출결의→결재관리, 급여→인사, 구독→정기지출 "구독" 탭 흡수.
      { href: "/payments", label: "정기 지출", icon: "clock", roles: ["owner", "admin"] },
      { href: "/loans", label: "대출", icon: "trending-up", roles: ["owner"] },
      { href: "/vault", label: "자산", icon: "shield", roles: ["owner"] },
    ],
  },
  {
    label: "설정·도움말",
    items: [
      { href: "/settings", label: "회사 설정", icon: "settings", roles: ["owner", "admin"] },
      { href: "/announcements", label: "공지사항", icon: "megaphone" },
      { href: "/billing", label: "요금제", icon: "credit-card", roles: ["owner", "admin"] },
      { href: "/guide", label: "사용 가이드", icon: "help-circle" },
      { href: "/support", label: "고객센터", icon: "headphones" },
    ],
  },
];

// ── 직원(employee) 전용 사이드바 — "직원은 단순해야" 원칙.
//   홈 / 나의 업무 / 소통·도움말 3개 그룹으로 압축. 거래처·프로젝트·회계 미노출.
const EMPLOYEE_NAV_GROUPS: NavGroup[] = [
  {
    label: "홈",
    items: [
      { href: "/dashboard", label: "대시보드", icon: "grid" },
      { href: "/mypage", label: "마이페이지", icon: "user" },
      { href: "/notifications", label: "알림", icon: "bell", badgeKey: "notifications" },
    ],
  },
  {
    label: "워크스페이스",
    items: [
      { href: "/schedule", label: "일정 / 할 일", icon: "calendar" },
      { href: "/board", label: "게시판", icon: "message-square" },
    ],
  },
  {
    label: "나의 업무",
    items: [
      { href: "/attendance", label: "근태", icon: "clock" },
      { href: "/my-contracts", label: "내 서명 요청", icon: "edit-3" },
      { href: "/signatures", label: "전자계약", icon: "edit-3" },
      { href: "/approvals", label: "결재관리", icon: "clipboard-check", badgeKey: "approvals" },
      { href: "/documents", label: "파일보관함", icon: "folder" },
    ],
  },
  {
    label: "소통 · 도움말",
    items: [
      { href: "/chat", label: "메신저", icon: "message-circle", badgeKey: "chat" },
      { href: "/team", label: "구성원", icon: "users" },
      { href: "/announcements", label: "공지사항", icon: "megaphone" },
      { href: "/guide", label: "사용 가이드", icon: "help-circle" },
      { href: "/support", label: "고객센터", icon: "headphones" },
    ],
  },
];

// 활성 판정 — 기본은 prefix 매치지만, 더 구체적인 형제 메뉴(예: /partners/ledger)가 매치되면
//   상위(/partners)는 비활성. (2026-06-12: 원장/매칭허브 진입 시 거래처 관리가 같이 켜지던 버그 수정)
function isActivePath(href: string, pathname: string, allHrefs: string[]): boolean {
  if (pathname === href) return true;
  if (!pathname.startsWith(href + "/")) return false;
  return !allHrefs.some((h) => h !== href && h.startsWith(href + "/") && (pathname === h || pathname.startsWith(h + "/")));
}

function filterNavForRole(role: UserRole, overrides: Map<string, boolean>, companyName?: string, isOperator?: boolean): NavGroup[] {
  void companyName;
  // 직원은 전용 압축 메뉴 + 권한(user_tab_access)으로 부여받은 관리자 탭만 노출.
  //   메뉴 통일: 같은 구조에서 "권한받은 메뉴만" 보이고 사용 가능(접근은 RouteGuard 이중 게이트).
  if (role === "employee") {
    const empGroups = EMPLOYEE_NAV_GROUPS
      .map((group) => ({ ...group, items: group.items.filter(Boolean) }))
      .filter((group) => group.items.length > 0);
    const empHrefs = new Set(empGroups.flatMap((g) => g.items.map((i) => i.href)));
    // 부여된 관리자 탭만 노출(effectiveTabAccess) — 미부여 탭은 보이지 않음.
    const granted = (href: string) => !!matchGrantableRoute(href) && !empHrefs.has(href) && effectiveTabAccess(href, "employee", overrides);
    const adminGroups = NAV_GROUPS
      .map((group) => ({
        ...group,
        items: group.items.flatMap((item) => {
          const showItem = granted(item.href);
          const kids = (item.children || []).filter((c) => granted(c.href));
          if (showItem) return [{ ...item, children: kids.length ? kids : undefined }];
          return kids;
        }),
      }))
      .filter((group) => group.items.length > 0);
    // 같은 라벨 그룹 병합(예: 직원 '워크스페이스' + 부여받은 관리자 '워크스페이스') — 헤더 중복 방지.
    const merged: NavGroup[] = [];
    for (const g of [...empGroups, ...adminGroups]) {
      const exist = merged.find((m) => m.label === g.label);
      if (exist) {
        const seen = new Set(exist.items.map((i) => i.href));
        exist.items.push(...g.items.filter((i) => !seen.has(i.href)));
      } else merged.push({ ...g, items: [...g.items] });
    }
    return merged;
  }
  return NAV_GROUPS
    .map((group) => ({
      ...group,
      items: group.items.flatMap((item) => {
        const ok = (i: NavItem) => (!i.operatorOnly || isOperator) && (!i.roles || i.roles.includes(role));
        const kids = (item.children || []).filter(ok);
        if (ok(item)) return [{ ...item, children: kids.length ? kids : undefined }];
        return kids; // 부모가 role 로 숨겨지면 보이는 자식을 top-level 로 승격
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
    case "kanban": return <svg {...props}><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>;
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
    case "headphones": return <svg {...props}><path d="M3 18v-6a9 9 0 0118 0v6"/><path d="M21 19a2 2 0 01-2 2h-1a2 2 0 01-2-2v-3a2 2 0 012-2h3z"/><path d="M3 19a2 2 0 002 2h1a2 2 0 002-2v-3a2 2 0 00-2-2H3z"/></svg>;
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
        <div className="nav-item-tooltip">
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
  const popups = usePopups(); // 메뉴 팝업 열기 (셸 PopupProvider). null 가능(안전 처리).
  const [chatUnread, setChatUnread] = useState(0);
  const [approvalsPending, setApprovalsPending] = useState(0);
  const [notificationsUnread, setNotificationsUnread] = useState(0);
  const [collapsedParents, setCollapsedParents] = useState<Set<string>>(new Set());
  const toggleParent = (href: string) => setCollapsedParents((prev) => { const n = new Set(prev); if (n.has(href)) n.delete(href); else n.add(href); return n; });
  // 대분류 그룹 접기/펼치기 (메뉴 간소화 — 사용자 요청). localStorage 영속.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  useEffect(() => {
    try { const s = localStorage.getItem("ov:sidebar:collapsedGroups"); if (s) setCollapsedGroups(new Set(JSON.parse(s))); } catch { /* ignore */ }
  }, []);
  const toggleGroup = (label: string) => setCollapsedGroups((prev) => {
    const n = new Set(prev); if (n.has(label)) n.delete(label); else n.add(label);
    try { localStorage.setItem("ov:sidebar:collapsedGroups", JSON.stringify([...n])); } catch { /* ignore */ }
    return n;
  });
  const isOperator = !!user?.email && /@mo-tive\.com$/i.test(user.email);
  const { map: tabOverrides } = useMyTabOverrides();
  const filteredNav = filterNavForRole(role, tabOverrides, user?.companies?.name || undefined, isOperator);

  // Build flat lookup for pinned pages
  const allNavItems = filteredNav.flatMap(g => g.items.flatMap(i => i.children ? [i, ...i.children] : [i]));
  const allHrefs = allNavItems.map((i) => i.href);
  const pinnedItems = pinnedPages
    .map(href => allNavItems.find(item => item.href === href))
    .filter(Boolean) as NavItem[];

  // 2026-07-20 QA: 스크롤 경계에서 메뉴 글자가 반쯤 잘려("거래 자동화"→"거래 자동하") 깨져 보이던 문제 —
  //   아래 내용이 더 있을 때만 하단 페이드 마스크를 걸어 잘림을 자연스럽게 처리. 맨 아래 도달 시 페이드 해제.
  const navRef = useRef<HTMLElement>(null);
  const [navFade, setNavFade] = useState(false);
  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const update = () => setNavFade(el.scrollHeight - el.scrollTop - el.clientHeight > 8);
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => { el.removeEventListener("scroll", update); ro.disconnect(); };
  }, []);

  // 데스크톱 단일 아이템 렌더 (하위 토글 지원 — 부모는 chevron, 일반은 핀)
  const renderDesktopItem = (item: NavItem, isChild: boolean, hasChildren = false, open = false) => {
    const active = isActivePath(item.href, pathname, allHrefs);
    const bk = (item as any).badgeKey;
    const badge = bk === "chat" ? chatUnread : bk === "approvals" ? approvalsPending : bk === "notifications" ? notificationsUnread : 0;
    const pinned = isPinned(item.href);
    return (
      <Tooltip key={item.href} label={item.label} show={collapsed}>
        <div className="nav-item-row group">
          <Link href={item.href}
            className={`nav-item-link ${
              collapsed ? "justify-center px-0 py-2.5" : `gap-2.5 px-2.5 py-2 ${isChild ? "pl-8" : ""}`
            } ${active ? "nav-active" : "text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-surface)]"}`}>
            <span className="relative">
              <NavIcon name={item.icon} className={active ? "text-white" : ""} />
              {collapsed && badge > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[14px] h-[14px] flex items-center justify-center bg-[var(--danger)] text-white text-[8px] font-bold rounded-full px-0.5">{badge > 99 ? "99" : badge}</span>
              )}
            </span>
            {!collapsed && (
              <>
                <span className="flex-1">{item.label}</span>
                {badge > 0 && (
                  <span className="min-w-[18px] h-[18px] flex items-center justify-center bg-[var(--danger)] text-white text-[9px] font-bold rounded-full px-1">{badge > 99 ? "99+" : badge}</span>
                )}
              </>
            )}
          </Link>
          {/* 팝업으로 열기 — hover 시 우측에 등장. 현재 페이지 유지하며 이 메뉴를 플로팅 창으로. */}
          {!collapsed && popups && (
            <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); popups.open(item.href, item.label); }}
              className="nav-item-popup-btn"
              title="팝업 창으로 열기" aria-label={`${item.label} 팝업으로 열기`}>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 9h18" /><path d="M13 13h4v4" /><path d="M17 13l-4 4" />
              </svg>
            </button>
          )}
          {!collapsed && hasChildren ? (
            <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleParent(item.href); }}
              className="nav-item-expand-btn" title={open ? "접기" : "펼치기"}>
              <svg className={`w-3.5 h-3.5 transition-transform ${open ? "" : "-rotate-90"}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          ) : !collapsed ? (
            <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); togglePin(item.href); }}
              className={`nav-item-pin-btn ${pinned ? "text-amber-500 opacity-100" : "text-[var(--text-dim)] opacity-0 group-hover:opacity-60 hover:!opacity-100"}`}
              title={pinned ? "즐겨찾기 해제" : "즐겨찾기 추가"}>
              <svg className="w-3 h-3" fill={pinned ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z" strokeLinejoin="round" /></svg>
            </button>
          ) : null}
        </div>
      </Tooltip>
    );
  };

  // 모바일 단일 아이템 렌더 (하위는 indent, 토글 없이 항상 펼침)
  const renderMobileItem = (item: NavItem, isChild: boolean) => {
    const active = isActivePath(item.href, pathname, allHrefs);
    const bk = (item as any).badgeKey;
    const badge = bk === "chat" ? chatUnread : bk === "approvals" ? approvalsPending : bk === "notifications" ? notificationsUnread : 0;
    const pinned = isPinned(item.href);
    return (
      <div key={item.href} className="mobile-nav-item-row">
        <Link href={item.href}
          className={`mobile-nav-item-link px-2.5 ${isChild ? "pl-8" : ""} ${active ? "nav-active" : "text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-surface)]"}`}>
          <NavIcon name={item.icon} className={active ? "text-white" : ""} />
          <span className="flex-1">{item.label}</span>
          {badge > 0 && (
            <span className="min-w-[18px] h-[18px] flex items-center justify-center bg-[var(--danger)] text-white text-[9px] font-bold rounded-full px-1">{badge > 99 ? "99+" : badge}</span>
          )}
        </Link>
        <button onClick={() => togglePin(item.href)} className={`mobile-nav-item-pin-btn ${pinned ? "text-amber-500" : "text-[var(--text-dim)] opacity-40"}`}>
          <svg className="w-3.5 h-3.5" fill={pinned ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z" strokeLinejoin="round" /></svg>
        </button>
      </div>
    );
  };

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
        const db = supabase;
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
        const db = supabase;
        const { count } = await db
          .from("notifications")
          .select("id", { count: "exact", head: true })
          .eq("user_id", u.id)
          .eq("is_read", false);
        setNotificationsUnread(count ?? 0);
      } catch {}
    }
    loadCounts();
    const interval = setInterval(loadCounts, 60000); // 30s→60s: 배지 폴링 절반(인스턴스 요청부하 절감)
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
        const db = supabase;
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

  // 모바일 사이드바 드로어 — ESC로 닫기 (내비게이션 전용이라 Enter 확인 액션 없음)
  useModalKeys(mobileOpen, () => setMobileOpen(false));

  async function handleLogout() {
    await supabase.auth.signOut();
    window.location.href = "/auth";
  }

  const sidebarWidth = collapsed ? "w-[68px]" : "w-60";

  const sidebarContent = (
    <aside
      className={`sidebar-panel chrome-glass ${sidebarWidth}`}
    >
      {/* Logo — U1: 로고 클릭 → /dashboard */}
      <div className={`sidebar-logo-block ${collapsed ? "px-3 py-4" : "px-5 py-4"}`}>
        <Link href="/dashboard" className={`sidebar-brand-link ${collapsed ? "justify-center" : "gap-2.5"}`} aria-label="대시보드로 이동">
          <OwnerViewIcon size={28} />
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-[var(--text)]"><RollingBrandText /></div>
              <div className="text-[10px] text-[var(--text-dim)] flex items-center gap-1">
                {user?.name || user?.email?.split("@")[0] || ""}
                <span className={`sidebar-role-badge ${
                  role === "owner" ? "bg-[var(--primary-light)] text-[var(--primary)]" : role === "admin" ? "bg-cyan-500/12 text-cyan-600" : role === "partner" ? "bg-violet-500/12 text-violet-600" : "bg-emerald-500/12 text-emerald-600"
                }`}>
                  {role === "owner" ? "대표" : role === "admin" ? "관리자" : role === "partner" ? "파트너" : "직원"}
                </span>
              </div>
            </div>
          )}
        </Link>
      </div>

      {/* Search */}
      <div className={`sidebar-search-block ${collapsed ? "px-2" : "px-3"}`}>
        <Tooltip label="검색 (⌘K)" show={collapsed}>
          <button
            onClick={() => openGlobalSearch()}
            className={`sidebar-search-btn ${
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
      <nav ref={navRef} className={`sidebar-nav ${collapsed ? "px-2" : "px-3"} ${navFade ? "sidebar-nav-fade" : ""}`}>
        {/* Pinned Pages */}
        {pinnedItems.length > 0 && (
          <div className="sidebar-pinned-block">
            {!collapsed && (
              <div className="px-2 mb-1 text-[10px] font-semibold text-amber-500 uppercase tracking-wider flex items-center gap-1">
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg>
                즐겨찾기
              </div>
            )}
            {collapsed && <div className="my-1 border-t border-amber-500/30" />}
            <div className="space-y-0.5">
              {pinnedItems.map((item) => {
                const active = isActivePath(item.href, pathname, allHrefs);
                return (
                  <Tooltip key={`pin-${item.href}`} label={item.label} show={collapsed}>
                    <Link
                      href={item.href}
                      className={`sidebar-pinned-link ${
                        collapsed ? "justify-center px-0 py-2.5" : "gap-2.5 px-2.5 py-2"
                      } ${
                        active
                          ? "nav-active"
                          : "text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-surface)]"
                      }`}
                    >
                      <NavIcon name={item.icon} className={active ? "text-white" : ""} />
                      {!collapsed && <span className="flex-1">{item.label}</span>}
                    </Link>
                  </Tooltip>
                );
              })}
            </div>
          </div>
        )}

        {filteredNav.map((group) => {
          const groupClosed = !collapsed && collapsedGroups.has(group.label);
          return (
          <div key={group.label} className="sidebar-nav-group">
            {!collapsed && (
              <button onClick={() => toggleGroup(group.label)}
                className="sidebar-group-toggle-btn">
                <span>{group.label}</span>
                <span className={`text-[11px] transition-transform ${groupClosed ? "" : "rotate-90"}`}>›</span>
              </button>
            )}
            {collapsed && <div className="my-1 border-t border-[var(--border)]" />}
            {!groupClosed && (
            <div className="sidebar-group-list">
              {group.items.map((item) => {
                const kids = item.children;
                if (kids && kids.length) {
                  if (collapsed) return <div key={item.href} className="space-y-0.5">{[item, ...kids].map((c) => renderDesktopItem(c, false))}</div>;
                  const open = !collapsedParents.has(item.href);
                  return (
                    <div key={item.href}>
                      {renderDesktopItem(item, false, true, open)}
                      {open && <div className="mt-0.5 space-y-0.5">{kids.map((c) => renderDesktopItem(c, true))}</div>}
                    </div>
                  );
                }
                return renderDesktopItem(item, false);
              })}
            </div>
            )}
          </div>
          );
        })}
      </nav>

      {/* Collapse Toggle (desktop only) */}
      <div className="sidebar-collapse-block">
        <button
          onClick={toggleSidebar}
          className="sidebar-collapse-btn"
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
      <div className={`sidebar-theme-block ${collapsed ? "px-2" : "px-3"}`}>
        <Tooltip label={theme === "light" ? "다크 모드" : "라이트 모드"} show={collapsed}>
          <button
            onClick={toggleTheme}
            className={`sidebar-theme-btn ${
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
      <div className={`sidebar-footer-block ${collapsed ? "p-2" : "p-3"}`}>
        <Tooltip label="로그아웃" show={collapsed}>
          <button
            onClick={handleLogout}
            className={`sidebar-logout-btn ${
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
      {/* Desktop sidebar: 떠 있는 유리 패널 (여백 두고 둥글게 — 리퀴드글래스 목업 정합) */}
      <div className="sidebar-desktop-wrapper">
        {sidebarContent}
      </div>

      {/* Mobile overlay backdrop */}
      {mobileOpen && (
        <div
          className="sidebar-mobile-backdrop fixed inset-0"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile sidebar drawer */}
      <div
        className={`sidebar-mobile-drawer ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Force expanded width on mobile */}
        <aside
          className="sidebar-mobile-panel chrome-glass"
        >
          {/* Mobile close button + Logo (U1: 로고 클릭 → /dashboard) */}
          <div className="sidebar-mobile-logo-block">
            <div className="flex items-center gap-2.5">
              <Link href="/dashboard" onClick={() => setMobileOpen(false)} className="sidebar-mobile-brand-link" aria-label="대시보드로 이동">
                <OwnerViewIcon size={28} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-[var(--text)]"><RollingBrandText /></div>
                  <div className="text-[10px] text-[var(--text-dim)] flex items-center gap-1">
                    {user?.name || user?.email?.split("@")[0] || ""}
                    <span className={`sidebar-mobile-role-badge ${
                      role === "owner" ? "bg-[#2563EB]" : role === "admin" ? "bg-[#0891B2]" : role === "partner" ? "bg-[#7C3AED]" : "bg-[#059669]"
                    }`}>
                      {role === "owner" ? "대표" : role === "admin" ? "관리자" : role === "partner" ? "파트너" : "직원"}
                    </span>
                  </div>
                </div>
              </Link>
              <button
                onClick={() => setMobileOpen(false)}
                className="sidebar-mobile-close-btn"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>

          {/* Mobile Search */}
          <div className="sidebar-mobile-search-block">
            <button
              onClick={() => {
                setMobileOpen(false);
                openGlobalSearch();
              }}
              className="sidebar-mobile-search-btn"
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
          <nav className="sidebar-mobile-nav">
            {/* Mobile Pinned Pages */}
            {pinnedItems.length > 0 && (
              <div className="sidebar-mobile-pinned-block">
                <div className="px-2 mb-1 text-[10px] font-semibold text-amber-500 uppercase tracking-wider flex items-center gap-1">
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg>
                  즐겨찾기
                </div>
                <div className="space-y-0.5">
                  {pinnedItems.map((item) => {
                    const active = isActivePath(item.href, pathname, allHrefs);
                    return (
                      <Link key={`mpin-${item.href}`} href={item.href}
                        className={`sidebar-mobile-pinned-link ${
                          active
                            ? "nav-active"
                            : "text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-surface)]"
                        }`}>
                        <NavIcon name={item.icon} className={active ? "text-white" : ""} />
                        <span className="flex-1">{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}

            {filteredNav.map((group) => {
              const groupClosed = collapsedGroups.has(group.label);
              return (
              <div key={group.label} className="sidebar-mobile-group">
                <button onClick={() => toggleGroup(group.label)}
                  className="sidebar-mobile-group-toggle-btn">
                  <span>{group.label}</span>
                  <span className={`text-[11px] transition-transform ${groupClosed ? "" : "rotate-90"}`}>›</span>
                </button>
                {!groupClosed && (
                <div className="sidebar-mobile-group-list">
                  {group.items.map((item) => {
                    const kids = item.children;
                    if (kids && kids.length) {
                      return <div key={item.href} className="space-y-0.5">{renderMobileItem(item, false)}{kids.map((c) => renderMobileItem(c, true))}</div>;
                    }
                    return renderMobileItem(item, false);
                  })}
                </div>
                )}
              </div>
              );
            })}
          </nav>

          {/* Mobile Theme Toggle */}
          <div className="sidebar-mobile-theme-block">
            <button
              onClick={toggleTheme}
              className="sidebar-mobile-theme-btn"
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
          <div className="sidebar-mobile-footer-block">
            <button
              onClick={handleLogout}
              className="sidebar-mobile-logout-btn"
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
