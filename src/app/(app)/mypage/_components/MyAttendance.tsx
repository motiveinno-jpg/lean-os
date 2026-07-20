"use client";
import { logRead } from "@/lib/log-read";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { AttendanceBadges } from "@/components/attendance-badges";

// 내 출퇴근 기록 — 인사관리>근태관리가 "전 직원"이라면 여기는 "나"만.
//   월 단위로 내 attendance_records 를 조회해 요약(근무일·총 근무시간·지각·연장) + 일별 목록을 보여준다.
//   기록 열람 전용 — 출퇴근 찍기는 상단 MyAttendanceCard(오늘 카드) 담당.

// "HH:MM" — check_in/out 은 timestamptz 또는 'HH:MM' 형 모두 방어 (flex-work-board 와 동일 규칙)
function timeOf(v: string | null): string | null {
  if (!v) return null;
  if (/^\d{2}:\d{2}/.test(v)) return v.slice(0, 5);
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  const k = new Date(d.getTime() + 9 * 3600 * 1000);
  return `${String(k.getUTCHours()).padStart(2, "0")}:${String(k.getUTCMinutes()).padStart(2, "0")}`;
}
function fmtHM(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h > 0 && m > 0) return `${h}시간 ${m}분`;
  if (h > 0) return `${h}시간`;
  return `${m}분`;
}
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  present: { label: "출근", color: "text-[var(--success)]" },
  late: { label: "지각", color: "text-[var(--danger)]" },
  absent: { label: "결근", color: "text-[var(--text-muted)]" },
  half_day: { label: "반차", color: "text-[var(--info)]" },
  remote: { label: "재택", color: "text-[var(--info)]" },
};

// KST 기준 'YYYY-MM'
const kstMonth = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date()).slice(0, 7);
const shiftMonth = (ym: string, delta: number) => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

export function MyAttendance({ employeeId }: { employeeId: string | null }) {
  const [month, setMonth] = useState(kstMonth());
  const isCurrentMonth = month === kstMonth();

  const { data: records = [], isLoading } = useQuery({
    queryKey: ["mypage-attendance-records", employeeId, month],
    queryFn: async () => {
      const [y, m] = month.split("-").map(Number);
      const lastDay = new Date(y, m, 0).getDate();
      const data = logRead('_components/MyAttendance:data', await supabase
        .from("attendance_records")
        .select("*")
        .eq("employee_id", employeeId!)
        .gte("date", `${month}-01`)
        .lte("date", `${month}-${String(lastDay).padStart(2, "0")}`)
        .order("date", { ascending: false }));
      return (data || []) as any[];
    },
    enabled: !!employeeId,
  });

  // 요약 — 근태관리(getMonthlyAttendanceSummary)와 동일 규칙: is_late 는 status='present' 여도 지각으로 집계.
  const workDays = records.filter((r) => r.status !== "absent").length;
  const totalMinutes = records.reduce(
    (sum, r) => sum + (Number(r.regular_minutes || 0) + Number(r.overtime_minutes || 0) || Math.round(Number(r.work_hours || 0) * 60)),
    0,
  );
  const lateDays = records.filter((r) => r.is_late || r.status === "late").length;
  const overtimeMinutes = records.reduce((sum, r) => sum + Number(r.overtime_minutes || 0), 0);

  return (
    <div className="mypage-attendance-card glass-card">
      <div className="mypage-attendance-header">
        <h2 className="section-title mb-0">내 출퇴근 기록</h2>
        <div className="mypage-attendance-month-nav">
          <button onClick={() => setMonth(shiftMonth(month, -1))} className="mypage-attendance-month-btn" aria-label="이전 달">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M15 19l-7-7 7-7"/></svg>
          </button>
          <span className="text-xs font-bold mono-number w-[86px] text-center">{month.replace("-", "년 ")}월</span>
          <button
            onClick={() => setMonth(shiftMonth(month, 1))}
            disabled={isCurrentMonth}
            className="mypage-attendance-month-btn disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="다음 달"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5l7 7-7 7"/></svg>
          </button>
        </div>
      </div>

      <div className="mypage-attendance-summary">
        <div className="stat-tile items-center text-center">
          <div className="stat-tile-label">근무일</div>
          <div className="stat-tile-value mono-number text-[var(--primary)]">{workDays}일</div>
        </div>
        <div className="stat-tile items-center text-center">
          <div className="stat-tile-label">총 근무</div>
          <div className="stat-tile-value mono-number">{Math.floor(totalMinutes / 60)}시간</div>
        </div>
        <div className="stat-tile items-center text-center">
          <div className="stat-tile-label">지각</div>
          <div className={`stat-tile-value mono-number ${lateDays > 0 ? "text-[var(--danger)]" : ""}`}>{lateDays}회</div>
        </div>
        <div className="stat-tile items-center text-center">
          <div className="stat-tile-label">연장근무</div>
          <div className={`stat-tile-value mono-number ${overtimeMinutes > 0 ? "text-[var(--warning)]" : ""}`}>{Math.floor(overtimeMinutes / 60)}시간</div>
        </div>
      </div>

      {isLoading ? (
        <div className="mypage-record-loading">불러오는 중...</div>
      ) : records.length === 0 ? (
        <div className="mypage-record-empty">
          <div className="text-3xl mb-2">🕘</div>
          <div className="text-sm font-semibold text-[var(--text-muted)]">이 달의 출퇴근 기록이 없습니다</div>
          <div className="text-xs text-[var(--text-dim)] mt-1">출근을 기록하면 이곳에 일자별로 쌓입니다.</div>
        </div>
      ) : (
        <div className="mypage-attendance-list mypage-record-body">
          {records.map((r) => {
            const st = STATUS_LABEL[r.status as string] || STATUS_LABEL.present;
            const ci = timeOf(r.check_in);
            const co = timeOf(r.check_out);
            const dayMinutes = Number(r.regular_minutes || 0) + Number(r.overtime_minutes || 0) || Math.round(Number(r.work_hours || 0) * 60);
            const d = new Date(`${r.date}T00:00:00`);
            return (
              <div key={r.id} className="mypage-attendance-row">
                <div className="mypage-attendance-date">
                  <span className="text-sm font-bold mono-number">{Number(r.date.slice(5, 7))}/{Number(r.date.slice(8, 10))}</span>
                  <span className="text-[10px] text-[var(--text-dim)]">{WEEKDAYS[d.getDay()]}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[10px] font-bold ${st.color}`}>{st.label}</span>
                    <span className="text-xs mono-number text-[var(--text-muted)]">
                      {ci || "—"} → {co || (ci ? "근무 중" : "—")}
                    </span>
                    {dayMinutes > 0 && <span className="text-xs font-semibold">{fmtHM(dayMinutes)}</span>}
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap mt-1 empty:hidden">
                    <AttendanceBadges record={r} compact />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
