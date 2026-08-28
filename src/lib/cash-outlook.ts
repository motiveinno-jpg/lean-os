// 자금 전망 — "앞으로 돈 괜찮아?" (2026-08-19 재편, docs/20260819_PLAN_summary_outlook_redesign.md)
//   오늘 통장 잔액에서 **날짜가 있는 예정 항목**(세금계산서 만기·급여·대출·정기 지출·고정비·부가세·계약 회차·결재 대기)을
//   날짜대로 빼고 더한 잔액 곡선. 확정/추정을 항목마다 적는다. 예전 cash-pulse 전망(월 지출 × 일수 직선)은 '지금 속도' 점선으로만 남긴다.
//   cash-budget.getDailyCashProjection 의 규칙(고정비↔정기 지출 이름 중복 제거 등)을 따르되, 스냅샷 쓰기 부수효과는 없다 — 읽기 화면.
//   시나리오는 곡선을 하나 더 그릴 뿐 실제 숫자는 안 바뀐다.

import { supabase } from "@/lib/supabase";
import { fetchPagedRes } from "@/lib/fetch-paged";
import { getCashPulseData } from "@/lib/queries";
import { buildCashPulse } from "@/lib/cash-pulse";
import { getVATPreview } from "@/lib/tax-invoice";
import { getLoanStatuses } from "@/lib/cash-budget";
import { fetchReceivables } from "@/lib/pnl-status";
import { todayKst } from "@/lib/kst";

export type ItemKind = "급여" | "정기 지출" | "대출 상환" | "세금" | "매출 입금" | "매입 지급" | "계약 회차" | "계약 지출" | "결재 대기" | "시나리오";
export type OutlookItem = {
  id: string; date: string; label: string; kind: ItemKind;
  amount: number;            // + 들어옴 / − 나감
  basis: string;             // 어디서 온 숫자인지
  sure: "확정" | "추정";
  flag?: string;             // 만기 미입력 · 독촉 필요 · 최저점 …
  href?: string;
};
export type Scenario = {
  spendPct: number;          // 급여·정기 지출·대출에 곱할 % (+10 → 1.1)
  delayDays: number;         // 매출 입금·계약 회차 늦춤
  recoveryPct: number;       // 30일 넘은 미수금 중 들어올 비율 (0~100) — 오늘+30 에 한 건
  extraIn: { date: string; amount: number; label: string } | null;
  extraOut: { date: string; amount: number; label: string } | null;
};
export const SCENARIO_DEFAULT: Scenario = { spendPct: 0, delayDays: 0, recoveryPct: 0, extraIn: null, extraOut: null };
export const scenarioActive = (s: Scenario) => s.spendPct !== 0 || s.delayDays !== 0 || s.recoveryPct !== 0 || !!s.extraIn || !!s.extraOut;

export type OutlookData = {
  today: string; balance: number; burn: number; hasBank: boolean;
  items: OutlookItem[];      // 오늘 ~ 오늘+days, 날짜순
  arOver30: number; arOver30Partners: number;
  gaps: { key: string; text: string; href: string; count?: number }[];   // 틀릴 수 있는 곳
};
export type CurvePoint = { date: string; day: number; balance: number; items: OutlookItem[] };
export type Curve = { points: CurvePoint[]; min: CurvePoint; shortfall: CurvePoint | null; end: number };

const addDays = (d: string, n: number) => { const t = new Date(d + "T00:00:00"); t.setDate(t.getDate() + n); return t.toISOString().slice(0, 10); };
const dayDiff = (a: string, b: string) => Math.round((new Date(b + "T00:00:00").getTime() - new Date(a + "T00:00:00").getTime()) / 864e5);
const clampDay = (y: number, m: number, d: number) => Math.min(d, new Date(y, m, 0).getDate());
/** 오늘부터 horizon 안의 '매월 day 일' 날짜들 */
function monthlyDates(today: string, days: number, day: number): string[] {
  const out: string[] = []; const [y0, m0] = today.split("-").map(Number); const end = addDays(today, days);
  for (let i = 0; i < 24; i++) { const t = y0 * 12 + (m0 - 1) + i; const y = Math.floor(t / 12), m = (t % 12) + 1; const d = `${y}-${String(m).padStart(2, "0")}-${String(clampDay(y, m, Math.max(1, day || 1))).padStart(2, "0")}`; if (d < today) continue; if (d > end) break; out.push(d); }
  return out;
}
const norm = (s: string) => String(s || "").toLowerCase().replace(/\s+/g, "");

