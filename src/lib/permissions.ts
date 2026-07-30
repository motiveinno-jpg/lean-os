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
      { route: "/dashboard", label: "대시보드" },
      { route: "/copilot", label: "AI 참모" },
      { route: "/mypage", label: "마이페이지", always: true },
      { route: "/notifications", label: "알림", always: true },
    ],
  },
  {
    group: "파이낸스",
    menus: [
      { route: "/partners", label: "거래처", tabs: [
        { key: "list", label: "거래처 목록" },
        { key: "ledger", label: "거래처 원장" },
        { key: "reconciliation", label: "거래 매칭" },
      ] },
      { route: "/tax-invoices", label: "세금계산서", tabs: [
        { key: "invoices", label: "세금계산서 목록·발행" },
        { key: "bulk", label: "엑셀 일괄발행" },
        { key: "sync", label: "홈택스 동기화" },
      ] },
      { route: "/cash-receipts", label: "현금영수증" },
      { route: "/transactions", label: "거래 장부" },
      { route: "/partners/reconciliation/voucher-entry", label: "전표입력" },
      { route: "/reports", label: "분석·리포트", tabs: [
        { key: "flow", label: "경영 흐름" },
        { key: "closing", label: "월 결산" },
      ] },
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
      { route: "/chat", label: "메신저", always: true },
      { route: "/signatures", label: "전자계약", tabs: [
        { key: "send", label: "서명 요청 보내기" },
        { key: "inbox", label: "받은 요청" },
      ] },
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
    ],
  },
  {
    group: "자산관리",
    menus: [
      { route: "/bank", label: "통장", tabs: [
        { key: "accounts", label: "계좌·잔액" },
        { key: "transactions", label: "거래내역" },
        { key: "sync", label: "CODEF 연동 실행" },
      ] },
      { route: "/cards", label: "카드" },
      { route: "/payments", label: "정기 지출" },
    ],
  },
  {
    group: "설정·관리",
    menus: [
      { route: "/settings", label: "회사 설정", tabs: [
        { key: "company", label: "회사 정보" },
        { key: "team", label: "팀·초대" },
        { key: "bank", label: "은행 연동(자격증명)" },
        { key: "notifications", label: "알림 설정" },
        { key: "approvals", label: "결재 정책" },
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

/** 부여 가능한 전체 perm key (always 제외) — 메뉴 키 + 탭 키 */
export function allGrantableKeys(): string[] {
  const keys: string[] = [];
  for (const g of PERMISSION_CATALOG) {
    for (const m of g.menus) {
      if (m.always) continue;
      keys.push(m.route);
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
  const hasPerm = (key: string) => isMaster || ALWAYS_ALLOWED_ROUTES.has(key.split(":")[0]) || set.has(key);
  return {
    isMaster,
    loading: userLoading || (!isMaster && isLoading),
    hasPerm,
    hasMenu: (route: string) => hasPerm(route),
  };
}
