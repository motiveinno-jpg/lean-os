"use client";
import { logRead } from "@/lib/log-read";

// 직원별·탭별 접근 권한. 관리자/대표가 구성원에게 특정 탭(라우트) 접근을 부여.
//   기본: 직원은 탭이 보이되 접근 차단(AccessDenied). 부여된 라우트만 접근 허용.
//   owner/admin 은 항상 전체 접근. owner 전용(보관함/대출 등)은 부여 대상에서 제외.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";

const db = supabase as any;

// 부여 가능한 탭(= owner/admin 사이드바 탭). route 는 페이지 prefix.
export const GRANTABLE_TABS: { route: string; label: string; group: string }[] = [
  { route: "/reports/flow", label: "경영 흐름", group: "파이낸스" },
  { route: "/partners/ledger", label: "거래처 원장", group: "파이낸스" },
  { route: "/partners/reconciliation", label: "거래 매칭·전표입력", group: "파이낸스" },
  { route: "/partners", label: "거래처 관리", group: "파이낸스" },
  { route: "/tax-invoices", label: "세금계산서", group: "파이낸스" },
  { route: "/cash-receipts", label: "현금영수증", group: "파이낸스" },
  { route: "/reports", label: "분석·리포트", group: "파이낸스" },
  { route: "/projecthub", label: "프로젝트", group: "워크스페이스" },
  { route: "/projects", label: "워크플로우", group: "워크스페이스" },
  { route: "/approvals", label: "승인 요청", group: "워크스페이스" },
  { route: "/signatures", label: "전자계약", group: "워크스페이스" },
  { route: "/attendance", label: "근태 관리", group: "인사관리" },
  { route: "/bank", label: "통장", group: "자산관리" },
  { route: "/cards", label: "카드", group: "자산관리" },
  { route: "/payments", label: "정기결제", group: "자산관리" },
  { route: "/subscriptions", label: "구독", group: "자산관리" },
];

const GRANTABLE_ROUTES = GRANTABLE_TABS.map((t) => t.route);

// 직원이 부여 없이도 기본 접근 가능한 라우트(app-shell ROLE_ALLOWED_ROUTES.employee 와 동기화).
//   부여 UI 에서 '기본 접근(항상 ON)' 으로 표시 — 끌 수 없음.
export const EMPLOYEE_BASE_ROUTES = new Set<string>([
  "/projects", "/approvals", "/signatures", "/attendance",
]);

// pathname → 부여 대상 route(가장 긴 prefix). 없으면 null(보호 비대상).
export function matchGrantableRoute(pathname: string): string | null {
  let best: string | null = null;
  for (const r of GRANTABLE_ROUTES) {
    if (pathname === r || pathname.startsWith(r + "/")) {
      if (!best || r.length > best.length) best = r;
    }
  }
  return best;
}

// 현재 사용자의 명시 오버라이드 맵 (route → allowed). 행 없으면 기본값 적용.
//   owner 는 항상 전체 접근(쿼리 생략).
export function useMyTabOverrides(): { map: Map<string, boolean>; loading: boolean } {
  const { user } = useUser();
  const userId = user?.id ?? null;
  const isOwner = user?.role === "owner";
  const { data, isLoading } = useQuery({
    queryKey: ["my-tab-access", userId],
    queryFn: async () => {
      const data = logRead('lib/tab-access:data', await db.from("user_tab_access").select("route, allowed").eq("user_id", userId));
      const m = new Map<string, boolean>();
      for (const r of (data || [])) m.set(r.route as string, (r as any).allowed !== false);
      return m;
    },
    enabled: !!userId && !isOwner,
    staleTime: 60_000,
  });
  return { map: data ?? new Map<string, boolean>(), loading: !!userId && !isOwner && isLoading };
}

// 실효 접근 판정: owner=항상, 명시행 있으면 그 값, 없으면 기본(admin=전체 / 직원=기본제공만).
export function effectiveTabAccess(route: string, role: string | null | undefined, overrides: Map<string, boolean>): boolean {
  if (role === "owner") return true;
  if (overrides.has(route)) return overrides.get(route)!;
  if (role === "admin") return true;
  return EMPLOYEE_BASE_ROUTES.has(route);
}

// 페이지 가드용 — 이 route 접근 가능?
export function useCanAccessTab(route: string): { allowed: boolean; loading: boolean } {
  const { user } = useUser();
  const { map, loading } = useMyTabOverrides();
  if (user?.role === "owner") return { allowed: true, loading: false };
  return { allowed: effectiveTabAccess(route, user?.role, map), loading };
}

// 특정 직원의 명시 오버라이드(관리자 부여 UI용)
export async function getUserTabAccess(userId: string): Promise<Map<string, boolean>> {
  const data = logRead('lib/tab-access:data', await db.from("user_tab_access").select("route, allowed").eq("user_id", userId));
  const m = new Map<string, boolean>();
  for (const r of (data || [])) m.set(r.route as string, (r as any).allowed !== false);
  return m;
}

// 명시 허용/차단 설정(upsert). allowed=true 허용, false 차단(기본 켜진 것도 끌 수 있음).
export async function setTabAccess(companyId: string, userId: string, route: string, allowed: boolean, grantedBy: string) {
  const { error } = await db.from("user_tab_access").upsert(
    { company_id: companyId, user_id: userId, route, allowed, granted_by: grantedBy },
    { onConflict: "user_id,route" },
  );
  if (error) throw new Error(error.message);
}
