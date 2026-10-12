// ── 일반과세자 부가가치세 신고서 칸 계산 (2026-10-12 세무 2차 1단계, docs/20261012_PLAN_tax_closing_v2.md 결정 260) ──
//
//   기준은 VatReturn 과 같다 — **확정 매입매출전표**의 부가세 유형(결정 60). 칸 번호는 국세청 서식(부가가치세법 시행규칙 별지 제21호) 그대로.
//   자동으로 못 채우는 칸(예정신고 누락분·대손세액·예정고지세액·가산세 등)은 사람이 넣는 값(manual)으로 받는다.
//   ⑰ 공제받지 못할 매입세액(54)은 ⑩ 세금계산서 수취분에 넣었다가 ⑰에서 뺀다(서식 작성요령). 납부세액은 전과 같다.
//   ㉓ 예정신고 미환급세액은 같은 해 예정 신고본(마감한 숫자)에서 읽어 기본값으로 채운다 — 세무 이월(결정 265).

/** assetCat — 차변이 고정자산 계정(202~240)인 전표(2단계, vat-schedules.assetCatOf). ⑫ 고정자산 매입을 가른다 */
export type VatFormRow = { vat_type: string | null; supply_amount: number; vat_amount: number; assetCat?: string | null };
/** 신고서 한 칸 — 금액·세액(+원천세는 인원) */
export type FormCell = { amount?: number; tax?: number; n?: number };
export type FormFigures = Record<string, FormCell>;

/** 칸 정의 — kind: auto(전표) · manual(사람) · sum(계산) */
export type VatLine = {
  no: string; label: string; group: "sale" | "buy" | "pay" | "reduce" | "etc";
  sub?: string; rate?: string; fields: ("amount" | "tax")[];
  kind: "auto" | "manual" | "sum"; hint?: string;
};

export const VAT_LINES: VatLine[] = [
  { no: "1", group: "sale", sub: "과세", label: "세금계산서 발급분", rate: "10/100", fields: ["amount", "tax"], kind: "auto", hint: "유형 11" },
  { no: "2", group: "sale", sub: "과세", label: "매입자발행 세금계산서", rate: "10/100", fields: ["amount", "tax"], kind: "manual" },
  { no: "3", group: "sale", sub: "과세", label: "신용카드·현금영수증 발행분", rate: "10/100", fields: ["amount", "tax"], kind: "auto", hint: "유형 17·22" },
  { no: "4", group: "sale", sub: "과세", label: "기타(정규영수증 외 매출분)", rate: "10/100", fields: ["amount", "tax"], kind: "manual" },
  { no: "5", group: "sale", sub: "영세", label: "세금계산서 발급분", rate: "0/100", fields: ["amount"], kind: "auto", hint: "유형 12" },
  { no: "6", group: "sale", sub: "영세", label: "기타", rate: "0/100", fields: ["amount"], kind: "manual" },
  { no: "7", group: "sale", label: "예정신고 누락분", fields: ["amount", "tax"], kind: "manual" },
  { no: "8", group: "sale", label: "대손세액 가감", fields: ["tax"], kind: "manual" },
  { no: "9", group: "sale", label: "합계", rate: "㉮", fields: ["amount", "tax"], kind: "sum" },
  { no: "10", group: "buy", sub: "세금계산서 수취분", label: "일반매입", fields: ["amount", "tax"], kind: "auto", hint: "유형 51·54 − ⑫" },
  { no: "11", group: "buy", sub: "세금계산서 수취분", label: "수출기업 수입분 납부유예", fields: ["amount", "tax"], kind: "manual" },
  { no: "12", group: "buy", sub: "세금계산서 수취분", label: "고정자산 매입", fields: ["amount", "tax"], kind: "auto", hint: "유형 51 · 고정자산 계정" },
  { no: "13", group: "buy", label: "예정신고 누락분", fields: ["amount", "tax"], kind: "manual" },
  { no: "14", group: "buy", label: "매입자발행 세금계산서", fields: ["amount", "tax"], kind: "manual" },
  { no: "15", group: "buy", label: "그 밖의 공제매입세액", fields: ["amount", "tax"], kind: "auto", hint: "유형 57·61" },
  { no: "16", group: "buy", label: "합계 (10)−(11)+(12)+(13)+(14)+(15)", fields: ["amount", "tax"], kind: "sum" },
  { no: "17", group: "buy", label: "공제받지 못할 매입세액", fields: ["amount", "tax"], kind: "auto", hint: "유형 54" },
  { no: "18", group: "buy", label: "차감계 (16)−(17)", rate: "㉯", fields: ["amount", "tax"], kind: "sum" },
  { no: "da", group: "pay", label: "납부(환급)세액 (매출세액㉮ − 매입세액㉯)", rate: "㉰", fields: ["tax"], kind: "sum" },
  { no: "19", group: "reduce", label: "그 밖의 경감·공제세액", fields: ["tax"], kind: "manual" },
  { no: "20", group: "reduce", label: "신용카드매출전표등 발행공제 등", fields: ["amount", "tax"], kind: "manual", hint: "개인사업자만" },
  { no: "21", group: "reduce", label: "합계", rate: "㉱", fields: ["tax"], kind: "sum" },
  { no: "22", group: "etc", label: "소규모 개인사업자 부가가치세 감면세액", rate: "㉲", fields: ["tax"], kind: "manual" },
  { no: "23", group: "etc", label: "예정신고 미환급세액", rate: "㉳", fields: ["tax"], kind: "manual", hint: "확정 신고 — 예정 신고본에서 채움" },
  { no: "24", group: "etc", label: "예정고지세액", rate: "㉴", fields: ["tax"], kind: "manual" },
  { no: "25", group: "etc", label: "수시부과세액", rate: "㉵", fields: ["tax"], kind: "manual" },
  { no: "26", group: "etc", label: "사업양수자가 대리납부한 세액", rate: "㉶", fields: ["tax"], kind: "manual" },
  { no: "27", group: "etc", label: "매입자 납부특례에 따라 납부한 세액", rate: "㉷", fields: ["tax"], kind: "manual" },
  { no: "28", group: "etc", label: "신용카드업자가 대리납부한 세액", rate: "㉸", fields: ["tax"], kind: "manual" },
  { no: "29", group: "etc", label: "가산세액 계", rate: "㉹", fields: ["tax"], kind: "manual" },
  { no: "30", group: "etc", label: "차가감하여 납부할 세액(환급받을 세액)", fields: ["tax"], kind: "sum" },
];

