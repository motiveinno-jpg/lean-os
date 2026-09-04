import { describe, expect, it } from "vitest";
import { detectRisks, type FinancialItem } from "../engines";

const today = new Date("2026-09-04T00:00:00+09:00");
const ar = (name: string, amount: number, daysAgo: number): FinancialItem => ({
  category: "receivable", name, amount,
  due_date: new Date(today.getTime() - daysAgo * 86400000).toISOString().slice(0, 10),
  status: "pending", risk_label: null, project_name: null, account_type: null,
});

describe("detectRisks — 미수 30일 초과", () => {
  it("계산서 장 단위가 아니라 거래처 단위로 하나씩, 금액 큰 순", () => {
    const risks = detectRisks([], [
      ar("가나상사", 100, 45), ar("가나상사", 200, 90), ar("다라물산", 500, 31), ar("마바", 999, 10),
    ], [], today);
    const arRisks = risks.filter((r) => r.label === "AR_OVER_30");
    expect(arRisks.map((r) => r.name)).toEqual(["다라물산", "가나상사"]);
    expect(arRisks[1]).toMatchObject({ amount: 300, daysOverdue: 90 });
    expect(arRisks[1].detail).toContain("2건");
  });

  it("30일 이하는 리스크가 아니다 (invoice-arap 과 같은 > 30 기준)", () => {
    const risks = detectRisks([], [ar("가나상사", 100, 30)], [], today);
    expect(risks.filter((r) => r.label === "AR_OVER_30")).toHaveLength(0);
  });
});
