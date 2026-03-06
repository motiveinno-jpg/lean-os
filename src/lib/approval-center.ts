/**
 * Reflect CEO Approval Center
 * 대표 승인센터 — 6개 소스 통합 조회 + 원클릭/일괄 승인
 */

import { supabase } from './supabase';
import { approvePayment } from './payment-queue';
import { approveExpense } from './expenses';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

// ── Types ──

export type PendingActionType = 'payment' | 'expense' | 'document' | 'leave' | 'signature' | 'cost';

export interface PendingAction {
  id: string;
  type: PendingActionType;
  title: string;
  amount?: number;
  requester?: string;
  createdAt: string;
  urgency: 'high' | 'medium' | 'low';
  dealName?: string;
  metadata?: Record<string, unknown>;
}

export interface ApprovalSummary {
  total: number;
  payments: number;
  expenses: number;
  documents: number;
  leaves: number;
  signatures: number;
  costs: number;
}

// ── Get all pending actions for CEO ──

export async function getCEOPendingActions(companyId: string): Promise<PendingAction[]> {
  const actions: PendingAction[] = [];

  const [payments, expenses, documents, leaves, signatures, costs] = await Promise.all([
    // 1. 결제 대기
    supabase
      .from('payment_queue')
      .select('id, amount, description, created_at, deals(name)')
      .eq('company_id', companyId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false }),

    // 2. 경비 승인 대기
    db
      .from('expense_requests')
      .select('id, title, amount, category, created_at, users:requester_id(name), deals(name)')
      .eq('company_id', companyId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false }),

    // 3. 문서 검토 대기
    supabase
      .from('documents')
      .select('id, name, status, created_at, deals(name)')
      .eq('company_id', companyId)
      .eq('status', 'review')
      .order('created_at', { ascending: false }),

    // 4. 휴가 승인 대기
    db
      .from('leave_requests')
      .select('id, leave_type, days, reason, created_at, employees(name)')
      .eq('company_id', companyId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false }),

    // 5. 서명 대기
    db
      .from('signature_requests')
      .select('id, signer_name, status, created_at, documents(name)')
      .eq('company_id', companyId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false }),

    // 6. 비용 미승인
    supabase
      .from('deal_cost_schedule')
      .select('id, item_name, amount, created_at, deals(name)')
      .eq('company_id', companyId)
      .eq('approved', false)
      .order('created_at', { ascending: false }),
  ]);

  // Map payments
  (payments.data || []).forEach((p: any) => {
    actions.push({
      id: p.id,
      type: 'payment',
      title: p.description || '결제 승인 요청',
      amount: Number(p.amount || 0),
      createdAt: p.created_at,
      urgency: Number(p.amount || 0) >= 5000000 ? 'high' : 'medium',
      dealName: p.deals?.name,
    });
  });

  // Map expenses
  (expenses.data || []).forEach((e: any) => {
    actions.push({
      id: e.id,
      type: 'expense',
      title: e.title || '경비 청구',
      amount: Number(e.amount || 0),
      requester: e.users?.name,
      createdAt: e.created_at,
      urgency: Number(e.amount || 0) >= 1000000 ? 'high' : 'low',
      dealName: e.deals?.name,
    });
  });

  // Map documents
  (documents.data || []).forEach((d: any) => {
    actions.push({
      id: d.id,
      type: 'document',
      title: d.name || '문서 검토',
      createdAt: d.created_at,
      urgency: 'medium',
      dealName: d.deals?.name,
    });
  });

  // Map leaves
  (leaves.data || []).forEach((l: any) => {
    const typeLabel: Record<string, string> = {
      annual: '연차', sick: '병가', personal: '개인사유',
      maternity: '출산', paternity: '육아', compensation: '보상',
    };
    actions.push({
      id: l.id,
      type: 'leave',
      title: `${l.employees?.name || '직원'} ${typeLabel[l.leave_type] || l.leave_type} ${l.days}일`,
      createdAt: l.created_at,
      urgency: 'low',
    });
  });

  // Map signatures
  (signatures.data || []).forEach((s: any) => {
    actions.push({
      id: s.id,
      type: 'signature',
      title: `서명 요청: ${s.signer_name || ''}`,
      createdAt: s.created_at,
      urgency: 'medium',
      metadata: { documentName: s.documents?.name },
    });
  });

  // Map unapproved costs
  (costs.data || []).forEach((c: any) => {
    actions.push({
      id: c.id,
      type: 'cost',
      title: c.item_name || '비용 승인',
      amount: Number(c.amount || 0),
      createdAt: c.created_at,
      urgency: Number(c.amount || 0) >= 3000000 ? 'high' : 'medium',
      dealName: c.deals?.name,
    });
  });

  // Sort by urgency (high first) then by date (newest first)
  const urgencyOrder = { high: 0, medium: 1, low: 2 };
  actions.sort((a, b) => {
    const ud = urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
    if (ud !== 0) return ud;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return actions;
}

// ── Get summary counts ──

export async function getApprovalSummary(companyId: string): Promise<ApprovalSummary> {
  const [payments, expenses, documents, leaves, signatures, costs] = await Promise.all([
    supabase.from('payment_queue').select('id', { count: 'exact', head: true })
      .eq('company_id', companyId).eq('status', 'pending'),
    db.from('expense_requests').select('id', { count: 'exact', head: true })
      .eq('company_id', companyId).eq('status', 'pending'),
    supabase.from('documents').select('id', { count: 'exact', head: true })
      .eq('company_id', companyId).eq('status', 'review'),
    db.from('leave_requests').select('id', { count: 'exact', head: true })
      .eq('company_id', companyId).eq('status', 'pending'),
    db.from('signature_requests').select('id', { count: 'exact', head: true })
      .eq('company_id', companyId).eq('status', 'pending'),
    supabase.from('deal_cost_schedule').select('id', { count: 'exact', head: true })
      .eq('company_id', companyId).eq('approved', false),
  ]);

  const p = payments.count || 0;
  const e = expenses.count || 0;
  const d = documents.count || 0;
  const l = leaves.count || 0;
  const s = signatures.count || 0;
  const c = costs.count || 0;

  return {
    total: p + e + d + l + s + c,
    payments: p,
    expenses: e,
    documents: d,
    leaves: l,
    signatures: s,
    costs: c,
  };
}

// ── Approve a single action by type ──

export async function approveAction(
  companyId: string,
  actionType: PendingActionType,
  actionId: string,
  userId: string,
): Promise<void> {
  switch (actionType) {
    case 'payment':
      await approvePayment(actionId, userId);
      break;

    case 'expense':
      await approveExpense({ companyId, expenseId: actionId, approverId: userId });
      break;

    case 'document':
      await supabase.from('documents')
        .update({ status: 'approved', updated_at: new Date().toISOString() })
        .eq('id', actionId);
      await supabase.from('doc_approvals').insert({
        document_id: actionId,
        approver_id: userId,
        status: 'approved',
        signed_at: new Date().toISOString(),
      });
      break;

    case 'leave':
      await db.from('leave_requests')
        .update({ status: 'approved', approved_by: userId, approved_at: new Date().toISOString() })
        .eq('id', actionId);
      break;

    case 'signature':
      await db.from('signature_requests')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', actionId);
      break;

    case 'cost':
      await supabase.from('deal_cost_schedule')
        .update({ approved: true, approved_at: new Date().toISOString() })
        .eq('id', actionId);
      break;
  }
}

// ── Bulk approve multiple actions ──

export async function bulkApproveActions(
  companyId: string,
  actions: { type: PendingActionType; id: string }[],
  userId: string,
): Promise<{ succeeded: number; failed: number }> {
  let succeeded = 0;
  let failed = 0;

  for (const action of actions) {
    try {
      await approveAction(companyId, action.type, action.id, userId);
      succeeded++;
    } catch {
      failed++;
    }
  }

  return { succeeded, failed };
}

// ── Get recurring payments ──

export async function getRecurringPayments(companyId: string) {
  const { data } = await db
    .from('recurring_payments')
    .select('*, bank_accounts(bank_name, account_number)')
    .eq('company_id', companyId)
    .order('category')
    .order('name');
  return data || [];
}

// ── Upsert recurring payment ──

export async function upsertRecurringPayment(params: {
  id?: string;
  companyId: string;
  name: string;
  amount: number;
  category: string;
  recipientName?: string;
  recipientAccount?: string;
  recipientBank?: string;
  bankAccountId?: string;
  frequency?: string;
  dayOfMonth?: number;
  isActive?: boolean;
}) {
  const row: Record<string, unknown> = {
    company_id: params.companyId,
    name: params.name,
    amount: params.amount,
    category: params.category,
  };
  if (params.id) row.id = params.id;
  if (params.recipientName !== undefined) row.recipient_name = params.recipientName;
  if (params.recipientAccount !== undefined) row.recipient_account = params.recipientAccount;
  if (params.recipientBank !== undefined) row.recipient_bank = params.recipientBank;
  if (params.bankAccountId !== undefined) row.bank_account_id = params.bankAccountId;
  if (params.frequency !== undefined) row.frequency = params.frequency;
  if (params.dayOfMonth !== undefined) row.day_of_month = params.dayOfMonth;
  if (params.isActive !== undefined) row.is_active = params.isActive;

  const { data, error } = await db
    .from('recurring_payments')
    .upsert(row)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ── Get payment batches ──

export async function getPaymentBatches(companyId: string, status?: string) {
  let query = db
    .from('payment_batches')
    .select('*, users:approved_by(name)')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });
  if (status) query = query.eq('status', status);
  const { data } = await query;
  return data || [];
}
