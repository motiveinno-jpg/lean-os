// 반복 결제 후보 찾기 — 통장 출금·카드 결제에서 "매달 비슷한 날 비슷한 금액" 을 골라 정기 지출 등록을 권한다 (2026-09-07).
//   순수 함수 — 자료는 호출하는 쪽(auto-discovery.ts)이 bank_transactions·card_transactions 에서 읽어 넘긴다.
//   규칙:
//     · 같은 거래처(정규화)에서 2회 이상, 서로 다른 달에, 금액이 중앙값 ±10%(최소 1,000원) 안
//     · 이웃한 결제 간격이 20~40일(월 주기) — 하루에 여러 번 사는 편의점·주유는 걸러진다
//     · 이미 활성 정기 지출과 맞는 것, 사람이 직접 표시한 것은 뺀다(추천할 이유가 없다)
import { buildRecurringPatterns, matchRecurring, type BankTxLite, type RecurringLite } from "./recurring-match";

export type RecurringCandidate = {
  key: string;                 // `${source}|${정규화 거래처}|${금액 버킷}` — 무시 기록·중복 방지에 쓴다
  source: "bank" | "card";
  counterparty: string;        // 화면에 보일 거래처(가장 최근 표기)
  amount: number;              // 중앙값
  dayOfMonth: number;          // 중앙값(1~31)
  count: number;
  firstDate: string;
  lastDate: string;
  txIds: string[];
};

const norm = (s: unknown) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const median = (xs: number[]) => { const a = [...xs].sort((x, y) => x - y); const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2); };
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / 86400000);

export function detectRecurringCandidates(
  txs: BankTxLite[] | null | undefined,
  recurring: RecurringLite[] | null | undefined,
  opts: { minCount?: number; excludeNames?: Iterable<string>; todayStr?: string; maxStaleDays?: number } = {},
): RecurringCandidate[] {
  const minCount = opts.minCount ?? 2;
  //   급여는 정기 지출이 아니라 급여 화면의 몫 — 직원 이름과 같은 거래처는 뺀다 (모티브 실제 자료에서 급여 이체가 8건 잡혔다)
  const exclude = new Set(Array.from(opts.excludeNames || []).map(norm).filter((n) => n.length >= 2));
  //   몇 달 전에 끊긴 패턴은 권하지 않는다 — 마지막 결제가 오늘부터 maxStaleDays(기본 45일) 안이어야 한다
  const todayStr = opts.todayStr || new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const maxStale = opts.maxStaleDays ?? 45;
  const patterns = buildRecurringPatterns(recurring);
  const groups = new Map<string, BankTxLite[]>();
  for (const tx of txs || []) {
    if (tx.type !== "expense") continue;
    if (tx.is_auto_transfer === true) continue;                 // 이미 표시한 줄
    if (matchRecurring(tx, patterns)) continue;                  // 이미 정기 지출이 있는 줄
    const cp = norm(tx.counterparty);
    if (cp.length < 2 || !tx.transaction_date) continue;
    if (exclude.has(cp) || Array.from(exclude).some((n) => cp === n || cp.startsWith(n + " ") || cp.endsWith(" " + n))) continue;
    const amt = Math.abs(Number(tx.amount || 0));
    if (amt < 1000) continue;
    const key = `${tx.source || "bank"}|${cp}`;
    (groups.get(key) || groups.set(key, []).get(key)!).push(tx);
  }

  const out: RecurringCandidate[] = [];
  for (const [gkey, list] of groups) {
    if (list.length < minCount) continue;
    const sorted = [...list].sort((a, b) => String(a.transaction_date).localeCompare(String(b.transaction_date)));
    //   금액이 중앙값 근처인 것만 남긴다 — 같은 거래처라도 금액이 널뛰면 반복 결제가 아니다
    const med = median(sorted.map((t) => Math.abs(Number(t.amount || 0))));
    const tol = Math.max(1000, med * 0.1);
    const near = sorted.filter((t) => Math.abs(Math.abs(Number(t.amount || 0)) - med) <= tol);
    if (near.length < minCount) continue;
    //   서로 다른 달 2개 이상 + 이웃 간격이 월 주기
    const months = new Set(near.map((t) => String(t.transaction_date).slice(0, 7)));
    if (months.size < minCount) continue;
    let monthly = true;
    for (let i = 1; i < near.length; i++) {
      const gap = daysBetween(String(near[i - 1].transaction_date), String(near[i].transaction_date));
      if (gap === 0) continue;                                    // 같은 날 두 번(분할 결제)은 무시
      if (gap < 20 || gap > 40) { monthly = false; break; }
    }
    if (!monthly) continue;
    const [source] = gkey.split("|") as ["bank" | "card", string];
    const last = near[near.length - 1];
    if (daysBetween(String(last.transaction_date), todayStr) > maxStale) continue;
    out.push({
      key: `${gkey}|${Math.round(med / 1000)}`,
      source,
      counterparty: String(last.counterparty || "").trim(),
      amount: med,
      dayOfMonth: median(near.map((t) => Number(String(t.transaction_date).slice(8, 10)))),
      count: near.length,
      firstDate: String(near[0].transaction_date).slice(0, 10),
      lastDate: String(last.transaction_date).slice(0, 10),
      txIds: near.map((t) => String(t.id)).filter(Boolean),
    });
  }
  //   금액 큰 순 — 사장님이 먼저 볼 것
  return out.sort((a, b) => b.amount - a.amount);
}
