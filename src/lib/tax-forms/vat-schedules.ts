// ── 부가세 부속서류 집계 (2026-10-12 세무 2차 2단계, docs/20261012_PLAN_tax_closing_v2.md 결정 261) ──
//
//   기준은 신고서와 같다 — 확정 매입매출전표(VatReturn.fetchVatRows). 서류마다 어떤 유형을 읽는지:
//     세금계산서합계표  매출 11·12 / 매입 51·54   (전자발급분 · 전자 외 · 거래처별)
//     계산서합계표      매출 13 / 매입 53
//     신용카드매출전표등 수령명세서(갑)  57(카드)·61(현금영수증) — 카드는 전표 줄의 법인카드로 카드별
//     신용카드매출전표등 발행금액집계표  17(카드)·22(현금영수증)
//     공제받지 못할 매입세액명세서       54 — 사유는 계정과목으로 추천, 사람이 바꾼다
//     건물등 감가상각자산 취득명세서      51·57·61 중 차변 계정이 고정자산(202~240)인 전표
//   자동으로 못 푸는 것: 공통매입세액 안분(면세 겸영)·화물운전자 복지카드 구분 — 화면에 적는다.

export type ScheduleRow = {
  id: string; entry_date: string; vat_type: string | null; supply_amount: number; vat_amount: number; description: string | null;
  partnerName: string | null; partnerBizno: string | null; partnerKey: string; electronic: boolean;
  voucherNo?: number | null;
  /** 법인카드(전표 줄 card_id) — 없으면 null */
  cardId?: string | null; cardLabel?: string | null;
  /** 차변 고정자산 계정 분류 — 건물·구축물 / 기계장치 / 차량운반구 / 기타 */
  assetCat?: AssetCat | null;
  /** 차변 계정 이름들(불공제 사유 추천용) */
  accountNames?: string[];
};
export type AssetCat = "building" | "machine" | "vehicle" | "other";
export const ASSET_CAT_LABEL: Record<AssetCat, string> = { building: "건물·구축물", machine: "기계장치", vehicle: "차량운반구", other: "그 밖의 감가상각자산" };

/** 고정자산 계정 코드 → 취득명세서 분류 (계정과목 표준: 202 건물·204 구축물·206 기계장치·208 차량운반구·210 공구와기구·212 비품·240 소프트웨어) */
export function assetCatOf(code: string | null | undefined): AssetCat | null {
  const c = String(code || "");
  if (c === "202" || c === "204") return "building";
  if (c === "206") return "machine";
  if (c === "208") return "vehicle";
  if (c === "210" || c === "212" || c === "240") return "other";
  return null;
}

type Tot = { n: number; supply: number; vat: number };
const r0 = (n: unknown) => Math.round(Number(n || 0));
const tot = (rows: ScheduleRow[]): Tot => ({ n: rows.length, supply: rows.reduce((s, x) => s + r0(x.supply_amount), 0), vat: rows.reduce((s, x) => s + r0(x.vat_amount), 0) });
const of = (rows: ScheduleRow[], codes: string[]) => rows.filter((x) => codes.includes(String(x.vat_type || "")));
const digits = (s: string | null) => String(s || "").replace(/[^0-9]/g, "");

export type PartnerLine = Tot & { key: string; name: string; bizno: string | null; electronic: boolean; ids: string[] };
export type InvoiceSummary = {
  total: Tot & { partners: number };
  electronic: Tot & { partners: number };
  paper: Tot & { partners: number };
  /** 사업자번호(10자리) 발급분 / 주민번호(13자리) 발급분 — 서식 칸 */
  biz: Tot & { partners: number }; rrn: Tot & { partners: number };
  partners: PartnerLine[];
};

/** 세금계산서·계산서 합계표 — 거래처 단위(같은 거래처라도 전자·전자 외는 따로 센다) */
export function invoiceSummary(all: ScheduleRow[], codes: string[]): InvoiceSummary {
  const rows = of(all, codes);
  const withP = (r: ScheduleRow[]) => ({ ...tot(r), partners: new Set(r.map((x) => x.partnerKey)).size });
  const m = new Map<string, PartnerLine>();
  for (const x of rows) {
    const k = `${x.partnerKey}|${x.electronic ? "e" : "p"}`;
    const cur = m.get(k) || { key: k, name: x.partnerName || "(거래처 없음)", bizno: x.partnerBizno, electronic: x.electronic, ids: [], n: 0, supply: 0, vat: 0 };
    cur.n += 1; cur.supply += r0(x.supply_amount); cur.vat += r0(x.vat_amount); cur.ids.push(x.id);
    m.set(k, cur);
  }
  return {
    total: withP(rows), electronic: withP(rows.filter((x) => x.electronic)), paper: withP(rows.filter((x) => !x.electronic)),
    biz: withP(rows.filter((x) => digits(x.partnerBizno).length !== 13)), rrn: withP(rows.filter((x) => digits(x.partnerBizno).length === 13)),
    partners: [...m.values()].sort((a, b) => b.supply - a.supply),
  };
}