const r0 = (n: unknown) => Math.round(Number(n || 0));
const mv = (m: FormFigures, no: string, f: "amount" | "tax") => r0(m?.[no]?.[f]);

/** 전표 + 사람이 넣은 칸 → 신고서 전 칸. 금액·세액은 원 단위 정수 */
export function computeVatForm(rows: VatFormRow[], manual: FormFigures = {}): FormFigures {
  const by = (codes: string[]) => {
    const r = rows.filter((x) => codes.includes(String(x.vat_type || "")));
    return { amount: r.reduce((s, x) => s + r0(x.supply_amount), 0), tax: r.reduce((s, x) => s + r0(x.vat_amount), 0) };
  };
  const F: FormFigures = {};
  //   사람이 넣는 칸은 그대로 옮긴다
  for (const l of VAT_LINES) if (l.kind === "manual") {
    const c: FormCell = {};
    if (l.fields.includes("amount")) c.amount = mv(manual, l.no, "amount");
    if (l.fields.includes("tax")) c.tax = mv(manual, l.no, "tax");
    F[l.no] = c;
  }
  F["1"] = by(["11"]);
  F["3"] = by(["17", "22"]);
  F["5"] = { amount: by(["12"]).amount };
  const sale = ["1", "2", "3", "4", "5", "6", "7"];
  F["9"] = {
    amount: sale.reduce((s, k) => s + r0(F[k]?.amount), 0),
    tax: sale.reduce((s, k) => s + r0(F[k]?.tax), 0) + r0(F["8"]?.tax),
  };
  //   ⑫ = 세금계산서(51)로 받은 고정자산 — 전표 차변 계정이 202~240 (2026-10-12 2단계에서 사람 칸 → 자동)
  //   ⑩ = 세금계산서 수취분(51·54) − ⑫
  const fa = rows.filter((x) => String(x.vat_type || "") === "51" && x.assetCat);
  F["12"] = { amount: fa.reduce((s, x) => s + r0(x.supply_amount), 0), tax: fa.reduce((s, x) => s + r0(x.vat_amount), 0) };
  const ti = by(["51", "54"]);
  F["10"] = { amount: ti.amount - r0(F["12"]?.amount), tax: ti.tax - r0(F["12"]?.tax) };
  F["15"] = by(["57", "61"]);
  const plus = ["10", "12", "13", "14", "15"];
  F["16"] = {
    amount: plus.reduce((s, k) => s + r0(F[k]?.amount), 0) - r0(F["11"]?.amount),
    tax: plus.reduce((s, k) => s + r0(F[k]?.tax), 0) - r0(F["11"]?.tax),
  };
  F["17"] = by(["54"]);
  F["18"] = { amount: r0(F["16"].amount) - r0(F["17"].amount), tax: r0(F["16"].tax) - r0(F["17"].tax) };
  F["da"] = { tax: r0(F["9"].tax) - r0(F["18"].tax) };
  F["21"] = { tax: r0(F["19"]?.tax) + r0(F["20"]?.tax) };
  const minus = ["21", "22", "23", "24", "25", "26", "27", "28"].reduce((s, k) => s + r0(F[k]?.tax), 0);
  F["30"] = { tax: r0(F["da"].tax) - minus + r0(F["29"]?.tax) };
  return F;
}

/** 사람이 넣은 값만 골라낸다(0 은 뺀다) — 신고본 manual 칸에 저장 */
export function pickManual(manual: FormFigures): FormFigures {
  const out: FormFigures = {};
  for (const l of VAT_LINES) if (l.kind === "manual") {
    const a = mv(manual, l.no, "amount"), t = mv(manual, l.no, "tax");
    if (a || t) out[l.no] = { ...(a ? { amount: a } : {}), ...(t ? { tax: t } : {}) };
  }
  return out;
}