export async function fetchOutlook(companyId: string, days: number, userId?: string): Promise<OutlookData> {
  const today = todayKst();
  const end = addDays(today, days);
  const year = Number(today.slice(0, 4));
  const [pulseRaw, ti, fixed, recur, vat, loans, revSched, costSched, pq, recv] = await Promise.all([
    getCashPulseData(companyId, userId),
    fetchPagedRes<any>("cash-outlook:ti", () => supabase.from("tax_invoices").select("id, type, counterparty_name, total_amount, settled_amount, issue_date, status").eq("company_id", companyId).neq("status", "void").gte("issue_date", addDays(today, -180)).order("id"), 50000),
    supabase.from("fixed_costs").select("id, name, amount, payment_day, is_recurring, end_date").eq("company_id", companyId),
    supabase.from("recurring_payments").select("id, name, amount, day_of_month, is_active").eq("company_id", companyId).eq("is_active", true),
    getVATPreview(companyId, year),
    getLoanStatuses(companyId),
    supabase.from("deal_revenue_schedule").select("id, amount, due_date, status, label, deals!inner(company_id, name)").eq("deals.company_id", companyId),
    supabase.from("deal_cost_schedule").select("id, amount, due_date, status, deal_nodes!inner(deal_id, name, deals!inner(company_id))").eq("deal_nodes.deals.company_id", companyId),
    supabase.from("payment_queue").select("id, amount, status, description").eq("company_id", companyId).in("status", ["pending", "approved"]),
    fetchReceivables(companyId),
  ]);
  const pulse = pulseRaw ? buildCashPulse(pulseRaw) : null;
  const balance = pulse?.currentBalance ?? 0;
  const burn = pulse?.monthlyBurn ?? 0;
  const hasBank = (pulseRaw?.bankBalances?.length ?? 0) > 0;
  const items: OutlookItem[] = [];
  const gaps: OutlookData["gaps"] = [];
  const within = (d: string) => d >= today && d <= end;

  // 급여 — 등록 급여 합, 매월 25일 (급여일 설정이 없다 — 있으면 그걸 쓴다)
  const salary = pulseRaw?.employeeSalaryTotal ?? 0;
  if (salary > 0) for (const d of monthlyDates(today, days, 25)) items.push({ id: `sal:${d}`, date: d, label: `급여 (${Number(d.slice(5, 7))}월)`, kind: "급여", amount: -salary, basis: "직원 등록 급여 합 · 25일", sure: "확정", href: "/employees" });
  if (salary > 0) gaps.push({ key: "salary", text: "급여는 등록 급여 합을 매월 25일로 잡습니다 (실지급액·급여일이 다르면 차이)", href: "/employees" });

  // 정기 지출 + 고정비 (이름 겹치면 정기 지출만)
  const recNames = new Set<string>();
  for (const r of ((recur.data || []) as any[])) {
    recNames.add(norm(r.name));
    for (const d of monthlyDates(today, days, r.day_of_month || 1)) items.push({ id: `rec:${r.id}:${d}`, date: d, label: r.name, kind: "정기 지출", amount: -Number(r.amount || 0), basis: "정기 지출 등록", sure: "확정", href: "/payments" });
  }
  for (const f of ((fixed.data || []) as any[])) {
    if (recNames.has(norm(f.name))) continue;
    if (f.end_date && f.end_date < today) continue;
    for (const d of monthlyDates(today, days, f.payment_day || 1)) { if (f.end_date && d > f.end_date) continue; items.push({ id: `fix:${f.id}:${d}`, date: d, label: f.name, kind: "정기 지출", amount: -Number(f.amount || 0), basis: "고정비 등록", sure: "확정", href: "/payments" }); }
  }

  // 대출 — 월 상환 + 만기 일시상환
  for (const l of loans) {
    if (l.repaymentType !== "bullet" && l.monthlyPayment > 0) for (const d of monthlyDates(today, days, 5)) items.push({ id: `loan:${l.id}:${d}`, date: d, label: `${l.name} 원리금`, kind: "대출 상환", amount: -Number(l.monthlyPayment), basis: `대출 등록 · ${l.lender}`, sure: "확정", href: "/loans" });
    if (l.repaymentType === "bullet" && l.maturityDate && within(l.maturityDate)) items.push({ id: `loanb:${l.id}`, date: l.maturityDate, label: `${l.name} 만기 일시상환`, kind: "대출 상환", amount: -Number(l.remainingAmount), basis: "대출 등록 · 만기", sure: "확정", flag: "큰 지출", href: "/loans" });
  }

  // 부가세 (예상)
  //   납부(+)는 나가는 돈, 환급(−)은 들어오는 돈 — 둘 다 예상
  for (const v of vat) if (within(v.dueDate) && Math.abs(v.netVAT) > 0) items.push({ id: `vat:${v.dueDate}`, date: v.dueDate, label: `부가세 ${v.quarter} ${v.netVAT > 0 ? "납부" : "환급"}`, kind: "세금", amount: -Math.round(v.netVAT), basis: "매입매출전표 예상", sure: "추정", href: "/reports/vat" });
  if (vat.some((v) => within(v.dueDate) && Math.abs(v.netVAT) > 0)) gaps.push({ key: "vat", text: "부가세는 전표 기준 예상입니다 — 신고 후 확정 금액과 다를 수 있습니다", href: "/reports/vat" });

  // 세금계산서 — 미정산 잔액. 만기 칸이 없어 발행일 + 30일 (추정). 이미 지난 것은 오늘로 당김(30일 넘은 미수는 회수율 시나리오 몫이라 뺀다)
  let noDue = 0, apOverdue = 0, apOverdueAmt = 0;
  for (const r of ((ti.data || []) as any[])) {
    const outstanding = Number(r.total_amount || 0) - Number(r.settled_amount || 0);
    if (outstanding <= 0) continue;
    const due = addDays(r.issue_date, 30);
    const isSales = r.type === "sales";
    if (due < today) {                                  // 이미 30일 지난 것 — 언제 오갈지 모른다. 곡선에 안 넣고 '틀릴 수 있는 곳'에 적는다
      if (!isSales) { apOverdue++; apOverdueAmt += outstanding; }   // 미수는 arOver30(시나리오 회수율) 몫
      continue;
    }
    const date = due;
    if (!within(date)) continue;
    noDue++;
    items.push({ id: `ti:${r.id}`, date, label: `${r.counterparty_name || "거래처"} · 세금계산서`, kind: isSales ? "매출 입금" : "매입 지급", amount: isSales ? outstanding : -outstanding, basis: `세금계산서 ${r.issue_date} 발행 · +30일`, sure: "추정", flag: "만기 미입력", href: "/tax-invoices" });
  }
  if (noDue > 0) gaps.push({ key: "ti-due", text: `세금계산서 ${noDue}건은 만기가 없어 발행일 + 30일로 잡았습니다`, href: "/tax-invoices", count: noDue });
  if (apOverdue > 0) gaps.push({ key: "ap-overdue", text: `발행 30일 지난 미지급 세금계산서 ${apOverdue}건 ${Math.round(apOverdueAmt / 10000).toLocaleString()}만원은 지급일을 몰라 곡선에 안 넣었습니다 — 시나리오 '큰 지출'로 넣어 봅니다`, href: "/tax-invoices", count: apOverdue });

  // 프로젝트 계약 회차 (수익 / 지출) — 날짜 있는 미완료
  for (const r of ((revSched.data || []) as any[])) if (r.due_date && within(r.due_date) && r.status !== "paid" && r.status !== "received" && r.status !== "cancelled") items.push({ id: `rs:${r.id}`, date: r.due_date, label: `${r.deals?.name || "프로젝트"} · ${r.label || "회차"}`, kind: "계약 회차", amount: Number(r.amount || 0), basis: "프로젝트 수익 회차", sure: "확정", href: "/projecthub" });
  for (const r of ((costSched.data || []) as any[])) if (r.due_date && within(r.due_date) && r.status !== "paid" && r.status !== "cancelled") items.push({ id: `cs:${r.id}`, date: r.due_date, label: `${r.deal_nodes?.name || "프로젝트"} · 지출`, kind: "계약 지출", amount: -Number(r.amount || 0), basis: "프로젝트 지출 회차", sure: "확정", href: "/projecthub" });

  // 결재 대기 지출 — 날짜 없음 → 오늘+7 (추정)
  const pqRows = ((pq.data || []) as any[]);
  if (pqRows.length) { const sum = pqRows.reduce((s, r) => s + Number(r.amount || 0), 0); if (sum > 0 && days >= 7) items.push({ id: "pq", date: addDays(today, 7), label: `결재 대기 지출 ${pqRows.length}건`, kind: "결재 대기", amount: -sum, basis: "결재 큐 · 승인/대기", sure: "추정", href: "/payments" }); }

  // 틀릴 수 있는 곳 — 통장에 매달 나가는데 등록 안 된 것(간단 규칙: 정기 지출·고정비 0건이면 안내)
  if (!hasBank) gaps.unshift({ key: "nobank", text: "통장이 연결돼 있지 않아 오늘 잔액이 0 입니다", href: "/bank" });
  if (((recur.data || []) as any[]).length + ((fixed.data || []) as any[]).length === 0) gaps.push({ key: "norec", text: "정기 지출·고정비가 등록돼 있지 않습니다 — 등록하면 곡선이 정확해집니다", href: "/payments" });
  if (recv.over30 > 0) gaps.push({ key: "ar30", text: `30일 넘은 미수금 ${recv.over30Partners}곳 ${Math.round(recv.over30 / 10000).toLocaleString()}만원은 곡선에 안 넣었습니다 — 시나리오 '미수 회수율'로 넣어 봅니다`, href: "/partners/ledger" });

  items.sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount);
  return { today, balance, burn, hasBank, items, arOver30: recv.over30, arOver30Partners: recv.over30Partners, gaps };
}

