"use client";
import { logRead } from "@/lib/log-read";
import { Ico } from "@/components/ui-icon";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/queries";
import Link from "next/link";
import { GlobalConfirmHost } from "@/components/global-confirm";

// 게이트: 검증된 Auth 로그인 이메일이 허용 목록에 정확히 일치 (서버 is_platform_operator() 와 동일 기준).
//   2026-07-28 사장님 지시로 도메인 전체(@mo-tive.com)에서 단일 계정으로 축소.
//   그 전에는 직원 계정 11개가 운영자로 통과했다.
//   ⚠️ 운영자를 늘릴 때는 여기와 DB is_platform_operator() 를 반드시 함께 바꿀 것.
const OPERATOR_EMAILS = ["creative@mo-tive.com"];
const isOperatorEmail = (email: string) => OPERATOR_EMAILS.includes(email.trim().toLowerCase());

// OP-A 메뉴 섹션화: 비즈니스(매출/고객) + 운영(평균/업계/에러/의존성/사고/감사)
type NavGroup = { title: string; items: { href: string; label: string; icon: string }[] };
const NAV_GROUPS: NavGroup[] = [
  {
    // 2026-07-28 전면 정비: 목적별 4그룹 — 고객(누가 쓰나)/매출(돈)/지원(응대)/운영(상태·분석)
    title: "고객",
    items: [
      { href: "/platform", label: "개요", icon: "chart" },
      { href: "/platform/customers", label: "고객사", icon: "building" },
      { href: "/platform/members", label: "사용자", icon: "users" },
    ],
  },
  {
    title: "매출",
    items: [
      { href: "/platform/revenue", label: "수익", icon: "dollar" },
      { href: "/platform/sales-codes", label: "영업코드", icon: "link" },
    ],
  },
  {
    title: "지원",
    items: [
      { href: "/platform/support", label: "고객센터", icon: "headset" },
      { href: "/platform/partnership", label: "도입문의", icon: "inbox" },
    ],
  },
  {
    title: "운영",
    items: [
      // 에러해석·의존성·사고기록·감사로그 4개 → "시스템 상태" 1개 (기존 라우트는 유지, 메뉴만 통합)
      { href: "/platform/health", label: "시스템 상태", icon: "alert" },
      { href: "/platform/averages", label: "재무평균", icon: "trending" },
      { href: "/platform/industry", label: "업계분석", icon: "layers" },
    ],
  },
  {
    title: "시스템",
    items: [
      { href: "/platform/system", label: "시스템", icon: "cog" },
    ],
  },
];

