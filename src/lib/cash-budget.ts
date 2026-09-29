import { todayKst } from "@/lib/kst";
/**
 * OwnerView Cash Budget / Treasury Management
 * 자금 예산 관리 — 월별 자금 개요, 고정/변동비, 일별 자금 흐름, 대출 현황, 퇴직금 충당
 */

import { supabase } from './supabase';
import { fetchPaged, fetchPagedRes } from './fetch-paged';
import { calculateRetirementPay } from './payment-batch';
import { getSalaryByMonth } from './payroll';
import { getAccountMap, isCostAccount } from './account-nature';
import { buildRecurringPatterns, matchRecurring } from './recurring-match';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { loadKoreanFont } from './pdf-korean-font';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase;

// ═══════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════

export interface MonthlyBudget {
  month: string; // '2026-01'
  incomeTotal: number;
  /** 그 달 말 통장 잔액 — 현재 잔액에서 그 뒤 통장 입출금을 거꾸로 빼서 구한다(monthEndBalances).
   *  통장 거래가 수집되기 전 달·아직 안 온 달은 null(모르는 값을 현재 잔액으로 채우지 않는다) */
  bankBalance: number | null;
  salesRevenue: number;
  subsidies: number;
  ownerInjection: number; // 대표님 가수금
  otherIncome: number;
  expenseTotal: number;
  fixedCosts: number;
  variableCosts: number;
  netProfit: number; // cumulative
}

export interface FixedCostItem {
  id: string;
  name: string;
  amount: number;
  paymentDay: number; // day of month
  category: 'office' | 'insurance' | 'loan' | 'salary' | 'subscription' | 'tax' | 'other';
  isRecurring: boolean;
  startDate?: string;
  endDate?: string;
  note?: string;
}

export interface DailyCashProjection {
  date: string; // 'YYYY-MM-DD'
  description: string;
  amount: number; // negative for outflow
  runningBalance: number;
  category: string;
}

export interface CashShortfallAlert {
  date: string;
  projectedBalance: number;
  shortfallAmount: number;
  dueDateItems: string[];
}

export interface LoanStatus {
  id: string;
  name: string;
  lender: string;
  loanDate: string;
  maturityDate: string;
  originalAmount: number;
  remainingAmount: number;
  repaymentType: 'bullet' | 'equal_principal' | 'equal_payment';
  monthlyPayment: number;
  interestRate: number;
  paymentDay?: number | null;
  interestDay?: number | null;
  note?: string;
}

export interface RetirementProvision {
  employeeId: string;
  employeeName: string;
  startDate: string;
  salary: number;
  totalDays: number;
  eligible: boolean;
  retirementPay: number;
  dailyAvgWage: number;
}

// ═══════════════════════════════════════════════════════════════════════
// Korean Category Constants
// ═══════════════════════════════════════════════════════════════════════

export const FIXED_COST_CATEGORIES = [
  { value: 'office', label: '사무실/임대료' },
  { value: 'insurance', label: '4대보험' },
  { value: 'loan', label: '대출이자/원금' },
  { value: 'salary', label: '급여' },
  { value: 'subscription', label: '구독/정기결제' },
  { value: 'tax', label: '세금' },
  { value: 'other', label: '기타 고정비' },
] as const;

export const VARIABLE_COST_CATEGORIES = [
  { value: 'marketing', label: '마케팅/광고' },
  { value: 'outsourcing', label: '외주비' },
  { value: 'consulting', label: '컨설팅/수수료' },
  { value: 'supplies', label: '소모품/비품' },
  { value: 'other_variable', label: '기타 변동비' },
] as const;

const REPAYMENT_TYPE_LABELS: Record<string, string> = {
  bullet: '만기일시상환',
  equal_principal: '원금균등상환',
  equal_payment: '원리금균등상환',
};

const CATEGORY_LABELS: Record<string, string> = {
  office: '사무실/임대료',
  insurance: '4대보험',
  loan: '대출이자/원금',
  salary: '급여',
  subscription: '구독/정기결제',
  tax: '세금',
  other: '기타 고정비',
  marketing: '마케팅/광고',
  outsourcing: '외주비',
  consulting: '컨설팅/수수료',
  supplies: '소모품/비품',
  other_variable: '기타 변동비',
};

// ═══════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════

function fmtKRW(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  return `${sign}${abs.toLocaleString()}`;
}

