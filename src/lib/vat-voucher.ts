// 매입매출전표 — 부가세 유형이 분개를 정한다 (2026-08-11 사장님 지시로 신설).
//
//   회사가 실제로 치는 전표의 대부분은 세금계산서·카드·현금영수증에서 시작하고,
//   그건 유형(과세/영세/면세/불공제)에 따라 **분개도 부가세 신고서도 이미 정해져 있다**.
//   그래서 화면보다 이 규칙을 먼저 만든다 — 여기가 이 기능의 심장이다.
//
//   손으로 치는 건 유형·거래처·금액뿐이고, 아래 buildVoucherLines 가 분개를 만든다.
//   만들어진 줄은 화면에서 고칠 수 있다(계정만 회사 사정에 맞게).

/** 부가세 유형 — 국세청 신고서 줄과 1:1 로 맞는 코드 */
export type VatSide = "sale" | "purchase";

export interface VatType {
  code: string;            // "11" · "51" …
  label: string;           // 화면 표기
  side: VatSide;
  /** 세액이 붙는가 (영세·면세는 false) */
  taxed: boolean;
  /** 매입세액을 공제받는가 (불공제 54 는 false — 세액을 비용에 얹는다) */
  deductible: boolean;
  hint: string;            // 언제 쓰는지
  /** 이 유형에서 가장 흔한 결제 방법 */
  defaultSettle: SettleType;
}

/** 분개유형 — 상대 계정(돈이 오간 쪽)을 정한다 */
export type SettleType = "cash" | "credit" | "mixed" | "card";
export const SETTLE_LABEL: Record<SettleType, string> = {
  cash: "1. 현금", credit: "2. 외상", mixed: "3. 혼합", card: "4. 카드",
};

//   실무에서 쓰는 것만 앞에 둔다. 나머지 코드는 필요해질 때 추가한다.
export const VAT_TYPES: VatType[] = [
  { code: "11", label: "11. 과세매출", side: "sale", taxed: true, deductible: false, hint: "세금계산서 발행", defaultSettle: "credit" },
  { code: "12", label: "12. 영세매출", side: "sale", taxed: false, deductible: false, hint: "영세율 계산서", defaultSettle: "credit" },
  { code: "13", label: "13. 면세매출", side: "sale", taxed: false, deductible: false, hint: "계산서(면세)", defaultSettle: "credit" },
  { code: "17", label: "17. 카드과세매출", side: "sale", taxed: true, deductible: false, hint: "카드 매출", defaultSettle: "credit" },
  { code: "22", label: "22. 현금과세매출", side: "sale", taxed: true, deductible: false, hint: "현금영수증 매출", defaultSettle: "cash" },
  { code: "51", label: "51. 과세매입", side: "purchase", taxed: true, deductible: true, hint: "매입 세금계산서", defaultSettle: "credit" },
  { code: "53", label: "53. 면세매입", side: "purchase", taxed: false, deductible: false, hint: "계산서(면세) 수취", defaultSettle: "credit" },
  { code: "54", label: "54. 불공제매입", side: "purchase", taxed: true, deductible: false, hint: "접대비·비영업용 차량 등", defaultSettle: "credit" },
  { code: "57", label: "57. 카드과세매입", side: "purchase", taxed: true, deductible: true, hint: "법인카드 사용", defaultSettle: "card" },
  { code: "61", label: "61. 현금과세매입", side: "purchase", taxed: true, deductible: true, hint: "현금영수증 수취", defaultSettle: "cash" },
];

export const vatType = (code: string | null | undefined): VatType | null =>
  VAT_TYPES.find((t) => t.code === String(code || "")) || null;

/** 유형별 세액 — 영세·면세는 0. 불공제(54)는 세액이 있지만 공제를 못 받을 뿐이다. */
export function vatOf(code: string, supply: number): number {
  const t = vatType(code);
  if (!t || !t.taxed) return 0;
  return Math.round(supply * 0.1);
}

/* ------------------------------------------------------------------ */
/*  표준 계정 코드 — 회사 계정과목표에서 코드로 찾는다                    */
/* ------------------------------------------------------------------ */
export const STD = {
  bank: "101",        // 보통예금
  ar: "108",          // 외상매출금
  vatIn: "135",       // 부가세대급금
  ap: "251",          // 외상매입금
  payable: "253",     // 미지급금 (카드사 포함)
  vatOut: "255",      // 부가세예수금
  sales: "404",       // 제품매출
} as const;

/** 만들어진 분개 한 줄 — 화면이 그대로 표에 그린다 */
export interface DraftLine {
  side: "debit" | "credit";
  /** 표준 계정 코드. 회사 계정과목표에 없으면 화면이 직접 고르게 비워 둔다 */
  code: string | null;
  /** 사람이 읽는 이름 (계정과목표에서 찾기 전 임시 표기) */
  name: string;
  amount: number;
  /** 유형이 정한 줄인가 — 부가세 줄은 함부로 지우면 신고가 틀어진다 */
  locked?: boolean;
}

export interface BuildInput {
  vatCode: string;
  settle: SettleType;
  /** 공급가액 합계 (품목 줄 합) */
  supply: number;
  /** 세액 — 안 주면 유형에서 계산 */
  vat?: number;
  /** 매출계정 / 매입비용계정 — 회사가 고른 것 (없으면 표준값) */
  mainCode?: string | null;
  mainName?: string | null;
}

