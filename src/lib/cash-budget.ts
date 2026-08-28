import { todayKst } from "@/lib/kst";
import { logRead } from "@/lib/log-read";
/**
 * OwnerView Cash Budget / Treasury Management
 * 자금 예산 관리 — 월별 자금 개요, 고정/변동비, 일별 자금 흐름, 대출 현황, 퇴직금 충당
 */

import { supabase } from './supabase';
import { fetchPaged, fetchPagedRes } from './fetch-paged';
import { calculateRetirementPay } from './payment-batch';
import { getMonthlyTotalSalary } from './payroll';
import { getAccountMap, isCostAccount } from './account-nature';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { loadKoreanFont } from './pdf-korean-font';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase;

// ═══════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════

export interface MonthlyBudget {
  month: string;          // '2026-01'
  incomeTotal: number;
  bankBalance: number;
  salesRevenue: number;
  subsidies: number;
  ownerInjection: number; // 대표님 가수금
  otherIncome: number;
  expenseTotal: number;
  fixedCosts: number;
  variableCosts: number;
  netProfit: number;      // cumulative
}

export interface FixedCostItem {
  id: string;
  name: string;
  amount: number;
  paymentDay: number;     // day of month
  category: 'office' | 'insurance' | 'loan' | 'salary' | 'subscription' | 'tax' | 'other';
  isRecurring: boolean;
  startDate?: string;
  endDate?: string;
  note?: string;
}

