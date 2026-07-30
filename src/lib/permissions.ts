"use client";

// ── 마스터·권한 기반 접근 제어 (2026-07-30 개편 P1) ──
//   회사당 마스터 1명(모든 권한 상시 보유), 나머지 멤버는 마스터가 부여한 권한만.
//   perm_key: 메뉴 = 라우트("/bank"), 세부탭 = "라우트:탭키"("/bank:transactions").
//   P1: 카탈로그·부여 화면만. P2~: 사이드바/화면 게이트가 이 키를 소비.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";

export type PermTab = { key: string; label: string };
export type PermMenu = { route: string; label: string; tabs?: PermTab[]; always?: boolean };
export type PermGroup = { group: string; menus: PermMenu[] };

// 전 메뉴·세부탭 카탈로그 — 사이드바(NAV_GROUPS)와 각 페이지의 탭 구성을 따른다.
//   always: 모든 구성원 기본 제공(부여 대상 아님 — 마이페이지·알림 등 개인 영역).
export const PERMISSION_CATALOG: PermGroup[] = [
  {
    group: "홈",
    menus: [
      // 대시보드 자체는 전원 기본 제공(필수 위젯: 출근·할일·캘린더) — 금액 위젯은 세부 권한
      { route: "/dashboard", label: "대시보드", always: true, tabs: [
        { key: "finance", label: "재무·경영 위젯 (현금펄스·매출·잔액 등 금액 정보)" },
      ] },
      { route: "/copilot", label: "AI 참모" },
      { route: "/mypage", label: "마이페이지", always: true },
      { route: "/notifications", label: "알림", always: true },
    ],
  },
  {
    group: "파이낸스",
    menus: [
      { route: "/partners", label: "거래처" },
      { route: "/partners/ledger", label: "거래처 원장" },
      { route: "/tax-invoices", label: "세금계산서", tabs: [
        { key: "sales", label: "매출" },
        { key: "purchase", label: "매입" },
        { key: "vat", label: "부가세" },
        { key: "summary", label: "요약" },
        { key: "queue", label: "발행 대기" },
        { key: "sync", label: "홈택스 동기화" },
      ] },
      { route: "/cash-receipts", label: "현금영수증" },
      { route: "/transactions", label: "거래 장부" },
      { route: "/partners/reconciliation/voucher-entry", label: "전표입력" },
      { route: "/reports", label: "분석·리포트" },
    ],
  },
  {
    group: "워크스페이스",
    menus: [
      { route: "/schedule", label: "일정 / 할 일", always: true },
      { route: "/projecthub", label: "프로젝트" },
      { route: "/approvals", label: "결재 허브", tabs: [
        { key: "my-approvals", label: "내 결재함" },
        { key: "my-requests", label: "내 요청" },
        { key: "references", label: "참조" },
        { key: "all", label: "전체 현황" },
        { key: "new-request", label: "새 요청" },
        { key: "forms", label: "양식 관리" },
        { key: "policies", label: "결재 정책" },
      ] },
      { route: "/board", label: "게시판", always: true },
      { route: "/my-contracts", label: "내 서명 요청", always: true },
      { route: "/chat", label: "메신저", always: true },
      { route: "/signatures", label: "전자계약" },
    ],
  },
  {
    group: "인사관리",
    menus: [
      { route: "/employees", label: "구성원", tabs: [
        { key: "employees", label: "인력관리" },
        { key: "salary", label: "급여" },
        { key: "leave", label: "휴가 관리" },
        { key: "certificates", label: "증명서 발급" },
      ] },
      { route: "/attendance", label: "근태 관리", tabs: [
        { key: "board", label: "워크보드" },
        { key: "records", label: "기록 상세·수정" },
      ] },
      { route: "/hr-templates", label: "근로계약·서식" },
      { route: "/documents", label: "파일보관함" },
      { route: "/team", label: "구성원 디렉토리", always: true },
    ],
  },
  {
    group: "자산관리",
    menus: [
      { route: "/bank", label: "통장", tabs: [
        { key: "overview", label: "개요" },
        { key: "accounts", label: "계좌·잔액" },
        { key: "transactions", label: "거래내역" },
      ] },
      { route: "/cards", label: "카드" },
      { route: "/payments", label: "정기 지출" },
    ],
  },
  {
    group: "설정·관리",
    menus: [
      { route: "/settings", label: "회사 설정", tabs: [
        { key: "company-info", label: "회사정보" },
        { key: "team", label: "팀·권한" },
        { key: "cash", label: "자금·통장" },
        { key: "chart", label: "계정과목" },
        { key: "closing", label: "회계마감" },
        { key: "tax", label: "세무자동화" },
        { key: "bank", label: "은행연동" },
        { key: "certificate", label: "인증서" },
        { key: "departments", label: "부서" },
        { key: "attendance", label: "근태·가산수당" },
        { key: "approval", label: "승인·결재" },
        { key: "deal", label: "딜 분류" },
        { key: "forms", label: "회사 양식" },
        { key: "data", label: "데이터 관리" },
      ] },
      { route: "/billing", label: "요금제·결제" },
      { route: "/announcements", label: "공지사항", always: true },
      { route: "/guide", label: "사용 가이드", always: true },
      { route: "/support", label: "고객센터", always: true },
    ],
  },
];

