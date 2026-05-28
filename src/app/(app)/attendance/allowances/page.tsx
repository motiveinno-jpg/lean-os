"use client";

// L 수당 — 관리자/대표 수당 명세 화면 진입점.
//   /attendance/allowances
//   권한: owner/admin (그 외 AccessDenied).

import { useUser } from "@/components/user-context";
import { AccessDenied } from "@/components/access-denied";
import AllowanceAdminTab from "@/components/hr-allowance-admin";

export default function AllowanceAdminPage() {
  const { user, role } = useUser();
  const companyId = user?.company_id ?? null;
  const userId = user?.id ?? null;

  if (role === "employee" || role === "partner") {
    return <AccessDenied detail="수당 명세는 대표·관리자 전용입니다." />;
  }
  if (!companyId) {
    return <div className="p-8 text-center text-sm text-[var(--text-muted)]">로딩 중...</div>;
  }

  return (
    <div>
      <div className="page-sticky-header mb-6">
        <h1 className="text-2xl font-extrabold">수당 명세</h1>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          월별 직원 × 수당 매트릭스. 자동 재계산·수동 수정·CSV export.
        </p>
      </div>
      <AllowanceAdminTab companyId={companyId} userId={userId} />
    </div>
  );
}