/** 신용카드매출전표등 수령명세서(갑) — 공제받는 카드·현금영수증 매입 */
export function cardReceived(all: ScheduleRow[]) {
  const cash = of(all, ["61"]);
  const card = of(all, ["57"]);
  const biz = card.filter((x) => x.cardId);          // 사업용 신용카드(법인카드로 등록된 카드)
  const other = card.filter((x) => !x.cardId);       // 그 밖의 신용카드(직원 개인카드 등)
  const byCard = new Map<string, Tot & { key: string; label: string; ids: string[] }>();
  for (const x of card) {
    const k = x.cardId || "(카드 미지정)";
    const cur = byCard.get(k) || { key: k, label: x.cardLabel || "카드 미지정 (그 밖의 신용카드)", ids: [], n: 0, supply: 0, vat: 0 };
    cur.n += 1; cur.supply += r0(x.supply_amount); cur.vat += r0(x.vat_amount); cur.ids.push(x.id); byCard.set(k, cur);
  }
  return { total: tot([...cash, ...card]), cash: tot(cash), biz: tot(biz), other: tot(other), cards: [...byCard.values()].sort((a, b) => b.supply - a.supply), cashIds: cash.map((x) => x.id) };
}

/** 신용카드매출전표등 발행금액집계표 — 과세 매출만(면세 카드매출 유형은 없다) */
export function cardIssued(all: ScheduleRow[]) {
  const card = of(all, ["17"]), cash = of(all, ["22"]);
  //   발행금액은 공급대가(공급가액+세액)
  const amt = (r: ScheduleRow[]) => r.reduce((s, x) => s + r0(x.supply_amount) + r0(x.vat_amount), 0);
  return { card: { n: card.length, amount: amt(card), ids: card.map((x) => x.id) }, cash: { n: cash.length, amount: amt(cash), ids: cash.map((x) => x.id) }, total: amt(card) + amt(cash) };
}

/** 불공제 사유 — 부가가치세법 39조 / 서식(별지 제22호) 순서 */
export const NONDED_REASONS = [
  { code: "1", label: "필요적 기재사항 누락 등" },
  { code: "2", label: "사업과 직접 관련 없는 지출" },
  { code: "3", label: "비영업용 소형승용자동차 구입·유지 및 임차" },
  { code: "4", label: "기업업무추진비 및 이와 유사한 비용 관련" },
  { code: "5", label: "면세사업 등 관련" },
  { code: "6", label: "토지의 자본적 지출 관련" },
  { code: "7", label: "사업자등록 전 매입세액" },
  { code: "8", label: "금·구리 스크랩 거래계좌 미사용 관련 매입세액" },
] as const;

/** 계정 이름으로 사유를 추천 — 틀릴 수 있어 사람이 바꾼다 */
export function suggestReason(names: string[] = []): string {
  const s = names.join(" ");
  if (/접대|기업업무추진/.test(s)) return "4";
  if (/차량|승용|유류|주유/.test(s)) return "3";
  if (/토지/.test(s)) return "6";
  return "2";
}

export function nonDeductible(all: ScheduleRow[], reasons: Record<string, string>) {
  const rows = of(all, ["54"]);
  const reasonOf = (x: ScheduleRow) => reasons[x.id] || suggestReason(x.accountNames);
  const byReason = NONDED_REASONS.map((r) => ({ ...r, ...tot(rows.filter((x) => reasonOf(x) === r.code)) }));
  return { rows, reasonOf, byReason, total: tot(rows) };
}

/** 건물등 감가상각자산 취득명세서 — 공제받는 매입(51·57·61) 중 고정자산 계정 */
export function assetAcquired(all: ScheduleRow[]) {
  const rows = of(all, ["51", "57", "61"]).filter((x) => x.assetCat);
  const cats = (Object.keys(ASSET_CAT_LABEL) as AssetCat[]).map((c) => ({ cat: c, label: ASSET_CAT_LABEL[c], ...tot(rows.filter((x) => x.assetCat === c)), ids: rows.filter((x) => x.assetCat === c).map((x) => x.id) }));
  //   신고서 ⑫(세금계산서로 받은 고정자산)
  const ti = tot(rows.filter((x) => x.vat_type === "51"));
  return { rows, cats, total: tot(rows), taxInvoice: ti };
}

/** 마감 때 신고본에 같이 남기는 부속서류 숫자 */
export function scheduleSnapshot(all: ScheduleRow[], reasons: Record<string, string>) {
  const pick = (s: InvoiceSummary) => ({ total: s.total, electronic: s.electronic, paper: s.paper, partners: s.partners.map(({ ids: _ids, ...p }) => p) });
  const nd = nonDeductible(all, reasons);
  return {
    saleTi: pick(invoiceSummary(all, ["11", "12"])), buyTi: pick(invoiceSummary(all, ["51", "54"])),
    saleBill: pick(invoiceSummary(all, ["13"])), buyBill: pick(invoiceSummary(all, ["53"])),
    cardReceived: (({ cashIds: _c, cards, ...r }) => ({ ...r, cards: cards.map(({ ids: _i, ...c }) => c) }))(cardReceived(all)),
    cardIssued: (({ card, cash, total }) => ({ card: { n: card.n, amount: card.amount }, cash: { n: cash.n, amount: cash.amount }, total }))(cardIssued(all)),
    nonDeductible: { byReason: nd.byReason, reasons: Object.fromEntries(nd.rows.map((x) => [x.id, nd.reasonOf(x)])) },
    assetAcquired: (({ cats, total, taxInvoice }) => ({ cats: cats.map(({ ids: _i, ...c }) => c), total, taxInvoice }))(assetAcquired(all)),
  };
}
