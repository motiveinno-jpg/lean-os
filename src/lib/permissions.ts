"use client";

// ── 마스터·권한 기반 접근 제어 (2026-07-30 개편 P1) ──
//   회사당 마스터 1명(모든 권한 상시 보유), 나머지 멤버는 마스터가 부여한 권한만.
//   perm_key: 메뉴 = 라우트("/bank"), 세부탭 = "라우트:탭키"("/bank:transactions").
//   P1: 카탈로그·부여 화면만. P2~: 사이드바/화면 게이트가 이 키를 소비.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";

//   desc = 툴팁 설명(라벨은 짧게), money = 금액이 보이는 메뉴/기능(₩ 표시 · 저장 확인에서 따로 줄),
//   masterOnly = 마스터만 부여/회수, sub = 위 메뉴의 하위 줄(세금·증빙 아래 전자계산서처럼), hidden = 사이드바에서 내린 옛 메뉴
//   (화면 게이트·기존 부여 키 호환을 위해 카탈로그엔 남기되 권한 표에는 안 그린다).
export type PermTab = { key: string; label: string; desc?: string; money?: boolean; masterOnly?: boolean };
export type PermMenu = { route: string; label: string; tabs?: PermTab[]; always?: boolean; desc?: string; money?: boolean; sub?: boolean; hidden?: boolean };
export type PermGroup = { group: string; menus: PermMenu[] };

