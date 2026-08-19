// 손익 현황 — 확정 전표 기준 집계 (2026-08-19 기획: docs/20260819_PLAN_pnl_status_redesign.md)
//   ★ 손익계산서와 같은 줄(fetchJournalLines)만 본다. 세금계산서·카드·통장은 원천 드릴다운·미처리 건수로만.
//   이 파일은 셈만 한다 — 화면은 reports/profit·revenue·expense 가 그린다.

import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";
import { fetchJournalLines, pnlAmount, countUnposted, type JournalLine } from "@/lib/journal-reports";

export type PnlSummary = {
  revenue: number; cogs: number; gross: number; opex: number; operating: number;
  nonopIncome: number; nonopExpense: number; tax: number; net: number;
  lines: number;
};

/** 기간의 손익 요약 — 손익계산서 Ⅰ~Ⅸ 와 같은 셈 */
export function summarize(lines: JournalLine[]): PnlSummary {
  let revenue = 0, cogs = 0, opex = 0, nonopIncome = 0, nonopExpense = 0, tax = 0;
  for (const l of lines) {
    const a = pnlAmount(l);
    switch (l.section) {
      case "revenue": revenue += a; break;
      case "cogs": cogs += a; break;
      case "opex": opex += a; break;
      case "nonop_income": nonopIncome += a; break;
      case "nonop_expense": nonopExpense += a; break;
      case "tax": tax += a; break;
      default: break;
    }
  }
  const gross = revenue - cogs;
  const operating = gross - opex;
  const net = operating + nonopIncome - nonopExpense - tax;
  return { revenue, cogs, gross, opex, operating, nonopIncome, nonopExpense, tax, net, lines: lines.length };
}

export type GroupRow = { key: string; label: string; code: string | null; amount: number; count: number; partners: number; lastDate: string };

/** 계정별 합 (section 으로 거른 뒤) */
export function groupByAccount(lines: JournalLine[]): GroupRow[] {
  const m = new Map<string, GroupRow & { pset: Set<string> }>();
  for (const l of lines) {
    const k = l.accountId;
    const g = m.get(k) || { key: k, label: l.name, code: l.code, amount: 0, count: 0, partners: 0, lastDate: "", pset: new Set<string>() };
    g.amount += pnlAmount(l); g.count += 1;
    if (l.partnerName) g.pset.add(l.partnerName);
    if (l.date > g.lastDate) g.lastDate = l.date;
    m.set(k, g);
  }
  return [...m.values()].map(({ pset, ...g }) => ({ ...g, partners: pset.size })).sort((a, b) => b.amount - a.amount);
}

