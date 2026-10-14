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

/** 환급세액 조정 (2026-10-14 세무 2차 7단계, 결정 265 세무 이월) — 서식 ⑫~⑳ + 납부할 소득세.
 *  ⑫ 전월 미환급세액 = 지난달 신고본 ⑳(차월이월)에서 기본값 · ⑬ 기환급 신청세액 = 사람 · ⑮ 당월 발생 환급 = 총합계 징수세액이 음수일 때 그 크기.
 *  ⑱ = ⑭ + ⑮ · ⑲ 당월 조정 = min(⑱, 이번 달 징수세액) · ⑳ 차월이월 = ⑱ − ⑲ · 납부할 소득세 = 징수세액 − ⑲.
 *  신탁재산(⑯)·금융회사/합병(⑰)·환급신청(㉑)은 쓰지 않는다(0) — 해당하면 세무사·홈택스. */
export const REFUND_LINES: { code: string; label: string; manual?: boolean }[] = [
  { code: "R12", label: "⑫ 전월 미환급세액", manual: true },
  { code: "R13", label: "⑬ 기환급 신청세액", manual: true },
  { code: "R14", label: "⑭ 차감 잔액 (⑫ − ⑬)" },
  { code: "R15", label: "⑮ 당월 발생 환급세액" },
  { code: "R18", label: "⑱ 조정대상 환급세액 (⑭ + ⑮)" },
  { code: "R19", label: "⑲ 당월 조정 환급세액" },
  { code: "R20", label: "⑳ 차월이월 환급세액 (⑱ − ⑲)" },
  { code: "PAY", label: "납부할 소득세 (징수세액 − ⑲)" },
];

/** 세무 신고 화면의 집계(T) → 서식 칸. 인원(n)·총지급액(amount)·소득세(tax)
 *  4단계(2026-10-14): 일용(A03)·기타(A42·A40)·이자(A50)·배당(A60) — 일용 근무 기록·지급 기록에서. A10 = A01 + A03 */
export function computeWhtForm(t: { work: Agg; biz: Agg; ret: Agg; daily?: Agg; other?: Agg; interest?: Agg; dividend?: Agg }, manual: FormFigures = {}): FormFigures {
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
  //   환급세액 조정 (7단계)
  const tax99 = Math.round(Number(F.A99.tax || 0));
  const r12 = Math.max(0, Math.round(Number(manual.R12?.tax || 0))), r13 = Math.max(0, Math.round(Number(manual.R13?.tax || 0)));
  const r14 = Math.max(0, r12 - r13), r15 = Math.max(0, -tax99), r18 = r14 + r15;
  const r19 = Math.min(r18, Math.max(0, tax99));
  F.R12 = { tax: r12 }; F.R13 = { tax: r13 }; F.R14 = { tax: r14 }; F.R15 = { tax: r15 }; F.R18 = { tax: r18 }; F.R19 = { tax: r19 };
  F.R20 = { tax: r18 - r19 }; F.PAY = { tax: Math.max(0, tax99) - r19 };
  return F;
}
