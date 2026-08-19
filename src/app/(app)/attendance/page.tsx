"use client";
import { logRead } from "@/lib/log-read";
import { useMyPermissions } from "@/lib/permissions";

import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";
import { AttendanceTab } from "@/app/(app)/employees/EmployeesPageClient";
import { FlexWorkBoard } from "@/components/flex-work-board";
import { EditRequestInbox } from "@/components/hr-attendance-extras";
import { QueryScreen, QueryHead, QueryBody } from "@/components/query-kit";
import { AttendanceStatusTab } from "./_components/AttendanceStatusTab";

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
  // (2026-07-30 개편 P3) 관리 판정을 권한 기반으로 — 마스터 또는 '기록 상세·수정' 권한 보유자가 관리자급.
  //   본인 출퇴근(개인 동선)은 권한 무관 항상 가능.
  const { isMaster, hasPerm } = useMyPermissions();
  const canManage = isMaster || hasPerm("/attendance:records");
  const canBoard = isMaster || hasPerm("/attendance:board");
  const isEmployee = !canManage;
  const isManager = canManage;
  // 보드 스타일 워크보드(주간 52h·타임라인) ↔ 기존 기록 상세 토글.
  //   관리자 기본 = 워크보드(조망), 직원 기본 = 기록 상세(본인 출퇴근/수정 동선 유지).
  const [attView, setAttView] = useState<"work" | "records">("records");
  useEffect(() => { if (canBoard && canManage) setAttView((v) => (v === "records" && !new URLSearchParams(window.location.search).get("view") ? "work" : v)); }, [canBoard, canManage]);
  // 상위 섹션: 근무현황 / 연장근무. 휴가 신청·승인은 전자결재로, 연차 설정은 인사관리로 이관(2026-07-15).
  //   2026-08-19: 연장근무 신청·승인은 결재 허브(/approvals?tab=overtime)로 옮겼다 — 여기 셋째 갈래는 "월간 요약"(부서→직원 지표)
  const [section, setSection] = useState<"work" | "summary">("work");
  // ?view=records/work + ?section=overtime/work 딥링크(근태 수정요청 알림 → records).
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const v = sp.get("view");
    if (v === "records" || v === "work") setAttView(v);
    const s = sp.get("section");
    if (s === "summary" || s === "work") setSection(s);
    if (s === "overtime") window.location.replace("/approvals?tab=overtime");   //   예전 연장근무 딥링크 → 결재 허브
    // 휴가(section=leave/focus=pending) 딥링크는 전자결재로 이관 → /leave 리다이렉트가 처리.
  }, []);

  const { data: employees = [] } = useQuery({
    queryKey: ["attendance-employees", companyId, isEmployee ? "emp" : "mgr"],
    queryFn: async () => {
      const data = logRead('attendance/page:data', await (supabase)
        .from("employees")
        .select(isEmployee ? ATT_EMP_COLS : "*")
        .eq("company_id", companyId!)
        .order("created_at", { ascending: false }));
      // 조건부 select 유니언은 PostgREST 타입 파서가 못 읽음 — 런타임은 정상, 캐스트로 정합
      return (data || []) as any[];
    },
    enabled: !!companyId,
  });

  if (!companyId) {
    return <div className="py-16 text-center text-sm text-[var(--text-muted)]">로딩 중...</div>;
  }

  const activeEmp = (employees as any[]).filter((e) => !["invited", "inactive", "resigned"].includes(e.status)).length;

  //   갈래 탭 — 상자 안 맨 위 파란 밑줄 (2026-08-18 조회 표준 Wave 4). 예전 두 줄 seg-bar(근무 현황/연장근무 → 워크보드/기록 상세)를
  //   한 줄 세 갈래로 편다: 워크보드(주간) · 기록 상세 · 월간 요약(2026-08-19, 예전 연장근무).
  type Gal = "work" | "records" | "summary";
  const gal: Gal = section === "summary" ? "summary" : attView === "work" && canBoard ? "work" : "records";
  const goGal = (g: Gal) => {
    if (g === "summary") { setSection("summary"); return; }
    setSection("work"); setAttView(g);
  };
  const tabsEl = (
    <div className="collect-tabs no-print">
      {([["work", "워크보드 (주간)"], ["records", "기록 상세"], ["summary", "근태 현황"]] as const)
        .filter(([k]) => (k === "work" ? canBoard : true))
        .map(([k, l]) => (
          <button key={k} type="button" onClick={() => goGal(k)} className={gal === k ? "collect-tab collect-tab-on" : "collect-tab"}>{l}</button>
        ))}
    </div>
  );
  const headRight = isManager ? <span className="text-xs text-[var(--text-muted)] whitespace-nowrap">재직 {activeEmp.toLocaleString()}명</span> : undefined;

  return (
    <div className="qk-shell attendance-page">
      {gal === "work" ? (
        /* 보드 스타일: 주간 52h 게이지·타임라인 — 상자 전체를 워크보드 부품이 그린다 */
        <FlexWorkBoard companyId={companyId} employees={employees} role={canManage ? "owner" : "employee"} userId={userId} tabs={tabsEl} headRight={headRight} />
      ) : (
        <QueryScreen>
          <QueryHead>{tabsEl}</QueryHead>
          <QueryBody>
            <div className="att-scroll">
              {gal === "records" && (
                <>
                  {/* 관리자 — 직원이 올린 근태 수정 요청 승인 인박스. 대기 0건이면 자체적으로 렌더 안 함.
                      알림 딥링크(?view=records)가 도착하는 화면이라 기록 상세 상단에 배치. */}
                  {isManager && userId && <EditRequestInbox companyId={companyId} reviewerId={userId} />}
                  <AttendanceTab
                    employees={employees}
                    companyId={companyId}
                    userId={userId}
                    userEmail={userEmail}
                    queryClient={queryClient}
                    role={canManage ? "owner" : "employee"}
                  />
                </>
              )}
              {/* 월간 요약 — 부서→직원 표(지각·결근·재택·반차·연차·연장·야간·휴일·총 근무·수당). 예전 연장근무 갈래 자리
                  (2026-08-19 사장님: 연장근무 신청·승인은 결재 허브로, 여기는 인사팀이 보는 월간 지표) */}
              {/* 근태 현황 (2026-08-19 사장님: 월간 요약 → 근태 현황, 조회기간·사람/부서 다중 지정) */}
              {gal === "summary" && <AttendanceStatusTab companyId={companyId} employees={employees} isAdmin={canManage} />}
            </div>
          </QueryBody>
        </QueryScreen>
      )}
    </div>
  );
}
