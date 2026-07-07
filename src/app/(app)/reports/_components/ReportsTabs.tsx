"use client";

// 분석(회계 리포트) 공통 상단 서브탭 — 대표 친화 개편(2026-07-08).
//   회계 용어 대신 대표가 아는 표준 비즈니스어로: 경영 요약 / 매출 현황 / 비용 현황 / 경영 흐름 / 회계 자료.
//   정식 재무제표(손익·재무상태·비용분석)는 "회계 자료" 아래로. 사이드바 "분석" 하나로 진입.

import Link from "next/link";
import { usePathname } from "next/navigation";

// 회계 자료 탭은 정식 재무제표 페이지에서도 활성으로 보이도록 매칭 경로를 함께 지정.
const STATEMENT_ROUTES = ["/reports/statements", "/reports/pnl", "/reports/bs", "/reports/costs", "/reports/by-person", "/reports/three-way-match"];

const REPORT_TABS: { href: string; label: string; match?: string[] }[] = [
  { href: "/reports/summary", label: "경영 요약" },
  { href: "/reports/revenue", label: "매출 현황" },
  { href: "/reports/expense", label: "비용 현황" },
  { href: "/reports/flow", label: "경영 흐름" },
  { href: "/reports/statements", label: "회계 자료", match: STATEMENT_ROUTES },
];

export function ReportsTabs() {
  const pathname = usePathname() || "";
  const isActive = (t: { href: string; match?: string[] }) => {
    const paths = t.match || [t.href];
    return paths.some((p) => pathname === p || pathname.startsWith(p + "/"));
  };
  return (
    <div className="no-print flex flex-wrap gap-1.5 mb-5">
      {REPORT_TABS.map((t) => {
        const active = isActive(t);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`px-3.5 py-1.5 rounded-full text-[13px] font-semibold no-underline transition ${
              active
                ? "bg-[var(--primary)] text-white shadow-sm"
                : "bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--primary)]"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
