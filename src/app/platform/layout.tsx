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
// 로컬 개발 미리보기 (2026-09-03) — 디자인 확인용. `next dev` 에서 NEXT_PUBLIC_PLATFORM_DEV_PREVIEW=1 일 때만
//   게이트를 건너뛴다. 프로덕션 빌드(NODE_ENV=production)에서는 어떤 값을 줘도 절대 열리지 않고,
//   서버 RPC 는 여전히 is_platform_operator() 로 막혀 데이터는 보이지 않는다(껍데기만 확인).
const DEV_PREVIEW = process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_PLATFORM_DEV_PREVIEW === "1";

// OP-A 메뉴 섹션화: 비즈니스(매출/고객) + 운영(평균/업계/에러/의존성/사고/감사)
type NavGroup = { title: string; items: { href: string; label: string; icon: string; hint?: string }[] };
const NAV_GROUPS: NavGroup[] = [
  {
    // 2026-07-28 전면 정비: 목적별 4그룹 — 고객(누가 쓰나)/매출(돈)/지원(응대)/운영(상태·분석)
    title: "고객",
    items: [
      { href: "/platform", label: "개요", icon: "chart", hint: "오늘의 전체 상황" },
      { href: "/platform/customers", label: "고객사", icon: "building", hint: "가입 회사 목록" },
      { href: "/platform/members", label: "사용자", icon: "users", hint: "계정·활동" },
    ],
  },
  {
    title: "매출",
    items: [
      { href: "/platform/revenue", label: "수익", icon: "dollar", hint: "MRR·구독" },
      { href: "/platform/marketing", label: "마케팅 지표", icon: "trending", hint: "방문·가입 퍼널" }, // GA4 병행 자체 퍼널 (2026-08-13)
      { href: "/platform/sales-codes", label: "영업코드", icon: "link", hint: "코드별 전환" },
    ],
  },
  {
    title: "지원",
    items: [
      { href: "/platform/support", label: "고객센터", icon: "headset", hint: "문의 답변" },
      { href: "/platform/partnership", label: "도입문의", icon: "inbox", hint: "새 고객 문의" },
      { href: "/platform/advisors", label: "제휴 세무사", icon: "users", hint: "자문 연결" },
      { href: "/platform/announcements", label: "공지사항", icon: "message", hint: "고객 공지" },
    ],
  },
  {
    title: "운영",
    items: [
      // 에러해석·의존성·사고기록·감사로그 4개 → "시스템 상태" 1개 (기존 라우트는 유지, 메뉴만 통합)
      { href: "/platform/health", label: "시스템 상태", icon: "alert", hint: "오류·상태" },
      { href: "/platform/codef-usage", label: "CODEF 사용량", icon: "chart", hint: "수집 API 비용" },
      { href: "/platform/averages", label: "재무평균", icon: "trending", hint: "고객 평균 지표" },
      { href: "/platform/industry", label: "업계분석", icon: "layers", hint: "업종별 비교" },
    ],
  },
  {
    title: "시스템",
    items: [
      { href: "/platform/system", label: "시스템", icon: "cog", hint: "관리 도구" },
    ],
  },
];

