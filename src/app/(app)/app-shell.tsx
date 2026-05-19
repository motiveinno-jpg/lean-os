"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { Sidebar } from "@/components/sidebar";
import { GlobalSearch } from "@/components/global-search";
// NotificationCenter import 제거 — 알림은 사이드바 페이지(/notifications)로 통합됨
import { SidebarProvider, useSidebar } from "@/components/sidebar-context";
import { OwnerViewIcon, RollingBrandText } from "@/components/brand-logo";
import { UserProvider, useUser } from "@/components/user-context";
import { BoardProvider } from "@/components/board-context";
import { HometaxBackgroundChain } from "@/components/hometax-background-chain";

/* ── Mobile Bottom Nav for Partner / Employee ── */
const PARTNER_TABS = [
  { href: "/dashboard", label: "홈", icon: "home" },
  { href: "/deals", label: "프로젝트", icon: "briefcase" },
  { href: "/documents", label: "서류", icon: "file" },
  { href: "/chat", label: "채팅", icon: "chat" },
  { href: "/guide", label: "가이드", icon: "book" },
];
const EMPLOYEE_TABS = [
  { href: "/dashboard", label: "홈", icon: "home" },
  { href: "/attendance", label: "근태", icon: "clock" },
  { href: "/leave", label: "휴가", icon: "umbrella" },
  { href: "/chat", label: "채팅", icon: "chat" },
  { href: "/documents", label: "서류", icon: "file" },
];
const OWNER_TABS = [
  { href: "/dashboard", label: "대시보드", icon: "home" },
  { href: "/deals", label: "프로젝트", icon: "briefcase" },
  { href: "/payments", label: "결제", icon: "card" },
  { href: "/chat", label: "채팅", icon: "chat" },
];