function monthRange(year: number): string[] {
  return Array.from({ length: 12 }, (_, i) => {
    const m = (i + 1).toString().padStart(2, '0');
    return `${year}-${m}`;
  });
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function clampDay(day: number, maxDay: number): number {
  return Math.min(day, maxDay);
}

// ═══════════════════════════════════════════════════════════════════════
// Fixed Costs CRUD
// ═══════════════════════════════════════════════════════════════════════

export async function getFixedCosts(companyId: string): Promise<FixedCostItem[]> {
  const { data, error } = await db
    .from('fixed_costs')
    .select('*')
    .eq('company_id', companyId)
    .eq('is_recurring', true)
    .order('payment_day');

  if (error) throw error;
  return (data || []).map((row: any) => ({
    id: row.id,
    name: row.name,
    amount: Number(row.amount),
    paymentDay: row.payment_day,
    category: row.category,
    isRecurring: row.is_recurring,
    startDate: row.start_date,
    endDate: row.end_date,
    note: row.note,
  }));
}

// ═══════════════════════════════════════════════════════════════════════
// Loan Status
// ═══════════════════════════════════════════════════════════════════════

export async function getLoanStatuses(companyId: string): Promise<LoanStatus[]> {
  const { data, error } = await db
    .from('loans')
    .select('*')
    .eq('company_id', companyId)
    .eq('status', 'active')
    .order('maturity_date');

  if (error) throw error;
  return (data || []).map((row: any) => ({
    id: row.id,
    name: row.name,
    lender: row.lender || '',
    loanDate: row.start_date || row.created_at?.slice(0, 10) || '',
    maturityDate: row.maturity_date || '',
    originalAmount: Number(row.original_amount),
    remainingAmount: Number(row.remaining_balance),
    repaymentType: mapRepaymentType(row.loan_type),
    monthlyPayment: estimateMonthlyPayment(row),
    interestRate: Number(row.interest_rate || 0),
    // 대출 화면에서 받는 상환일·이자일 — 자금 전망이 매월 5일로 고정하지 않고 이것을 쓴다
    paymentDay: row.payment_day ? Number(row.payment_day) : null,
    interestDay: row.interest_day ? Number(row.interest_day) : null,
    note: row.notes,
  }));
}

function mapRepaymentType(loanType: string): LoanStatus['repaymentType'] {
  const map: Record<string, LoanStatus['repaymentType']> = {
    bullet: 'bullet',
    term: 'equal_principal',
    equal_principal: 'equal_principal',
    equal_payment: 'equal_payment',
    installment: 'equal_payment',
  };
  return map[loanType] || 'equal_principal';
}

// supabase/functions/ai-briefing/index.ts 에 같은 식이 옮겨져 있다 — 바꿀 땐 둘 다
export function estimateMonthlyPayment(row: any): number {
  const remaining = Number(row.remaining_balance || 0);
  const rate = Number(row.interest_rate || 0) / 100 / 12;
  const start = row.start_date ? new Date(row.start_date) : new Date();
  const maturity = row.maturity_date ? new Date(row.maturity_date) : null;

  if (!maturity || remaining <= 0) return 0;

  const now = new Date();
  const monthsLeft = Math.max(1, Math.round(
    (maturity.getTime() - now.getTime()) / (1000 * 60 * 60 * 24 * 30),
  ));

  const loanType = row.loan_type || 'term';
  if (loanType === 'bullet') {
    // Interest only
    return Math.round(remaining * rate);
  }

  if (rate === 0) {
    // No interest, equal principal
    return Math.round(remaining / monthsLeft);
  }

  // Annuity formula for equal_payment
  const factor = Math.pow(1 + rate, monthsLeft);
  return Math.round(remaining * (rate * factor) / (factor - 1));
}

// ═══════════════════════════════════════════════════════════════════════
// Monthly Budget Overview (12-month)
// ═══════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════
// 고정비 한 벌 — 월별 표(자금 전망 › 월별 흐름·비용 분석)·고정비 세부내역·셀 산출 내역이 같이 쓴다
// ═══════════════════════════════════════════════════════════════════════
//   예전엔 세 곳이 따로 셌다. 월별 표는 고정비 표를 이름 없이 읽어 정기 지출과 이름이 같은 것(사무실 임차료)을
//   두 번 더했고, 세부내역은 '현재 월액 × 경과월'·'현재 급여 × 경과월'로 세어 월별 표 합계와 어긋났다.
//   규칙(달마다):
//     ① 정기 지출(recurring_payments, 활성) — 등록한 달부터.
//     ② 고정비 표(fixed_costs) — 시작·종료일 안. 그 달 정기 지출과 이름이 같으면 한 번만(정기 지출 쪽).
//     ③ 급여 — 그 달 재직자만, 입사·퇴사 달은 일할(payroll.getSalaryByMonth).
//     ④ 통장 '고정비' 체크 출금(is_fixed_cost) — 그 달 ①·②로 이미 잡힌 항목의 실제 출금이면 뺀다
//        (recurring-match 의 이름·낱말 + 금액 ±10% 판정 — 요금이 조금 오른 달도 같은 항목이다). 비용 계정이 아닌 것(대출 원금·이체)도 뺀다.

export type FixedCostCategory = (typeof FIXED_COST_CATEGORIES)[number]['value'] | 'bank_fixed';
export interface FixedCostLine {
  source: 'recurring' | 'fixed_cost' | 'salary' | 'bank';
  category: FixedCostCategory;
  label: string;
  sub?: string;
  amount: number;
  refId?: string;
}
export interface FixedCostSources {
  recurring: any[];
  fixedCosts: any[];
  bankFixed: any[];
  isCost: (category: string | null | undefined) => boolean;
  salaryFor: (ym: string) => number;
}

const normName = (s: unknown) => String(s || '').toLowerCase().replace(/\s+/g, '');
const lastDayOf = (ym: string) => { const [y, m] = ym.split('-').map(Number); return `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`; };

/** 한 달(YYYY-MM)의 고정비 줄 — 순수 계산. 합계는 줄의 합이다 */
export function fixedCostLinesForMonth(src: FixedCostSources, ym: string): FixedCostLine[] {
  const monthStart = `${ym}-01`, monthEnd = lastDayOf(ym);
  const lines: FixedCostLine[] = [];
  //   ① 정기 지출 — 등록한 달부터 (지난달 등록한 것이 1월부터 매달 잡히던 것)
  const recs = src.recurring.filter((rp) => rp.is_active !== false && (!rp.created_at || String(rp.created_at).slice(0, 7) <= ym));
  for (const rp of recs) {
    lines.push({ source: 'recurring', category: mapRecurringCategory(rp.category) as FixedCostCategory, label: rp.name || '정기 지출', sub: rp.day_of_month ? `정기 지출 · 매월 ${rp.day_of_month}일` : '정기 지출', amount: Number(rp.amount || 0), refId: rp.id });
  }
  //   ② 고정비 표 — 기간 안, 정기 지출과 이름이 같으면 한 번만
  const recNames = new Set(recs.map((rp) => normName(rp.name)));
  const fcs = src.fixedCosts.filter((fc) => fc.is_recurring !== false
    && !(fc.start_date && String(fc.start_date) > monthEnd)
    && !(fc.end_date && String(fc.end_date) < monthStart)
    && !recNames.has(normName(fc.name)));
  for (const fc of fcs) {
    lines.push({ source: 'fixed_cost', category: mapRecurringCategory(fc.category) as FixedCostCategory, label: fc.name || '고정비', sub: fc.payment_day ? `고정비 등록 · 매월 ${fc.payment_day}일` : '고정비 등록', amount: Number(fc.amount || 0), refId: fc.id });
  }
  //   ③ 급여
  const salary = Number(src.salaryFor(ym) || 0);
  if (salary > 0) lines.push({ source: 'salary', category: 'salary', label: '급여 (그 달 재직 직원 합계)', sub: '인사관리 등록 급여 · 입사·퇴사 달은 일할', amount: salary });
  //   ④ 통장 고정비 체크 출금 — ①·② 항목의 실제 출금이면 이미 센 것
  const patterns = buildRecurringPatterns([...recs, ...fcs].map((r) => ({ id: r.id, name: r.name, amount: r.amount, is_active: true })));
  for (const t of src.bankFixed) {
    if (!String(t.transaction_date || '').startsWith(ym)) continue;
    const cat = t.category || t.classification || '';
    if (!src.isCost(cat)) continue;
    if (matchRecurring({ type: 'expense', counterparty: t.counterparty, description: t.description, amount: Math.abs(Number(t.amount || 0)) }, patterns, 0.1)) continue;
    lines.push({ source: 'bank', category: 'bank_fixed', label: t.counterparty || t.description || '통장 지출', sub: `${t.transaction_date ?? ''}${cat ? ` · ${cat}` : ''} · 통장 고정비 체크`, amount: Math.abs(Number(t.amount || 0)), refId: t.id });
  }
  return lines;
}

/** 고정비 계산 재료 — 기간(from~to) 안의 통장 체크 거래까지 한 번에 */
export async function loadFixedCostSources(companyId: string, from: string, to: string): Promise<FixedCostSources> {
  const [recRes, fcRes, bankRes, accountMap, salaryFor] = await Promise.all([
    db.from('recurring_payments').select('id, name, amount, category, is_active, day_of_month, created_at').eq('company_id', companyId).eq('is_active', true).order('id').limit(1000),
    db.from('fixed_costs').select('id, name, amount, category, payment_day, is_recurring, start_date, end_date').eq('company_id', companyId).eq('is_recurring', true).order('id').limit(1000),
    fetchPagedRes('cashBudget.bankFixed', () => db.from('bank_transactions')
      .select('id, amount, transaction_date, counterparty, description, category, classification')
      .eq('company_id', companyId)
      .eq('type', 'expense')
      .eq('is_fixed_cost', true)
      .gte('transaction_date', from)
      .lte('transaction_date', to)
      .order('transaction_date', { ascending: true })
      .order('id', { ascending: true }), 50000),
    getAccountMap(companyId),
    getSalaryByMonth(companyId).catch(() => () => 0),
  ]);
  return {
    recurring: (recRes.data || []) as any[],
    fixedCosts: (fcRes.data || []) as any[],
    bankFixed: (bankRes.data || []) as any[],
    isCost: (c) => isCostAccount(c, accountMap),
    salaryFor,
  };
}

/**
 * 달별 월말 통장 잔액 — 순수 계산.
 *   달별 잔액 이력 테이블이 없어서 예전엔 모든 달(미래 포함)에 현재 잔액을 그대로 채웠다.
 *   지금은 현재 잔액 − (그 달 말일 다음 날부터 오늘까지 통장 순입출금)으로 거꾸로 구한다.
 *   근거가 없는 달은 null: 아직 안 온 달, 통장 거래가 처음 수집된 달보다 앞선 달(그때 거래를 모른다).
 *   이번 달은 현재 잔액(월말이 아직 안 왔다).
 */
export function monthEndBalances(
  currentBalance: number,
  flows: Array<{ amount: number | string | null; type: string | null; transaction_date: string | null }>,
  months: string[],
  today: string,
  firstTxDate: string | null,
): Record<string, number | null> {
  const thisMonth = today.slice(0, 7);
  const firstMonth = firstTxDate ? String(firstTxDate).slice(0, 7) : null;
  const signed = flows.map((f) => ({ d: String(f.transaction_date || '').slice(0, 10), v: (f.type === 'income' ? 1 : -1) * Math.abs(Number(f.amount || 0)) }));
  const out: Record<string, number | null> = {};
  for (const m of months) {
    if (m > thisMonth) { out[m] = null; continue; }
    if (m === thisMonth) { out[m] = currentBalance; continue; }
    if (!firstMonth || m < firstMonth) { out[m] = null; continue; }
    const end = lastDayOf(m);
    const after = signed.filter((f) => f.d > end && f.d <= today).reduce((s, f) => s + f.v, 0);
    out[m] = Math.round(currentBalance - after);
  }
  return out;
}

export async function getMonthlyBudgetOverview(
  companyId: string,
  year: number,
): Promise<MonthlyBudget[]> {
  const months = monthRange(year);
  const startDate = `${year}-01-01`;
  const endDate = `${year}-12-31`;

  // Parallel data fetching
  const [
    bankAccountsRes,
    fixedSrc,
    invoicesRes,
    paymentsRes,
    ownerInjectionsRes,
    cardTransactionsRes,
    bankFlowRes,
    firstTxRes,
  ] = await Promise.all([
    // 현재 잔액 — 달별 잔액 이력 테이블이 없어 월말 잔액은 아래에서 통장 거래로 거꾸로 구한다
    db.from('bank_accounts')
      .select('balance')
      .eq('company_id', companyId),

    // 고정비 재료 — 정기 지출·고정비 표·통장 고정비 체크·급여 (loadFixedCostSources 한 벌)
    loadFixedCostSources(companyId, startDate, endDate),

    // Invoices for sales revenue — 연간 윈도우가 1000행(서버 max_rows) 넘으면 잘리므로 페이징
    fetchPagedRes('cashBudget.taxInvoices', () => db.from('tax_invoices')
      .select('supply_amount, tax_amount, issue_date, type')
      .eq('company_id', companyId)
      .neq('status', 'void').neq('status', 'draft') // 무효·미발행 초안은 매출이 아니다(같은 화면의 다른 표와 같은 기준)
      .gte('issue_date', startDate)
      .lte('issue_date', endDate)
      .order('id', { ascending: true })),

    // Payment queue items (expenses)
    db.from('payment_queue')
      .select('amount, category, status, created_at, is_recurring')
      .eq('company_id', companyId)
      .gte('created_at', startDate)
      .lte('created_at', endDate),

    // Owner injections (가수금)
    db.from('owner_injections')
      .select('amount, date')
      .eq('company_id', companyId)
      .gte('date', startDate)
      .lte('date', endDate),

    // Card transactions (variable costs) — 연간 윈도우 1000행 초과 절단 방지 페이징
    fetchPagedRes('cashBudget.cardTx', () => db.from('card_transactions')
      .select('amount, category, transaction_date, merchant_name')
      .eq('company_id', companyId)
      .gte('transaction_date', startDate)
      .lte('transaction_date', endDate)
      .order('id', { ascending: true })),

    // 월말 잔액 역산용 — 올해 1월 1일 이후 통장 입출금 전부(오늘 이후 날짜는 없다). 방향은 type 으로 본다
    fetchPagedRes('cashBudget.bankFlow', () => db.from('bank_transactions')
      .select('amount, type, transaction_date')
      .eq('company_id', companyId)
      .gte('transaction_date', startDate)
      .order('transaction_date', { ascending: true })
      .order('id', { ascending: true }), 100000),
    // 통장 거래가 처음 수집된 날 — 그 전 달은 역산 근거가 없다
    db.from('bank_transactions')
      .select('transaction_date')
      .eq('company_id', companyId)
      .order('transaction_date', { ascending: true })
      .limit(1),
  ]);

  const snapshots = bankAccountsRes.data || [];
  const invoices = invoicesRes.data || [];
  const payments = paymentsRes.data || [];
  const ownerInjections = ownerInjectionsRes.data || [];
  const cardTxns = cardTransactionsRes.data || [];
  const currentBalance = snapshots.reduce((sum: number, a: any) => sum + Number(a.balance || 0), 0);
  const firstTxDate = ((firstTxRes.data || []) as any[])[0]?.transaction_date ?? null;
  const eomBalance = monthEndBalances(currentBalance, (bankFlowRes.data || []) as any[], months, todayKst(), firstTxDate);

  // Build per-month budget
  let cumulativeNet = 0;

  return months.map((month) => {
    const monthPrefix = month; // '2026-01'

    // ── Income ──
    const monthInvoices = invoices.filter(
      (inv: any) => inv.issue_date?.startsWith(monthPrefix) && inv.type === 'sales',
    );
    //   매출 = 공급가액. 부가세는 매출이 아니라 맡아 둔 돈이라 세무 행(부가세 납부 예상)에서 따로 본다 —
    //   경영 요약·손익(전표)의 매출과 같은 기준이다.
    const salesRevenue = monthInvoices.reduce(
      (sum: number, inv: any) => sum + Number(inv.supply_amount || 0),
      0,
    );

    const monthInjections = ownerInjections.filter(
      (inj: any) => inj.date?.startsWith(monthPrefix),
    );
    const ownerInjection = monthInjections.reduce(
      (sum: number, inj: any) => sum + Number(inj.amount || 0),
      0,
    );

    // Subsidies: purchase invoices flagged as subsidies or specific categories
    const subsidies = 0; // Placeholder — will come from dedicated subsidy tracking

    const otherIncome = 0; // Placeholder for interest income, etc.
    const incomeTotal = salesRevenue + ownerInjection + subsidies + otherIncome;

    // ── Fixed Costs ── (fixedCostLinesForMonth 한 벌 — 세부내역·셀 산출 내역과 같은 줄)
    const totalFixed = fixedCostLinesForMonth(fixedSrc, monthPrefix).reduce((sum, l) => sum + l.amount, 0);

    // ── Variable Costs ──
    // 취소(cancelled)된 지출까지 비용으로 세던 것을 뺐다 (2026-08-10)
    const monthPayments = payments.filter(
      (p: any) => p.created_at?.startsWith(monthPrefix) && !p.is_recurring && p.status !== 'cancelled',
    );
    const variableFromPayments = monthPayments.reduce(
      (sum: number, p: any) => sum + Number(p.amount || 0),
      0,
    );

    const monthCardTxns = cardTxns.filter(
      (t: any) => t.transaction_date?.startsWith(monthPrefix),
    );
    const variableFromCards = monthCardTxns.reduce(
      (sum: number, t: any) => sum + Number(t.amount || 0),
      0,
    );

    const variableCosts = variableFromPayments + variableFromCards;
    const expenseTotal = totalFixed + variableCosts;

    // ── Bank Balance ── 그 달 말 잔액. 거래 이력으로 못 구하는 달(수집 전·미래)은 null
    const bankBalance = eomBalance[monthPrefix] ?? null;

    // ── Net ──
    const monthNet = incomeTotal - expenseTotal;
    cumulativeNet += monthNet;

    return {
      month,
      incomeTotal,
      bankBalance,
      salesRevenue,
      subsidies,
      ownerInjection,
      otherIncome,
      expenseTotal,
      fixedCosts: totalFixed,
      variableCosts,
      netProfit: cumulativeNet,
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════
// Fixed/Variable Cost Breakdown by Category (연간)
// — 고정비/변동비 category별 세부내역.
// 소스 (prod 스키마 검증 반영):
// · 고정비 = recurring_payments(is_active) category별 + 급여(employees)
// - fixed_costs 테이블은 prod 미존재 → 제외 (getMonthlyBudgetOverview 와 동일하게 사실상 미반영)
// · 변동비 = card_transactions category별 (연 범위)
// - payment_queue 는 due_date 컬럼 부재 → 제외 (월별표 변동비와 정합 유지: card 만 집계됨)
// ═══════════════════════════════════════════════════════════════════════

export interface CostCategoryRow {
  category: string;
  label: string;
  amount: number; // 연간 합계
  monthly: number; // 월 환산
}

export interface CostBreakdown {
  year: number;
  fixed: CostCategoryRow[];
  variable: CostCategoryRow[];
  fixedTotal: number;
  variableTotal: number;
}

function mapRecurringCategory(cat: string | null): string {
  const c = (cat || '').toLowerCase();
  if (/rent|임대|임차|office|사무/.test(c)) return 'office';
  if (/insur|보험|4대/.test(c)) return 'insurance';
  if (/loan|대출|이자/.test(c)) return 'loan';
  if (/salary|급여|월급|인건/.test(c)) return 'salary';
  if (/subscri|구독|정기|software|telecom|util/.test(c)) return 'subscription';
  if (/tax|세금|부가/.test(c)) return 'tax';
  if (FIXED_COST_CATEGORIES.some((f) => f.value === c)) return c;
  return 'other';
}

function mapVariableCategory(cat: string | null): string {
  const c = (cat || '').toLowerCase();
  if (/market|광고|마케팅/.test(c)) return 'marketing';
  if (/out|외주/.test(c)) return 'outsourcing';
  if (/consult|컨설|수수료|지급수수료/.test(c)) return 'consulting';
  if (/suppl|소모|비품|office_supplies|사무용품/.test(c)) return 'supplies';
  if (VARIABLE_COST_CATEGORIES.some((v) => v.value === c)) return c;
  return 'other_variable';
}

/** 비용 분석이 보는 달 — 지난 해는 12달, 올해는 이번 달까지, 앞으로 올 해는 없음 (화면 표와 같은 범위) */
export function elapsedMonthKeys(year: number, today = todayKst()): string[] {
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  const n = year < y ? 12 : year > y ? 0 : m;
  return monthRange(year).slice(0, n);
}

export async function getCostBreakdown(
  companyId: string,
  year: number,
): Promise<CostBreakdown> {
  const startDate = `${year}-01-01`;
  const endDate = `${year}-12-31`;

  const [fixedSrc, cardRes, pqRes] = await Promise.all([
    // 고정비 — 월별 표와 같은 재료·같은 달별 규칙(fixedCostLinesForMonth)으로 센다
    loadFixedCostSources(companyId, startDate, endDate),
    fetchPagedRes('fixedCosts.cardTx', () => db.from('card_transactions')
      .select('amount, category, transaction_date')
      .eq('company_id', companyId)
      .gte('transaction_date', startDate)
      .lte('transaction_date', endDate)
      .order('id', { ascending: true })),
    // 변동비의 나머지 한 축 — 월별표에는 들어가는데 세부내역에는 없어서 위아래 합계가 어긋났다 (2026-08-10)
    db.from('payment_queue')
      .select('amount, category, status, created_at, is_recurring')
      .eq('company_id', companyId)
      .gte('created_at', `${startDate}T00:00:00+09:00`) // created_at 은 시각 — 한국 시간 경계로 자른다
      .lte('created_at', `${endDate}T23:59:59+09:00`),
  ]);

  // 변동비: 카드 실지출 연 합계
  const variableYear: Record<string, number> = {};
  for (const t of (cardRes.data || [])) {
    const k = mapVariableCategory(t.category);
    variableYear[k] = (variableYear[k] || 0) + Number(t.amount || 0);
  }

  // 고정비 — 지나간 달(이번 달 포함)마다 fixedCostLinesForMonth 를 더한다. 월별 표의 같은 달 합계와 한 원이 다르지 않다.
  //   예전엔 '현재 월액 × 경과월'이라 올해 중간에 등록한 정기 지출·입사자 급여가 1월부터 있던 것처럼 부풀었다.
  const monthKeys = elapsedMonthKeys(year);
  const fixedYear: Record<string, number> = {};
  for (const ym of monthKeys) for (const l of fixedCostLinesForMonth(fixedSrc, ym)) fixedYear[l.category] = (fixedYear[l.category] || 0) + l.amount;
  const monthsElapsed = Math.max(1, monthKeys.length);
  const fixed: CostCategoryRow[] = [
    ...FIXED_COST_CATEGORIES.map((f) => ({ category: f.value as string, label: f.label as string })),
    { category: 'bank_fixed', label: '통장 고정비(체크 거래)' },
  ]
    .map((f) => ({ ...f, amount: fixedYear[f.category] || 0, monthly: Math.round((fixedYear[f.category] || 0) / monthsElapsed) }))
    .filter((r) => r.amount > 0);
  fixed.sort((a, b) => b.amount - a.amount);

  const variable: CostCategoryRow[] = VARIABLE_COST_CATEGORIES
    .map((v) => ({ category: v.value, label: v.label, amount: variableYear[v.value] || 0, monthly: Math.round((variableYear[v.value] || 0) / 12) }))
    .filter((r) => r.amount > 0);
  // 결제 대기(일회성 지출) — 취소된 건은 뺀다. 월별표와 같은 규칙이라야 위아래 합계가 맞는다.
  const pqTotal = (pqRes.data || [])
    .filter((p: any) => !p.is_recurring && p.status !== 'cancelled')
    .reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
  if (pqTotal > 0) {
    variable.push({ category: 'payment_queue', label: '결제 대기(일회성 지출)', amount: pqTotal, monthly: Math.round(pqTotal / 12) });
  }
  variable.sort((a, b) => b.amount - a.amount);

  return {
    year,
    fixed,
    variable,
    fixedTotal: fixed.reduce((s, r) => s + r.amount, 0),
    variableTotal: variable.reduce((s, r) => s + r.amount, 0),
  };
}

// ═══════════════════════════════════════════════════════════════════════
// Cost Category Detail — 고정비/변동비 세부내역 카테고리 행 클릭 시 산출 내역
// getCostBreakdown 과 동일한 소스·매핑으로 개별 레코드를 나열해 표 값과 정합 유지.
// ═══════════════════════════════════════════════════════════════════════

export interface CostDetailItem {
  label: string;
  sub?: string;
  amount: number;
  recurringId?: string; // 정기결제 항목이면 그 id — 고정비 확인 화면에서 바로 제거(비활성) 가능
}

export async function getCostCategoryDetail(
  companyId: string,
  year: number,
  kind: 'fixed' | 'variable',
  category: string,
): Promise<CostDetailItem[]> {
  const startDate = `${year}-01-01`;
  const endDate = `${year}-12-31`;

  if (kind === 'variable' && category === 'payment_queue') {
    // 결제 대기(일회성 지출) — 취소 건 제외, 합계와 같은 규칙 (2026-08-10)
    const data = await fetchPaged<any>('lib/cash-budget:pq', () => db.from('payment_queue')
      .select('description, category, amount, status, created_at, is_recurring')
      .eq('company_id', companyId)
      .gte('created_at', `${startDate}T00:00:00+09:00`)
      .lte('created_at', `${endDate}T23:59:59+09:00`)
      .order('created_at', { ascending: false })
      .order('id'), 50000);
    return (data || [])
      .filter((p: any) => !p.is_recurring && p.status !== 'cancelled')
      .map((p: any) => ({
        label: p.description || p.category || '일회성 지출',
        sub: [p.created_at?.slice(0, 10), p.status].filter(Boolean).join(' · '),
        amount: Number(p.amount || 0),
      }));
  }

  if (kind === 'variable') {
    // 변동비 = 카드 실지출 (연 범위, 카테고리 매핑 동일)
    const data = await fetchPaged<any>('lib/cash-budget:data', () => db.from('card_transactions')
      .select('merchant_name, category, transaction_date, amount')
      .eq('company_id', companyId)
      .gte('transaction_date', startDate)
      .lte('transaction_date', endDate)
      .order('transaction_date', { ascending: false })
      .order('id'), 50000);
    return (data || [])
      .filter((t: any) => mapVariableCategory(t.category) === category)
      .map((t: any) => ({ label: t.merchant_name || t.category || '카드', sub: t.transaction_date ?? undefined, amount: Number(t.amount || 0) }));
  }

  // 고정비 카테고리(통장 체크 거래 포함) — 세부내역 합계와 같은 줄(fixedCostLinesForMonth)을 지나간 달마다 모아 항목별로 더한다.
  //   정기 지출 줄은 id 를 달아 고정비 확인 화면에서 바로 제거(비활성)할 수 있게 한다.
  const src = await loadFixedCostSources(companyId, startDate, endDate);
  const byKey = new Map<string, CostDetailItem & { months: number; bank: boolean }>();
  for (const ym of elapsedMonthKeys(year)) {
    for (const l of fixedCostLinesForMonth(src, ym)) {
      if (l.category !== category) continue;
      //   통장 거래는 한 줄씩, 등록 항목·급여는 항목 하나로 달을 합친다
      const key = l.source === 'bank' ? `bank:${l.refId ?? `${ym}:${l.label}:${l.amount}`}` : `${l.source}:${l.refId ?? l.label}`;
      const cur = byKey.get(key);
      if (cur) { cur.amount += l.amount; cur.months += 1; continue; }
      byKey.set(key, { label: l.label, sub: l.sub, amount: l.amount, months: 1, bank: l.source === 'bank', ...(l.source === 'recurring' && l.refId ? { recurringId: l.refId } : {}) });
    }
  }
  return [...byKey.values()]
    .map(({ months, bank, ...it }) => ({ ...it, sub: bank ? it.sub : `${it.sub ? `${it.sub} · ` : ''}${months}개월 합계` }))
    .sort((x, y) => y.amount - x.amount);
}

// ═══════════════════════════════════════════════════════════════════════
// Daily Cash Projection
// ═══════════════════════════════════════════════════════════════════════

export async function getDailyCashProjection(
  companyId: string,
  month: string, // '2026-03'
): Promise<DailyCashProjection[]> {
  const [yearStr, monthStr] = month.split('-');
  const year = parseInt(yearStr);
  const monthNum = parseInt(monthStr);
  const numDays = daysInMonth(year, monthNum);
  const startDate = `${month}-01`;
  const endDate = `${month}-${numDays.toString().padStart(2, '0')}`;

  // Fetch all relevant data
  const [
    snapshotRes,
    fixedCostsRes,
    recurringRes,
    invoicesRes,
    paymentsRes,
    loansRes,
    ownerInjectionsRes,
  ] = await Promise.all([
    // Opening bank balance — latest snapshot before this month or start of month
    db.from('bank_accounts')
      .select('balance')
      .eq('company_id', companyId),

    db.from('fixed_costs')
      .select('name, amount, payment_day, category')
      .eq('company_id', companyId)
      .eq('is_recurring', true),

    db.from('recurring_payments')
      .select('name, amount, category, day_of_month')
      .eq('company_id', companyId)
      .eq('is_active', true),

    // Receivable invoices due this month
    fetchPagedRes('cashBudget.monthInvoices', () => db.from('tax_invoices')
      .select('supply_amount, tax_amount, issue_date, counterparty_name, type')
      .eq('company_id', companyId)
      .gte('issue_date', startDate)
      .lte('issue_date', endDate)
      .order('id', { ascending: true })),

    // Payment queue items due this month
    db.from('payment_queue')
      .select('amount, description, category, created_at, status')
      .eq('company_id', companyId)
      .gte('created_at', startDate)
      .lte('created_at', endDate)
      .neq('status', 'cancelled'),

    // Active loans with payment days
    db.from('loans')
      .select('name, remaining_balance, interest_rate, payment_day, loan_type, start_date, maturity_date')
      .eq('company_id', companyId)
      .eq('status', 'active'),

    // Owner injections this month
    db.from('owner_injections')
      .select('amount, date, note')
      .eq('company_id', companyId)
      .gte('date', startDate)
      .lte('date', endDate),
  ]);

  const openingBalance = (snapshotRes.data || []).reduce(
    (sum: number, a: any) => sum + Number(a.balance || 0),
    0,
  );

  // Collect all daily events
  const events: Array<{
    day: number;
    date: string;
    description: string;
    amount: number;
    category: string;
  }> = [];

  // Fixed costs from fixed_costs table
  for (const fc of (fixedCostsRes.data || [])) {
    const day = clampDay(fc.payment_day, numDays);
    events.push({
      day,
      date: `${month}-${day.toString().padStart(2, '0')}`,
      description: fc.name,
      amount: -Number(fc.amount),
      category: CATEGORY_LABELS[fc.category] || fc.category,
    });
  }

  // Recurring payments
  for (const rp of (recurringRes.data || [])) {
    const day = clampDay(rp.day_of_month || 1, numDays);
    // Skip if already covered by fixed_costs (check by name)
    const alreadyCovered = (fixedCostsRes.data || []).some(
      (fc: any) => fc.name === rp.name,
    );
    if (alreadyCovered) continue;

    events.push({
      day,
      date: `${month}-${day.toString().padStart(2, '0')}`,
      description: rp.name,
      amount: -Number(rp.amount),
      category: CATEGORY_LABELS[rp.category] || rp.category || '정기지출',
    });
  }

  // Loan payments
  for (const loan of (loansRes.data || [])) {
    if (!loan.payment_day) continue;
    const day = clampDay(loan.payment_day, numDays);
    const monthly = estimateMonthlyPayment(loan);
    if (monthly <= 0) continue;

    events.push({
      day,
      date: `${month}-${day.toString().padStart(2, '0')}`,
      description: `${loan.name} 상환`,
      amount: -monthly,
      category: '대출상환',
    });
  }

  // Income from invoices (sales)
  for (const inv of (invoicesRes.data || [])) {
    if (inv.type !== 'sales') continue;
    const issueDate = inv.issue_date || startDate;
    const day = parseInt(issueDate.slice(8, 10)) || 1;
    const total = Number(inv.supply_amount || 0) + Number(inv.tax_amount || 0);

    events.push({
      day,
      date: issueDate,
      description: `매출: ${inv.counterparty_name || '거래처'}`,
      amount: total,
      category: '매출입금',
    });
  }

  // Payment queue items (outgoing)
  for (const pq of (paymentsRes.data || [])) {
    const createdDate = typeof pq.created_at === 'string' ? pq.created_at.slice(0, 10) : startDate;
    const day = parseInt(createdDate.slice(8, 10)) || 1;

    events.push({
      day,
      date: createdDate,
      description: pq.description || '지출',
      amount: -Number(pq.amount),
      category: (pq.category && CATEGORY_LABELS[pq.category]) || pq.category || '지출',
    });
  }

  // Owner injections (inflow)
  for (const inj of (ownerInjectionsRes.data || [])) {
    const day = parseInt(inj.date?.slice(8, 10) || '1');
    events.push({
      day,
      date: inj.date,
      description: `대표 가수금${inj.note ? ': ' + inj.note : ''}`,
      amount: Number(inj.amount),
      category: '가수금',
    });
  }

  // Sort by day, then by amount (income first)
  events.sort((a, b) => {
    if (a.day !== b.day) return a.day - b.day;
    return b.amount - a.amount; // positive (income) first
  });

  // Build running balance
  let balance = openingBalance;
  const projections: DailyCashProjection[] = [];

  // Opening entry
  projections.push({
    date: startDate,
    description: '월초 잔액',
    amount: 0,
    runningBalance: balance,
    category: '잔액',
  });

  for (const event of events) {
    balance += event.amount;
    projections.push({
      date: event.date,
      description: event.description,
      amount: event.amount,
      runningBalance: balance,
      category: event.category,
    });
  }

  // Save projection snapshot
  await saveCashProjection(companyId, month, projections);

  return projections;
}

// ═══════════════════════════════════════════════════════════════════════
// Cash Shortfall Alerts
// ═══════════════════════════════════════════════════════════════════════

export async function getCashShortfallAlerts(
  companyId: string,
  month: string,
): Promise<CashShortfallAlert[]> {
  const projections = await getDailyCashProjection(companyId, month);

  const alerts: CashShortfallAlert[] = [];
  const seenDates = new Set<string>();

  for (const proj of projections) {
    if (proj.runningBalance < 0 && !seenDates.has(proj.date)) {
      seenDates.add(proj.date);

      // Find all items due on this date
      const dayItems = projections.filter(
        (p) => p.date === proj.date && p.amount < 0,
      );

      alerts.push({
        date: proj.date,
        projectedBalance: proj.runningBalance,
        shortfallAmount: Math.abs(proj.runningBalance),
        dueDateItems: dayItems.map((p) => `${p.description} (${fmtKRW(Math.abs(p.amount))}원)`),
      });
    }
  }

  return alerts;
}

// ═══════════════════════════════════════════════════════════════════════
// Retirement Pay Provisions
// ═══════════════════════════════════════════════════════════════════════

export async function getRetirementPayProvisions(
  companyId: string,
): Promise<RetirementProvision[]> {
  const { data: employees, error } = await db
    .from('employees')
    .select('id, name, salary, hire_date, status')
    .eq('company_id', companyId)
    .in('status', ['active', 'joined']);

  if (error) throw error;
  if (!employees?.length) return [];

  const today = todayKst();
  const provisions: RetirementProvision[] = [];

  for (const emp of employees) {
    const salary = Number(emp.salary || 0);
    if (salary <= 0 || !emp.hire_date) continue;

    const result = calculateRetirementPay({
      startDate: emp.hire_date,
      endDate: today,
      last3MonthsSalary: salary * 3, // 3 months of current salary
    });

    provisions.push({
      employeeId: emp.id,
      employeeName: emp.name,
      startDate: emp.hire_date,
      salary,
      totalDays: result.totalDays,
      eligible: result.eligible,
      retirementPay: result.retirementPay,
      dailyAvgWage: result.dailyAvgWage,
    });
  }

  // Sort by retirement pay descending
  provisions.sort((a, b) => b.retirementPay - a.retirementPay);
  return provisions;
}

// ═══════════════════════════════════════════════════════════════════════
// Cash Projection Snapshot (save to DB)
// ═══════════════════════════════════════════════════════════════════════

async function saveCashProjection(
  companyId: string,
  month: string,
  projections: DailyCashProjection[],
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();

  await db
    .from('cash_projections')
    .upsert(
      {
        company_id: companyId,
        month,
        projection_data: projections as never,
        generated_at: new Date().toISOString(),
        generated_by: user?.id || null,
      },
      { onConflict: 'company_id,month' },
    );
}
