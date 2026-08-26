"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import { useEffect, useState, useRef } from "react";
import { useModalKeys } from "@/hooks/use-modal-keys";
import { getCurrentUser, getUnreadCounts } from "@/lib/queries";
import { openGlobalSearch } from "@/components/global-search";
import { useSidebar } from "@/components/sidebar-context";
import { OwnerViewIcon, RollingBrandText } from "@/components/brand-logo";
import { SidebarAttendanceButton } from "@/components/sidebar-attendance-button";
import { useTheme } from "@/components/theme-context";
import { useUser, type UserRole } from "@/components/user-context";
import { useMyPermissions } from "@/lib/permissions";
import { usePopups } from "@/components/popup-windows";
import { SETTINGS_GROUPS, groupPermKeys } from "@/lib/settings-nav";

//   permKey — 권한을 확인할 때 쓸 라우트. 한 권한(예: /reports) 아래 여러 메뉴를 펼 때 쓴다.
//   없으면 href 를 쓴다(대부분).
//   anyPerm — 부여 키 여러 개 중 **하나라도** 있으면 보인다 (회사 설정 그룹, 2026-08-24).
//     새 권한 키를 만들지 않으려고 둔 장치다 — 새 키는 member_permissions 에 행이 없어
//     백필 전까지 마스터 외 아무에게도 안 보인다(2026-08-21에 실제로 밟은 함정).
//   layer — 이 항목부터 새 '층'이 시작된다는 소제목 (긴 그룹을 패널 안에서 읽히게, 2026-08-19 파이낸스 A안: 기초/자료/기장/예정)
type NavItem = { href: string; label: string; icon: string; badgeKey?: string; roles?: UserRole[]; operatorOnly?: boolean; masterOnly?: boolean; match?: string[]; permKey?: string; anyPerm?: string[]; children?: NavItem[]; layer?: string };
//   short/icon — 레일(왼쪽 60px 세로 줄)에 그리는 두세 글자 이름과 아이콘 (2026-08-19 레일+패널 사이드바)
type NavGroup = { label: string; short: string; icon: string; items: NavItem[] };

