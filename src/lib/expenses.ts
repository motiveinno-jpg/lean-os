/**
 * OwnerView Expense Engine
 * 경비청구 + 다단계 승인
 */

import { supabase } from './supabase';
import { createQueueEntry } from './payment-queue';
import { resolveBank } from './routing';

// ── Types & Constants ──
export const EXPENSE_CATEGORIES = [
  { value: 'general', label: '일반 경비' },
  { value: 'travel', label: '출장비' },
  { value: 'entertainment', label: '접대비' },
  { value: 'supplies', label: '소모품' },
  { value: 'transport', label: '교통비' },
  { value: 'education', label: '교육비' },
  { value: 'equipment', label: '장비 구매' },
  { value: 'subscription', label: '구독료' },
  { value: 'meals', label: '식비' },
  { value: 'other', label: '기타' },
] as const;

export const EXPENSE_STATUS = {
  pending: { label: '승인 대기', bg: 'bg-yellow-500/10', text: 'text-yellow-400' },
  approved: { label: '승인', bg: 'bg-green-500/10', text: 'text-green-400' },
  rejected: { label: '반려', bg: 'bg-red-500/10', text: 'text-red-400' },
  paid: { label: '지급 완료', bg: 'bg-blue-500/10', text: 'text-blue-400' },
} as const;

// Use `any` cast for tables not yet in the generated DB types
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

// ── Create expense request ──
export async function createExpenseRequest(params: {
  companyId: string;
  requesterId: string;
  dealId?: string;
  title: string;
  description?: string;
  amount: number;
  category?: string;
  receiptUrls?: string[];
}) {
  const { data, error } = await db
    .from('expense_requests')
    .insert({
      company_id: params.companyId,
      requester_id: params.requesterId,
      deal_id: params.dealId || null,
      title: params.title,
      description: params.description || null,
      amount: params.amount,
      category: params.category || 'general',
      receipt_urls: params.receiptUrls || [],
      status: 'pending',
    })
    .select()
    .single();
  if (error) throw error;

  // Auto-generate 지출결의서 approval request
  if (data) {
    autoCreateExpenseApproval(params.companyId, params.requesterId, data).catch((err) => {
      console.error('Auto expense approval creation failed:', err);
    });
  }

  return data;
}

const EXPENSE_APPROVAL_THRESHOLD = 100000; // ₩100,000 이상 결재 필요

async function autoCreateExpenseApproval(companyId: string, requesterId: string, expense: any) {
  try {
    const amount = Number(expense.amount);
    if (amount < EXPENSE_APPROVAL_THRESHOLD) return; // 기준 금액 미만은 결재 생략

    const { createApprovalRequest } = await import('./approval-workflow');
    await createApprovalRequest({
      companyId,
      requestType: 'expense',
      requestId: expense.id,
      requesterId,
      title: `[경비] ${expense.title}`,
      amount,
      description: expense.description || `경비 청구: ${expense.title}\n금액: ₩${amount.toLocaleString()}\n카테고리: ${expense.category}`,
    });
  } catch (err) {
    console.error('autoCreateExpenseApproval failed:', err);
  }
}

// ── Get expense requests ──
export async function getExpenseRequests(companyId: string, status?: string) {
  let query = db
    .from('expense_requests')
    .select('*, users:requester_id(name, email), deals(name)')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });
  if (status) query = query.eq('status', status);
  const { data } = await query;
  return data || [];
}

// ── Get my expense requests ──
export async function getMyExpenses(userId: string) {
  const { data } = await db
    .from('expense_requests')
    .select('*, deals(name)')
    .eq('requester_id', userId)
    .order('created_at', { ascending: false });
  return data || [];
}

