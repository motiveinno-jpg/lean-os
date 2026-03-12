/**
 * OwnerView Payment Queue Engine
 * 지급 실행 큐: 생성 → 승인 → 실행
 */

import { supabase } from './supabase';
import { resolveBank } from './routing';
import { logAudit } from './audit';
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
}): Promise<PaymentQueue | null> {
  // ── Dedup Strategy 1: approval_request_id ──
  if (params.approvalRequestId) {
    try {
      const { data: existing } = await supabase
        .from('payment_queue')
        .select('*')
        .eq('company_id', params.companyId)
        .eq('approval_request_id', params.approvalRequestId)
        .maybeSingle();
      if (existing) return existing as PaymentQueue;
    } catch {
      // Column may not exist yet — skip this dedup strategy
    }
  }

  // ── Dedup Strategy 2: cost_schedule_id ──
  if (params.costScheduleId) {
    const { data: existing } = await supabase
      .from('payment_queue')
      .select('*')
      .eq('company_id', params.companyId)
      .eq('cost_schedule_id', params.costScheduleId)
      .maybeSingle();
    if (existing) return existing as PaymentQueue;
  }

  // ── Dedup Strategy 3: deal_id + description combo ──
  if (params.dealId && params.description) {
    const { data: existing } = await supabase
      .from('payment_queue')
      .select('*')
      .eq('company_id', params.companyId)
      .eq('deal_id', params.dealId)
      .eq('description', params.description)
      .maybeSingle();
    if (existing) return existing as PaymentQueue;
  }

  // ── Dedup Strategy 4: source_type + source_id (mapped to payment_type + category) ──
  if (params.sourceType && params.sourceId) {
    const { data: existing } = await supabase
      .from('payment_queue')
      .select('*')
      .eq('company_id', params.companyId)
      .eq('payment_type', params.sourceType)
      .eq('category', params.sourceId)
      .maybeSingle();
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
    status: 'pending',
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

  // ── Pre-execution balance check ──
  if (payment.bank_account_id) {
    const { data: bank } = await supabase
      .from('bank_accounts')
      .select('balance')
      .eq('id', payment.bank_account_id)
      .single();

    const currentBalance = Number(bank?.balance || 0);
    const paymentAmount = Number(payment.amount);

    if (currentBalance < paymentAmount) {
      // Mark as failed due to insufficient funds
      await supabase
        .from('payment_queue')
        .update({ status: 'failed' })
        .eq('id', paymentId);

      await logAudit({
        companyId: payment.company_id,
        entityType: 'payment_queue',
        entityId: paymentId,
        action: 'execute_failed',
        metadata: {
          reason: 'insufficient_balance',
          required: paymentAmount,
          available: currentBalance,
        },
      });

      throw new Error(
        `잔액 부족: 필요 ${paymentAmount.toLocaleString()}원, 가용 ${currentBalance.toLocaleString()}원`
      );
    }
  }

  // ── Generate transaction reference ──
  const randomSuffix = Math.random().toString(36).substring(2, 8).toUpperCase();
  const transferRef = `TXN-${Date.now()}-${randomSuffix}`;

  // ── Mark as executed ──
  const { error } = await supabase
    .from('payment_queue')
    .update({
      status: 'executed',
      executed_at: new Date().toISOString(),
      transfer_ref: transferRef,
    })
    .eq('id', paymentId);

  if (error) {
    // Rollback: revert status to approved on update failure
    await supabase
      .from('payment_queue')
      .update({ status: 'approved' })
      .eq('id', paymentId);

    throw error;
  }

  // ── 실제 이체 실행 (n8n webhook 또는 향후 은행 API) ──
  const N8N_PAYMENT_URL = process.env.NEXT_PUBLIC_N8N_PAYMENT_WEBHOOK;
  if (N8N_PAYMENT_URL) {
    try {
      const res = await fetch(N8N_PAYMENT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paymentId,
          amount: Number(payment.amount),
          recipientName: payment.recipient_name,
          recipientAccount: payment.recipient_account,
          recipientBank: payment.recipient_bank,
          description: payment.description,
          transferRef: transferRef,
        }),
      });
      if (res.ok) {
        const result = await res.json();
        if (result.transferRef) {
          await supabase.from('payment_queue').update({ transfer_ref: result.transferRef }).eq('id', paymentId);
        }
      } else {
        console.warn('n8n 이체 요청 실패, DB 상태만 업데이트됨:', res.status);
      }
    } catch (err) {
      console.warn('n8n 웹훅 연결 실패, 수동 이체 필요:', err);
    }
  }
  // n8n 미설정 시: DB에는 '실행됨'으로 표시되며, 관리자가 수동으로 이체 처리

  try {
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

    // ── Audit log: successful execution ──
    await logAudit({
      companyId: payment.company_id,
      entityType: 'payment_queue',
      entityId: paymentId,
      action: 'execute_success',
      metadata: {
        amount: Number(payment.amount),
        transfer_ref: transferRef,
        bank_account_id: payment.bank_account_id,
        cost_schedule_id: payment.cost_schedule_id,
      },
    });
  } catch (postExecError) {
    // Rollback: revert queue entry on post-execution failure
    await supabase
      .from('payment_queue')
      .update({
        status: 'failed',
        transfer_ref: transferRef,
      })
      .eq('id', paymentId);

    await logAudit({
      companyId: payment.company_id,
      entityType: 'payment_queue',
      entityId: paymentId,
      action: 'execute_failed',
      metadata: {
        transfer_ref: transferRef,
        error: postExecError instanceof Error ? postExecError.message : String(postExecError),
      },
    });

    throw postExecError;
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