// ── 사이드바 구조 (2026-06-04 갱신) — 홈 → 파이낸스 → 워크스페이스 → 인사관리 → 자산관리 → 설정.
//   파이낸스(구 회계관리) 홈 바로 아래. 워크스페이스(구 그룹웨어): 게시판·채팅·승인·일정·프로젝트·전자계약.
//   인사관리: 구성원·근태·서류. 자산관리: 통장·카드·정기결제 등. (2026-07-30 P2: 화면 한 벌 — 권한 기반 노출)
const NAV_GROUPS: NavGroup[] = [
  {
    label: "홈", short: "홈", icon: "grid",
    items: [
      //   순서 = 매일 여는 순 (2026-08-20 전수 점검): 대시보드 → 알림 → 마이페이지 → AI 참모 → 마스터(특수 화면이라 맨 아래)
      { href: "/dashboard", label: "대시보드", icon: "grid" },
      { href: "/notifications", label: "알림", icon: "bell", badgeKey: "notifications" },
      { href: "/mypage", label: "마이페이지", icon: "user" },
      { href: "/copilot", label: "AI 참모", icon: "sparkles", roles: ["owner", "admin"] },
      //   지원사업 — 정부 지원정책 큐레이션 (2026-08-21 사장님 지시). 회사 자료로 걸러 주는 곳.
      //   매일 여는 순서 원칙에서 주 1회쯤 여는 성격이라 AI 참모 아래. 직원 인사 정보로 자격을 판정해 대표·관리자 전용.
      { href: "/support-programs", label: "지원사업추천", icon: "gift", roles: ["owner", "admin"] },
      // 마스터 전용 — 대시보드 하단 경영 종합 3종(커맨드 센터·프로젝트 경영·월결산) 이동 (2026-08-10 사장님)
      { href: "/master", label: "마스터", icon: "shield", masterOnly: true },
    ],
  },
  {
    // 2026-07-23 파이낸스 4탭 통합 — 8개 항목을 목적 단위 4개 허브로. 상세는 각 화면 상단 하위 탭(FinanceTabs)으로 전환.
    //   거래처(관리·원장) / 세금·증빙(세금계산서·현금영수증) / 거래 장부(자동분류·입금매칭) / 전표입력(별도) / 분석.
    //   라우트·페이지는 그대로. match 로 허브 활성 범위를 지정(예: 거래 장부는 /partners/reconciliation 포함).
    label: "파이낸스", short: "파이낸스", icon: "wallet",
    items: [
      //   2026-08-19 사장님 확정(A안) — 층으로 쌓는다: 기초(통장·카드·거래처) → 자료(수집·전표·세금·증빙) → 기장(일반·매입매출전표) → 예정(정기 지출).
      //   "위에 있는 것이 아래를 먹여 살린다" — 새 회사는 위에서부터 차례로 채우면 된다. (예전: 매일 여는 수집·전표가 첫 자리)
      //   통장·카드·정기 지출은 옛 '자금' 그룹에서 왔다(2026-08-19 사장님: 자금 그룹 폐지).
      { href: "/bank", label: "통장", icon: "arrow-right-left", roles: ["owner", "admin"], layer: "기초" },
      { href: "/cards", label: "카드", icon: "wallet", roles: ["owner", "admin"] },
      { href: "/partners", label: "거래처", icon: "users", roles: ["owner", "admin"], match: ["/partners"] },
      //   흩어져 있던 다섯 화면의 수집을 모은 입구 (2026-08-11). 자료를 받아 전표까지 여기서 끝낸다.
      { href: "/collect", label: "수집·전표", icon: "download", roles: ["owner", "admin"], match: ["/collect"], layer: "자료" },
      { href: "/tax-invoices", label: "세금·증빙", icon: "receipt", roles: ["owner", "admin"], match: ["/tax-invoices", "/cash-receipts", "/e-invoices"] },
      //   2026-08-11 — '자동 분류'를 메뉴에서 내렸다(사장님 지시).
      //     · 통장 줄 처리(수금 매칭·전표·계좌이동·카드 다대일·되돌리기·추천)는 전부 수집·전표 통장 탭으로 갔고,
      //     · 마지막 남았던 **비목**도 이제 전표를 만들 때 함께 붙는다(post_bank_voucher 가 category 를 채운다).
      //     · 그래서 이 화면에는 새로 할 일이 남지 않았다.
      //   ★ **라우트는 살려 둔다** — /transactions 와 /partners/reconciliation 은 주소로 들어가면 그대로 열린다.
      //     즐겨찾기·옛 링크가 막히지 않게, 되돌릴 땐 이 줄만 다시 넣으면 된다.
      //   { href: "/transactions", label: "자동 분류", icon: "book", roles: ["owner", "admin"], match: ["/transactions", "/partners/reconciliation"] },
      // 전표는 두 갈래로 나눠 각각 메뉴로 둔다 (2026-08-11 사장님 지시 — 탭 말고 메뉴).
      //   일반전표 = 통장·대체·결산 / 매입매출전표 = 세금계산서·카드·현금영수증(부가세 유형이 붙는 거래).
      //   경로가 /partners/reconciliation 하위지만 match로 자기 경로만 지정 → 최장매치로 각각 단독 활성.
      { href: "/partners/reconciliation/voucher-entry", label: "일반전표", icon: "edit-3", roles: ["owner", "admin"], match: ["/partners/reconciliation/voucher-entry"], layer: "기장" },
      { href: "/partners/reconciliation/sale-purchase", label: "매입매출전표", icon: "receipt", roles: ["owner", "admin"], match: ["/partners/reconciliation/sale-purchase"] },
      //   정기 지출은 실적이 아니라 '예정' — 성격이 달라 맨 아래. (분석 '자금 전망' 옆으로 옮길지는 사장님 결정 대기)
      { href: "/payments", label: "정기 지출", icon: "clock", roles: ["owner", "admin"], layer: "예정" },
      // 2026-07-28 대출·자산은 실제로 쓰지 않는 기능이라 사이드바에서 내렸다(사장님 확인). 라우트(/loans, /vault)는 그대로.
    ],
  },
  {
    //   재고 — 2026-08-25 사장님 지시로 신설. 기획 https://claude.ai/code/artifact/afc625ae-c5b5-4b7b-9b51-fdcf3e93165a
    //   ★ 파이낸스가 **돈의 흐름**이라면 재고는 **물건의 흐름**이다. 같은 서랍에 넣으면 파이낸스가 12줄이 된다.
    //     사이드바는 레일+패널이라 새 그룹은 다른 메뉴를 한 줄도 밀지 않는다.
    //   ★ 가르는 기준은 기능 이름이 아니라 **물건의 상태**다 —
    //     무엇을 파는가(품목) · 지금 몇 개인가(재고) · 나가는 길(판매) · 밖에서 사 오는 길(구매) · 안에서 만드는 길(생산).
    //   ★ 다섯은 사장님이 정한 "5개까지만 편다"의 **정확한 상한**이다. 앞으로 더할 것은 메뉴가 아니라 화면 안 갈래 탭으로.
    label: "재고", short: "재고", icon: "package",
    items: [
      { href: "/inventory/products", label: "품목", icon: "package", roles: ["owner", "admin"], layer: "기초" },
      { href: "/inventory/stock", label: "재고", icon: "layers", roles: ["owner", "admin"] },
      //   ★ 차례는 주문 · 판매 · 구매 · 생산 (2026-08-25 사장님 지시).
      //     주문서는 약속이라 재고를 안 건드리고, 나머지 셋이 그것을 불러와 재고를 움직인다.
      { href: "/inventory/orders", label: "주문", icon: "clipboard", roles: ["owner", "admin"], layer: "거래" },
      { href: "/inventory/sales", label: "판매", icon: "arrow-right-left", roles: ["owner", "admin"] },
      { href: "/inventory/purchase", label: "구매", icon: "download", roles: ["owner", "admin"] },
      { href: "/inventory/production", label: "생산", icon: "kanban", roles: ["owner", "admin"] },
      { href: "/inventory/channels", label: "채널", icon: "link", roles: ["owner", "admin"], layer: "연동" },
      //   ★ 현황 — 주문·판매·구매·생산을 한 화면에 집계·그래프로. 맨 아래(2026-08-26 사장님: "현황이 제일 아래쪽으로").
      { href: "/inventory/status", label: "현황", icon: "bar-chart", roles: ["owner", "admin"], layer: "현황" },
    ],
  },
  {
    //   분석 — 화면 안 4갈래 탭을 사이드바로 폈다 (2026-08-11 사장님 지시).
    //   ★ 5개까지만 편다. 하위(매출·비용·월별표 / 예정지출·운영시나리오)는 화면 안 세그먼트로 남긴다
    //     — 8개를 다 펴면 사이드바가 길어져 오히려 못 찾는다.
    //   거래처 원장도 여기로 옮겼다 — 판단용 장부라 '보는 곳'이 맞다(거래처 화면의 링크는 그대로 둔다).
    label: "분석", short: "분석", icon: "bar-chart",
    items: [
      { href: "/reports/summary", permKey: "/reports", label: "경영 요약", icon: "bar-chart", roles: ["owner", "admin"], match: ["/reports", "/reports/summary"] },
      { href: "/reports/profit", permKey: "/reports", label: "손익 현황", icon: "trending-up", roles: ["owner", "admin"], match: ["/reports/profit", "/reports/revenue", "/reports/expense", "/reports/monthly"] },
      { href: "/reports/outlook", permKey: "/reports", label: "자금 전망", icon: "clock", roles: ["owner", "admin"], match: ["/reports/upcoming", "/reports/outlook", "/reports/flow"] },
      { href: "/reports/statements", permKey: "/reports", label: "회계 자료", icon: "file-text", roles: ["owner", "admin"], match: ["/reports/statements", "/reports/pnl", "/reports/bs", "/reports/costs", "/reports/by-person", "/reports/three-way-match"] },
      //   부가세 — 세금계산서 화면의 탭이었는데 분석으로 옮겼다 (2026-08-13 사장님 지시).
      //   세금·증빙이 '발행하는 곳'이 되면서, 매입 자료로 계산하는 신고용 화면은 성격이 안 맞아졌다.
      //   순서 (2026-08-20 전수 점검): 요약 → 현재(손익) → 미래(전망) → 자료(회계 자료·거래처 원장) → 신고(부가세, 신고철에만 여는 행사성이라 맨 아래)
      { href: "/partners/ledger", label: "거래처 원장", icon: "book", roles: ["owner", "admin"], match: ["/partners/ledger"] },
      //   ★ 위 '5개까지만 편다'를 하나 넘긴다 — 부가세는 원래 최상위 탭이었고 신고철마다 찾는 화면이라 하위로 접으면 못 찾는다.
      { href: "/reports/vat", permKey: "/reports", label: "부가세", icon: "receipt", roles: ["owner", "admin"], match: ["/reports/vat"] },
    ],
  },
  {
    label: "워크스페이스", short: "워크", icon: "briefcase",
    items: [
      // 메뉴 순서: 일정/할일 → 프로젝트 → 승인요청 → 게시판 → 메신저 (전자계약은 끝 유지)
      //   '워크플로우'(전사 칸반 /projects)는 실행형 프로젝트 상세 마지막 탭으로 이동 (2026-06-30).
      { href: "/schedule", label: "일정 / 할 일", icon: "calendar" },
      { href: "/projecthub", label: "프로젝트", icon: "briefcase", roles: ["owner", "admin"] },
      { href: "/approvals", label: "결재 허브", icon: "clipboard-check", badgeKey: "approvals", roles: ["owner", "admin"] },
      { href: "/board", label: "게시판", icon: "message-square" },
      { href: "/chat", label: "메신저", icon: "message-circle", badgeKey: "chat" },
      { href: "/signatures", label: "전자계약", icon: "edit-3", roles: ["owner", "admin"] },
      //   파일보관함 — 인사관리 → 워크스페이스 (2026-08-20 사장님: 문서는 인사만의 것이 아니다)
      { href: "/documents", label: "파일보관함", icon: "folder" },
      //   내 서명 요청 — 2026-08-19 마이페이지 › 급여·계약·증명 갈래로 흡수(라우트는 전체 목록용으로 남김, 메뉴만 뺌)
    ],
  },
  {
    label: "인사관리", short: "인사", icon: "user-check",
    items: [
      { href: "/employees", label: "구성원", icon: "user-check", roles: ["owner", "admin"] },
      { href: "/attendance", label: "근태 관리", icon: "calendar", roles: ["owner", "admin"] },
      { href: "/hr-templates", label: "근로계약·서식", icon: "file-text", roles: ["owner", "admin"] },
      { href: "/team", label: "구성원 디렉토리", icon: "users" },
    ],
  },
  {
    //   2026-08-19 사장님: '설정·도움말'은 오너뷰가 주는 기능(가이드·고객센터)과 회사가 다루는 것(회사 설정)이 섞여
    //   통일감이 없다 → 둘로 가른다. 회사 관리 = 회사가 정하는 것(설정·공지·요금제) / 도움말 = 오너뷰가 주는 것.
    label: "회사 관리", short: "회사", icon: "settings",
    items: [
      //   회사 설정 — 항목 13개를 **그룹 5개**로 폈다 (2026-08-24 사장님 지시: "좌측 사이드바로 메뉴화").
      //     ★ 13개를 다 펴지 않는 이유: 분석 그룹에서 사장님이 정한 "5개까지만 편다 — 8개를 다 펴면
      //       사이드바가 길어져 오히려 못 찾는다"를 그대로 따른다. leaf 는 각 화면 안 탭(2~4개)으로 남는다.
      //     ★ 2026-08-13 에 기각된 '좌측 네비'와 다르다 — 그때 사유는 '왼쪽'이 아니라 '왼쪽이 두 개'
      //       (설정 화면 안에 또 패널을 뒀다). 이번엔 화면 안에 패널을 만들지 않는다.
      //   목록·순서·권한 키의 원본은 lib/settings-nav.ts 하나다 — 여기에 다시 적지 않는다(적으면 어긋난다).
      ...SETTINGS_GROUPS.map((g, i): NavItem => ({
        href: g.route, label: g.label, icon: g.icon, roles: ["owner", "admin"],
        anyPerm: groupPermKeys(g),
        layer: i === 0 ? "회사 설정" : undefined,
      })),
      //   요금제는 설정 안으로 넣지 않는다 — 돈이 나가는 화면이라 권한(money)이 따로 붙고 성격이 다르다.
      { href: "/billing", label: "요금제", icon: "credit-card", roles: ["owner", "admin"], layer: "구독" },
    ],
  },
  {
    label: "도움말", short: "도움말", icon: "help-circle",
    items: [
      //   공지사항 = 오너뷰가 올리는 공지·업데이트 내역(회사 기능 아님, 2026-08-19 사장님) → 도움말 그룹
      { href: "/announcements", label: "공지사항", icon: "megaphone", badgeKey: "announcements" },
      { href: "/guide", label: "사용 가이드", icon: "help-circle" },
      { href: "/support", label: "고객센터", icon: "headphones" },
    ],
  },
];

