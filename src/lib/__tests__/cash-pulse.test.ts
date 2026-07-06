// 현금 펄스 엔진 — 순수 계산 레이어 회귀 방지.
//   잔고 합산·월번, D+N 예측 창(window), 펄스 점수 배점표, 레벨 경계값.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildCashPulse, getPulseLevel, type CashPulseInput } from "@/lib/cash-pulse";

// 날짜 창 계산이 new Date() 기반 — 고정 시각으로 결정적 테스트
const NOW = new Date("2026-07-06T03:00:00Z");

const baseInput = (): CashPulseInput => ({
  bankBalances: [],
  revenueSchedules: [],
  costSchedules: [],
  recurringPayments: [],
  employeeSalaryTotal: 0,
  paymentQueue: [],
  riskCount: 0,
  pendingApprovalCount: 0,
  arOver30Amount: 0,
  matchedRate: 1,
});

const daysFromNow = (d: number) => {
  const t = new Date(NOW);
  t.setDate(t.getDate() + d);
  return t.toISOString().split("T")[0];
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("buildCashPulse — 잔고·번(burn)", () => {
  it("잔고 = 연동 계좌 합산 + 수동 보정(시재금)", () => {
    const r = buildCashPulse({
      ...baseInput(),
      bankBalances: [{ balance: 1_000_000 }, { balance: 2_500_000 }],
      manualCashAdjustment: 500_000,
    });
    expect(r.currentBalance).toBe(4_000_000);
  });

  it("월 고정비 = 활성 반복결제 + 급여 + 사용자 추가 고정비 (비활성 반복결제 제외)", () => {
    const r = buildCashPulse({
      ...baseInput(),
      recurringPayments: [
        { amount: 300_000, is_active: true },
        { amount: 999_999, is_active: false },
      ],
      employeeSalaryTotal: 5_000_000,
      monthlyFixedCostOverride: 700_000,
    });
    expect(r.monthlyBurn).toBe(6_000_000);
  });
});

describe("buildCashPulse — D+N 예측 창", () => {
  it("창 안(D+30 이내) 매출/비용 스케줄만 반영, 창 밖(D+60)은 D+30에 미반영", () => {
    const r = buildCashPulse({
      ...baseInput(),
      bankBalances: [{ balance: 10_000_000 }],
      revenueSchedules: [
        { amount: 3_000_000, due_date: daysFromNow(10), status: "scheduled" },
        { amount: 9_000_000, due_date: daysFromNow(60), status: "scheduled" }, // D+30 창 밖
        { amount: 5_000_000, due_date: daysFromNow(5), status: "received" },   // 상태 제외
      ],
      costSchedules: [{ amount: 1_000_000, due_date: daysFromNow(20), status: "scheduled" }],
    });
    // D+30: 10,000,000 + 3,000,000 - 1,000,000 (번 0) = 12,000,000
    expect(r.forecast30d).toBe(12_000_000);
    // D+90: 창 밖이던 9,000,000 도 포함 = 10,000,000 + 12,000,000 - 1,000,000 = 21,000,000
    expect(r.forecast90d).toBe(21_000_000);
  });

  it("승인 대기 결제(paymentQueue)는 D+7 이하에만 차감", () => {
    const r = buildCashPulse({
      ...baseInput(),
      bankBalances: [{ balance: 10_000_000 }],
      paymentQueue: [
        { amount: 2_000_000, status: "approved" },
        { amount: 1_000_000, status: "pending" },
        { amount: 999_999, status: "executed" }, // 제외
      ],
    });
    const d7 = r.forecastPoints.find((p) => p.days === 7)!;
    expect(d7.balance).toBe(7_000_000);
    expect(r.forecast30d).toBe(10_000_000); // D+30에는 미차감
  });

  it("월번은 일할 계산 (D+30 = 월번 1배, D+90 = 3배)", () => {
    const r = buildCashPulse({
      ...baseInput(),
      bankBalances: [{ balance: 30_000_000 }],
      employeeSalaryTotal: 3_000_000,
    });
    expect(r.forecast30d).toBe(27_000_000);
    expect(r.forecast90d).toBe(21_000_000);
  });
});

describe("buildCashPulse — 펄스 점수 배점표", () => {
  it("최상 케이스 = 100점 (런웨이 6개월+ 40 / 순흐름+ 20 / AR 15 / 매칭 10 / 결재 15)", () => {
    const r = buildCashPulse({
      ...baseInput(),
      bankBalances: [{ balance: 60_000_000 }],
      employeeSalaryTotal: 1_000_000, // 런웨이 60개월
      // 30일 창 수입 ≥ 월번이어야 순흐름 만점 (수입 없으면 -번 → 10점)
      revenueSchedules: [{ amount: 2_000_000, due_date: daysFromNow(10), status: "scheduled" }],
    });
    expect(r.pulseScore).toBe(100);
    expect(r.scoreBreakdown).toEqual({ runway: 40, cashflowTrend: 20, arHealth: 15, matchingRate: 10, approvalLag: 15 });
  });

  it("연체 미수금은 AR 점수를 비율로 깎는다", () => {
    const r = buildCashPulse({
      ...baseInput(),
      bankBalances: [{ balance: 60_000_000 }],
      employeeSalaryTotal: 1_000_000,
      revenueSchedules: [{ amount: 10_000_000, due_date: daysFromNow(10), status: "scheduled" }],
      arOver30Amount: 5_000_000, // 연체가 AR의 절반
    });
    expect(r.scoreBreakdown.arHealth).toBe(8); // round(15 * 0.5)
  });

  it("승인 대기 6건+ → 결재 점수 0, 브리핑에 표기", () => {
    const r = buildCashPulse({ ...baseInput(), bankBalances: [{ balance: 60_000_000 }], employeeSalaryTotal: 1_000_000, pendingApprovalCount: 6 });
    expect(r.scoreBreakdown.approvalLag).toBe(0);
    expect(r.briefing).toContain("승인대기 6건");
  });

  it("90일 내 마이너스 예측 → 현금 부족 경고 브리핑", () => {
    const r = buildCashPulse({ ...baseInput(), bankBalances: [{ balance: 1_000_000 }], employeeSalaryTotal: 3_000_000 });
    expect(r.forecast90d).toBeLessThan(0);
    expect(r.briefing).toContain("90일 내 현금 부족 경고");
  });
});

describe("getPulseLevel — 레벨 경계값", () => {
  it.each([
    [0, "critical"], [19, "critical"],
    [20, "danger"], [39, "danger"],
    [40, "warning"], [59, "warning"],
    [60, "stable"], [79, "stable"],
    [80, "safe"], [100, "safe"],
  ] as const)("점수 %i → %s", (score, level) => {
    expect(getPulseLevel(score)).toBe(level);
  });
});
