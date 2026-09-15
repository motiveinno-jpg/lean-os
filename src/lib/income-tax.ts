//   근로소득 간이세액(월) — 국세청 「근로소득 간이세액표」(소득세법 시행령 별표2) 원본을 그대로 조회한다.
//
//   예전엔 급여 엔진(payment-batch)이 12행짜리 근사표 + 직선 보간 + "부양가족 1인당 약 12,500원" 으로
//   소득세를 추정해 실제 원천징수액과 어긋났다. 공개 급여계산기는 이미 원본 표(ganyi-2026.json)를 썼는데
//   정작 직원 급여명세서는 근사표를 썼다 — 같은 표 하나를 두 곳이 쓰도록 여기로 모은다.
//
//   표 구조(ganyi-2026.json): rows=[하한, 상한, 가족1..11 세액](천원 단위) · anchor10000=1,000만원 행 ·
//   high=1,000만원 초과 구간 산식. 자녀세액공제(8~20세)는 주3, 11명 초과는 주4 규칙.

import TABLE from "@/lib/data/ganyi-2026.json";

type GanyiTable = {
  revision: string;
  rows: number[][];
  anchor10000: number[];
  high: { upto: number | null; base: number; over: number; mul: number; rate: number; plus: number }[];
};

const T = TABLE as GanyiTable;

/** 이 표의 개정일자(예: "2026-02-27"). 화면 각주에 쓴다. */
export const INCOME_TAX_TABLE_REVISION = T.revision;

/**
 * 근로소득 간이세액(월). 원천징수 100% 선택 기준.
 * @param taxablePay 과세대상 월급여(원) — 비과세(식대 등) 제외한 보수월액
 * @param family     공제대상 가족수(본인 포함)
 * @param children   8~20세 자녀수(자녀세액공제). 모르면 0.
 */
export function simplifiedIncomeTax(taxablePay: number, family: number, children = 0): number {
  const k = taxablePay / 1000; // 천원
  const famAt = (rowVals: number[], n: number) => {
    if (n <= 11) return rowVals[Math.min(11, Math.max(1, n)) - 1];
    // 주4: 11명 초과 — t11 − (t10 − t11) × 초과 가족수
    return Math.max(0, rowVals[10] - (rowVals[9] - rowVals[10]) * (n - 11));
  };
  let tax = 0;
  if (k < T.rows[0][0]) tax = 0;
  else if (k < 10000) {
    const row = T.rows.find((r) => k >= r[0] && k < r[1]);
    tax = row ? famAt(row.slice(2), family) : 0;
  } else {
    const anchor = famAt(T.anchor10000, family);
    if (k === 10000) tax = anchor;
    else {
      const band = T.high.find((b) => b.upto === null || k <= b.upto)!;
      tax = anchor + band.base + Math.floor((k - band.over) * 1000 * band.mul * band.rate) + band.plus;
    }
  }
  // 주3: 8~20세 자녀 세액공제(월정액)
  const cc = children <= 0 ? 0 : children === 1 ? 20830 : children === 2 ? 45830 : 45830 + (children - 2) * 33330;
  return Math.max(0, tax - cc);
}
