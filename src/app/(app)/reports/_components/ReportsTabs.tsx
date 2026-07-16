"use client";

// 분석(회계 리포트) 공통 상단 서브탭 — 대표 친화 개편(2026-07-08).
//   회계 용어 대신 대표가 아는 표준 비즈니스어로: 경영 요약 / 매출 현황 / 비용 현황 / 경영 흐름 / 회계 자료.
//   정식 재무제표(손익·재무상태·비용분석)는 "회계 자료" 아래로. 사이드바 "분석" 하나로 진입.

import Link from "next/link";
import { usePathname } from "next/navigation";

// 회계 자료 탭은 정식 재무제표 페이지에서도 활성으로 보이도록 매칭 경로를 함께 지정.
const STATEMENT_ROUTES = ["/reports/statements", "/reports/pnl", "/reports/bs", "/reports/costs", "/reports/by-person", "/reports/three-way-match"];

// 리포트형 표준 헤더 — 탭별 제목 + 한 줄 설명(desc). 여기 한 곳에서 전 리포트 페이지가 헤더를 얻음.
const REPORT_TABS: { href: string; label: string; desc: string; match?: string[] }[] = [
  { href: "/reports/summary", label: "경영 요약", desc: "지금 회사가 괜찮은지 한 화면으로 — 이번 달 손익·통장 잔액·운영 가능 기간과 다가오는 지출을 요약합니다." },
  { href: "/reports/revenue", label: "매출 현황", desc: "이번 달 매출과 거래처·항목별 구성을 봅니다." },
  { href: "/reports/expense", label: "비용 현황", desc: "이번 달 비용을 항목별로 나눠 어디에 얼마를 썼는지 봅니다." },
  { href: "/reports/monthly", label: "월별 상세", desc: "월별 매출·비용·손익과 전월·전년 대비를 자세히 봅니다." },
  { href: "/reports/upcoming", label: "예정 지출", desc: "앞으로 나갈 고정비·세금·정기결제를 미리 챙깁니다." },
  // 미래 대비 = 대표용 런웨이 요약. 상세 현금흐름(경영 흐름/flow)은 그 하위 상세라 같은 탭으로 묶어 활성.
  { href: "/reports/outlook", label: "미래 대비", desc: "현재 지출 속도 기준 시나리오와 운영 가능 기간을 봅니다.", match: ["/reports/outlook", "/reports/flow"] },
  { href: "/reports/statements", label: "회계 자료", desc: "손익계산서·재무상태표 등 정식 재무제표를 봅니다.", match: STATEMENT_ROUTES },
];

export function ReportsTabs() {
  const pathname = usePathname() || "";
  const isActive = (t: { href: string; match?: string[] }) => {
    const paths = t.match || [t.href];
    return paths.some((p) => pathname === p || pathname.startsWith(p + "/"));
  };
  const current = REPORT_TABS.find(isActive);
  return (
    <div className="reports-tabs reports-header">
      <div className="reports-tabs-list no-print">
        {REPORT_TABS.map((t) => {
          const active = isActive(t);
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`reports-tab-link ${
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
      {current && (
        <p className="reports-tab-desc">{current.desc}</p>
      )}
    </div>
  );
}
