// 경영 요약 — "지금 괜찮아?" 세 신호 + 이번 주 챙길 것 + 달라진 것 (2026-08-19 재편, docs/20260819_PLAN_summary_outlook_redesign.md)
//   기준 통일: 손익 = 확정 전표(journal-reports) · 현금 = 통장(cash-pulse + bank_transactions) · 받을 돈·낼 돈 = 거래처 원장 RPC(정산 반영).
//   예전 화면이 tax_invoices status 만 보고 미수를 세던 계산(11억으로 튀던 것)은 여기 없다.
//   읽기 전용 — 쓰기·스냅샷 부수효과 없음. 대시보드 '경영 요약' 위젯도 이 함수를 쓴다.

import { supabase } from "@/lib/supabase";
import { getCashPulseData } from "@/lib/queries";
import { buildCashPulse } from "@/lib/cash-pulse";
import { getVATPreview } from "@/lib/tax-invoice";
import { getLoanStatuses } from "@/lib/cash-budget";
import { calcRunwayMonths, getRunwayLevel } from "@/lib/engines";
import { fetchJournalLines, countUnposted, type JournalLine } from "@/lib/journal-reports";
import { summarize, groupByAccount, fetchFixedCostCompare, type PnlSummary } from "@/lib/pnl-status";
import { fetchInvoiceArAp } from "@/lib/invoice-arap";
import { todayKst } from "@/lib/kst";

export type Tone = "g" | "y" | "r";
export type Todo = { key: string; kind: string; text: string; sub?: string; amount?: number; href?: string; tone: Tone };
export type ChangeRow = { key: string; label: string; prev: number; cur: number; invert: boolean; href?: string };

export type BizSummary = {
  month: string; prevMonth: string; today: string;
  //   돈 있나 — 통장
  cash: { balance: number; inflow: number; outflow: number; prevNet: number; burn: number; runway: number; runwayAfterVat: number; tone: Tone; hasBank: boolean };
  //   벌고 있나 — 확정 전표
  pnl: { cur: PnlSummary; prev: PnlSummary; series: { month: string; op: number; revenue: number; cost: number }[]; unposted: { taxInvoice: number; card: number; bank: number; total: number }; unpostedSalesAmt: number; tone: Tone };
  //   받을 돈·낼 돈 — 원장
  arap: { ar: number; ap: number; over30: number; over30Partners: number; vatNext: { due: string; amount: number; dday: number; pay: boolean } | null; salary: number; loanMonthly: number; recurring: number; due30: number; tone: Tone };
  todos: Todo[];
  changes: ChangeRow[];
  overall: { tone: Tone; label: string };
};

