// 구성원 디렉토리 근무 상태 — 스스로 고른 상태가 먼저, 없으면 오늘 근태로 정한다.
import { describe, it, expect } from "vitest";
import { deriveWorkStatus, leaveKindOf } from "../work-status";
import { companyWorkCfgFromRow } from "../attendance-schedule";

const cfg = companyWorkCfgFromRow(null); // 09:00~18:00, 유예 30, 월~금
const MON = "2026-09-07";
const base = { employee_id: "e1", work_start_time: null, work_end_time: null, hire_date: "2025-01-01" };
const acct = { presence_status: "available", presence_note: null, presence_until: null };

describe("deriveWorkStatus", () => {
  it("계정이 있고 기록이 없으면 유예가 지난 뒤 미출근, 퇴근 시각 뒤엔 결근", () => {
    expect(deriveWorkStatus({ presence: acct, today: base, cfg, todayStr: MON, nowMin: 9 * 60 + 10 })?.label).toBe("출근 전");
    expect(deriveWorkStatus({ presence: acct, today: base, cfg, todayStr: MON, nowMin: 10 * 60 })).toMatchObject({ label: "미출근", tone: "orange", detail: "60분 지각 중" });
    expect(deriveWorkStatus({ presence: acct, today: base, cfg, todayStr: MON, nowMin: 18 * 60 + 1 })).toMatchObject({ label: "결근", tone: "red" });
  });
  it("계정이 없어도 근태 기록만으로 상태를 만든다", () => {
    expect(deriveWorkStatus({ presence: null, today: base, cfg, todayStr: MON, nowMin: 10 * 60 })?.label).toBe("미출근");
    expect(deriveWorkStatus({ presence: null, today: null, cfg, todayStr: MON, nowMin: 10 * 60 })).toBeNull();
  });
  it("출근 기록이 있으면 근무중, 퇴근 찍으면 퇴근", () => {
    const t = { ...base, check_in: "2026-09-07T00:26:00Z", att_status: "present" };
    expect(deriveWorkStatus({ presence: acct, today: t, cfg, todayStr: MON, nowMin: 10 * 60 })).toMatchObject({ label: "근무중", tone: "green" });
    expect(deriveWorkStatus({ presence: acct, today: { ...t, check_out: "2026-09-07T09:00:00Z" }, cfg, todayStr: MON, nowMin: 19 * 60 })).toMatchObject({ label: "퇴근", tone: "grey" });
    expect(deriveWorkStatus({ presence: acct, today: { ...t, attendance_type: "remote" }, cfg, todayStr: MON, nowMin: 10 * 60 })?.label).toBe("원격 근무");
  });
  it("스스로 고른 상태가 근태보다 먼저다", () => {
    const out = { presence_status: "out", presence_note: "15시 복귀", presence_until: "2099-01-01T00:00:00Z" };
    expect(deriveWorkStatus({ presence: out, today: base, cfg, todayStr: MON, nowMin: 10 * 60 })).toMatchObject({ label: "외근", tone: "blue" });
    const expired = { ...out, presence_until: "2000-01-01T00:00:00Z" };
    expect(deriveWorkStatus({ presence: expired, today: base, cfg, todayStr: MON, nowMin: 10 * 60 })?.label).toBe("미출근");
  });
  it("휴가·반차·휴무·입사 예정", () => {
    expect(deriveWorkStatus({ presence: acct, today: { ...base, leave_unit: "full_day", leave_days: 1 }, cfg, todayStr: MON, nowMin: 10 * 60 })?.label).toBe("휴가");
    expect(deriveWorkStatus({ presence: acct, today: { ...base, leave_unit: "half_day", leave_start_time: "09:00", leave_days: 0.5 }, cfg, todayStr: MON, nowMin: 10 * 60 })?.label).toBe("오전 반차");
    expect(deriveWorkStatus({ presence: acct, today: { ...base, leave_unit: "half_day", leave_start_time: "14:00", leave_days: 0.5 }, cfg, todayStr: MON, nowMin: 10 * 60 })?.label).toBe("미출근");
    expect(deriveWorkStatus({ presence: acct, today: base, cfg, todayStr: "2026-09-06", nowMin: 10 * 60 })?.label).toBe("휴무");
    expect(deriveWorkStatus({ presence: acct, today: base, cfg, todayStr: MON, nowMin: 10 * 60, holidays: new Set([MON]) })?.label).toBe("휴무");
    expect(deriveWorkStatus({ presence: acct, today: { ...base, hire_date: "2026-10-01" }, cfg, todayStr: MON, nowMin: 10 * 60 })?.label).toBe("입사 예정");
  });
  it("leaveKindOf", () => {
    expect(leaveKindOf({ leave_unit: null, leave_days: null })).toBeNull();
    expect(leaveKindOf({ leave_unit: "two_hours", leave_start_time: "16:00", leave_days: 0.25 })).toBe("pm");
  });
});
