"use client";

// 분석 상단 내비 — 그룹 내 하위 토글 + 설명 (2026-08-11 개편).
//   4갈래 그룹은 **사이드바로 폈다**(수집·전표 개편 5단계). 여기서 또 보여 주면 같은 줄이 두 번 나온다.
//   그래서 1단 그룹 탭은 걷어내고, **그 그룹의 하위 토글과 설명만** 남긴다.
//   GROUPS 는 그대로 둔다 — 지금 어느 그룹에 있는지 알아야 하위 토글과 설명을 고를 수 있다.
//
// (아래는 2026-07-22 재편 당시 메모)
// 분석 상단 내비 — "질문 기반" 4그룹 + 그룹 내 하위 토글.
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
    //   2026-08-19 리포트 표준 — 예전 StatementsTabs(2단 링크 줄)를 여기 하위 갈래로 합쳐 상자 안 파란 밑줄 한 줄로
    subs: [
      { href: "/reports/pnl", label: "손익계산서", desc: "기간별 손익계산서 — 표준 양식(Ⅰ~Ⅸ), 항목을 누르면 원천 내역." },
      { href: "/reports/bs", label: "재무상태표", desc: "기준일 자산·부채·자본 — 채권·채무는 해당연도 1/1~기준일 확정 전표 누적." },
      { href: "/reports/costs", label: "비용 분석", desc: "고정비·변동비 구성과 월별 추이 — 지난 달의 실적 기준." },
    ],
  },
  {
    href: "/reports/vat",
    label: "부가세",
    desc: "매입매출전표 기준 부가세 예상 — 분기·반기 신고 전에 납부/환급 예상액을 미리 봅니다.",
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

  //   리포트 표준(2026-08-19) — 상자 머리: 하위 갈래는 파란 밑줄 탭 한 줄, 설명은 그 아래 한 줄.
  //   갈래(경영요약·손익현황·자금전망·회계자료)는 사이드바가 맡는다 — 여기선 하위 갈래만.
  return (
    <>
      {activeGroup.subs ? (
        <div className="collect-tabs">
          {activeGroup.subs.map((l) => {
            const active = matchesPath(pathname, leafPaths(l));
            return (
              <Link key={l.href} href={l.href} className={active ? "collect-tab collect-tab-on no-underline" : "collect-tab no-underline"}>
                {l.label}
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="collect-tabs">
          <span className="collect-tab collect-tab-on">{activeGroup.label}</span>
        </div>
      )}
      {desc && <div className="report-desc">{desc}</div>}
    </>
  );
}
