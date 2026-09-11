import { describe, it, expect } from "vitest";
import { parseMoney, reconcileAmounts } from "@/components/tax-invoice-bulk-issue";

//   세금계산서 엑셀 일괄발행 — 공급가액·세액·공급대가 (2026-09-11 사장님).
//   셋 중 둘만 적어도 나머지를 채우고, 셋 다 적혔으면 합을 검산한다. 국세청에 그대로 나가는 값이라
//   반올림과 영세율·면세를 특히 조심한다.

describe("엑셀 금액 칸 읽기", () => {
  it("쉼표·원·공백을 걸러 숫자로", () => {
    expect(parseMoney("1,000,000")).toBe(1000000);
    expect(parseMoney(" 1100000 원 ")).toBe(1100000);
    expect(parseMoney(1000000)).toBe(1000000);
  });
  it("빈 칸은 null, 글자는 NaN", () => {
    expect(parseMoney("")).toBeNull();
    expect(parseMoney(null)).toBeNull();
    expect(Number.isNaN(parseMoney("백만원") as number)).toBe(true);
  });
});

describe("공급가액·세액·공급대가 맞추기", () => {
  it("공급가액과 세액을 적으면 그대로 쓴다", () => {
    const r = reconcileAmounts(1000000, 100000, null, true);
    expect(r).toMatchObject({ supply: 1000000, tax: 100000 });
    expect(r.errors).toHaveLength(0);
  });

  it("공급가액만 적으면 과세는 10%를 붙인다", () => {
    expect(reconcileAmounts(1000000, null, null, true)).toMatchObject({ supply: 1000000, tax: 100000 });
  });

  it("공급대가만 적으면 과세는 1.1로 가른다", () => {
    const r = reconcileAmounts(null, null, 1100000, true);
    expect(r).toMatchObject({ supply: 1000000, tax: 100000 });
  });

  it("공급대가만 적고 딱 나눠지지 않아도 합은 공급대가와 같다", () => {
    const r = reconcileAmounts(null, null, 1000000, true);
    expect(r.supply + r.tax).toBe(1000000);
    expect(r.supply).toBe(909091);
    expect(r.errors).toHaveLength(0);
  });

  it("공급가액과 공급대가를 적으면 세액은 그 차이", () => {
    expect(reconcileAmounts(1000000, null, 1100000, true)).toMatchObject({ supply: 1000000, tax: 100000 });
  });

  it("세액과 공급대가를 적으면 공급가액은 그 차이", () => {
    expect(reconcileAmounts(null, 100000, 1100000, true)).toMatchObject({ supply: 1000000, tax: 100000 });
  });

  it("셋 다 적었는데 합이 안 맞으면 그 행은 오류", () => {
    const r = reconcileAmounts(1000000, 100000, 1200000, true);
    expect(r.errors.join()).toContain("공급대가");
  });

  it("1원 반올림 차이는 넘어간다", () => {
    expect(reconcileAmounts(909091, 90909, 1000000, true).errors).toHaveLength(0);
  });

  it("영세율·면세는 세액이 0", () => {
    expect(reconcileAmounts(1000000, null, null, false)).toMatchObject({ supply: 1000000, tax: 0 });
    expect(reconcileAmounts(null, null, 1000000, false)).toMatchObject({ supply: 1000000, tax: 0 });
  });

  it("영세율·면세인데 세액을 적으면 오류", () => {
    expect(reconcileAmounts(1000000, 100000, null, false).errors.join()).toContain("영세율");
  });

  it("공급대가가 공급가액보다 작으면 오류", () => {
    expect(reconcileAmounts(1100000, null, 1000000, true).errors.join()).toContain("음수");
  });

  it("아무것도 안 적으면 오류", () => {
    expect(reconcileAmounts(null, null, null, true).errors.join()).toContain("최소 하나");
  });

  it("숫자가 아니면 오류", () => {
    expect(reconcileAmounts(NaN, null, null, true).errors.join()).toContain("공급가액");
  });
});
