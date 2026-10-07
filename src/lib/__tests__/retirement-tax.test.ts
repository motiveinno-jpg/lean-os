// 퇴직소득세 — 2023 개정 공제표 손계산 사례와 대조 (2026-10-07 ERP 3차 A)
import { describe, it, expect } from "vitest";
import { calcRetirementTax, serviceYears, serviceDeduction, convertedDeduction, basicRateTax } from "@/lib/retirement-tax";

describe("근속연수", () => {
  it("꽉 찬 5년은 5", () => expect(serviceYears("2020-01-01", "2024-12-31")).toBe(5));
  it("5년 하루는 6 (1년 미만 끝수 올림)", () => expect(serviceYears("2020-01-01", "2025-01-01")).toBe(6));
  it("3개월도 1", () => expect(serviceYears("2026-01-01", "2026-03-31")).toBe(1));
  it("뒤집힌 날짜는 0", () => expect(serviceYears("2026-03-01", "2026-01-01")).toBe(0));
});

describe("공제·세율 표", () => {
  it("근속연수공제 구간", () => {
    expect(serviceDeduction(3)).toBe(3_000_000);
    expect(serviceDeduction(10)).toBe(15_000_000);
    expect(serviceDeduction(20)).toBe(40_000_000);
    expect(serviceDeduction(25)).toBe(55_000_000);
  });
  it("환산급여공제 구간", () => {
    expect(convertedDeduction(5_000_000)).toBe(5_000_000);
    expect(convertedDeduction(36_000_000)).toBe(24_800_000);
    expect(convertedDeduction(100_000_000)).toBe(61_700_000);
  });
  it("기본세율 누진공제 연속", () => {
    expect(basicRateTax(14_000_000)).toBeCloseTo(840_000);
    expect(basicRateTax(50_000_000)).toBeCloseTo(6_240_000);
    expect(basicRateTax(88_000_000)).toBeCloseTo(15_360_000);
  });
});

describe("퇴직소득세", () => {
  it("1억 · 20년 = 112만 원 (+ 지방 11.2만)", () => {
    const t = calcRetirementTax(100_000_000, "2006-01-01", "2025-12-31");
    expect(t.years).toBe(20);
    expect(t.converted).toBe(36_000_000);
    expect(t.base).toBe(11_200_000);
    expect(t.incomeTax).toBe(1_120_000);
    expect(t.localTax).toBe(112_000);
    expect(t.net).toBe(100_000_000 - 1_232_000);
  });
  it("5천만 · 10년 = 68만 원", () => {
    const t = calcRetirementTax(50_000_000, "2016-01-01", "2025-12-31");
    expect(t.incomeTax).toBe(680_000);
  });
  it("공제가 더 크면 0", () => {
    const t = calcRetirementTax(3_000_000, "2023-01-01", "2025-12-31");
    expect(t.incomeTax).toBe(0);
    expect(t.net).toBe(3_000_000);
  });
  it("IRP 이전은 원천징수 0 · 근거는 남김", () => {
    const t = calcRetirementTax(100_000_000, "2006-01-01", "2025-12-31", true);
    expect(t.incomeTax).toBe(0);
    expect(t.convertedTax).toBe(672_000);
  });
  it("0원은 0", () => expect(calcRetirementTax(0, "2020-01-01", "2025-01-01").incomeTax).toBe(0));
});
