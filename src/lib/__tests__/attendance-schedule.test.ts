// 근무 규칙(화면용) — DB 판정 attendance_judge() 와 같은 기본값·요일·개인 시각 규칙을 지키는지 (2026-09-07).
//   배경: 워크보드는 유예 0, 엣지는 30, 요일은 토·일 고정 — 파일마다 달라 화면끼리 어긋났다.
import { describe, it, expect } from "vitest";
import {
  ATT_DEFAULTS, hhmmToMin, companyWorkCfgFromRow, employeeStartMin, employeeEndMin,
  isWorkdayMonIdx, isWorkdayDow, isWorkdayDate, judgeMissingToday, minToHhmm,
} from "../attendance-schedule";

describe("companyWorkCfgFromRow — 기본값은 엣지·DB 판정과 같다", () => {
  it("설정이 없으면 09:00~18:00, 점심 60, 유예 30, 월~금", () => {
    expect(companyWorkCfgFromRow(null)).toEqual({ start: 540, end: 1080, lunch: 60, grace: 30, mask: 31 });
    expect(ATT_DEFAULTS.grace).toBe(30);
  });
  it("time 형('09:30:00')과 'HH:MM' 둘 다 읽고, 유예는 0~240 으로 자른다", () => {
    const c = companyWorkCfgFromRow({ work_start_time: "09:30:00", work_end_time: "18:30", late_grace_minutes: 999, workdays_mask: 63 });
    expect(c.start).toBe(570); expect(c.end).toBe(1110); expect(c.grace).toBe(240); expect(c.mask).toBe(63);
  });
  it("유예 0 은 0 으로 남는다(미설정과 구분)", () => {
    expect(companyWorkCfgFromRow({ late_grace_minutes: 0 }).grace).toBe(0);
    expect(companyWorkCfgFromRow({ workdays_mask: 0 }).mask).toBe(31);
  });
  it("hhmmToMin 은 잘못된 값이면 기본값", () => {
    expect(hhmmToMin("25:00", 1)).toBe(1); expect(hhmmToMin(null, 2)).toBe(2); expect(hhmmToMin("9:05", 0)).toBe(545);
  });
});

describe("직원 개인 시각", () => {
  const cfg = companyWorkCfgFromRow({ work_start_time: "09:30", work_end_time: "18:30" });
  it("있으면 개인 시각, 없으면 회사", () => {
    expect(employeeStartMin(cfg, { work_start_time: "10:00" })).toBe(600);
    expect(employeeStartMin(cfg, { work_start_time: null })).toBe(570);
    expect(employeeEndMin(cfg, { work_end_time: "15:00" })).toBe(900);
    expect(employeeEndMin(cfg, null)).toBe(1110);
  });
});

describe("근무 요일", () => {
  it("월=1 … 일=64 비트", () => {
    expect(isWorkdayMonIdx(31, 0)).toBe(true); expect(isWorkdayMonIdx(31, 5)).toBe(false);
    expect(isWorkdayMonIdx(63, 5)).toBe(true); expect(isWorkdayMonIdx(31, 7)).toBe(false);
    expect(isWorkdayDow(31, 0)).toBe(false); expect(isWorkdayDow(95, 0)).toBe(true); // 95 = 월~금 + 일
  });
  it("날짜 문자열 + 공휴일", () => {
    expect(isWorkdayDate(31, "2026-09-07")).toBe(true);   // 월
    expect(isWorkdayDate(31, "2026-09-12")).toBe(false);  // 토
    expect(isWorkdayDate(31, "2026-09-07", new Set(["2026-09-07"]))).toBe(false);
  });
});

describe("judgeMissingToday — 오늘 미출근", () => {
  const cfg = companyWorkCfgFromRow({ work_start_time: "09:30", work_end_time: "18:30", late_grace_minutes: 5 });
  const base = { cfg, emp: {}, todayStr: "2026-09-07", hasRecord: false } as const;
  it("근무 시작+유예 전에는 아니다, 지나면 n분 지각 중", () => {
    expect(judgeMissingToday({ ...base, nowMin: 9 * 60 + 34 })).toEqual({ missing: false });
    expect(judgeMissingToday({ ...base, nowMin: 9 * 60 + 49 })).toEqual({ missing: true, lateMin: 19, afterEnd: false });
  });
  it("퇴근 시각이 지나면 결근으로 그린다", () => {
    expect(judgeMissingToday({ ...base, nowMin: 18 * 60 + 31 })).toMatchObject({ missing: true, afterEnd: true });
  });
  it("기록이 있거나 휴일·주말·입사 전·종일/오전반차면 아니다. 오후반차는 아침 의무가 있다", () => {
    expect(judgeMissingToday({ ...base, nowMin: 700, hasRecord: true })).toEqual({ missing: false });
    expect(judgeMissingToday({ ...base, nowMin: 700, todayStr: "2026-09-12" })).toEqual({ missing: false });
    expect(judgeMissingToday({ ...base, nowMin: 700, holidays: new Set(["2026-09-07"]) })).toEqual({ missing: false });
    expect(judgeMissingToday({ ...base, nowMin: 700, emp: { hire_date: "2026-09-08" } })).toEqual({ missing: false });
    expect(judgeMissingToday({ ...base, nowMin: 700, leaveKind: "full" })).toEqual({ missing: false });
    expect(judgeMissingToday({ ...base, nowMin: 700, leaveKind: "am" })).toEqual({ missing: false });
    expect(judgeMissingToday({ ...base, nowMin: 700, leaveKind: "pm" })).toMatchObject({ missing: true });
  });
  it("개인 시각이 있으면 그 사람 기준", () => {
    expect(judgeMissingToday({ ...base, nowMin: 9 * 60 + 49, emp: { work_start_time: "10:00" } })).toEqual({ missing: false });
  });
  it("minToHhmm", () => { expect(minToHhmm(570)).toBe("09:30"); });
});
