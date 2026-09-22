// 현금흐름표(직접법) — 통장 거래 기준 (2026-09-22 ERP 공백 2차 ④, docs/20260921_PLAN_erp_gap_audit2.md)
//
//   History — 재무제표 3종 중 현금흐름표만 없었다. 경영 요약에 '순현금흐름' 숫자 하나뿐.
//   원천 선택: 손익·재무상태표처럼 **확정 전표**로 만들면 현금 계정 줄이 모티브 올해 8건뿐이라 표가 빈다(통장 거래는 3,565건).
//   그래서 이 표만은 **통장 거래**로 만든다 — 경영용 직접법. 화면에 '전표 기준이 아니다'를 적는다.
//
//   기준(무엇으로 판단하나) — 통장 줄 하나를 활동 하나·줄 하나에 넣고, **근거(basis)** 를 같이 남긴다.
//   판정 순서(앞이 이긴다):
//     ① 세금·공과 키워드(국세·지방세·건강보험·국민연금…) — '국세_주식회사모티브'처럼 회사 이름이 섞여도 세금이 먼저
//     ② 계좌 간 이체: 상대가 우리 회사 이름(㈜·주식회사·공백 뺀 줄기) → 표에서 뺀다(돈이 회사 밖으로 안 나갔다)
//     ③ 전표 연결(journal_entry_id): 전표의 현금 아닌 계정 코드로 활동을 정한다(가장 믿을 만한 근거)
//     ④ 대출 상환 연결(loan_payments.bank_transaction_id) → 재무 · 대출 상환
//     ⑤ 정산 연결(settlement_status ≠ open / tax_invoice_id) → 영업 · 매출 입금 / 매입 지급
//     ⑥ 직원 이름 = 상대 → 영업 · 급여
//     ⑦ 대표 이름 = 상대, '가수금·가지급' → 재무 · 대표 가수금
//     ⑧ 키워드: 카드·체크·가승인 → 카드 대금 / 재정정보원·보조금·지원금 → 정부 지원금 / 대출·차입·원리금 → 재무 /
//        보증금·대여금 → 투자 / 자본금·증자·배당 → 재무 / 수수료·뱅킹·KFTC → 수수료 / 이자 → 이자
//     ⑨ 통장 분류(category·classification) 글자 → 급여·카드·가수금·경비
//     ⑩ 거래처가 붙어 있으면 매출 입금·매입 지급, 아니면 **기타 입금·기타 지급**(근거 없음 — 배너로 센다)
//   · 기초·기말 현금 = 통장 잔액 합(지금) 에서 기간 뒤 순증감을 되돌린 값. 숨긴 계좌는 뺀다.
//   · 자동으로 못 푸는 것: 근거 없는 줄. 사람이 통장 화면에서 분류·거래처·전표를 붙이면 다음 조회부터 자리를 찾는다 — 표에 적는다.

import { supabase } from "@/lib/supabase";
import { fetchPaged } from "@/lib/fetch-paged";
import { chunkedIn } from "@/lib/chunked-in";
import { getAccountMap } from "@/lib/account-nature";
import { todayKst, addDaysStr } from "@/lib/kst";

export type Activity = "op" | "inv" | "fin" | "xfer";
export type LineKey =
  | "sales_in" | "grant_in" | "interest_in" | "other_in"
  | "purchase_out" | "payroll" | "card" | "tax" | "fee" | "grant_out" | "other_out"
  | "asset_buy" | "asset_sell" | "deposit_out" | "deposit_in"
  | "loan_in" | "loan_repay" | "owner_in" | "owner_out" | "equity_in" | "equity_out"
  | "xfer";

