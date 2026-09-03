import { logRead } from "@/lib/log-read";
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
// When auto_execute_on_approve is enabled in company_settings:
//   - amount <= auto_execute_limit → immediately execute via CODEF (1-Click)
//   - amount >  auto_execute_limit → stay "approved" until CEO confirms in /payments
export async function approvePayment(
  paymentId: string,
  userId: string
): Promise<{ autoExecuted: boolean; notified: boolean; error?: string } | void> {
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

  // Fetch payment + company settings to decide auto-execution
  const payment = logRead('lib/payment-queue:payment', await supabase
    .from('payment_queue')
    .select('*')
    .eq('id', paymentId)
    .single());
  if (!payment) return { autoExecuted: false, notified: false };

  // Automation settings live in companies.automation_settings (JSONB).
  // Relevant keys (saved from Settings → 은행연동 탭):
  //   auto_transfer_enabled, auto_transfer_limit
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cmp = logRead('lib/payment-queue:cmp', await (supabase)
    .from('companies')
    .select('automation_settings')
    .eq('id', payment.company_id)
    .maybeSingle());
  const settings = (cmp?.automation_settings as Record<string, unknown> | null) || {};
  const autoExecute = !!settings.auto_transfer_enabled;
  const autoLimit = Number(settings.auto_transfer_limit || 0);
  const amount = Number(payment.amount);

  if (!autoExecute) {
    return { autoExecuted: false, notified: false };
  }

  // Over the limit → keep "approved" until the CEO confirms in /payments
  if (autoLimit > 0 && amount > autoLimit) {
    return { autoExecuted: false, notified: false };
  }

  // Within limit → auto-execute via CODEF Edge Function
  try {
    const { data: result, error: invokeErr } = await supabase.functions.invoke(
      'codef-transfer',
      { body: { paymentId } }
    );
    if (invokeErr) {
      // Fallback to local executePayment to avoid payment stuck in "approved"
      try { await executePayment(paymentId); } catch { /* leave as approved */ }
      return {
        autoExecuted: false,
        notified: false,
        error: invokeErr.message,
      };
    }
    if (result?.success) {
      return { autoExecuted: true, notified: false };
    }
    return {
      autoExecuted: false,
      notified: false,
      error: result?.error || '자동이체 실패',
    };
  } catch (err) {
    return {
      autoExecuted: false,
      notified: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
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
  const payment = logRead('lib/payment-queue:payment', await supabase
    .from('payment_queue')
    .select('*')
    .eq('id', paymentId)
    .eq('status', 'approved')
    .single());

  if (!payment) throw new Error('승인된 결제만 실행할 수 있습니다');

  // ── Pre-execution balance check ──
  if (payment.bank_account_id) {
    // maybeSingle: 계좌가 지워졌거나 안 보이면 .single() 이 406 → logRead 가 null 을 돌려주고
    //   잔액 0 으로 읽혀 멀쩡한 지급이 '잔액 부족' 으로 막혔다 (2026-08-20 감사).
    const bank = logRead('lib/payment-queue:bank', await supabase
      .from('bank_accounts')
      .select('balance')
      .eq('id', payment.bank_account_id)
      .maybeSingle());
    if (!bank) throw new Error('출금 계좌를 찾을 수 없습니다 — 계좌 연결을 확인해 주세요.');

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

    //   ★ 통장 잔액은 깎지 않는다 (2026-09-03 전수 예외처리): 잔액은 은행 연동이 주는 사실이고 오너뷰엔 이체 기능이 없다.
    //     '지급 완료' 표시는 상태일 뿐이며 실제 출금은 통장 거래로 수집돼 잔액에 반영된다. 종전 -금액 은 다음 연동 때 덮이거나 두 번 셈해졌다.

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

    // ── Auto-trigger settlement for revenue payments (동적 import로 순환 참조 방지) ──
    if (payment.deal_id) {
      const schedule = logRead('lib/payment-queue:schedule', await supabase
        .from('deal_revenue_schedule')
        .select('id')
        .eq('deal_id', payment.deal_id)
        .eq('amount', Number(payment.amount))
        .in('status', ['pending', 'issued'])
        .limit(1)
        .single());

      if (schedule) {
        const { onRevenueReceived } = await import('./deal-pipeline');
        await onRevenueReceived({
          dealId: payment.deal_id,
          companyId: payment.company_id,
          amount: Number(payment.amount),
          userId: payment.approved_by || 'system',
          revenueScheduleId: schedule.id,
        });
      }
    }
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
