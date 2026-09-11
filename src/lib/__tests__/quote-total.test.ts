import { describe, it, expect } from "vitest";
import { quoteTotals, lineSupply, lineTax } from "@/lib/quote-total";

//   같은 견적서가 화면·문서함 PDF·프로젝트 PDF 에서 다른 금액으로 나오던 것을 한 벌로 모았다.
//   거래처가 받는 종이의 금액이 걸린 계산이라 경계값을 고정해 둔다.

describe("견적 합계", () => {
  it("공급가액은 화면 키(supplyAmount)와 옛 저장 키(amount) 둘 다 읽는다", () => {
    expect(lineSupply({ supplyAmount: 1000 })).toBe(1000);
    expect(lineSupply({ amount: 2000 })).toBe(2000);
    expect(lineSupply({})).toBe(0);
  });

  it("세액은 줄에 적힌 값을 쓰고, 없으면 10%", () => {
    expect(lineTax({ supplyAmount: 1_000_000, taxAmount: 0 })).toBe(0);
    expect(lineTax({ supplyAmount: 1_000_000 })).toBe(100_000);
  });

  it("면세·영세 품목은 세액이 0이다", () => {
    expect(lineTax({ supplyAmount: 1_000_000, taxFree: true })).toBe(0);
  });

  it("할인은 합계에서 빠진다", () => {
    const r = quoteTotals([{ supplyAmount: 10_000_000, taxAmount: 1_000_000 }], 1_000_000);
    expect(r).toEqual({ supply: 10_000_000, tax: 1_000_000, discount: 1_000_000, total: 10_000_000 });
  });

  it("할인을 음수로 적어도 더해지지 않는다", () => {
    expect(quoteTotals([{ supplyAmount: 1_000_000 }], -100_000).total).toBe(1_000_000);
  });

  it("면세가 섞이면 합계 × 10% 와 달라진다 — 그래서 줄마다 센다", () => {
    const lines = [
      { supplyAmount: 1_000_000 },                     // 과세 → 100,000
      { supplyAmount: 1_000_000, taxFree: true },      // 면세 → 0
    ];
    const r = quoteTotals(lines);
    expect(r.supply).toBe(2_000_000);
    expect(r.tax).toBe(100_000);
    expect(r.tax).not.toBe(Math.round(r.supply * 0.1));
  });

  it("빈 목록·잘못된 값도 0으로 센다", () => {
    expect(quoteTotals([], 0)).toEqual({ supply: 0, tax: 0, discount: 0, total: 0 });
    expect(quoteTotals(null, undefined).total).toBe(0);
    expect(quoteTotals([{ supplyAmount: "abc" as unknown as number }]).total).toBe(0);
  });
});