export type CfLine = { key: LineKey; activity: Activity; label: string; dir: "in" | "out" };
export const CF_LINES: CfLine[] = [
  { key: "sales_in", activity: "op", label: "매출 입금 (거래처)", dir: "in" },
  { key: "grant_in", activity: "op", label: "정부 지원금 · 보조금 수입", dir: "in" },
  { key: "interest_in", activity: "op", label: "이자 수입", dir: "in" },
  { key: "other_in", activity: "op", label: "기타 입금", dir: "in" },
  { key: "purchase_out", activity: "op", label: "매입 · 경비 지급", dir: "out" },
  { key: "payroll", activity: "op", label: "급여", dir: "out" },
  { key: "card", activity: "op", label: "카드 대금 · 체크카드", dir: "out" },
  { key: "tax", activity: "op", label: "세금 · 4대보험 · 공과금", dir: "out" },
  { key: "fee", activity: "op", label: "수수료 · 이자 비용", dir: "out" },
  { key: "grant_out", activity: "op", label: "지원금 집행 · 반납", dir: "out" },
  { key: "other_out", activity: "op", label: "기타 지급", dir: "out" },
  { key: "asset_sell", activity: "inv", label: "자산 처분 수입", dir: "in" },
  { key: "deposit_in", activity: "inv", label: "보증금 · 대여금 회수", dir: "in" },
  { key: "asset_buy", activity: "inv", label: "유형 · 무형자산 취득", dir: "out" },
  { key: "deposit_out", activity: "inv", label: "보증금 · 대여금 지급", dir: "out" },
  { key: "loan_in", activity: "fin", label: "대출 실행 · 차입", dir: "in" },
  { key: "owner_in", activity: "fin", label: "대표 가수금 입금", dir: "in" },
  { key: "equity_in", activity: "fin", label: "자본금 · 증자", dir: "in" },
  { key: "loan_repay", activity: "fin", label: "대출 상환", dir: "out" },
  { key: "owner_out", activity: "fin", label: "대표 가수금 반환 · 가지급", dir: "out" },
  { key: "equity_out", activity: "fin", label: "배당 · 감자", dir: "out" },
  { key: "xfer", activity: "xfer", label: "계좌 간 이체 (표에서 제외)", dir: "out" },
];
export const ACTIVITY_LABEL: Record<Activity, string> = { op: "영업활동", inv: "투자활동", fin: "재무활동", xfer: "계좌 간 이체" };

export type CfTx = {
  id: string; date: string; month: string; account: string; counterparty: string; description: string;
  amount: number; dir: "in" | "out"; key: LineKey; basis: string;   // basis: 무엇을 근거로 넣었나 ("" = 근거 없음)
};

export type CashFlowData = {
  txs: CfTx[];
  opening: number; closing: number;
  accountCount: number;
  months: string[];
};

const norm = (s: string) => String(s || "").replace(/[\s()（）㈜]|주식회사|유한회사|\(주\)/g, "").toLowerCase();
const has = (s: string, words: string[]) => { const t = String(s || ""); return words.some((w) => t.includes(w)); };

const KW_TAX = ["국세", "세무서", "지방세", "위택스", "홈택스", "건강보험", "국민연금", "고용보험", "근로복지", "산재", "관세", "4대보험", "법인세", "부가세", "부가가치세", "원천세", "주민세", "재산세", "자동차세", "지방소득세", "환경개선", "교통유발"];
const KW_CARD = ["카드", "체크", "가승인", "선결제", "비씨", "BC", "CC", "KB국민", "신한", "삼성", "현대", "롯데", "하나", "우리", "농협", "씨티"];
const KW_CARD_STRONG = ["카드", "체크", "가승인", "선결제", "카드대금", "카드이용"];
const KW_GRANT = ["재정정보원", "나라도움", "보조금", "지원금", "진흥원", "창업진흥", "중소벤처", "소상공인", "기술보증", "신용보증", "지원사업"];
const KW_LOAN = ["대출", "차입", "원리금", "융자", "여신"];
const KW_DEPOSIT = ["보증금", "대여금", "임차보증"];
const KW_EQUITY_IN = ["자본금", "증자", "출자"];
const KW_EQUITY_OUT = ["배당", "감자"];
const KW_FEE = ["수수료", "KFTC", "스마트뱅킹", "뱅킹", "이체료", "송금료"];
const KW_INTEREST = ["이자"];
const KW_OWNER = ["가수금", "가지급"];
const KW_ASSET = ["고정자산", "비품", "차량", "기계", "부동산", "장비", "설비", "인테리어", "소프트웨어구입"];

