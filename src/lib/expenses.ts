import { logRead } from "@/lib/log-read";
/**
 * OwnerView Expense Engine
 * 경비청구 + 다단계 승인
 */

import { supabase } from './supabase';
import { createQueueEntry } from './payment-queue';
import { resolveBank } from './routing';

// Use `any` cast for tables not yet in the generated DB types
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase;

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