/** 거래처별 합 — 거래처 없는 줄은 '(거래처 없음)' 으로 모은다(숨기지 않는다) */
export function groupByPartner(lines: JournalLine[]): (GroupRow & { mainAccount: string })[] {
  const m = new Map<string, GroupRow & { accts: Map<string, number> }>();
  for (const l of lines) {
    const k = l.partnerName || "(거래처 없음)";
    const g = m.get(k) || { key: k, label: k, code: null, amount: 0, count: 0, partners: 0, lastDate: "", accts: new Map<string, number>() };
    const a = pnlAmount(l);
    g.amount += a; g.count += 1;
    g.accts.set(l.name, (g.accts.get(l.name) || 0) + a);
    if (l.date > g.lastDate) g.lastDate = l.date;
    m.set(k, g);
  }
  return [...m.values()].map(({ accts, ...g }) => ({
    ...g, mainAccount: [...accts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "",
  })).sort((a, b) => b.amount - a.amount);
}

/** 월별 합 (YYYY-MM → 금액) — 기간 안의 달은 0 이라도 넣는다 */
export function monthlySeries(lines: JournalLine[], from: string, to: string): { month: string; amount: number }[] {
  const months: string[] = [];
  let [y, m] = from.slice(0, 7).split("-").map(Number);
  const [ty, tm] = to.slice(0, 7).split("-").map(Number);
  while (y < ty || (y === ty && m <= tm)) { months.push(`${y}-${String(m).padStart(2, "0")}`); m += 1; if (m > 12) { m = 1; y += 1; } }
  const sum = new Map<string, number>();
  for (const l of lines) sum.set(l.month, (sum.get(l.month) || 0) + pnlAmount(l));
  return months.map((mo) => ({ month: mo, amount: sum.get(mo) || 0 }));
}

// ── 기간 계산 ─────────────────────────────────────────────────────────────
const lastDayOf = (ym: string) => { const [y, m] = ym.split("-").map(Number); return `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`; };
const shiftMonth = (ym: string, d: number) => { const [y, m] = ym.split("-").map(Number); const t = y * 12 + (m - 1) + d; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`; };
const monthsBetween = (a: string, b: string) => { const [ay, am] = a.split("-").map(Number); const [by, bm] = b.split("-").map(Number); return (by * 12 + bm) - (ay * 12 + am) + 1; };

export type MonthRange = { fromYm: string; toYm: string };
export const rangeDates = (r: MonthRange) => ({ from: `${r.fromYm}-01`, to: lastDayOf(r.toYm) });
/** 직전 같은 길이 기간 */
export const prevRange = (r: MonthRange): MonthRange => { const n = monthsBetween(r.fromYm, r.toYm); return { fromYm: shiftMonth(r.fromYm, -n), toYm: shiftMonth(r.toYm, -n) }; };
/** 전년 같은 기간 */
export const lastYearRange = (r: MonthRange): MonthRange => ({ fromYm: shiftMonth(r.fromYm, -12), toYm: shiftMonth(r.toYm, -12) });
export const rangeLabel = (r: MonthRange) => r.fromYm === r.toYm ? `${Number(r.fromYm.slice(5))}월` : `${r.fromYm.replace("-", ".")}~${r.toYm.replace("-", ".")}`;

/** 증감 % — 전기 0 이면 null('—') */
export const pctChange = (cur: number, prev: number): number | null => (prev === 0 ? null : Math.round(((cur - prev) / Math.abs(prev)) * 100));

// ── 살펴볼 것 재료 ────────────────────────────────────────────────────────
/** 미수금 — 매출 세금계산서 중 아직 안 들어온 것(발행 기준). 원장이 아니라 계산서 상태를 본다: 원천이 분명해서다. */
export async function fetchReceivables(companyId: string): Promise<{ total: number; over30: number; over30Partners: number; rows: { name: string; amount: number; issueDate: string; days: number }[] }> {
  const data = logRead("pnl-status:ar", await supabase.from("tax_invoices")
    .select("counterparty_name, total_amount, issue_date, status")
    .eq("company_id", companyId).eq("type", "sales")
    .in("status", ["issued", "sent", "pending", "overdue"]));
  const today = new Date();
  const rows = ((data || []) as any[]).map((r) => {
    const d = r.issue_date ? Math.floor((today.getTime() - new Date(r.issue_date).getTime()) / 86400000) : 0;
    return { name: r.counterparty_name || "(미상)", amount: Number(r.total_amount || 0), issueDate: String(r.issue_date || ""), days: d };
  });
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const over = rows.filter((r) => r.days > 30);
  return { total, over30: over.reduce((s, r) => s + r.amount, 0), over30Partners: new Set(over.map((r) => r.name)).size, rows };
}

/** 미분류 출금 — 전표도 없고 처리도 안 된 통장 출금(판관비에서 빠져 있는 돈) */
export async function fetchUnclassifiedOutflow(companyId: string, from: string, to: string): Promise<{ count: number; amount: number }> {
  const data = logRead("pnl-status:unclassified", await (supabase.from("bank_transactions").select("amount") as any)
    .eq("company_id", companyId).is("journal_entry_id", null).eq("settlement_status", "open").lt("amount", 0)
    .gte("transaction_date", from).lte("transaction_date", to));
  const rows = (data || []) as { amount: number }[];
  return { count: rows.length, amount: rows.reduce((s, r) => s + Math.abs(Number(r.amount || 0)), 0) };
}

/** 한 번에 — 이번 기간 · 비교 기간 줄 + 미처리 건수 */
export async function fetchPnlStatus(companyId: string, range: MonthRange, compare: "prev" | "yoy") {
  const cur = rangeDates(range);
  const cmpRange = compare === "prev" ? prevRange(range) : lastYearRange(range);
  const cmp = rangeDates(cmpRange);
  const [curLines, cmpLines, unposted, unclassified] = await Promise.all([
    fetchJournalLines(companyId, cur.from, cur.to),
    fetchJournalLines(companyId, cmp.from, cmp.to),
    countUnposted(companyId, cur.from, cur.to),
    fetchUnclassifiedOutflow(companyId, cur.from, cur.to),
  ]);
  return { curLines, cmpLines, cmpRange, unposted, unclassified };
}

export { fetchJournalLines, pnlAmount, type JournalLine };