/** 전표 계정 코드 → 활동 줄. 현금 계정(101~104) 은 건너뛴다 */
function keyFromAccountCode(code: string | null, nature: string, dir: "in" | "out"): LineKey | null {
  const n = parseInt(String(code || "").replace(/\D/g, ""), 10);
  if (!Number.isFinite(n)) {
    if (nature === "revenue") return "sales_in";
    if (nature === "expense") return "purchase_out";
    return null;
  }
  if (n >= 101 && n <= 104) return null;                         // 현금·예금 — 상대 계정이 아니다
  if (n === 108 || n === 110 || n === 120 || n === 131 || n === 135) return dir === "in" ? "sales_in" : "purchase_out"; // 채권·선급·대급금
  if (n === 114 || n === 116 || n === 131 || (n >= 230 && n <= 239)) return dir === "in" ? "deposit_in" : "deposit_out"; // 대여금·보증금
  if (n >= 200 && n <= 229) return dir === "in" ? "asset_sell" : "asset_buy";     // 유형·무형자산
  if (n >= 240 && n <= 249) return dir === "in" ? "asset_sell" : "asset_buy";
  if (n === 251 || n === 253 || n === 259) return dir === "in" ? "other_in" : "purchase_out"; // 매입채무·미지급
  if (n === 254 || n === 255 || n === 261) return "tax";                              // 예수금·부가세예수금·미지급세금
  if (n === 257 || n === 258) return dir === "in" ? "owner_in" : "owner_out";       // 가수금·예수(대표)
  if ((n >= 260 && n <= 270) || (n >= 290 && n <= 299)) return dir === "in" ? "loan_in" : "loan_repay"; // 차입금
  if (n >= 300 && n <= 399) return dir === "in" ? "equity_in" : "equity_out";
  if (n >= 400 && n <= 499) return dir === "in" ? "sales_in" : "other_out";
  if (n === 801 || n === 803 || n === 601 || n === 603 || n === 806 || n === 511) return "payroll"; // 급여·상여·잡급·임금
  if (n === 831 || n === 931) return "fee";                                           // 지급수수료·이자비용
  if (n === 817 || n === 818) return "tax";                                           // 세금과공과
  if (n >= 500 && n <= 899) return "purchase_out";
  if (n === 901 || n === 902) return "interest_in";
  if (n >= 900) return dir === "in" ? "other_in" : "other_out";
  return null;
}

type Ctx = {
  companyStems: string[]; repName: string; employeeNames: Set<string>; lenders: string[];
  loanTxIds: Set<string>; jeKey: Map<string, LineKey>;
};

function classify(t: any, dir: "in" | "out", ctx: Ctx): { key: LineKey; basis: string } {
  const cp = String(t.counterparty || ""), desc = String(t.description || ""), memo = String(t.memo || "");
  const text = `${cp} ${desc} ${memo}`;
  const cat = `${t.category || ""} ${t.classification || ""}`;
  // ① 세금·공과
  if (has(text, KW_TAX) || has(cat, ["세금", "공과", "4대보험", "보험료"])) return { key: "tax", basis: "키워드(세금·공과)" };
  // ② 계좌 간 이체
  const cpn = norm(cp);
  if (cpn && ctx.companyStems.some((s) => s && cpn.includes(s))) return { key: "xfer", basis: "상대 = 우리 회사" };
  // ③ 전표 연결
  if (t.journal_entry_id && ctx.jeKey.has(t.journal_entry_id)) return { key: ctx.jeKey.get(t.journal_entry_id)!, basis: "전표 계정" };
  // ④ 대출 상환 연결
  if (ctx.loanTxIds.has(t.id)) return { key: "loan_repay", basis: "대출 상환 기록" };
  // ⑤ 정산 연결
  if ((t.settlement_status && t.settlement_status !== "open") || t.tax_invoice_id) return { key: dir === "in" ? "sales_in" : "purchase_out", basis: "계산서 정산" };
  // ⑥ 직원 급여
  if (cpn && ctx.employeeNames.has(cpn) && dir === "out") return { key: "payroll", basis: "직원 이름" };
  // ⑦ 대표 가수금
  if ((ctx.repName && cpn === ctx.repName) || has(text, KW_OWNER) || has(cat, KW_OWNER)) return { key: dir === "in" ? "owner_in" : "owner_out", basis: ctx.repName && cpn === ctx.repName ? "대표 이름" : "키워드(가수금)" };
  // ⑧ 키워드
  if (has(text, KW_GRANT)) return { key: dir === "in" ? "grant_in" : "grant_out", basis: "키워드(지원금)" };
  if (has(text, KW_LOAN) || (ctx.lenders.length && ctx.lenders.some((l) => l && cpn.includes(l)))) return { key: dir === "in" ? "loan_in" : "loan_repay", basis: "키워드(대출)" };
  if (has(text, KW_DEPOSIT)) return { key: dir === "in" ? "deposit_in" : "deposit_out", basis: "키워드(보증금·대여금)" };
  if (has(text, KW_EQUITY_IN)) return { key: dir === "in" ? "equity_in" : "equity_out", basis: "키워드(자본)" };
  if (has(text, KW_EQUITY_OUT)) return { key: dir === "in" ? "equity_in" : "equity_out", basis: "키워드(배당)" };
  if (has(text, KW_ASSET) && dir === "out") return { key: "asset_buy", basis: "키워드(자산)" };
  if (dir === "out" && (has(text, KW_CARD_STRONG) || has(cat, ["카드"]) || /^(CC|BC)$/i.test(cp.trim()) || (has(cp, KW_CARD) && /카드|체크/.test(text)))) return { key: "card", basis: "키워드(카드)" };
  if (has(text, KW_INTEREST) && dir === "in") return { key: "interest_in", basis: "키워드(이자)" };
  if (has(text, KW_FEE) || (has(text, KW_INTEREST) && dir === "out")) return { key: "fee", basis: "키워드(수수료·이자)" };
  // ⑨ 통장 분류 글자
  if (has(cat, ["급여", "인건비", "상여"])) return { key: "payroll", basis: "통장 분류" };
  if (has(cat, ["카드"])) return { key: "card", basis: "통장 분류" };
  if (has(cat, ["대출", "차입", "상환"])) return { key: dir === "in" ? "loan_in" : "loan_repay", basis: "통장 분류" };
  if (has(cat, ["매출", "수금", "입금"]) && dir === "in") return { key: "sales_in", basis: "통장 분류" };
  if (String(t.category || t.classification || "").trim()) return { key: dir === "in" ? "other_in" : "purchase_out", basis: `통장 분류(${String(t.category || t.classification).trim()})` };
  // ⑩ 거래처 연결 / 근거 없음
  if (t.partner_id) return { key: dir === "in" ? "sales_in" : "purchase_out", basis: "거래처 연결" };
  return { key: dir === "in" ? "other_in" : "other_out", basis: "" };
}

