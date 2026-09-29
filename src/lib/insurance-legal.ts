//   4대보험 법정 기본 요율 + 공개 계산기용 월 보험료 계산 — DB·브라우저 의존 없는 순수 모듈.
//   insurance-rates.ts(회사 설정 표 읽기)가 여기 값을 기본값으로 다시 내보내고,
//   공개 계산기(/tools/insurance-calculator·salary-calculator)는 로그인·DB 없이 여기만 읽는다 — 요율이 한 벌이다.

export type InsuranceRates = {
  year: number;
  np_emp: number; np_er: number;
  hi_emp: number; hi_er: number;
  ltc_pct: number;
  ei_emp: number; ei_er: number;
  ia_rate: number;
  np_floor: number; np_ceiling: number;
  hi_floor: number; hi_ceiling: number;
  /** true = 저장된 회사 행이 아니라 법정 기본값 */
  isDefault: boolean;
  note?: string | null;
};

/** 법정 기본값 — 연도별. 모르는 연도는 가장 가까운 아는 연도.
 *  2026 요율 출처: 보건복지부 고시·국민연금공단·건강보험공단.
 *    · 국민연금 9.5%(연금개혁 인상, 4.75/4.75) · 기준소득월액 하한 41만·상한 659만(2026.7~)
 *    · 건강보험 7.19%(3.595/3.595) · 장기요양 13.14%(건강보험료 대비, 보수월액 대비 0.9448%)
 *    · 고용보험 실업급여 1.8%(0.9/0.9) + 회사 고용안정·직능개발 0.25%(150인 미만) → 회사 1.15%
 *    · 산재 0.7%(업종별 상이, 기본값) */
const LEGAL: Record<number, Omit<InsuranceRates, "year" | "isDefault">> = {
  2026: { np_emp: 0.0475, np_er: 0.0475, hi_emp: 0.03595, hi_er: 0.03595, ltc_pct: 0.1314, ei_emp: 0.009, ei_er: 0.0115, ia_rate: 0.007,
          np_floor: 410_000, np_ceiling: 6_590_000, hi_floor: 279266, hi_ceiling: 119625307 },
};
export function legalInsuranceRates(year: number): InsuranceRates {
  const ys = Object.keys(LEGAL).map(Number).sort((a, b) => Math.abs(a - year) - Math.abs(b - year));
  return { year, isDefault: true, ...LEGAL[ys[0]] };
}

/** 10원 미만 버림 — 건강보험료·장기요양보험료 산정 방식(국민건강보험공단) */
export const floor10 = (n: number) => Math.floor(n / 10) * 10;

export type MonthlyInsurance = {
  pensionBase: number; pensionCapped: boolean; pensionFloored: boolean;
  healthBase: number;
  pension: number; health: number; care: number; emp: number;            // 근로자 몫(회사도 같은 액)
  healthEr: number; careEr: number; empEr: number; empBizExtra: number;   // 회사 몫 · empBizExtra = 고용안정·직능개발(회사만)
  workerTotal: number;
};

/** 월 보수 하나로 근로자·회사 부담 보험료. 장기요양은 **건강보험료 × 장기요양 비율**을 10원 미만 버림 */
export function monthlyInsurance(pay: number, R: InsuranceRates): MonthlyInsurance {
  const pensionBase = Math.min(R.np_ceiling, Math.max(R.np_floor, pay));
  const healthBase = Math.min(R.hi_ceiling, Math.max(R.hi_floor, pay));
  const pension = Math.round(pensionBase * R.np_emp);
  const health = floor10(healthBase * R.hi_emp);
  const care = floor10(health * R.ltc_pct);
  const emp = Math.round(pay * R.ei_emp);
  const healthEr = floor10(healthBase * R.hi_er);
  const careEr = floor10(healthEr * R.ltc_pct);
  const empEr = Math.round(pay * R.ei_emp);
  const empBizExtra = Math.round(pay * Math.max(0, R.ei_er - R.ei_emp));
  return {
    pensionBase, pensionCapped: pay > R.np_ceiling, pensionFloored: pay < R.np_floor, healthBase,
    pension, health, care, emp, healthEr, careEr, empEr, empBizExtra,
    workerTotal: pension + health + care + emp,
  };
}