export const ALWAYS_ALLOWED_ROUTES = new Set(
  PERMISSION_CATALOG.flatMap((g) => g.menus).filter((m) => m.always).map((m) => m.route),
);

/** 카탈로그의 모든 메뉴 라우트 (always 포함) */
export const CATALOG_ROUTES: string[] = PERMISSION_CATALOG.flatMap((g) => g.menus.map((m) => m.route));

/** pathname → 카탈로그 메뉴 라우트(가장 긴 접두 매치). 카탈로그 밖 경로는 null(게이트 비대상). */
export function matchCatalogRoute(pathname: string): string | null {
  let best: string | null = null;
  for (const r of CATALOG_ROUTES) {
    if (pathname === r || pathname.startsWith(r + "/")) {
      if (!best || r.length > best.length) best = r;
    }
  }
  return best;
}

/** 부여 가능한 전체 perm key (always 제외) — 메뉴 키 + 탭 키 */
export function allGrantableKeys(): string[] {
  const keys: string[] = [];
  for (const g of PERMISSION_CATALOG) {
    for (const m of g.menus) {
      if (!m.always) keys.push(m.route);
      // 기본 제공 메뉴여도 세부탭은 부여 대상 (예: 대시보드 재무 위젯)
      for (const t of m.tabs || []) keys.push(`${m.route}:${t.key}`);
    }
  }
  return keys;
}

/** 현재 사용자 권한 — 마스터는 전부 true. 멤버는 member_permissions 기반. */
export function useMyPermissions(): {
  isMaster: boolean;
  loading: boolean;
  hasPerm: (key: string) => boolean;
  hasMenu: (route: string) => boolean;
} {
  const { user, loading: userLoading } = useUser();
  const isMaster = !!(user as any)?.is_master;
  const { data: perms, isLoading } = useQuery({
    queryKey: ["my-permissions", user?.id],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("member_permissions")
        .select("perm_key")
        .eq("user_id", user!.id);
      return new Set<string>((data || []).map((r: any) => r.perm_key));
    },
    enabled: !!user?.id && !isMaster,
    staleTime: 60_000,
  });
  const set = perms || new Set<string>();
  // ⚠️ 기본 제공(always) 단축은 메뉴 키에만 — 세부탭 키(:포함)는 반드시 명시 부여 필요
  //   (예: /dashboard 는 전원 기본이지만 /dashboard:finance 재무 위젯은 부여자만).
  const hasPerm = (key: string) => isMaster || (!key.includes(":") && ALWAYS_ALLOWED_ROUTES.has(key)) || set.has(key);
  return {
    isMaster,
    loading: userLoading || (!isMaster && isLoading),
    hasPerm,
    hasMenu: (route: string) => hasPerm(route),
  };
}
