"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";
import { LeaveTab } from "@/app/(app)/employees/page";

// 휴가 신청 — employees/page.tsx 의 LeaveTab 재사용. 사이드바 '휴가 신청' 단일 진입점.
//   직원이 "인력관리>휴가 탭"(사이드바에 없는 명칭)으로 헤매던 동선 미로를 해소한다.
function LeavePageInner() {
  const { user, role } = useUser();
  const companyId = user?.company_id ?? null;
  const userId = user?.id ?? null;
  const queryClient = useQueryClient();
  const sp = useSearchParams();
  const autoNew = sp?.get("new") === "1";
  const isEmployee = role === "employee";

  const { data: employees = [] } = useQuery({
    queryKey: ["employees", companyId],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("employees")
        .select("*")
        .eq("company_id", companyId!)
        .order("created_at", { ascending: false });
      return data || [];
    },
    enabled: !!companyId,
  });

  if (!companyId) {
    return <div className="p-8 text-center text-sm text-[var(--text-muted)]">로딩 중...</div>;
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold">휴가 신청</h1>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          {isEmployee
            ? "연차 · 반차 · 특별휴가 신청 및 잔여 확인"
            : "휴가 신청 승인 · 연차 부여 · 잔여 관리"}
        </p>
      </div>
      <LeaveTab
        employees={employees}
        companyId={companyId}
        userId={userId}
        queryClient={queryClient}
        isEmployee={isEmployee}
        autoNew={autoNew}
      />
    </div>
  );
}

export default function LeavePage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-sm text-[var(--text-muted)]">로딩 중...</div>}>
      <LeavePageInner />
    </Suspense>
  );
}
