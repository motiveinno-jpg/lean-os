// ── 원천징수이행상황신고서 칸 (2026-10-12 세무 2차 1단계, 결정 260) ──
//
//   소득코드는 국세청 서식(원천징수 사무처리규정 별지 제21호) 그대로. 지금 오너뷰가 자동으로 채우는 칸은
//   근로 간이세액(A01)·퇴직 그 외(A22)·사업 매월징수(A25)와 각 가감계·총합계(A99) — 계산은 세무 신고 화면(T)과 같다.
//   일용(A03)·기타(A42·A40)·이자(A50)·배당(A60)은 4단계(2026-10-14)부터 일용 근무 기록·지급 기록으로 채운다.

import type { FormFigures } from "./vat-form";

export type WhtLine = { code: string; group: string; label: string; sum?: boolean };

export const WHT_LINES: WhtLine[] = [
  { code: "A01", group: "근로소득", label: "간이세액" },
  { code: "A02", group: "근로소득", label: "중도퇴사" },
  { code: "A03", group: "근로소득", label: "일용근로" },
  { code: "A04", group: "근로소득", label: "연말정산" },
  { code: "A10", group: "근로소득", label: "가감계", sum: true },
  { code: "A21", group: "퇴직소득", label: "연금계좌" },
  { code: "A22", group: "퇴직소득", label: "그 외" },
  { code: "A20", group: "퇴직소득", label: "가감계", sum: true },
  { code: "A25", group: "사업소득", label: "매월징수" },
  { code: "A26", group: "사업소득", label: "연말정산" },
  { code: "A30", group: "사업소득", label: "가감계", sum: true },
  { code: "A41", group: "기타소득", label: "연금계좌" },
  { code: "A42", group: "기타소득", label: "그 외" },
  { code: "A40", group: "기타소득", label: "가감계", sum: true },
  { code: "A50", group: "이자소득", label: "이자소득" },
  { code: "A60", group: "배당소득", label: "배당소득" },
  { code: "A99", group: "총합계", label: "총합계", sum: true },
];

type Agg = { n: number; pay: number; tax: number };

/** 세무 신고 화면의 집계(T) → 서식 칸. 인원(n)·총지급액(amount)·소득세(tax)
 *  4단계(2026-10-14): 일용(A03)·기타(A42·A40)·이자(A50)·배당(A60) — 일용 근무 기록·지급 기록에서. A10 = A01 + A03 */
export function computeWhtForm(t: { work: Agg; biz: Agg; ret: Agg; daily?: Agg; other?: Agg; interest?: Agg; dividend?: Agg }): FormFigures {
  const z0: Agg = { n: 0, pay: 0, tax: 0 };
  const c = (a: Agg) => ({ n: a.n, amount: Math.round(a.pay), tax: Math.round(a.tax) });
  const plus = (...xs: Agg[]): Agg => ({ n: xs.reduce((s, a) => s + a.n, 0), pay: xs.reduce((s, a) => s + a.pay, 0), tax: xs.reduce((s, a) => s + a.tax, 0) });
  const daily = t.daily || z0, other = t.other || z0, interest = t.interest || z0, dividend = t.dividend || z0;
  const F: FormFigures = {};
  for (const l of WHT_LINES) F[l.code] = { amount: 0, tax: 0, n: 0 };
  F.A01 = c(t.work); F.A03 = c(daily); F.A10 = c(plus(t.work, daily));
  F.A22 = c(t.ret); F.A20 = c(t.ret);
  F.A25 = c(t.biz); F.A30 = c(t.biz);
  F.A42 = c(other); F.A40 = c(other); F.A50 = c(interest); F.A60 = c(dividend);
  F.A99 = c(plus(t.work, daily, t.ret, t.biz, other, interest, dividend));
  return F;
}
