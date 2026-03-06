/**
 * Reflect 비즈니스 계산 유틸리티
 */

/** 딜 마진 계산 (%) */
export function profitMargin(revenue: number, cost: number): number {
  if (revenue <= 0) return 0;
  return ((revenue - cost) / revenue) * 100;
}

/** 생존 개월수 */
export function survivalMonths(balance: number, fixedCost: number): number {
  if (fixedCost <= 0) return 999;
  return balance / fixedCost;
}

/** 예상 부가세 (매출세액 - 매입세액) */
export function vatPreview(incomes: number[], expenses: number[]): number {
  const inTotal = incomes.reduce((s, v) => s + v, 0);
  const outTotal = expenses.reduce((s, v) => s + v, 0);
  return (inTotal * 0.1) - (outTotal * 0.1);
}

/** 리스크 딜 여부 (마진 20% 미만) */
export function isRiskDeal(margin: number): boolean {
  return margin < 20;
}

/** 원화 포맷 */
export function formatKRW(amount: number): string {
  return `₩${amount.toLocaleString()}`;
}
