"use client";
import { logRead } from "@/lib/log-read";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { GlobalModalGuard } from "@/components/global-modal-guard";
import { supabase } from "@/lib/supabase";
import { ConsentGate } from "@/components/consent-gate";
import { Sidebar } from "@/components/sidebar";
import { FinanceTabs } from "@/components/finance-tabs";
import { GlobalSearch, openGlobalSearch } from "@/components/global-search";
import { getRouteCrumb } from "@/lib/route-labels";
import { FloatingMessenger } from "@/components/floating-messenger";
import { MenuGuide, MenuGuideDrawer } from "@/components/menu-guide";
import { GuideProvider, useGuide } from "@/components/guide-context";
import { NotificationBell } from "@/components/notification-bell";
import { AccountChip } from "@/components/account-chip";
import { SidebarProvider, useSidebar } from "@/components/sidebar-context";
import { OwnerViewIcon } from "@/components/brand-logo";
import { UserProvider, useUser } from "@/components/user-context";
import { BoardProvider } from "@/components/board-context";
import { HometaxBackgroundChain } from "@/components/hometax-background-chain";
import { AppTourHost } from "@/components/app-tour";
import { MaintenanceNoticeHost } from "@/components/maintenance-notice";
import { SingleSessionGuard } from "@/components/single-session-guard";
import { IpGate } from "@/components/ip-gate";
import { PopupProvider, PopupWindowsHost } from "@/components/popup-windows";
import { SubscriptionGate } from "@/components/subscription-gate";
import { AccessDenied } from "@/components/access-denied";
import { matchCatalogRoute, useMyPermissions } from "@/lib/permissions";
import { isDev } from "@/lib/app-env";

/* ── Mobile Bottom Nav for Partner / Employee ── */
const PARTNER_TABS = [
  { href: "/dashboard", label: "홈", icon: "home" },
  { href: "/projecthub", label: "프로젝트", icon: "briefcase" },
  { href: "/documents", label: "서류", icon: "file" },
  { href: "/chat", label: "메신저", icon: "chat" },
  { href: "/guide", label: "가이드", icon: "book" },
];
// (2026-07-30 개편 P2) EMPLOYEE_TABS 삭제 — 화면 한 벌: 파트너 외 전원 OWNER_TABS(권한 필터).
const OWNER_TABS = [
  { href: "/dashboard", label: "대시보드", icon: "home" },
  // PR5: owner 의 모바일 진입도 /projects 칸반으로
  { href: "/projecthub", label: "프로젝트", icon: "briefcase" },
  { href: "/payments", label: "결제", icon: "card" },
  { href: "/chat", label: "메신저", icon: "chat" },
  { href: "/mypage", label: "마이", icon: "user" },
];

function BottomTabIcon({ name, active }: { name: string; active: boolean }) {
  const cn = `mobile-bottom-nav-icon ${active ? "mobile-bottom-nav-icon-active" : ""}`;
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
    case "user": return <svg {...p}><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/></svg>;
    default: return null;
  }
}

