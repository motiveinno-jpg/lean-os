// 프로젝트 금액의 VAT 기준 — 한 곳에서만 정한다.
//
// 배경 (2026-08-03 사장님 결정):
//   "발행·입금을 VAT 포함 기준으로 통일한다. 다만 금액 입력 시 VAT 포함/별도를 고를 수 있게 하고,
//    최종 표기는 VAT 합산으로."
//
// 사실 관계
//   · deals.contract_total 은 **공급가(VAT 별도)로 저장**된다. 입력 폼에서 'VAT포함'을 고르면
//     저장 직전에 ÷1.1 해서 공급가로 환산한다(기존 동작, 2026-07-30 이전부터).
//   · tax_invoices.total_amount 는 **VAT 포함 총액**, supply_amount 가 공급가다.
//   → 그래서 계약(공급가)과 발행(총액)을 같은 축에 나란히 두면 "계약보다 더 발행했다"로
//     잘못 읽혔다(실제 사례: A커머스 계약 1,200만 vs 발행 1,320만 = 같은 금액인데 달라 보임).
//
// 규칙
//   · **화면에 보이는 금액은 VAT 포함**으로 맞춘다(계약·발행·입금·미수).
//   · **마진·원가율 계산은 공급가(net) 기준**을 유지한다 — 회계가 그렇게 본다.
//     그 화면에는 '공급가 기준'이라고 명시한다.

export const VAT_RATE = 0.1;

/** 공급가 → VAT 포함 총액 */
export function incVat(net: number | null | undefined): number {
  return Math.round(Number(net || 0) * (1 + VAT_RATE));
}

/** VAT 포함 총액 → 공급가 */
export function netFromInc(total: number | null | undefined): number {
  return Math.round(Number(total || 0) / (1 + VAT_RATE));
}

/** 계약금액을 화면 표기용(VAT 포함)으로. 저장값은 공급가이므로 여기서 한 번만 환산한다. */
export function contractIncVat(contractTotal: number | null | undefined): number {
  return incVat(contractTotal);
}
