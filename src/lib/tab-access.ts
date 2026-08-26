"use client";
import { logRead } from "@/lib/log-read";

// 직원별·탭별 접근 권한. 관리자/대표가 구성원에게 특정 탭(라우트) 접근을 부여.
//   기본: 직원은 탭이 보이되 접근 차단(AccessDenied). 부여된 라우트만 접근 허용.
//   owner/admin 은 항상 전체 접근. owner 전용(보관함/대출 등)은 부여 대상에서 제외.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";
import { useMyPermissions } from "@/lib/permissions";

const db = supabase;

// 부여 가능한 탭(= owner/admin 사이드바 탭). route 는 페이지 prefix.
export const GRANTABLE_TABS: { route: string; label: string; group: string }[] = [
  { route: "/reports/flow", label: "경영 흐름", group: "재무" },
  { route: "/partners/ledger", label: "거래처 원장", group: "재무" },
  { route: "/partners/reconciliation", label: "거래 매칭·전표입력", group: "재무" },
  { route: "/partners", label: "거래처 관리", group: "재무" },
  { route: "/tax-invoices", label: "세금계산서", group: "재무" },
  { route: "/cash-receipts", label: "현금영수증", group: "재무" },
  { route: "/reports", label: "분석·리포트", group: "재무" },
  { route: "/projecthub", label: "프로젝트", group: "업무" },
  { route: "/projects", label: "워크플로우", group: "업무" },
  { route: "/approvals", label: "승인 요청", group: "업무" },
  { route: "/signatures", label: "전자계약", group: "업무" },
  { route: "/attendance", label: "근태 관리", group: "인사" },
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

// 페이지 가드용 — 이 route 접근 가능?
export function useCanAccessTab(route: string): { allowed: boolean; loading: boolean } {
  // (2026-07-31) 새 권한 체계(member_permissions)로 연결 — 구 user_tab_access 판정 폐기.
  //   프로젝트/정기지출/세금계산서 페이지가 이 훅으로 자체 게이트를 걸고 있어, 템플릿으로
  //   새 권한을 받아도 구 시스템 기준으로 차단되던 버그(사장님 제보: 프로젝트 안 들어가짐).
  const { isMaster, hasPerm, loading } = useMyPermissions();
  return { allowed: isMaster || hasPerm(route), loading };
}
