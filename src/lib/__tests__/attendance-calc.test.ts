// 근태 계산 엔진 — 지각 판정·휴가 반영 회귀 방지 (2026-08-11 인시던트에서 승격).
//   배경: 오전 반차 결재가 승인됐는데 오후 출근이 지각 234분으로 찍혔다(양정훈 8/11).
//   판정 규칙: 종일 휴가 = 지각 없음 / 오전 반차·시간차(시작<13:00) = 휴가 종료시각+유예부터 /
//   오후 반차 = 아침 출근 의무 그대로. attendance-calc 는 순수 함수 — DB 의존 0.
import { describe, it, expect } from "vitest";
import {
  calcLateOnCheckIn,
  calcDailyAttendance,
  classifyLeaveForLate,
  type AttendanceCompanySettings,
} from "../attendance-calc";

const SETTINGS: AttendanceCompanySettings = {
  work_start_time: "09:00",
  work_end_time: "18:00",
  lunch_minutes: 60,
  late_grace_minutes: 5,
  night_start_time: "22:00",
  night_end_time: "06:00",
  weekly_work_hours: 40,
  is_under_5_employees: false,
  is_inclusive_wage: false,
  monthly_standard_hours: 209,
  on_duty_pay_per_shift: 0,
  workdays_mask: 31, // 월~금
};

const DATE = "2026-08-11"; // 화요일 (평일)
// KST h:m 출근시각 → UTC ISO (KST = UTC+9)
const kst = (h: number, m: number) =>
  `2026-08-11T${String(h - 9).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`;

const AM_HALF = classifyLeaveForLate([{ leave_unit: "half_day", start_time: "09:30", end_time: "13:30", days: 0.5 }]);
const PM_HALF = classifyLeaveForLate([{ leave_unit: "half_day", start_time: "13:30", end_time: "18:00", days: 0.5 }]);

describe("classifyLeaveForLate — 승인 휴가 분류", () => {
  it("오전 반차 → 종료시각까지 면제", () => {
    expect(AM_HALF).toEqual({ full: false, exempt_until: "13:30" });
  });
  it("오후 반차 → 면제 없음 (아침 출근 의무 유지)", () => {
    expect(PM_HALF).toEqual({ full: false, exempt_until: null });
  });
  it("종일 연차 → full", () => {
    expect(classifyLeaveForLate([{ leave_unit: "full_day", start_time: null, end_time: null, days: 1 }]).full).toBe(true);
  });
  it("시각 없는 구 데이터 반차 → 판정 불가 시 직원에게 유리하게 full", () => {
    expect(classifyLeaveForLate([{ leave_unit: null, start_time: null, end_time: null, days: 0.5 }]).full).toBe(true);
  });
  it("오전 반차 여러 건이면 가장 늦은 종료시각", () => {
    const r = classifyLeaveForLate([
      { leave_unit: "two_hours", start_time: "09:00", end_time: "11:00", days: 0.25 },
      { leave_unit: "half_day", start_time: "09:30", end_time: "13:30", days: 0.5 },
    ]);
    expect(r.exempt_until).toBe("13:30");
  });
});

describe("calcLateOnCheckIn — 출근 즉시 지각 판정", () => {
  it("휴가 없음 · 09:10 출근(유예 5분 초과) → 지각 10분", () => {
    const r = calcLateOnCheckIn(kst(9, 10), DATE, SETTINGS, undefined, null);
    expect(r).toMatchObject({ is_late: true, late_minutes: 10 });
  });
  it("오전 반차(~13:30) · 13:29 출근 → 정상 (인시던트 케이스)", () => {
    const r = calcLateOnCheckIn(kst(13, 29), DATE, SETTINGS, undefined, AM_HALF);
    expect(r).toMatchObject({ is_late: false, late_minutes: 0 });
  });
  it("오전 반차(~13:30) · 13:40 출근(유예 초과) → 지각 10분 (기준은 휴가 종료시각)", () => {
    const r = calcLateOnCheckIn(kst(13, 40), DATE, SETTINGS, undefined, AM_HALF);
    expect(r).toMatchObject({ is_late: true, late_minutes: 10 });
  });
  it("오후 반차 · 09:10 출근 → 지각 10분 (아침 의무 그대로)", () => {
    const r = calcLateOnCheckIn(kst(9, 10), DATE, SETTINGS, undefined, PM_HALF);
    expect(r).toMatchObject({ is_late: true, late_minutes: 10 });
  });
  it("오후 반차 · 09:03 출근(유예 내) → 정상", () => {
    const r = calcLateOnCheckIn(kst(9, 3), DATE, SETTINGS, undefined, PM_HALF);
    expect(r.is_late).toBe(false);
  });
  it("종일 연차인데 출근을 찍어도 지각 아님", () => {
    const r = calcLateOnCheckIn(kst(14, 0), DATE, SETTINGS, undefined, { full: true, exempt_until: null });
    expect(r.is_late).toBe(false);
  });
  it("오전 시간차(09:00~11:00) · 11:04 출근(유예 내) → 정상", () => {
    const leave = classifyLeaveForLate([{ leave_unit: "two_hours", start_time: "09:00", end_time: "11:00", days: 0.25 }]);
    const r = calcLateOnCheckIn(kst(11, 4), DATE, SETTINGS, undefined, leave);
    expect(r.is_late).toBe(false);
  });
  it("휴일이면 휴가와 무관하게 지각 없음", () => {
    const r = calcLateOnCheckIn(kst(10, 0), DATE, SETTINGS, new Set([DATE]), null);
    expect(r).toMatchObject({ is_late: false, is_holiday: true });
  });
});

describe("calcDailyAttendance — 퇴근 시 재계산", () => {
  it("오전 반차 · 13:29~18:00 → 지각 아님 + 근무분 정상 계산 (work=0 뭉개기 금지)", () => {
    const r = calcDailyAttendance({
      check_in: kst(13, 29), check_out: kst(18, 0), date: DATE, settings: SETTINGS,
      on_leave: false, leave_exempt_until: "13:30",
    });
    expect(r.is_late).toBe(false);
    expect(r.work_minutes).toBeGreaterThan(0);
  });
  it("종일 휴가(on_leave) → 근무 0 · 지각 없음", () => {
    const r = calcDailyAttendance({
      check_in: kst(13, 29), check_out: kst(18, 0), date: DATE, settings: SETTINGS, on_leave: true,
    });
    expect(r).toMatchObject({ is_late: false, work_minutes: 0 });
  });
  it("휴가 없음 · 09:20~18:00 → 지각 20분", () => {
    const r = calcDailyAttendance({
      check_in: kst(9, 20), check_out: kst(18, 0), date: DATE, settings: SETTINGS,
    });
    expect(r).toMatchObject({ is_late: true, late_minutes: 20 });
  });
});
