"use client";

import Link from "next/link";
import { useUser } from "@/components/user-context";
import { AccessDenied } from "@/components/access-denied";

/* ------------------------------------------------------------------ */
/*  회계 › 분석 허브                                                    */
/*  bs/pnl/costs/by-person 4종 진입점. 기존 페이지는 재구현하지 않고     */
/*  여기서 링크만 모은다 (사이드바 "분석" → 이 페이지).                  */
/* ------------------------------------------------------------------ */

type HubCard = {
  href: string;
  title: string;
  desc: string;
  accent: string;
  icon: React.ReactNode;
  // 사용자 핸드오프: 입금 자동매칭 = owner 만, 3-Way = owner/admin.
  //   employee/partner 는 페이지 진입 자체가 AccessDenied 차단 (line 80) 이지만
  //   미래 안전망으로 카드 레벨에서도 한 번 더 필터.
  roles?: ("owner" | "admin")[];
};

const CARDS: HubCard[] = [
  // 2026-06-11 경영 통합: 영업→매출→수금→비용→손익→세무→결산 한 흐름.
  {
    href: "/reports/flow",
    title: "경영 흐름",
    desc: "영업 → 매출 → 수금 → 비용 → 손익 → 세금 → 결산. 회사 돈의 흐름을 한 줄로 봅니다.",
    accent: "#6366f1",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="5" cy="12" r="2.2" />
        <circle cx="12" cy="12" r="2.2" />
        <circle cx="19" cy="12" r="2.2" />
        <line x1="7.2" y1="12" x2="9.8" y2="12" />
        <line x1="14.2" y1="12" x2="16.8" y2="12" />
      </svg>
    ),
  },
  {
    href: "/reports/bs",
    title: "재무상태표",
    desc: "회사가 가진 자산·부채·자본을 한눈에. 현재 회사의 재무 건강 상태를 봅니다.",
    accent: "#3b82f6",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="20" x2="12" y2="10" />
        <line x1="18" y1="20" x2="18" y2="4" />
        <line x1="6" y1="20" x2="6" y2="16" />
      </svg>
    ),
  },
  {
    href: "/reports/pnl",
    title: "손익계산서",
    desc: "월별 매출과 비용, 그리고 최종 이익/손실을 추이로 확인합니다.",
    accent: "#10b981",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
        <polyline points="17 6 23 6 23 12" />
      </svg>
    ),
  },
  {
    href: "/reports/costs",
    title: "고정비 · 변동비",
    desc: "매달 꼭 나가는 돈(고정비)과 그때그때 바뀌는 돈(변동비)을 분리해 봅니다.",
    accent: "#f59e0b",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    ),
  },
  // 인원별 급여(/reports/by-person)·3-Way 매칭(/reports/three-way-match)은 분석 허브에서 제거(2026-06-29).
  //   페이지·코드는 유지하되 어디서도 링크하지 않음(사용자 요청).
  // 입금 자동매칭은 매칭허브(/partners/reconciliation)로 통일 — 분석 허브에서만 진입.
  {
    href: "/partners/reconciliation",
    title: "입금 자동매칭",
    desc: "통장 입금 ↔ 매출 일정·세금계산서를 자동 매칭. 미수금 회수 관리.",
    accent: "#06b6d4",
    roles: ["owner"],
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
      </svg>
    ),
  },
];

export default function ReportsHubPage() {
  const { role } = useUser();

  if (role === "partner") {
    return <AccessDenied detail="회계 분석 허브는 대표·관리자 전용입니다." />;
  }

  const visibleCards = CARDS.filter((c) => !c.roles || c.roles.includes(role as "owner" | "admin"));

  return (
    <div className="mx-auto max-w-[1100px] space-y-6 px-7 py-6">
      {/* Report launcher grid — 페이지 타이틀은 공통 헤더바(브레드크럼)가 표시 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visibleCards.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="group relative flex flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5 no-underline transition-all duration-150 hover:-translate-y-0.5 hover:border-[var(--primary)] hover:shadow-lg hover:shadow-[var(--primary)]/5"
          >
            {/* top accent glow */}
            <div
              aria-hidden
              className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full opacity-0 blur-2xl transition-opacity duration-200 group-hover:opacity-100"
              style={{ background: `color-mix(in srgb, ${c.accent} 18%, transparent)` }}
            />
            <div
              className="flex h-11 w-11 items-center justify-center rounded-xl"
              style={{
                background: `color-mix(in srgb, ${c.accent} 12%, transparent)`,
                color: c.accent,
              }}
            >
              {c.icon}
            </div>
            <div className="mt-4 text-[15px] font-bold text-[var(--text)]">{c.title}</div>
            <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-[var(--text-muted)]">
              {c.desc}
            </p>
            <div className="mt-auto flex items-center justify-end pt-4">
              <span
                className="inline-flex items-center gap-1 text-xs font-semibold transition-transform duration-150 group-hover:translate-x-0.5"
                style={{ color: c.accent }}
              >
                열기
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
