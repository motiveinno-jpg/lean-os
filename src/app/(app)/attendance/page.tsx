"use client";

import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";
import { SiyanPageHeader, SiyanStatCard } from "@/components/siyan";
import { AttendanceTab, LeaveTab } from "@/app/(app)/employees/page";
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
  // 상위 섹션: 근무현황 / 휴가 / 연장근무 — 휴가·연장 신청/승인을 근태관리로 통합.
  const [section, setSection] = useState<"work" | "leave" | "overtime">("work");
  const [leaveFocusPending, setLeaveFocusPending] = useState(false);
  // ?view=records/work + ?section=leave/overtime + ?focus=pending 딥링크.
  //   근태 수정요청 알림 → records, 미검토 휴가 알림 → leave 섹션(+승인 영역 스크롤).
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const v = sp.get("view");
    if (v === "records" || v === "work") setAttView(v);
    const s = sp.get("section");
    if (s === "leave" || s === "overtime" || s === "work") setSection(s);
    if (sp.get("focus") === "pending") { setLeaveFocusPending(true); setSection((cur) => (sp.get("section") ? cur : "leave")); }
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

  // 오늘 출근/지각/휴가 — AttendanceTab 의 todayStatus 와 동일 소스(attendance_records + leave_requests, KST).
  const kstToday = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const { data: todayStat } = useQuery({
    queryKey: ["attendance-today-stat", companyId, kstToday],
    queryFn: async () => {
      const [attRes, leaveRes] = await Promise.all([
        (supabase as any).from("attendance_records").select("employee_id, status, is_late").eq("company_id", companyId).eq("date", kstToday),
        (supabase as any).from("leave_requests").select("employee_id").eq("company_id", companyId).eq("status", "approved").lte("start_date", kstToday).gte("end_date", kstToday),
      ]);
      const present = new Set<string>();
      const late = new Set<string>();
      for (const r of (attRes.data || []) as any[]) {
        if (r.is_late || r.status === "late") late.add(r.employee_id);
        else present.add(r.employee_id);
      }
      const leaveSet = new Set<string>(((leaveRes.data || []) as any[]).map((r) => r.employee_id));
      for (const id of leaveSet) { present.delete(id); late.delete(id); }
      return { present: present.size, late: late.size, leave: leaveSet.size };
    },
    enabled: !!companyId && isManager,
    staleTime: 60_000,
  });

  // 미검토(승인 대기) 휴가 건수 — 공지 alert 실데이터. RLS 회사 격리. 표시 전용.
  const { data: pendingLeave = 0 } = useQuery<number>({
    queryKey: ["pending-leave-count", companyId],
    queryFn: async () => {
      const { count } = await (supabase as any)
        .from("leave_requests")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .eq("status", "pending");
      return count || 0;
    },
    enabled: !!companyId && isManager,
    staleTime: 60_000,
  });

  if (!companyId) {
    return <div className="p-8 text-center text-sm text-[var(--text-muted)]">로딩 중...</div>;
  }

  // 결석 = 재직 직원 − (출근 + 지각 + 휴가). 음수면 0 클램프 (가짜 아닌 단순 derive).
  const activeEmp = (employees as any[]).filter((e) => !["invited", "inactive", "resigned"].includes(e.status)).length;
  const present = todayStat?.present ?? 0;
  const late = todayStat?.late ?? 0;
  const leave = todayStat?.leave ?? 0;
  const absent = Math.max(0, activeEmp - present - late - leave);

  return (
    <div>
      <SiyanPageHeader
        title="근태 관리"
        subtitle={`출퇴근 기록 · 월별 근무시간 · 휴가 사용 현황${isManager ? ` · 재직 ${activeEmp.toLocaleString()}명` : ""}`}
        gradient="from-blue-600 to-cyan-500"
      />

      {/* 시안 통계 4 (출석/지각/결석/휴가) — 관리자 노출. 실데이터 + derive(결석). */}
      {isManager && section === "work" && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <SiyanStatCard tone="blue" label="출석" value={`${present.toLocaleString()}명`} icon={<span>✓</span>} />
          <SiyanStatCard tone="amber" label="지각" value={`${late.toLocaleString()}명`} icon={<span>⏰</span>} />
          <SiyanStatCard tone="red" label="결석" value={`${absent.toLocaleString()}명`} icon={<span>✕</span>} sub={absent > 0 ? "재직 − 출석 − 지각 − 휴가" : "이상 없음"} />
          <SiyanStatCard tone="green" label="휴가" value={`${leave.toLocaleString()}명`} icon={<span>🏖</span>} />
        </div>
      )}

      {/* 공지 — 미검토 휴가(승인 대기). 클릭 시 휴가 섹션 승인 영역으로 이동. */}
      {isManager && pendingLeave > 0 && (
        <button
          onClick={() => {
            setSection("leave"); setLeaveFocusPending(true);
            setTimeout(() => document.getElementById("leave-approve-section")?.scrollIntoView({ behavior: "smooth", block: "start" }), 400);
          }}
          className="w-full mb-6 flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-left hover:bg-amber-500/15 transition"
        >
          <span className="text-sm font-semibold text-amber-600">⚠️ 미검토 휴가 신청 {pendingLeave}건 — 클릭해서 승인하세요</span>
          <span className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-amber-500 text-white whitespace-nowrap">휴가 승인하기 →</span>
        </button>
      )}

      {/* 상위 섹션 탭 — 근무현황 / 휴가 / 연장근무 (신청·승인 통합) */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        {([["work", "🗓 근무 현황"], ["leave", "🏖 휴가"], ["overtime", "🌙 연장근무"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setSection(k)}
            className={`px-4 py-2 rounded-lg text-xs font-bold border transition ${section === k ? "bg-[var(--primary)] text-white border-[var(--primary)]" : "border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg-surface)]"}`}>
            {l}
          </button>
        ))}
      </div>

      {section === "work" && (
        <>
          {/* 플렉스 스타일: [워크보드] 주간 52h 게이지·타임라인 / [기록 상세] 기존 AttendanceTab(무수정) */}
          <div className="mb-4 inline-flex rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-1 gap-1">
            {([["work", "📊 워크보드 (주간)"], ["records", "📋 기록 상세"]] as const).map(([k, l]) => (
              <button key={k} onClick={() => setAttView(k)}
                className={`px-4 py-2 rounded-lg text-xs font-bold transition ${attView === k ? "text-white shadow-sm" : "text-[var(--text-muted)] hover:text-[var(--text)]"}`}
                style={attView === k ? { background: "#6C5CE7" } : undefined}>
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

      {/* 휴가 — 신청(전원) + 승인(관리자/지정 승인자). LeaveTab 공용 컴포넌트. */}
      {section === "leave" && companyId && (
        <LeaveTab
          employees={employees}
          companyId={companyId}
          userId={userId}
          queryClient={queryClient}
          isEmployee={isEmployee}
          autoNew={false}
          focusPending={leaveFocusPending}
        />
      )}

      {/* 연장근무 — 본인 신청(전원) + 관리자 승인 인박스. */}
      {section === "overtime" && userId && (
        <div className="space-y-4">
          {isManager && companyId && <OvertimeStats companyId={companyId} />}
          {isManager && <OvertimeApprovalInbox companyId={companyId} reviewerId={userId} />}
          <OvertimeRequestCard companyId={companyId} userId={userId} />
        </div>
      )}
    </div>
  );
}
