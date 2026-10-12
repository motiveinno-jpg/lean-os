// ── 원천징수이행상황신고서 칸 (2026-10-12 세무 2차 1단계, 결정 260) ──
//
//   소득코드는 국세청 서식(원천징수 사무처리규정 별지 제21호) 그대로. 지금 오너뷰가 자동으로 채우는 칸은
//   근로 간이세액(A01)·퇴직 그 외(A22)·사업 매월징수(A25)와 각 가감계·총합계(A99) — 계산은 세무 신고 화면(T)과 같다.
//   일용(A03)·기타(A4x)·이자(A50)·배당(A60)은 4단계(결정 262)에서 자료가 생기면 채운다. 그전엔 0 으로 보인다.

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
  { code: "A40", group: "기타소득", label: "가감계", sum: true },
  { code: "A50", group: "이자소득", label: "이자소득" },
  { code: "A60", group: "배당소득", label: "배당소득" },
  { code: "A99", group: "총합계", label: "총합계", sum: true },
];

type Agg = { n: number; pay: number; tax: number };

/** 세무 신고 화면의 집계(T) → 서식 칸. 인원(n)·총지급액(amount)·소득세(tax) */
export function computeWhtForm(t: { work: Agg; biz: Agg; ret: Agg }): FormFigures {
  const z = { amount: 0, tax: 0, n: 0 };
  const c = (a: Agg) => ({ n: a.n, amount: Math.round(a.pay), tax: Math.round(a.tax) });
  const F: FormFigures = {};
  for (const l of WHT_LINES) F[l.code] = { ...z };
  F.A01 = c(t.work); F.A10 = c(t.work);
  F.A22 = c(t.ret); F.A20 = c(t.ret);
  F.A25 = c(t.biz); F.A30 = c(t.biz);
  const tot = [t.work, t.ret, t.biz];
  F.A99 = { n: tot.reduce((s, a) => s + a.n, 0), amount: tot.reduce((s, a) => s + Math.round(a.pay), 0), tax: tot.reduce((s, a) => s + Math.round(a.tax), 0) };
  return F;
}
