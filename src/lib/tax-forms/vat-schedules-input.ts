// ── 부가세 부속서류 B — 사람이 입력하는 서류 (2026-10-12 세무 2차 3단계, docs/20261012_PLAN_tax_closing_v2.md 결정 261) ──
//
//   부동산임대공급가액명세서 · 의제매입세액공제신고서 · 대손세액공제신고서 — 장부에 없는 사실(임대차 계약·품목·대손 사유)이라
//   사람이 넣고, 계산(간주임대료·공제세액·대손세액)과 신고서 칸 반영은 여기서 한다. 입력값은 tax_schedule_inputs(기수별 문서 하나).
//   신고서 반영:  간주임대료 → ④ 기타(정규영수증 외 매출분) · 대손세액 → ⑧ 대손세액 가감(공제는 −) · 의제매입세액 → ⑮ 그 밖의 공제매입세액.
//   자동으로 못 푸는 것: 의제매입 공제 한도(과세표준 × 업종·규모별 한도율) — 세무사 확인으로 적는다.

const fl = (n: number) => Math.floor(Number(n || 0));

/** 기간 겹침 일수(양 끝 포함) */
export function overlapDays(aFrom: string, aTo: string, bFrom: string, bTo: string): number {
  const s = aFrom > bFrom ? aFrom : bFrom, e = aTo < bTo ? aTo : bTo;
  if (!s || !e || s > e) return 0;
  return Math.round((Date.parse(`${e}T00:00:00Z`) - Date.parse(`${s}T00:00:00Z`)) / 86400000) + 1;
}

// ─── 부동산임대공급가액명세서 ───
export type LeaseRow = {
  id: string; dong?: string; floor?: string; ho?: string; area?: number; use?: string;
  tenant: string; tenantBizno?: string; start: string; end?: string;
  deposit: number; monthlyRent: number; maintenance: number;
};
export type LeaseData = { rate: number; rows: LeaseRow[] };
/** 정기예금이자율(간주임대료) — 기획재정부령으로 바뀐다. 2025.3.21 이후 3.1%. 화면에서 고칠 수 있다 */
export const DEFAULT_LEASE_RATE = 3.1;

/** 한 줄 — 과세기간 안 날짜만 센다. 월세·관리비는 달마다 (그 달 임대일수 / 그 달 일수) 비례 */
export function leaseLine(r: LeaseRow, from: string, to: string, ratePct: number) {
  const end = r.end || "9999-12-31";
  const days = overlapDays(r.start, end, from, to);
  const deemed = fl(Number(r.deposit || 0) * days * (ratePct / 100) / 365);
  let rent = 0, maint = 0;
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  for (let y = fy, m = fm; y < ty || (y === ty && m <= tm); m === 12 ? (y++, m = 1) : m++) {
    const mm = String(m).padStart(2, "0");
    const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const d = overlapDays(r.start, end, `${y}-${mm}-01`, `${y}-${mm}-${String(dim).padStart(2, "0")}`);
    rent += Number(r.monthlyRent || 0) * d / dim; maint += Number(r.maintenance || 0) * d / dim;
  }
  rent = fl(rent); maint = fl(maint);
  return { days, deemed, rent, maint, total: deemed + rent + maint };
}
export function leaseSummary(d: LeaseData | null | undefined, from: string, to: string) {
  const rate = Number(d?.rate || DEFAULT_LEASE_RATE);
  const lines = (d?.rows || []).map((r) => ({ row: r, ...leaseLine(r, from, to, rate) }));
  const sum = (k: "deemed" | "rent" | "maint" | "total") => lines.reduce((s, x) => s + x[k], 0);
  return { rate, lines, deemed: sum("deemed"), rent: sum("rent"), maint: sum("maint"), total: sum("total") };
}

// ─── 의제매입세액공제신고서 ───
export const DEEMED_RATES = [
  { key: "2/102", label: "2/102 — 일반(과세유흥장소 등 포함 그 밖)" },
  { key: "4/104", label: "4/104 — 중소기업 제조업·개인 제조업" },
  { key: "6/106", label: "6/106 — 법인 음식점업" },
  { key: "8/108", label: "8/108 — 개인 음식점업(과세표준 2억 초과)" },
  { key: "9/109", label: "9/109 — 개인 음식점업(과세표준 2억 이하)" },
] as const;
export type DeemedItem = { entryId: string; item?: string; qty?: string };
export type DeemedManual = { id: string; kind: "bill" | "card" | "farmer"; supplier: string; bizno?: string; date: string; item?: string; qty?: string; amount: number };
export type DeemedData = { rate: string; items: DeemedItem[]; manual: DeemedManual[] };
export const DEEMED_KIND_LABEL = { bill: "계산서", card: "신용카드 등", farmer: "농어민 직접 매입" } as const;