function NavIcon({ type, active }: { type: string; active: boolean }) {
  const cls = `w-4 h-4 ${active ? "text-white" : "text-[var(--text-dim)]"}`;
  const props = { className: cls, fill: "none", stroke: "currentColor", strokeWidth: 1.8, viewBox: "0 0 24 24" };
  switch (type) {
    case "chart": return <svg {...props}><path d="M3 3v18h18"/><path d="M7 16l4-8 4 4 5-9"/></svg>;
    case "building": return <svg {...props}><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M16 6h.01M12 6h.01M8 10h.01M16 10h.01M12 10h.01M8 14h.01M16 14h.01M12 14h.01"/></svg>;
    case "users": return <svg {...props}><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>;
    case "dollar": return <svg {...props}><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>;
    case "message": return <svg {...props}><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>;
    case "headset": return <svg {...props}><path d="M3 18v-6a9 9 0 0118 0v6"/><path d="M21 19a2 2 0 01-2 2h-3v-7h3a2 2 0 012 2zM3 19a2 2 0 002 2h3v-7H5a2 2 0 00-2 2z"/></svg>;
    case "inbox": return <svg {...props}><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/></svg>;
    case "cog": return <svg {...props}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>;
    case "trending": return <svg {...props}><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>;
    case "layers": return <svg {...props}><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>;
    case "alert": return <svg {...props}><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>;
    case "link": return <svg {...props}><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>;
    case "siren": return <svg {...props}><path d="M3 18h18M5 18a7 7 0 0114 0M12 4v3M4.93 6.93l2.12 2.12M19.07 6.93l-2.12 2.12"/></svg>;
    case "shield": return <svg {...props}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>;
    default: return null;
  }
}

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [status, setStatus] = useState<"loading" | "ready" | "denied">("loading");
  const [userName, setUserName] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = logRead('platform/layout:data', await supabase.auth.getSession());
        if (!data.session) { router.replace("/auth"); return; }
        const user = await getCurrentUser();
        if (cancelled) return;
        // 게이트: 서버 is_platform_operator() 와 동일 기준 — 검증된 Auth 로그인 이메일(@mo-tive.com).
        //   (2026-07-20 P0 봉합) 자가수정 가능한 public.users.email·회사명이 아니라 세션 Auth 이메일로 판정.
        const authEmail = data.session.user?.email || "";
        if (!user || !isOperatorEmail(authEmail)) {
          setStatus("denied");
          return;
        }
        setUserName(user.name || user.email || "Admin");
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("denied");
      }
    })();
    return () => { cancelled = true; };
  }, [router]);

  // 인라인 스타일 — CSS 로딩 전에도 보이도록
  if (status === "denied") {
    return (
      <div className="platform-access-denied-screen" style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F2F4F9", color: "#18181B" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}><Ico e="🔒" /></div>
          <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>접근 권한 없음</h1>
          <p style={{ fontSize: 14, color: "#52525B", marginBottom: 24 }}>OwnerView 플랫폼 관리자만 접근할 수 있습니다.</p>
          <a href="/dashboard" style={{ padding: "10px 24px", background: "#4F46E5", color: "#fff", borderRadius: 12, fontSize: 14, fontWeight: 600, textDecoration: "none" }}>
            대시보드로 이동
          </a>
        </div>
      </div>
    );
  }

  if (status === "loading") {
    return (
      <div className="platform-loading-screen" style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F2F4F9" }}>
        <div style={{ width: 32, height: 32, border: "2px solid #4F46E5", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    );
  }

  // 톱바 타이틀 — 현재 경로에 해당하는 메뉴 라벨 (2026-07-28 레이아웃 리디자인)
  const allNavItems = NAV_GROUPS.flatMap((g) => g.items);
  const currentItem = allNavItems.find(
    (i) =>
      pathname === i.href ||
      (i.href !== "/platform" && pathname.startsWith(i.href)) ||
      (i.href === "/platform/customers" && pathname.startsWith("/platform/companies")),
  );
  const logout = async () => { await supabase.auth.signOut(); router.replace("/auth"); };

  return (
    // 2026-07-03 TeamHub 라운드 — 다크 고정 콘솔을 라이트 토큰 캔버스로 전환(고객 앱과 동일 언어)
    // 2026-07-06 라운드8.2 — 고객 앱 셸과 동일한 리퀴드글래스 적용(전 화면 통일):
    //   래퍼 배경 제거(body::before 앰비언트 캔버스가 비쳐 보이게) + 사이드바를 떠 있는 유리 패널로.
    // 2026-07-28 리디자인 — 상단 톱바(현재 화면명·사이트 보기·로그아웃) + 모바일 대응
    //   (기존엔 좁은 화면에서 고정 사이드바가 콘텐츠를 덮었음 — md 미만은 사이드바 숨기고 칩 내비로).
    <div className="min-h-screen flex">
      {/* Sidebar — 고객 앱 sidebar.tsx 와 동일한 인셋 플로팅 유리 패널 */}
      <aside className="platform-sidebar chrome-glass">
        <div className="p-5 border-b border-[var(--border)]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[var(--primary)] to-[var(--primary-soft)] flex items-center justify-center shadow-[0_4px_12px_-4px_var(--primary)]">
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
              </svg>
            </div>
            <div className="min-w-0">
              <div className="text-sm font-extrabold tracking-tight text-[var(--text)]">OwnerView</div>
              <span className="platform-brand-badge">OPERATOR</span>
            </div>
          </div>
        </div>

        <nav className="flex-1 py-3 px-2 space-y-3 overflow-y-auto">
          {NAV_GROUPS.map((group) => (
            <div key={group.title} className="platform-nav-group">
              <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--text-dim)]">
                {group.title}
              </div>
              <div className="space-y-0.5 mt-1">
                {group.items.map((item) => {
                  const active =
                    pathname === item.href ||
                    (item.href !== "/platform" && pathname.startsWith(item.href)) ||
                    // 고객사 상세(/platform/companies/[id])는 "고객사" 메뉴 아래로 간주 — 상세에서 활성표시 유지
                    (item.href === "/platform/customers" && pathname.startsWith("/platform/companies"));
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`platform-nav-item ${
                        active ? "nav-active" : "text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-surface)]"
                      }`}
                    >
                      <NavIcon type={item.icon} active={active} />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="platform-sidebar-footer">
          <div className="flex items-center gap-2.5 mb-3">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[var(--primary)] to-[var(--primary-soft)] flex items-center justify-center text-white text-xs font-bold shrink-0">
              {userName.charAt(0)}
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold text-[var(--text)] truncate">{userName}</div>
              <div className="text-[10px] text-[var(--text-dim)]">플랫폼 운영자</div>
            </div>
          </div>
          <Link href="/dashboard" className="flex items-center gap-2 text-xs text-[var(--text-dim)] hover:text-[var(--text)] transition">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M15 19l-7-7 7-7"/></svg>
            고객 앱으로 돌아가기
          </Link>
        </div>
      </aside>

      <main className="platform-main-content">
        {/* 톱바 — 현재 화면명 + 빠른 액션 (2026-07-28) */}
        <div className="platform-topbar chrome-glass">
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-dim)]">
              {NAV_GROUPS.find((g) => g.items.some((i) => i === currentItem))?.title || "Platform"}
            </div>
            <h1 className="text-base font-extrabold text-[var(--text)] truncate">{currentItem?.label || "플랫폼"}</h1>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <a href="https://www.owner-view.com" target="_blank" rel="noreferrer" className="platform-topbar-action">
              사이트 보기 ↗
            </a>
            <button onClick={logout} className="platform-topbar-action platform-topbar-logout">로그아웃</button>
          </div>
        </div>

        {/* 모바일 내비 — md 미만에서 사이드바 대신 가로 스크롤 칩 */}
        <nav className="platform-mobile-nav">
          {allNavItems.map((item) => {
            const active = item === currentItem;
            return (
              <Link key={item.href} href={item.href} className={`platform-mobile-nav-chip ${active ? "nav-active" : ""}`}>
                {item.label}
              </Link>
            );
          })}
        </nav>

        {children}
      </main>
      <GlobalConfirmHost />
    </div>
  );
}
