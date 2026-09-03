import { supabase } from "./supabase";
import { todayKst, daysBetweenStr } from "./kst";
import { requiredDocsOf, readyCount, type DocCheck } from "./support-docs";
export const MIN_WAGE_MONTHLY_2026 = 2156880;

// 두루누리 월평균보수 상한 — 이 값 미만이어야 지원 대상
const DURUNURI_PAY_CAP = 2700000;

export type Verdict = "high" | "check" | "none";

export const VERDICT_LABEL: Record<Verdict, string> = {
  high: "가능성 높음",
  check: "조건 확인",
  none: "해당 없음",
};

/** 근거 한 줄 — 화면에 ✓ / ? / ✕ 로 그대로 나간다 */
export type Reason = {
  mark: "ok" | "unknown" | "no";
  text: string;
  /** 출처를 적는다 — 전부 'AI' 로 뭉뚱그리면 틀렸을 때 원인을 엉뚱한 데서 찾는다 */
  src: "회사 자료" | "회사 카드" | "제도 요건";
};

export type Judgement = {
  verdict: Verdict;
  reasons: Reason[];
  /** 우리 자료로 계산되는 예상액 — 없으면 목록에 제도 표기 금액만 뜬다 */
  estimate?: { amount: number; text: string; basis: string };
  /**
   * 자격 점수(0~50)를 규칙이 직접 매길 때. 안 주면 scoreProgram 이 ✓/? 개수로 셈한다.
   * 공고는 수천 건이라 ✓ 개수만으로는 **전부 같은 점수**가 되어 순위가 사라진다 —
   * 무엇이 얼마나 맞는지(지역 전용인지, 업력이 딱 맞는지, 관심 분야인지)로 갈라야 큐레이션이 된다.
   */
  fitScore?: number;
};

export type GovProgram = {
  id: string;
  source: string;
  title: string;
  org: string | null;
  field: string | null;
  support_type: string | null;
  summary: string | null;
  requirement: string | null;
  amount_text: string | null;
  amount_max: number | null;
  detail_url: string | null;
  apply_start: string | null;
  apply_end: string | null;
  rule_key: string | null;
  status: string;
  sort_order: number;
  /** 공고형에서 수집한 구조화 자격 — { regions[], max_years, targets[], exclude, dept } */
  eligibility?: Eligibility | null;
  /** 신청에 필요한 서류 키 (lib/support-docs.ts DOC_CATALOG). 비면 rule_key 기본 세트 */
  required_docs?: string[] | null;
  /** AI 가 공고 원문에서 뽑은 자격 조건표 (gov-programs-enrich, 2026-09-03). 있으면 judge 가 이걸로 엄격하게 대조한다 */
  eligibility_ai?: AiEligibility | null;
};

export type AiEligibility = {
  region_scope: "nationwide" | "restricted" | "unknown";
  regions: string[]; districts: string[];
  industry_scope: "any" | "restricted" | "unknown";
  industries: string[]; industry_note: string;
  company_types: string[];
  max_years: number | null; min_years: number | null;
  employees_min: number | null; employees_max: number | null;
  revenue_max_krw: number | null;
  required_certs: string[];
  exclusions: string[];
  /** 수출 실적·수출기업 요건 (2026-09-03 사장님) — true 면 수출 실적이 있어야 신청 가능 */
  requires_export?: boolean | null;
  evidence: { region: string; industry: string; company_type: string; years: string; export?: string };
  summary: string; confidence: number;
};

/** 공고 자격 스펙 — K-Startup 응답이 이미 구조화돼 있어 AI 없이 코드로 대조한다 */
export type Eligibility = {
  regions?: string[];
  max_years?: number | null;
  targets?: string[];
  exclude?: string | null;
  dept?: string | null;
  /** 온라인 접수 가능 여부 — 방문·우편만 되는 사업은 준비 부담이 다르다 */
  online?: boolean;
};

export type SavedRow = {
  id: string;
  program_id: string;
  status: string;
  memo: string | null;
  assignee_id: string | null;
  due_date: string | null;
};

export const SAVED_STATUS_LABEL: Record<string, string> = {
  saved: "관심",
  preparing: "준비 중",
  applied: "신청함",
  selected: "선정",
  rejected: "미선정",
  dropped: "접음",
};

// ── 회사 프로필 6축 ────────────────────────────────────────────────────────

export type CompanyProfile = {
  companyId: string;
  /** 1 업종 */
  industry: string | null;
  businessType: string | null;
  businessCategory: string | null;
  /** 2 소재지 — 주소 첫 낱말에서 뽑은 시도 */
  region: string | null;
  /** 시군구 — 주소 둘째 낱말("화성시"·"강남구"). 시군구 한정 공고 대조용 (2026-09-03) */
  district: string | null;
  isMetro: boolean | null;   // 수도권(서울·경기·인천) 여부 — 지원 단가가 갈린다
  /** 3 규모 */
  headcount: number;
  headcountLastYearEnd: number;
  /** 4 고용 */
  youngCount: number;         // 만 34세 이하 재직
  newHires3m: number;         // 최근 3개월 입사
  youngNewHires3m: number;
  resigned3m: number;         // 최근 3개월 퇴사 — 인위적 감원 의심 구간
  insuredCount: number;       // 4대보험 가입
  lowPaidCount: number;       // 월 보수 270만원 미만
  contractCount: number;      // 계약직(기간제)
  belowMinWage: number;       // 월 최저임금 미만으로 적힌 인원
  salaryMissing: number;      // 급여 미입력 인원 — 계산을 믿을 수 없게 만드는 구멍
  birthMissing: number;       // 생년월일 미입력 인원 — 청년 수가 실제보다 적게 잡힌다
  seniorCount: number;        // 만 60세 이상
  /** 5 업력 · 6 자격·인증 — 회사 카드(company_profile_ext) */
  openDate: string | null;
  yearsInBusiness: number | null;
  sizeClass: string | null;
  certifications: string[];
  hasExport: boolean | null;
  ksicMain: string | null;
  priorGrants: { year?: number; name?: string }[];
  interests: string[];
  /** 회사 카드 완성도 — 7문항 중 몇 개 */
  cardFilled: number;
};

export const CARD_TOTAL = 7;

const METRO = ["서울", "경기", "인천"];

/** 주소 첫 낱말 → 시도. "서울특별시 강남구…" · "경기도 성남시…" 둘 다 잡는다 */
export function regionOf(address: string | null | undefined): string | null {
  const head = (address || "").trim().split(/\s+/)[0] || "";
  if (!head) return null;
  const table: Record<string, string> = {
    서울특별시: "서울", 부산광역시: "부산", 대구광역시: "대구", 인천광역시: "인천",
    광주광역시: "광주", 대전광역시: "대전", 울산광역시: "울산", 세종특별자치시: "세종",
    경기도: "경기", 강원특별자치도: "강원", 강원도: "강원", 충청북도: "충북", 충청남도: "충남",
    전라북도: "전북", 전북특별자치도: "전북", 전라남도: "전남", 경상북도: "경북", 경상남도: "경남",
    제주특별자치도: "제주", 제주도: "제주",
  };
  if (table[head]) return table[head];
  //   "서울시" · "서울" 처럼 짧게 적은 경우
  const short = head.replace(/(특별자치시|특별자치도|광역시|특별시|시|도)$/, "");
  return short || null;
}