// ── Approve / Reject ──
export async function approveExpense(params: {
  companyId: string;
  expenseId: string;
  approverId: string;
  comment?: string;
}) {
  // Create approval record
  const { error: approvalError } = await db.from('expense_approvals').insert({
    company_id: params.companyId,
    expense_id: params.expenseId,
    approver_id: params.approverId,
    level: 1,
    status: 'approved',
    comment: params.comment || null,
    decided_at: new Date().toISOString(),
  });
  if (approvalError) throw approvalError;

  // Update expense status
  const { data: updatedExpense, error } = await db
    .from('expense_requests')
    .update({ status: 'approved', updated_at: new Date().toISOString() })
    .eq('id', params.expenseId)
    .select('id, title, amount, deal_id')
    .single();
  if (error) {
    // Rollback: delete the approval record
    await db.from('expense_approvals').delete()
      .eq('expense_id', params.expenseId)
      .eq('approver_id', params.approverId)
      .eq('status', 'approved');
    throw error;
  }

  // Auto-queue approved expense to payment queue
  if (updatedExpense) {
    try {
      const amount = Number(updatedExpense.amount || 0);
      if (amount > 0) {
        const bank = await resolveBank(params.companyId, 'expense');
        await createQueueEntry({
          companyId: params.companyId,
          amount,
          description: `[경비승인] ${updatedExpense.title}`,
          costType: 'expense',
          dealId: updatedExpense.deal_id || undefined,
          dealBankAccountId: bank?.id || null,
          sourceType: 'expense_request',
          sourceId: params.expenseId,
        });
      }
    } catch (queueErr) {
      // Payment queue creation failure should not block approval
      console.error('Expense payment queue creation failed:', queueErr);
    }
  }
}

export async function rejectExpense(params: {
  companyId: string;
  expenseId: string;
  approverId: string;
  comment?: string;
}) {
  const { error: approvalError } = await db.from('expense_approvals').insert({
    company_id: params.companyId,
    expense_id: params.expenseId,
    approver_id: params.approverId,
    level: 1,
    status: 'rejected',
    comment: params.comment || null,
    decided_at: new Date().toISOString(),
  });
  if (approvalError) throw approvalError;

  const { error } = await db
    .from('expense_requests')
    .update({ status: 'rejected', updated_at: new Date().toISOString() })
    .eq('id', params.expenseId);
  if (error) {
    // Rollback: delete the rejection record
    await db.from('expense_approvals').delete()
      .eq('expense_id', params.expenseId)
      .eq('approver_id', params.approverId)
      .eq('status', 'rejected');
    throw error;
  }
}

export async function markExpensePaid(expenseId: string) {
  const { error } = await db
    .from('expense_requests')
    .update({ status: 'paid', updated_at: new Date().toISOString() })
    .eq('id', expenseId);
  if (error) throw error;
}

// ── Get approvals for an expense ──
export async function getExpenseApprovals(expenseId: string) {
  const { data } = await db
    .from('expense_approvals')
    .select('*, users:approver_id(name, email)')
    .eq('expense_id', expenseId)
    .order('created_at');
  return data || [];
}

// ── Summary ──
export async function getExpenseSummary(companyId: string, month?: string) {
  const { data: expenses } = await db
    .from('expense_requests')
    .select('amount, category, status, created_at')
    .eq('company_id', companyId)
    .neq('status', 'rejected');

  if (!expenses) return { total: 0, pending: 0, approved: 0, paid: 0, byCategory: {} };

  const filtered = month
    ? expenses.filter((e: any) => e.created_at?.startsWith(month))
    : expenses;

  const byCategory: Record<string, number> = {};
  let pending = 0, approved = 0, paid = 0;

  filtered.forEach((e: any) => {
    const amt = Number(e.amount || 0);
    byCategory[e.category || 'general'] = (byCategory[e.category || 'general'] || 0) + amt;
    if (e.status === 'pending') pending += amt;
    else if (e.status === 'approved') approved += amt;
    else if (e.status === 'paid') paid += amt;
  });

  return {
    total: pending + approved + paid,
    pending,
    approved,
    paid,
    byCategory,
  };
}
