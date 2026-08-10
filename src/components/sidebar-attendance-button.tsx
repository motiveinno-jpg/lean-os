"use client";
import { appConfirm } from "@/components/global-confirm";
import { logRead } from "@/lib/log-read";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { checkIn as hrCheckIn, checkOut as hrCheckOut, cancelCheckOut as hrCancelCheckOut } from "@/lib/hr";
import { useToast } from "@/components/toast";
import { useUser } from "@/components/user-context";

// 사이드바 로고 옆 원클릭 출퇴근 버튼 (2026-08-10 사장님 요청)
//   - 미출근 → "출근" / 근무 중 → "퇴근" / 퇴근 완료 → "퇴근취소" / 직원 미연결 → 미표시
//   - 출퇴근 로직·쿼리 키는 MyAttendanceCard(위젯)와 동일 소스 공유 → 어느 쪽에서 찍어도 즉시 동기화
export function SidebarAttendanceButton() {
  const { user } = useUser();
  const { toast } = useToast();
  const qc = useQueryClient();
  const companyId = user?.company_id ?? null;
  const userId = user?.id ?? null;
  // KST 보정 날짜 (MyAttendanceCard 와 동일)
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const [busy, setBusy] = useState(false);

  const { data: emp } = useQuery({
    queryKey: ["my-att-emp", companyId, userId],
    queryFn: async () => {
      const data = logRead('components/sidebar-attendance-button:data', await supabase
        .from("employees")
        .select("id, name")
        .eq("company_id", companyId!)
        .eq("user_id", userId!)
        .maybeSingle());
      return data;
    },
    enabled: !!companyId && !!userId,
  });
  const employeeId = emp?.id ?? null;

  const { data: todayAtt } = useQuery({
    queryKey: ["my-att-today", employeeId, today],
    queryFn: async () => {
      const data = logRead('components/sidebar-attendance-button:data', await supabase
        .from("attendance_records")
        .select("*")
        .eq("employee_id", employeeId!)
        .eq("date", today)
        .maybeSingle());
      return data;
    },
    enabled: !!employeeId,
    refetchInterval: 30_000,
  });

  const isCheckedIn = !!todayAtt?.check_in;
  const isCheckedOut = !!todayAtt?.check_out;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["my-att-today"] });
    qc.invalidateQueries({ queryKey: ["emp-attendance-today"] });
    qc.invalidateQueries({ queryKey: ["emp-month-summary"] });
    qc.invalidateQueries({ queryKey: ["attendance-employees"] });
  };

  const handleClick = async () => {
    if (!companyId || !employeeId || busy) return;
    // 퇴근취소만 되돌리기 확인 — 위젯(MyAttendanceCard)과 동일 (2026-08-10 사장님:
    //   "퇴근하면 퇴근취소 버튼이 다시 안 생겨" → 퇴근 완료 후에도 버튼 유지)
    if (isCheckedOut && !(await appConfirm("퇴근 기록을 취소하시겠습니까?"))) return;
    setBusy(true);
    try {
      if (!isCheckedIn) {
        await hrCheckIn(companyId, employeeId, "auto");
        toast("출근 처리 완료", "success");
      } else if (!isCheckedOut) {
        await hrCheckOut(employeeId, companyId, today);
        toast("퇴근 처리 완료", "success");
      } else {
        await hrCancelCheckOut(employeeId, companyId, today);
        toast("퇴근 취소 — 다시 근무 중", "success");
      }
      refresh();
    } catch (e: any) {
      toast(`${!isCheckedIn ? "출근" : !isCheckedOut ? "퇴근" : "퇴근 취소"} 처리 실패: ${e.message || ""}`, "error");
    }
    setBusy(false);
  };

  // 직원 미연결 계정은 표시하지 않음 (로고 영역 노이즈 방지)
  if (!employeeId) return null;

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      title={!isCheckedIn ? "출근 기록하기" : !isCheckedOut ? "퇴근 기록하기" : "퇴근 기록 취소 — 다시 근무 중으로"}
      className={`sidebar-attendance-btn ${
        !isCheckedIn
          ? "bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white"
          : "bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]"
      }`}
    >
      {busy ? "..." : !isCheckedIn ? "출근" : !isCheckedOut ? "퇴근" : "퇴근취소"}
    </button>
  );
}