type CandRow = { id: string; vat_type: string | null; supply_amount: number; partnerKey: string };
/** 면세 매입 전표(53 계산서·58 카드 면세) 중 사람이 고른 것 + 직접 넣은 줄 */
export function deemedSummary(d: DeemedData | null | undefined, cands: CandRow[]) {
  const rate = d?.rate || "2/102";
  const [num, den] = rate.split("/").map(Number);
  const picked = new Set((d?.items || []).map((x) => x.entryId));
  const sel = cands.filter((x) => picked.has(x.id));
  const groups = (["bill", "card", "farmer"] as const).map((k) => {
    const fromEntries = sel.filter((x) => (k === "bill" ? x.vat_type === "53" : k === "card" ? x.vat_type === "58" : false));
    const man = (d?.manual || []).filter((m) => m.kind === k);
    const amount = fromEntries.reduce((s, x) => s + Math.round(x.supply_amount), 0) + man.reduce((s, m) => s + Math.round(Number(m.amount || 0)), 0);
    const suppliers = new Set([...fromEntries.map((x) => x.partnerKey), ...man.map((m) => m.bizno || m.supplier)]).size;
    return { kind: k, label: DEEMED_KIND_LABEL[k], suppliers, n: fromEntries.length + man.length, amount, tax: fl(amount * num / den) };
  });
  const amount = groups.reduce((s, g) => s + g.amount, 0);
  return { rate, groups, n: groups.reduce((s, g) => s + g.n, 0), amount, tax: groups.reduce((s, g) => s + g.tax, 0) };
}

// ─── 대손세액공제신고서 ───
export const BADDEBT_REASONS = ["파산", "강제집행", "사망·실종", "회생계획인가 결정", "부도 발생일부터 6개월 경과", "소멸시효 완성", "중소기업 외상매출금 2년 경과", "그 밖의 사유"] as const;
export type BaddebtRow = { id: string; supplyDate: string; confirmDate: string; amount: number; partner: string; bizno?: string; ceo?: string; reason: string; recovered?: boolean };
export type BaddebtData = { rows: BaddebtRow[] };
/** 대손세액 = 대손금액(공급대가) × 10/110. 공제는 ⑧에서 빼고(−), 회수는 더한다(+) */
export function baddebtSummary(d: BaddebtData | null | undefined) {
  const lines = (d?.rows || []).map((r) => ({ row: r, tax: fl(Number(r.amount || 0) * 10 / 110) }));
  const deducted = lines.filter((x) => !x.row.recovered), recovered = lines.filter((x) => x.row.recovered);
  const dTax = deducted.reduce((s, x) => s + x.tax, 0), rTax = recovered.reduce((s, x) => s + x.tax, 0);
  return { lines, deductedAmount: deducted.reduce((s, x) => s + Number(x.row.amount || 0), 0), deductedTax: dTax,
    recoveredAmount: recovered.reduce((s, x) => s + Number(x.row.amount || 0), 0), recoveredTax: rTax, line8: rTax - dTax };
}

// ─── 경정청구 ───
export type RefundClaimData = { reason?: string; bank?: string; account?: string; holder?: string };

/** 신고서에 더할 부속서류 몫 — computeVatForm(extras) */
export type VatFormExtras = { l4?: { amount: number; tax: number }; l8tax?: number; l15?: { amount: number; tax: number } };
export function vatExtrasOf(lease: ReturnType<typeof leaseSummary>, deemed: ReturnType<typeof deemedSummary>, bad: ReturnType<typeof baddebtSummary>): VatFormExtras {
  return {
    l4: { amount: lease.deemed, tax: fl(lease.deemed / 10) },
    l8tax: bad.line8,
    l15: { amount: deemed.amount, tax: deemed.tax },
  };
}

export const newId = () => Math.random().toString(36).slice(2, 10);
