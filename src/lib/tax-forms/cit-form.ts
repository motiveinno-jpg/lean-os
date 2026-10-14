// ── 법인세 과세표준 및 세액신고 — 신고본 마감용 칸 (2026-10-14 세무 2차 후속, 사장님 "법인세도 마감할 수 있어야") ──
//
//   History: 세무 3차(2026-08-31, 결정 104)는 법인세를 '예상치 + 세무사 패키지'까지로 그었다 — 세무조정은 세무사가 한다.
//   그래서 마감은 오너뷰 계산을 고정하는 게 아니라 **세무사가 확정한 신고 숫자**를 남기는 일이다. 오너뷰 계산은 기본값(고칠 수 있다)이다.
//   다음 해로 넘어가는 것(세무 이월, 결정 265 확장): 차기 이월결손금 잔액 · 다음 해 중간예납 기준액 → 다음 해 신고본의 기본값.
//   기준(무엇으로 판단하나): 사업연도 = 회계연도(12월 결산). 중간예납 = (직전 산출세액 − 공제·감면 − 원천납부) × 6/12(법인세법 63조 — 가산세 제외).
//   자동으로 못 푸는 것: 세무조정 항목 전부(감가상각 한도·대손·충당금 등), 이월결손금 공제 한도(중소기업 100%, 일반 80% — 회사 구분은 사람),
//   공제·감면(R&D·고용증대 등). 사람 칸으로 받는다.

import type { FormFigures } from "./vat-form";

//   법인세 세율 구간 (2023년 개정 후) — 결정 104. 지방소득세는 산출세액의 10%(구간세율 0.9~2.4%와 같다).
//   ⚠️ 세율이 바뀌면 여기 상수를 고친다 — 화면에 '2026년 세율 기준'을 적어 어긋남이 보이게 한다.
export const CIT_BRACKETS = [
  { upTo: 200_000_000, rate: 0.09, label: "2억 이하" },
  { upTo: 20_000_000_000, rate: 0.19, label: "2억 초과 ~ 200억" },
  { upTo: 300_000_000_000, rate: 0.21, label: "200억 초과 ~ 3,000억" },
  { upTo: Infinity, rate: 0.24, label: "3,000억 초과" },
] as const;
export function citOf(base: number): { brackets: { label: string; rate: number; amt: number; tax: number }[]; total: number } {
  if (base <= 0) return { brackets: [], total: 0 };
  const brackets: { label: string; rate: number; amt: number; tax: number }[] = [];
  let prev = 0, total = 0;
  for (const b of CIT_BRACKETS) {
    const amt = Math.min(base, b.upTo) - prev;
    if (amt <= 0) break;
    const tax = Math.floor((amt * Math.round(b.rate * 100)) / 100);   // 정수 백분율로 — 소수 곱셈 오차로 1원이 빠지지 않게
    brackets.push({ label: b.label, rate: b.rate, amt, tax });
    total += tax;
    prev = b.upTo;
  }
  return { brackets, total };
}

/** 서식 칸 — manual = 사람(세무사 확정 숫자), 나머지는 계산 */
export const CIT_LINES: { key: string; label: string; manual?: boolean; sub?: string }[] = [
  { key: "N", label: "결산서상 당기순손익", sub: "확정 전표" },
  { key: "ADD", label: "+ 익금산입·손금불산입", manual: true, sub: "기본값 = 법인세비용 + 기업업무추진비 한도초과" },
  { key: "SUB", label: "− 손금산입·익금불산입", manual: true },
  { key: "INC", label: "각 사업연도 소득금액" },
  { key: "LOSS", label: "− 이월결손금 공제", manual: true, sub: "기본값 = 전기 이월결손금 잔액 한도" },
  { key: "EXEMPT", label: "− 비과세소득", manual: true },
  { key: "DED", label: "− 소득공제", manual: true },
  { key: "BASE", label: "과세표준" },
  { key: "CALC", label: "산출세액", sub: "구간세율" },
  { key: "CREDIT", label: "− 공제·감면세액", manual: true },
  { key: "PEN", label: "+ 가산세", manual: true },
  { key: "TOTAL", label: "총부담세액" },
  { key: "PRE_INTERIM", label: "− 기납부: 중간예납세액", manual: true, sub: "기본값 = 전기 신고본의 중간예납 기준액" },
  { key: "PRE_WHT", label: "− 기납부: 원천납부세액", manual: true, sub: "이자 등에서 떼인 법인세" },
  { key: "PAY", label: "차감 납부할 세액 (음수 = 환급)" },
  { key: "LOCAL", label: "법인지방소득세 (참고 · 산출세액의 10%)" },
  { key: "PRIOR_LOSS", label: "전기 이월결손금 잔액", sub: "전기 신고본에서" },
  { key: "NEW_LOSS", label: "당기 결손금 발생" },
  { key: "LOSS_BAL", label: "차기 이월결손금 잔액 → 다음 해" },
  { key: "NEXT_INTERIM", label: "다음 해 중간예납 기준액 → 다음 해 8/31" },
];

const r0 = (n: unknown) => Math.round(Number(n || 0));
const amt = (m: FormFigures, k: string) => r0(m?.[k]?.amount);

/** ctx: 당기순손익(확정 전표) · 전기 이월결손금 잔액(전기 신고본) */
export function computeCitForm(ctx: { netIncome: number; priorLoss: number }, manual: FormFigures = {}): FormFigures {
  const F: FormFigures = {};
  const set = (k: string, v: number) => { F[k] = { amount: Math.round(v) }; };
  for (const l of CIT_LINES) if (l.manual) set(l.key, amt(manual, l.key));
  set("N", ctx.netIncome);
  set("INC", r0(F.N.amount) + r0(F.ADD.amount) - r0(F.SUB.amount));
  const inc = r0(F.INC.amount);
  set("BASE", Math.max(0, inc - r0(F.LOSS.amount) - r0(F.EXEMPT.amount) - r0(F.DED.amount)));
  const calc = citOf(r0(F.BASE.amount)).total;
  set("CALC", calc);
  set("TOTAL", Math.max(0, calc - r0(F.CREDIT.amount)) + r0(F.PEN.amount));
  set("PAY", r0(F.TOTAL.amount) - r0(F.PRE_INTERIM.amount) - r0(F.PRE_WHT.amount));
  set("LOCAL", Math.floor(calc * 0.1));
  set("PRIOR_LOSS", Math.max(0, ctx.priorLoss));
  set("NEW_LOSS", Math.max(0, -inc));
  set("LOSS_BAL", Math.max(0, ctx.priorLoss - r0(F.LOSS.amount)) + Math.max(0, -inc));
  set("NEXT_INTERIM", Math.max(0, Math.floor((calc - r0(F.CREDIT.amount) - r0(F.PRE_WHT.amount)) / 2)));
  return F;
}
