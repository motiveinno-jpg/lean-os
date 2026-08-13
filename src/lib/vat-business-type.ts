/**
 * 회사 과세유형 — **무엇을 발행할 수 있는지**를 정하는 단 하나의 기준. (2026-08-13 사장님 지시)
 *
 *   ★ 왜 필요한가: 발행 폼에는 과세/영세율/면세를 고르는 칸이 예전부터 있었는데,
 *     회사가 무슨 사업자인지는 아무도 안 봤다. 광고대행(전부 과세)인 모티브이노베이션에서
 *     '면세'를 골라 **전자계산서를 발행할 수 있었다.** 발행하면 안 되는 문서다.
 *
 *   기준 세 가지 — 왜 '면세사업자만'이 아니라 셋인가:
 *     · 과세(taxable)  — 세금계산서·영세율. 계산서는 못 낸다.
 *     · 면세(exempt)   — 계산서만. 세금계산서를 낼 수 없다(부가세를 받지 않으므로).
 *     · 겸영(both)     — 둘 다. **과세사업자도 면세 재화·용역을 공급하면 계산서를 발행해야 한다.**
 *       "면세사업자만"으로 못박으면 겸영 고객이 계산서를 영영 못 낸다.
 *
 *   ★ 국세청 조회로는 겸영을 알 수 없다(일반과세자로 나온다). 그래서 조회값은 **기본값 제안**까지만이고
 *     최종 판단은 사람이 회사정보에서 고른다 — 이 저장소 원칙 그대로 "제안은 자동, 확정은 사람".
 *
 *   저장 위치는 `companies.tax_settings.vat_type` (jsonb). 전용 컬럼을 새로 파지 않은 이유는
 *   자본금·알림 이메일이 이미 같은 칸에 있고, 이 값을 읽는 곳이 회사 한 줄을 통째로 읽기 때문이다.
 */

export type VatBusinessType = "taxable" | "exempt" | "both";

/** 계산서 한 장의 과세형태 — tax_invoices.tax_kind */
export type TaxKind = "taxable" | "zero_rated" | "exempt";

export const VAT_BUSINESS_TYPES: { value: VatBusinessType; label: string; desc: string }[] = [
  { value: "taxable", label: "과세사업자", desc: "세금계산서를 발행합니다 (계산서는 발행할 수 없습니다)" },
  { value: "exempt", label: "면세사업자", desc: "계산서만 발행합니다 (세금계산서를 발행할 수 없습니다)" },
  { value: "both", label: "과세 + 면세 겸영", desc: "세금계산서와 계산서를 모두 발행합니다" },
];

/** 회사의 과세유형 — 안 정해 뒀으면 과세로 본다(지금 쓰는 회사가 전부 과세라 이게 안전한 쪽이다) */
export function vatBusinessTypeOf(taxSettings: unknown): VatBusinessType {
  const v = (taxSettings as { vat_type?: unknown } | null)?.vat_type;
  return v === "exempt" || v === "both" ? v : "taxable";
}

/** 이 회사가 이 과세형태의 문서를 낼 수 있나 */
export function canIssueTaxKind(vbt: VatBusinessType, kind: TaxKind): boolean {
  if (vbt === "both") return true;
  //   면세사업자는 계산서만. 영세율은 과세사업자의 수출 등이라 면세 쪽이 아니다.
  if (vbt === "exempt") return kind === "exempt";
  return kind !== "exempt";
}

/** 못 내는 이유 — 화면에도 서버 오류에도 같은 문장을 쓴다 */
export function taxKindBlockedReason(vbt: VatBusinessType, kind: TaxKind): string | null {
  if (canIssueTaxKind(vbt, kind)) return null;
  return kind === "exempt"
    ? "면세 계산서는 면세사업자(또는 겸영)만 발행할 수 있습니다 — 회사설정 › 회사정보에서 과세유형을 확인해 주세요."
    : "면세사업자는 세금계산서를 발행할 수 없습니다 — 회사설정 › 회사정보에서 과세유형을 확인해 주세요.";
}

/**
 * 국세청 사업자상태 조회의 `tax_type` 문구로 기본값을 **제안**한다.
 *   실제 응답 예: "부가가치세 일반과세자" / "부가가치세 간이과세자" / "부가가치세 면세사업자"
 *   비영리·고유번호 단체 등은 판단할 수 없어 null 을 준다 — 모르면 제안하지 않는다.
 */
export function guessVatBusinessType(ntsTaxType?: string | null): VatBusinessType | null {
  const s = String(ntsTaxType || "");
  if (!s) return null;
  if (s.includes("면세")) return "exempt";
  if (s.includes("일반과세") || s.includes("간이과세")) return "taxable";
  return null;
}
