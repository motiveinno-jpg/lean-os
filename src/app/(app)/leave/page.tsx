"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";
import { LeaveTab } from "@/app/(app)/employees/page";
import { LeaveHero } from "@/components/flex-hr-heroes";

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

  // P1 데이터 노출 차단: 직원 역할이 select("*") 로 전 직원 급여·계좌·생년월일을
  //   캐시로 끌어오던 문제. 휴가 화면에 필요한 컬럼만 선택하고(민감 PII 제외),
  //   캐시키도 /leave 전용으로 분리해 타 화면 employees 캐시와 공유되지 않게 한다.
  //   LeaveTab 이 실제 읽는 컬럼: id·name·status·user_id·hire_date (+department/
  //   position/email 은 비민감 메타). 잔여연차는 leave_balances 별도 쿼리라 무관.
  const LEAVE_EMP_COLS = "id,name,department,position,user_id,email,hire_date,status";
  const { data: employees = [] } = useQuery({
    queryKey: ["leave-employees", companyId, isEmployee ? "emp" : "mgr"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("employees")
        .select(isEmployee ? LEAVE_EMP_COLS : "*")
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
    <div className="max-w-[var(--content-max)]">
      <div className="page-sticky-header mb-6">
        <h1 className="text-2xl font-extrabold">휴가 신청</h1>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          {isEmployee
            ? "연차 · 반차 · 특별휴가 신청 및 잔여 확인"
            : "휴가 신청 승인 · 연차 부여 · 잔여 관리"}
        </p>
      </div>
      {/* 플렉스 스타일(2026-06-12): 모듈 히어로 + flex-skin (LeaveTab 무수정) */}
      <LeaveHero companyId={companyId} />
      <div className="flex-skin">
      <LeaveTab
        employees={employees}
        companyId={companyId}
        userId={userId}
        queryClient={queryClient}
        isEmployee={isEmployee}
        autoNew={autoNew}
      />
      </div>
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