export interface DailyCashProjection {
  date: string;           // 'YYYY-MM-DD'
  description: string;
  amount: number;         // negative for outflow
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

function estimateMonthlyPayment(row: any): number {
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

// 정기결제(recurring_payments) ↔ 통장 '고정비' 체크 거래 중복 제거 매처 (2026-07-10 사장님 QA).
//   이름(정규화 부분일치) + 금액(±10%, 정기결제 금액 있을 때) 이 모두 맞으면 같은 지출로 간주 →
//   통장 체크 거래를 고정비 합산에서 제외(정기결제 월액이 이미 대표). 이름 2자 미만은 오탐 방지 위해 미매칭.
function buildRecurringTxMatcher(
  recs: Array<{ name?: string | null; amount?: number | null }>,
): (counterparty?: string | null, description?: string | null, amount?: number | null) => boolean {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '');
  const rules = (recs || [])
    .map((r) => ({ name: norm(String(r.name || '')), amount: Math.abs(Number(r.amount || 0)) }))
    .filter((r) => r.name.length >= 2);
  if (rules.length === 0) return () => false;
  return (counterparty, description, amount) => {
    const t = norm([counterparty, description].filter(Boolean).join(' '));
    if (!t) return false;
    const amt = Math.abs(Number(amount || 0));
    return rules.some((r) => {
      const nameHit = t.includes(r.name) || (t.length >= 2 && r.name.includes(t));
      if (!nameHit) return false;
      if (r.amount > 0 && amt > 0) return Math.abs(amt - r.amount) / r.amount <= 0.1;
      return true;
    });
  };
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
    recurringRes,
    fixedCostsRes,
    invoicesRes,
    paymentsRes,
    ownerInjectionsRes,
    cardTransactionsRes,
  ] = await Promise.all([
    // Bank balance — current total across bank_accounts (no historical snapshot table)
    db.from('bank_accounts')
      .select('balance')
      .eq('company_id', companyId),

    // Recurring payments (for fixed cost estimates) — name 은 통장 고정비 체크 거래와의 중복 제거 매칭용
    db.from('recurring_payments')
      .select('name, amount, category, is_active, day_of_month')
      .eq('company_id', companyId)
      .eq('is_active', true),

    // Fixed costs from the new table
    db.from('fixed_costs')
      .select('amount, category, payment_day, is_recurring, start_date, end_date')
      .eq('company_id', companyId)
      .eq('is_recurring', true),

    // Invoices for sales revenue — 연간 윈도우가 1000행(서버 max_rows) 넘으면 잘리므로 페이징
    fetchPagedRes('cashBudget.taxInvoices', () => db.from('tax_invoices')
      .select('supply_amount, tax_amount, issue_date, type')
      .eq('company_id', companyId)
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
  ]);

  // 통장 거래 중 '고정비' 체크(is_fixed_cost — 전표처리/매핑에서 체크)된 지출 — 고정비 실적으로 합산.
  //   2026-07-10: 같은 지출이 정기결제(recurring_payments)로도 등록돼 있으면(이름+금액 매칭) 그 거래는
  //   자동 제외해 중복 집계를 차단 — "통장 고정비 체크 + 예전 등록 항목이 중복으로 나온다" (사장님 QA).
  const [bankFixedRes, accountMap, salaryMonthly] = await Promise.all([
    db.from('bank_transactions')
      .select('amount, transaction_date, counterparty, description, category')
      .eq('company_id', companyId)
      .eq('type', 'expense')
      .eq('is_fixed_cost', true)
      .gte('transaction_date', startDate)
      .lte('transaction_date', endDate),
    getAccountMap(companyId),
    //   급여 — 예전엔 월별표에만 빠져 있어서 위 카드(총비용)와 아래 세부내역이 서로 달랐다 (2026-08-10)
    getMonthlyTotalSalary(companyId).catch(() => 0),
  ]);

  const snapshots = bankAccountsRes.data || [];
  const recurring = recurringRes.data || [];
  const fixedCosts = fixedCostsRes.data || [];
  const invoices = invoicesRes.data || [];
  const payments = paymentsRes.data || [];
  const ownerInjections = ownerInjectionsRes.data || [];
  const cardTxns = cardTransactionsRes.data || [];
  // 정기결제와 매칭되는 고정비 체크 거래 제외(중복 차단) — 정기결제(월액 추정)가 이미 그 지출을 대표
  const matchesRecurring = buildRecurringTxMatcher(recurring);
  const bankFixedTxns = (bankFixedRes.data || []).filter(
    (t: any) => !matchesRecurring(t.counterparty, t.description, t.amount) && isCostAccount(t.category, accountMap),
  );

  // Build per-month budget
  let cumulativeNet = 0;

  return months.map((month) => {
    const monthPrefix = month; // '2026-01'

    // ── Income ──
    const monthInvoices = invoices.filter(
      (inv: any) => inv.issue_date?.startsWith(monthPrefix) && inv.type === 'sales',
    );
    const salesRevenue = monthInvoices.reduce(
      (sum: number, inv: any) => sum + Number(inv.supply_amount || 0) + Number(inv.tax_amount || 0),
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

    // ── Fixed Costs ──
    // Combine recurring_payments + fixed_costs tables
    const recurringTotal = recurring.reduce(
      (sum: number, rp: any) => sum + Number(rp.amount || 0),
      0,
    );
    const fixedCostTotal = fixedCosts
      .filter((fc: any) => {
        const [fy, fm] = monthPrefix.split('-').map(Number);
        const fLastDay = new Date(fy, fm, 0).getDate();
        if (fc.start_date && fc.start_date > `${monthPrefix}-${String(fLastDay).padStart(2, '0')}`) return false;
        if (fc.end_date && fc.end_date < `${monthPrefix}-01`) return false;
        return true;
      })
      .reduce((sum: number, fc: any) => sum + Number(fc.amount || 0), 0);

    // 통장 고정비 체크 거래 (당월 실적)
    const bankFixedMonth = bankFixedTxns
      .filter((t: any) => t.transaction_date?.startsWith(monthPrefix))
      .reduce((sum: number, t: any) => sum + Math.abs(Number(t.amount || 0)), 0);

    const totalFixed = recurringTotal + fixedCostTotal + bankFixedMonth + salaryMonthly;

    // ── Variable Costs ──
    //   취소(cancelled)된 지출까지 비용으로 세던 것을 뺐다 (2026-08-10)
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

    // ── Bank Balance ── (current total across bank_accounts; no historical snapshots)
    const bankBalance = snapshots.reduce(
      (sum: number, a: any) => sum + Number(a.balance || 0),
      0,
    );

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
//   2026-05-22 사장님 요청 — 고정비/변동비 category별 세부내역.
//   소스 (prod 스키마 검증 반영):
//     · 고정비 = recurring_payments(is_active) category별 + 급여(employees)
//       - fixed_costs 테이블은 prod 미존재 → 제외 (getMonthlyBudgetOverview 와 동일하게 사실상 미반영)
//     · 변동비 = card_transactions category별 (연 범위)
//       - payment_queue 는 due_date 컬럼 부재 → 제외 (월별표 변동비와 정합 유지: card 만 집계됨)
// ═══════════════════════════════════════════════════════════════════════

export interface CostCategoryRow {
  category: string;
  label: string;
  amount: number;   // 연간 합계
  monthly: number;  // 월 환산
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

export async function getCostBreakdown(
  companyId: string,
  year: number,
): Promise<CostBreakdown> {
  const startDate = `${year}-01-01`;
  const endDate = `${year}-12-31`;

  const [recurringRes, salaryTotal, cardRes, bankFixedRes, accountMap, pqRes] = await Promise.all([
    db.from('recurring_payments')
      .select('name, amount, category, is_active')
      .eq('company_id', companyId)
      .eq('is_active', true),
    getMonthlyTotalSalary(companyId).catch(() => 0),
    fetchPagedRes('fixedCosts.cardTx', () => db.from('card_transactions')
      .select('amount, category, transaction_date')
      .eq('company_id', companyId)
      .gte('transaction_date', startDate)
      .lte('transaction_date', endDate)
      .order('id', { ascending: true })),
    // 통장 '고정비' 체크 거래 (전표처리/매핑에서 체크) — YTD 실적. 정기결제와 매칭되는 건 제외(중복 차단)
    db.from('bank_transactions')
      .select('amount, transaction_date, counterparty, description, category')
      .eq('company_id', companyId)
      .eq('type', 'expense')
      .eq('is_fixed_cost', true)
      .gte('transaction_date', startDate)
      .lte('transaction_date', endDate),
    //   계정 성격 판정용 — 대출 상환·미지급금 상환처럼 매달 나가지만 비용이 아닌 것을 걸러낸다 (2026-08-10)
    getAccountMap(companyId),
    //   변동비의 나머지 한 축 — 월별표에는 들어가는데 세부내역에는 없어서 위아래 합계가 어긋났다 (2026-08-10)
    db.from('payment_queue')
      .select('amount, category, status, created_at, is_recurring')
      .eq('company_id', companyId)
      .gte('created_at', startDate)
      .lte('created_at', `${endDate}T23:59:59`),
  ]);

  // 고정비: 월액 → 연 환산(*12)
  const fixedMonthly: Record<string, number> = {};
  for (const rp of (recurringRes.data || [])) {
    const k = mapRecurringCategory(rp.category);
    fixedMonthly[k] = (fixedMonthly[k] || 0) + Number(rp.amount || 0);
  }
  // 급여(employees) — recurring_payments 에 급여를 따로 등록하지 않는 한 중복 없음.
  //   fixed_costs 테이블 부재로 중복 위험 0 (prod 검증).
  if (salaryTotal > 0) {
    fixedMonthly['salary'] = (fixedMonthly['salary'] || 0) + Number(salaryTotal);
  }

  // 변동비: 카드 실지출 연 합계
  const variableYear: Record<string, number> = {};
  for (const t of (cardRes.data || [])) {
    const k = mapVariableCategory(t.category);
    variableYear[k] = (variableYear[k] || 0) + Number(t.amount || 0);
  }

  // 2026-06-10 기준 통일 — 고정비를 ×12(연환산)가 아니라 ×경과월(YTD 실제 발생액)로.
  //   변동비(card)는 이미 해당 연도 실적 누계 → 둘 다 'YTD 실적'으로 맞춰 시간기준 불일치 제거
  //   (과거: 고정 12개월 추정 vs 변동 ~5.5개월 실적 → 고정비가 부풀려 보이던 문제).
  const _now = new Date();
  const monthsElapsed = year < _now.getFullYear() ? 12 : year > _now.getFullYear() ? 0 : _now.getMonth() + 1;
  const fixed: CostCategoryRow[] = FIXED_COST_CATEGORIES
    .map((f) => ({ category: f.value, label: f.label, monthly: fixedMonthly[f.value] || 0, amount: (fixedMonthly[f.value] || 0) * monthsElapsed }))
    .filter((r) => r.amount > 0);
  // 통장 고정비 체크 거래 — YTD 실적 그대로 (월 평균 = 누계 ÷ 경과월). 정기결제와 매칭 = 제외(중복 차단)
  const matchesRec = buildRecurringTxMatcher(recurringRes.data || []);
  const bankFixedTotal = (bankFixedRes.data || [])
    .filter((t: any) => !matchesRec(t.counterparty, t.description, t.amount) && isCostAccount(t.category, accountMap))
    .reduce((s: number, t: any) => s + Math.abs(Number(t.amount || 0)), 0);
  if (bankFixedTotal > 0) {
    fixed.push({ category: 'bank_fixed', label: '통장 고정비(체크 거래)', amount: bankFixedTotal, monthly: Math.round(bankFixedTotal / Math.max(1, monthsElapsed)) });
  }
  fixed.sort((a, b) => b.amount - a.amount);

  const variable: CostCategoryRow[] = VARIABLE_COST_CATEGORIES
    .map((v) => ({ category: v.value, label: v.label, amount: variableYear[v.value] || 0, monthly: Math.round((variableYear[v.value] || 0) / 12) }))
    .filter((r) => r.amount > 0);
  //   결제 대기(일회성 지출) — 취소된 건은 뺀다. 월별표와 같은 규칙이라야 위아래 합계가 맞는다.
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
//   getCostBreakdown 과 동일한 소스·매핑으로 개별 레코드를 나열해 표 값과 정합 유지.
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
      .gte('created_at', startDate)
      .lte('created_at', `${endDate}T23:59:59`)
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

  if (category === 'bank_fixed') {
    // 통장 '고정비' 체크 거래 — YTD 개별 내역. 합산과 동일하게 정기결제 매칭 건 제외 +
    //   통장매핑에서 분류한 계정(category)·메모를 함께 표시 (사장님 QA 2026-07-10).
    const [{ data }, { data: recs }] = await Promise.all([
      fetchPagedRes('lib/cash-budget:bank_fixed', () => db.from('bank_transactions')
        .select('counterparty, description, transaction_date, amount, category, memo')
        .eq('company_id', companyId)
        .eq('type', 'expense')
        .eq('is_fixed_cost', true)
        .gte('transaction_date', startDate)
        .lte('transaction_date', endDate)
        .order('transaction_date', { ascending: false })
        .order('id'), 50000),
      db.from('recurring_payments').select('name, amount').eq('company_id', companyId).eq('is_active', true),
    ]);
    const matches = buildRecurringTxMatcher(recs || []);
    const accountMap = await getAccountMap(companyId);
    return (data || [])
      .filter((t: any) => !matches(t.counterparty, t.description, t.amount) && isCostAccount(t.category, accountMap))
      .map((t: any) => ({
        label: t.counterparty || t.description || '통장 지출',
        sub: [t.transaction_date, t.category ? `분류: ${t.category}` : '미분류', t.memo || null].filter(Boolean).join(' · '),
        amount: Math.abs(Number(t.amount || 0)),
      }));
  }

  // 고정비 카테고리 — recurring_payments(월액) (+salary 는 직원 급여 합산). id 포함 → 화면에서 바로 제거 가능.
  const items: CostDetailItem[] = [];
  const recs = logRead('lib/cash-budget:recs', await db.from('recurring_payments')
    .select('id, name, amount, category, day_of_month')
    .eq('company_id', companyId)
    .eq('is_active', true));
  for (const rp of (recs || [])) {
    if (mapRecurringCategory(rp.category) !== category) continue;
    items.push({ label: rp.name || '정기지출', sub: rp.day_of_month ? `매월 ${rp.day_of_month}일 · 월액` : '월액', amount: Number(rp.amount || 0), recurringId: rp.id });
  }
  if (category === 'salary') {
    const emps = logRead('lib/cash-budget:emps', await db.from('employees')
      .select('name, salary, status')
      .eq('company_id', companyId)
      .in('status', ['active', 'joined']));
    for (const e of (emps || [])) {
      if (Number(e.salary || 0) <= 0) continue;
      items.push({ label: `${e.name} 급여`, sub: '월액 (직원 등록 급여)', amount: Number(e.salary) });
    }
  }
  return items;
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
    db.from('tax_invoices')
      .select('supply_amount, tax_amount, issue_date, counterparty_name, type')
      .eq('company_id', companyId)
      .gte('issue_date', startDate)
      .lte('issue_date', endDate),

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