const shift = (ym: string, n: number) => { const [y, m] = ym.split("-").map(Number); const t = y * 12 + (m - 1) + n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`; };
const lastDay = (ym: string) => { const [y, m] = ym.split("-").map(Number); return `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`; };
const daysUntil = (d: string, today: string) => Math.ceil((new Date(d + "T00:00:00").getTime() - new Date(today + "T00:00:00").getTime()) / 864e5);
const worst = (...t: Tone[]): Tone => (t.includes("r") ? "r" : t.includes("y") ? "y" : "g");

export async function fetchBizSummary(companyId: string, month: string, userId?: string): Promise<BizSummary> {
  const today = todayKst();
  const prevMonth = shift(month, -1);
  const from6 = shift(month, -5);
  const year = Number(month.slice(0, 4));
  const monthEnd = lastDay(month);

  const [pulseRaw, lines, unposted, unpostedSales, bankCur, bankPrev, arap0, vat, loans] = await Promise.all([
    getCashPulseData(companyId, userId),
    fetchJournalLines(companyId, `${from6}-01`, monthEnd),
    countUnposted(companyId, `${month}-01`, monthEnd),
    supabase.from("tax_invoices").select("total_amount").eq("company_id", companyId).eq("type", "sales").neq("status", "void").is("journal_entry_id", null).gte("issue_date", `${month}-01`).lte("issue_date", monthEnd),
    (supabase.from("bank_transactions").select("amount, type") as any).eq("company_id", companyId).gte("transaction_date", `${month}-01`).lte("transaction_date", monthEnd),
    (supabase.from("bank_transactions").select("amount, type") as any).eq("company_id", companyId).gte("transaction_date", `${prevMonth}-01`).lte("transaction_date", lastDay(prevMonth)),
    //   받을 돈·낼 돈 — 세금계산서 잔액 기준(lib/invoice-arap, 2026-09-03 사장님 결정). 원장 기준(ledger-arap)은
    //   회계 자료 전용으로 남긴다 — 대시보드 6칸만 원장 기준이라 미수금 위젯·AI 요약과 숫자가 달랐다.
    fetchInvoiceArAp(companyId),
    getVATPreview(companyId, year),
    getLoanStatuses(companyId),
  ]);
  const pulse = pulseRaw ? buildCashPulse(pulseRaw) : null;

  // ── 돈 있나 ──
  const balance = pulse?.currentBalance ?? 0;
  const burn = pulse?.monthlyBurn ?? 0;
  //   통장 줄은 type(income/expense)으로 방향을 본다 — amount 부호는 소스마다 달라 믿지 않는다(queries.ts 의 월 합계와 같은 방식)
  const sumIn = (rows: any[]) => rows.filter((r) => r.type === "income").reduce((s, r) => s + Math.abs(Number(r.amount || 0)), 0);
  const sumOut = (rows: any[]) => rows.filter((r) => r.type !== "income").reduce((s, r) => s + Math.abs(Number(r.amount || 0)), 0);
  const bc = (bankCur.data || []) as any[], bp = (bankPrev.data || []) as any[];
  const inflow = sumIn(bc), outflow = sumOut(bc);
  const prevNet = sumIn(bp) - sumOut(bp);
  const runway = calcRunwayMonths(balance, 0, 0, burn);
  const vatNextRaw = vat.filter((v) => v.dueDate >= today && Math.abs(v.netVAT) > 0).sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
  const vatNext = vatNextRaw ? { due: vatNextRaw.dueDate, amount: Math.abs(vatNextRaw.netVAT), dday: Math.max(0, daysUntil(vatNextRaw.dueDate, today)), pay: vatNextRaw.netVAT > 0 } : null;
  const runwayAfterVat = vatNext && vatNextRaw!.netVAT > 0 ? calcRunwayMonths(balance - vatNext.amount, 0, 0, burn) : runway;
  const lv = getRunwayLevel(runway);
  const cashTone: Tone = lv === "CRITICAL" || lv === "DANGER" ? "r" : lv === "WARNING" ? "y" : "g";
  const hasBank = (pulseRaw?.bankBalances?.length ?? 0) > 0;

  // ── 벌고 있나 ──
  const curLines = lines.filter((l) => l.month === month), prevLines = lines.filter((l) => l.month === prevMonth);
  const cur = summarize(curLines), prev = summarize(prevLines);
  //   2026-09-03 데일리 보고서 그림 2(매출·비용 6개월 선)용으로 revenue·cost 도 같이 — op 만 읽던 곳(경영 요약)은 그대로
  const series = Array.from({ length: 6 }, (_, i) => shift(from6, i)).map((m) => { const x = summarize(lines.filter((l) => l.month === m)); return { month: m, op: x.operating, revenue: x.revenue, cost: x.cogs + x.opex }; });
  const unpostedSalesAmt = ((unpostedSales.data || []) as any[]).reduce((s, r) => s + Number(r.total_amount || 0), 0);
  const pnlTone: Tone = cur.operating >= 0 ? "g" : unposted.taxInvoice > 0 ? "y" : "r";

  // ── 받을 돈·낼 돈 — 원장 기준 단일 값 ──
  const ar = arap0.ar;
  const ap = arap0.ap;
  const salary = pulseRaw?.employeeSalaryTotal ?? 0;
  const recurring = (pulseRaw?.recurringPayments || []).filter((r) => r.is_active).reduce((s, r) => s + Number(r.amount || 0), 0);
  const loanMonthly = loans.filter((l) => l.repaymentType !== "bullet").reduce((s, l) => s + Number(l.monthlyPayment || 0), 0);
  const vat30 = vatNext && vatNext.dday <= 30 && vatNextRaw!.netVAT > 0 ? vatNext.amount : 0;
  //   '30일 안에 낼 돈' = 날짜가 있는 예정(급여·정기 지출·대출 월 상환·부가세 30일 내). 미지급금은 만기를 모르므로 잔액으로만 따로 보여 준다
  //   (원장 미지급 잔액이 수억이면 전부 30일 안에 나가는 것처럼 읽혀 신호가 늘 빨갛다).
  const due30 = salary + recurring + loanMonthly + vat30;
  const arapTone: Tone = balance < due30 ? "r" : arap0.over30 > 0 ? "y" : "g";

  // ── 이번 주 챙길 것 (규칙 — 찾아만 놓는다, 확인은 사람이) ──
  const todos: Todo[] = [];
  if (arap0.over30 > 0) todos.push({ key: "ar30", kind: "미수", tone: "r", text: `30일 넘은 미수금 ${arap0.over30Partners}곳`, sub: "세금계산서 발행일 기준 · 잔액 = 총액 − 입금", amount: arap0.over30, href: "/partners/ledger" });
  if (unposted.taxInvoice > 0) todos.push({ key: "unposted-ti", kind: "전표", tone: "y", text: `세금계산서 ${unposted.taxInvoice}건 미처리 — 손익이 실제와 다르게 보입니다`, amount: unpostedSalesAmt > 0 ? unpostedSalesAmt : undefined, href: "/collect" });
  if (unposted.card + unposted.bank > 0) todos.push({ key: "unposted-etc", kind: "전표", tone: "y", text: `카드 ${unposted.card}건 · 통장 ${unposted.bank}건 미처리`, href: "/collect" });
  if (vatNext && vatNextRaw!.netVAT > 0) todos.push({ key: "vat", kind: "세금", tone: vatNext.dday <= 14 ? "r" : "y", text: `부가세 납부 D-${vatNext.dday}`, sub: `${vatNext.due} · 예상`, amount: vatNext.amount, href: "/reports/vat" });
  if (balance < due30) todos.push({ key: "short", kind: "자금", tone: "r", text: "30일 안에 낼 돈이 통장 잔액보다 많습니다", sub: `낼 돈 ${Math.round(due30).toLocaleString()} > 잔액 ${Math.round(balance).toLocaleString()}`, href: "/reports/outlook" });
  const bullet = loans.filter((l) => l.repaymentType === "bullet" && l.maturityDate >= today && daysUntil(l.maturityDate, today) <= 60);
  for (const l of bullet) todos.push({ key: `bullet:${l.name}`, kind: "대출", tone: "r", text: `${l.name} 만기 일시상환 D-${daysUntil(l.maturityDate, today)}`, sub: l.maturityDate, amount: l.remainingAmount, href: "/loans" });
  try {
    const fixed = await fetchFixedCostCompare(companyId, { fromYm: prevMonth, toYm: prevMonth }, prevLines);
    for (const f of fixed.filter((x) => x.basis !== "없음" && x.expected > 0 && Math.abs(x.actual - x.expected) / x.expected > 0.1).slice(0, 3))
      todos.push({ key: `fixed:${f.key}`, kind: "고정비", tone: "y", text: `${f.name} 지난달 실제가 등록값과 ${f.actual > f.expected ? "+" : "−"}${Math.round(Math.abs(f.actual - f.expected)).toLocaleString()} 다릅니다`, sub: `등록 ${Math.round(f.expected).toLocaleString()} · 실제 ${Math.round(f.actual).toLocaleString()}`, href: "/reports/expense" });
  } catch { /* 고정비 대조는 부가 정보 — 실패해도 요약은 뜬다 */ }
  if (!hasBank) todos.push({ key: "nobank", kind: "설정", tone: "y", text: "통장이 연결돼 있지 않아 현금 신호가 비어 있습니다", href: "/bank" });

  // ── 지난달과 달라진 것 — 계정별 금액 차이 큰 순 + 통장 순 현금 흐름 ──
  const gCur = groupByAccount(curLines.filter((l) => l.section === "revenue" || l.section === "cogs" || l.section === "opex"));
  const gPrev = groupByAccount(prevLines.filter((l) => l.section === "revenue" || l.section === "cogs" || l.section === "opex"));
  const secOf = new Map<string, string>(); for (const l of [...curLines, ...prevLines]) if (l.section) secOf.set(l.accountId, l.section);
  const keys = new Set([...gCur.map((g) => g.key), ...gPrev.map((g) => g.key)]);
  const changes: ChangeRow[] = [...keys].map((k) => {
    const c = gCur.find((g) => g.key === k), p = gPrev.find((g) => g.key === k);
    const label = (c || p)!.label; const sec = secOf.get(k);
    return { key: k, label, prev: p?.amount || 0, cur: c?.amount || 0, invert: sec !== "revenue", href: sec === "revenue" ? "/reports/revenue" : "/reports/expense" };
  }).filter((r) => r.cur !== r.prev).sort((a, b) => Math.abs(b.cur - b.prev) - Math.abs(a.cur - a.prev)).slice(0, 6);
  changes.push({ key: "bank-net", label: "통장 순 현금 흐름", prev: prevNet, cur: inflow - outflow, invert: false, href: "/bank" });

  const tones = [cashTone, pnlTone, arapTone];
  const nR = tones.filter((t) => t === "r").length, nY = tones.filter((t) => t === "y").length;
  const overall = { tone: worst(...tones), label: nR > 0 ? `위험 ${nR}` : nY > 0 ? `주의 ${nY}` : "안정" };

  return {
    month, prevMonth, today,
    cash: { balance, inflow, outflow, prevNet, burn, runway, runwayAfterVat, tone: cashTone, hasBank },
    pnl: { cur, prev, series, unposted, unpostedSalesAmt, tone: pnlTone },
    arap: { ar, ap, over30: arap0.over30, over30Partners: arap0.over30Partners, vatNext, salary, loanMonthly, recurring, due30, tone: arapTone },
    todos, changes, overall,
  };
}

export type { JournalLine };
