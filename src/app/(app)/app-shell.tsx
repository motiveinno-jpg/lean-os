"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { GlobalModalGuard } from "@/components/global-modal-guard";
import { supabase } from "@/lib/supabase";
import { Sidebar } from "@/components/sidebar";
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
import { SubscriptionGate } from "@/components/subscription-gate";
import { AccessDenied } from "@/components/access-denied";
import { useMyTabOverrides, effectiveTabAccess, matchGrantableRoute } from "@/lib/tab-access";
import { isDev } from "@/lib/app-env";

/* ── Mobile Bottom Nav for Partner / Employee ── */
const PARTNER_TABS = [
  { href: "/dashboard", label: "홈", icon: "home" },
  { href: "/projecthub", label: "프로젝트", icon: "briefcase" },
  { href: "/documents", label: "서류", icon: "file" },
  { href: "/chat", label: "메신저", icon: "chat" },
  { href: "/guide", label: "가이드", icon: "book" },
];
const EMPLOYEE_TABS = [
  { href: "/dashboard", label: "홈", icon: "home" },
  { href: "/attendance", label: "근태", icon: "clock" },
  { href: "/leave", label: "휴가", icon: "umbrella" },
  { href: "/chat", label: "메신저", icon: "chat" },
  { href: "/documents", label: "서류", icon: "file" },
];
const OWNER_TABS = [
  { href: "/dashboard", label: "대시보드", icon: "home" },
  // PR5: owner 의 모바일 진입도 /projects 칸반으로
  { href: "/projecthub", label: "프로젝트", icon: "briefcase" },
  { href: "/payments", label: "결제", icon: "card" },
  { href: "/chat", label: "메신저", icon: "chat" },
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
    // P0-D: 모바일 첫진입 발견성 — 라벨 10px→12px(text-xs) 가독성 회복,
    //   탭 높이 56→60px 로 살짝 키워 손가락 타깃 + 라벨 균형 확보.
    <nav className="chrome-glass md:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-[var(--border)]/60 safe-area-bottom" style={{ boxShadow: "0 -4px 16px rgba(0,0,0,0.06)" }}>
      <div className="flex items-center justify-around h-[60px] px-1">
        {tabs.map((tab) => {
          const active = pathname === tab.href || pathname.startsWith(tab.href + "/");
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`flex flex-col items-center justify-center gap-1 flex-1 py-1 min-w-0 min-h-[44px] transition-colors ${active ? "text-[var(--primary)]" : "text-[var(--text-muted)]"}`}
            >
              <BottomTabIcon name={tab.icon} active={active} />
              <span className={`text-xs font-medium truncate ${active ? "text-[var(--primary)] font-semibold" : ""}`}>{tab.label}</span>
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
  // 직원 화면 — 홈 / 나의 업무 / 소통·도움말 로 압축. 거래처·프로젝트·회계 미노출.
  //   /employees 는 사이드바에서 제거됐지만 경비·증명서 딥링크 fallback 으로 접근 허용.
  employee: [
    "/dashboard",
    "/schedule",       // 일정 / 할 일
    "/projects",       // 직원 통일 (관리자와 동일 화면, /projects 안 isEmployeeLimited 가드로 재무 가림 + 본인 담당만)
    "/announcements",  // 공지사항 (전체 공개, 운영자만 작성)
    "/board",          // 회사 게시판 (구성원 글·댓글)
    "/error-logs",     // 에러 모니터링 (운영자 전용 — 페이지 내 이메일 게이트)
    "/operator-users", // 유저 계정 관리 (운영자 전용 — 페이지 내 이메일 게이트)
    "/notifications",  // 알림
    "/team",           // 팀 디렉토리 (직원용 read-only)
    "/attendance",     // 근태 / 출퇴근
    "/leave",          // 휴가 신청 (전용 라우트 — '인력관리>휴가 탭' 동선 미로 해소)
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
  // 탭 권한 명시 오버라이드(허용/차단). 실효 접근 판정에 사용(관리자도 명시 차단 가능).
  const { map: tabOverrides, loading: grantsLoading } = useMyTabOverrides();

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
        // 직원은 회사 온보딩(사업자/계좌/프로젝트 등록)을 할 필요 없으므로 자동 완료 처리
        await (supabase as any)
          .from("employees")
          .update({ onboarding_completed_at: new Date().toISOString() })
          .eq("user_id", user.id);
      }
    })();
  }, [loading, user, role, pathname, router]);

  useEffect(() => {
    if (loading) return;
    if (role === "owner") return; // 대표 전체 접근
    if (matchGrantableRoute(pathname)) return; // 부여 대상 → 화면에서 처리(차단 안내/허용)
    const allowed = ROLE_ALLOWED_ROUTES[role];
    if (!allowed) return; // admin → (부여대상 외) 전체 접근
    const inBase = allowed.some((r) => pathname === r || pathname.startsWith(r + "/"));
    if (!inBase) router.replace("/dashboard"); // employee/partner 비허용 경로
  }, [role, pathname, loading, router]);

  // 로딩 중이면 렌더링 차단 (비허용 페이지 깜빡임 방지)
  if (loading) return null;
  if (role === "owner") return <>{children}</>;

  // 부여 대상 라우트 — 실효 접근(명시 차단 시 관리자도 차단) 판정
  const grantable = matchGrantableRoute(pathname);
  if (grantable) {
    if (grantsLoading) return null;
    if (!effectiveTabAccess(grantable, role, tabOverrides)) {
      return <AccessDenied detail="이 메뉴에 접근 권한이 없습니다. 관리자/대표에게 권한을 요청하세요." />;
    }
    return <>{children}</>;
  }

  // 그 외: employee/partner 기본 허용목록 밖이면 차단
  const allowed = ROLE_ALLOWED_ROUTES[role];
  if (allowed) {
    const inBase = allowed.some((r) => pathname === r || pathname.startsWith(r + "/"));
    if (!inBase) return null;
  }

  return <>{children}</>;
}

