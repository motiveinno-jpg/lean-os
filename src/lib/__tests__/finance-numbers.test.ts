// 회계 보고서·자금 숫자 — 화면마다 따로 세던 값을 한 함수로 모은 곳의 회귀 방지.
//   부가세 납부 예상(vat-estimate) · 달별 고정비 줄(cash-budget.fixedCostLinesForMonth) · 월말 잔액 역산(monthEndBalances).
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("jspdf", () => ({ default: class {} }));
vi.mock("jspdf-autotable", () => ({ default: () => {} }));

import { vatEstimatesFromRows } from "@/lib/vat-estimate";
import { fixedCostLinesForMonth, monthEndBalances, elapsedMonthKeys, type FixedCostSources } from "@/lib/cash-budget";

describe("vatEstimatesFromRows — 확정 매입매출전표 기준 분기 납부 예상", () => {
  const rows = [
    { entry_date: "2026-07-10", vat_type: "11", supply_amount: 10_000_000, vat_amount: 1_000_000 },
    { entry_date: "2026-08-31", vat_type: "11", supply_amount: 5_000_000, vat_amount: 500_000 },
    { entry_date: "2026-08-05", vat_type: "51", supply_amount: 1_000_000, vat_amount: 100_000 },
    { entry_date: "2026-08-06", vat_type: "57", supply_amount: 200_000, vat_amount: 20_000 },
    //   불공제는 세액이 있어도 공제에서 빠진다
    { entry_date: "2026-09-01", vat_type: "54", supply_amount: 300_000, vat_amount: 30_000 },
    //   다른 분기 — 섞이면 안 된다
    { entry_date: "2026-10-01", vat_type: "11", supply_amount: 9_000_000, vat_amount: 900_000 },
  ];
  const est = vatEstimatesFromRows(2026, rows, ["2026-09-02", "2026-09-03", "2026-12-01"]);

  it("2기 예정(7–9월) = 매출세액 − 공제 매입세액, 기한 10/25", () => {
    const q3 = est.find((e) => e.key === "2p")!;
    expect(q3.quarter).toBe("2026-Q3");
    expect(q3.salesVat).toBe(1_500_000);
    expect(q3.deductibleVat).toBe(120_000);
    expect(q3.payable).toBe(1_380_000);
    expect(q3.dueDate).toBe("2026-10-25");
    expect(q3.vouchers).toBe(5);
    expect(q3.unpostedInvoices).toBe(2);
  });
  it("2기 확정 기한은 다음 해 1/25 · 확정 신고는 그 3개월만", () => {
    const q4 = est.find((e) => e.key === "2c")!;
    expect(q4.dueDate).toBe("2027-01-25");
    expect(q4.payable).toBe(900_000);
    expect(q4.unpostedInvoices).toBe(1);
  });
});

