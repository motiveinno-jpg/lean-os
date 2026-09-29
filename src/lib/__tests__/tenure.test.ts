import { describe, it, expect } from "vitest";
import { tenureBetween, formatTenure } from "@/lib/tenure";

describe("tenureBetween — 달력 기준 근속 + 재직일수(양 끝 포함)", () => {
  it("입사 1주년 전날까지면 만 1년 · 365일", () => {
    expect(tenureBetween("2025-03-04", "2026-03-03")).toEqual({ years: 1, months: 0, days: 0, totalDays: 365 });
  });
  it("30일=한 달로 세지 않는다 — 2025-11-03 ~ 2026-09-29 = 10개월 27일 · 331일(퇴직금 추계와 같은 일수)", () => {
    const t = tenureBetween("2025-11-03", "2026-09-29")!;
    expect(t).toEqual({ years: 0, months: 10, days: 27, totalDays: 331 });
    expect(formatTenure(t)).toBe("10개월");
    expect(formatTenure(t, "always")).toBe("10개월 27일");
  });
  it("365일 나누기로 생기던 한 달 올림이 없다 — 2024-03-04 ~ 2026-09-29 = 2년 6개월", () => {
    const t = tenureBetween("2024-03-04", "2026-09-29")!;
    expect(formatTenure(t)).toBe("2년 6개월");
    expect(t.totalDays).toBe(940);
  });
  it("말일 입사", () => {
    expect(tenureBetween("2024-01-31", "2024-02-28")).toEqual({ years: 0, months: 0, days: 29, totalDays: 29 });
    expect(tenureBetween("2024-01-31", "2024-02-29")).toEqual({ years: 0, months: 1, days: 0, totalDays: 30 });
  });
  it("입사 당일 · 기준일이 앞이면 null", () => {
    expect(tenureBetween("2026-09-29", "2026-09-29")).toEqual({ years: 0, months: 0, days: 1, totalDays: 1 });
    expect(tenureBetween("2026-09-30", "2026-09-29")).toBeNull();
    expect(formatTenure(null)).toBe("—");
  });
  it("증명서 표기(1년 미만만 일수)", () => {
    expect(formatTenure(tenureBetween("2026-06-15", "2026-09-29"), "under-year")).toBe("3개월 15일");
    expect(formatTenure(tenureBetween("2023-01-02", "2026-09-29"), "under-year")).toBe("3년 8개월");
  });
});
