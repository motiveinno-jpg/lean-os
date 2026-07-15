"use client";

import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";
import { AttendanceTab } from "@/app/(app)/employees/page";
import { OvertimeRequestCard } from "@/components/overtime-request-card";
import { OvertimeApprovalInbox } from "@/components/overtime-approval-inbox";
import { OvertimeStats } from "@/components/overtime-stats";
import { FlexWorkBoard } from "@/components/flex-work-board";

// 근태 관리 — employees/page.tsx 의 AttendanceTab 재사용. 사이드바 '근태 관리' 진입점.
//   래퍼 시안 리스킨 (공용 컴포넌트 사용, 표시 전용). AttendanceTab 본체(6342줄) 무변경.
//   stat: 출석/지각/결석/휴가 — 출석/지각/휴가는 todayStatus 동일소스, 결석은 derive(가짜 아님).
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
  const isManager = role !== "employee";
  // 플렉스 스타일 워크보드(주간 52h·타임라인) ↔ 기존 기록 상세 토글.
  //   관리자 기본 = 워크보드(조망), 직원 기본 = 기록 상세(본인 출퇴근/수정 동선 유지).
  const [attView, setAttView] = useState<"work" | "records">(isEmployee ? "records" : "work");
  // 상위 섹션: 근무현황 / 연장근무. 휴가 신청·승인은 전자결재로, 연차 설정은 인사관리로 이관(2026-07-15).
  const [section, setSection] = useState<"work" | "overtime">("work");
  // ?view=records/work + ?section=overtime/work 딥링크(근태 수정요청 알림 → records).
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const v = sp.get("view");
    if (v === "records" || v === "work") setAttView(v);
    const s = sp.get("section");
    if (s === "overtime" || s === "work") setSection(s);
    // 휴가(section=leave/focus=pending) 딥링크는 전자결재로 이관 → /leave 리다이렉트가 처리.
  }, []);

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
    return <div className="py-16 text-center text-sm text-[var(--text-muted)]">로딩 중...</div>;
  }

  const activeEmp = (employees as any[]).filter((e) => !["invited", "inactive", "resigned"].includes(e.status)).length;

  return (
    <div className="attendance-page">
      {/* 상위 섹션 탭 — 근무현황 / 연장근무 (휴가는 전자결재로 이관, 2026-07-15) */}
      <div className="attendance-section-tabbar page-sticky-header flex flex-wrap items-center justify-between gap-2 mb-6">
        <div className="seg-bar">
          {([["work", "근무 현황"], ["overtime", "연장근무"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setSection(k)}
              className={`seg-item ${section === k ? "seg-item-active" : ""}`}>
              {l}
            </button>
          ))}
        </div>
        {isManager && <span className="text-xs text-[var(--text-muted)]">재직 {activeEmp.toLocaleString()}명</span>}
      </div>

      {section === "work" && (
        <>
          {/* 플렉스 스타일: [워크보드] 주간 52h 게이지·타임라인 / [기록 상세] 기존 AttendanceTab(무수정) */}
          <div className="attendance-view-tabbar seg-bar mb-4">
            {([["work", "워크보드 (주간)"], ["records", "기록 상세"]] as const).map(([k, l]) => (
              <button key={k} onClick={() => setAttView(k)}
                className={`seg-item ${attView === k ? "seg-item-active" : ""}`}>
                {l}
              </button>
            ))}
          </div>
          {attView === "work" ? (
            <FlexWorkBoard companyId={companyId} employees={employees} role={role} userId={userId} />
          ) : (
            <AttendanceTab
              employees={employees}
              companyId={companyId}
              userId={userId}
              userEmail={userEmail}
              queryClient={queryClient}
              role={role}
            />
          )}
        </>
      )}

      {/* 연장근무 — 본인 신청(전원) + 관리자 승인 인박스. */}
      {section === "overtime" && userId && (
        <div className="attendance-overtime-section space-y-4">
          {isManager && companyId && <OvertimeStats companyId={companyId} />}
          {isManager && <OvertimeApprovalInbox companyId={companyId} reviewerId={userId} />}
          <OvertimeRequestCard companyId={companyId} userId={userId} />
        </div>
      )}
    </div>
  );
}
