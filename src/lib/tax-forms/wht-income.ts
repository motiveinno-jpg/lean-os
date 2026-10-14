// ── 원천세 소득 확장 — 일용근로·기타·이자·배당 (2026-10-14 세무 2차 4단계, docs/20261012_PLAN_tax_closing_v2.md 결정 262) ──
//
//   반올림은 사업소득(payment-batch businessIncome)과 같다 — 원 미만 절사, 소득세 1천원 미만이면 소액부징수(지방소득세도 0).
//   일용근로: 일당(비과세 뺀 것) − 근로소득공제 15만원 = 과세표준 × 6% = 산출세액 − 근로소득세액공제 55% → 날마다 따로(소득세법 47조·59조·134조).
//   기타소득: (지급액 − 필요경비) × 20%. 기타소득금액이 건별 5만원 이하면 과세최저한으로 0(소득세법 84조).
//   이자·배당: 지급액 × 14%(비영업대금 이익은 25% — 세율 칸에서 바꾼다). 법인에게 주는 이자는 법인세 원천징수라 신고서 칸이 다르다 → 화면에 적는다.
//   자동으로 못 푸는 것: 기타소득 필요경비율(강연료·원고료 60% 등)은 종류마다 달라 사람이 넣는다(기본 0). 기타소득 세부 코드(A41~)는 세무사.

export const DAILY_DEDUCTION = 150_000;
const fl = (n: number) => Math.floor(Number(n || 0));
const small = (it: number, lit: number) => (it < 1_000 ? { incomeTax: 0, localTax: 0 } : { incomeTax: it, localTax: lit });

/** 일용근로 하루치 원천세 */
export function dailyWageTax(dailyWage: number, nonTaxable = 0) {
  const taxable = Math.max(0, fl(dailyWage) - fl(nonTaxable));
  const base = Math.max(0, taxable - DAILY_DEDUCTION);
  const calc = fl(base * 0.06);
  const it = calc - fl(calc * 0.55);
  return { taxable, ...small(it, fl(it * 0.1)) };
}

export type IncomeKind = "other" | "interest" | "dividend";
export const INCOME_KIND_LABEL: Record<IncomeKind, string> = { other: "기타소득", interest: "이자소득", dividend: "배당소득" };
export const DEFAULT_RATE: Record<IncomeKind, number> = { other: 20, interest: 14, dividend: 14 };
export const OTHER_MIN = 50_000;   // 기타소득 과세최저한(건별 기타소득금액)

/** 기타·이자·배당 원천세 — 기타소득은 필요경비를 빼고 과세최저한을 본다 */
export function incomeTax(kind: IncomeKind, amount: number, necessaryExpense: number, ratePct: number) {
  const income = Math.max(0, fl(amount) - (kind === "other" ? fl(necessaryExpense) : 0));
  if (kind === "other" && income <= OTHER_MIN) return { income, incomeTax: 0, localTax: 0, exempt: true };
  const it = fl(income * ratePct / 100);
  return { income, ...small(it, fl(it * 0.1)), exempt: false };
}

export type DailyLog = { id: string; employee_id: string | null; employee_name: string; work_date: string; paid_on: string; daily_wage: number; non_taxable: number; income_tax: number; local_tax: number; memo: string | null };
export type IncomePayment = { id: string; payee_name: string; payee_kind: "person" | "corp"; income_kind: IncomeKind; sub_kind: string | null; paid_on: string; amount: number; necessary_expense: number; tax_rate: number; income_tax: number; local_tax: number; memo: string | null };

/** 신고서 칸 집계 — 인원은 사람 수(일용은 직원, 지급 기록은 받는 사람 이름) */
export function whtIncomeAgg(daily: DailyLog[], pays: IncomePayment[]) {
  const d = {
    n: new Set(daily.map((x) => x.employee_id || x.employee_name)).size,
    pay: daily.reduce((s, x) => s + Math.max(0, x.daily_wage - x.non_taxable), 0),
    tax: daily.reduce((s, x) => s + x.income_tax, 0), local: daily.reduce((s, x) => s + x.local_tax, 0),
  };
  const by = (k: IncomeKind) => {
    const r = pays.filter((x) => x.income_kind === k && x.payee_kind === "person");
    return { n: new Set(r.map((x) => x.payee_name)).size, pay: r.reduce((s, x) => s + x.amount, 0), tax: r.reduce((s, x) => s + x.income_tax, 0), local: r.reduce((s, x) => s + x.local_tax, 0) };
  };
  return { daily: d, other: by("other"), interest: by("interest"), dividend: by("dividend"), corpCount: pays.filter((x) => x.payee_kind === "corp").length };
}
