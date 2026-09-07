// 통장 출금 ↔ 정기 지출(recurring_payments) 짝 맞추기 — 한 곳에서만 (2026-09-07).
//   "자동이체 연결 내역" 은 정기 지출로 등록된 월세·보험·구독이 실제로 통장에서 빠져나간 줄이다.
//   예전엔 숨은 화면(/transactions)에만 이 판정이 있었고, 통장 개요 카드는 사람이 손으로 켠 표시
//   (bank_transactions.is_auto_transfer)만 봐서 어느 회사도 한 줄도 안 보였다.
//   규칙: 활성 정기 지출의 이름·수취인과 거래처(또는 적요)가 겹치고, 금액이 등록 금액의 ±5%(최소 1,000원)
//   안이면 그 정기 지출의 출금으로 본다. 사람이 켠 표시는 항상 자동이체다.

export type RecurringLite = {
  id?: string;
  name?: string | null;
  recipient_name?: string | null;
  payee_name?: string | null;
  amount?: number | string | null;
  category?: string | null;
  is_active?: boolean | null;
};

export type BankTxLite = {
  id?: string;
  type?: string | null;
  amount?: number | string | null;
  counterparty?: string | null;
  description?: string | null;
  is_auto_transfer?: boolean | null;
};

type Pattern = { rp: RecurringLite; keys: string[]; tokens: string[]; amount: number };

const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();
//   "정수기 렌탈" 처럼 이름이 거래처명("코웨이")과 통째로 안 겹치는 일이 흔하다 — 낱말로도 본다.
//   다만 낱말 매칭은 금액이 확인될 때만 인정한다("정수기" 하나로 다른 업체까지 잡히면 안 된다).
const STOP = new Set(["주식회사", "유한회사", "(주)", "주", "월", "요금", "요금제", "결제", "자동이체", "이체"]);
const tokensOf = (s: string) => s.split(/[\s()（）·,\/\-_]+/).map((t) => t.trim()).filter((t) => t.length >= 2 && !STOP.has(t));

/** 활성 정기 지출을 매칭용 패턴으로 — 이름 2자 미만은 오매칭이 많아 뺀다 */
export function buildRecurringPatterns(list: RecurringLite[] | null | undefined): Pattern[] {
  const out: Pattern[] = [];
  for (const rp of list || []) {
    if (rp.is_active === false) continue;
    const keys = [rp.name, rp.recipient_name, rp.payee_name].map(norm).filter((k) => k.length >= 2);
    if (keys.length === 0) continue;
    const tokens = Array.from(new Set(keys.flatMap(tokensOf)));
    out.push({ rp, keys, tokens, amount: Number(rp.amount || 0) });
  }
  return out;
}

/** 이 출금이 어느 정기 지출의 것인가 — 없으면 null (입금은 대상이 아니다) */
export function matchRecurring(tx: BankTxLite, patterns: Pattern[]): RecurringLite | null {
  if (tx?.type !== "expense") return null;
  const cp = norm(tx.counterparty), desc = norm(tx.description);
  if (!cp && !desc) return null;
  const amt = Math.abs(Number(tx.amount || 0));
  for (const p of patterns) {
    const wholeHit = p.keys.some((k) => (cp && (cp.includes(k) || k.includes(cp))) || (desc && desc.includes(k)));
    if (p.amount <= 0) { if (wholeHit) return p.rp; continue; }   // 금액 미등록 정기 지출은 이름이 통째로 겹칠 때만
    const tokenHit = wholeHit || p.tokens.some((t) => (cp && cp.includes(t)) || (desc && desc.includes(t)));
    if (!tokenHit) continue;
    const tol = Math.max(1000, p.amount * 0.05);
    if (Math.abs(amt - p.amount) <= tol) return p.rp;
  }
  return null;
}

/** 자동이체로 볼 것인가 — 사람이 켠 표시가 있으면 항상, 아니면 정기 지출 매칭 */
export function isAutoTransferTx(tx: BankTxLite, patterns: Pattern[]): boolean {
  if (tx?.is_auto_transfer === true) return true;
  return matchRecurring(tx, patterns) !== null;
}

export const RECURRING_CATEGORY_LABEL: Record<string, string> = {
  rent: "임대료", utility: "공과금", insurance: "보험료", subscription: "구독", salary: "급여", tax: "세금", other: "기타", loan: "대출상환",
};
