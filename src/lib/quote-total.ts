//   견적서·청구서 합계를 한 곳에서만 계산한다.
//
//   같은 견적서가 화면·문서함 PDF·프로젝트 PDF 에서 서로 다른 금액으로 나왔다:
//   · 화면 요약과 미리보기는 품목별 세액을 더하고 할인을 뺐다
//   · PDF 경로는 공급가액 합계에 일률적으로 10% 를 붙이고 할인을 아예 몰랐다
//     (면세·영세 품목이 섞인 견적서는 세액이 틀리고, 할인 100만원은 그냥 사라졌다)
//   거래처가 받는 종이와 화면의 금액이 달라지는 문제라, 계산을 여기 한 벌로 모은다.
//
//   ⚠️ 세액은 품목이 들고 있는 값을 쓴다. 합계 × 10% 로 되돌리지 말 것 —
//      면세·영세 품목과 섞이면 국세청에 나가는 금액이 틀어진다.

export type QuoteLine = {
  /** 공급가액. 화면은 supplyAmount, 옛 문서는 amount 로 저장돼 있다. */
  supplyAmount?: number | null;
  amount?: number | null;
  /** 품목별 세액. 없으면 과세로 보고 공급가액의 10% 로 채운다. */
  taxAmount?: number | null;
  /** 면세·영세면 true — 세액을 만들지 않는다. */
  taxFree?: boolean | null;
  name?: string | null;
};

export type QuoteTotals = {
  /** 공급가액 합계 */
  supply: number;
  /** 세액 합계 */
  tax: number;
  /** 할인액(양수) */
  discount: number;
  /** 거래처가 낼 금액 = 공급가액 + 세액 − 할인 */
  total: number;
};

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** 품목 한 줄의 공급가액 — 화면(supplyAmount)과 옛 저장값(amount) 둘 다 받는다. */
export function lineSupply(line: QuoteLine): number {
  return num(line?.supplyAmount ?? line?.amount ?? 0);
}

/**
 *  품목 한 줄의 세액. 줄에 적힌 값이 있으면 그대로, 없으면 과세로 보고 10%.
 *  면세·영세 표시가 있으면 0.
 */
export function lineTax(line: QuoteLine): number {
  if (line?.taxFree) return 0;
  if (line?.taxAmount != null && line.taxAmount !== ("" as unknown as number)) {
    return num(line.taxAmount);
  }
  return Math.round(lineSupply(line) * 0.1);
}

/** 견적서 합계. 할인은 음수로 들어와도 양수로 다룬다(빼는 값이라 부호가 두 번 뒤집히면 더해진다). */
export function quoteTotals(lines: QuoteLine[] | null | undefined, discount?: unknown): QuoteTotals {
  const list = Array.isArray(lines) ? lines : [];
  const supply = list.reduce((s, l) => s + lineSupply(l), 0);
  const tax = list.reduce((s, l) => s + lineTax(l), 0);
  const d = Math.abs(num(discount));
  return { supply, tax, discount: d, total: supply + tax - d };
}
