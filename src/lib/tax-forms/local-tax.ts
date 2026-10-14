// ── 지방세 — 법인지방소득세 · 주민세 종업원분 · 주민세 사업소분 (2026-10-14, 위하고식 지방세 신고 보완) ──
//
//   History: 세무 신고엔 국세(원천세·부가세·법인세)만 있었다. 지방세는 법인세 탭의 '지방소득세(참고) 10%' 한 줄과
//   원천세 탭의 특별징수 지방소득세 표뿐 — 법인지방소득세 신고(4/30)·주민세(종업원분 매월 10일, 사업소분 8/31)는 밖에서 했다.
//   기준: 법인지방소득세 과세표준 = 법인세 과세표준(법인세 신고본이 있으면 그 숫자, 없으면 예상). 구간세율은 법인세의 1/10.
//   주민세 종업원분 = 그 달 종업원 급여총액(과세분) × 0.5%. 면세점(최근 1년 월평균 급여총액)은 회사가 확인 — 기본 1억 8천만원.
//   주민세 사업소분 = 기본세액(법인 자본금 구간) + 사업소 연면적 330㎡ 초과 시 ㎡당 250원(지방세법 81조).
//   자동으로 못 푸는 것: 공제·감면(중소기업 고용지원 등)·안분(여러 시군구 사업장)·자본금·연면적 — 사람 칸.
//   ⚠️ 세율·면세점이 바뀌면 여기 상수를 고친다.

//   세율은 천분율 정수(permille)로 곱한다 — 0.009 같은 소수 곱셈은 200,000,000 × 0.009 = 1,799,999.99… 로 1원이 빠진다
export const LOCAL_CIT_BRACKETS = [
  { upTo: 200_000_000, permille: 9, rate: 0.009, label: "2억 이하" },
  { upTo: 20_000_000_000, permille: 19, rate: 0.019, label: "2억 초과 ~ 200억" },
  { upTo: 300_000_000_000, permille: 21, rate: 0.021, label: "200억 초과 ~ 3,000억" },
  { upTo: Infinity, permille: 24, rate: 0.024, label: "3,000억 초과" },
] as const;

export function localCitOf(base: number) {
  if (base <= 0) return { brackets: [] as { label: string; rate: number; amt: number; tax: number }[], total: 0 };
  const brackets: { label: string; rate: number; amt: number; tax: number }[] = [];
  let prev = 0, total = 0;
  for (const b of LOCAL_CIT_BRACKETS) {
    const amt = Math.min(base, b.upTo) - prev;
    if (amt <= 0) break;
    const tax = Math.floor((amt * b.permille) / 1000);
    brackets.push({ label: b.label, rate: b.rate, amt, tax }); total += tax; prev = b.upTo;
  }
  return { brackets, total };
}

/** 법인지방소득세 — 산출 − 공제·감면 + 가산세 − 기납부(특별징수 원천분·수시부과) */
export function localCitReturn(base: number, m: { credit?: number; penalty?: number; prepaid?: number }) {
  const calc = localCitOf(base).total;
  const total = Math.max(0, calc - Math.round(m.credit || 0)) + Math.round(m.penalty || 0);
  return { calc, total, pay: total - Math.round(m.prepaid || 0) };
}

export const EMPLOYEE_TAX_EXEMPT = 180_000_000;
/** 주민세 종업원분 — 면세점 이하(최근 1년 월평균)면 0. 10원 미만 절사 */
export function employeeTax(monthTotal: number, monthlyAvg12: number, threshold = EMPLOYEE_TAX_EXEMPT) {
  const exempt = monthlyAvg12 <= threshold;
  const tax = exempt ? 0 : Math.floor((monthTotal * 5) / 1000 / 10) * 10;   // 0.5% = 5/1000, 10원 미만 절사
  return { exempt, tax };
}

/** 주민세 사업소분 기본세액(법인) — 자본금(출자금) 구간 */
export function businessPlaceBase(capital: number) {
  if (capital > 5_000_000_000) return 200_000;
  if (capital > 3_000_000_000) return 100_000;
  return 50_000;
}
/** 연면적 330㎡ 초과 시 연면적 전체 × 250원 (지방세법 81조 1항 2호) */
export function businessPlaceTax(capital: number, areaM2: number) {
  const base = businessPlaceBase(capital);
  const area = areaM2 > 330 ? Math.floor(areaM2 * 250) : 0;
  return { base, area, total: base + area };
}