/** 예정 항목 → 날짜별 잔액. 시나리오를 주면 항목을 바꿔서(복사) 그린다 */
export function buildCurve(data: OutlookData, days: number, sc: Scenario = SCENARIO_DEFAULT): Curve {
  const f = 1 + sc.spendPct / 100;
  let items: OutlookItem[] = data.items.map((it) => {
    if (sc.spendPct !== 0 && (it.kind === "급여" || it.kind === "정기 지출" || it.kind === "대출 상환")) return { ...it, amount: Math.round(it.amount * f) };
    if (sc.delayDays !== 0 && it.amount > 0 && (it.kind === "매출 입금" || it.kind === "계약 회차")) return { ...it, date: addDays(it.date, sc.delayDays) };
    return it;
  });
  if (sc.recoveryPct > 0 && data.arOver30 > 0) items.push({ id: "sc:ar", date: addDays(data.today, 30), label: `30일+ 미수 회수 ${sc.recoveryPct}%`, kind: "시나리오", amount: Math.round(data.arOver30 * sc.recoveryPct / 100), basis: "시나리오", sure: "추정" });
  if (sc.extraIn && sc.extraIn.amount > 0) items.push({ id: "sc:in", date: sc.extraIn.date, label: sc.extraIn.label || "추가 자금", kind: "시나리오", amount: sc.extraIn.amount, basis: "시나리오", sure: "추정" });
  if (sc.extraOut && sc.extraOut.amount > 0) items.push({ id: "sc:out", date: sc.extraOut.date, label: sc.extraOut.label || "큰 지출", kind: "시나리오", amount: -sc.extraOut.amount, basis: "시나리오", sure: "추정" });
  const end = addDays(data.today, days);
  items = items.filter((it) => it.date >= data.today && it.date <= end).sort((a, b) => a.date.localeCompare(b.date));
  const points: CurvePoint[] = [];
  let bal = data.balance; let idx = 0;
  for (let d = 0; d <= days; d++) {
    const date = addDays(data.today, d); const todays: OutlookItem[] = [];
    while (idx < items.length && items[idx].date === date) { bal += items[idx].amount; todays.push(items[idx]); idx++; }
    points.push({ date, day: d, balance: Math.round(bal), items: todays });
  }
  let min = points[0]; for (const p of points) if (p.balance < min.balance) min = p;
  const shortfall = points.find((p) => p.balance < 0) || null;
  return { points, min, shortfall, end: points[points.length - 1].balance };
}

