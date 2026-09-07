// 구성원 디렉토리 이름 옆 근무 상태 — 스스로 고른 상태(회의중·외근 등)와 오늘 근태 기록을 합쳐 한 마디로 만든다.
//   스스로 고른 상태가 있으면 그것이 먼저다. 없으면 오늘 근태로 정한다: 휴가 → 퇴근 → 결근 → 근무중 → 미출근 → 출근 전.
//   근무일·유예·개인 시각 규칙은 attendance-schedule.ts 를 그대로 쓴다. 판정을 여기서 새로 만들지 않는다.

import { effectivePresence, presenceText, PRESENCE_LABEL, type PresenceRow, type PresenceStatus } from "@/lib/presence";
import { judgeMissingToday, employeeStartMin, type CompanyWorkCfg, type EmpWorkTime } from "@/lib/attendance-schedule";

export type WorkTone = "green" | "orange" | "red" | "blue" | "purple" | "grey";
export type WorkStatus = { id: string; label: string; tone: WorkTone; detail: string };

export type WorkTodayRow = {
  employee_id: string;
  work_start_time?: string | null;
  work_end_time?: string | null;
  hire_date?: string | null;
  check_in?: string | null;
  check_out?: string | null;
  att_status?: string | null;
  attendance_type?: string | null;
  leave_unit?: string | null;
  leave_start_time?: string | null;
  leave_days?: number | string | null;
};

const PRESENCE_TONE: Record<PresenceStatus, WorkTone> = {
  available: "green", meeting: "orange", away: "grey", out: "blue", focus: "purple", off: "grey",
};

/** 승인 휴가 → 종일·오전·오후·방향 미상 반차. 워크보드와 같은 규칙. */
export function leaveKindOf(row: Pick<WorkTodayRow, "leave_unit" | "leave_start_time" | "leave_days">): "full" | "am" | "pm" | "half" | null {
  if (!row.leave_unit && row.leave_days == null) return null;
  const unit = String(row.leave_unit || "");
  const partial = unit === "half_day" || unit === "two_hours" || Number(row.leave_days) === 0.5;
  if (!partial) return "full";
  const st = String(row.leave_start_time || "").slice(0, 5);
  return st ? (Number(st.slice(0, 2)) < 12 ? "am" : "pm") : "half";
}

function hm(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function deriveWorkStatus(args: {
  presence: PresenceRow | null | undefined;
  today: WorkTodayRow | null | undefined;
  cfg: CompanyWorkCfg;
  todayStr: string;
  nowMin: number;
  holidays?: Set<string> | null;
  now?: number;
}): WorkStatus | null {
  const { presence, today, cfg, todayStr, nowMin } = args;
  const p = effectivePresence(presence, args.now);
  if (p.status !== "available") return { id: `presence:${p.status}`, label: PRESENCE_LABEL[p.status], tone: PRESENCE_TONE[p.status], detail: presenceText(p) };
  if (!today) return presence ? { id: "working", label: "근무중", tone: "green", detail: "" } : null;

  const emp: EmpWorkTime & { hire_date?: string | null } = { work_start_time: today.work_start_time, work_end_time: today.work_end_time, hire_date: today.hire_date };
  if (today.hire_date && todayStr < today.hire_date) return { id: "before_hire", label: "입사 예정", tone: "grey", detail: `${today.hire_date} 입사` };

  const leave = leaveKindOf(today);
  if (leave === "full") return { id: "leave", label: "휴가", tone: "grey", detail: "오늘 휴가" };

  if (today.check_in || today.att_status) {
    if (today.check_out) return { id: "checked_out", label: "퇴근", tone: "grey", detail: `${hm(today.check_out)} 퇴근` };
    if (today.att_status === "absent") return { id: "absent", label: "결근", tone: "red", detail: "" };
    const remote = today.attendance_type === "remote" || today.att_status === "remote";
    const half = today.att_status === "half_day" || leave === "am" || leave === "pm" || leave === "half";
    const parts = [today.check_in ? `${hm(today.check_in)} 출근` : "", half ? "반차" : "", today.att_status === "late" ? "지각" : ""].filter(Boolean);
    return { id: remote ? "remote" : "working", label: remote ? "원격 근무" : "근무중", tone: "green", detail: parts.join(" · ") };
  }

  if (leave === "am" || leave === "half") return { id: "leave_half", label: leave === "am" ? "오전 반차" : "반차", tone: "grey", detail: "" };

  const j = judgeMissingToday({ cfg, emp, todayStr, nowMin, holidays: args.holidays, leaveKind: leave === "pm" ? "pm" : null, hasRecord: false });
  if (j.missing) {
    if (j.afterEnd) return { id: "absent", label: "결근", tone: "red", detail: "오늘 출근 기록 없음" };
    return { id: "missing", label: "미출근", tone: "orange", detail: `${j.lateMin}분 지각 중` };
  }
  if (leave === "pm") return { id: "leave_half", label: "오후 반차", tone: "grey", detail: "" };
  const start = employeeStartMin(cfg, emp);
  if (nowMin < start + cfg.grace) return { id: "before_start", label: "출근 전", tone: "grey", detail: "" };
  return { id: "dayoff", label: "휴무", tone: "grey", detail: "" };
}