// (2026-07-30 개편 P2) 직원 전용 사이드바 삭제 — 화면 한 벌 + 권한 기반 숨김으로 통합.

// 활성 판정 헬퍼 — 아이템의 match(없으면 [href]) 중 현재 경로에 매치되는 가장 긴 경로 길이.
//   여러 아이템 중 이 길이가 최댓값인 아이템만 활성 → 접두어가 겹쳐도(예: /partners vs /partners/reconciliation)
//   가장 구체적인 허브가 이긴다. (2026-06-12 원장/매칭 오점등 버그 대응 + 2026-07-23 파이낸스 허브 match 지원)
function itemMatchLen(item: NavItem, pathname: string): number {
  const paths = item.match || [item.href];
  let m = -1;
  for (const p of paths) if (pathname === p || pathname.startsWith(p + "/")) m = Math.max(m, p.length);
  return m;
}

function filterNavUnified(role: UserRole, isMaster: boolean, hasMenu: (route: string) => boolean, isOperator?: boolean): NavGroup[] {
  // (2026-07-30 개편 P2) 화면 한 벌: 파트너만 기존 roles 필터 유지(별도 협업 화면),
  //   나머지(마스터·멤버)는 권한 기반 — 마스터는 전 메뉴, 멤버는 부여받은 메뉴 + 기본 제공만 노출.
  const ok = (i: NavItem) => {
    if (i.operatorOnly && !isOperator) return false;
    if (i.masterOnly && !isMaster) return false; // 마스터 전용 — 메뉴 권한 부여로도 안 열림
    if (role === "partner") return !i.roles || i.roles.includes(role);
    if (isMaster) return true;
    //   그룹 안 세부 권한을 하나라도 받았으면 그 메뉴를 보여준다 (회사 설정 5그룹).
    if (i.anyPerm) return i.anyPerm.some((k) => hasMenu(k));
    return hasMenu(i.permKey || i.href);
  };
  return NAV_GROUPS
    .map((group) => ({
      ...group,
      items: group.items.flatMap((item) => {
        const kids = (item.children || []).filter(ok);
        if (ok(item)) return [{ ...item, children: kids.length ? kids : undefined }];
        return kids; // 부모가 숨겨지면 보이는 자식을 top-level 로 승격
      }),
    }))
    .filter((group) => group.items.length > 0);
}

