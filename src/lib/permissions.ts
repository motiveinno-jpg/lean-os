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
        { key: "briefing", label: "AI 브리핑 (아침 요약 문장 + 잔고·전망 핵심 숫자)" },
      ] },
      { route: "/copilot", label: "AI 참모" },
      { route: "/mypage", label: "마이페이지", always: true },
      { route: "/notifications", label: "알림", always: true },
    ],
  },
  {
    group: "파이낸스",
    menus: [
      { route: "/collect", label: "수집·전표" },
      { route: "/partners", label: "거래처" },
      //   세금·증빙 = 오너뷰가 **발행하는** 곳으로 재편 (2026-08-13 사장님 지시).
      //   옛 탭(sales·purchase·vat·summary·queue·sync)은 사라졌다 — 목록은 수집·전표,
      //   부가세·요약은 분석(/reports/vat)으로 갔다. 옛 키에 걸어 둔 권한은 이제 아무것도 안 연다.
      { route: "/tax-invoices", label: "세금·증빙 (발행)", tabs: [
        { key: "wait", label: "발행 대기" },
        { key: "done", label: "발행 내역" },
        { key: "issue-status", label: "발행 현황" },
      ] },
      { route: "/e-invoices", label: "전자계산서" },
      { route: "/cash-receipts", label: "현금영수증" },
      { route: "/transactions", label: "자동 분류" },
      { route: "/partners/reconciliation/voucher-entry", label: "일반전표" },
      { route: "/partners/reconciliation/sale-purchase", label: "매입매출전표" },
    ],
  },
  {
    //   분석 — 사이드바 그룹으로 승격 (2026-08-11). 거래처 원장도 여기로 옮겼다.
    //   라우트는 그대로라 기존 권한(/reports, /partners/ledger)이 그대로 먹는다.
    group: "분석",
    menus: [
      { route: "/reports", label: "분석·리포트" },
      { route: "/partners/ledger", label: "거래처 원장" },
    ],
  },
  {
    group: "워크스페이스",
    menus: [
      { route: "/schedule", label: "일정 / 할 일", always: true },
      // 열람 범위 — 구성원(/employees:all)과 같은 방식. '전체'가 없으면 자기가 담당자인 프로젝트만 보인다.
      //   2026-07-31 사장님: "프로젝트도 내 담당과 전체를 권한으로 주자".
      { route: "/projecthub", label: "프로젝트", tabs: [
        { key: "mine", label: "내 담당 프로젝트 (담당자로 지정된 것만)" },
        { key: "all", label: "전체 프로젝트 열람 (미부여 시 내 담당만 보임)" },
      ] },
      { route: "/approvals", label: "결재 허브", tabs: [
        { key: "my-approvals", label: "내 결재함" },
        { key: "my-requests", label: "내 요청" },
        { key: "references", label: "참조" },
        { key: "all", label: "전체 현황" },
        { key: "new-request", label: "새 요청" },
        { key: "forms", label: "양식 관리" },
        { key: "policies", label: "결재 정책" },
      ] },
      // 게시판 자체는 전원 기본, 상단 고정만 부여 대상 (2026-08-05 사장님: 아무나 고정·해제하던 문제)
      { route: "/board", label: "게시판", always: true, tabs: [
        { key: "pin", label: "게시글 상단 고정·해제 (미부여 시 마스터만 가능)" },
      ] },
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
        // 열람 범위 — 이 키가 없으면 구성원 화면에서 '본인 정보'만 보인다(RLS 가 행 단위로 차단).
        //   2026-07-31 사장님: "구성원 탭 권한을 주면 전 직원 내용이 보인다 — 몇몇만 전체, 대부분 본인만".
        { key: "all", label: "전 직원 정보 열람 (미부여 시 본인 정보만 보임)" },
        { key: "salary", label: "급여" },
        { key: "leave", label: "휴가 관리" },
        { key: "certificates", label: "증명서 발급" },
        { key: "permissions", label: "권한 부여 (다른 구성원에게 권한 위임 — 마스터만 부여 가능)" },
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
    //   '자산관리' → '자금' (2026-08-11) → '파이낸스' 안으로 (2026-08-19 사장님: 사이드바에서 자금 그룹을 없앰). 라우트는 그대로라 권한은 유지된다.
    group: "파이낸스",
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
      // 2026-08-13 설정 탭 통합: departments→team, deal→chart, tax→closing 에 흡수.
      //   (certificate·approval 은 2026-08-12 제거) 옛 키로 이미 부여된 권한은 설정 화면이
      //   OR 매핑으로 계속 존중한다 — 여기서는 새 부여 항목만 노출.
      { route: "/settings", label: "회사 설정", tabs: [
        { key: "company-info", label: "회사정보" },
        { key: "team", label: "구성원·초대" },
        { key: "cash", label: "자금·통장" },
        { key: "chart", label: "계정과목·분류" },
        { key: "closing", label: "회계마감" },
        { key: "bank", label: "은행연동" },
        { key: "ads", label: "광고 계정" },
        { key: "attendance", label: "근태·가산수당" },
        { key: "forms", label: "회사 양식" },
      ] },
      { route: "/billing", label: "요금제·결제" },
      // 공지는 전원 열람만. 작성·수정·삭제는 서비스 운영자 페이지(/platform/announcements)에서만 하고
      //   DB 도 announcements_*_operator 정책으로 막았다 — 그래서 부여할 권한 항목이 없다(2026-08-06).
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
  // 세무사 열람 세션 (2026-08-11): 회사가 부여한 권한만 — 일반 구성원과 동일 모델
  //   (사장님: "회사에서 파트너 권한을 주고, 없으면 직원처럼 안 보이게"). 연결 시 세무 기본
  //   패키지가 자동 부여되고, 회사설정 > 세무 파트너 > 권한 설정에서 가감한다.
  //   쓰기는 DB RESTRICTIVE 정책(advisor_ro_*)이 전면 차단 — 화면 권한은 열람 범위만 결정.
  const isAdvisor = (user as any)?.role === "advisor";
  const { data: perms, isLoading } = useQuery({
    queryKey: ["my-permissions", user?.id, isAdvisor ? user?.company_id : null],
    queryFn: async () => {
      if (isAdvisor) {
        const { data } = await (supabase as any).rpc("advisor_my_permissions");
        return new Set<string>(((data || []) as any[]).map((r: any) => (typeof r === "string" ? r : r.advisor_my_permissions)));
      }
      const { data } = await (supabase as any)
        .from("member_permissions")
        .select("perm_key")
        .eq("user_id", user!.id);
      return new Set<string>((data || []).map((r: any) => r.perm_key));
    },
    enabled: !!user?.id && !isMaster,
    // 마스터가 권한을 부여하면 직원 화면이 새로고침 없이 따라오도록 주기 갱신
    //   (2026-07-31 사장님: 템플릿 부여 직후 '권한 없음'으로 보이던 캐시 문제)
    staleTime: 20_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  const set = perms || new Set<string>();
  // ⚠️ 기본 제공(always) 단축은 메뉴 키에만 — 세부탭 키(:포함)는 반드시 명시 부여 필요
  //   (예: /dashboard 는 전원 기본이지만 /dashboard:finance 재무 위젯은 부여자만).
  //   세무사는 always 단축도 안 탄다 — 일정·게시판·메신저 같은 사내 협업 메뉴는 부여해야만 보인다.
  const hasPerm = (key: string) =>
    isMaster
    || (isAdvisor
      ? set.has(key)
      : (!key.includes(":") && ALWAYS_ALLOWED_ROUTES.has(key)) || set.has(key));
  return {
    isMaster,
    loading: userLoading || (!isMaster && isLoading),
    hasPerm,
    hasMenu: (route: string) => hasPerm(route),
  };
}
