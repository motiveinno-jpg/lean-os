"use client";

// 분석(회계 리포트) 공통 상단 서브탭 — 경영흐름/손익/재무상태/비용을 되돌아가지 않고 바로 전환.
//   사이드바 "분석" 하나로 진입 → 이 탭바로 4종 자유 이동. (설정 2단 탭과 동일 패턴)
//   입금 자동매칭은 사이드바 "거래 매칭"으로 접근하므로 여기 미포함.

import Link from "next/link";
import { usePathname } from "next/navigation";

const REPORT_TABS = [
  { href: "/reports/flow", label: "경영 흐름" },
  { href: "/reports/pnl", label: "손익계산서" },
  { href: "/reports/bs", label: "재무상태표" },
  { href: "/reports/costs", label: "비용 분석" },
];

export function ReportsTabs() {
  const pathname = usePathname() || "";
  return (
    <div className="no-print flex flex-wrap gap-1.5 mb-5">
      {REPORT_TABS.map((t) => {
        const active = pathname === t.href || pathname.startsWith(t.href + "/");
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
