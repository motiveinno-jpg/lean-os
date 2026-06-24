"use client";

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
  { route: "/employees", label: "구성원", group: "인사관리" },
  { route: "/attendance", label: "근태 관리", group: "인사관리" },
  { route: "/bank", label: "통장", group: "자산관리" },
  { route: "/cards", label: "카드", group: "자산관리" },
  { route: "/payments", label: "정기결제", group: "자산관리" },
  { route: "/subscriptions", label: "구독", group: "자산관리" },
];

const GRANTABLE_ROUTES = GRANTABLE_TABS.map((t) => t.route);

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

// 현재 사용자가 부여받은 라우트 집합 (owner/admin 은 의미 없음 — 항상 전체 허용)
export function useMyGrantedRoutes(): { routes: Set<string>; loading: boolean } {
  const { user } = useUser();
  const userId = user?.id ?? null;
  const isPrivileged = user?.role === "owner" || user?.role === "admin";
  const { data, isLoading } = useQuery({
    queryKey: ["my-tab-access", userId],
    queryFn: async () => {
      const { data } = await db.from("user_tab_access").select("route").eq("user_id", userId);
      return new Set<string>((data || []).map((r: any) => r.route as string));
    },
    enabled: !!userId && !isPrivileged,
    staleTime: 60_000,
  });
  return { routes: data ?? new Set<string>(), loading: !!userId && !isPrivileged && isLoading };
}

// 페이지 가드용 — 이 route 접근 가능?
export function useCanAccessTab(route: string): { allowed: boolean; loading: boolean } {
  const { user } = useUser();
  const isPrivileged = user?.role === "owner" || user?.role === "admin";
  const { routes, loading } = useMyGrantedRoutes();
  if (isPrivileged) return { allowed: true, loading: false };
  return { allowed: routes.has(route), loading };
}

// 특정 직원의 부여 목록(관리자 부여 UI용)
export async function getUserTabAccess(userId: string): Promise<Set<string>> {
  const { data } = await db.from("user_tab_access").select("route").eq("user_id", userId);
  return new Set<string>((data || []).map((r: any) => r.route as string));
}

export async function grantTab(companyId: string, userId: string, route: string, grantedBy: string) {
  const { error } = await db.from("user_tab_access").upsert(
    { company_id: companyId, user_id: userId, route, granted_by: grantedBy },
    { onConflict: "user_id,route" },
  );
  if (error) throw new Error(error.message);
}

export async function revokeTab(userId: string, route: string) {
  const { error } = await db.from("user_tab_access").delete().eq("user_id", userId).eq("route", route);
  if (error) throw new Error(error.message);
}
