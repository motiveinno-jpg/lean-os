import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

import { buildLeaveByDate, leaveEntryOf, type LeaveCalRow } from "@/lib/leave-calendar";

const row = (p: Partial<LeaveCalRow>): LeaveCalRow => ({
  employee_name: "서동혁", leave_type: "annual", leave_unit: null, days: 1,
  start_date: "2026-09-01", end_date: null, start_time: null, employee_id: "e1", ...p,
});

describe("leaveEntryOf", () => {
  it("하루짜리는 single, 종료일이 없으면 시작일로 채운다", () => {
    const e = leaveEntryOf(row({}))!;
    expect(e.role).toBe("single");
    expect(e.from).toBe("2026-09-01");
    expect(e.to).toBe("2026-09-01");
    expect(e.days).toBe(1);
  });
  it("시작일이 없으면 null", () => {
    expect(leaveEntryOf(row({ start_date: "" }))).toBeNull();
  });
  it("오전 반차는 단위로 표기", () => {
    expect(leaveEntryOf(row({ leave_unit: "half_day", start_time: "09:00", days: 0.5 }))!.label).toBe("오전 반차");
  });
});

describe("buildLeaveByDate", () => {
  it("여러 날 휴가는 날짜마다 시작·중간·끝으로 펼치고 기간·일수를 싣는다", () => {
    const m = buildLeaveByDate([row({ start_date: "2026-09-30", end_date: "2026-10-02", days: 3 })]);
    expect(Object.keys(m).sort()).toEqual(["2026-09-30", "2026-10-01", "2026-10-02"]);
    expect(m["2026-09-30"][0].role).toBe("start");
    expect(m["2026-10-01"][0].role).toBe("mid");
    expect(m["2026-10-02"][0].role).toBe("end");
    expect(m["2026-10-01"][0]).toMatchObject({ from: "2026-09-30", to: "2026-10-02", days: 3 });
  });
});