function NavIcon({ type, active }: { type: string; active: boolean }) {
  const cls = `pf-nav-icon ${active ? "text-white" : "text-[var(--text-dim)]"}`;
  const props = { className: cls, fill: "none", stroke: "currentColor", strokeWidth: 1.8, viewBox: "0 0 24 24", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
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
    default: return null;
  }
}

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  // trailingSlash 설정으로 "/platform/" 처럼 끝에 / 가 붙어 온다 — 메뉴 활성 판정은 슬래시를 뗀 값으로.
  const pathname = (usePathname() || "/platform").replace(/\/+$/, "") || "/platform";
  const [status, setStatus] = useState<"loading" | "ready" | "denied">("loading");
  const [userName, setUserName] = useState("");
  // 저장/수정 실패 배너 — 앱 셸과 동일. 운영자 콘솔은 별도 레이아웃이라 글로벌
  // MutationCache 오류 이벤트를 아무도 안 받아 완전 무음이었다(2026-07-29 결함류 소탕).
  const [mutationError, setMutationError] = useState<string | null>(null);
  useEffect(() => {
    let lastAt = 0;
    function handler(e: Event) {
      const now = Date.now();
      if (now - lastAt < 1500) return; // 같은 실패에 두 이벤트가 울려도 한 번만
      lastAt = now;
      const msg = (e as CustomEvent).detail as string;
      setMutationError(msg);
      setTimeout(() => setMutationError(null), 5000);
    }
    window.addEventListener("ownerview:mutation-error", handler);
    window.addEventListener("ownerview:db-write-error", handler);
    return () => {
      window.removeEventListener("ownerview:mutation-error", handler);
      window.removeEventListener("ownerview:db-write-error", handler);
    };
  }, []);

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
        if (DEV_PREVIEW) { setUserName((user?.name || "미리보기") + " (개발 미리보기)"); setStatus("ready"); return; }
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

  //   세션이 도중에 바뀌면(다른 탭에서 다른 계정 로그인 등) 게이트를 다시 검사한다 (2026-09-01) —
  //   운영자로 열어 둔 페이지가 비운영자 세션으로 RPC 를 쏴 401 여섯 발이 에러 로그에 쌓였다.
  //   비운영자 세션이 감지되면 화면을 내리므로(denied) 하위 쿼리도 함께 언마운트된다.
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      const email = session?.user?.email || "";
      if (DEV_PREVIEW) return;
      if (!session || !isOperatorEmail(email)) setStatus("denied");
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // 상단바 시계 — 운영자 화면은 "지금"이 중요하다(1분 갱신).
  const [clock, setClock] = useState<Date | null>(null);
  useEffect(() => {
    setClock(new Date());
    const t = setInterval(() => setClock(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

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
  const currentGroup = NAV_GROUPS.find((g) => g.items.some((i) => i === currentItem));
  const logout = async () => { await supabase.auth.signOut(); router.replace("/auth"); };
  const initial = (userName || "O").trim().charAt(0).toUpperCase();

  return (
    // 2026-09-03 운영자 v2 — 유리 셸 + 오로라 캔버스(.pf-canvas) + 그라데이션 활성 메뉴 + 시계·빵부스러기 상단바.
    //   (역사) 2026-07-03 다크 콘솔 → 라이트 토큰, 2026-07-06 리퀴드글래스, 2026-07-28 톱바·모바일 칩 내비.
    <div className="min-h-screen flex pf-canvas">
      {/* 사이드바 — 떠 있는 유리 패널, 그룹별 메뉴 + 활성 항목 그라데이션 필 */}
      <aside className="pf-sidebar">
        <div className="p-5 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[var(--primary)] to-[#7C3AED] flex items-center justify-center shadow-[0_10px_24px_-12px_var(--primary)]">
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

        <nav className="flex-1 px-2.5 pb-3 space-y-1 overflow-y-auto">
          {NAV_GROUPS.map((group) => (
            <div key={group.title}>
              <div className="pf-nav-group-title">{group.title}</div>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const active =
                    pathname === item.href ||
                    (item.href !== "/platform" && pathname.startsWith(item.href)) ||
                    // 고객사 상세(/platform/companies/[id])는 "고객사" 메뉴 아래로 간주 — 상세에서 활성표시 유지
                    (item.href === "/platform/customers" && pathname.startsWith("/platform/companies"));
                  return (
                    <Link key={item.href} href={item.href} className={`pf-nav-item ${active ? "pf-nav-item-on" : ""}`} title={item.hint}>
                      <NavIcon type={item.icon} active={active} />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="p-4 border-t border-[var(--pf-card-border)]">
          <div className="flex items-center gap-2.5 mb-3">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[var(--primary)] to-[#7C3AED] flex items-center justify-center text-white text-xs font-bold shrink-0 shadow-[0_8px_18px_-10px_var(--primary)]">
              {initial}
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

      <main className="pf-main">
        {/* 상단바 — 빵부스러기 + 현재 화면명 · 시계 · 빠른 액션 */}
        <div className="pf-topbar">
          <div className="min-w-0">
            <div className="pf-crumb">
              <span>{currentGroup?.title || "Platform"}</span>
              {currentItem && <><span className="opacity-50">/</span><span className="text-[var(--text-muted)]">{currentItem.label}</span></>}
            </div>
            <h1 className="text-[15px] font-extrabold text-[var(--text)] truncate leading-tight">{currentItem?.label || "플랫폼"}</h1>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {clock && (
              <span className="hidden sm:inline-flex items-center gap-1.5 text-[11px] text-[var(--text-dim)] mono-number mr-1">
                <span className="pf-live" />
                {clock.toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", weekday: "short" })} {clock.toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
            <a href="https://www.owner-view.com" target="_blank" rel="noreferrer" className="pf-btn pf-btn-sm">사이트 보기 ↗</a>
            <button onClick={logout} className="pf-btn pf-btn-sm pf-btn-ghost hover:!text-[var(--danger)]">로그아웃</button>
          </div>
        </div>

        {/* 모바일 내비 — md 미만에서 사이드바 대신 가로 스크롤 칩 */}
        <nav className="pf-mobile-nav">
          {allNavItems.map((item) => {
            const active = item === currentItem;
            return (
              <Link key={item.href} href={item.href} className={`pf-chip ${active ? "pf-chip-on" : ""}`}>
                {item.label}
              </Link>
            );
          })}
        </nav>

        {mutationError && (
          <div role="alert" style={{ position: "fixed", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 999, background: "#dc2626", color: "#fff", padding: "10px 16px", borderRadius: 10, fontSize: 13, maxWidth: 560, boxShadow: "0 4px 16px rgba(0,0,0,0.25)" }}>
            저장에 실패했습니다 — {mutationError}
          </div>
        )}
        {/* 화면 전환 시 본문이 아래에서 떠오른다 — key 로 경로마다 재생 */}
        <div key={pathname} className="pf-in">
          {children}
        </div>
      </main>
      <GlobalConfirmHost />
    </div>
  );
}
