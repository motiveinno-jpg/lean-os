// 원천세 서식 — 연말정산(A04) 반영과 환급세액 조정 (2026-10-14 연말정산 4단계)
import { describe, it, expect } from "vitest";
import { computeWhtForm } from "@/lib/tax-forms/wht-form";

const z = { n: 0, pay: 0, tax: 0 };
describe("computeWhtForm — A04", () => {
  it("추징이면 A10·A99 에 더해 낸다", () => {
    const F = computeWhtForm({ work: { n: 2, pay: 5_000_000, tax: 64_000 }, biz: z, ret: z, yearEnd: { n: 2, pay: 60_000_000, tax: 20_000 } });
    expect(F.A04).toEqual({ n: 2, amount: 60_000_000, tax: 20_000 });
    expect(F.A10).toEqual({ n: 4, amount: 65_000_000, tax: 84_000 });
    expect(F.A99.tax).toBe(84_000);
    expect(F.PAY.tax).toBe(84_000);
  });
  it("환급이 간이세액보다 작으면 A10 에서 상계", () => {
    const F = computeWhtForm({ work: { n: 2, pay: 5_000_000, tax: 64_000 }, biz: z, ret: z, yearEnd: { n: 2, pay: 60_000_000, tax: -30_000 } });
    expect(F.A10.tax).toBe(34_000);
    expect(F.R15.tax).toBe(0);
    expect(F.PAY.tax).toBe(34_000);
  });
  it("A10 이 음수면 ⑮ 일반환급 → 다른 소득 세액에서 ⑲ 조정, 남는 건 ⑳ 차월이월 · A99 = 양수 가감계의 합", () => {
    const F = computeWhtForm({ work: { n: 1, pay: 3_000_000, tax: 20_000 }, biz: { n: 1, pay: 1_000_000, tax: 30_000 }, ret: z,
      yearEnd: { n: 1, pay: 40_000_000, tax: -120_000 } });
    expect(F.A10.tax).toBe(-100_000);
    expect(F.A30.tax).toBe(30_000);
    expect(F.A99.tax).toBe(30_000);
    expect(F.R15.tax).toBe(100_000);
    expect(F.R19.tax).toBe(30_000);
    expect(F.R20.tax).toBe(70_000);
    expect(F.PAY.tax).toBe(0);
  });
  it("연말정산 없으면 예전과 같다", () => {
    const F = computeWhtForm({ work: { n: 2, pay: 5_000_000, tax: 64_000 }, biz: z, ret: z }, { R12: { tax: 10_000 } });
    expect(F.A04.tax).toBe(0);
    expect(F.R19.tax).toBe(10_000);
    expect(F.PAY.tax).toBe(54_000);
  });
});
