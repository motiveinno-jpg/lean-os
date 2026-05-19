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

  // P1 데이터 노출 차단(/leave a9e7b09 와 동일 패턴): 직원 역할이 select("*")
  //   로 전 직원 급여·계좌·생년월일을 캐시로 끌어오던 문제. 근태 화면에 필요한
  //   컬럼만(민감 PII 제외) + 캐시키를 /attendance 전용으로 분리해 타 화면
  //   employees 캐시와 공유되지 않게 한다. AttendanceTab/QuickAttendanceButtons
  //   이 읽는 컬럼: id·name·status·user_id·email (+department/position 비민감).
  const ATT_EMP_COLS = "id,name,department,position,user_id,email,hire_date,status";
  const isEmployee = role === "employee";
  const { data: employees = [] } = useQuery({
    queryKey: ["attendance-employees", companyId, isEmployee ? "emp" : "mgr"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("employees")
        .select(isEmployee ? ATT_EMP_COLS : "*")
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