/** 주소 둘째 낱말 → 시군구 ("경기도 화성시 동탄대로 1" → "화성시"). 세종처럼 시군구가 없으면 null */
export function districtOf(address: string | null | undefined): string | null {
  const parts = (address || "").trim().split(/\s+/);
  const second = parts[1] || "";
  if (!second || !/(시|군|구)$/.test(second)) return null;
  return second;
}
const distKey = (d: string) => d.replace(/(특별자치시|특별자치도|광역시|특별시|시|군|구)$/, "");

/** 생년월일 → 만 나이 (KST 오늘 기준) */
export function ageOf(birth: string | null | undefined, today = todayKst()): number | null {
  if (!birth) return null;
  const b = birth.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b)) return null;
  const [by, bm, bd] = b.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  let age = ty - by;
  if (tm < bm || (tm === bm && td < bd)) age -= 1;
  return age;
}

type EmployeeRow = {
  status: string | null;
  birth_date: string | null;
  hire_date: string | null;
  resignation_date: string | null;
  employment_type: string | null;
  is_4_insurance: boolean | null;
  salary: number | null;
};

/**
 * 회사 프로필을 만든다 — 6축 중 4축(업종·소재지·규모·고용)은 우리가 이미 가진 자료에서 나온다.
 *   나머지 2축(업력·인증)은 회사 카드에서 오고, 비어 있으면 그 조건이 `?` 가 된다.
 */
export async function loadCompanyProfile(companyId: string): Promise<CompanyProfile> {
  const today = todayKst();

  const [companyRes, empRes, extRes] = await Promise.all([
    supabase.from("companies").select("industry, business_type, business_category, address").eq("id", companyId).maybeSingle(),
    supabase.from("employees")
      .select("status, birth_date, hire_date, resignation_date, employment_type, is_4_insurance, salary")
      .eq("company_id", companyId),
    supabase.from("company_profile_ext").select("*").eq("company_id", companyId).maybeSingle(),
  ]);

  const company = companyRes.data;
  const emps = (empRes.data || []) as EmployeeRow[];
  const ext = extRes.data;

  //   재직 판정 — 이 저장소의 정본은 `.in('status', ['active','joined'])` 이다
  //   (lib/queries.ts:211, lib/hr.ts:76). 초대로 합류한 직원은 'joined' 로 들어오므로
  //   'active' 만 보면 **회사 전체가 0명으로 잡힌다**(2026-08-21 프로덕션에서 실제로 그랬다).
  //   status 가 비어 있는 옛 데이터는 퇴사일 유무로 가른다.
  const ACTIVE_STATUS = new Set(["active", "joined", "재직"]);
  const isActive = (e: EmployeeRow) =>
    (e.status ? ACTIVE_STATUS.has(e.status) : true) && !e.resignation_date;
  const active = emps.filter(isActive);

  //   daysBetweenStr(a, b) = a - b (일). 지난 날이므로 today - date 로 잰다.
  const within = (date: string | null, days: number) => {
    if (!date) return false;
    const gap = daysBetweenStr(today, date.slice(0, 10));
    return gap >= 0 && gap <= days;
  };

  const young = active.filter((e) => { const a = ageOf(e.birth_date, today); return a !== null && a <= 34; });
  const newHires = active.filter((e) => within(e.hire_date, 90));

  //   작년 말 인원 — 통합고용세액공제의 '순증' 계산용.
  //   그때 이미 입사했고, 그때까지 안 나간 사람.
  const lastYearEnd = `${Number(today.slice(0, 4)) - 1}-12-31`;
  const headcountLastYearEnd = emps.filter((e) =>
    !!e.hire_date && e.hire_date.slice(0, 10) <= lastYearEnd &&
    (!e.resignation_date || e.resignation_date.slice(0, 10) > lastYearEnd)).length;

  const openDate = ext?.open_date ? String(ext.open_date).slice(0, 10) : null;
  const yearsInBusiness = openDate ? daysBetweenStr(today, openDate) / 365.25 : null;

  const certifications: string[] = Array.isArray(ext?.certifications) ? (ext!.certifications as string[]) : [];
  const interests: string[] = Array.isArray(ext?.interests) ? (ext!.interests as string[]) : [];
  const priorGrants = Array.isArray(ext?.prior_grants) ? (ext!.prior_grants as { year?: number; name?: string }[]) : [];

  const cardFilled = [
    !!openDate,
    !!ext?.size_class,
    certifications.length > 0,
    ext?.has_export !== null && ext?.has_export !== undefined,
    !!ext?.ksic_main,
    priorGrants.length > 0,
    interests.length > 0,
  ].filter(Boolean).length;

  const region = regionOf(company?.address);
  const district = districtOf(company?.address);

  return {
    companyId,
    industry: company?.industry ?? null,
    businessType: company?.business_type ?? null,
    businessCategory: company?.business_category ?? null,
    region,
    isMetro: region ? METRO.includes(region) : null,
    headcount: active.length,
    headcountLastYearEnd,
    youngCount: young.length,
    newHires3m: newHires.length,
    youngNewHires3m: newHires.filter((e) => { const a = ageOf(e.birth_date, today); return a !== null && a <= 34; }).length,
    resigned3m: emps.filter((e) => within(e.resignation_date, 90)).length,
    insuredCount: active.filter((e) => e.is_4_insurance === true).length,
    lowPaidCount: active.filter((e) => Number(e.salary || 0) > 0 && Number(e.salary) < DURUNURI_PAY_CAP).length,
    contractCount: active.filter((e) => e.employment_type === "contract" || e.employment_type === "계약직").length,
    belowMinWage: active.filter((e) => Number(e.salary || 0) > 0 && Number(e.salary) < MIN_WAGE_MONTHLY_2026).length,
    salaryMissing: active.filter((e) => !e.salary).length,
    birthMissing: active.filter((e) => ageOf(e.birth_date, today) === null).length,
    seniorCount: active.filter((e) => { const a = ageOf(e.birth_date, today); return a !== null && a >= 60; }).length,
    openDate,
    yearsInBusiness,
    sizeClass: ext?.size_class ?? null,
    certifications,
    hasExport: ext?.has_export ?? null,
    district,
    ksicMain: ext?.ksic_main ?? null,
    priorGrants,
    interests,
    cardFilled,
  };
}

// ── 판정 규칙 ──────────────────────────────────────────────────────────────