function BottomTabIcon({ name, active }: { name: string; active: boolean }) {
  const cn = `w-5 h-5 ${active ? "text-[var(--primary)]" : "text-[var(--text-muted)]"}`;
  const p = { className: cn, fill: "none", stroke: "currentColor", strokeWidth: 1.8, viewBox: "0 0 24 24", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (name) {
    case "home": return <svg {...p}><path d="M3 12l9-8 9 8"/><path d="M5 10v10a1 1 0 001 1h3a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1h3a1 1 0 001-1V10"/></svg>;
    case "briefcase": return <svg {...p}><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/></svg>;
    case "file": return <svg {...p}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>;
    case "chat": return <svg {...p}><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>;
    case "clock": return <svg {...p}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>;
    case "umbrella": return <svg {...p}><path d="M12 2a9 9 0 019 9H3a9 9 0 019-9z"/><path d="M12 11v8a2.5 2.5 0 005 0"/></svg>;
    case "book": return <svg {...p}><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/></svg>;
    case "card": return <svg {...p}><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>;
    default: return null;
  }
}

function MobileBottomNav() {
  const { role } = useUser();
  const pathname = usePathname();
  if (role !== "partner" && role !== "employee" && role !== "owner") return null;
  const tabs = role === "partner" ? PARTNER_TABS : role === "owner" ? OWNER_TABS : EMPLOYEE_TABS;

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[var(--bg-card)] border-t border-[var(--border)] safe-area-bottom" style={{ boxShadow: "0 -1px 8px rgba(0,0,0,0.06)" }}>
      <div className="flex items-center justify-around h-14 px-1">
        {tabs.map((tab) => {
          const active = pathname === tab.href || pathname.startsWith(tab.href + "/");
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`flex flex-col items-center justify-center gap-0.5 flex-1 py-1 min-w-0 min-h-[44px] transition-colors ${active ? "text-[var(--primary)]" : "text-[var(--text-muted)]"}`}
            >
              <BottomTabIcon name={tab.icon} active={active} />
              <span className={`text-[10px] font-medium truncate ${active ? "text-[var(--primary)]" : ""}`}>{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/* ── Role-based route guard ── */
const ROLE_ALLOWED_ROUTES: Record<string, string[]> = {
  partner: ["/dashboard", "/deals", "/documents", "/chat", "/guide", "/notifications", "/mypage", "/announcements", "/board", "/error-logs", "/operator-users"],
  // 직원 화면 — 홈 / 나의 업무 / 소통·도움말 로 압축. 거래처·프로젝트·회계 미노출.
  //   /employees 는 사이드바에서 제거됐지만 경비·증명서 딥링크 fallback 으로 접근 허용.
  employee: [
    "/dashboard",
    "/schedule",       // 일정 / 할 일
    "/announcements",  // 공지사항 (전체 공개, 운영자만 작성)
    "/board",          // 회사 게시판 (구성원 글·댓글)
    "/error-logs",     // 에러 모니터링 (운영자 전용 — 페이지 내 이메일 게이트)
    "/operator-users", // 유저 계정 관리 (운영자 전용 — 페이지 내 이메일 게이트)
    "/notifications",  // 알림
    "/team",           // 팀 디렉토리 (직원용 read-only)
    "/attendance",     // 근태 / 출퇴근
    "/leave",          // 휴가 신청 (전용 라우트 — '인력관리>휴가 탭' 동선 미로 해소)
    "/payslip",        // 급여명세서 열람·PDF 다운로드
    "/employees",      // 경비청구·증명서 딥링크 fallback (사이드바 미노출)
    "/documents",      // 서류 / 계약서 / 서명
    "/signatures",     // 전자계약 (서명 진행)
    "/my-contracts",   // 내 서명 요청 (모두사인 스타일 인앱 inbox)
    "/approvals",      // 결재함
    "/chat",           // 팀 채팅
    "/mypage",         // 내 계정
    "/guide",          // 사용 가이드
    "/onboarding",
  ],
};

function RouteGuard({ children }: { children: React.ReactNode }) {
  const { role, user, loading } = useUser();
  const pathname = usePathname();
  const router = useRouter();

  // 온보딩 미완료 직원 → 자동 완료 처리 (직원은 회사 온보딩 대상 아님)
  useEffect(() => {
    if (loading || !user || role !== "employee") return;
    (async () => {
      const { data: emp } = await (supabase as any)
        .from("employees")
        .select("onboarding_completed_at, status")
        .eq("user_id", user.id)
        .maybeSingle();
      if (emp && !emp.onboarding_completed_at && (emp.status === "joined" || emp.status === "contract_pending")) {
        // 직원은 회사 온보딩(사업자/계좌/딜 등록)을 할 필요 없으므로 자동 완료 처리
        await (supabase as any)
          .from("employees")
          .update({ onboarding_completed_at: new Date().toISOString() })
          .eq("user_id", user.id);
      }
    })();
  }, [loading, user, role, pathname, router]);

  useEffect(() => {
    if (loading) return;
    const allowed = ROLE_ALLOWED_ROUTES[role];
    if (!allowed) return; // owner/admin → 전체 접근
    const isAllowed = allowed.some(
      (r) => pathname === r || pathname.startsWith(r + "/")
    );
    if (!isAllowed) {
      router.replace("/dashboard");
    }
  }, [role, pathname, loading, router]);

  // 로딩 중이면 렌더링 차단 (비허용 페이지 깜빡임 방지)
  if (loading) return null;

  // 제한 역할이 비허용 경로에 있으면 렌더링 차단
  const allowed = ROLE_ALLOWED_ROUTES[role];
  if (allowed) {
    const isAllowed = allowed.some(
      (r) => pathname === r || pathname.startsWith(r + "/")
    );
    if (!isAllowed) return null;
  }

  return <>{children}</>;
}

function AppContent({ children }: { children: React.ReactNode }) {
  const { collapsed, setMobileOpen } = useSidebar();
  const { role, user } = useUser();
  const isLimitedRole = role === "partner" || role === "employee";
  const [mutationError, setMutationError] = useState<string | null>(null);

  // 앱 진입 시 전역 자동 동기화 — CODEF 한 번이라도 연결된 회사면
  // 페이지 무관하게 오너뷰를 켜면 통장+카드 자동 동기화 (10분 주기 유지).
  const companyId = user?.company_id ?? null;
  useEffect(() => {
    if (!companyId) return;
    let stopped = false;

    const connectedKey = `codef-connected-${companyId}`;
    const isConnected = async (): Promise<boolean> => {
      if (typeof window !== "undefined" && localStorage.getItem(connectedKey) === "1") return true;
      try {
        const { supabase } = await import("@/lib/supabase");
        const sb = supabase as any;
        const [{ count: bankCnt }, { count: cardCnt }] = await Promise.all([
          sb.from("bank_transactions").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("source", "codef_bank"),
          sb.from("card_transactions").select("id", { count: "exact", head: true }).eq("company_id", companyId),
        ]);
        if ((bankCnt ?? 0) > 0 || (cardCnt ?? 0) > 0) {
          localStorage.setItem(connectedKey, "1");
          return true;
        }
      } catch { /* ignore */ }
      return false;
    };

    const runOne = async (syncType: "bank" | "card") => {
      const tKey = `codef-autosync-${companyId}-${syncType}`;
      const last = Number(localStorage.getItem(tKey) || 0);
      if (Date.now() - last < 5 * 60 * 1000) return; // 5분 throttle
      localStorage.setItem(tKey, String(Date.now()));
      try {
        const { syncCodefData } = await import("@/lib/data-sync");
        const result = await syncCodefData(companyId, syncType);
        if (result?.success && !stopped) {
          localStorage.setItem(connectedKey, "1");
          window.dispatchEvent(new Event("ownerview:codef-synced"));
        }
      } catch { /* 자동 동기화 실패는 조용히 무시 */ }
    };

    const runAll = async () => {
      if (stopped || !(await isConnected())) return;
      await runOne("bank");
      await runOne("card");
    };

    runAll(); // 앱 켜면 1회
    const iv = setInterval(runAll, 10 * 60 * 1000); // 10분마다
    return () => { stopped = true; clearInterval(iv); };
  }, [companyId]);

  // 글로벌 mutation 에러 토스트 (providers.tsx MutationCache에서 발생)
  useEffect(() => {
    function handler(e: Event) {
      const msg = (e as CustomEvent).detail as string;
      setMutationError(msg);
      setTimeout(() => setMutationError(null), 4000);
    }
    window.addEventListener("ownerview:mutation-error", handler);
    return () => window.removeEventListener("ownerview:mutation-error", handler);
  }, []);

  // 전역 JS 에러 / 미처리 Promise 거부 → 운영자 조회용 DB 적재
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      import("@/lib/error-logger").then(({ logError }) => {
        logError({
          source: "window",
          message: e?.message || "window error",
          stack: e?.error?.stack,
          context: { filename: e?.filename, lineno: e?.lineno, colno: e?.colno },
        });
      }).catch(() => {});
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const reason: any = e?.reason;
      import("@/lib/error-logger").then(({ logError }) => {
        logError({
          source: "promise",
          message: reason?.message || String(reason || "unhandled rejection"),
          stack: reason?.stack,
        });
      }).catch(() => {});
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      {/* Top header bar (mobile: hamburger + notification, desktop: notification only) */}
      <div
        className={`fixed top-0 right-0 z-30 h-12 flex items-center justify-between px-3 transition-[left] duration-200 ${
          collapsed ? "md:left-[68px]" : "md:left-60"
        } left-0`}
      >
        {/* Left: Mobile hamburger — hide for limited roles on mobile (they use bottom nav) */}
        <button
          onClick={() => setMobileOpen(true)}
          className={`${isLimitedRole ? "hidden" : "md:hidden"} p-2 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-surface)] transition`}
          style={{ boxShadow: "var(--shadow-sm)" }}
          aria-label="메뉴 열기"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        {/* Logo for limited roles on mobile */}
        {isLimitedRole && (
          <div className="md:hidden flex items-center gap-2">
            <OwnerViewIcon size={24} />
            <span className="text-sm font-bold text-[var(--text)]"><RollingBrandText /></span>
          </div>
        )}
        <div className="hidden md:block" />

        {/* (알림은 사이드바 '홈 > 알림' 으로 이동 — 헤더 종 아이콘 제거) */}
      </div>

      {/* Main content */}
      <main
        className={`flex-1 max-w-[1440px] transition-[margin] duration-200 pt-14 md:pt-14 ${
          collapsed ? "md:ml-[68px]" : "md:ml-60"
        } ml-0 ${isLimitedRole ? "p-4 pb-20 md:p-6 md:pb-6" : role === "owner" ? "p-6 pb-20 md:pb-6" : "p-6"}`}
      >
        <RouteGuard>{children}</RouteGuard>
      </main>
      <MobileBottomNav />
      <GlobalSearch />
      {/* 글로벌 Mutation 에러 토스트 */}
      {mutationError && (
        <div className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl bg-red-500/95 text-white text-xs font-medium shadow-lg max-w-sm text-center animate-[slide-in_0.3s_ease]">
          저장 중 오류가 발생했습니다. 다시 시도해주세요.
        </div>
      )}
    </div>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) router.replace("/auth");
      else setReady(true);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") router.replace("/auth");
    });
    return () => subscription.unsubscribe();
  }, [router]);

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <UserProvider>
      <SidebarProvider>
        <BoardProvider>
          <AppContent>{children}</AppContent>
          {/* 페이지 무관 백그라운드 sync chain — 어떤 페이지에서든 작동 */}
          <HometaxBackgroundChain />
        </BoardProvider>
      </SidebarProvider>
    </UserProvider>
  );
}