// 전 메뉴·세부탭 카탈로그 — **사이드바(NAV_GROUPS)와 같은 순서·이름** (2026-08-19 사장님: 바뀐 메뉴 위치대로 정리).
//   키(route·tab key)는 절대 바꾸지 않는다 — member_permissions.perm_key 와 화면 게이트가 이 키로 돈다.
//   always: 모든 구성원 기본 제공(부여 대상 아님 — 마이페이지·알림 등 개인 영역). always 메뉴의 세부탭은 부여 대상.
export const PERMISSION_CATALOG: PermGroup[] = [
  {
    group: "홈",
    menus: [
      // 대시보드 자체는 전원 기본 제공 — 금액 위젯·AI 브리핑은 세부 권한
      { route: "/dashboard", label: "대시보드", always: true, tabs: [
        { key: "finance", label: "재무·경영 위젯", desc: "신호 6칸·통장·카드·미수·매출 등 금액 위젯", money: true },
        { key: "briefing", label: "AI 브리핑", desc: "오늘 챙길 것(AI 제안)" },
      ] },
      { route: "/notifications", label: "알림", always: true },
      { route: "/mypage", label: "마이페이지", always: true },
      { route: "/copilot", label: "AI 참모", desc: "회사 자료를 읽고 답하는 AI — 금액 질문에 답할 수 있다", money: true },
      //   지원사업 (2026-08-21) — 직원 생년월일·급여로 고용장려금 자격을 판정하므로 인사 정보를 읽는다
      { route: "/support-programs", label: "지원사업추천", desc: "회사 자료로 걸러 주는 정부 지원정책 — 예상 수령액을 계산해 보여준다", money: true },
    ],
  },
  {
    //   파이낸스 A안 순서(2026-08-19): 기초(통장·카드·거래처) → 자료(수집·전표·세금·증빙) → 기장(일반·매입매출전표) → 예정(정기 지출)
    group: "파이낸스",
    menus: [
      { route: "/bank", label: "통장", money: true, tabs: [
        { key: "overview", label: "개요" },
        { key: "accounts", label: "계좌·잔액" },
        { key: "transactions", label: "거래내역" },
      ] },
      { route: "/cards", label: "카드", money: true },
      { route: "/partners", label: "거래처" },
      { route: "/collect", label: "수집·전표", money: true, desc: "통장·카드·계산서 자료를 받아 전표로" },
      //   세금·증빙 = 오너뷰가 **발행하는** 곳으로 재편 (2026-08-13 사장님 지시).
      //   옛 탭(sales·purchase·vat·summary·queue·sync)은 사라졌다 — 목록은 수집·전표, 부가세·요약은 분석(/reports/vat)으로 갔다.
      { route: "/tax-invoices", label: "세금·증빙", money: true, desc: "세금계산서 발행", tabs: [
        { key: "wait", label: "발행 대기" },
        { key: "done", label: "발행 내역" },
        { key: "issue-status", label: "발행 현황" },
      ] },
      //   사이드바에선 세금·증빙 한 메뉴 안(match)이지만 권한 키는 따로다 — 하위 줄로 그린다
      { route: "/e-invoices", label: "전자계산서", money: true, sub: true },
      { route: "/cash-receipts", label: "현금영수증", money: true, sub: true },
      { route: "/partners/reconciliation/voucher-entry", label: "일반전표", money: true },
      { route: "/partners/reconciliation/sale-purchase", label: "매입매출전표", money: true },
      { route: "/payments", label: "정기 지출", money: true },
      //   2026-08-11 사이드바에서 내림(수집·전표 통장 탭이 대신). 주소로는 열리므로 게이트·옛 부여 키 호환을 위해 남긴다 — 표에는 안 그림
      { route: "/transactions", label: "자동 분류", money: true, hidden: true },
    ],
  },
  {
    //   분석 — 사이드바 그룹(2026-08-11). 라우트는 그대로라 기존 권한(/reports, /partners/ledger)이 그대로 먹는다.
    group: "분석",
    menus: [
      { route: "/reports", label: "분석·리포트", money: true, desc: "경영 요약 · 손익 현황 · 자금 전망 · 회계 자료 · 부가세 — 한 권한으로 전부" },
      { route: "/partners/ledger", label: "거래처 원장", money: true, desc: "미수·미지급 원장" },
    ],
  },
  {
    group: "워크스페이스",
    menus: [
      { route: "/schedule", label: "일정 / 할 일", always: true },
      // 열람 범위 — 구성원(/employees:all)과 같은 방식. '전체'가 없으면 자기가 담당자인 프로젝트만 보인다 (2026-07-31 사장님).
      { route: "/projecthub", label: "프로젝트", tabs: [
        { key: "mine", label: "내 담당만", desc: "담당자로 지정된 프로젝트만" },
        { key: "all", label: "전체 열람", desc: "미부여 시 내 담당만 보임" },
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
        { key: "pin", label: "상단 고정", desc: "게시글 상단 고정·해제 (미부여 시 마스터만)" },
      ] },
      { route: "/my-contracts", label: "내 서명 요청", always: true },
      // 파일보관함 — 인사관리 → 워크스페이스 (2026-08-20 사장님). 키 불변
      //   삭제는 기본이 '본인이 올린 파일만'. 남의 파일까지 지우려면 아래 세부권한이 있어야 한다
      //   (2026-08-20 사장님: "모든 사람이 삭제가 가능해" — 회사 구성원 누구나 남의 파일을 지우던 문제)
      { route: "/documents", label: "파일보관함", tabs: [
        { key: "delete", label: "남의 파일 삭제", desc: "다른 사람이 올린 파일도 삭제 (미부여 시 본인이 올린 것만)" },
      ] },
      { route: "/chat", label: "메신저", always: true },
      { route: "/signatures", label: "전자계약" },
    ],
  },
  {
    //   재고 (2026-08-25 신설) — 단가·원가가 보이므로 품목·구매는 money.
    //   ★ 새 키는 member_permissions 에 행이 없어 **백필 전까지 마스터 외 아무도 못 본다** — 배포와 함께 백필한다.
    group: "재고",
    menus: [
      { route: "/inventory/products", label: "품목", money: true, desc: "SKU·규격·판매가·매입가 — 원가가 보인다" },
      { route: "/inventory/stock", label: "재고", tabs: [
        { key: "adjust", label: "입·출고와 조정", desc: "미부여 시 수량 보기만 — 재고를 움직일 수 없다" },
      ] },
      { route: "/inventory/orders", label: "주문", money: true, desc: "주문서·견적 — 재고는 안 움직인다" },
      { route: "/inventory/sales", label: "판매", money: true },
      { route: "/inventory/purchase", label: "구매", money: true },
      { route: "/inventory/production", label: "생산" },
      { route: "/inventory/channels", label: "채널", money: true, desc: "온라인 주문 가져오기 · 채널 상품 연결" },
    ],
  },
  {
    group: "인사관리",
    menus: [
      { route: "/employees", label: "구성원", tabs: [
        { key: "employees", label: "인력관리" },
        // 열람 범위 — 이 키가 없으면 구성원 화면에서 '본인 정보'만 보인다(RLS 가 행 단위로 차단). 2026-07-31 사장님.
        { key: "all", label: "전 직원 열람", desc: "미부여 시 본인 정보만 보임" },
        { key: "salary", label: "급여", money: true },
        { key: "leave", label: "휴가 관리" },
        { key: "certificates", label: "증명서 발급" },
        { key: "permissions", label: "권한 부여", desc: "다른 구성원에게 권한 위임 — 마스터만 부여 가능", masterOnly: true },
      ] },
      { route: "/attendance", label: "근태 관리", tabs: [
        { key: "board", label: "워크보드" },
        { key: "records", label: "기록 상세·수정" },
        //   2026-08-24 회사 설정에서 이관 — 출퇴근 기준·지각 유예·야간 시간대·근무 요일·휴일.
        //   옛 '/settings:attendance' 권한자도 보이게 화면이 OR 로 받는다(새 키 백필 불필요).
        { key: "settings", label: "근무 기준", desc: "출퇴근 기준 시각·유예·야간 시간대·근무 요일·휴일" },
      ] },
      { route: "/hr-templates", label: "근로계약·서식" },
      { route: "/team", label: "구성원 디렉토리", always: true },
    ],
  },
  {
    group: "회사 관리",
    menus: [
      // 2026-08-13 설정 탭 통합: departments→team, deal→chart, tax→closing 에 흡수. (certificate·approval 은 2026-08-12 제거)
      //   옛 키로 이미 부여된 권한은 설정 화면이 OR 매핑으로 계속 존중한다 — 여기서는 새 부여 항목만 노출.
      //   2026-08-24 설정 IA 재편 — 이 12개 세부탭이 사이드바 **다섯 줄**로 갈렸다(lib/settings-nav.ts).
      //     ★ 부여 키(key)는 하나도 바꾸지 않았다 — member_permissions 백필 0건.
      //       사이드바는 "그룹 안 키를 하나라도 받았으면 그 줄을 보여준다"로 판정한다(NavItem.anyPerm).
      //     아래 순서·묶음은 사이드바 순서와 같게 맞춘 것이다(그룹 소제목을 권한 화면에도 그리는 일은 후속).
      { route: "/settings", label: "회사 설정", tabs: [
        // 회사 기초정보 (/settings/company)
        { key: "company-info", label: "회사정보" },
        { key: "forms", label: "회사 양식" },
        // 구성원·초대 (/settings/people)
        //   2026-08-24 'attendance'(근태·가산수당) 는 인사관리로 이관돼 여기서 뺐다.
        //   ★ 이미 부여된 '/settings:attendance' 는 **계속 유효하다** — 근태 관리 '근무 기준' 탭과
        //     구성원 › 급여 '수당 기준' 이 그 옛 키를 OR 로 받아 준다(백필·회수 없이 권한자가 그대로 본다).
        { key: "team", label: "구성원·초대" },
        // 회계·세무 (/settings/finance)
        { key: "cash", label: "자금·통장", money: true },
        { key: "chart", label: "계정과목·분류" },
        { key: "closing", label: "회계마감" },
        //   2026-08-21 회사정보 분리 — 옛 'company-info' 권한자도 계속 보이게 설정 화면이 OR 로 받는다
        { key: "tax-partner", label: "세무 파트너" },
        // 연동·API 키 (/settings/integration)
        //   2026-08-21 신설 — 회사가 발급받은 외부 인증키. 기존 'ads' 권한자도 볼 수 있게
        //   설정 화면이 OR 로 받아 준다(settings-nav 의 perms = ["api-keys","ads"]).
        { key: "api-keys", label: "연동·API 키" },
        { key: "bank", label: "은행연동" },
        { key: "ads", label: "광고 계정" },
        // 보안·시스템 (/settings/system) — 회사 삭제는 마스터 전용이라 부여 대상이 아니다
        //   2026-08-24 '보안·알림' → '접속 보안' (결재 총괄 알림 삭제). 부여 키(security)는 그대로다.
        { key: "security", label: "접속 보안" },
      ] },
      { route: "/billing", label: "요금제·결제", money: true },
    ],
  },
  {
    //   도움말 — 전부 기본 제공. 공지는 전원 열람만(작성은 운영자 페이지, DB 정책으로 차단 2026-08-06) — 부여 항목 없음
    group: "도움말",
    menus: [
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
