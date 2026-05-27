"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";
import { IconTile, TileIcon } from "@/components/ui/icon-tile";
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

  // 시안 통계 — 오늘 출근/지각/휴가 (관리자 노출). AttendanceTab 의 todayStatus 와 동일 소스·로직.
  const kstToday = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const isManager = role !== "employee";
  const { data: todayStat } = useQuery({
    queryKey: ["attendance-today-stat", companyId, kstToday],
    queryFn: async () => {
      const [attRes, leaveRes] = await Promise.all([
        (supabase as any).from("attendance_records").select("employee_id, status, is_late").eq("company_id", companyId).eq("date", kstToday),
        (supabase as any).from("leave_requests").select("employee_id").eq("company_id", companyId).eq("status", "approved").lte("start_date", kstToday).gte("end_date", kstToday),
      ]);
      const present = new Set<string>(); const late = new Set<string>();
      for (const r of (attRes.data || []) as any[]) { if (r.is_late || r.status === "late") late.add(r.employee_id); else present.add(r.employee_id); }
      const leaveSet = new Set<string>(((leaveRes.data || []) as any[]).map((r) => r.employee_id));
      for (const id of leaveSet) { present.delete(id); late.delete(id); }
      return { present: present.size, late: late.size, leave: leaveSet.size };
    },
    enabled: !!companyId && isManager,
    staleTime: 60_000,
  });

  if (!companyId) {
    return <div className="p-8 text-center text-sm text-[var(--text-muted)]">로딩 중...</div>;
  }

  const activeEmp = (employees as any[]).filter((e) => !["invited", "inactive", "resigned"].includes(e.status)).length;
  const attStats: { tone: "brand" | "success" | "warning" | "info"; icon: string; label: string; value: string }[] = [
    { tone: "brand", icon: "users", label: "재직 직원", value: `${activeEmp.toLocaleString()}명` },
    { tone: "success", icon: "check", label: "오늘 출근", value: `${(todayStat?.present ?? 0).toLocaleString()}명` },
    { tone: "warning", icon: "clock", label: "지각", value: `${(todayStat?.late ?? 0).toLocaleString()}명` },
    { tone: "info", icon: "card", label: "휴가", value: `${(todayStat?.leave ?? 0).toLocaleString()}명` },
  ];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold">근태 관리</h1>
        <p className="text-sm text-[var(--text-muted)] mt-1">출퇴근 기록 · 월별 근무시간 · 휴가 사용 현황</p>
      </div>
      {/* 시안 통계 4 (오늘 현황 — 관리자) */}
      {isManager && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {attStats.map((s) => (
            <div key={s.label} className="glass-card p-5">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wide">{s.label}</p>
                <IconTile tone={s.tone} size={34}><TileIcon name={s.icon} className="w-4 h-4 text-white" /></IconTile>
              </div>
              <p className="text-2xl font-bold text-[var(--text)] mono-number">{s.value}</p>
            </div>
          ))}
        </div>
      )}
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
