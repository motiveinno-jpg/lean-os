// ── 퇴직소득세 계산 (2026-10-07 ERP 3차 A, docs/20261007_PLAN_erp_gap_audit3.md) ──
//
//   History: 퇴사 정산 초안(lib/retirement.ts buildSettlement)은 퇴직금 '세전'만 보여 줬고, 원천세 신고 화면은
//   "퇴직소득 지급분은 직접 더하세요"라고 적어 사람이 세금을 따로 계산해 옮겼다.
//   기준: 소득세법 제48조(퇴직소득공제)·제55조(기본세율) — 2023-01-01 이후 퇴직분 개정 공제표.
//     ① 근속연수 = 입사일~퇴사일, 1년 미만 끝수는 1년(시행령 제105조)
//     ② 근속연수공제 → ③ 환산급여 = (퇴직소득 − 근속연수공제) × 12 ÷ 근속연수
//     ④ 환산급여공제 → ⑤ 과세표준 × 기본세율 = 환산산출세액 → ⑥ 산출세액 = 환산산출세액 × 근속연수 ÷ 12
//     원천징수 세액은 10원 미만 버림(국고금관리법 제47조), 지방소득세 = 소득세의 10%.
//   자동으로 못 푸는 것(화면에 적는다): 임원 퇴직금 한도 초과분(근로소득), IRP 이전 과세이연,
//   DC형 퇴직연금(연금사업자가 원천징수), 중간정산 합산, 2015 이전 근속 분할 계산.
//   ★ 미사용 연차 수당·마지막 달 급여는 퇴직소득이 아니라 근로소득 — 급여 명세로 정산한다.

const MAN = 10_000;

/** 근속연수 — 입사일·퇴사일 포함, 1년 미만 끝수는 1년. 날짜가 뒤집혔으면 0 */
export function serviceYears(start: string, end: string): number {
  const s = new Date(`${start}T00:00:00Z`), e = new Date(`${end}T00:00:00Z`);
  if (!(e.getTime() >= s.getTime())) return 0;
  //   퇴사일 다음 날까지가 채운 기간 — 2020-01-01 입사 · 2024-12-31 퇴사 = 정확히 5년
  const next = new Date(e.getTime() + 86_400_000);
  let full = next.getUTCFullYear() - s.getUTCFullYear();
  const anniv = new Date(Date.UTC(s.getUTCFullYear() + full, s.getUTCMonth(), s.getUTCDate()));
  if (anniv.getTime() > next.getTime()) full -= 1;
  const exact = new Date(Date.UTC(s.getUTCFullYear() + full, s.getUTCMonth(), s.getUTCDate())).getTime() === next.getTime();
  return Math.max(1, exact ? full : full + 1);
}

/** 근속연수공제 (2023 개정) */
export function serviceDeduction(years: number): number {
  if (years <= 5) return 100 * MAN * years;
  if (years <= 10) return 500 * MAN + 200 * MAN * (years - 5);
  if (years <= 20) return 1_500 * MAN + 250 * MAN * (years - 10);
  return 4_000 * MAN + 300 * MAN * (years - 20);
}

/** 환산급여공제 */
export function convertedDeduction(conv: number): number {
  if (conv <= 800 * MAN) return conv;
  if (conv <= 7_000 * MAN) return 800 * MAN + (conv - 800 * MAN) * 0.6;
  if (conv <= 10_000 * MAN) return 4_520 * MAN + (conv - 7_000 * MAN) * 0.55;
  if (conv <= 30_000 * MAN) return 6_170 * MAN + (conv - 10_000 * MAN) * 0.45;
  return 15_170 * MAN + (conv - 30_000 * MAN) * 0.35;
}

/** 종합소득 기본세율 (2023~) — 과세표준 → 세액 */
export function basicRateTax(base: number): number {
  const B: [number, number, number][] = [ // [상한, 세율, 누진공제]
    [1_400 * MAN, 0.06, 0], [5_000 * MAN, 0.15, 126 * MAN], [8_800 * MAN, 0.24, 576 * MAN],
    [15_000 * MAN, 0.35, 1_544 * MAN], [30_000 * MAN, 0.38, 1_994 * MAN], [50_000 * MAN, 0.40, 2_594 * MAN],
    [100_000 * MAN, 0.42, 3_594 * MAN], [Infinity, 0.45, 6_594 * MAN],
  ];
  if (base <= 0) return 0;
  const [, rate, deduct] = B.find(([cap]) => base <= cap)!;
  return base * rate - deduct;
}

export type RetirementTax = {
  pay: number; years: number; serviceDeduction: number; converted: number; convertedDeduction: number;
  base: number; convertedTax: number; incomeTax: number; localTax: number; net: number;
};

const floor10 = (n: number) => Math.floor(n / 10) * 10;

/** 퇴직소득세 — pay 는 과세 퇴직급여(원). irpDeferred 면 원천징수 0(과세이연)이지만 계산 근거는 그대로 보여 준다 */
export function calcRetirementTax(pay: number, start: string, end: string, irpDeferred = false): RetirementTax {
  const p = Math.max(0, Math.round(pay || 0));
  const years = p > 0 ? serviceYears(start, end) : 0;
  const sd = years > 0 ? Math.min(p, serviceDeduction(years)) : 0;
  const converted = years > 0 ? Math.floor(((p - sd) * 12) / years) : 0;
  const cd = Math.floor(Math.min(converted, convertedDeduction(converted)));
  const base = Math.max(0, converted - cd);
  const convertedTax = Math.floor(basicRateTax(base));
  const computed = years > 0 ? floor10(Math.floor((convertedTax * years) / 12)) : 0;
  const incomeTax = irpDeferred ? 0 : computed;
  const localTax = floor10(incomeTax * 0.1);
  return { pay: p, years, serviceDeduction: sd, converted, convertedDeduction: cd, base, convertedTax, incomeTax, localTax, net: p - incomeTax - localTax };
}
