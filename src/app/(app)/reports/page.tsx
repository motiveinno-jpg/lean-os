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
    accent: "var(--primary)",
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
    accent: "#f97316",
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

  return (
    <div style={{ padding: "24px 28px", maxWidth: 1100 }}>
      {/* Header */}
      <div className="mb-6">
        <div className="text-[11px] font-semibold text-[var(--text-dim)] uppercase tracking-wider mb-1.5">Reports</div>
        <h1 className="text-2xl font-extrabold tracking-tight" style={{ color: "var(--text)", margin: 0 }}>
          회계 분석
        </h1>
        <p style={{ fontSize: 13, color: "var(--text-dim)", marginTop: 6 }}>
          재무제표와 비용 구조를 한 곳에서. 보고 싶은 분석을 선택하세요.
        </p>
      </div>

      {/* Cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: 16,
        }}
      >
        {CARDS.filter((c) => !c.roles || c.roles.includes(role as "owner" | "admin")).map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="group"
            style={{
              display: "block",
              padding: "22px 24px",
              borderRadius: 16,
              border: "1px solid var(--border)",
              background: "var(--bg-card)",
              textDecoration: "none",
              transition: "border-color 0.15s, transform 0.15s, box-shadow 0.15s",
            }}
            onMouseEnter={(e) => {
              const el = e.currentTarget as HTMLElement;
              el.style.borderColor = c.accent;
              el.style.transform = "translateY(-2px)";
              el.style.boxShadow = "var(--shadow-sm)";
            }}
            onMouseLeave={(e) => {
              const el = e.currentTarget as HTMLElement;
              el.style.borderColor = "var(--border)";
              el.style.transform = "translateY(0)";
              el.style.boxShadow = "none";
            }}
          >
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 11,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: `color-mix(in srgb, ${c.accent} 12%, transparent)`,
                color: c.accent,
                marginBottom: 14,
              }}
            >
              {c.icon}
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>
              {c.title}
            </div>
            <div style={{ fontSize: 12.5, color: "var(--text-dim)", lineHeight: 1.55 }}>
              {c.desc}
            </div>
            <div
              style={{
                marginTop: 14,
                fontSize: 12,
                fontWeight: 600,
                color: c.accent,
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              열기
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