describe("fixedCostLinesForMonth — 달별 고정비 한 벌", () => {
  const src: FixedCostSources = {
    recurring: [
      { id: "r1", name: "사무실 임차료", amount: 1_800_000, category: "임차료", day_of_month: 25, created_at: "2026-05-02T00:00:00Z" },
      { id: "r2", name: "클라우드 인프라 (누리)", amount: 1_240_000, category: "지급수수료", day_of_month: 5, created_at: "2026-05-02T00:00:00Z" },
      { id: "r3", name: "슬랙 프로", amount: 132_000, category: "지급수수료", day_of_month: 15, created_at: "2026-06-01T00:00:00Z" },
    ],
    fixedCosts: [
      //   정기 지출과 같은 이름 — 한 번만 센다
      { id: "f1", name: "사무실 임차료", amount: 1_800_000, category: "office", payment_day: 25, start_date: "2026-05-01", end_date: null },
      { id: "f2", name: "4대보험 회사부담분", amount: 960_000, category: "insurance", payment_day: 10, start_date: "2026-05-01", end_date: null },
      { id: "f3", name: "통신비(인터넷·전화)", amount: 385_000, category: "office", payment_day: 21, start_date: "2026-05-01", end_date: null },
    ],
    bankFixed: [
      //   등록 항목의 실제 출금 — 이미 센 것이라 빠진다(요금이 10% 오른 달 포함)
      { id: "b1", transaction_date: "2026-07-25", amount: -1_800_000, counterparty: "대한빌딩(주)", description: "사무실 임대료 7월", category: "임차료" },
      { id: "b2", transaction_date: "2026-08-05", amount: -1_364_000, counterparty: "누리클라우드", description: "클라우드 인프라 8월", category: "지급수수료" },
      { id: "b3", transaction_date: "2026-08-07", amount: -385_000, counterparty: "KT", description: "인터넷·전화 8월", category: "통신비" },
      { id: "b4", transaction_date: "2026-08-10", amount: -960_000, counterparty: "국민건강보험공단", description: "4대보험 8월", category: "세금과공과" },
      //   등록 안 된 체크 출금 — 더한다
      { id: "b5", transaction_date: "2026-08-20", amount: -500_000, counterparty: "세콤", description: "보안 관제", category: "지급수수료" },
      //   비용 계정이 아닌 것 — 뺀다
      { id: "b6", transaction_date: "2026-08-21", amount: -3_000_000, counterparty: "은행", description: "대출 원금", category: "단기차입금" },
    ],
    isCost: (c) => c !== "단기차입금",
    salaryFor: (ym) => (ym >= "2026-03" ? 10_000_000 : 5_000_000),
  };
  const total = (ym: string) => fixedCostLinesForMonth(src, ym).reduce((s, l) => s + l.amount, 0);

  it("등록 전 달은 급여만", () => {
    expect(total("2026-04")).toBe(10_000_000);
  });
  it("정기 지출·고정비 이름 중복은 한 번 — 5월", () => {
    //   임차료 1.8M + 클라우드 1.24M + 4대보험 0.96M + 통신비 0.385M + 급여
    expect(total("2026-05")).toBe(1_800_000 + 1_240_000 + 960_000 + 385_000 + 10_000_000);
  });
  it("7월 통장 임대료 출금은 등록 항목과 같아 다시 더하지 않는다", () => {
    expect(total("2026-07")).toBe(total("2026-06"));
  });
  it("8월 — 등록 항목 출금은 빼고 등록 안 된 체크 출금만 더한다", () => {
    const lines = fixedCostLinesForMonth(src, "2026-08");
    expect(lines.filter((l) => l.source === "bank").map((l) => l.refId)).toEqual(["b5"]);
    expect(total("2026-08")).toBe(total("2026-06") + 500_000);
  });
});

describe("monthEndBalances — 월말 잔액 역산", () => {
  const months = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, "0")}`);
  const flows = [
    { transaction_date: "2026-07-10", type: "income", amount: 10_000_000 },
    { transaction_date: "2026-07-25", type: "expense", amount: -2_000_000 },
    { transaction_date: "2026-08-05", type: "income", amount: 3_000_000 },
    { transaction_date: "2026-08-20", type: "expense", amount: 1_000_000 },
  ];
  const r = monthEndBalances(100_000_000, flows, months, "2026-09-29", "2026-06-15");

  it("이번 달은 현재 잔액, 미래 달은 비운다", () => {
    expect(r["2026-09"]).toBe(100_000_000);
    expect(r["2026-10"]).toBeNull();
    expect(r["2026-12"]).toBeNull();
  });
  it("지난 달 = 현재 − 그 뒤 순입출금", () => {
    expect(r["2026-08"]).toBe(100_000_000);                       // 9월 거래 없음
    expect(r["2026-07"]).toBe(100_000_000 - (3_000_000 - 1_000_000));
    expect(r["2026-06"]).toBe(100_000_000 - (10_000_000 - 2_000_000 + 3_000_000 - 1_000_000));
  });
  it("통장 거래 수집 전 달은 근거가 없어 비운다", () => {
    expect(r["2026-05"]).toBeNull();
    expect(monthEndBalances(1, [], ["2026-08", "2026-09"], "2026-09-29", null)).toEqual({ "2026-08": null, "2026-09": 1 });
  });
});

describe("elapsedMonthKeys", () => {
  it("올해는 이번 달까지, 지난 해는 12달, 앞으로 올 해는 없음", () => {
    expect(elapsedMonthKeys(2026, "2026-09-29")).toHaveLength(9);
    expect(elapsedMonthKeys(2025, "2026-09-29")).toHaveLength(12);
    expect(elapsedMonthKeys(2027, "2026-09-29")).toHaveLength(0);
  });
});
