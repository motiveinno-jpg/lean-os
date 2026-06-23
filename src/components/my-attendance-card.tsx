"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { checkIn as hrCheckIn, checkOut as hrCheckOut, cancelCheckOut as hrCancelCheckOut } from "@/lib/hr";
import { useToast } from "@/components/toast";
import { AttendanceBadges } from "@/components/attendance-badges";

const db = supabase as any;

function fmtTime(ts?: string | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
}
function elapsedSince(ts?: string | null): string {
  if (!ts) return "";
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 0) return "";
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  return `${h}시간 ${m}분 근무 중`;
}

// 본인 출퇴근 카드 — 직원/관리자/대표 누구나 사용 (employees.user_id 연결 필요)
export function MyAttendanceCard({ companyId, userId }: { companyId: string; userId: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  // QA 2026-06-12: UTC 날짜였음 → KST 00:00~08:59 에 "어제"로 기록되던 버그. KST 보정.
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const [attendanceStatus, setAttendanceStatus] = useState("present");
  const [busy, setBusy] = useState(false);

  // 본인 employees 레코드
  const { data: emp, isLoading: empLoading } = useQuery({
    queryKey: ["my-att-emp", companyId, userId],
    queryFn: async () => {
      const { data } = await db
        .from("employees")
        .select("id, name")
        .eq("company_id", companyId)
        .eq("user_id", userId)
        .maybeSingle();
      return data;
    },
    enabled: !!companyId && !!userId,
  });
  const employeeId = emp?.id ?? null;

  const { data: todayAtt } = useQuery({
    queryKey: ["my-att-today", employeeId, today],
    queryFn: async () => {
      const { data } = await db
        .from("attendance_records")
        .select("*")
        .eq("employee_id", employeeId!)
        .eq("date", today)
        .maybeSingle();
      return data;
    },
    enabled: !!employeeId,
    refetchInterval: 30_000,
  });

  const isCheckedIn = !!todayAtt?.check_in;
  const isCheckedOut = !!todayAtt?.check_out;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["my-att-today"] });
  };

  const doCheckIn = async () => {
    if (!employeeId) return;
    setBusy(true);
    try {
      await hrCheckIn(companyId, employeeId, attendanceStatus === "present" ? "auto" : attendanceStatus);
      toast("출근 처리 완료", "success");
      refresh();
    } catch (e: any) {
      toast(`출근 처리 실패: ${e.message || ""}`, "error");
    }
    setBusy(false);
  };
  const doCheckOut = async () => {
    if (!employeeId) return;
    setBusy(true);
    try {
      await hrCheckOut(employeeId, companyId, today);
      toast("퇴근 처리 완료", "success");
      refresh();
    } catch (e: any) {
      toast(`퇴근 처리 실패: ${e.message || ""}`, "error");
    }
    setBusy(false);
  };
  const doCancelCheckOut = async () => {
    if (!employeeId || !confirm("퇴근 기록을 취소하시겠습니까?")) return;
    setBusy(true);
    try {
      await hrCancelCheckOut(employeeId, companyId, today);
      toast("퇴근 취소 — 다시 근무 중", "success");
      refresh();
    } catch (e: any) {
      toast(`퇴근 취소 실패: ${e.message || ""}`, "error");
    }
    setBusy(false);
  };

  if (empLoading) {
    return (
      <div className="glass-card p-5 text-sm text-[var(--text-muted)]">
        출퇴근 정보 불러오는 중...
      </div>
    );
  }
  if (!employeeId) {
    return (
      <div className="glass-card p-5">
        <div className="text-sm font-bold text-[var(--text)] mb-1">내 출퇴근</div>
        <div className="text-xs text-[var(--text-muted)]">
          내 계정이 구성원(직원) 레코드와 연결돼 있지 않아 출퇴근을 기록할 수 없습니다.
          <br />구성원 관리에서 본인 계정을 직원으로 등록·연결해주세요.
        </div>
      </div>
    );
  }

  return (
    <div className="glass-card p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={`w-2.5 h-2.5 rounded-full ${isCheckedIn && !isCheckedOut ? "bg-green-500 animate-pulse" : isCheckedOut ? "bg-gray-400" : "bg-yellow-400"}`} />
          <span className="text-sm font-bold text-[var(--text)]">
            내 출퇴근 · {!isCheckedIn ? "미출근" : isCheckedOut ? "퇴근 완료" : "근무 중"}
          </span>
        </div>
        {isCheckedIn && !isCheckedOut && (
          <span className="text-xs text-[var(--text-muted)] font-mono">{elapsedSince(todayAtt?.check_in)}</span>
        )}
      </div>

      <div className="flex items-center gap-6 mb-4">
        <div>
          <div className="caption mb-0.5">출근</div>
          <div className="text-lg font-black font-mono">{fmtTime(todayAtt?.check_in)}</div>
        </div>
        <div className="text-[var(--text-dim)]">→</div>
        <div>
          <div className="caption mb-0.5">퇴근</div>
          <div className="text-lg font-black font-mono">{fmtTime(todayAtt?.check_out)}</div>
        </div>
        {todayAtt?.work_hours > 0 && (
          <>
            <div className="text-[var(--border)]">|</div>
            <div>
              <div className="caption mb-0.5">근무시간</div>
              <div className="text-lg font-black">{todayAtt.work_hours}h</div>
            </div>
          </>
        )}
      </div>

      {/* 갭①-B: 오늘 배지 (지각/연장/야간/휴일/외근·당직). 갭④: 출근 직후
          checkIn 함수가 is_late·late_minutes 즉시 채움 → 퇴근 전에도 표시. */}
      {todayAtt && (
        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          <AttendanceBadges record={todayAtt} compact />
          {isCheckedIn && !isCheckedOut && Number(todayAtt.overtime_minutes || 0) === 0 && (
            <span className="text-[10px] text-[var(--text-dim)] italic">연장은 퇴근 시 산정</span>
          )}
        </div>
      )}

      {!isCheckedIn && (
        <div className="flex gap-2 mb-3 flex-wrap">
          {[
            { value: "present", label: "출근" },
            { value: "remote", label: "재택" },
            { value: "half_day", label: "반차" },
            { value: "absent", label: "결근" },
          ].map(({ value, label }) => (
            <button key={value} type="button" onClick={() => setAttendanceStatus(value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition border ${
                attendanceStatus === value
                  ? "bg-[var(--primary)]/15 text-[var(--primary)] border-[var(--primary)]/40"
                  : "bg-[var(--bg-surface)] text-[var(--text-muted)] border-[var(--border)]"
              }`}>
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-3">
        {!isCheckedIn ? (
          <button onClick={doCheckIn} disabled={busy}
            className="flex-1 py-3 rounded-xl bg-green-600 hover:bg-green-500 text-white text-sm font-bold transition active:scale-[0.98] disabled:opacity-50">
            {busy ? "처리 중..." : "출근하기"}
          </button>
        ) : !isCheckedOut ? (
          <button onClick={doCheckOut} disabled={busy}
            className="flex-1 py-3 rounded-xl bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white text-sm font-bold transition active:scale-[0.98] disabled:opacity-50">
            {busy ? "처리 중..." : "퇴근하기"}
          </button>
        ) : (
          <button onClick={doCancelCheckOut} disabled={busy}
            className="flex-1 py-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] text-sm font-semibold transition disabled:opacity-50">
            {busy ? "처리 중..." : "퇴근 취소"}
          </button>
        )}
      </div>
    </div>
  );
}
