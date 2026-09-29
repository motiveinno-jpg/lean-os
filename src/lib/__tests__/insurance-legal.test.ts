// 공개 4대보험·실수령액 계산기의 보험료 계산 — 건강·장기요양 10원 미만 버림, 상·하한.
import { describe, it, expect } from "vitest";
import { legalInsuranceRates, monthlyInsurance, floor10 } from "@/lib/insurance-legal";

const R = legalInsuranceRates(2026);

describe("monthlyInsurance (2026)", () => {
  it("월 300만 원 — 건강 107,850 · 장기요양 14,170(10원 미만 버림)", () => {
    const m = monthlyInsurance(3_000_000, R);
    expect(m.pension).toBe(142_500);
    expect(m.health).toBe(107_850);
    expect(m.care).toBe(14_170);
    expect(m.emp).toBe(27_000);
    expect(m.careEr).toBe(14_170);
    expect(m.empBizExtra).toBe(7_500);
    expect(m.workerTotal).toBe(142_500 + 107_850 + 14_170 + 27_000);
  });

  it("건강보험료도 10원 미만을 버린다", () => {
    const m = monthlyInsurance(2_345_678, R);
    expect(m.health % 10).toBe(0);
    expect(m.care % 10).toBe(0);
    expect(m.health).toBe(floor10(2_345_678 * R.hi_emp));
  });

  it("국민연금 상·하한", () => {
    expect(monthlyInsurance(10_000_000, R).pensionBase).toBe(R.np_ceiling);
    expect(monthlyInsurance(10_000_000, R).pensionCapped).toBe(true);
    expect(monthlyInsurance(300_000, R).pensionBase).toBe(R.np_floor);
    expect(monthlyInsurance(300_000, R).pensionFloored).toBe(true);
  });
});
