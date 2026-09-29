import { describe, it, expect } from "vitest";
import { promotionSchedule, promotionPhase, promotionNoticeDeadline } from "@/lib/leave-promotion-schedule";

describe("연차 촉진 일정 — 근로기준법 §61", () => {
  it("회계연도 기준 1년 이상: 1차 7/1~7/10, 2차 10/31까지", () => {
    const s = promotionSchedule("2023-01-02", "fiscal", "2026-09-29")!;
    expect(s).toMatchObject({ kind: "annual", periodStart: "2026-01-01", periodEnd: "2026-12-31", firstFrom: "2026-07-01", firstTo: "2026-07-10", secondBy: "2026-10-31" });
    expect(promotionPhase(s, "2026-09-29").code).toBe("between");
  });
  it("입사일 기준 1년 이상: 사용기간 = 최근 응당일 ~ 다음 응당일 전날, 만료 6개월·2개월 전", () => {
    const s = promotionSchedule("2024-03-04", "hire", "2026-09-29")!;
    expect(s).toMatchObject({ kind: "annual", periodStart: "2026-03-04", periodEnd: "2027-03-03", firstFrom: "2026-09-04", firstTo: "2026-09-13", secondBy: "2027-01-03" });
    expect(promotionPhase(s, "2026-09-29").code).toBe("between");
    // 응당일 전날 → 아직 지난 기간
    expect(promotionSchedule("2024-03-04", "hire", "2026-03-03")!.periodEnd).toBe("2026-03-03");
  });
  it("1년 미만(월 연차 §61②): 1주년 3개월 전 기준 10일 · 1개월 전까지, 추가분 5일 · 10일 전까지", () => {
    const s = promotionSchedule("2025-11-03", "hire", "2026-09-29")!;
    expect(s).toMatchObject({
      kind: "under-year", periodStart: "2025-11-03", periodEnd: "2026-11-02",
      firstFrom: "2026-08-03", firstTo: "2026-08-12", secondBy: "2026-10-02",
      laterFirstFrom: "2026-10-03", laterFirstTo: "2026-10-07", laterSecondBy: "2026-10-23",
    });
    // 회계연도 기준 회사라도 1년 미만은 입사 1주년 기준
    expect(promotionSchedule("2025-11-03", "fiscal", "2026-09-29")!.kind).toBe("under-year");
  });
  it("말일 입사는 없는 날을 말일로", () => {
    const s = promotionSchedule("2025-05-31", "hire", "2026-01-10")!;
    expect(s.firstFrom).toBe("2026-02-28");
  });
  it("통보 기한: 1차 = 받은 날 + 10일, 2차 = 사용기간 마지막 날", () => {
    const s = promotionSchedule("2024-03-04", "hire", "2026-09-29")!;
    expect(promotionNoticeDeadline(s, "first", "2026-09-29")).toBe("2026-10-09");
    expect(promotionNoticeDeadline(s, "second", "2026-12-01")).toBe("2027-03-03");
  });
  it("입사일 없음·입사 전", () => {
    expect(promotionSchedule(null, "hire", "2026-09-29")).toBeNull();
    expect(promotionSchedule("2026-10-01", "hire", "2026-09-29")).toBeNull();
  });
});