/**
 * 유형 + 분개유형 → 분개 줄.
 *
 *   매출: 차) 상대계정(합계)            / 대) 매출(공급가) + 부가세예수금(세액)
 *   매입: 차) 비용(공급가) + 부가세대급금 / 대) 상대계정(합계)
 *   불공제(54): 세액을 **비용에 얹고** 부가세대급금 줄을 만들지 않는다.
 */
export function buildVoucherLines(input: BuildInput): DraftLine[] {
  const t = vatType(input.vatCode);
  const supply = Math.round(Number(input.supply) || 0);
  if (!t || supply <= 0) return [];
  const vat = input.vat != null ? Math.round(input.vat) : vatOf(t.code, supply);
  const total = supply + vat;

  //   상대 계정 — 돈이 오간 쪽. '혼합' 은 사람이 직접 고른다.
  const counter = (): DraftLine => {
    const asDebit = t.side === "sale";
    const pick = (code: string | null, name: string): DraftLine => ({
      side: asDebit ? "debit" : "credit", code, name, amount: total,
    });
    switch (input.settle) {
      case "cash": return pick(STD.bank, "보통예금");
      case "card": return pick(STD.payable, "미지급금");
      case "mixed": return pick(null, "직접 지정");
      default: return t.side === "sale" ? pick(STD.ar, "외상매출금") : pick(STD.ap, "외상매입금");
    }
  };

  if (t.side === "sale") {
    const lines: DraftLine[] = [counter()];
    lines.push({ side: "credit", code: input.mainCode ?? STD.sales, name: input.mainName || "제품매출", amount: supply });
    if (vat > 0) lines.push({ side: "credit", code: STD.vatOut, name: "부가세예수금", amount: vat, locked: true });
    return lines;
  }

  //   매입 — 불공제는 세액까지 비용으로 (2026-08-11: 이 한 줄이 54 의 전부다)
  const costAmount = t.taxed && !t.deductible ? total : supply;
  const lines: DraftLine[] = [
    { side: "debit", code: input.mainCode ?? null, name: input.mainName || "비용 계정을 고르세요", amount: costAmount },
  ];
  if (vat > 0 && t.deductible) {
    lines.push({ side: "debit", code: STD.vatIn, name: "부가세대급금", amount: vat, locked: true });
  }
  lines.push(counter());
  return lines;
}

/* ------------------------------------------------------------------ */
/*  증빙 → 추천 유형                                                    */
/* ------------------------------------------------------------------ */
//   접대·유흥은 매입세액을 못 받는다 — 카드 내역에서 가장 자주 틀리는 자리라 규칙으로 잡아 준다.
const NON_DEDUCTIBLE_HINTS = ["접대", "유흥", "골프", "주점", "노래", "클럽", "룸", "상품권"];

export function suggestVatType(src: {
  kind: "tax_invoice" | "card" | "cash_receipt";
  direction: "sale" | "purchase";
  taxKind?: string | null;          // taxable · zero_rated · exempt
  memo?: string | null;             // 가맹점·품목·비목 — 불공제 판정에 쓴다
}): string {
  const text = String(src.memo || "");
  const nonDeductible = NON_DEDUCTIBLE_HINTS.some((k) => text.includes(k));

  if (src.kind === "tax_invoice") {
    if (src.direction === "sale") {
      if (src.taxKind === "zero_rated") return "12";
      if (src.taxKind === "exempt") return "13";
      return "11";
    }
    if (src.taxKind === "exempt") return "53";
    return nonDeductible ? "54" : "51";
  }
  if (src.kind === "card") {
    if (src.direction === "sale") return "17";
    return nonDeductible ? "54" : "57";
  }
  return src.direction === "sale" ? "22" : "61";
}

/* ------------------------------------------------------------------ */
/*  부가세 신고 집계 — 유형별로 모은다                                   */
/* ------------------------------------------------------------------ */
export interface VatBucket { code: string; label: string; count: number; supply: number; vat: number; }

export function summarizeByVatType(
  rows: { vat_type: string | null; supply_amount: number | null; vat_amount: number | null }[],
): { sale: VatBucket[]; purchase: VatBucket[]; salesVat: number; purchaseVat: number; payable: number } {
  const map = new Map<string, VatBucket>();
  for (const r of rows) {
    const t = vatType(r.vat_type);
    if (!t) continue;
    const b = map.get(t.code) || { code: t.code, label: t.label, count: 0, supply: 0, vat: 0 };
    b.count++;
    b.supply += Number(r.supply_amount || 0);
    b.vat += Number(r.vat_amount || 0);
    map.set(t.code, b);
  }
  const all = Array.from(map.values()).sort((a, b) => a.code.localeCompare(b.code));
  const sale = all.filter((b) => vatType(b.code)!.side === "sale");
  const purchase = all.filter((b) => vatType(b.code)!.side === "purchase");
  const salesVat = sale.reduce((s, b) => s + b.vat, 0);
  //   불공제(54)는 낸 세액이지만 공제받지 못한다 — 납부액 계산에서 뺀다
  const purchaseVat = purchase.reduce((s, b) => s + (vatType(b.code)!.deductible ? b.vat : 0), 0);
  return { sale, purchase, salesVat, purchaseVat, payable: salesVat - purchaseVat };
}
