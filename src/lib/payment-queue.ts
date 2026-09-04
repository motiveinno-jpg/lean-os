import { logRead } from "@/lib/log-read";
/**
 * OwnerView Payment Queue Engine
 * 지급 대기 큐: 생성 → 승인 (실행·이체 없음)
 */

import { supabase } from './supabase';
import { resolveBank } from './routing';
import type { PaymentQueue } from '@/types/models';

// ── Create a payment queue entry from a cost schedule ──
export async function createQueueEntry(params: {
  companyId: string;
  costScheduleId?: string;
  approvalRequestId?: string;
  dealId?: string;
  amount: number;
  description?: string;
  costType?: string;
  dealBankAccountId?: string | null;
  sourceType?: string;
  sourceId?: string;
  status?: string;
}): Promise<PaymentQueue | null> {
  // ── Dedup Strategy 1: approval_request_id ──
  if (params.approvalRequestId) {
    try {
      const existing = logRead('lib/payment-queue:existing', await supabase
        .from('payment_queue')
        .select('*')
        .eq('company_id', params.companyId)
        .eq('approval_request_id', params.approvalRequestId)
        .maybeSingle());
      if (existing) return existing as PaymentQueue;
    } catch {
      // Column may not exist yet — skip this dedup strategy
    }
  }

  // ── Dedup Strategy 2: cost_schedule_id ──
  if (params.costScheduleId) {
    const existing = logRead('lib/payment-queue:existing', await supabase
      .from('payment_queue')
      .select('*')
      .eq('company_id', params.companyId)
      .eq('cost_schedule_id', params.costScheduleId)
      .maybeSingle());
    if (existing) return existing as PaymentQueue;
  }

  // ── Dedup Strategy 3: deal_id + description combo ──
  if (params.dealId && params.description) {
    const existing = logRead('lib/payment-queue:existing', await supabase
      .from('payment_queue')
      .select('*')
      .eq('company_id', params.companyId)
      .eq('deal_id', params.dealId)
      .eq('description', params.description)
      .maybeSingle());
    if (existing) return existing as PaymentQueue;
  }

  // ── Dedup Strategy 4: source_type + source_id (mapped to payment_type + category) ──
  if (params.sourceType && params.sourceId) {
    const existing = logRead('lib/payment-queue:existing', await supabase
      .from('payment_queue')
      .select('*')
      .eq('company_id', params.companyId)
      .eq('payment_type', params.sourceType)
      .eq('category', params.sourceId)
      .maybeSingle());
    if (existing) return existing as PaymentQueue;
  }

  // Resolve the target bank account
  const bank = await resolveBank(
    params.companyId,
    params.costType || 'default',
    params.dealBankAccountId
  );

  const row: Record<string, unknown> = {
    company_id: params.companyId,
    cost_schedule_id: params.costScheduleId || null,
    bank_account_id: bank?.id || null,
    amount: params.amount,
    description: params.description || null,
    status: params.status || 'pending',
  };
  // approval_request_id column may not exist yet in schema
  // if (params.approvalRequestId) row.approval_request_id = params.approvalRequestId;
  if (params.dealId) row.deal_id = params.dealId;
  if (params.sourceType) row.payment_type = params.sourceType;
  if (params.sourceId) row.category = params.sourceId;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await supabase
    .from('payment_queue')
    .insert(row as any)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// ── Approve a payment ──
//   승인은 승인으로 끝난다. 오너뷰에는 이체 기능이 없다 — 예전의 '승인 시 CODEF 자동이체'(auto_transfer_enabled/limit)와
//   실행(executePayment) 경로는 걷어냈다. 지급은 은행에서 하고, 통장 수집으로 결과가 들어온다.
export async function approvePayment(
  paymentId: string,
  userId: string
): Promise<void> {
  const { error } = await supabase
    .from('payment_queue')
    .update({
      status: 'approved',
      approved_by: userId,
      approved_at: new Date().toISOString(),
    })
    .eq('id', paymentId)
    .eq('status', 'pending');
  if (error) throw error;
}

// ── Reject a payment ──
export async function rejectPayment(
  paymentId: string,
  userId: string
): Promise<void> {
  const { error } = await supabase
    .from('payment_queue')
    .update({
      status: 'rejected',
      approved_by: userId,
      approved_at: new Date().toISOString(),
    })
    .eq('id', paymentId)
    .eq('status', 'pending');

  if (error) throw error;
}

// ── Payment queue summary stats ──
// Note: 'executed' is the canonical "done" status; 'completed' exists in legacy rows
// so we treat it as an alias to keep stats/filter/table in sync.
const EXECUTED_STATUSES = ['executed', 'completed'];

export async function getPaymentQueueStats(companyId: string) {
  const data = logRead('lib/payment-queue:data', await supabase
    .from('payment_queue')
    .select('status, amount')
    .eq('company_id', companyId));

  const items = data || [];
  return {
    pendingCount: items.filter(i => i.status === 'pending').length,
    pendingAmount: items.filter(i => i.status === 'pending').reduce((s, i) => s + Number(i.amount), 0),
    approvedCount: items.filter(i => i.status === 'approved').length,
    approvedAmount: items.filter(i => i.status === 'approved').reduce((s, i) => s + Number(i.amount), 0),
    executedCount: items.filter(i => (i.status ? EXECUTED_STATUSES.includes(i.status) : false)).length,
    executedAmount: items.filter(i => (i.status ? EXECUTED_STATUSES.includes(i.status) : false)).reduce((s, i) => s + Number(i.amount), 0),
    rejectedCount: items.filter(i => i.status === 'rejected').length,
  };
}