/* ------------------------------------------------------------------ */
/*  NavIcon                                                            */
/* ------------------------------------------------------------------ */
// 메뉴 아이콘 색 — 그룹별 색 계열로 통일 (2026-08-03 사장님: "너무 다채로워 난잡 — 같은 그룹은 비슷한 계열로").
//   홈=블루 · 파이낸스=그린(통장·카드·정기 지출은 시안 계열 유지) · 워크스페이스=바이올렛 · 인사관리=오렌지 · 회사 관리·도움말=슬레이트.
//   같은 아이콘이 여러 그룹에 쓰여서(calendar=일정+근태 등) 아이콘 이름이 아니라 메뉴 경로(href) 기준.
//   활성 메뉴(색 배경 + text-white)는 흰색 유지 — 아래 NavIcon 에서 text-white 면 색을 안 입힌다.
const NAV_ITEM_COLOR: Record<string, string> = {
  // 홈 — 블루
  "/dashboard": "#3b82f6", "/master": "#2563eb", "/copilot": "#6366f1", "/mypage": "#60a5fa", "/notifications": "#818cf8",
  "/support-programs": "#4f7cf7",
  // 파이낸스 — 그린
  "/partners": "#10b981", "/tax-invoices": "#059669", "/transactions": "#14b8a6",
  "/partners/reconciliation/voucher-entry": "#34d399", "/partners/reconciliation/sale-purchase": "#38bdf8", "/reports": "#22c55e",
  // 워크스페이스 — 바이올렛
  "/schedule": "#8b5cf6", "/projecthub": "#7c3aed", "/approvals": "#a855f7",
  "/board": "#a78bfa", "/chat": "#c084fc", "/signatures": "#9333ea", "/my-contracts": "#c4b5fd", "/documents": "#8b5cf6",
  // 인사관리 — 오렌지
  "/employees": "#f97316", "/attendance": "#fb923c", "/hr-templates": "#f59e0b",
  "/team": "#ea580c",
  // 재고 — 앰버(돈은 그린, 물건은 앰버로 갈라 본다)
  "/inventory/status": "#b7791f", "/inventory/products": "#d97706", "/inventory/stock": "#b45309", "/inventory/sales": "#f59e0b",
  "/inventory/orders": "#f0b429", "/inventory/purchase": "#ea9a17", "/inventory/production": "#c2740c", "/inventory/channels": "#a35f0a",
  // 자산관리 — 시안
  "/bank": "#06b6d4", "/cards": "#0ea5e9", "/payments": "#22d3ee",
  // 회사 관리·도움말 — 슬레이트
  "/settings": "#64748b", "/announcements": "#94a3b8", "/billing": "#64748b",
  //   회사 설정 5그룹 (2026-08-24) — 같은 그룹이라 전부 슬레이트 계열
  "/settings/company": "#64748b", "/settings/people": "#6b7688", "/settings/finance": "#5f7186",
  "/settings/integration": "#58708f", "/settings/system": "#7a8598",
  "/guide": "#94a3b8", "/support": "#64748b",
};

