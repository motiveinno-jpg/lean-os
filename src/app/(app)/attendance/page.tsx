"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";
import { AttendanceTab } from "@/app/(app)/employees/page";

// 근태 관리 — employees/page.tsx 의 AttendanceTab 재사용. 사이드바 '근태 관리' 진입점.
export default function AttendancePage() {
  const { user, role } = useUser();
  const companyId = user?.company_id ?? null;
  const userId = user?.id ?? null;
  const userEmail = user?.email ?? null;
  const queryClient = useQueryClient();

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
        <h1 className="text-2xl font-extrabold">근태 관리</h1>
        <p className="text-sm text-[var(--text-muted)] mt-1">출퇴근 기록 · 월별 근무시간 · 휴가 사용 현황</p>
      </div>
      <AttendanceTab
        employees={employees}
        companyId={companyId}
        userId={userId}
        userEmail={userEmail}
        queryClient={queryClient}
        role={role}
      />
    </div>
  );
}
