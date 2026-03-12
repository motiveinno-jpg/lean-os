/**
 * OwnerView Cash Budget / Treasury Management
 * 자금 예산 관리 — 월별 자금 개요, 고정/변동비, 일별 자금 흐름, 대출 현황, 퇴직금 충당
 */

import { supabase } from './supabase';
import { calculateRetirementPay } from './payment-batch';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { loadKoreanFont } from './pdf-korean-font';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

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

export async function upsertFixedCost(
  companyId: string,
  item: Partial<FixedCostItem>,
): Promise<FixedCostItem> {
  const row: Record<string, unknown> = {
    company_id: companyId,
    name: item.name,
    amount: item.amount,
    payment_day: item.paymentDay ?? 1,
    category: item.category ?? 'other',
    is_recurring: item.isRecurring ?? true,
    start_date: item.startDate ?? null,
    end_date: item.endDate ?? null,
    note: item.note ?? null,
    updated_at: new Date().toISOString(),
  };

  let result;
  if (item.id) {
    const { data, error } = await db
      .from('fixed_costs')
      .update(row)
      .eq('id', item.id)
      .eq('company_id', companyId)
      .select()
      .single();
    if (error) throw error;
    result = data;
  } else {
    const { data, error } = await db
      .from('fixed_costs')
      .insert(row)
      .select()
      .single();
    if (error) throw error;
    result = data;
  }

  return {
    id: result.id,
    name: result.name,
    amount: Number(result.amount),
    paymentDay: result.payment_day,
    category: result.category,
    isRecurring: result.is_recurring,
    startDate: result.start_date,
    endDate: result.end_date,
    note: result.note,
  };
}