const monthsBetween = (from: string, to: string) => {
  const out: string[] = []; let y = Number(from.slice(0, 4)), m = Number(from.slice(5, 7));
  const end = to.slice(0, 7);
  for (let i = 0; i < 120; i++) { const k = `${y}-${String(m).padStart(2, "0")}`; out.push(k); if (k >= end) break; m += 1; if (m > 12) { m = 1; y += 1; } }
  return out;
};

export async function fetchCashFlow(companyId: string, from: string, to: string): Promise<CashFlowData> {
  const today = todayKst();
  const [company, accounts, employees, loans, map] = await Promise.all([
    supabase.from("companies").select("name, representative").eq("id", companyId).maybeSingle(),
    supabase.from("bank_accounts").select("id, bank_name, alias, balance, is_hidden").eq("company_id", companyId),
    (supabase as any).from("employees").select("name").eq("company_id", companyId),
    (supabase as any).from("loans").select("id, lender").eq("company_id", companyId),
    getAccountMap(companyId),
  ]);
  const accts = ((accounts.data || []) as any[]).filter((a) => !a.is_hidden);
  const acctName = new Map<string, string>(accts.map((a) => [a.id, [a.bank_name, a.alias].filter(Boolean).join(" ")]));
  const stemsRaw = norm(company.data?.name || "");
  //   회사 이름 줄기 — '(주)모티브이노베이션' → '모티브이노베이션'. 너무 짧은(2자 이하) 줄기는 오탐이 많아 쓰지 않는다
  const companyStems = stemsRaw.length >= 3 ? [stemsRaw] : [];
  const repName = norm(company.data?.representative || "");
  const employeeNames = new Set<string>(((employees.data || []) as any[]).map((e) => norm(e.name)).filter((s) => s.length >= 2));
  const lenders = ((loans.data || []) as any[]).map((l) => norm(l.lender)).filter((s) => s.length >= 2);

  //   기간 안 + 기간 뒤(오늘까지) 통장 줄 — 뒤쪽은 기말 잔액을 되돌리는 데만 쓴다
  const rows = await fetchPaged<any>("cashflow:tx", () => (supabase as any).from("bank_transactions")
    .select("id, bank_account_id, transaction_date, type, amount, counterparty, description, memo, category, classification, partner_id, tax_invoice_id, settlement_status, journal_entry_id")
    .eq("company_id", companyId).gte("transaction_date", from).lte("transaction_date", today > to ? today : to)
    .order("transaction_date").order("id"), 200000);
  const inRange = rows.filter((r) => r.transaction_date <= to);
  const after = rows.filter((r) => r.transaction_date > to);

  //   전표 연결 줄 → 전표의 현금 아닌 계정으로 활동 판정
  const jeIds = [...new Set(inRange.map((r) => r.journal_entry_id).filter(Boolean))] as string[];
  const jeKey = new Map<string, LineKey>();
  if (jeIds.length) {
    const lines = await chunkedIn((ids) => (supabase as any).from("journal_lines").select("entry_id, account_id, debit, credit").in("entry_id", ids).then((r: any) => r.data || []), jeIds);
    const byEntry = new Map<string, any[]>();
    for (const l of (lines as any[])) { if (!byEntry.has(l.entry_id)) byEntry.set(l.entry_id, []); byEntry.get(l.entry_id)!.push(l); }
    for (const [eid, ls] of byEntry) {
      //   가장 큰 상대 계정 하나로 정한다(줄이 여럿이면 금액 큰 쪽)
      let best: { key: LineKey; amt: number } | null = null;
      for (const l of ls) {
        const info = map.get(l.account_id); if (!info) continue;
        const amt = Number(l.debit || 0) + Number(l.credit || 0);
        const dir: "in" | "out" = Number(l.credit || 0) > 0 && info.nature !== "asset" ? "in" : Number(l.debit || 0) > 0 ? "out" : "in";
        const k = keyFromAccountCode(info.code, info.nature, dir);
        if (k && (!best || amt > best.amt)) best = { key: k, amt };
      }
      if (best) jeKey.set(eid, best.key);
    }
  }
  //   대출 상환 기록에 연결된 통장 줄
  const loanTxIds = new Set<string>();
  const loanIds = ((loans.data || []) as any[]).map((l) => l.id);
  if (loanIds.length) {
    const lp = await chunkedIn((ids) => (supabase as any).from("loan_payments").select("bank_transaction_id").in("loan_id", ids).not("bank_transaction_id", "is", null).then((r: any) => r.data || []), loanIds);
    for (const p of (lp as any[])) if (p.bank_transaction_id) loanTxIds.add(p.bank_transaction_id);
  }

  const ctx: Ctx = { companyStems, repName, employeeNames, lenders, loanTxIds, jeKey };
  const txs: CfTx[] = inRange.map((r) => {
    const dir: "in" | "out" = r.type === "income" ? "in" : "out";
    const amount = Math.abs(Number(r.amount || 0));
    const c = classify(r, dir, ctx);
    //   전표 계정으로 정한 줄은 방향이 통장과 어긋날 수 있다(입금인데 지급 줄) — 통장 방향을 믿고 같은 활동의 반대 줄로 옮긴다
    let key = c.key;
    const def = CF_LINES.find((l) => l.key === key)!;
    if (def.activity !== "xfer" && def.dir !== dir) {
      const alt = CF_LINES.find((l) => l.activity === def.activity && l.dir === dir && (def.activity !== "op" || (dir === "in" ? l.key === "other_in" : l.key === "other_out")));
      if (alt) key = alt.key;
    }
    return { id: r.id, date: r.transaction_date, month: String(r.transaction_date).slice(0, 7), account: acctName.get(r.bank_account_id) || "", counterparty: r.counterparty || "", description: r.description || r.memo || "", amount, dir, key, basis: c.basis };
  });

  //   기초·기말 — 지금 잔액에서 되돌린다. 숨긴 계좌 줄은 제외
  const acctIds = new Set(accts.map((a) => a.id));
  const netOf = (list: any[]) => list.filter((r) => acctIds.has(r.bank_account_id)).reduce((s, r) => s + (r.type === "income" ? 1 : -1) * Math.abs(Number(r.amount || 0)), 0);
  const nowBalance = accts.reduce((s, a) => s + Number(a.balance || 0), 0);
  const closing = nowBalance - netOf(after);
  const opening = closing - netOf(inRange);

  return { txs, opening, closing, accountCount: accts.length, months: monthsBetween(from, to) };
}

/** 기간 시작·끝을 월 단위로 — 시작 월 1일 ~ 끝 월 말일(오늘이 그 달이면 오늘) */
export function monthRange(fromMonth: string, toMonth: string): { from: string; to: string } {
  const from = `${fromMonth}-01`;
  const y = Number(toMonth.slice(0, 4)), m = Number(toMonth.slice(5, 7));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const to = `${toMonth}-${String(last).padStart(2, "0")}`;
  const today = todayKst();
  return { from, to: to > today ? today : to };
}

export const prevDay = (d: string) => addDaysStr(d, -1);
