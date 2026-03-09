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
