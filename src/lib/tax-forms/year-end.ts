// ── 근로소득 연말정산 계산 엔진 (2026-10-14, 위하고 대비 공백 — 추천 3순위) ──
//
//   History: 연말정산은 '간소화 자료 제출 상태'(year_end_tax_status)만 있었고 계산은 세무사·밖에서 했다.
//   그래서 원천세 A04(연말정산)와 연간 근로 지급명세서의 '결정세액' 칸이 늘 비었다.
//   기준(무엇으로 판단하나): 소득세법 근로소득 연말정산 — 총급여 → 근로소득공제 → 소득공제 → 과세표준 → 세율 → 세액공제 → 결정세액
//   → 기납부세액(매월 원천징수) 차감 → 환급/추징. 지방소득세 = 결정세액의 10%.
//   ⚠️ 규칙 상수는 **2025년 귀속** 기준(RULE_YEAR). 세법이 바뀌면 이 파일 상수만 고친다 — 화면에 기준 연도를 적는다.
//   자동으로 못 푸는 것(사람·세무사): 부양가족 소득요건 판단, 중복공제 여부, 신용카드 소비증가분 추가공제(전년 사용액 필요),
//   주택자금 요건(무주택·세대주·취득가액), 기부금 이월, 외국인 단일세율, 중소기업 취업자 감면 — 입력 칸 또는 '세무사 확인'으로 남긴다.

export const RULE_YEAR = 2025;

export type YearEndInput = {
  /** 총급여(과세) — 이 회사 + 전 근무지 */
  totalPay: number; prevPay?: number;
  /** 기납부 소득세·지방소득세 — 이 회사 매월 원천징수 + 전 근무지 */
  paidIncomeTax: number; paidLocalTax: number; prevPaidIncomeTax?: number; prevPaidLocalTax?: number;
  /** 4대보험 근로자 부담(연간) */
  pension?: number; healthLtc?: number; employment?: number;
  /** 인적공제 — 본인 제외 기본공제 대상 인원 */
  spouse?: boolean; dependents?: number; elderly70?: number; disabled?: number; womanHead?: boolean; singleParent?: boolean;
  /** 자녀세액공제 — 8세 이상(20세 이하) 자녀 수 · 그 해 출산·입양 순서(0=없음, 1·2·3=첫째·둘째·셋째 이상) */
  children8?: number; birthOrder?: 0 | 1 | 2 | 3;
  /** 주택자금 */
  rentLoanRepay?: number; mortgageInterest?: number; mortgageLimit?: number; housingSaving?: number; housingSavingEligible?: boolean;
  monthlyRent?: number;
  /** 신용카드 등 사용액(서로 겹치지 않게) */
  card?: { credit?: number; debitCash?: number; market?: number; transit?: number; culture?: number };
  /** 연금계좌 */
  pensionSaving?: number; irp?: number;
  /** 보험료(보장성) · 장애인전용 */
  insurance?: number; insuranceDisabled?: number;
  /** 의료비 — 본인·65세 이상·장애인·6세 이하 등(한도 없음) / 그 밖 부양가족(700만 한도) / 미숙아·선천성 / 난임 */
  medicalSelf?: number; medicalOthers?: number; medicalPremature?: number; medicalInfertility?: number;
  /** 교육비 — 본인(한도 없음) / 취학 전·초중고(1인 300만) / 대학(1인 900만) / 장애인 특수교육 */
  eduSelf?: number; eduK12?: number; eduK12Count?: number; eduUniv?: number; eduUnivCount?: number; eduDisabled?: number;
  /** 기부금 — 정치자금 / 특례(법정) / 일반(지정) / 종교단체 */
  donPolitical?: number; donSpecial?: number; donGeneral?: number; donReligious?: number;
};

const z = (n: unknown) => Math.max(0, Math.round(Number(n || 0)));
const fl = (n: number) => Math.floor(n);

/** 근로소득공제 (소득세법 47조) — 한도 2,000만 */
export function earnedIncomeDeduction(pay: number): number {
  let d: number;
  if (pay <= 5_000_000) d = pay * 0.7;
  else if (pay <= 15_000_000) d = 3_500_000 + (pay - 5_000_000) * 0.4;
  else if (pay <= 45_000_000) d = 7_500_000 + (pay - 15_000_000) * 0.15;
  else if (pay <= 100_000_000) d = 12_000_000 + (pay - 45_000_000) * 0.05;
  else d = 14_750_000 + (pay - 100_000_000) * 0.02;
  return fl(Math.min(d, 20_000_000));
}

/** 종합소득 기본세율 (소득세법 55조, 2023 개정) — 누진공제 방식 */
const BRACKETS: [number, number, number][] = [
  [14_000_000, 6, 0], [50_000_000, 15, 1_260_000], [88_000_000, 24, 5_760_000], [150_000_000, 35, 15_440_000],
  [300_000_000, 38, 19_940_000], [500_000_000, 40, 25_940_000], [1_000_000_000, 42, 35_940_000], [Infinity, 45, 65_940_000],
];
export function incomeTaxOf(base: number): number {
  if (base <= 0) return 0;
  const [, pct, ded] = BRACKETS.find(([up]) => base <= up)!;
  return fl((base * pct) / 100 - ded);
}