function MobileBottomNav() {
  const { role } = useUser();
  const { isMaster, hasMenu } = useMyPermissions();
  const pathname = usePathname();
  const tabs = role === "partner"
    ? PARTNER_TABS
    : OWNER_TABS.filter((t) => isMaster || hasMenu(t.href));

  return (
    // 모바일 첫진입 발견성 — 5개 핵심 메뉴를 같은 폭으로 배치하고 현재 메뉴는 배경까지 강조.
    <nav className="mobile-bottom-nav safe-area-bottom">
      <div className="mobile-bottom-nav-items">
        {tabs.map((tab) => {
          const active = pathname === tab.href || pathname.startsWith(tab.href + "/");
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`mobile-bottom-nav-link ${active ? "mobile-bottom-nav-link-active" : ""}`}
            >
              <BottomTabIcon name={tab.icon} active={active} />
              <span className={`mobile-bottom-nav-label ${active ? "mobile-bottom-nav-label-active" : ""}`}>{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/* ── Role-based route guard ── */
const ROLE_ALLOWED_ROUTES: Record<string, string[]> = {
  partner: ["/dashboard", "/projects", "/documents", "/chat", "/guide", "/notifications", "/mypage", "/announcements", "/board", "/error-logs", "/operator-users"],
  // (2026-07-30 개편 P2) employee 허용목록 삭제 — 권한 기반 가드로 대체. 파트너만 목록 유지.
};

function RouteGuard({ children }: { children: React.ReactNode }) {
  const { role, user, loading } = useUser();
  const pathname = usePathname();
  const router = useRouter();
  // (2026-07-30 개편 P2) 권한 기반 가드 — 마스터는 전체, 멤버는 부여받은 메뉴 + 기본 제공만.
  const { isMaster, hasPerm, loading: permsLoading } = useMyPermissions();

  // 온보딩 미완료 직원 → 자동 완료 처리 (직원은 회사 온보딩 대상 아님)
  useEffect(() => {
    if (loading || !user || role !== "employee") return;
    (async () => {
      const emp = logRead('(app)/app-shell:emp', await supabase
        .from("employees")
        .select("onboarding_completed_at, status")
        .eq("user_id", user.id)
        .maybeSingle());
      if (emp && !emp.onboarding_completed_at && (emp.status === "joined" || emp.status === "contract_pending")) {
        // 직원은 회사 온보딩(사업자/계좌/프로젝트 등록)을 할 필요 없으므로 자동 완료 처리
        await supabase
          .from("employees")
          .update({ onboarding_completed_at: new Date().toISOString() })
          .eq("user_id", user.id);
      }
    })();
  }, [loading, user, role, pathname, router]);

  useEffect(() => {
    if (loading || permsLoading) return;
    if (role === "partner") {
      const allowed = ROLE_ALLOWED_ROUTES.partner;
      const inBase = allowed.some((r) => pathname === r || pathname.startsWith(r + "/"));
      if (!inBase) router.replace("/dashboard");
      return;
    }
    if (isMaster) return; // 마스터 전체 접근
    const route = matchCatalogRoute(pathname);
    if (route && !hasPerm(route)) {
      // 대시보드 권한이 없으면 마이페이지로 (리다이렉트 루프 방지)
      router.replace(hasPerm("/dashboard") ? "/dashboard" : "/mypage");
    }
  }, [role, pathname, loading, permsLoading, isMaster, hasPerm, router]);

  // 로딩 중이면 렌더링 차단 (비허용 페이지 깜빡임 방지)
  if (loading) return null;
  if (role === "partner") {
    const allowed = ROLE_ALLOWED_ROUTES.partner;
    const inBase = allowed.some((r) => pathname === r || pathname.startsWith(r + "/"));
    if (!inBase) return null;
    return <>{children}</>;
  }
  if (isMaster) return <>{children}</>;
  if (permsLoading) return null;
  const route = matchCatalogRoute(pathname);
  if (route && !hasPerm(route)) {
    return <AccessDenied detail="이 메뉴에 접근 권한이 없습니다. 마스터에게 권한을 요청하세요." />;
  }
  return <>{children}</>;
}

/* 세무사 열람 배너 — 회사 전환 드롭다운 포함 (2026-08-11 잔손질: 포털을 거치지 않고 앱 안에서 전환) */
function AdvisorViewingBanner({ companyName }: { companyName: string }) {
  const [companies, setCompanies] = useState<{ company_id: string; company_name: string }[]>([]);
  useEffect(() => {
    (async () => {
      try {
        const { data } = await (supabase as any).rpc("advisor_my_companies");
        setCompanies(((data || []) as any[]).map((c) => ({ company_id: c.company_id, company_name: c.company_name })));
      } catch { /* 목록 실패 시 전환 없이 배너만 */ }
    })();
  }, []);
  const switchCompany = async (companyId: string) => {
    const { error } = await (supabase as any).rpc("advisor_enter_company", { p_company_id: companyId });
    if (!error) {
      const { clearCurrentUserCache } = await import("@/lib/queries");
      clearCurrentUserCache();
      window.location.href = "/dashboard";
    }
  };
  return (
    <div className="advisor-viewing-banner">
      <span className="advisor-viewing-dot" />
      {companies.length > 1 ? (
        <select
          className="advisor-viewing-select"
          value={companies.find((c) => c.company_name === companyName)?.company_id || ""}
          onChange={(e) => e.target.value && switchCompany(e.target.value)}
        >
          {companies.map((c) => <option key={c.company_id} value={c.company_id}>{c.company_name}</option>)}
        </select>
      ) : (
        <span className="font-bold">{companyName}</span>
      )}
      <span> 열람 모드 — 세무사 파트너 계정은 읽기 전용입니다.</span>
      <a href="/advisor/dashboard" className="advisor-viewing-back">← 파트너 포털로</a>
    </div>
  );
}

function AppContent({ children }: { children: React.ReactNode }) {
  const { collapsed, setMobileOpen } = useSidebar();
  const { open: guideOpen } = useGuide();
  const { role, user } = useUser();
  const pathname = usePathname();
  const isLimitedRole = role === "partner"; // (P3) 멤버는 전원 동일 레이아웃
  const [mutationError, setMutationError] = useState<string | null>(null);

  // 팝업 임베드 모드 — 메뉴 팝업 iframe(`?embed=1`)로 열렸을 땐 셸 크롬(사이드바/헤더/네비/플로팅) 숨기고
  //   페이지 본문만 렌더. useState 지연 초기화로 최초 마운트 시 1회 확정(iframe 내부 이동에도 유지).
  const [isEmbed] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("embed") === "1");

  // 라운드6.5 TeamHub 헤더바 — 브레드크럼. 알림 벨 배지/최근목록은 NotificationBell 컴포넌트가 자체 관리.
  const crumb = getRouteCrumb(pathname);

  // P0-D: 모바일 햄버거 first-time hint — 첫 진입 한 번만 펄스 + 작은 툴팁.
  //   localStorage 키 'hint:hamburger' 가 비어있을 때만 활성, 클릭하면 dismiss.
  const [hamburgerHint, setHamburgerHint] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (!localStorage.getItem("hint:hamburger") && !isLimitedRole) {
        setHamburgerHint(true);
        // 6초 후 자동 dismiss(영구). 사용자가 그동안 봤으면 충분.
        const t = setTimeout(() => {
          try { localStorage.setItem("hint:hamburger", "1"); } catch {}
          setHamburgerHint(false);
        }, 6000);
        return () => clearTimeout(t);
      }
    } catch {}
  }, [isLimitedRole]);
  const dismissHint = () => {
    try { localStorage.setItem("hint:hamburger", "1"); } catch {}
    setHamburgerHint(false);
  };

  const companyId = user?.company_id ?? null;
  // 2026-06-10 CODEF 과금 통제 — app-shell 자동 동기화(앱 열때·30분 주기) 전면 제거.
  //   탭·기기·새로고침마다 곱해지는 변동비라, 비용을 예측가능하게 cron+수동으로 일원화(사장님 결정).
  //   · 정기 자동 갱신: 서버 cron — 은행 bank-sync-tick(하루 2회 0 1,13) + 카드 card-sync-tick(하루 2회 0 4,16)
  //   · 최신 필요 시: 각 페이지(통장/카드/대시보드/설정) '동기화' 버튼 = 수동, 누를 때만 과금
  //   → 앱을 켜두거나 새로고침해도 자동 CODEF 호출 0.

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

  // ── 팝업 임베드 모드 — 크롬 없이 본문만(권한·구독 게이트는 유지) ──
  if (isEmbed) {
    return (
      <div className="embed-page min-h-screen p-4 md:p-5">
        <div className="app-content-scale w-full">
          <RouteGuard>
            <SubscriptionGate>{children}</SubscriptionGate>
          </RouteGuard>
        </div>
      </div>
    );
  }

  return (
    // 새 디자인 시스템(시안) — 전 페이지 공통 배경: 그라데이션 + 점 패턴 + 그라데이션 orbs.
    //   fixed/-z-10/pointer-events-none 레이어라 스크롤·클릭·레이아웃 무영향, 39개 전 페이지 공통.
    //   카드(bg-card 솔리드)가 이 배경 위에 떠 보이는 granter/시안 룩을 일괄 부여.
    <div className="relative flex min-h-screen">
      {/* 전역 모달 가드 — 어떤 모달이든 바깥 클릭 시 입력값 있으면 '취소하시겠습니까?' 확인 */}
      <GlobalModalGuard />
      {/* dev 환경 표시 — 운영(owner-view.com)과 혼동 방지. NEXT_PUBLIC_APP_ENV=development 일 때만. */}
      {isDev && (
        <div className="fixed bottom-2 left-2 z-[100] px-2.5 py-1 rounded-full bg-amber-500 text-black text-[10px] font-extrabold shadow-lg pointer-events-none select-none tracking-wide">
          DEV 환경 · 운영 데이터 아님
        </div>
      )}
      {/* 2026-07-03 TeamHub 라운드 — 배경 레이어(점 패턴+오로라 orbs) 제거.
          body 가 플랫 소프트 틴트(--bg)를 직접 칠해 흰 카드가 떠 보이는 캔버스가 됨. */}
      <Sidebar />
      {/* 라운드6.5 TeamHub 헤더바 — 좌: 브레드크럼+타이틀 / 우: 검색 필·알림 벨·도움말·프로필 칩 */}
      <header
        className={`chrome-glass absolute top-0 md:top-3 z-30 h-16 flex items-center gap-2 md:gap-3 px-3 md:px-6 border-b md:border border-[var(--border)]/60 md:rounded-[20px] transition-all duration-200 ${
          collapsed ? "md:left-[100px]" : "md:left-[292px]"
        } left-0 right-0 ${guideOpen ? "md:right-[412px]" : "md:right-3"}`}
      >
        {/* Left: Mobile hamburger — hide for limited roles on mobile (they use bottom nav) */}
        <div className={`${isLimitedRole ? "hidden" : "md:hidden"} relative shrink-0`}>
          <button
            onClick={() => { dismissHint(); setMobileOpen(true); }}
            className={`p-2 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-surface)] transition ${hamburgerHint ? "ring-2 ring-[var(--primary)] animate-pulse" : ""}`}
            style={{ boxShadow: "var(--shadow-sm)" }}
            aria-label="메뉴 열기"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          {hamburgerHint && (
            <div className="absolute top-full left-0 mt-1 px-2.5 py-1.5 rounded-lg bg-[var(--primary)] text-white text-[11px] font-medium whitespace-nowrap shadow-lg z-50 flex items-center gap-1.5">
              <span>👆 여기를 눌러 전체 메뉴</span>
              <button onClick={dismissHint} className="ml-1 opacity-80 hover:opacity-100" aria-label="안내 닫기">✕</button>
            </div>
          )}
        </div>
        {/* Logo for limited roles on mobile — U1: 클릭 → /dashboard */}
        {isLimitedRole && (
          <Link href="/dashboard" className="md:hidden flex items-center gap-2 hover:opacity-80 transition shrink-0" aria-label="대시보드로 이동">
            <OwnerViewIcon size={24} />
          </Link>
        )}

        {/* 브레드크럼 + 페이지 타이틀 (레퍼런스: Dashboard › Employees 스타일) */}
        <div className="flex-1 min-w-0">
          {crumb ? (
            <>
              {crumb.group && (
                <div className="hidden md:block text-[11px] leading-4 text-[var(--text-dim)] truncate">
                  {crumb.group} <span className="mx-0.5">›</span>
                </div>
              )}
              <div className="text-[15px] md:text-base font-bold text-[var(--text)] leading-5 truncate">{crumb.title}</div>
            </>
          ) : (
            <div className="text-[15px] md:text-base font-bold text-[var(--text)] truncate">
              {user?.companies?.name || ""}
            </div>
          )}
        </div>

        {/* 검색 필 — 데스크톱은 pill, 모바일은 아이콘 */}
        <button
          onClick={() => openGlobalSearch()}
          className="hidden md:flex items-center gap-2 w-56 lg:w-72 px-3.5 py-2 rounded-full bg-[var(--bg-card)] border border-[var(--border)] text-xs text-[var(--text-dim)] hover:border-[var(--primary)] hover:text-[var(--text-muted)] transition shrink-0"
          aria-label="검색"
        >
          <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" strokeLinecap="round" />
          </svg>
          <span className="flex-1 text-left">무엇이든 검색</span>
          <kbd className="text-[9px] bg-[var(--bg-surface)] px-1.5 py-0.5 rounded border border-[var(--border)]">⌘K</kbd>
        </button>
        <button
          onClick={() => openGlobalSearch()}
          className="md:hidden p-2 rounded-full bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-muted)] shrink-0"
          aria-label="검색"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" strokeLinecap="round" />
          </svg>
        </button>

        {/* 알림 벨 — 클릭 시 현재 페이지 유지, 최근 알림 팝오버 (전체보기 → /notifications) */}
        <NotificationBell />

        {/* 이 메뉴 도움말 '?' 토글 */}
        <MenuGuide />

        {/* 프로필 칩 — 클릭 시 현재 페이지 유지, 내 계정 상태 팝오버 (마이페이지로 이동 버튼) */}
        <AccountChip />
      </header>

      {/* Main content */}
      <main
        className={`flex-1 min-w-0 transition-[margin] duration-200 pt-[80px] md:pt-[88px] ${
          collapsed ? "md:ml-[88px]" : "md:ml-[280px]"
        } ml-0 ${guideOpen ? "md:mr-[412px]" : ""} ${isLimitedRole ? "p-4 pb-20 md:p-6 md:pl-3 md:pr-3 md:pb-3" : "p-6 pb-20 md:pb-3 md:pr-3 md:pl-3"}`}
      >
        {/* 2026-07-14 콘텐츠 좌측 정렬 + 우측 여백 + 전체 축소(사장님 요청, 오너뷰사이즈.PNG).
            max-width 로 좌측 정렬(오른쪽 여백) + zoom 으로 스퀘어·글씨를 전체적으로 살짝 작게.
            폼·문서 등 자체 --content-max 페이지는 그 안에서 추가 제한되므로 영향 없음. */}
        <div className="app-content-scale w-full">
          {/* 페이지 제목·설명은 상단 크롬 헤더바(브레드크럼)에서 표시 — 본문 중복 제목 없음. */}
          {/* 세무사 열람 모드 (2026-08-11): 파트너 세무사가 포털에서 회사를 골라 들어온 세션.
              DB 가 전면 쓰기차단(advisor_ro_*)이므로 저장·수정 버튼은 동작하지 않는다는 안내. */}
          {role === "advisor" && <AdvisorViewingBanner companyName={(user as any)?.companies?.name || "고객사"} />}
          {/* 파이낸스 허브(거래처/세금·증빙/거래 장부) 하위 탭 — 해당 라우트에서만 렌더(그 외 null) */}
          <FinanceTabs />
          {/* 유료 출시 게이트(2026-06-11): trial D-N 배너 + 만료/해지 페이월. 운영자·레거시(구독행 없음) 비차단. */}
          <RouteGuard>
            <SubscriptionGate>{children}</SubscriptionGate>
          </RouteGuard>
        </div>
      </main>
      {/* 우측 상세 메뉴 가이드 드로어 — '?' 토글 시 본문이 밀리고 여기 열림 */}
      <MenuGuideDrawer />
      <MobileBottomNav />
      <GlobalSearch />
      {/* 플로팅 팝업 메신저 — 영속 셸 마운트(페이지 이동에도 유지). 데스크톱 전용, /chat 에선 숨김. */}
      <FloatingMessenger />
      {/* 메뉴 팝업 창 — 사이드바에서 팝업으로 연 메뉴들(드래그·최소/최대/닫기). 셸 상주로 페이지 이동에도 유지. */}
      <PopupWindowsHost />
      {/* 첫 가입 탭 투어 — 셸 상주라 투어 중 다른 화면으로 가도 유지, 새로고침도 sessionStorage 로 이어감 (2026-08-10) */}
      <AppTourHost companyId={companyId} />
      {/* 데이터 제공사(헥토데이터) 점검 안내 팝업 — 2026-08-27 09:00 KST 지나면 저절로 안 뜸 (2026-08-25) */}
      <MaintenanceNoticeHost />
      {/* 중복 로그인 방지 — 다른 기기 로그인 시 이 기기 즉시 로그아웃 (2026-08-11) */}
      <SingleSessionGuard />
      {/* 회사별 접속 허용 IP 제한 — 설정을 켠 회사만 (2026-08-11) */}
      <IpGate />
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
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) { router.replace("/auth"); return; }
      // 2026-07-28 P0: 세션만 보고 통과시키면 회사 설정을 마치지 않은 계정(구글 OAuth 후
      //   /company-setup 이탈, users 행 없음)이 모든 앱 페이지에서 무한 "불러오는 중"에 갇힌다.
      //   users 행·company_id 가 없으면 회사 설정으로 보낸다 — /company-setup 은 (app) 밖이고
      //   회사가 이미 있으면 스스로 /dashboard 로 돌려보내므로 루프 없음.
      const { getCurrentUser } = await import("@/lib/queries");
      const u = await getCurrentUser().catch(() => null);
      if (!u) {
        // 세무사 계정(users 행 없음)이 회사 미선택/연결 해제 상태로 앱에 오면
        //   회사 개설이 아니라 파트너 포털로 보낸다 (2026-08-11).
        const { data: adv } = await (supabase as any)
          .from("tax_advisors").select("id").eq("auth_id", data.session.user.id).maybeSingle();
        router.replace(adv ? "/advisor" : "/company-setup");
        return;
      }
      setReady(true);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") { import("@/lib/queries").then(m => m.clearCurrentUserCache()); router.replace("/auth"); }
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
      <ConsentGate>
      <SidebarProvider>
        <BoardProvider>
          <PopupProvider>
            <GuideProvider>
              {/*   ★ 앱 전체 글자 키우기 (2026-08-26 사장님: "전체 글자가 너무 작다는 평 — 2px 정도") — 값 하나(.app-zoom)로 사이드바·머리·본문이 같이 커진다.
                    랜딩·온보딩은 이 껍데기 밖이라 그대로. */}
              <div className="app-zoom"><AppContent>{children}</AppContent></div>
            </GuideProvider>
          </PopupProvider>
          {/* 페이지 무관 백그라운드 sync chain — 어떤 페이지에서든 작동 */}
          <HometaxBackgroundChain />
        </BoardProvider>
      </SidebarProvider>
      </ConsentGate>
    </UserProvider>
  );
}
