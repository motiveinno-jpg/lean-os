// ── 월마감 스냅샷 — 잠근 달의 재무제표를 그대로 보관 (2026-08-27 ERP 공백 ③) ──
//
//   History: 회계마감 '잠금'은 그 달 전표 입력만 막았다(PERIOD_LOCKED). 재무제표는 항상 지금 전표로 다시 계산되므로
//   잠근 뒤 전표를 반려·정정하면 '마감한 달의 숫자'가 소리 없이 바뀌었다. ERP 는 마감 시점 확정본을 남긴다.
//
//   결정 57 — 잠금 순간 재무상태표(연초~월말 누적 계정 잔액)·손익계산서(그 달 + 연초~월말 누적)를 계정별로 저장.
//             계산은 재무제표 화면과 같은 lib(journal-reports.fetchJournalLines / bsAmount / pnlAmount) — 숫자가 서로 달라지지 않게.
//   결정 58 — 스냅샷은 덮어쓰지 않는다. 잠금을 풀고 다시 잠글 때만 새로 찍는다. 화면은 확정본과 지금 숫자가 다르면 알린다.
//   결정 59 — 자동으로 못 푸는 것: 왜 달라졌는지. 화면은 계정별 차이만 보여 주고 원인은 전표 현황에서 사람이 찾는다.

import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";
import { fetchJournalLines, bsAmount, pnlAmount, type JournalLine } from "@/lib/journal-reports";

export type SnapLine = { accountId: string; code: string | null; name: string; nature: string; section: string | null; amount: number; ytd?: number };
export type SnapTotals = {
  assets: number; liabilities: number; equity: number; netIncome: number;         // 재무상태표(연초~월말)
  revenue: number; expense: number; monthNet: number; ytdRevenue: number; ytdExpense: number; ytdNet: number;   // 손익
  lines: number;
};
export type ClosingSnapshot = {
  id: string; month: string; taken_at: string; taken_by: string | null; checklist_id: string | null;
  bs: SnapLine[]; pnl: SnapLine[]; totals: SnapTotals; note: string | null;
};

export const monthEnd = (month: string) => { const d = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0); return `${month}-${String(d.getDate()).padStart(2, "0")}`; };

/** 확정 전표로 그 달의 재무제표를 계산한다 — 화면과 같은 lib */
export async function computeStatements(companyId: string, month: string): Promise<{ bs: SnapLine[]; pnl: SnapLine[]; totals: SnapTotals }> {
  const from = `${month.slice(0, 4)}-01-01`, to = monthEnd(month), mFrom = `${month}-01`;
  const lines = await fetchJournalLines(companyId, from, to);
  const bsMap = new Map<string, SnapLine>(); const plMap = new Map<string, SnapLine>();
  let netIncome = 0;
  const T: SnapTotals = { assets: 0, liabilities: 0, equity: 0, netIncome: 0, revenue: 0, expense: 0, monthNet: 0, ytdRevenue: 0, ytdExpense: 0, ytdNet: 0, lines: lines.length };
  for (const l of lines as JournalLine[]) {
    if (l.nature === "revenue" || l.nature === "expense") {
      const amt = pnlAmount(l);
      const cur = plMap.get(l.accountId) || { accountId: l.accountId, code: l.code, name: l.name, nature: l.nature, section: l.section, amount: 0, ytd: 0 };
      cur.ytd = (cur.ytd || 0) + amt;
      if (l.date >= mFrom) cur.amount += amt;
      plMap.set(l.accountId, cur);
      netIncome += l.nature === "revenue" ? (l.credit - l.debit) : -(l.debit - l.credit);
      continue;
    }
    const cur = bsMap.get(l.accountId) || { accountId: l.accountId, code: l.code, name: l.name, nature: l.nature, section: null, amount: 0 };
    cur.amount += bsAmount(l);
    bsMap.set(l.accountId, cur);
  }
  const r = (n: number) => Math.round(n);
  const bs = [...bsMap.values()].map((b) => ({ ...b, amount: r(b.amount) })).filter((b) => b.amount !== 0).sort((a, b) => String(a.code || "").localeCompare(String(b.code || "")));
  const pnl = [...plMap.values()].map((b) => ({ ...b, amount: r(b.amount), ytd: r(b.ytd || 0) })).filter((b) => b.amount !== 0 || b.ytd !== 0).sort((a, b) => String(a.code || "").localeCompare(String(b.code || "")));
  for (const b of bs) { if (b.nature === "asset") T.assets += b.amount; else if (b.nature === "liability") T.liabilities += b.amount; else T.equity += b.amount; }
  T.netIncome = r(netIncome);
  for (const p of pnl) {
    if (p.nature === "revenue") { T.revenue += p.amount; T.ytdRevenue += p.ytd || 0; } else { T.expense += p.amount; T.ytdExpense += p.ytd || 0; }
  }
  T.monthNet = T.revenue - T.expense; T.ytdNet = T.ytdRevenue - T.ytdExpense;
  return { bs, pnl, totals: T };
}

/** 잠금 순간 찍는다 — 같은 달이 있으면 덮어쓴다(잠금을 풀고 다시 잠근 경우) */
export async function takeClosingSnapshot(companyId: string, month: string, userId: string | null, checklistId: string | null): Promise<void> {
  const { bs, pnl, totals } = await computeStatements(companyId, month);
  const { error } = await (supabase as any).from("closing_snapshots").upsert({
    company_id: companyId, month, checklist_id: checklistId, taken_by: userId, taken_at: new Date().toISOString(), bs, pnl, totals,
  }, { onConflict: "company_id,month" });
  if (error) throw error;
}

export async function listClosingSnapshots(companyId: string, year?: string): Promise<ClosingSnapshot[]> {
  let q = (supabase as any).from("closing_snapshots").select("id, month, taken_at, taken_by, checklist_id, bs, pnl, totals, note").eq("company_id", companyId).order("month", { ascending: false });
  if (year) q = q.like("month", `${year}-%`);
  const data = logRead("closing-snapshot:list", await q.limit(36));
  return (data || []) as ClosingSnapshot[];
}

/** 확정본과 지금 숫자의 차이 — 계정별. 0 이면 빈 배열 */
export function diffSnapshot(snap: SnapLine[], live: SnapLine[]): { code: string | null; name: string; was: number; now: number }[] {
  const out: { code: string | null; name: string; was: number; now: number }[] = [];
  const liveMap = new Map(live.map((l) => [l.accountId, l]));
  const seen = new Set<string>();
  for (const s of snap) {
    seen.add(s.accountId);
    const now = liveMap.get(s.accountId)?.amount ?? 0;
    if (now !== s.amount) out.push({ code: s.code, name: s.name, was: s.amount, now });
  }
  for (const l of live) if (!seen.has(l.accountId) && l.amount !== 0) out.push({ code: l.code, name: l.name, was: 0, now: l.amount });
  return out.sort((a, b) => Math.abs(b.now - b.was) - Math.abs(a.now - a.was));
}
