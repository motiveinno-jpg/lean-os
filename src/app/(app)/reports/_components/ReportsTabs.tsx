"use client";

// 분석 상단 내비 — "질문 기반" 4그룹 + 그룹 내 하위 토글 (2026-07-22 재편).
//   기존 7탭이 얇게 갈라져 이동 피로가 컸던 문제를, 대표의 질문 단위 4그룹으로 묶어 해소.
//     · 경영 요약   — 지금 괜찮아?
//     · 손익 현황   — 얼마 벌고 얼마 썼어? (매출·비용·월별 표를 그룹 내 토글로)
//     · 자금 전망   — 앞으로 돈 괜찮아? (예정 지출·운영 시나리오를 토글로)
//     · 회계 자료   — 정식 재무제표(세무·증빙)
//   라우트/페이지는 그대로 유지하고, 상단 내비만 2단(그룹→하위)으로 재구성.

import Link from "next/link";
import { usePathname } from "next/navigation";

// 회계 자료 그룹은 정식 재무제표 페이지들에서도 활성으로 보이도록 매칭 경로를 함께 지정.
const STATEMENT_ROUTES = ["/reports/statements", "/reports/pnl", "/reports/bs", "/reports/costs", "/reports/by-person", "/reports/three-way-match"];

type Leaf = { href: string; label: string; desc: string; match?: string[] };
type Group = { href: string; label: string; desc?: string; match?: string[]; subs?: Leaf[] };

const GROUPS: Group[] = [
  {
    href: "/reports/summary",
    label: "경영 요약",
    desc: "지금 회사가 괜찮은지 한 화면으로 — 이번 달 손익·통장 잔액·운영 가능 기간과 다가오는 지출을 요약합니다.",
  },
  {
    href: "/reports/revenue",
    label: "손익 현황",
    subs: [
      { href: "/reports/revenue", label: "매출", desc: "이번 달 매출과 거래처·항목별 구성을 봅니다." },
      { href: "/reports/expense", label: "비용", desc: "이번 달 비용을 항목별로 나눠 어디에 얼마를 썼는지 봅니다." },
      { href: "/reports/monthly", label: "월별 표", desc: "월별 매출·비용·손익과 전월·전년 대비를 자세히 봅니다." },
    ],
  },
  {
    href: "/reports/upcoming",
    label: "자금 전망",
    subs: [
      { href: "/reports/upcoming", label: "예정 지출", desc: "앞으로 나갈 고정비·세금·정기결제를 미리 챙깁니다." },
      // 운영 가능 시나리오(outlook) + 상세 현금흐름(flow)을 한 하위로 묶어 활성.
      { href: "/reports/outlook", label: "운영 가능·시나리오", desc: "현재 지출 속도 기준 시나리오와 운영 가능 기간을 봅니다.", match: ["/reports/outlook", "/reports/flow"] },
    ],
  },
  {
    href: "/reports/statements",
    label: "회계 자료",
    desc: "손익계산서·재무상태표 등 정식 재무제표를 봅니다.",
    match: STATEMENT_ROUTES,
  },
];

const matchesPath = (pathname: string, paths: string[]) => paths.some((p) => pathname === p || pathname.startsWith(p + "/"));
const leafPaths = (l: { href: string; match?: string[] }) => l.match || [l.href];
const groupPaths = (g: Group) => [...(g.match || [g.href]), ...(g.subs?.flatMap(leafPaths) || [])];

export function ReportsTabs() {
  const pathname = usePathname() || "";
  const activeGroup = GROUPS.find((g) => matchesPath(pathname, groupPaths(g))) || GROUPS[0];
  const activeLeaf = activeGroup.subs?.find((l) => matchesPath(pathname, leafPaths(l)));
  const desc = activeLeaf?.desc ?? activeGroup.desc;

  return (
    <div className="reports-tabs reports-header">
      {/* 1단 — 질문 기반 4그룹 */}
      <div className="reports-tabs-list no-print">
        {GROUPS.map((g) => {
          const active = g === activeGroup;
          return (
            <Link
              key={g.href}
              href={g.href}
              className={`reports-tab-link ${
                active
                  ? "bg-[var(--primary)] text-white shadow-sm"
                  : "bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--primary)]"
              }`}
            >
              {g.label}
            </Link>
          );
        })}
      </div>

      {/* 2단 — 활성 그룹의 하위 토글(있을 때만) */}
      {activeGroup.subs && (
        <div className="seg-bar no-print mt-3">
          {activeGroup.subs.map((l) => {
            const active = matchesPath(pathname, leafPaths(l));
            return (
              <Link key={l.href} href={l.href} className={`seg-item no-underline ${active ? "seg-item-active" : ""}`}>
                {l.label}
              </Link>
            );
          })}
        </div>
      )}

      {desc && <p className="reports-tab-desc">{desc}</p>}
    </div>
  );
}
