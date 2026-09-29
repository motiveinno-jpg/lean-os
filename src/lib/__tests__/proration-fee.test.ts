import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("../supabase", () => ({ supabase: {} }));

import { monthProration } from "../payroll";
import { calculatePayroll } from "../payment-batch";
import { legalInsuranceRates } from "../insurance-rates";
import { subscriptionMonthlyFee, isBilledSubscription } from "../subscription-fee";

describe("입사·퇴사 달 일할", () => {
  it("한 달 내내 재직이면 일할 없음", () => {
    expect(monthProration("2026-03", "2025-01-01", null)).toBeNull();
    expect(monthProration("2026-03", "2026-03-01", null)).toBeNull();
  });
  it("3/11 입사 → 31일 중 21일, 중간 입사 표시", () => {
    expect(monthProration("2026-03", "2026-03-11", null)).toEqual({ worked: 21, days: 31, hiredMidMonth: true, reason: "3/11 입사" });
  });
  it("6/15 퇴사 → 30일 중 15일, 입사 표시 아님", () => {
    const r = monthProration("2026-06", "2024-01-01", "2026-06-15");
    expect(r).toMatchObject({ worked: 15, days: 30, hiredMidMonth: false });
  });
  it("같은 달 입사·퇴사", () => {
    expect(monthProration("2026-02", "2026-02-10", "2026-02-19")).toMatchObject({ worked: 10, days: 28 });
  });
});

describe("취득월 국민연금·건강보험", () => {
  const rates = legalInsuranceRates(2026);
  it("면제면 연금·건강·장기요양 0, 고용보험은 실제 지급액에", () => {
    const it = calculatePayroll(2_000_000, "a", "a", { rates, pensionHealthExempt: true });
    expect(it.nationalPension).toBe(0);
    expect(it.healthInsurance).toBe(0);
    expect(it.longTermCareInsurance).toBe(0);
    expect(it.employmentInsurance).toBe(Math.round(2_000_000 * rates.ei_emp));
    expect(it.employerCosts.nationalPension).toBe(0);
    expect(it.employerCosts.healthInsurance).toBe(0);
  });
  it("퇴사월 일할이면 연금·건강은 원래 월 보수로", () => {
    const full = calculatePayroll(3_000_000, "a", "a", { rates });
    const part = calculatePayroll(1_500_000, "a", "a", { rates, insuranceBase: 3_000_000 });
    expect(part.nationalPension).toBe(full.nationalPension);
    expect(part.healthInsurance).toBe(full.healthInsurance);
    expect(part.employmentInsurance).toBe(Math.round(1_500_000 * rates.ei_emp));
  });
});

describe("구독 월 요금", () => {
  const plan = { base_price: 39000, per_seat_price: 5000, included_seats: 5, annual_discount: 0.1 };
  it("포함 인원을 넘는 좌석만 과금", () => {
    expect(subscriptionMonthlyFee({ seat_count: 5 }, plan)).toBe(39000);
    expect(subscriptionMonthlyFee({ seat_count: 12 }, plan)).toBe(74000);
  });
  it("저장공간 팩은 좌석 단가로 더한다", () => {
    expect(subscriptionMonthlyFee({ seat_count: 5, storage_pack_count: 2 }, plan)).toBe(49000);
  });
  it("연간은 할인 적용 월 환산", () => {
    expect(subscriptionMonthlyFee({ seat_count: 5, billing_cycle: "annual" }, plan)).toBe(35100);
  });
  it("토스 결제 구독도 실결제로 센다", () => {
    expect(isBilledSubscription({ toss_billing_key: "k" })).toBe(true);
    expect(isBilledSubscription({ stripe_subscription_id: "s" })).toBe(true);
    expect(isBilledSubscription({})).toBe(false);
  });
});