function AppContent({ children }: { children: React.ReactNode }) {
  const { collapsed, setMobileOpen } = useSidebar();
  const { open: guideOpen } = useGuide();
  const { role, user } = useUser();
  const pathname = usePathname();
  const isLimitedRole = role === "partner" || role === "employee";
  const [mutationError, setMutationError] = useState<string | null>(null);

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
          collapsed ? "md:left-[92px]" : "md:left-[264px]"
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
                  {crumb.group} <span className="mx-0.5">›</span> {crumb.title}
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
          collapsed ? "md:ml-[92px]" : "md:ml-[264px]"
        } ml-0 ${guideOpen ? "md:mr-[412px]" : ""} ${isLimitedRole ? "p-4 pb-20 md:p-6 md:pl-8 md:pr-3 md:pb-3" : role === "owner" ? "p-6 pb-20 md:pb-3 md:pr-3 md:pl-8" : "p-6 md:pr-3 md:pb-3 md:pl-8"}`}
      >
        {/* 2026-07-14 콘텐츠 좌측 정렬 + 우측 여백 + 전체 축소(사장님 요청, 오너뷰사이즈.PNG).
            max-width 로 좌측 정렬(오른쪽 여백) + zoom 으로 스퀘어·글씨를 전체적으로 살짝 작게.
            폼·문서 등 자체 --content-max 페이지는 그 안에서 추가 제한되므로 영향 없음. */}
        <div className="app-content-scale w-full max-w-[1440px]" style={{ zoom: 0.97 }}>
          {/* 페이지 제목·설명은 상단 크롬 헤더바(브레드크럼)에서 표시 — 본문 중복 제목 없음. */}
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
      <SidebarProvider>
        <BoardProvider>
          <GuideProvider>
            <AppContent>{children}</AppContent>
          </GuideProvider>
          {/* 페이지 무관 백그라운드 sync chain — 어떤 페이지에서든 작동 */}
          <HometaxBackgroundChain />
        </BoardProvider>
      </SidebarProvider>
    </UserProvider>
  );
}
