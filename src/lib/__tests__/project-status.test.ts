import { describe, it, expect } from "vitest";
import { getProjectStatus, STATUS_RANK, daysToEnd } from "@/lib/project-status";

const TODAY = "2026-08-03";
const base = { today: TODAY };

describe("getProjectStatus — 상태는 정상·주의·지연 셋뿐", () => {
  it("마감일이 지나면 지연", () => {
    const s = getProjectStatus({ ...base, endDate: "2026-07-31" });
    expect(s.key).toBe("late");
    expect(s.why).toBe("마감일이 3일 지났어요");
  });

  it("지연된 할 일이 있으면 마감이 남았어도 지연", () => {
    expect(getProjectStatus({ ...base, endDate: "2026-12-31", overdueTasks: true }).key).toBe("late");
  });

  it("60일 넘게 못 받은 돈은 지연 — 미수가 남아 있을 때만", () => {
    expect(getProjectStatus({ ...base, outstanding: 1_000_000, oldestUnpaidDays: 90 }).key).toBe("late");
    expect(getProjectStatus({ ...base, outstanding: 0, oldestUnpaidDays: 90 }).key).toBe("normal");
  });

  it("마진 적자는 지연", () => {
    expect(getProjectStatus({ ...base, metricRisk: true }).key).toBe("late");
  });

  it("마감 7일 이내는 주의", () => {
    const s = getProjectStatus({ ...base, endDate: "2026-08-08" });
    expect(s.key).toBe("warn");
    expect(s.why).toBe("마감이 5일 남았어요");
  });

  it("오늘 마감도 주의(아직 지나지 않았다)", () => {
    const s = getProjectStatus({ ...base, endDate: TODAY });
    expect(s.key).toBe("warn");
    expect(s.why).toBe("오늘 마감이에요");
  });

  it("미수가 있으면 주의", () => {
    expect(getProjectStatus({ ...base, outstanding: 500_000 }).key).toBe("warn");
  });

  it("1원 이하 잔돈은 미수로 보지 않는다", () => {
    expect(getProjectStatus({ ...base, outstanding: 1 }).key).toBe("normal");
  });

  it("2주 넘게 조용하면 주의", () => {
    expect(getProjectStatus({ ...base, quietDays: 14 }).key).toBe("warn");
    expect(getProjectStatus({ ...base, quietDays: 13 }).key).toBe("normal");
  });

  it("아무 문제 없으면 정상", () => {
    expect(getProjectStatus({ ...base, endDate: "2026-12-31", quietDays: 2 }).key).toBe("normal");
  });

  it("끝났고 받을 돈도 없으면 완료", () => {
    expect(getProjectStatus({ ...base, stage: "completed" }).key).toBe("done");
    expect(getProjectStatus({ ...base, stage: "settlement" }).key).toBe("done");
  });

  it("끝났어도 미수가 남았으면 완료가 아니다 — 받을 게 남았으면 챙겨야 한다", () => {
    expect(getProjectStatus({ ...base, stage: "completed", outstanding: 2_000_000 }).key).toBe("warn");
    expect(getProjectStatus({ ...base, stage: "completed", outstanding: 2_000_000, oldestUnpaidDays: 120 }).key).toBe("late");
  });

  it("완료된 프로젝트는 지난 마감일로 지연 처리하지 않는다", () => {
    expect(getProjectStatus({ ...base, stage: "completed", endDate: "2026-01-01" }).key).toBe("done");
  });

  it("급한 순 정렬 — 지연 → 주의 → 정상 → 완료", () => {
    expect(STATUS_RANK.late).toBeLessThan(STATUS_RANK.warn);
    expect(STATUS_RANK.warn).toBeLessThan(STATUS_RANK.normal);
    expect(STATUS_RANK.normal).toBeLessThan(STATUS_RANK.done);
  });
});

describe("daysToEnd", () => {
  it("마감일이 없으면 null", () => {
    expect(daysToEnd(null, TODAY)).toBeNull();
  });
  it("지난 날짜는 음수", () => {
    expect(daysToEnd("2026-08-01", TODAY)).toBe(-2);
  });
  it("오늘은 0", () => {
    expect(daysToEnd(TODAY, TODAY)).toBe(0);
  });
});