const won = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`;

//   회사 카드 ⑦ 관심 분야 ↔ 공고 분야 이름. 관심 있다고 고른 갈래를 위로 올린다.
const INTEREST_FIELDS: Record<string, string[]> = {
  fund: ["금융", "융자", "정책자금", "자금"],
  people: ["인력", "고용"],
  tech: ["기술", "연구", "R&D"],
  export: ["수출", "글로벌", "해외"],
  market: ["내수", "판로", "마케팅"],
};
const man = (n: number) => `${Math.round(n / 10000).toLocaleString("ko-KR")}만원`;

/** 근거들을 모아 3단 판정으로 접는다 — ✕ 가 하나라도 있으면 해당 없음, ? 가 있으면 확인 필요 */
function fold(reasons: Reason[], estimate?: Judgement["estimate"]): Judgement {
  const verdict: Verdict =
    reasons.some((r) => r.mark === "no") ? "none"
    : reasons.some((r) => r.mark === "unknown") ? "check"
    : "high";
  //   해당 없음이면 금액을 계산해 봐야 의미가 없다(0원인데 숫자가 뜨면 오해한다)
  return { verdict, reasons, estimate: verdict === "none" ? undefined : estimate };
}

const ok = (text: string, src: Reason["src"] = "회사 자료"): Reason => ({ mark: "ok", text, src });
const no = (text: string, src: Reason["src"] = "회사 자료"): Reason => ({ mark: "no", text, src });
const unknown = (text: string, src: Reason["src"] = "회사 카드"): Reason => ({ mark: "unknown", text, src });

/** 직원이 아예 없으면 고용 기반 제도는 전부 해당 없음 — 경계값(0명) */
function needEmployees(p: CompanyProfile): Reason | null {
  return p.headcount === 0 ? no("등록된 재직 직원이 없습니다 — 직원을 먼저 등록해 주세요") : null;
}

type Rule = (p: CompanyProfile, program: GovProgram) => Judgement;

const RULES: Record<string, Rule> = {
  // ── 청년일자리도약장려금 ─────────────────────────────────────────────
  youth_leap: (p) => {
    const empty = needEmployees(p);
    if (empty) return fold([empty]);
    const rs: Reason[] = [];

    //   5인 이상이 원칙이지만 성장유망업종·벤처·청년창업기업은 5인 미만도 된다 → 미만이어도 잘라내지 않고 '확인'
    if (p.headcount >= 5) rs.push(ok(`상시 ${p.headcount}명 — 5인 이상`));
    else if (p.certifications.includes("venture")) rs.push(unknown(`상시 ${p.headcount}명 — 5인 미만이지만 벤처기업이라 예외 가능`, "회사 카드"));
    else rs.push(unknown(`상시 ${p.headcount}명 — 5인 미만. 성장유망업종·벤처·청년창업기업이면 예외`, "제도 요건"));

    if (p.youngNewHires3m > 0) rs.push(ok(`최근 3개월 만 34세 이하 신규 입사 ${p.youngNewHires3m}명`));
    else if (p.youngCount > 0) rs.push(unknown(`만 34세 이하 재직 ${p.youngCount}명 — 다만 최근 3개월 신규 채용은 없습니다`, "회사 자료"));
    else if (p.birthMissing > 0) rs.push(unknown(`생년월일이 없는 직원 ${p.birthMissing}명 — 나이를 몰라 청년 인원을 셀 수 없습니다`, "회사 자료"));
    else rs.push(no("만 34세 이하 직원이 없습니다 — 청년을 신규 채용할 때 대상이 됩니다"));
    if (p.youngCount > 0 && p.birthMissing > 0) {
      rs.push(unknown(`생년월일이 없는 직원 ${p.birthMissing}명은 청년 집계에서 빠져 있습니다 — 실제 대상이 더 많을 수 있습니다`, "회사 자료"));
    }

    if (p.resigned3m > 0) rs.push(unknown(`최근 3개월 퇴사 ${p.resigned3m}명 — 인위적 감원이면 제외됩니다(자발적 퇴사는 무관)`, "회사 자료"));
    else rs.push(ok("최근 3개월 감원 없음"));

    if (p.insuredCount > 0) rs.push(ok(`4대보험 가입 ${p.insuredCount}명`));
    else rs.push(unknown("4대보험 가입 표시가 된 직원이 없습니다 — 구성원 정보를 확인해 주세요", "회사 자료"));

    if (p.belowMinWage > 0) rs.push(unknown(`월 급여가 최저임금 월 환산액(${won(MIN_WAGE_MONTHLY_2026)}) 미만으로 적힌 직원 ${p.belowMinWage}명`, "회사 자료"));

    const n = p.youngNewHires3m;
    return fold(rs, n > 0 ? {
      amount: n * 7200000,
      text: `연 ${man(n * 7200000)} 예상`,
      basis: `만 34세 이하 신규 입사 ${n}명 × 1인당 연 최대 720만원`,
    } : undefined);
  },

  // ── 두루누리 사회보험료 지원 ─────────────────────────────────────────
  duruname: (p) => {
    const empty = needEmployees(p);
    if (empty) return fold([empty]);
    const rs: Reason[] = [];

    if (p.headcount < 10) rs.push(ok(`상시 ${p.headcount}명 — 10인 미만 사업장`));
    else rs.push(no(`상시 ${p.headcount}명 — 10인 이상이라 대상이 아닙니다`));

    //   두 사실을 다 적는다 — 급여 미입력만 말하면 "미입력만 채우면 되는구나"로 잘못 읽힌다
    if (p.lowPaidCount > 0) rs.push(ok(`월 보수 ${won(DURUNURI_PAY_CAP)} 미만 ${p.lowPaidCount}명`));
    else if (p.salaryMissing > 0) rs.push(unknown(`급여가 입력된 직원 중 월 보수 ${won(DURUNURI_PAY_CAP)} 미만이 없습니다 — 다만 급여 미입력 ${p.salaryMissing}명은 판단할 수 없습니다`, "회사 자료"));
    else rs.push(no(`월 보수 ${won(DURUNURI_PAY_CAP)} 미만인 직원이 없습니다`));
    if (p.lowPaidCount > 0 && p.salaryMissing > 0) {
      rs.push(unknown(`급여가 입력되지 않은 직원 ${p.salaryMissing}명 — 이 인원은 계산에서 빠져 있습니다`, "회사 자료"));
    }

    //   신규 가입 여부는 우리 자료로 알 수 없다 — 자동으로 못 푸는 것
    rs.push(unknown("신규 가입 근로자인지 여부 — 기존 가입자는 제외됩니다(공단 확인 필요)", "제도 요건"));

    const n = p.lowPaidCount;
    return fold(rs, n > 0 ? {
      amount: n * 240000 * 12,
      text: `월 최대 ${man(n * 240000)} 예상`,
      basis: `저임금 ${n}명 × 1인 월 최대 약 24만원(국민연금·고용보험 80%)`,
    } : undefined);
  },

  // ── 통합고용세액공제 ──────────────────────────────────────────────────
  integrated_tax_credit: (p) => {
    const rs: Reason[] = [];
    const net = p.headcount - p.headcountLastYearEnd;

    if (net > 0) rs.push(ok(`상시근로자 ${net}명 순증 — 작년 말 ${p.headcountLastYearEnd}명 → 현재 ${p.headcount}명`));
    else if (net === 0) rs.push(no(`상시근로자 순증이 없습니다 — 작년 말과 같은 ${p.headcount}명`));
    else rs.push(no(`상시근로자가 ${-net}명 줄었습니다 — 순증이어야 공제 대상입니다`));

    if (p.isMetro === null) rs.push(unknown("회사 주소가 없어 수도권·비수도권 단가를 정할 수 없습니다", "회사 자료"));
    else rs.push(ok(`${p.region} — ${p.isMetro ? "수도권" : "수도권 밖"} 단가 적용`));

    if (p.youngCount > 0 || p.seniorCount > 0) {
      rs.push(ok(`청년 ${p.youngCount}명 · 만 60세 이상 ${p.seniorCount}명 — 공제 단가가 더 높은 인원`));
    }
    rs.push(unknown("공제 후 인원이 줄면 추징됩니다 — 유지 계획을 세무대리인과 확인하세요", "제도 요건"));

    const unit = p.isMetro === false ? 15500000 : 14500000;
    return fold(rs, net > 0 ? {
      amount: net * unit,
      text: `최대 ${man(net * unit)} 예상`,
      basis: `순증 ${net}명 × 1인당 최대 ${man(unit)}(${p.isMetro === false ? "수도권 밖" : "수도권"})`,
    } : undefined);
  },

  // ── 정규직 전환 지원 ─────────────────────────────────────────────────
  regular_conversion: (p) => {
    const empty = needEmployees(p);
    if (empty) return fold([empty]);
    const rs: Reason[] = [];

    if (p.contractCount > 0) rs.push(ok(`계약직(기간제) 재직 ${p.contractCount}명 — 전환 대상 후보`));
    else rs.push(no("계약직(기간제)으로 등록된 직원이 없습니다"));

    rs.push(unknown("6개월 이상 근속한 기간제인지 · 전환 후 6개월 고용 유지가 가능한지 확인이 필요합니다", "제도 요건"));

    const n = p.contractCount;
    return fold(rs, n > 0 ? {
      amount: n * 6000000,
      text: `연 최대 ${man(n * 6000000)} 예상`,
      basis: `계약직 ${n}명 전환 가정 × 1인당 월 최대 50만원 × 12개월`,
    } : undefined);
  },

  // ── 유연근무 장려금 ──────────────────────────────────────────────────
  flexible_work: (p) => {
    const empty = needEmployees(p);
    if (empty) return fold([empty]);
    return fold([
      ok(`재직 ${p.headcount}명 — 활용 인원만큼 지원받습니다`),
      unknown("재택·원격·선택근무를 실제로 운영하고 근태로 증빙할 수 있어야 합니다(월 4일 이상)", "제도 요건"),
      unknown("우선지원대상기업 해당 여부 — 업종별 기준이 다릅니다", "제도 요건"),
    ]);
  },

  // ── 출산육아기 고용안정장려금 ────────────────────────────────────────
  parental_leave: (p) => {
    const empty = needEmployees(p);
    if (empty) return fold([empty]);
    return fold([
      ok(`재직 ${p.headcount}명`),
      unknown("육아휴직 또는 육아기 근로시간 단축을 30일 이상 허용한 사실이 있어야 합니다", "제도 요건"),
      unknown("우선지원대상기업 해당 여부", "제도 요건"),
    ]);
  },

  // ── 대체인력지원금 ───────────────────────────────────────────────────
  substitute_worker: (p) => {
    const empty = needEmployees(p);
    if (empty) return fold([empty]);
    return fold([
      p.newHires3m > 0
        ? ok(`최근 3개월 신규 입사 ${p.newHires3m}명 — 대체인력으로 채용한 건이 있는지 확인해 보세요`)
        : unknown("최근 3개월 신규 채용이 없습니다", "회사 자료"),
      unknown("출산휴가·육아휴직자의 빈 자리를 메우려고 채용한 인력이어야 합니다", "제도 요건"),
    ]);
  },

  // ── 고용촉진장려금 ───────────────────────────────────────────────────
  employment_promotion: (p) => {
    const empty = needEmployees(p);
    if (empty) return fold([empty]);
    const rs: Reason[] = [];
    if (p.newHires3m > 0) rs.push(ok(`최근 3개월 신규 입사 ${p.newHires3m}명`));
    else rs.push(unknown("최근 3개월 신규 채용이 없습니다 — 채용할 때 대상이 됩니다", "회사 자료"));
    rs.push(unknown("채용한 사람이 고용노동부 지정 취업지원 프로그램 이수자여야 합니다(우리 자료로는 알 수 없습니다)", "제도 요건"));
    if (p.resigned3m > 0) rs.push(unknown(`최근 3개월 퇴사 ${p.resigned3m}명 — 인위적 감원이면 제외됩니다`, "회사 자료"));
    else rs.push(ok("최근 3개월 감원 없음"));
    return fold(rs);
  },

  // ── 중소기업 취업자 소득세 감면 (직원이 받는 혜택) ───────────────────
  young_income_tax: (p) => {
    const empty = needEmployees(p);
    if (empty) return fold([empty]);
    const n = p.youngCount + p.seniorCount;
    const rs: Reason[] = [];
    if (n > 0) rs.push(ok(`감면 대상 후보 ${n}명 — 만 34세 이하 ${p.youngCount}명 · 만 60세 이상 ${p.seniorCount}명`));
    else if (p.birthMissing > 0) rs.push(unknown(`생년월일이 없는 직원 ${p.birthMissing}명 — 나이를 몰라 감면 대상을 셀 수 없습니다`, "회사 자료"));
    else rs.push(no("만 34세 이하 또는 만 60세 이상 직원이 없습니다"));
    rs.push(unknown("중소기업 해당 업종인지 확인이 필요합니다(전문서비스업 등 일부 업종 제외)", "제도 요건"));
    rs.push(ok("회사가 감면 신청서를 원천징수 관할 세무서에 내면 직원 소득세가 줄어듭니다", "제도 요건"));
    return fold(rs, n > 0 ? {
      amount: n * 2000000,
      text: `직원 ${n}명 · 연 최대 ${man(n * 2000000)}`,
      basis: `대상 ${n}명 × 1인 연 200만원 한도 (회사가 아니라 직원이 받는 혜택)`,
    } : undefined);
  },

  // ── K-Startup 공고 (수집형) ──────────────────────────────────────────
  //   공고 본문을 AI 로 읽지 않는다 — K-Startup 응답에 지역·업력·신청대상이 이미 갈려 있다.
  //   그 셋만 대조하고, 나머지(예산·평가항목·제외조항)는 공고 원문을 보게 한다.
  kstartup: (p, program) => {
    const el = (program.eligibility || {}) as Eligibility;
    const rs: Reason[] = [];
    let fit = 0;

    //   ⚠️ 기업마당의 regions 는 **해시태그에서 뽑은 것**이라 "그 지역 전용"이라는 보장이 없다.
    //     주관기관 소재지가 섞여 들어온다(울산테크노파크 → '울산'). 2026-08-21 실측:
    //     1,558건 중 1,556건이 지역한정으로 잡혔다 — 사실상 전부 오분류다.
    //     틀린 근거로 걸러 내면 진짜 기회를 놓치므로, 기업마당은 지역을 **참고로만** 쓴다.
    const regionIsHint = program.source === "bizinfo";
    const rgs = el.regions ?? [];

    if (regionIsHint) {
      if (rgs.length > 0) {
        rs.push(unknown(`${rgs.join("·")} 관련 표시가 있습니다 — 지역 제한은 공고 원문에서 확인하세요`, "제도 요건"));
      } else {
        rs.push(unknown("지역 제한은 공고 원문에서 확인하세요", "제도 요건"));
      }
      fit += 8;
    } else if (rgs.length === 0) {
      rs.push(ok("전국 대상 — 지역 제한 없음", "제도 요건"));
      fit += 10;
    } else if (!p.region) {
      rs.push(unknown(`${rgs.join("·")} 지역 사업 — 회사 주소가 없어 확인할 수 없습니다`, "회사 자료"));
      fit += 5;
    } else if (rgs.some((r) => r.includes(p.region!) || p.region!.includes(r))) {
      //   우리 지역 전용 사업은 전국 사업보다 **겨루는 곳이 적다** — 더 높이 친다
      rs.push(ok(`소재지 ${p.region} 전용 사업 — 전국 공모보다 경쟁이 적습니다`));
      fit += 15;
    } else {
      rs.push(no(`${rgs.join("·")} 지역 사업 — 소재지가 ${p.region} 입니다`));
    }

    // 업력 — 창업 N년 이내
    if (el.max_years == null) {
      rs.push(ok("업력 제한 없음", "제도 요건"));
      fit += 10;
    } else if (p.yearsInBusiness == null) {
      rs.push(unknown(`창업 ${el.max_years}년 이내 대상 — 개업일이 없어 확인할 수 없습니다(회사 카드 ①)`, "회사 카드"));
      fit += 5;
    } else if (p.yearsInBusiness <= el.max_years) {
      rs.push(ok(`업력 ${p.yearsInBusiness.toFixed(1)}년 — 창업 ${el.max_years}년 이내`));
      fit += 15;
    } else {
      rs.push(no(`창업 ${el.max_years}년 이내 대상 — 업력이 ${p.yearsInBusiness.toFixed(1)}년입니다`));
    }

    // 신청 대상 — 기업이 낄 자리가 있는가
    const targets = el.targets ?? [];
    const forBiz = targets.some((t) => /기업|사업자|법인|창업기업|소상공인/.test(t));
    const onlyPre = targets.length > 0 && !forBiz && targets.some((t) => /예비창업|일반인|대학생|청소년/.test(t));
    if (targets.length === 0) {
      rs.push(unknown("신청 대상이 적혀 있지 않습니다 — 공고 원문을 확인하세요", "제도 요건"));
      fit += 5;
    } else if (forBiz) {
      rs.push(ok(`신청 대상에 기업 포함 (${targets.slice(0, 4).join("·")}${targets.length > 4 ? " 외" : ""})`, "제도 요건"));
      fit += 10;
    } else if (onlyPre) {
      rs.push(no(`예비창업자·개인 대상입니다 (${targets.slice(0, 4).join("·")})`));
    } else {
      rs.push(unknown(`신청 대상: ${targets.slice(0, 4).join("·")} — 우리 회사가 해당되는지 확인하세요`, "제도 요건"));
      fit += 5;
    }

    //   회사 카드 ⑦ 관심 분야 — 사장님이 보겠다고 고른 갈래를 위로 올린다.
    //   이게 수천 건을 실제로 가르는 유일한 축이다(지역·업력이 안 갈리는 공고가 대부분이라).
    const field = String(program.field ?? "");
    const wanted = p.interests.flatMap((i) => INTEREST_FIELDS[i] ?? []);
    if (wanted.length > 0 && field && wanted.some((w) => field.includes(w))) {
      rs.push(ok(`관심 분야로 고르신 '${field}' 사업입니다`, "회사 카드"));
      fit += 15;
    } else if (p.interests.length === 0) {
      rs.push(unknown("회사 카드에서 관심 분야를 고르면 그 갈래를 위로 올려 드립니다(⑦)", "회사 카드"));
    }

    if (el.exclude) rs.push(unknown("신청 제외 대상이 있습니다 — 공고 원문에서 확인하세요", "제도 요건"));

    const j = fold(rs);
    return { ...j, fitScore: j.verdict === "none" ? 0 : Math.min(50, fit) };
  },

  //   기업마당 공고 — 보는 축이 K-Startup 과 같다(지역·업력·대상). 규칙을 따로 둘 이유가 없어 같이 쓴다.
  //   기업마당은 업력 칸이 없어 max_years 가 늘 null 이고, 그 줄은 '업력 제한 없음'으로 나온다.
  bizinfo: (p, program) => RULES.kstartup(p, program),

  // ── 장애인 고용장려금 ────────────────────────────────────────────────
  disability_employment: (p) => {
    const empty = needEmployees(p);
    if (empty) return fold([empty]);
    return fold([
      ok(`상시 ${p.headcount}명`),
      unknown("장애인 근로자 고용 여부는 우리 자료에 없습니다 — 고용하고 계시면 공단에 신청하세요", "제도 요건"),
      unknown("의무고용률을 초과해야 장려금이 나옵니다", "제도 요건"),
    ]);
  },
};

/**
 * 제도 하나를 회사 프로필과 대조한다.
 *   규칙이 없는 건(공고형 Phase 1.5 이후)은 '조건 확인 필요'로 두고 원문을 읽게 한다 —
 *   모르는 것을 아는 척하지 않는다.
 */
export function judge(program: GovProgram, profile: CompanyProfile): Judgement {
  //   접수가 끝난 건 규칙을 볼 것도 없다 — 자격이 맞아도 신청할 수 없다
  const left = daysLeft(program.apply_end);
  if (left !== null && left < 0) {
    return {
      verdict: "none",
      reasons: [{ mark: "no", text: `접수가 끝났습니다 (마감 ${program.apply_end?.slice(0, 10)})`, src: "제도 요건" }],
    };
  }
  //   AI 조건표가 있으면 그것으로 엄격 대조 (2026-09-03 사장님: "터무니없는 것도 가능성 높음" — 원문 요건으로 걸러낸다)
  if (program.eligibility_ai && typeof program.eligibility_ai === "object") {
    try { return judgeAi(program.eligibility_ai, profile); } catch { /* 아래 규칙으로 */ }
  }
  const rule = program.rule_key ? RULES[program.rule_key] : undefined;
  if (!rule) {
    return {
      verdict: "check",
      reasons: [{ mark: "unknown", text: "자격 요건을 자동으로 대조하지 못했습니다 — 공고 원문을 확인해 주세요", src: "제도 요건" }],
    };
  }
  try {
    return rule(profile, program);
  } catch {
    //   규칙이 터져도 화면이 죽으면 안 된다 — 모르는 것으로 내린다
    return {
      verdict: "check",
      reasons: [{ mark: "unknown", text: "자격 대조 중 문제가 생겼습니다 — 공고 원문을 확인해 주세요", src: "제도 요건" }],
    };
  }
}


/**
 * AI 조건표 기반 엄격 판정.
 *   ✕ 하나라도 있으면 '해당 없음'. 핵심 4가지(지역·업종·기업형태·업력)가 모두 확인돼 맞을 때만 '가능성 높음'.
 *   모르는 게 남으면 '조건 확인' — 무엇을 확인해야 하는지 줄로 적는다. 관심 분야는 순서(점수)에만 쓴다.
 */
const SIZE_LABEL: Record<string, string> = { small_biz: "소상공인", small: "소기업", medium: "중기업" };
const CERT_LABEL: Record<string, string> = { venture: "벤처기업", innobiz: "이노비즈", mainbiz: "메인비즈", lab: "기업부설연구소", woman: "여성기업", disabled: "장애인기업", social: "사회적기업" };
const ev = (t: string | undefined) => (t && t.trim() ? ` — 공고: “${t.trim().slice(0, 70)}${t.trim().length > 70 ? "…" : ""}”` : "");

export function judgeAi(ai: AiEligibility, p: CompanyProfile): Judgement {
  const rs: Reason[] = [];
  let fit = 0;
  let coreUnknown = 0;

  // 지역
  if (ai.region_scope === "nationwide") { rs.push(ok("전국 대상 — 지역 제한 없음", "제도 요건")); fit += 10; }
  else if (ai.region_scope === "restricted") {
    const rg = ai.regions || [];
    if (!p.region) { rs.push(unknown(`${rg.join("·") || "특정 지역"} 소재 기업 대상 — 회사 주소가 없어 확인할 수 없습니다(회사 설정 › 회사정보)`, "회사 자료")); coreUnknown++; }
    else if (rg.length === 0 || rg.some((r) => r === p.region || r.includes(p.region!) || p.region!.includes(r))) {
      const ds = ai.districts || [];
      if (ds.length > 0) {
        if (!p.district) { rs.push(unknown(`${p.region} 안에서도 ${ds.slice(0, 3).join("·")} 소재 기업만 대상 — 회사 주소에 시·군·구가 없어 확인할 수 없습니다(회사 설정 › 회사정보)`, "회사 자료")); coreUnknown++; fit += 8; }
        else if (ds.some((d) => distKey(d) === distKey(p.district!))) { rs.push(ok(`${p.district} 소재 기업 전용 — 우리 회사가 해당됩니다${ev(ai.evidence?.region)}`)); fit += 18; }
        else rs.push(no(`${ds.slice(0, 3).join("·")} 소재 기업만 대상 — 우리는 ${p.region} ${p.district}입니다${ev(ai.evidence?.region)}`));
      }
      else { rs.push(ok(`소재지 ${p.region} 대상 사업 — 전국 공모보다 경쟁이 적습니다${ev(ai.evidence?.region)}`)); fit += 15; }
    } else rs.push(no(`${rg.join("·")} 소재 기업 대상 — 우리 소재지는 ${p.region}입니다${ev(ai.evidence?.region)}`));
  } else { rs.push(unknown("지역 제한이 공고에 명시돼 있지 않습니다 — 원문에서 확인하세요", "제도 요건")); coreUnknown++; fit += 5; }

  // 업종
  if (ai.industry_scope === "any") { rs.push(ok("업종 제한 없음", "제도 요건")); fit += 8; }
  else if (ai.industry_scope === "restricted") {
    const inds = ai.industries || [];
    if (!p.ksicMain) { rs.push(unknown(`${ai.industry_note || inds.join("·")} 업종 대상 — 회사 카드에 업종(표준산업분류)을 채우면 자동 확인됩니다`, "회사 카드")); coreUnknown++; }
    else if (inds.includes(p.ksicMain)) { rs.push(ok(`업종 ${p.ksicMain} 대상에 포함${ev(ai.evidence?.industry)}`)); fit += 12; }
    else rs.push(no(`${ai.industry_note || inds.join("·")} 업종 대상 — 우리 업종은 ${p.ksicMain}입니다${ev(ai.evidence?.industry)}`));
  } else { rs.push(unknown("업종 제한이 공고에 명시돼 있지 않습니다", "제도 요건")); coreUnknown++; fit += 4; }

  // 기업 형태
  const types = ai.company_types || [];
  const mine = p.sizeClass ? SIZE_LABEL[p.sizeClass] ?? null : null;
  const smeOk = types.includes("중소기업") || (mine && types.includes(mine)) || (types.includes("소상공인") && mine === "소상공인");
  const onlyPre = types.length > 0 && types.every((t) => ["예비창업자", "개인", "대학·연구기관", "농어업인", "비영리"].includes(t));
  const bigOnly = types.length > 0 && types.every((t) => ["중견기업", "대기업"].includes(t));
  if (types.length === 0) { rs.push(unknown("신청 가능한 기업 형태가 공고에 명시돼 있지 않습니다", "제도 요건")); coreUnknown++; fit += 4; }
  else if (onlyPre) rs.push(no(`${types.join("·")} 대상입니다 — 운영 중인 회사는 해당 없음${ev(ai.evidence?.company_type)}`));
  else if (bigOnly) rs.push(no(`${types.join("·")} 대상입니다${ev(ai.evidence?.company_type)}`));
  else if (smeOk) { rs.push(ok(`신청 대상에 ${mine && types.includes(mine) ? mine : "중소기업"} 포함${ev(ai.evidence?.company_type)}`, "제도 요건")); fit += 8; }
  else if (types.includes("창업기업")) { rs.push(unknown(`창업기업 대상 — 아래 업력 조건으로 판단합니다${ev(ai.evidence?.company_type)}`, "제도 요건")); fit += 4; }
  else if (!mine && types.some((t) => ["소상공인", "소기업", "중기업"].includes(t))) { rs.push(unknown(`${types.join("·")} 대상 — 회사 카드에 기업 규모를 고르면 자동 확인됩니다`, "회사 카드")); coreUnknown++; }
  else rs.push(no(`${types.join("·")} 대상 — 우리는 ${mine ?? "중소기업"}입니다${ev(ai.evidence?.company_type)}`));

  // 업력
  if (ai.max_years == null && ai.min_years == null) { rs.push(ok("업력 제한 없음", "제도 요건")); fit += 6; }
  else if (p.yearsInBusiness == null) { rs.push(unknown(`업력 조건(${ai.max_years != null ? `창업 ${ai.max_years}년 이내` : ""}${ai.min_years != null ? ` ${ai.min_years}년 이상` : ""}) — 회사 카드에 개업일을 채우면 자동 확인됩니다`, "회사 카드")); coreUnknown++; }
  else if (ai.max_years != null && p.yearsInBusiness > ai.max_years) rs.push(no(`창업 ${ai.max_years}년 이내 대상 — 업력이 ${p.yearsInBusiness.toFixed(1)}년입니다${ev(ai.evidence?.years)}`));
  else if (ai.min_years != null && p.yearsInBusiness < ai.min_years) rs.push(no(`업력 ${ai.min_years}년 이상 대상 — 업력이 ${p.yearsInBusiness.toFixed(1)}년입니다${ev(ai.evidence?.years)}`));
  else { rs.push(ok(`업력 ${p.yearsInBusiness.toFixed(1)}년 — 조건 충족${ev(ai.evidence?.years)}`)); fit += 12; }

  // 인원·매출·인증·제외
  if (ai.employees_max != null && p.headcount > 0 && p.headcount > ai.employees_max) rs.push(no(`상시 ${ai.employees_max}명 이하 대상 — 우리는 ${p.headcount}명입니다`));
  else if (ai.employees_min != null && p.headcount > 0 && p.headcount < ai.employees_min) rs.push(no(`상시 ${ai.employees_min}명 이상 대상 — 우리는 ${p.headcount}명입니다`));
  else if ((ai.employees_max != null || ai.employees_min != null) && p.headcount === 0) rs.push(unknown("상시근로자 조건이 있는데 구성원 자료가 없습니다", "회사 자료"));
  if (ai.revenue_max_krw != null) rs.push(unknown(`매출 ${Math.round(ai.revenue_max_krw / 1e8)}억 원 이하 조건 — 원문에서 기준 연도를 확인하세요`, "제도 요건"));
  if (ai.requires_export === true) {
    if (p.hasExport === true) { rs.push(ok(`수출 실적 있는 기업 대상 — 회사 카드에 수출 있음${ev(ai.evidence?.export)}`, "회사 카드")); fit += 5; }
    else if (p.hasExport === false) rs.push(no(`수출 실적 있는 기업 대상 — 회사 카드에 수출 없음으로 표시돼 있습니다${ev(ai.evidence?.export)}`));
    else { rs.push(unknown(`수출 실적 있는 기업 대상 — 회사 카드 ⑥에서 수출 여부를 고르면 자동 확인됩니다${ev(ai.evidence?.export)}`, "회사 카드")); coreUnknown++; }
  }
  const certs = ai.required_certs || [];
  if (certs.length > 0) {
    const have = certs.filter((c) => p.certifications.includes(c));
    if (have.length > 0) { rs.push(ok(`필수 인증 보유 (${have.map((c) => CERT_LABEL[c] ?? c).join("·")})`, "회사 카드")); fit += 5; }
    else rs.push(unknown(`${certs.map((c) => CERT_LABEL[c] ?? c).join("·")} 인증이 필요합니다 — 보유하셨다면 회사 카드에 표시하세요`, "회사 카드"));
  }
  for (const x of (ai.exclusions || []).slice(0, 2)) rs.push(unknown(`제외 대상: ${x.slice(0, 80)}`, "제도 요건"));

  // 관심 분야 — 순서에만 영향
  const wantedField = p.interests.length > 0 ? p.interests : [];
  if (wantedField.length > 0) fit += 4;

  const hasNo = rs.some((r) => r.mark === "no");
  const verdict: Verdict = hasNo ? "none" : coreUnknown === 0 && (ai.confidence ?? 0) >= 0.6 ? "high" : "check";
  if (!hasNo && verdict === "check" && (ai.confidence ?? 0) < 0.6) rs.push(unknown("공고 본문이 짧아 조건표의 확신이 낮습니다 — 원문을 확인하세요", "제도 요건"));
  return { verdict, reasons: rs, fitScore: verdict === "none" ? 0 : Math.min(50, fit) };
}

// ── 적합도 ────────────────────────────────────────────────────────────────

/**
 * 적합도 — **우선순위를 정하는 점수** (2026-08-21 사장님 지시:
 *   "가장 적합하거나 바로 신청할 수 있는 것이 상단으로, 적합도를 평가해주는 것")
 *
 * ★ 점수만 내놓지 않는다. 세 갈래로 나누고 무엇 때문에 깎였는지 줄로 적는다 —
 *   "87점"만 보여 주면 틀렸을 때 어디가 틀렸는지 짚을 수 없다.
 *
 *   자격 50 — 우리 회사가 요건에 맞는가 (✕ 가 하나라도 있으면 전체 0점)
 *   서류 30 — 지금 낼 수 있는 서류가 몇 개나 준비돼 있는가
 *   신청 20 — 지금 접수 중인가, 온라인으로 되는가, 마감까지 여유가 있는가
 */
export type FitScore = {
  total: number;
  fit: number;
  docs: number;
  ease: number;
  /** 자격 ✕ 없음 + 서류 전부 준비 + 접수 중 → 목록에 '지금 신청 가능' 으로 뜬다 */
  ready: boolean;
  lines: string[];
};

export function scoreProgram(
  program: GovProgram,
  judgement: Judgement,
  checks: DocCheck[],
  today = todayKst(),
): FitScore {
  const lines: string[] = [];

  // ── 자격 50 ──
  let fit = 0;
  if (judgement.verdict === "none") {
    return { total: 0, fit: 0, docs: 0, ease: 0, ready: false, lines: ["자격 요건에 맞지 않습니다"] };
  }
  const okN = judgement.reasons.filter((r) => r.mark === "ok").length;
  const unkN = judgement.reasons.filter((r) => r.mark === "unknown").length;
  if (typeof judgement.fitScore === "number") {
    //   규칙이 직접 매긴 점수 — 공고처럼 건수가 많을 때 ✓ 개수만으로는 순위가 안 갈린다
    fit = judgement.fitScore;
    lines.push(`자격 ${fit}/50 — 지역·업력·대상·관심 분야를 따져 매겼습니다`);
  } else if (judgement.verdict === "high") {
    fit = 50;
    lines.push("자격 50/50 — 확인 가능한 요건을 모두 충족");
  } else {
    //   모르는 값이 섞여 있다 — 아는 것의 비율만큼 준다. 바닥은 15점(전부 모른다고 0점이면 목록에서 사라진다)
    fit = Math.max(15, Math.round((okN / Math.max(1, okN + unkN)) * 50));
    lines.push(`자격 ${fit}/50 — 확인됨 ${okN}가지 · 확인 필요 ${unkN}가지`);
  }

  // ── 서류 30 ──
  const needed = requiredDocsOf(program);
  let docs = 15;
  if (needed.length === 0) {
    lines.push("서류 15/30 — 필요 서류를 아직 모릅니다(공고 원문 확인)");
  } else {
    const have = readyCount(checks);
    docs = Math.round((have / needed.length) * 30);
    lines.push(`서류 ${docs}/30 — ${needed.length}가지 중 ${have}가지가 보관함에 있습니다`);
  }

  // ── 신청 20 ──
  let ease = 0;
  const left = daysLeft(program.apply_end);
  const started = !program.apply_start || program.apply_start.slice(0, 10) <= today;
  const open = started && (left === null || left >= 0);

  if (left === null) { ease += 10; lines.push("신청 +10 — 상시 접수(마감 없음)"); }
  else if (!started) { ease += 4; lines.push(`신청 +4 — 아직 접수 전 (${program.apply_start?.slice(5, 10)} 시작)`); }
  else { ease += 10; lines.push("신청 +10 — 접수 중"); }

  const el = (program.eligibility || {}) as Eligibility;
  if (el.online) { ease += 5; lines.push("신청 +5 — 온라인 접수"); }

  if (left !== null && left >= 0) {
    if (left >= 14) { ease += 5; lines.push(`신청 +5 — 마감까지 ${left}일 여유`); }
    else if (left >= 7) { ease += 3; lines.push(`신청 +3 — 마감까지 ${left}일`); }
    else { ease += 1; lines.push(`신청 +1 — 마감이 ${left}일 남아 급합니다`); }
  }

  const shortDocs = needed.length > 0 && readyCount(checks) < needed.length;
  //   verdict none 은 위에서 이미 돌려보냈다 — 여기 오면 자격에 ✕ 는 없다
  const ready = open && !shortDocs && needed.length > 0;

  return { total: Math.min(100, fit + docs + ease), fit, docs, ease, ready, lines };
}

/** 마감까지 남은 날 — null 이면 상시(마감 없음) */
export function daysLeft(applyEnd: string | null): number | null {
  if (!applyEnd) return null;
  return daysBetweenStr(applyEnd.slice(0, 10), todayKst());
}

// ── 조회·저장 ──────────────────────────────────────────────────────────────

export async function listPrograms(): Promise<GovProgram[]> {
  const { data, error } = await supabase
    .from("gov_programs")
    .select("id, source, title, org, field, support_type, summary, requirement, amount_text, amount_max, detail_url, apply_start, apply_end, rule_key, status, sort_order, eligibility_ai, eligibility, required_docs")
    .eq("status", "open")
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (data || []) as GovProgram[];
}

/** 공고를 마지막으로 언제 받았나 — 화면에 적어 둔다(목록이 비어 보일 때 원인을 알 수 있게) */
export async function lastSyncAt(): Promise<string | null> {
  const { data } = await supabase
    .from("gov_sync_log")
    .select("started_at")
    .eq("ok", true)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.started_at ?? null;
}

/**
 * 이 회사가 인증키를 넣어 둔 공고 원천 — 넣지 않았으면 공고는 보이지 않는다
 *   (2026-08-21 사장님 지시: "회사가 자기 키를 넣었을 때만 쓸 수 있게").
 *   상시 제도(source='always')는 API 가 필요 없으므로 키와 무관하게 늘 보인다.
 */
export async function connectedSources(companyId: string): Promise<string[]> {
  const { data } = await supabase
    .from("company_api_keys")
    .select("provider")
    .eq("company_id", companyId)
    .eq("status", "ok");
  return (data || []).map((r) => String(r.provider));
}

export async function listSaved(companyId: string): Promise<SavedRow[]> {
  const { data, error } = await supabase
    .from("gov_program_saved")
    .select("id, program_id, status, memo, assignee_id, due_date")
    .eq("company_id", companyId);
  if (error) throw error;
  return (data || []) as SavedRow[];
}

export async function saveProgram(companyId: string, programId: string, userId: string | null) {
  const { error } = await supabase.from("gov_program_saved").insert({
    company_id: companyId, program_id: programId, status: "saved", created_by: userId,
  });
  if (error) throw error;
}

export async function unsaveProgram(companyId: string, programId: string) {
  const { error } = await supabase.from("gov_program_saved")
    .delete().eq("company_id", companyId).eq("program_id", programId);
  if (error) throw error;
}

export async function setSavedStatus(id: string, status: string) {
  const { error } = await supabase.from("gov_program_saved")
    .update({ status, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

export type ProfileExtInput = {
  open_date: string | null;
  size_class: string | null;
  certifications: string[];
  has_export: boolean | null;
  ksic_main: string | null;
  prior_grants: { year?: number; name?: string }[];
  interests: string[];
};

export async function saveProfileExt(companyId: string, userId: string | null, input: ProfileExtInput) {
  const { error } = await supabase.from("company_profile_ext").upsert({
    company_id: companyId,
    ...input,
    prior_grants: input.prior_grants as never,
    updated_at: new Date().toISOString(),
    updated_by: userId,
  }, { onConflict: "company_id" });
  if (error) throw error;
}

export async function loadProfileExt(companyId: string): Promise<ProfileExtInput> {
  const { data } = await supabase.from("company_profile_ext").select("*").eq("company_id", companyId).maybeSingle();
  return {
    open_date: data?.open_date ? String(data.open_date).slice(0, 10) : null,
    size_class: data?.size_class ?? null,
    certifications: Array.isArray(data?.certifications) ? (data!.certifications as string[]) : [],
    has_export: data?.has_export ?? null,
    ksic_main: data?.ksic_main ?? null,
    prior_grants: Array.isArray(data?.prior_grants) ? (data!.prior_grants as { year?: number; name?: string }[]) : [],
    interests: Array.isArray(data?.interests) ? (data!.interests as string[]) : [],
  };
}

// ── 회사 카드 선택지 ───────────────────────────────────────────────────────

export const SIZE_CLASSES = [
  { value: "small_biz", label: "소상공인", desc: "제조업 10인 미만 · 그 밖의 업종 5인 미만" },
  { value: "small", label: "소기업", desc: "업종별 매출액 기준 (10억~120억 이하)" },
  { value: "medium", label: "중기업", desc: "중소기업 중 소기업이 아닌 곳" },
] as const;

export const CERTIFICATIONS = [
  { value: "venture", label: "벤처기업" },
  { value: "innobiz", label: "이노비즈(기술혁신형)" },
  { value: "mainbiz", label: "메인비즈(경영혁신형)" },
  { value: "lab", label: "기업부설연구소·연구전담부서" },
  { value: "woman", label: "여성기업" },
  { value: "disabled", label: "장애인기업" },
  { value: "social", label: "사회적기업" },
] as const;

export const INTERESTS = [
  { value: "fund", label: "자금" },
  { value: "people", label: "인력" },
  { value: "tech", label: "기술" },
  { value: "export", label: "수출" },
  { value: "market", label: "판로" },
] as const;

//   표준산업분류 대분류 — 지원사업이 실제로 나뉘는 단위까지만. 세분류는 사람이 못 고른다.
export const KSIC_MAIN = [
  "제조업", "정보통신업", "도매 및 소매업", "건설업", "전문·과학 및 기술 서비스업",
  "숙박 및 음식점업", "운수 및 창고업", "사업시설관리·사업지원 및 임대 서비스업",
  "교육 서비스업", "보건업 및 사회복지 서비스업", "예술·스포츠 및 여가관련 서비스업",
  "농업·임업 및 어업", "부동산업", "금융 및 보험업", "그 밖의 업종",
] as const;
