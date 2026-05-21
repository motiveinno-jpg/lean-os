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
  {
    href: "/reports/by-person",
    title: "인원별 지출",
    desc: "직원(법인카드 소유자)별로 카드 사용액과 급여를 합산해 인당 비용을 봅니다.",
    accent: "#8b5cf6",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 00-3-3.87" />
        <path d="M16 3.13a4 4 0 010 7.75" />
      </svg>
    ),
  },
  // 사용자 핸드오프: /matching 사이드바 제거 → 분석 허브에서만 진입.
  {
    href: "/matching",
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
  // 2026-05-21 사장님 요청: 3-Way 매칭 전용 페이지 신설.
  //   세금계산서 ↔ 거래처 ↔ 입출금 자동 추천 (거래처명·대표자명·금액±10%).
  {
    href: "/reports/three-way-match",
    title: "3-Way 매칭",
    desc: "세금계산서 ↔ 거래처 ↔ 입출금 자동 추천 (거래처명·대표자명·금액±10%).",
    accent: "#ec4899",
    roles: ["owner", "admin"],
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="16 3 21 3 21 8" />
        <line x1="4" y1="20" x2="21" y2="3" />
        <polyline points="21 16 21 21 16 21" />
        <line x1="15" y1="15" x2="21" y2="21" />
        <line x1="4" y1="4" x2="9" y2="9" />
      </svg>
    ),
  },
];

export default function ReportsHubPage() {
  const { role } = useUser();

  if (role === "employee" || role === "partner") {
    return <AccessDenied detail="회계 분석 허브는 대표·관리자 전용입니다." />;
  }

  return (
    <div style={{ padding: "24px 28px", maxWidth: 1100 }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", margin: 0, lineHeight: 1.3 }}>
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
              padding: "20px 22px",
              borderRadius: 14,
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