export async function deleteFixedCost(companyId: string, id: string): Promise<void> {
  const { error } = await db
    .from('fixed_costs')
    .delete()
    .eq('id', id)
    .eq('company_id', companyId);
  if (error) throw error;
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

  const monthsLeft = Math.max(1, Math.round(
    (maturity.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 30),
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

export async function upsertLoan(
  companyId: string,
  loan: Partial<LoanStatus>,
): Promise<LoanStatus> {
  const row: Record<string, unknown> = {
    company_id: companyId,
    name: loan.name,
    lender: loan.lender || '',
    loan_type: loan.repaymentType || 'equal_principal',
    original_amount: loan.originalAmount,
    remaining_balance: loan.remainingAmount,
    interest_rate: loan.interestRate || null,
    start_date: loan.loanDate || null,
    maturity_date: loan.maturityDate || null,
    notes: loan.note || null,
    status: 'active',
    updated_at: new Date().toISOString(),
  };

  let result;
  if (loan.id) {
    const { data, error } = await db
      .from('loans')
      .update(row)
      .eq('id', loan.id)
      .eq('company_id', companyId)
      .select()
      .single();
    if (error) throw error;
    result = data;
  } else {
    const { data, error } = await db
      .from('loans')
      .insert(row)
      .select()
      .single();
    if (error) throw error;
    result = data;
  }

  return {
    id: result.id,
    name: result.name,
    lender: result.lender || '',
    loanDate: result.start_date || '',
    maturityDate: result.maturity_date || '',
    originalAmount: Number(result.original_amount),
    remainingAmount: Number(result.remaining_balance),
    repaymentType: mapRepaymentType(result.loan_type),
    monthlyPayment: estimateMonthlyPayment(result),
    interestRate: Number(result.interest_rate || 0),
    note: result.notes,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// Monthly Budget Overview (12-month)
// ═══════════════════════════════════════════════════════════════════════

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
    // Bank balance (latest snapshot per month from cash_snapshots)
    db.from('cash_snapshots')
      .select('balance, snapshot_date')
      .eq('company_id', companyId)
      .gte('snapshot_date', startDate)
      .lte('snapshot_date', endDate)
      .order('snapshot_date', { ascending: false }),

    // Recurring payments (for fixed cost estimates)
    db.from('recurring_payments')
      .select('amount, category, is_active, day_of_month')
      .eq('company_id', companyId)
      .eq('is_active', true),

    // Fixed costs from the new table
    db.from('fixed_costs')
      .select('amount, category, payment_day, is_recurring, start_date, end_date')
      .eq('company_id', companyId)
      .eq('is_recurring', true),

    // Invoices for sales revenue
    db.from('tax_invoices')
      .select('supply_amount, tax_amount, issue_date, direction')
      .eq('company_id', companyId)
      .gte('issue_date', startDate)
      .lte('issue_date', endDate),

    // Payment queue items (expenses)
    db.from('payment_queue')
      .select('amount, category, status, due_date, is_recurring')
      .eq('company_id', companyId)
      .gte('due_date', startDate)
      .lte('due_date', endDate),

    // Owner injections (가수금)
    db.from('owner_injections')
      .select('amount, date')
      .eq('company_id', companyId)
      .gte('date', startDate)
      .lte('date', endDate),

    // Card transactions (variable costs)
    db.from('card_transactions')
      .select('amount, category, transaction_date, merchant_name')
      .eq('company_id', companyId)
      .gte('transaction_date', startDate)
      .lte('transaction_date', endDate),
  ]);

  const snapshots = bankAccountsRes.data || [];
  const recurring = recurringRes.data || [];
  const fixedCosts = fixedCostsRes.data || [];
  const invoices = invoicesRes.data || [];
  const payments = paymentsRes.data || [];
  const ownerInjections = ownerInjectionsRes.data || [];
  const cardTxns = cardTransactionsRes.data || [];

  // Build per-month budget
  let cumulativeNet = 0;

  return months.map((month) => {
    const monthPrefix = month; // '2026-01'

    // ── Income ──
    const monthInvoices = invoices.filter(
      (inv: any) => inv.issue_date?.startsWith(monthPrefix) && inv.direction === 'sales',
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
        if (fc.start_date && fc.start_date > `${monthPrefix}-31`) return false;
        if (fc.end_date && fc.end_date < `${monthPrefix}-01`) return false;
        return true;
      })
      .reduce((sum: number, fc: any) => sum + Number(fc.amount || 0), 0);

    const totalFixed = Math.max(recurringTotal, fixedCostTotal) || recurringTotal + fixedCostTotal;

    // ── Variable Costs ──
    const monthPayments = payments.filter(
      (p: any) => p.due_date?.startsWith(monthPrefix) && !p.is_recurring,
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

    // ── Bank Balance ──
    const monthSnapshots = snapshots.filter(
      (s: any) => s.snapshot_date?.startsWith(monthPrefix),
    );
    const bankBalance = monthSnapshots.length > 0
      ? Number(monthSnapshots[0].balance || 0)
      : 0;

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
    db.from('cash_snapshots')
      .select('balance, snapshot_date')
      .eq('company_id', companyId)
      .lte('snapshot_date', startDate)
      .order('snapshot_date', { ascending: false })
      .limit(1),

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
      .select('supply_amount, tax_amount, issue_date, counterparty_name, direction')
      .eq('company_id', companyId)
      .gte('issue_date', startDate)
      .lte('issue_date', endDate),

    // Payment queue items due this month
    db.from('payment_queue')
      .select('amount, label, category, due_date, status')
      .eq('company_id', companyId)
      .gte('due_date', startDate)
      .lte('due_date', endDate)
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

  const openingBalance = snapshotRes.data?.[0]?.balance
    ? Number(snapshotRes.data[0].balance)
    : 0;

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
    if (inv.direction !== 'sales') continue;
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
    const dueDate = pq.due_date || startDate;
    const day = parseInt(dueDate.slice(8, 10)) || 1;

    events.push({
      day,
      date: dueDate,
      description: pq.label || '지출',
      amount: -Number(pq.amount),
      category: CATEGORY_LABELS[pq.category] || pq.category || '지출',
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
    .eq('status', 'active');

  if (error) throw error;
  if (!employees?.length) return [];

  const today = new Date().toISOString().slice(0, 10);
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
        projection_data: projections,
        generated_at: new Date().toISOString(),
        generated_by: user?.id || null,
      },
      { onConflict: 'company_id,month' },
    );
}

// ═══════════════════════════════════════════════════════════════════════
// Owner Injection CRUD
// ═══════════════════════════════════════════════════════════════════════

export async function getOwnerInjections(
  companyId: string,
  year?: number,
): Promise<Array<{ id: string; amount: number; date: string; note?: string }>> {
  let query = db
    .from('owner_injections')
    .select('*')
    .eq('company_id', companyId)
    .order('date', { ascending: false });

  if (year) {
    query = query.gte('date', `${year}-01-01`).lte('date', `${year}-12-31`);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map((row: any) => ({
    id: row.id,
    amount: Number(row.amount),
    date: row.date,
    note: row.note,
  }));
}

export async function upsertOwnerInjection(
  companyId: string,
  item: { id?: string; amount: number; date: string; note?: string },
): Promise<void> {
  const row = {
    company_id: companyId,
    amount: item.amount,
    date: item.date,
    note: item.note || null,
  };

  if (item.id) {
    const { error } = await db
      .from('owner_injections')
      .update(row)
      .eq('id', item.id)
      .eq('company_id', companyId);
    if (error) throw error;
  } else {
    const { error } = await db
      .from('owner_injections')
      .insert(row);
    if (error) throw error;
  }
}

export async function deleteOwnerInjection(companyId: string, id: string): Promise<void> {
  const { error } = await db
    .from('owner_injections')
    .delete()
    .eq('id', id)
    .eq('company_id', companyId);
  if (error) throw error;
}

// ═══════════════════════════════════════════════════════════════════════
// PDF Generation — Cash Budget Report (자금예산표)
// ═══════════════════════════════════════════════════════════════════════

export async function generateCashBudgetPDF(
  companyId: string,
  month: string, // '2026-03'
): Promise<void> {
  const [yearStr, monthStr] = month.split('-');
  const year = parseInt(yearStr);
  const monthNum = parseInt(monthStr);

  // Fetch company info
  const { data: company } = await db
    .from('companies')
    .select('name')
    .eq('id', companyId)
    .single();
  const companyName = company?.name || '회사명';

  // Fetch all data in parallel
  const [
    budgetOverview,
    fixedCosts,
    dailyProjection,
    shortfallAlerts,
    loanStatuses,
    retirementProvisions,
  ] = await Promise.all([
    getMonthlyBudgetOverview(companyId, year),
    getFixedCosts(companyId),
    getDailyCashProjection(companyId, month),
    getCashShortfallAlerts(companyId, month),
    getLoanStatuses(companyId),
    getRetirementPayProvisions(companyId),
  ]);

  const currentMonth = budgetOverview.find((b) => b.month === month);

  // ── Create PDF (landscape A4) ──
  const doc = new jsPDF('l', 'mm', 'a4');
  await loadKoreanFont(doc);
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  let y = 12;

  const addPageIfNeeded = (minSpace: number = 30) => {
    if (y > pageH - minSpace) {
      doc.addPage();
      y = 12;
    }
  };

  // ═══ PAGE 1: Header + Monthly Overview ═══

  // Header
  doc.setFontSize(16);
  doc.setFont('NanumGothic', 'normal');
  doc.setTextColor(30, 30, 30);
  doc.text('자금예산표 (Cash Budget Report)', 14, y);
  y += 7;

  doc.setFontSize(9);
  doc.setTextColor(100, 100, 100);
  doc.text(
    `${companyName}  |  ${year}년 ${monthNum}월 기준  |  생성일: ${new Date().toLocaleDateString('ko-KR')}`,
    14,
    y,
  );
  y += 8;

  // ── Summary boxes ──
  if (currentMonth) {
    const boxW = (pageW - 28 - 15) / 4; // 4 boxes with gaps
    const boxH = 22;
    const boxes = [
      { label: '수입 합계', value: currentMonth.incomeTotal, color: [59, 130, 246] },
      { label: '지출 합계', value: currentMonth.expenseTotal, color: [239, 68, 68] },
      { label: '순이익 (누적)', value: currentMonth.netProfit, color: currentMonth.netProfit >= 0 ? [34, 197, 94] : [239, 68, 68] },
      { label: '은행 잔액', value: currentMonth.bankBalance, color: [100, 100, 100] },
    ];

    for (let i = 0; i < boxes.length; i++) {
      const bx = 14 + i * (boxW + 5);
      doc.setDrawColor(220, 220, 220);
      doc.setFillColor(248, 249, 250);
      doc.roundedRect(bx, y, boxW, boxH, 2, 2, 'FD');

      doc.setFontSize(8);
      doc.setTextColor(120, 120, 120);
      doc.text(boxes[i].label, bx + 6, y + 8);

      doc.setFontSize(13);
      const [r, g, b] = boxes[i].color;
      doc.setTextColor(r, g, b);
      doc.text(`₩${fmtKRW(boxes[i].value)}`, bx + 6, y + 17);
    }
    y += boxH + 8;
  }

  // ── 12-Month Budget Overview Table ──
  doc.setFontSize(11);
  doc.setFont('NanumGothic', 'normal');
  doc.setTextColor(30, 30, 30);
  doc.text('월별 자금 개요', 14, y);
  y += 4;

  autoTable(doc, {
    startY: y,
    head: [['월', '수입 합계', '매출', '가수금', '지출 합계', '고정비', '변동비', '순이익(누적)', '은행 잔액']],
    body: budgetOverview.map((b) => [
      b.month.slice(5) + '월',
      fmtKRW(b.incomeTotal),
      fmtKRW(b.salesRevenue),
      fmtKRW(b.ownerInjection),
      fmtKRW(b.expenseTotal),
      fmtKRW(b.fixedCosts),
      fmtKRW(b.variableCosts),
      fmtKRW(b.netProfit),
      fmtKRW(b.bankBalance),
    ]),
    styles: { fontSize: 7, cellPadding: 2, font: 'NanumGothic', halign: 'right' },
    headStyles: { fillColor: [59, 130, 246], textColor: 255, halign: 'center' },
    columnStyles: { 0: { halign: 'center' } },
    alternateRowStyles: { fillColor: [248, 249, 250] },
    margin: { left: 14, right: 14 },
    // Highlight current month row
    didParseCell: (data: any) => {
      if (data.section === 'body' && budgetOverview[data.row.index]?.month === month) {
        data.cell.styles.fillColor = [219, 234, 254]; // light blue highlight
        data.cell.styles.fontStyle = 'bold';
      }
    },
  });

  y = (doc as any).lastAutoTable.finalY + 10;

  // ═══ PAGE 2: Fixed/Variable Cost Breakdown + Daily Projection ═══
  doc.addPage();
  y = 12;

  // ── Fixed Cost Breakdown ──
  doc.setFontSize(11);
  doc.setFont('NanumGothic', 'normal');
  doc.setTextColor(30, 30, 30);
  doc.text('고정비 내역', 14, y);
  y += 4;

  if (fixedCosts.length > 0) {
    autoTable(doc, {
      startY: y,
      head: [['항목명', '금액', '납부일', '분류', '비고']],
      body: fixedCosts.map((fc) => [
        fc.name,
        `₩${fmtKRW(fc.amount)}`,
        `매월 ${fc.paymentDay}일`,
        CATEGORY_LABELS[fc.category] || fc.category,
        fc.note || '-',
      ]),
      foot: [[
        '합계',
        `₩${fmtKRW(fixedCosts.reduce((s, fc) => s + fc.amount, 0))}`,
        '', '', '',
      ]],
      styles: { fontSize: 8, cellPadding: 2.5, font: 'NanumGothic' },
      headStyles: { fillColor: [107, 114, 128], textColor: 255 },
      footStyles: { fillColor: [243, 244, 246], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 249, 250] },
      margin: { left: 14, right: 14 },
    });
    y = (doc as any).lastAutoTable.finalY + 8;
  } else {
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text('등록된 고정비 항목이 없습니다.', 14, y + 4);
    y += 12;
  }

  addPageIfNeeded(50);

  // ── Daily Cash Projection ──
  doc.setFontSize(11);
  doc.setFont('NanumGothic', 'normal');
  doc.setTextColor(30, 30, 30);
  doc.text(`일별 자금 흐름 (${year}년 ${monthNum}월)`, 14, y);
  y += 4;

  if (dailyProjection.length > 0) {
    autoTable(doc, {
      startY: y,
      head: [['날짜', '내역', '분류', '입금', '출금', '잔액']],
      body: dailyProjection.map((dp) => [
        dp.date.slice(5), // 'MM-DD'
        dp.description,
        dp.category,
        dp.amount > 0 ? `₩${fmtKRW(dp.amount)}` : '',
        dp.amount < 0 ? `₩${fmtKRW(Math.abs(dp.amount))}` : '',
        `₩${fmtKRW(dp.runningBalance)}`,
      ]),
      styles: { fontSize: 7, cellPadding: 2, font: 'NanumGothic' },
      headStyles: { fillColor: [16, 185, 129], textColor: 255 },
      alternateRowStyles: { fillColor: [248, 249, 250] },
      columnStyles: {
        3: { halign: 'right', textColor: [59, 130, 246] },
        4: { halign: 'right', textColor: [239, 68, 68] },
        5: { halign: 'right' },
      },
      margin: { left: 14, right: 14 },
      // Highlight negative balances in red
      didParseCell: (data: any) => {
        if (data.section === 'body' && data.column.index === 5) {
          const proj = dailyProjection[data.row.index];
          if (proj && proj.runningBalance < 0) {
            data.cell.styles.textColor = [239, 68, 68];
            data.cell.styles.fontStyle = 'bold';
          }
        }
      },
    });
    y = (doc as any).lastAutoTable.finalY + 10;
  }

  // ═══ PAGE 3: Shortfall Alerts + Loan Status + Retirement Provisions ═══
  doc.addPage();
  y = 12;

  // ── Shortfall Alerts ──
  doc.setFontSize(11);
  doc.setFont('NanumGothic', 'normal');
  doc.setTextColor(30, 30, 30);
  doc.text('자금 부족 경고', 14, y);
  y += 4;

  if (shortfallAlerts.length > 0) {
    // Alert banner
    doc.setFillColor(254, 242, 242);
    doc.setDrawColor(239, 68, 68);
    doc.roundedRect(14, y, pageW - 28, 10, 2, 2, 'FD');
    doc.setFontSize(9);
    doc.setTextColor(185, 28, 28);
    doc.text(
      `${shortfallAlerts.length}건의 자금 부족이 예상됩니다. 아래 일자에 은행 잔액이 마이너스가 됩니다.`,
      20,
      y + 6.5,
    );
    y += 14;

    autoTable(doc, {
      startY: y,
      head: [['날짜', '예상 잔액', '부족액', '해당 지출 항목']],
      body: shortfallAlerts.map((a) => [
        a.date,
        `₩${fmtKRW(a.projectedBalance)}`,
        `₩${fmtKRW(a.shortfallAmount)}`,
        a.dueDateItems.join(', '),
      ]),
      styles: { fontSize: 8, cellPadding: 2.5, font: 'NanumGothic' },
      headStyles: { fillColor: [220, 38, 38], textColor: 255 },
      columnStyles: {
        1: { textColor: [239, 68, 68] },
        2: { textColor: [239, 68, 68], fontStyle: 'bold' },
      },
      alternateRowStyles: { fillColor: [254, 242, 242] },
      margin: { left: 14, right: 14 },
    });
    y = (doc as any).lastAutoTable.finalY + 10;
  } else {
    doc.setFillColor(240, 253, 244);
    doc.setDrawColor(34, 197, 94);
    doc.roundedRect(14, y, pageW - 28, 10, 2, 2, 'FD');
    doc.setFontSize(9);
    doc.setTextColor(21, 128, 61);
    doc.text('이번 달 자금 부족 예상 없음 — 안전합니다.', 20, y + 6.5);
    y += 18;
  }

  addPageIfNeeded(50);

  // ── Loan Status ──
  doc.setFontSize(11);
  doc.setFont('NanumGothic', 'normal');
  doc.setTextColor(30, 30, 30);
  doc.text('대출 현황', 14, y);
  y += 4;

  if (loanStatuses.length > 0) {
    const totalOriginal = loanStatuses.reduce((s, l) => s + l.originalAmount, 0);
    const totalRemaining = loanStatuses.reduce((s, l) => s + l.remainingAmount, 0);
    const totalMonthly = loanStatuses.reduce((s, l) => s + l.monthlyPayment, 0);

    autoTable(doc, {
      startY: y,
      head: [['대출명', '대출처', '대출일', '만기일', '대출액', '잔액', '상환방식', '월상환액', '이율']],
      body: loanStatuses.map((l) => [
        l.name,
        l.lender,
        l.loanDate || '-',
        l.maturityDate || '-',
        `₩${fmtKRW(l.originalAmount)}`,
        `₩${fmtKRW(l.remainingAmount)}`,
        REPAYMENT_TYPE_LABELS[l.repaymentType] || l.repaymentType,
        `₩${fmtKRW(l.monthlyPayment)}`,
        l.interestRate > 0 ? `${l.interestRate}%` : '-',
      ]),
      foot: [[
        '합계', '', '', '',
        `₩${fmtKRW(totalOriginal)}`,
        `₩${fmtKRW(totalRemaining)}`,
        '',
        `₩${fmtKRW(totalMonthly)}`,
        '',
      ]],
      styles: { fontSize: 7, cellPadding: 2, font: 'NanumGothic' },
      headStyles: { fillColor: [147, 51, 234], textColor: 255 },
      footStyles: { fillColor: [243, 244, 246], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 249, 250] },
      margin: { left: 14, right: 14 },
    });
    y = (doc as any).lastAutoTable.finalY + 10;
  } else {
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text('등록된 대출이 없습니다.', 14, y + 4);
    y += 12;
  }

  addPageIfNeeded(50);

  // ── Retirement Pay Provisions ──
  doc.setFontSize(11);
  doc.setFont('NanumGothic', 'normal');
  doc.setTextColor(30, 30, 30);
  doc.text('퇴직금 충당 현황', 14, y);
  y += 4;

  if (retirementProvisions.length > 0) {
    const totalProvision = retirementProvisions.reduce((s, p) => s + p.retirementPay, 0);
    const eligibleCount = retirementProvisions.filter((p) => p.eligible).length;

    autoTable(doc, {
      startY: y,
      head: [['직원명', '입사일', '근속일수', '월급여', '일평균임금', '퇴직금 충당액', '수급자격']],
      body: retirementProvisions.map((p) => [
        p.employeeName,
        p.startDate,
        `${p.totalDays.toLocaleString()}일`,
        `₩${fmtKRW(p.salary)}`,
        `₩${fmtKRW(Math.round(p.dailyAvgWage))}`,
        `₩${fmtKRW(p.retirementPay)}`,
        p.eligible ? '대상' : '미대상 (1년 미만)',
      ]),
      foot: [[
        `합계 (${eligibleCount}명 대상)`,
        '', '', '', '',
        `₩${fmtKRW(totalProvision)}`,
        '',
      ]],
      styles: { fontSize: 7.5, cellPadding: 2.5, font: 'NanumGothic' },
      headStyles: { fillColor: [245, 158, 11], textColor: 255 },
      footStyles: { fillColor: [243, 244, 246], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 249, 250] },
      columnStyles: {
        5: { halign: 'right' },
      },
      margin: { left: 14, right: 14 },
      didParseCell: (data: any) => {
        if (data.section === 'body' && data.column.index === 6) {
          const prov = retirementProvisions[data.row.index];
          if (prov && !prov.eligible) {
            data.cell.styles.textColor = [156, 163, 175]; // gray for ineligible
          }
        }
      },
    });
    y = (doc as any).lastAutoTable.finalY + 10;
  } else {
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text('등록된 직원이 없습니다.', 14, y + 4);
    y += 12;
  }

  // ── Footer on all pages ──
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(180, 180, 180);
    doc.text(
      `${companyName} — 자금예산표 — ${i} / ${pageCount}`,
      pageW / 2,
      pageH - 6,
      { align: 'center' },
    );
  }

  // ── Save ──
  const filename = `자금예산표_${companyName}_${month}.pdf`;
  doc.save(filename);
}