/** 지금 속도 직선 (예전 방식) — 견주기용 */
export const linearBalance = (balance: number, burn: number, day: number) => Math.round(balance - burn * (day / 30));

/** 주 단위 묶음(월요일 시작) — 자금 달력 */
export function weekBuckets(curve: Curve): { start: string; inflow: number; outflow: number; end: number; low: boolean; items: OutlookItem[] }[] {
  const out: { start: string; inflow: number; outflow: number; end: number; low: boolean; items: OutlookItem[] }[] = [];
  let cur: typeof out[number] | null = null;
  for (const p of curve.points) {
    const dow = (new Date(p.date + "T00:00:00").getDay() + 6) % 7;
    if (!cur || (dow === 0 && p.day > 0)) { cur = { start: p.date, inflow: 0, outflow: 0, end: p.balance, low: false, items: [] }; out.push(cur); }
    for (const it of p.items) { if (it.amount > 0) cur.inflow += it.amount; else cur.outflow += -it.amount; cur.items.push(it); }
    cur.end = p.balance;
  }
  if (out.length) { let lo = out[0]; for (const w of out) if (w.end < lo.end) lo = w; lo.low = true; }
  return out;
}

/** 운영 가능 개월 — 곡선 기준: 부족 시점이 있으면 거기까지, 없으면 기간 평균 소진 속도로 늘려 본다 */
export function runwayFromCurve(curve: Curve, days: number): number {
  if (curve.shortfall) return Math.round((curve.shortfall.day / 30) * 10) / 10;
  const start = curve.points[0].balance; const spent = start - curve.end;
  if (spent <= 0) return 999;
  const perMonth = spent / (days / 30);
  return Math.round((start / perMonth) * 10) / 10;
}
export { dayDiff, addDays };