/** 근로소득세액공제 (소득세법 59조) — 산출세액 기준 공제 + 총급여 구간별 한도 */
export function earnedIncomeCredit(calc: number, pay: number): number {
  const raw = calc <= 1_300_000 ? calc * 0.55 : 715_000 + (calc - 1_300_000) * 0.3;
  let cap: number;
  if (pay <= 33_000_000) cap = 740_000;
  else if (pay <= 70_000_000) cap = Math.max(660_000, 740_000 - (pay - 33_000_000) * 0.008);
  else if (pay <= 120_000_000) cap = Math.max(500_000, 660_000 - (pay - 70_000_000) * 0.5);
  else cap = Math.max(200_000, 500_000 - (pay - 120_000_000) * 0.5);
  return fl(Math.min(raw, cap));
}

/** 신용카드 등 소득공제 (조특법 126조의2, 2025 귀속) — 최저사용액(총급여 25%)은 신용카드 → 체크·현금·도서공연 → 전통시장·대중교통 순으로 뺀다 */
export function cardDeduction(pay: number, c: YearEndInput["card"] = {}) {
  const credit = z(c.credit), debit = z(c.debitCash), market = z(c.market), transit = z(c.transit);
  //   도서·공연 등 30% 는 총급여 7천 이하만 — 넘으면 신용카드 사용분으로 본다
  const culture = pay <= 70_000_000 ? z(c.culture) : 0;
  const creditAll = credit + (pay <= 70_000_000 ? 0 : z(c.culture));
  let rem = fl(pay * 0.25);
  const take = (v: number) => { const t = Math.min(v, rem); rem -= t; return v - t; };
  const cr = take(creditAll), dc = take(debit + culture);
  const dcCulture = debit + culture > 0 ? (dc * culture) / (debit + culture) : 0, dcDebit = dc - dcCulture;
  const mt = take(market + transit);
  const base = cr * 0.15 + dcDebit * 0.3 + dcCulture * 0.3 + mt * 0.4;
  const basicLimit = pay <= 70_000_000 ? 3_000_000 : pay <= 120_000_000 ? 2_500_000 : 2_000_000;
  const extraLimit = pay <= 70_000_000 ? 3_000_000 : 2_000_000;
  const extraBase = mt * 0.4 + dcCulture * 0.3;
  const over = Math.max(0, base - basicLimit);
  const ded = Math.min(base, basicLimit) + Math.min(over, extraLimit, extraBase);
  return { usage: credit + debit + market + transit + z(c.culture), threshold: fl(pay * 0.25), base: fl(base), deduction: fl(ded) };
}

export function computeYearEnd(i: YearEndInput) {
  //   특별공제(건강·고용보험료·주택자금 소득공제 + 보험·의료·교육·기부 세액공제 + 월세)를 받는 경우와
  //   표준세액공제 13만을 받는 경우를 둘 다 계산해 결정세액이 작은 쪽을 고른다(연말정산 프로그램 관행 — 소득세법 59조의4 ⑨)
  const a = run(i, false), b = run(i, true);
  return b.decided < a.decided ? b : a;
}

