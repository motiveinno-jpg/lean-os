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
        {CARDS.map((c) => (
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
