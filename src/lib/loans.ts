/**
 * OwnerView Loan Management
 * 대출 목록 / 상환 이력 / 요약 조회
 */

import { supabase } from './supabase';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

// ── Types ──

export interface LoanRow {
  id: string;
  company_id: string;
  name: string;
  lender: string;
  loan_type: string;
  original_amount: number;
  remaining_balance: number;
  interest_rate: number | null;
  start_date: string | null;
  maturity_date: string | null;
  payment_day: number | null;
  interest_day: number | null;
  bank_account_id: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface LoanPaymentRow {
  id: string;
  loan_id: string;
  payment_date: string;
  principal_amount: number;
  interest_amount: number;
  total_amount: number;
  payment_number: number | null;
  bank_transaction_id: string | null;
  notes: string | null;
  created_at: string;
}

export interface LoanSummary {
  totalOriginal: number;
  totalRemaining: number;
  monthlyPayment: number;
  totalPayments: number;
  loans: LoanRow[];
}

// ── Queries ──

export async function getLoans(companyId: string): Promise<LoanRow[]> {
  const { data, error } = await db
    .from('loans')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getLoan(loanId: string): Promise<LoanRow | null> {
  const { data, error } = await db
    .from('loans')
    .select('*')
    .eq('id', loanId)
    .single();
  if (error) return null;
  return data;
}

export async function getLoanPayments(loanId: string): Promise<LoanPaymentRow[]> {
  const { data, error } = await db
    .from('loan_payments')
    .select('*')
    .eq('loan_id', loanId)
    .order('payment_number', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getAllLoanPayments(companyId: string): Promise<LoanPaymentRow[]> {
  const loans = await getLoans(companyId);
  if (loans.length === 0) return [];
  const loanIds = loans.map(l => l.id);
  const { data, error } = await db
    .from('loan_payments')
    .select('*')
    .in('loan_id', loanIds)
    .order('payment_date', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getLoanSummary(companyId: string): Promise<LoanSummary> {
  const loans = await getLoans(companyId);
  const activeLoans = loans.filter(l => l.status === 'active');

  // Get latest payment for each loan to count total payments
  let totalPayments = 0;
  let monthlyPayment = 0;

  for (const loan of activeLoans) {
    const { data: payments } = await db
      .from('loan_payments')
      .select('payment_number, total_amount')
      .eq('loan_id', loan.id)
      .order('payment_number', { ascending: false })
      .limit(1);
    if (payments && payments.length > 0) {
      totalPayments += payments[0].payment_number || 0;
      monthlyPayment += payments[0].total_amount || 0;
    }
  }

  return {
    totalOriginal: activeLoans.reduce((s, l) => s + Number(l.original_amount), 0),
    totalRemaining: activeLoans.reduce((s, l) => s + Number(l.remaining_balance), 0),
    monthlyPayment,
    totalPayments,
    loans,
  };
}

// ── Mutations ──

export async function createLoan(params: {
  companyId: string;
  name: string;
  lender: string;
  loanType?: string;
  originalAmount: number;
  remainingBalance: number;
  interestRate?: number;
  startDate?: string;
  maturityDate?: string;
  paymentDay?: number;
  interestDay?: number;
  bankAccountId?: string;
  notes?: string;
}): Promise<LoanRow> {
  const { data, error } = await db
    .from('loans')
    .insert({
      company_id: params.companyId,
      name: params.name,
      lender: params.lender,
      loan_type: params.loanType || 'term',
      original_amount: params.originalAmount,
      remaining_balance: params.remainingBalance,
      interest_rate: params.interestRate || null,
      start_date: params.startDate || null,
      maturity_date: params.maturityDate || null,
      payment_day: params.paymentDay || null,
      interest_day: params.interestDay || null,
      bank_account_id: params.bankAccountId || null,
      notes: params.notes || null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateLoan(loanId: string, params: Partial<{
  name: string;
  lender: string;
  originalAmount: number;
  remainingBalance: number;
  interestRate: number;
  startDate: string;
  maturityDate: string;
  paymentDay: number;
  interestDay: number;
  status: string;
  notes: string;
}>): Promise<void> {
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (params.name !== undefined) update.name = params.name;
  if (params.lender !== undefined) update.lender = params.lender;
  if (params.originalAmount !== undefined) update.original_amount = params.originalAmount;
  if (params.remainingBalance !== undefined) update.remaining_balance = params.remainingBalance;
  if (params.interestRate !== undefined) update.interest_rate = params.interestRate;
  if (params.startDate !== undefined) update.start_date = params.startDate;
  if (params.maturityDate !== undefined) update.maturity_date = params.maturityDate;
  if (params.paymentDay !== undefined) update.payment_day = params.paymentDay;
  if (params.interestDay !== undefined) update.interest_day = params.interestDay;
  if (params.status !== undefined) update.status = params.status;
  if (params.notes !== undefined) update.notes = params.notes;

  const { error } = await db.from('loans').update(update).eq('id', loanId);
  if (error) throw error;
}

export async function recordLoanPayment(params: {
  loanId: string;
  paymentDate: string;
  principalAmount: number;
  interestAmount: number;
  paymentNumber?: number;
  bankTransactionId?: string;
  notes?: string;
}): Promise<LoanPaymentRow> {
  const { data, error } = await db
    .from('loan_payments')
    .insert({
      loan_id: params.loanId,
      payment_date: params.paymentDate,
      principal_amount: params.principalAmount,
      interest_amount: params.interestAmount,
      total_amount: params.principalAmount + params.interestAmount,
      payment_number: params.paymentNumber || null,
      bank_transaction_id: params.bankTransactionId || null,
      notes: params.notes || null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteLoan(loanId: string): Promise<void> {
  const { error } = await db.from('loans').delete().eq('id', loanId);
  if (error) throw error;
}

// ── Auto-Match Loan Payments from Bank Transactions ──

export interface LoanMatchCandidate {
  loan: LoanRow;
  transaction: {
    id: string;
    date: string;
    counterparty: string;
    amount: number;
    description: string;
  };
  confidence: number; // 0~1
  reasons: string[];
}

export async function autoMatchLoanPayments(companyId: string): Promise<LoanMatchCandidate[]> {
  // 1. Get active loans
  const loans = await getLoans(companyId);
  const activeLoans = loans.filter(l => l.status === 'active');
  if (activeLoans.length === 0) return [];

  // 2. Get unmatched outgoing bank transactions (출금, mapping_status not matched)
  const { data: transactions } = await db
    .from('bank_transactions')
    .select('*')
    .eq('company_id', companyId)
    .eq('type', 'outgoing')
    .or('mapping_status.is.null,mapping_status.neq.matched')
    .order('date', { ascending: false })
    .limit(200);

  if (!transactions || transactions.length === 0) return [];

  // 3. Get existing loan payment transaction IDs to exclude
  const allLoanIds = activeLoans.map(l => l.id);
  const { data: existingPayments } = await db
    .from('loan_payments')
    .select('bank_transaction_id')
    .in('loan_id', allLoanIds)
    .not('bank_transaction_id', 'is', null);

  const usedTxIds = new Set((existingPayments || []).map((p: any) => p.bank_transaction_id));

  // 4. Match each loan against transactions
  const candidates: LoanMatchCandidate[] = [];

  for (const loan of activeLoans) {
    // Get latest payment for reference amount
    const { data: lastPayments } = await db
      .from('loan_payments')
      .select('total_amount')
      .eq('loan_id', loan.id)
      .order('payment_date', { ascending: false })
      .limit(3);

    const refAmounts = (lastPayments || []).map((p: any) => Number(p.total_amount));
    const avgPayment = refAmounts.length > 0 ? refAmounts.reduce((a: number, b: number) => a + b, 0) / refAmounts.length : 0;

    for (const tx of transactions) {
      if (usedTxIds.has(tx.id)) continue;

      const txAmount = Math.abs(Number(tx.amount));
      const txDate = new Date(tx.date);
      const txDay = txDate.getDate();
      const reasons: string[] = [];
      let score = 0;

      // Criterion 1: Lender name in counterparty
      const lenderNorm = (loan.lender || '').replace(/\s/g, '').toLowerCase();
      const counterNorm = (tx.counterparty || tx.description || '').replace(/\s/g, '').toLowerCase();
      if (lenderNorm && counterNorm.includes(lenderNorm)) {
        score += 0.4;
        reasons.push(`금융기관명 일치 (${loan.lender})`);
      } else if (lenderNorm && lenderNorm.length >= 2) {
        // Partial match (e.g., "IBK" in "IBK기업은행")
        const parts = lenderNorm.match(/.{2,}/g) || [];
        if (parts.some(p => counterNorm.includes(p))) {
          score += 0.2;
          reasons.push(`금융기관명 부분 일치`);
        }
      }

      // Criterion 2: Payment day proximity (±5 days)
      if (loan.payment_day) {
        const dayDiff = Math.abs(txDay - loan.payment_day);
        if (dayDiff <= 2) { score += 0.3; reasons.push(`상환일 일치 (${loan.payment_day}일)`); }
        else if (dayDiff <= 5) { score += 0.15; reasons.push(`상환일 근접 (±${dayDiff}일)`); }
      }

      // Criterion 3: Amount range (80%~120% of previous payments)
      if (avgPayment > 0) {
        const ratio = txAmount / avgPayment;
        if (ratio >= 0.8 && ratio <= 1.2) {
          score += 0.3;
          reasons.push(`금액 범위 일치 (₩${txAmount.toLocaleString()})`);
        } else if (ratio >= 0.5 && ratio <= 1.5) {
          score += 0.1;
          reasons.push(`금액 유사 (₩${txAmount.toLocaleString()})`);
        }
      } else if (txAmount > 100000) {
        // No reference: if amount is significant, add small score
        score += 0.05;
      }

      // Only include if score is reasonable
      if (score >= 0.3 && reasons.length >= 1) {
        candidates.push({
          loan,
          transaction: {
            id: tx.id,
            date: tx.date,
            counterparty: tx.counterparty || tx.description || '',
            amount: txAmount,
            description: tx.description || '',
          },
          confidence: Math.min(score, 1),
          reasons,
        });
      }
    }
  }

  // Sort by confidence descending
  return candidates.sort((a, b) => b.confidence - a.confidence);
}

// Accept a match candidate: record payment + update loan balance + mark transaction
export async function acceptLoanMatch(candidate: LoanMatchCandidate): Promise<void> {
  const { loan, transaction } = candidate;

  // Get current payment count
  const { data: payments } = await db
    .from('loan_payments')
    .select('payment_number')
    .eq('loan_id', loan.id)
    .order('payment_number', { ascending: false })
    .limit(1);

  const nextNum = ((payments?.[0]?.payment_number || 0) + 1);

  // Record payment (assume all principal for simplicity, can be split later)
  await recordLoanPayment({
    loanId: loan.id,
    paymentDate: transaction.date,
    principalAmount: transaction.amount,
    interestAmount: 0,
    paymentNumber: nextNum,
    bankTransactionId: transaction.id,
    notes: `자동 매칭 (${candidate.reasons.join(', ')})`,
  });

  // Update remaining balance
  const newBalance = Math.max(0, Number(loan.remaining_balance) - transaction.amount);
  await updateLoan(loan.id, { remainingBalance: newBalance });

  // Mark transaction as matched
  await db.from('bank_transactions').update({
    mapping_status: 'matched',
    deal_id: null,
    updated_at: new Date().toISOString(),
  }).eq('id', transaction.id);
}
