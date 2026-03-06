/**
 * Reflect Payment Queue Engine
 * 지급 실행 큐: 생성 → 승인 → 실행
 */

import { supabase } from './supabase';
import { resolveBank } from './routing';
import type { PaymentQueue } from '@/types/models';

// ── Create a payment queue entry from a cost schedule ──
export async function createQueueEntry(params: {
  companyId: string;
  costScheduleId?: string;
  amount: number;
  description?: string;
  costType?: string;
  dealBankAccountId?: string | null;
}): Promise<PaymentQueue | null> {
  // Resolve the target bank account
  const bank = await resolveBank(
    params.companyId,
    params.costType || 'default',
    params.dealBankAccountId
  );

  const { data, error } = await supabase
    .from('payment_queue')
    .insert({
      company_id: params.companyId,
      cost_schedule_id: params.costScheduleId || null,
      bank_account_id: bank?.id || null,
      amount: params.amount,
      description: params.description || null,
      status: 'pending',
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// ── Approve a payment ──
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

// ── Execute a payment (mark as executed) ──
export async function executePayment(paymentId: string): Promise<void> {
  const { data: payment } = await supabase
    .from('payment_queue')
    .select('*')
    .eq('id', paymentId)
    .eq('status', 'approved')
    .single();

  if (!payment) throw new Error('승인된 결제만 실행할 수 있습니다');

  // Mark as executed
  const { error } = await supabase
    .from('payment_queue')
    .update({
      status: 'executed',
      executed_at: new Date().toISOString(),
    })
    .eq('id', paymentId);

  if (error) throw error;

  // If linked to cost schedule, update it too
  if (payment.cost_schedule_id) {
    await supabase
      .from('deal_cost_schedule')
      .update({
        status: 'paid',
        approved: true,
        approved_at: new Date().toISOString(),
      })
      .eq('id', payment.cost_schedule_id);
  }

  // Deduct from bank account balance
  if (payment.bank_account_id) {
    const { data: bank } = await supabase
      .from('bank_accounts')
      .select('balance')
      .eq('id', payment.bank_account_id)
      .single();

    if (bank) {
      await supabase
        .from('bank_accounts')
        .update({ balance: Number(bank.balance || 0) - Number(payment.amount) })
        .eq('id', payment.bank_account_id);
    }
  }
}

// ── Payment queue summary stats ──
export async function getPaymentQueueStats(companyId: string) {
  const { data } = await supabase
    .from('payment_queue')
    .select('status, amount')
    .eq('company_id', companyId);

  const items = data || [];
  return {
    pendingCount: items.filter(i => i.status === 'pending').length,
    pendingAmount: items.filter(i => i.status === 'pending').reduce((s, i) => s + Number(i.amount), 0),
    approvedCount: items.filter(i => i.status === 'approved').length,
    approvedAmount: items.filter(i => i.status === 'approved').reduce((s, i) => s + Number(i.amount), 0),
    executedCount: items.filter(i => i.status === 'executed').length,
    executedAmount: items.filter(i => i.status === 'executed').reduce((s, i) => s + Number(i.amount), 0),
    rejectedCount: items.filter(i => i.status === 'rejected').length,
  };
}
