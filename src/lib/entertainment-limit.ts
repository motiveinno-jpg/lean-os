// ── 기업업무추진비(접대비) 한도 (2026-10-07 ERP 3차 C, docs/20261007_PLAN_erp_gap_audit3.md) ──
//
//   History: 법인세 예상은 회계이익을 그대로 과세표준으로 썼고 "접대비 한도 미반영"이라고만 적었다.
//   기준: 법인세법 제25조 ④ — 한도 = 기본한도 × 사업연도 월수/12 + 수입금액 × 적용률.
//     기본한도 중소기업 3,600만 원 · 일반 1,200만 원.
//     수입금액 적용률 100억 이하 0.3% · 100억~500억 3,000만 원 + 0.2% · 500억 초과 1억 1,000만 원 + 0.03%.
//   한도를 넘은 금액은 손금불산입 → 과세표준에 더한다.
//   자동으로 못 푸는 것(화면에 적는다): 문화·전통시장 추가 한도, 특수관계인 수입금액(10% 적용),
//   부동산임대 주업 등 특정법인(한도 50%), 3만 원 초과 적격증빙 미수취분(한도 계산 전 전액 손금불산입).

const MAN = 10_000;
const EOK = 100_000_000;

/** 수입금액 한도 — 수입금액(원) × 구간 적용률 */
export function revenueLimit(revenue: number): number {
  const r = Math.max(0, revenue);
  if (r <= 100 * EOK) return Math.floor(r * 0.003);
  if (r <= 500 * EOK) return Math.floor(3_000 * MAN + (r - 100 * EOK) * 0.002);
  return Math.floor(11_000 * MAN + (r - 500 * EOK) * 0.0003);
}

export type EntertainmentLimit = { spent: number; base: number; byRevenue: number; limit: number; excess: number };

/** spent = 기업업무추진비 합계, revenue = 수입금액(매출), months = 사업연도 월수(보통 12) */
export function entertainmentLimit(spent: number, revenue: number, sme: boolean, months = 12): EntertainmentLimit {
  const base = Math.floor(((sme ? 3_600 : 1_200) * MAN * Math.min(12, Math.max(0, months))) / 12);
  const byRevenue = revenueLimit(revenue);
  const limit = base + byRevenue;
  const s = Math.max(0, Math.round(spent));
  return { spent: s, base, byRevenue, limit, excess: Math.max(0, s - limit) };
}

/** 손익 계정이 기업업무추진비인가 — 표준 코드(513·613·713·813·843) 또는 이름에 '접대'·'업무추진' */
export function isEntertainmentAccount(code: string | null | undefined, name: string): boolean {
  return ["513", "613", "713", "813", "843"].includes(String(code || "")) || /접대|업무추진/.test(name);
}

/** 손익 계정이 매출(수입금액)인가 — 표준 코드 401~450 (매출할인·환입은 음수로 들어와 순매출이 된다) */
export function isSalesAccount(code: string | null | undefined): boolean {
  const n = Number(code);
  return Number.isFinite(n) && n >= 401 && n <= 450;
}
