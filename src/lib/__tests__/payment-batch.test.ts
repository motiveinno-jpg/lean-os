// 급여 계산 엔진 — 4대보험 요율·상하한, 간이세액 소득세, 부양가족 감면, 퇴직금.
//   요율/상하한/세액표 상수가 바뀌면(매년 7월 국민연금 기준소득 조정 등) 여기가 먼저 깨진다.
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

import { calculatePayroll, calculateRetirementPay, sumExtras } from "@/lib/payment-batch";

describe("calculatePayroll — 4대보험·소득세 (2026 요율)", () => {
  it("월 300만(과세) + 식대 20만 — 표준 케이스 전체 검산", () => {
    const r = calculatePayroll(3_000_000, "김직원", "emp-1", { nonTaxableAmount: 200_000 });
    expect(r.taxableIncome).toBe(3_000_000);
    expect(r.nationalPension).toBe(135_000);        // 4.5%
    expect(r.healthInsurance).toBe(106_350);        // 3.545%
    expect(r.longTermCareInsurance).toBe(13_772);   // 건보의 12.95%
    expect(r.employmentInsurance).toBe(27_000);     // 0.9%
    expect(r.incomeTax).toBe(39_000);               // 간이세액표 300만 구간
    expect(r.localIncomeTax).toBe(3_900);           // 소득세의 10%
    expect(r.deductionsTotal).toBe(325_022);
    expect(r.netPay).toBe(3_200_000 - 325_022);     // 지급총액(기본급+식대) − 공제
  });

  it("국민연금 상한 — 과세소득이 상한(590만) 초과 시 상한 기준", () => {
    const r = calculatePayroll(10_000_000, "고소득", "emp-2");
    expect(r.nationalPension).toBe(Math.round(5_900_000 * 0.045)); // 265,500
  });

  it("국민연금 하한 — 과세소득이 하한(39만) 미만이어도 하한 기준", () => {
    const r = calculatePayroll(300_000, "저소득", "emp-3");
    expect(r.nationalPension).toBe(Math.round(390_000 * 0.045)); // 17,550
  });

  it("간이세액표 면세 구간(106만 이하) → 소득세·지방세 0", () => {
    const r = calculatePayroll(1_000_000, "면세", "emp-4");
    expect(r.incomeTax).toBe(0);
    expect(r.localIncomeTax).toBe(0);
  });

  it("부양가족 감면 — 추가 1인당 12,500원 (본인 제외)", () => {
    const solo = calculatePayroll(3_000_000, "a", "e1", { dependents: 1 });
    const family = calculatePayroll(3_000_000, "b", "e2", { dependents: 3 });
    expect(solo.incomeTax - family.incomeTax).toBe(25_000);
  });

  it("과세 수당(taxableAllowance)은 과세소득에 가산돼 보험·세금 재계산", () => {
    const withAllowance = calculatePayroll(2_800_000, "a", "e1", { taxableAllowance: 200_000 });
    const plain = calculatePayroll(3_000_000, "b", "e2");
    expect(withAllowance.taxableIncome).toBe(3_000_000);
    expect(withAllowance.nationalPension).toBe(plain.nationalPension);
    expect(withAllowance.incomeTax).toBe(plain.incomeTax);
  });

  it("사업주 부담분 — 연금 동액 + 건보(장기요양 포함) 동액 + 고용 1.35% + 산재 0.7%", () => {
    const r = calculatePayroll(3_000_000, "a", "e1");
    const ec = r.employerCosts;
    expect(ec.nationalPension).toBe(135_000);
    expect(ec.healthInsurance + (ec.longTermCareInsurance ?? 0)).toBe(106_350 + 13_772);
    expect(ec.employmentInsurance).toBe(Math.round(3_000_000 * 0.0135)); // 40,500
    expect(ec.industrialAccident).toBe(Math.round(3_000_000 * 0.007));   // 21,000
    expect(ec.total).toBe(135_000 + 120_122 + 40_500 + 21_000);
  });
});

describe("sumExtras — 임의 수당/공제 합산", () => {
  it("수당·공제 분리 합산, 음수는 0으로 클램프", () => {
    expect(sumExtras([
      { type: "allowance", name: "야근", amount: 100_000 },
      { type: "allowance", name: "출장", amount: 50_000 },
      { type: "deduction", name: "가불", amount: 30_000 },
      { type: "deduction", name: "이상값", amount: -999 },
    ])).toEqual({ allowance: 150_000, deduction: 30_000, net: 120_000 });
    expect(sumExtras(undefined)).toEqual({ allowance: 0, deduction: 0, net: 0 });
  });
});

describe("calculateRetirementPay — 근로기준법 퇴직금", () => {
  it("1년 미만 → 미지급(eligible false)", () => {
    const r = calculateRetirementPay({ startDate: "2025-06-01", endDate: "2026-01-01", last3MonthsSalary: 9_000_000 });
    expect(r.eligible).toBe(false);
    expect(r.retirementPay).toBe(0);
  });

  it("딱 1년(365일) — 3개월 총급여 900만 → 평균일급 10만 × 30일 = 300만", () => {
    const r = calculateRetirementPay({ startDate: "2025-01-01", endDate: "2026-01-01", last3MonthsSalary: 9_000_000 });
    expect(r.eligible).toBe(true);
    expect(r.totalDays).toBe(365);
    expect(r.dailyAvgWage).toBe(100_000);
    expect(r.retirementPay).toBe(3_000_000);
  });

  it("2년 근속 → 근속 비례 (약 2배)", () => {
    const r = calculateRetirementPay({ startDate: "2024-01-01", endDate: "2026-01-01", last3MonthsSalary: 9_000_000 });
    expect(r.retirementPay).toBe(Math.round(100_000 * 30 * (r.totalDays / 365)));
    expect(r.totalDays).toBe(731); // 2024 윤년 포함
  });
});
