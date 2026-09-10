import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn(), reportError: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { from: mocks.from } }));
vi.mock("@/lib/friendly-error", () => ({ reportError: mocks.reportError }));

import { fetchPaged } from "@/lib/fetch-paged";
import { canManageScheduleEvent, deleteEvent, toggleEventCompleted, getMonthEvents } from "@/lib/schedule";
import { payslipMonthKey } from "@/lib/payment-batch";

beforeEach(() => vi.clearAllMocks());

describe("기능 감사: 조회 절단·실패", () => {
  it("두 번째 페이지까지 합산한다", async () => {
    const range = vi.fn().mockResolvedValueOnce({ data: Array.from({ length: 1000 }, (_, i) => i), error: null })
      .mockResolvedValueOnce({ data: [1000, 1001], error: null });
    expect(await fetchPaged("test", () => ({ range }), 5000, { strict: true })).toHaveLength(1002);
    expect(range.mock.calls).toEqual([[0, 999], [1000, 1999]]);
  });
  it("부분 조회 후 오류가 나도 불완전한 합계를 반환하지 않는다", async () => {
    const error = new Error("읽기 실패");
    const range = vi.fn().mockResolvedValueOnce({ data: Array(1000).fill(1), error: null })
      .mockResolvedValueOnce({ data: null, error });
    await expect(fetchPaged("test", () => ({ range }), 5000, { strict: true })).rejects.toThrow("읽기 실패");
  });
  it("정확히 상한인 경우와 상한 초과를 구분한다", async () => {
    const range = vi.fn().mockResolvedValueOnce({ data: Array(1000).fill(1), error: null })
      .mockResolvedValueOnce({ data: [], error: null });
    expect(await fetchPaged("test", () => ({ range }), 1000, { strict: true })).toHaveLength(1000);
    range.mockResolvedValueOnce({ data: Array(1000).fill(1), error: null }).mockResolvedValueOnce({ data: [1], error: null });
    await expect(fetchPaged("test", () => ({ range }), 1000, { strict: true })).rejects.toThrow("기간을 줄여");
  });
});

describe("기능 감사: 일정 쓰기", () => {
  it("공유받은 사람과 로그인하지 않은 사람은 편집할 수 없다", () => {
    expect(canManageScheduleEvent({ user_id: "owner" }, "owner")).toBe(true);
    expect(canManageScheduleEvent({ user_id: "owner" }, "reader")).toBe(false);
    expect(canManageScheduleEvent({ user_id: null }, null)).toBe(false);
  });
  it.each(["완료", "삭제"])("%s가 0행 처리되면 성공으로 표시하지 않는다", async (kind) => {
    const query: any = {};
    for (const method of ["update", "delete", "eq", "select"]) query[method] = vi.fn(() => query);
    query.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    mocks.from.mockReturnValue(query);
    const operation = kind === "완료" ? toggleEventCompleted("uuid@2026-09-10", true) : deleteEvent("uuid@2026-09-10");
    await expect(operation).rejects.toThrow("권한");
    expect(query.eq).toHaveBeenCalledWith("id", "uuid");
  });
  it("반복 회차에는 원본 날짜를 보존한다", async () => {
    const query: any = {};
    for (const method of ["select", "eq", "not", "lt", "order"]) query[method] = vi.fn(() => query);
    query.range = vi.fn().mockResolvedValue({ data: [{ id: "series", start_at: "2026-08-03T00:00:00", end_at: null, recurrence: { freq: "daily" } }], error: null });
    mocks.from.mockReturnValue(query);
    const rows = await getMonthEvents("company", 2026, 8);
    expect(rows.length).toBe(30);
    expect(rows[0].recurrence_source).toEqual({ start_at: "2026-08-03T00:00:00", end_at: null });
  });
});

describe("급여명세서 대상 월", () => {
  it.each([["2026년 9월", "2026-09"], ["2026-09", "2026-09"], ["2026년 13월", null], ["급여", null]])("%s", (label, expected) => {
    expect(payslipMonthKey(label!)).toBe(expected);
  });
});