function run(i: YearEndInput, standard: boolean) {
  const pay = z(i.totalPay) + z(i.prevPay);
  const eid = earnedIncomeDeduction(pay);
  const earned = pay - eid;   // 근로소득금액

  // ── 소득공제 ──
  const people = 1 + (i.spouse ? 1 : 0) + z(i.dependents);
  const personal = people * 1_500_000 + z(i.elderly70) * 1_000_000 + z(i.disabled) * 2_000_000
    + (i.singleParent ? 1_000_000 : i.womanHead && earned <= 30_000_000 ? 500_000 : 0);
  const pensionIns = z(i.pension);
  const socialIns = standard ? 0 : z(i.healthLtc) + z(i.employment);
  //   주택임차 원리금 40% + 주택청약 40% (합산 400만) · 장기주택저당 이자(한도는 사람이 고른 600~2,000만) — 전체가 저당 한도를 넘지 않게
  //   (주택청약은 '그 밖의 소득공제'라 표준세액공제와 같이 받을 수 있다)
  const saving = i.housingSavingEligible && pay <= 70_000_000 ? Math.min(z(i.housingSaving), 3_000_000) * 0.4 : 0;
  const rentAndSaving = Math.min((standard ? 0 : z(i.rentLoanRepay) * 0.4) + saving, 4_000_000);
  const mortgage = standard ? 0 : Math.min(z(i.mortgageInterest), z(i.mortgageLimit) || 0);
  const housingAll = mortgage > 0 ? Math.min(rentAndSaving + mortgage, Math.max(z(i.mortgageLimit), 4_000_000)) : rentAndSaving;
  const card = cardDeduction(pay, i.card);
  //   소득공제 종합한도 2,500만 (조특법 132조의2) — 주택자금·청약·신용카드
  const capped = Math.min(housingAll + card.deduction, 25_000_000);
  const deductions = personal + pensionIns + socialIns + capped;
  const taxBase = Math.max(0, earned - deductions);
  const calc = incomeTaxOf(taxBase);

  // ── 세액공제 ──
  const earnedCredit = earnedIncomeCredit(calc, pay);
  const kids = z(i.children8);
  const childCredit = (kids === 0 ? 0 : kids === 1 ? 250_000 : kids === 2 ? 550_000 : 550_000 + (kids - 2) * 400_000)
    + (i.birthOrder === 1 ? 300_000 : i.birthOrder === 2 ? 500_000 : i.birthOrder === 3 ? 700_000 : 0);
  const pensionRate = pay <= 55_000_000 ? 0.15 : 0.12;
  const pensionBase = Math.min(Math.min(z(i.pensionSaving), 6_000_000) + z(i.irp), 9_000_000);
  const pensionCredit = fl(pensionBase * pensionRate);
  const insCredit = fl(Math.min(z(i.insurance), 1_000_000) * 0.12 + Math.min(z(i.insuranceDisabled), 1_000_000) * 0.15);
  //   의료비 — 총급여 3% 는 그 밖 부양가족 → 본인 등 → 미숙아 → 난임 순으로 뺀다
  let medTh = fl(pay * 0.03);
  const mTake = (v: number) => { const t = Math.min(v, medTh); medTh -= t; return v - t; };
  const mOthers = Math.min(mTake(z(i.medicalOthers)), 7_000_000), mSelf = mTake(z(i.medicalSelf));
  const mPre = mTake(z(i.medicalPremature)), mInf = mTake(z(i.medicalInfertility));
  const medCredit = fl((mOthers + mSelf) * 0.15 + mPre * 0.2 + mInf * 0.3);
  const eduBase = z(i.eduSelf) + (z(i.eduK12) ? Math.min(z(i.eduK12), 3_000_000 * Math.max(1, z(i.eduK12Count))) : 0)
    + (z(i.eduUniv) ? Math.min(z(i.eduUniv), 9_000_000 * Math.max(1, z(i.eduUnivCount))) : 0) + z(i.eduDisabled);
  const eduCredit = fl(eduBase * 0.15);
  //   기부금 — 정치자금 10만까지 100/110, 넘는 부분 15%(3천만 초과 25%) · 특례는 근로소득금액까지, 일반·종교는 남은 금액의 30%(종교 10%)까지
  //   (정치자금 10만 이하분은 표준세액공제와 같이 받을 수 있다 — 조특법 76조)
  const pol = z(i.donPolitical);
  const polSmall = fl(Math.min(pol, 100_000) * 100 / 110);
  const polCredit = polSmall + fl(Math.min(Math.max(0, pol - 100_000), 29_900_000) * 0.15 + Math.max(0, pol - 30_000_000) * 0.25);
  const special = Math.min(z(i.donSpecial), earned);
  const room = Math.max(0, earned - special);
  const general = Math.min(z(i.donGeneral) + Math.min(z(i.donReligious), room * 0.1), room * 0.3);
  const donBase = special + general;
  const donCredit = fl(Math.min(donBase, 10_000_000) * 0.15 + Math.max(0, donBase - 10_000_000) * 0.3) + polCredit;
  const rentRate = pay <= 55_000_000 ? 0.17 : pay <= 80_000_000 ? 0.15 : 0;
  const rentCredit = standard ? 0 : fl(Math.min(z(i.monthlyRent), 10_000_000) * rentRate);
  const specialCredits = standard ? polSmall : insCredit + medCredit + eduCredit + donCredit;
  const standardCredit = standard ? 130_000 : 0;

  const credits = earnedCredit + childCredit + pensionCredit + specialCredits + standardCredit + rentCredit;
  const decided = Math.max(0, calc - credits);
  const decidedLocal = fl(decided * 0.1);
  const paid = z(i.paidIncomeTax) + z(i.prevPaidIncomeTax), paidLocal = z(i.paidLocalTax) + z(i.prevPaidLocalTax);
  //   차감징수세액 — 10원 미만 절사. 추징이 1천원 미만이면 소액부징수(0)
  const t10 = (n: number) => (n >= 0 ? Math.floor(n / 10) * 10 : -Math.floor(-n / 10) * 10);
  let diff = t10(decided - paid), diffLocal = t10(decidedLocal - paidLocal);
  if (diff > 0 && diff < 1_000) { diff = 0; diffLocal = 0; }

  return {
    ruleYear: RULE_YEAR, standard, pay, eid, earned,
    deductions: { personal, pensionIns, socialIns, housing: housingAll, card: card.deduction, cardDetail: card, cappedOther: capped, total: deductions },
    taxBase, calc,
    credits: { earned: earnedCredit, child: childCredit, pension: pensionCredit, insurance: standard ? 0 : insCredit, medical: standard ? 0 : medCredit,
      education: standard ? 0 : eduCredit, donation: standard ? polSmall : donCredit, standard: standardCredit, rent: rentCredit, total: credits },
    decided, decidedLocal, paid, paidLocal, diff, diffLocal,
  };
}

export type YearEndResult = ReturnType<typeof computeYearEnd>;