function NavIcon({ name, href, className = "" }: { name: string; href?: string; className?: string }) {
  const cn = `w-4 h-4 shrink-0 ${className}`;
  const color = className.includes("text-white") ? undefined : ((href && NAV_ITEM_COLOR[href]) || "#64748b");
  const props = { className: cn, style: color ? { color } : undefined, fill: "none", stroke: "currentColor", strokeWidth: 1.8, viewBox: "0 0 24 24", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

  switch (name) {
    case "grid": return <svg {...props}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>;
    case "briefcase": return <svg {...props}><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/></svg>;
    case "kanban": return <svg {...props}><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>;
    case "users": return <svg {...props}><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>;
    case "credit-card": return <svg {...props}><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>;
    case "wallet": return <svg {...props}><path d="M21 12V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2h14a2 2 0 002-2v-2"/><path d="M16 12h5v4h-5a2 2 0 010-4z"/><circle cx="17.5" cy="14" r="0.8" fill="currentColor"/></svg>;
    case "calendar": return <svg {...props}><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>;
    case "file-text": return <svg {...props}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>;
    case "arrow-right-left": return <svg {...props}><path d="M21 7H3M21 7l-4-4M21 7l-4 4M3 17h18M3 17l4-4M3 17l4 4"/></svg>;
    case "link": return <svg {...props}><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>;
    case "folder": return <svg {...props}><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>;
    case "clipboard": return <svg {...props}><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg>;
    case "clipboard-check": return <svg {...props}><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 14l2 2 4-4"/></svg>;
    case "message-circle": return <svg {...props}><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/></svg>;
    case "message-square": return <svg {...props}><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>;
    case "user": return <svg {...props}><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>;
    case "user-check": return <svg {...props}><path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="8.5" cy="7" r="4"/><polyline points="17 11 19 13 23 9"/></svg>;
    case "shield": return <svg {...props}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>;
    case "trending-up": return <svg {...props}><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>;
    case "sparkles": return <svg {...props}><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z"/><path d="M19 13l.75 2.25L22 16l-2.25.75L19 19l-.75-2.25L16 16l2.25-.75L19 13z"/></svg>;
    case "settings": return <svg {...props}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/></svg>;
    case "help-circle": return <svg {...props}><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>;
    case "headphones": return <svg {...props}><path d="M3 18v-6a9 9 0 0118 0v6"/><path d="M21 19a2 2 0 01-2 2h-1a2 2 0 01-2-2v-3a2 2 0 012-2h3z"/><path d="M3 19a2 2 0 002 2h1a2 2 0 002-2v-3a2 2 0 00-2-2H3z"/></svg>;
    case "crown": return <svg {...props}><path d="M2 20h20M4 17l2-12 4 5 2-8 2 8 4-5 2 12"/></svg>;
    case "upload": return <svg {...props}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>;
    case "bar-chart": return <svg {...props}><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg>;
    case "edit-3": return <svg {...props}><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>;
    case "bell": return <svg {...props}><path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>;
    case "megaphone": return <svg {...props}><path d="M3 11l18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 11-5.8-1.6"/></svg>;
    case "alert-triangle": return <svg {...props}><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>;
    case "user-cog": return <svg {...props}><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><circle cx="19" cy="11" r="2"/><path d="M19 8v1M19 13v1M22 11h-1M17 11h-1"/></svg>;
    case "receipt": return <svg {...props}><path d="M20 2v20l-3-2-3 2-3-2-3 2-3-2-3 2V2l3 2 3-2 3 2 3-2 3 2 3-2z"/><line x1="8" y1="9" x2="16" y2="9"/><line x1="8" y1="13" x2="16" y2="13"/></svg>;
    case "book": return <svg {...props}><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>;
    case "clock": return <svg {...props}><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/></svg>;
    case "umbrella": return <svg {...props}><path d="M12 2a9 9 0 019 9H3a9 9 0 019-9z"/><path d="M12 11v8a2.5 2.5 0 005 0"/></svg>;
    case "package": return <svg {...props}><path d="M21 8l-9-5-9 5v8l9 5 9-5V8z"/><path d="M3 8l9 5 9-5"/><path d="M12 13v10"/></svg>;
    case "layers": return <svg {...props}><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>;
    case "download": return <svg {...props}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>;
    //   지원사업 — 나라에서 주는 것이라 선물 상자 (2026-08-21)
    case "gift": return <svg {...props}><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v8a1 1 0 001 1h12a1 1 0 001-1v-8"/><line x1="12" y1="8" x2="12" y2="21"/><path d="M12 8H7.5a2.5 2.5 0 010-5C11 3 12 8 12 8z"/><path d="M12 8h4.5a2.5 2.5 0 000-5C13 3 12 8 12 8z"/></svg>;
    default: return <svg {...props}><circle cx="12" cy="12" r="10"/></svg>;
  }
}

/* ------------------------------------------------------------------ */
/*  Tooltip wrapper for collapsed mode                                 */
/* ------------------------------------------------------------------ */
function Tooltip({ label, show, children }: { label: string; show: boolean; children: React.ReactNode }) {
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  if (!show) return <>{children}</>;

  return (
    <div
      ref={ref}
      className="relative"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      {children}
      {visible && (
        <div className="nav-item-tooltip">
          {label}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sidebar                                                            */
/* ------------------------------------------------------------------ */
export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { collapsed, toggleSidebar, mobileOpen, setMobileOpen, pinnedPages, togglePin, isPinned } = useSidebar();
  const { theme, toggleTheme } = useTheme();
  const { user, role } = useUser();
  const popups = usePopups(); // 메뉴 팝업 열기 (셸 PopupProvider). null 가능(안전 처리).
  const [chatUnread, setChatUnread] = useState(0);
  const [approvalsPending, setApprovalsPending] = useState(0);
  const [notificationsUnread, setNotificationsUnread] = useState(0);
  const [announcementsUnread, setAnnouncementsUnread] = useState(0);
  const [collapsedParents, setCollapsedParents] = useState<Set<string>>(new Set());
  const toggleParent = (href: string) => setCollapsedParents((prev) => { const n = new Set(prev); if (n.has(href)) n.delete(href); else n.add(href); return n; });
  // 대분류 그룹 접기/펼치기 (메뉴 간소화 — 사용자 요청). localStorage 영속.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  useEffect(() => {
    try { const s = localStorage.getItem("ov:sidebar:collapsedGroups"); if (s) setCollapsedGroups(new Set(JSON.parse(s))); } catch { /* ignore */ }
  }, []);
  const toggleGroup = (label: string) => setCollapsedGroups((prev) => {
    const n = new Set(prev); if (n.has(label)) n.delete(label); else n.add(label);
    try { localStorage.setItem("ov:sidebar:collapsedGroups", JSON.stringify([...n])); } catch { /* ignore */ }
    return n;
  });
  const isOperator = !!user?.email && /@mo-tive\.com$/i.test(user.email);
  const { isMaster, hasMenu } = useMyPermissions();
  const filteredNav = filterNavUnified(role, isMaster, hasMenu, isOperator);

  // ── 레일 + 패널 (2026-08-19 사장님 확정, docs/20260819_PLAN_sidebar_rail_panel.md) ──
  //   왼쪽 레일에 그룹 7개, 오른쪽 패널엔 고른 그룹의 항목만. 지금 그룹은 **주소가 정한다**(화면이 바뀌면 그 화면의 그룹으로).
  //   레일에 마우스를 올리면 미리 보고(preview), 누르면 고정(view) — **고정한 뒤에는 다른 아이콘에 올려도 안 바뀐다**
  //   (2026-08-19 사장님: "한번 클릭하면 그 메뉴가 고정되게"). 다른 아이콘을 누르면 그쪽으로 고정이 옮겨 간다.
  //   화면이 바뀌면 고정이 풀리고 그 화면의 그룹으로. 마지막에 본 그룹은 기억하지 않는다.
  //   접기 = 레일만 남고, 레일 아이콘에 올리면 그 그룹 패널이 떠서(flyout) 보인다.
  const [viewGroup, setViewGroup] = useState<string | null>(null);
  const [previewGroup, setPreviewGroup] = useState<string | null>(null);
  const [flyTop, setFlyTop] = useState(0);
  const railWrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setViewGroup(null); setPreviewGroup(null); }, [pathname]);

  // Build flat lookup for pinned pages
  const allNavItems = filteredNav.flatMap(g => g.items.flatMap(i => i.children ? [i, ...i.children] : [i]));
  const pinnedItems = pinnedPages
    .map(href => allNavItems.find(item => item.href === href))
    .filter(Boolean) as NavItem[];

  // 현재 경로에 대해 가장 구체적으로 매치되는 아이템만 활성(최장 매치 우선).
  const bestMatchLen = Math.max(-1, ...allNavItems.map((i) => itemMatchLen(i, pathname)));
  const isItemActive = (item: NavItem) => { const l = itemMatchLen(item, pathname); return l >= 0 && l === bestMatchLen; };

  // 2026-07-20 QA: 스크롤 경계에서 메뉴 글자가 반쯤 잘려("거래 자동화"→"거래 자동하") 깨져 보이던 문제 —
  //   아래 내용이 더 있을 때만 하단 페이드 마스크를 걸어 잘림을 자연스럽게 처리. 맨 아래 도달 시 페이드 해제.
  const navRef = useRef<HTMLElement>(null);
  const [navFade, setNavFade] = useState(false);
  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const update = () => setNavFade(el.scrollHeight - el.scrollTop - el.clientHeight > 8);
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => { el.removeEventListener("scroll", update); ro.disconnect(); };
  }, []);

  // 데스크톱 단일 아이템 렌더 (하위 토글 지원 — 부모는 chevron, 일반은 핀)
  //   ★ 접힌 상태에서도 항목은 떠 있는 패널 안에 '펼친 모양'으로 그리므로, 여기서는 항상 펼친 형태다 (2026-08-19 레일+패널)
  const renderDesktopItem = (item: NavItem, isChild: boolean, hasChildren = false, open = false) => {
    const collapsed = false;
    const active = isItemActive(item);
    const bk = (item as any).badgeKey;
    const badge = bk === "chat" ? chatUnread : bk === "approvals" ? approvalsPending : bk === "notifications" ? notificationsUnread : bk === "announcements" ? announcementsUnread : 0;
    const pinned = isPinned(item.href);
    return (
      <Tooltip key={item.href} label={item.label} show={collapsed}>
        <div className="nav-item-row group">
          <Link href={item.href}
            className={`nav-item-link ${
              collapsed ? "justify-center px-0 py-2.5" : `gap-2.5 px-2.5 py-2 ${isChild ? "pl-8" : ""}`
            } ${active ? "nav-active" : "text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-surface)]"}`}>
            <span className="relative">
              <NavIcon name={item.icon} href={item.href} className={active ? "text-white" : ""} />
              {collapsed && badge > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[14px] h-[14px] flex items-center justify-center bg-[var(--danger)] text-white text-[8px] font-bold rounded-full px-0.5">{badge > 99 ? "99" : badge}</span>
              )}
            </span>
            {!collapsed && (
              <>
                <span className="flex-1">{item.label}</span>
                {badge > 0 && (
                  <span className="min-w-[18px] h-[18px] flex items-center justify-center bg-[var(--danger)] text-white text-[9px] font-bold rounded-full px-1">{badge > 99 ? "99+" : badge}</span>
                )}
              </>
            )}
          </Link>
          {/* 팝업으로 열기 — hover 시 우측에 등장. 현재 페이지 유지하며 이 메뉴를 바로 OS 새 창으로. */}
          {!collapsed && popups && (
            <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); popups.openDetached(item.href, item.label); }}
              className="nav-item-popup-btn"
              title="새 창으로 열기" aria-label={`${item.label} 새 창으로 열기`}>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 9h18" /><path d="M13 13h4v4" /><path d="M17 13l-4 4" />
              </svg>
            </button>
          )}
          {!collapsed && hasChildren ? (
            <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleParent(item.href); }}
              className="nav-item-expand-btn" title={open ? "접기" : "펼치기"}>
              <svg className={`w-3.5 h-3.5 transition-transform ${open ? "" : "-rotate-90"}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          ) : !collapsed ? (
            <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); togglePin(item.href); }}
              className={`nav-item-pin-btn ${pinned ? "text-amber-500 opacity-100" : "text-[var(--text-dim)] opacity-0 group-hover:opacity-60 hover:!opacity-100"}`}
              title={pinned ? "즐겨찾기 해제" : "즐겨찾기 추가"}>
              <svg className="w-3 h-3" fill={pinned ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z" strokeLinejoin="round" /></svg>
            </button>
          ) : null}
        </div>
      </Tooltip>
    );
  };

  // 모바일 단일 아이템 렌더 (하위는 indent, 토글 없이 항상 펼침)
  const renderMobileItem = (item: NavItem, isChild: boolean) => {
    const active = isItemActive(item);
    const bk = (item as any).badgeKey;
    const badge = bk === "chat" ? chatUnread : bk === "approvals" ? approvalsPending : bk === "notifications" ? notificationsUnread : bk === "announcements" ? announcementsUnread : 0;
    const pinned = isPinned(item.href);
    return (
      <div key={item.href} className="mobile-nav-item-row">
        <Link href={item.href}
          className={`mobile-nav-item-link px-2.5 ${isChild ? "pl-8" : ""} ${active ? "nav-active" : "text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-surface)]"}`}>
          <NavIcon name={item.icon} href={item.href} className={active ? "text-white" : ""} />
          <span className="flex-1">{item.label}</span>
          {badge > 0 && (
            <span className="min-w-[18px] h-[18px] flex items-center justify-center bg-[var(--danger)] text-white text-[9px] font-bold rounded-full px-1">{badge > 99 ? "99+" : badge}</span>
          )}
        </Link>
        <button onClick={() => togglePin(item.href)} className={`mobile-nav-item-pin-btn ${pinned ? "text-amber-500" : "text-[var(--text-dim)] opacity-40"}`}>
          <svg className="w-3.5 h-3.5" fill={pinned ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z" strokeLinejoin="round" /></svg>
        </button>
      </div>
    );
  };

  useEffect(() => {
    async function loadCounts() {
      const u = await getCurrentUser();
      if (!u) return;
      try {
        const counts = await getUnreadCounts(u.company_id, u.id);
        const total = Array.from(counts.values()).reduce((s, v) => s + v, 0);
        setChatUnread(total);
      } catch {}
      try {
        const db = supabase;
        // 사용자가 /approvals 페이지를 마지막으로 방문한 시각 — 그 이후 created 항목만 카운트.
        const dismissedAt = typeof window !== 'undefined'
          ? localStorage.getItem('approvals-dismissed-at')
          : null;
        let docQ = db.from("doc_approvals").select("id", { count: "exact", head: true })
          .eq("approver_id", u.id).eq("status", "pending");
        // 지급 대기(payment_queue)는 회사 전체 건이라 본인 필터가 없음 — 승인 권한 있는
        // 대표/관리자만 카운트. 직원은 결재자도 참조자도 아닌 건이 배지에 잡히던 버그(2026-07-29).
        const canApprovePayments = !!(u as any).is_master; // (P3) 결제 승인 배지 — 마스터 기준(멤버 perm 연동은 P4)
        let payQ = db.from("payment_queue").select("id", { count: "exact", head: true })
          .eq("company_id", u.company_id).eq("status", "pending");
        let stepQ = db.from("approval_steps")
          .select("id, stage, created_at, approval_requests!inner(current_stage, status, company_id)")
          .eq("approver_id", u.id)
          .eq("status", "pending")
          .eq("approval_requests.status", "pending")
          .eq("approval_requests.company_id", u.company_id);
        if (dismissedAt) {
          docQ = docQ.gt("created_at", dismissedAt);
          payQ = payQ.gt("created_at", dismissedAt);
          stepQ = stepQ.gt("created_at", dismissedAt);
        }
        const [{ count: docCount }, payRes, { data: pendingSteps }] = await Promise.all([
          docQ,
          canApprovePayments ? payQ : Promise.resolve({ count: 0 }),
          stepQ,
        ]);
        const myStepCount = (pendingSteps || []).filter(
          (s: any) => s.stage === s.approval_requests?.current_stage
        ).length;
        setApprovalsPending((docCount ?? 0) + (payRes.count ?? 0) + myStepCount);
      } catch {}
      // notifications unread count — 모든 역할(대표/관리자/직원) 공통
      try {
        const db = supabase;
        const { count } = await db
          .from("notifications")
          .select("id", { count: "exact", head: true })
          .eq("user_id", u.id)
          .eq("is_read", false);
        setNotificationsUnread(count ?? 0);
      } catch {}
      // 안 읽은 공지 수 — 공지사항 탭에 들어가면 전부 읽음 처리되어 배지가 사라진다 (2026-08-06).
      try {
        const { data } = await supabase.rpc("unread_announcement_count");
        setAnnouncementsUnread(Number(data) || 0);
      } catch {}
    }
    loadCounts();
    const interval = setInterval(loadCounts, 60000); // 30s→60s: 배지 폴링 절반(인스턴스 요청부하 절감)
    window.addEventListener("sidebar-refresh-badges", loadCounts);
    // 메신저 새 창에서 읽으면 이 창 뱃지도 즉시 갱신 (다른 창의 localStorage 쓰기 = storage 이벤트)
    const onStorage = (e: StorageEvent) => { if (e.key === "ov:chat:read") loadCounts(); };
    window.addEventListener("storage", onStorage);
    return () => {
      clearInterval(interval);
      window.removeEventListener("sidebar-refresh-badges", loadCounts);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    async function refreshOnNav() {
      const u = await getCurrentUser();
      if (!u) return;
      try {
        const counts = await getUnreadCounts(u.company_id, u.id);
        const total = Array.from(counts.values()).reduce((s, v) => s + v, 0);
        setChatUnread(total);
      } catch {}
      try {
        const db = supabase;
        const { count } = await db
          .from("notifications")
          .select("id", { count: "exact", head: true })
          .eq("user_id", u.id)
          .eq("is_read", false);
        setNotificationsUnread(count ?? 0);
      } catch {}
      try {
        const { data } = await supabase.rpc("unread_announcement_count");
        setAnnouncementsUnread(Number(data) || 0);
      } catch {}
    }
    refreshOnNav();
  }, [pathname]);

  // Close mobile drawer on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname, setMobileOpen]);

  // 모바일 사이드바 드로어 — ESC로 닫기 (내비게이션 전용이라 Enter 확인 액션 없음)
  useModalKeys(mobileOpen, () => setMobileOpen(false));

  async function handleLogout() {
    await supabase.auth.signOut();
    window.location.href = "/auth";
  }

  //   지금 주소가 속한 그룹(최장 매치 항목이 있는 그룹). 아무 데도 안 맞으면 첫 그룹.
  const routeGroup = filteredNav.find((g) => g.items.some((i) => isItemActive(i) || (i.children || []).some(isItemActive)))?.label ?? filteredNav[0]?.label ?? "";
  const shownGroupLabel = (collapsed ? previewGroup : (previewGroup || viewGroup)) || routeGroup;
  const shownGroup = filteredNav.find((g) => g.label === shownGroupLabel) || filteredNav[0];
  const badgeOf = (bk?: string) => bk === "chat" ? chatUnread : bk === "approvals" ? approvalsPending : bk === "notifications" ? notificationsUnread : bk === "announcements" ? announcementsUnread : 0;
  const groupHasBadge = (g: NavGroup) => g.items.some((i) => badgeOf(i.badgeKey) > 0);
  const groupItemsFlat = (g: NavGroup) => g.items.flatMap((i) => i.children ? [i, ...i.children] : [i]);
  const groupOn = (g: NavGroup) => (collapsed ? (previewGroup || routeGroup) : shownGroupLabel) === g.label;
  //   레일 아이콘 hover — 펼친 상태면 패널 미리 보기, 접힌 상태면 떠 있는 패널 위치를 그 아이콘 높이에 맞춘다
  const onRailEnter = (g: NavGroup, e: React.MouseEvent<HTMLElement>) => {
    if (collapsed) {
      const wrap = railWrapRef.current?.getBoundingClientRect();
      const r = e.currentTarget.getBoundingClientRect();
      setFlyTop(Math.max(0, r.top - (wrap?.top ?? 0) - 8));
    }
    else if (viewGroup) return;   // 펼친 상태에서 고정해 둔 그룹이 있으면 hover 로 안 바꾼다
    setPreviewGroup(g.label);
  };

  //   패널(또는 떠 있는 패널) 안 항목 목록 — 층 소제목 + 항목 + 하위
  const renderGroupItems = (g: NavGroup) => (
    <div className="sidebar-group-list">
      {g.items.map((item) => {
        const layer = item.layer ? <div key={`layer-${item.href}`} className="sb-layer">{item.layer}</div> : null;
        const kids = item.children;
        if (kids && kids.length) {
          const open = !collapsedParents.has(item.href);
          return (
            <div key={item.href}>
              {layer}
              {renderDesktopItem(item, false, true, open)}
              {open && <div className="mt-0.5 space-y-0.5">{kids.map((c) => renderDesktopItem(c, true))}</div>}
            </div>
          );
        }
        return <div key={item.href}>{layer}{renderDesktopItem(item, false)}</div>;
      })}
    </div>
  );

  const themeIcon = theme === "light" ? (
    <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
    </svg>
  ) : (
    <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
    </svg>
  );

  const sidebarWidth = collapsed ? "w-16" : "w-64";

  const sidebarContent = (
    <aside className={`sidebar-panel chrome-glass sb-shell ${sidebarWidth}`}>
      {/* ── 레일: 로고 · 그룹 7개 · (아래) 다크 모드 · 접기 · 로그아웃 — 다크 모드는 아이콘으로 접기 위에 (2026-08-19 사장님) ── */}
      <div className="sb-rail">
        <Link href="/dashboard" className="sb-rail-logo" aria-label="대시보드로 이동" title="대시보드"><OwnerViewIcon size={30} /></Link>
        <div className="sb-rail-groups">
          {filteredNav.map((g) => {
            const on = groupOn(g);
            return (
              <button key={g.label} type="button"
                onMouseEnter={(e) => onRailEnter(g, e)}
                onClick={() => { setViewGroup(g.label); setPreviewGroup(g.label); }}
                className={`sb-rail-btn ${on ? "sb-rail-btn-on" : ""}`} aria-label={g.label} aria-pressed={on}>
                <NavIcon name={g.icon} className={on ? "text-white" : "sb-rail-ico"} />
                <span className="sb-rail-txt">{g.short}</span>
                {groupHasBadge(g) && <span className="sb-rail-dot" aria-label="새 알림" />}
              </button>
            );
          })}
        </div>
        <div className="sb-rail-bottom">
          <Tooltip label={theme === "light" ? "다크 모드" : "라이트 모드"} show>
            <button type="button" onClick={toggleTheme} className="sb-rail-iconbtn" aria-label={theme === "light" ? "다크 모드" : "라이트 모드"}>{themeIcon}</button>
          </Tooltip>
          <Tooltip label={collapsed ? "사이드바 펼치기" : "사이드바 접기"} show>
            <button type="button" onClick={() => { toggleSidebar(); setPreviewGroup(null); }} className="sb-rail-iconbtn" aria-label={collapsed ? "사이드바 펼치기" : "사이드바 접기"}>
              <svg className={`w-4 h-4 transition-transform duration-200 ${collapsed ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="11 17 6 12 11 7" /><polyline points="18 17 13 12 18 7" />
              </svg>
            </button>
          </Tooltip>
          <Tooltip label="로그아웃" show>
            <button type="button" onClick={handleLogout} className="sb-rail-iconbtn sb-rail-iconbtn-danger" aria-label="로그아웃">
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>
          </Tooltip>
        </div>
      </div>

      {/* ── 패널: 브랜드·내 이름·출퇴근 → 검색 → (즐겨찾기) → 고른 그룹의 항목만 ── */}
      {!collapsed && shownGroup && (
        <div className="sb-panel">
          <div className="sb-panel-brand">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-[var(--text)]"><RollingBrandText /></div>
              <div className="text-[10px] text-[var(--text-dim)] flex items-center gap-1">
                {user?.name || user?.email?.split("@")[0] || ""}
                <span className={`sidebar-role-badge ${
                  isMaster ? "bg-[var(--primary-light)] text-[var(--primary)]" : role === "partner" ? "bg-violet-500/12 text-violet-600" : "bg-emerald-500/12 text-emerald-600"
                }`}>
                  {isMaster ? "마스터" : role === "partner" ? "파트너" : role === "advisor" ? "세무 파트너" : "멤버"}
                </span>
              </div>
            </div>
            <SidebarAttendanceButton />
          </div>
          <div className="sidebar-search-block px-3">
            <button onClick={() => openGlobalSearch()} className="sidebar-search-btn gap-2 px-3 py-2">
              <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" strokeLinecap="round" />
              </svg>
              <span>검색</span>
              <kbd className="ml-auto text-[9px] text-[var(--text-dim)] bg-[var(--bg)] px-1.5 py-0.5 rounded border border-[var(--border)]">⌘K</kbd>
            </button>
          </div>
          <nav ref={navRef} className={`sidebar-nav px-3 ${navFade ? "sidebar-nav-fade" : ""}`}>
            {pinnedItems.length > 0 && (
              <div className="sidebar-pinned-block">
                <div className="px-2 mb-1 text-[10px] font-semibold text-amber-500 uppercase tracking-wider flex items-center gap-1">
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg>
                  즐겨찾기
                </div>
                <div className="space-y-0.5">
                  {pinnedItems.map((item) => {
                    const active = isItemActive(item);
                    return (
                      <Link key={`pin-${item.href}`} href={item.href}
                        className={`sidebar-pinned-link gap-2.5 px-2.5 py-2 ${active ? "nav-active" : "text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-surface)]"}`}>
                        <NavIcon name={item.icon} href={item.href} className={active ? "text-white" : ""} />
                        <span className="flex-1">{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="sidebar-nav-group">
              <div className="sb-panel-title"><span>{shownGroup.label}</span><small>{groupItemsFlat(shownGroup).length}</small></div>
              {renderGroupItems(shownGroup)}
            </div>
          </nav>
        </div>
      )}
    </aside>
  );

  //   접힌 상태에서 레일 아이콘에 올렸을 때 떠서 보이는 그 그룹의 패널 — 레일과 사이에 틈을 안 둔다(틈에서 mouseleave 가 나면 닫힌다)
  const flyGroup = collapsed && previewGroup ? filteredNav.find((g) => g.label === previewGroup) : null;
  const flyout = flyGroup ? (
    <div className="sb-flyout-wrap" style={{ top: flyTop }}>
      <div className="sb-flyout chrome-glass">
        <div className="sb-panel-title"><span>{flyGroup.label}</span><small>{groupItemsFlat(flyGroup).length}</small></div>
        {renderGroupItems(flyGroup)}
      </div>
    </div>
  ) : null;

  return (
    <>
      {/* Desktop sidebar: 떠 있는 유리 패널 (여백 두고 둥글게 — 리퀴드글래스 목업 정합) */}
      <div ref={railWrapRef} className="sidebar-desktop-wrapper" onMouseLeave={() => setPreviewGroup(null)}>
        {sidebarContent}
        {flyout}
      </div>

      {/* Mobile overlay backdrop */}
      {mobileOpen && (
        <div
          className="sidebar-mobile-backdrop fixed inset-0"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile sidebar drawer */}
      <div
        className={`sidebar-mobile-drawer ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Force expanded width on mobile */}
        <aside
          className="sidebar-mobile-panel chrome-glass"
        >
          {/* Mobile close button + Logo (U1: 로고 클릭 → /dashboard) */}
          <div className="sidebar-mobile-logo-block">
            <div className="flex items-center gap-2.5">
              <Link href="/dashboard" onClick={() => setMobileOpen(false)} className="sidebar-mobile-brand-link" aria-label="대시보드로 이동">
                <OwnerViewIcon size={28} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-[var(--text)]"><RollingBrandText /></div>
                  <div className="text-[10px] text-[var(--text-dim)] flex items-center gap-1">
                    {user?.name || user?.email?.split("@")[0] || ""}
                    <span className={`sidebar-mobile-role-badge ${
                      isMaster ? "bg-[#2563EB]" : role === "partner" ? "bg-[#7C3AED]" : "bg-[#059669]"
                    }`}>
                          {isMaster ? "마스터" : role === "partner" ? "파트너" : role === "advisor" ? "세무 파트너" : "멤버"}
                    </span>
                  </div>
                </div>
              </Link>
              <button
                onClick={() => setMobileOpen(false)}
                className="sidebar-mobile-close-btn"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>

          {/* Mobile Search */}
          <div className="sidebar-mobile-search-block">
            <button
              onClick={() => {
                setMobileOpen(false);
                openGlobalSearch();
              }}
              className="sidebar-mobile-search-btn"
            >
              <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <circle cx="11" cy="11" r="8" />
                <path d="M21 21l-4.35-4.35" strokeLinecap="round" strokeWidth="2" />
              </svg>
              <span>검색</span>
              <kbd className="ml-auto text-[9px] text-[var(--text-dim)] bg-[var(--bg)] px-1.5 py-0.5 rounded border border-[var(--border)]">
                ⌘K
              </kbd>
            </button>
          </div>

          {/* Mobile Nav Groups */}
          <nav className="sidebar-mobile-nav">
            {/* Mobile Pinned Pages */}
            {pinnedItems.length > 0 && (
              <div className="sidebar-mobile-pinned-block">
                <div className="px-2 mb-1 text-[10px] font-semibold text-amber-500 uppercase tracking-wider flex items-center gap-1">
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg>
                  즐겨찾기
                </div>
                <div className="space-y-0.5">
                  {pinnedItems.map((item) => {
                    const active = isItemActive(item);
                    return (
                      <Link key={`mpin-${item.href}`} href={item.href}
                        className={`sidebar-mobile-pinned-link ${
                          active
                            ? "nav-active"
                            : "text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-surface)]"
                        }`}>
                        <NavIcon name={item.icon} href={item.href} className={active ? "text-white" : ""} />
                        <span className="flex-1">{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}

            {filteredNav.map((group) => {
              const groupClosed = collapsedGroups.has(group.label);
              return (
              <div key={group.label} className="sidebar-mobile-group">
                <button onClick={() => toggleGroup(group.label)}
                  className="sidebar-mobile-group-toggle-btn">
                  <span>{group.label}</span>
                  <span className={`text-[11px] transition-transform ${groupClosed ? "" : "rotate-90"}`}>›</span>
                </button>
                {!groupClosed && (
                <div className="sidebar-mobile-group-list">
                  {group.items.map((item) => {
                    const kids = item.children;
                    if (kids && kids.length) {
                      return <div key={item.href} className="space-y-0.5">{renderMobileItem(item, false)}{kids.map((c) => renderMobileItem(c, true))}</div>;
                    }
                    return renderMobileItem(item, false);
                  })}
                </div>
                )}
              </div>
              );
            })}
          </nav>

          {/* Mobile Theme Toggle */}
          <div className="sidebar-mobile-theme-block">
            <button
              onClick={toggleTheme}
              className="sidebar-mobile-theme-btn"
            >
              {theme === "light" ? (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
                </svg>
              )}
              {theme === "light" ? "다크 모드" : "라이트 모드"}
            </button>
          </div>

          {/* Mobile Footer */}
          <div className="sidebar-mobile-footer-block">
            <button
              onClick={handleLogout}
              className="sidebar-mobile-logout-btn"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                viewBox="0 0 24 24"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              로그아웃
            </button>
          </div>
        </aside>
      </div>
    </>
  );
}
