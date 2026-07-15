"use client";

// 회계 자료 하위 서브탭(2단) — 정식 재무제표(손익·재무상태·비용분석) 간 전환.
//   상단 ReportsTabs(경영요약·매출·비용·경영흐름·회계자료)의 "회계 자료" 아래 세부 탭.

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/reports/pnl", label: "손익계산서" },
  { href: "/reports/bs", label: "재무상태표" },
  { href: "/reports/costs", label: "비용 분석" },
];

export function StatementsTabs() {
  const pathname = usePathname() || "";
  return (
    <div className="statements-tabs-list no-print flex flex-wrap gap-1.5 -mt-2 mb-5">
      {TABS.map((t) => {
        const active = pathname === t.href || pathname.startsWith(t.href + "/");
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`statements-tab-link px-3 py-1 rounded-lg text-[12px] font-semibold no-underline transition ${
              active
                ? "bg-[var(--primary)]/12 text-[var(--primary)] border border-[var(--primary)]/30"
                : "bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
