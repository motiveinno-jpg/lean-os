// 계정과목의 **성격**과 **재무제표 자리**를 판정한다 (2026-08-10 사장님 지적:
//   "손익계산서 판매비와관리비에 미지급금이 나온다 — 계정 성격에 따라 정확히 표기되는지 확인").
//
//   원인은 단순했다. 통장 출금에 붙은 분류(category)는 **그냥 글자**였고, 손익계산서는 그 글자를
//   전부 판관비로 더했다. 그래서 부채 계정인 '미지급금' 으로 분류한 출금이 비용 자리에 앉았다.
//   반대로 예전 키워드 제외목록("세금" 포함) 때문에 진짜 비용인 '세금과공과' 는 판관비에서 빠졌다.
//
//   여기서는 회사 계정과목표(chart_of_accounts)를 **단일 기준**으로 삼는다.
//     · account_type → 성격(자산·부채·자본·수익·비용)
//     · code        → 손익계산서 자리. 한국 표준 계정체계를 그대로 쓴다.
//         40x~44x 매출 · 45x·5xx 매출원가 · 8xx 판매비와관리비
//         9xx 영업외수익/영업외비용 · 998 법인세비용
//   계정과목표에 없는 옛 분류 글자(통장 동기화·AI 자동분류가 남긴 '이체'·'카드대금' 등)만
//   이름 키워드로 되짚는다.

import { supabase } from "@/lib/supabase";

export type AccountNature = "asset" | "liability" | "equity" | "revenue" | "expense";

/** 손익계산서 안에서의 자리. null = 손익계산서 항목이 아님(재무상태표로 간다) */
export type PnlSection = "revenue" | "cogs" | "opex" | "nonop_income" | "nonop_expense" | "tax" | null;

export const NATURE_LABEL: Record<AccountNature, string> = {
  asset: "자산", liability: "부채", equity: "자본", revenue: "수익", expense: "비용",
};

export const SECTION_LABEL: Record<Exclude<PnlSection, null>, string> = {
  revenue: "매출액", cogs: "매출원가", opex: "판매비와관리비",
  nonop_income: "영업외수익", nonop_expense: "영업외비용", tax: "법인세비용",
};

export interface AccountInfo {
  name: string;
  code: string | null;
  nature: AccountNature;
  section: PnlSection;
  /** 계정과목표에서 찾은 것인지(false = 이름 키워드로 추정) */
  known: boolean;
}

/* ------------------------------------------------------------------ */
/*  코드 → 손익계산서 자리 (한국 표준 계정체계)                          */
/* ------------------------------------------------------------------ */
function sectionByCode(code: string | null, nature: AccountNature): PnlSection {
  if (nature === "asset" || nature === "liability" || nature === "equity") return null;
  const n = parseInt(String(code || "").replace(/\D/g, ""), 10);
  if (!Number.isFinite(n)) return nature === "revenue" ? "revenue" : "opex";
  if (nature === "revenue") return n >= 900 ? "nonop_income" : "revenue";
  if (n === 998) return "tax";                 // 법인세비용
  if (n >= 900) return "nonop_expense";        // 931 이자비용 · 933 기부금 · 980 잡손실 …
  if (n >= 800) return "opex";                 // 801~848 판매비와관리비
  return "cogs";                               // 451 매출원가 · 501 매입
}

/* ------------------------------------------------------------------ */
/*  계정과목표에 없는 옛 분류 글자 되짚기                                */
/* ------------------------------------------------------------------ */
//   자금이 오갔을 뿐 손익이 아닌 것들 — 통장 동기화가 남기던 자유 문자열.
const FALLBACK_NATURE: Array<[AccountNature, string[]]> = [
  ["asset", ["이체", "송금", "인출", "예금", "예치", "보증금", "선급", "대여금", "가지급", "미수"]],
  ["liability", ["대출", "상환", "차입", "카드대금", "카드이용대금", "미지급", "예수금", "부가세", "가수금", "선수"]],
];
//   비용이지만 판관비가 아닌 것 — 이름만 남은 경우.
const FALLBACK_NONOP = ["이자비용", "지급이자", "기부금", "잡손실", "처분손실", "외환차손"];
const FALLBACK_TAX = ["법인세"];

function guessByName(name: string): AccountInfo {
  const n = name.trim();
  for (const [nature, kws] of FALLBACK_NATURE) {
    if (kws.some((k) => n.includes(k))) return { name: n, code: null, nature, section: null, known: false };
  }
  if (FALLBACK_TAX.some((k) => n.includes(k))) return { name: n, code: null, nature: "expense", section: "tax", known: false };
  if (FALLBACK_NONOP.some((k) => n.includes(k))) return { name: n, code: null, nature: "expense", section: "nonop_expense", known: false };
  //   모르는 이름은 **판관비로 둔다** — 회사가 직접 만든 비용 항목을 손익에서 통째로 빠뜨리지 않기 위해서다.
  return { name: n, code: null, nature: "expense", section: "opex", known: false };
}

/* ------------------------------------------------------------------ */
/*  조회                                                               */
/* ------------------------------------------------------------------ */
export type AccountMap = Map<string, AccountInfo>;

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "");

/** 회사 계정과목표를 이름·코드로 찾을 수 있게 편다 */
export async function getAccountMap(companyId: string): Promise<AccountMap> {
  const map: AccountMap = new Map();
  if (!companyId) return map;
  const { data } = await supabase
    .from("chart_of_accounts")
    .select("code, name, account_type")
    .eq("company_id", companyId);
  for (const a of (data as any[]) || []) {
    const nature = (a.account_type || "expense") as AccountNature;
    const info: AccountInfo = {
      name: a.name, code: a.code ? String(a.code) : null,
      nature, section: sectionByCode(a.code, nature), known: true,
    };
    map.set(norm(a.name), info);
    if (a.code) map.set(norm(String(a.code)), info);
  }
  return map;
}

/** 분류 글자 하나를 계정으로 판정 — 계정과목표 먼저, 없으면 이름 키워드 */
export function classifyAccount(category: string | null | undefined, map: AccountMap): AccountInfo | null {
  const raw = (category || "").trim();
  if (!raw) return null;
  return map.get(norm(raw)) || guessByName(raw);
}

/** 손익계산서에 실리는가 (자산·부채·자본 계정이면 아니다) */
export const isPnlAccount = (a: AccountInfo | null): boolean => !!a && a.section !== null;
