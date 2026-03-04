/**
 * LeanOS Payment Batch Engine
 * 급여/고정비 일괄 배치 → 대표 승인 → n8n 트리거 자동이체
 */

import { supabase } from './supabase';
import { createQueueEntry } from './payment-queue';
import { getRecurringPayments } from './approval-center';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

// ── Types ──

export interface BatchSummary {
  id: string;
  name: string;
  batchType: string;
  totalAmount: number;
  itemCount: number;
  status: string;
  approvedBy?: string;
  approvedAt?: string;
  createdAt: string;
}

export interface PayrollItem {
  employeeId: string;
  employeeName: string;
  baseSalary: number;
  nationalPension: number;
  healthInsurance: number;
  employmentInsurance: number;
  incomeTax: number;
  localIncomeTax: number;
  deductionsTotal: number;
  netPay: number;
}

// ── Korean Social Insurance Rates (2026) ──

const RATES = {
  nationalPension: 0.045,       // 국민연금 4.5% (직원분)
  healthInsurance: 0.03545,     // 건강보험 3.545% (직원분)
  longTermCare: 0.1295,         // 장기요양 건강보험의 12.95%
  employmentInsurance: 0.009,   // 고용보험 0.9% (직원분)
};

// Simplified income tax table (간이세액표 근사)
function estimateIncomeTax(monthlySalary: number): number {
  if (monthlySalary <= 1060000) return 0;
  if (monthlySalary <= 1500000) return Math.round(monthlySalary * 0.02);
  if (monthlySalary <= 3000000) return Math.round(monthlySalary * 0.04);
  if (monthlySalary <= 5000000) return Math.round(monthlySalary * 0.06);
  if (monthlySalary <= 8000000) return Math.round(monthlySalary * 0.1);
  return Math.round(monthlySalary * 0.15);
}

// ── Calculate payroll for a single employee ──

export function calculatePayroll(baseSalary: number, name: string, employeeId: string): PayrollItem {
  const np = Math.round(baseSalary * RATES.nationalPension);
  const hi = Math.round(baseSalary * RATES.healthInsurance);
  const ltc = Math.round(hi * RATES.longTermCare);
  const ei = Math.round(baseSalary * RATES.employmentInsurance);
  const it = estimateIncomeTax(baseSalary);
  const lit = Math.round(it * 0.1); // 지방소득세 = 소득세의 10%
  const deductions = np + hi + ltc + ei + it + lit;

  return {
    employeeId,
    employeeName: name,
    baseSalary,
    nationalPension: np,
    healthInsurance: hi + ltc,
    employmentInsurance: ei,
    incomeTax: it,
    localIncomeTax: lit,
    deductionsTotal: deductions,
    netPay: baseSalary - deductions,
  };
}

// ── Create payroll batch for all active employees ──

export async function createPayrollBatch(companyId: string, monthLabel?: string): Promise<{ batchId: string; items: PayrollItem[] }> {
  const label = monthLabel || `${new Date().getFullYear()}년 ${new Date().getMonth() + 1}월`;

  // Get active employees with salary
  const { data: employees } = await db
    .from('employees')
    .select('id, name, salary, bank_account, bank_name, is_4_insurance, status')
    .eq('company_id', companyId)
    .eq('status', 'active');

  if (!employees?.length) throw new Error('활성 직원이 없습니다');

  // Calculate payroll for each
  const items: PayrollItem[] = employees.map((emp: any) => {
    const salary = Number(emp.salary || 0);
    if (salary <= 0) return null;
    return calculatePayroll(salary, emp.name, emp.id);
  }).filter(Boolean) as PayrollItem[];

  if (items.length === 0) throw new Error('급여가 설정된 직원이 없습니다');

  const totalAmount = items.reduce((s, i) => s + i.netPay, 0);

  // Create batch
  const { data: batch, error: batchError } = await db
    .from('payment_batches')
    .insert({
      company_id: companyId,
      name: `${label} 급여`,
      batch_type: 'payroll',
      total_amount: totalAmount,
      item_count: items.length,
      status: 'draft',
    })
    .select()
    .single();

  if (batchError) throw batchError;

  // Create payment queue entries for each employee
  for (const item of items) {
    const emp = employees.find((e: any) => e.id === item.employeeId);
    await createQueueEntry({
      companyId,
      amount: item.netPay,
      description: `${label} 급여 - ${item.employeeName}`,
      costType: 'salary',
    }).then(async (entry) => {
      if (entry) {
        // Link to batch + add recipient info
        await db.from('payment_queue').update({
          batch_id: batch.id,
          payment_type: 'payroll',
          category: 'salary',
          recipient_name: item.employeeName,
          recipient_account: emp?.bank_account || null,
          recipient_bank: emp?.bank_name || null,
        }).eq('id', entry.id);
      }
    });
  }

  return { batchId: batch.id, items };
}

// ── Create fixed cost batch from recurring payments ──

export async function createFixedCostBatch(companyId: string, monthLabel?: string): Promise<{ batchId: string; count: number; totalAmount: number }> {
  const label = monthLabel || `${new Date().getFullYear()}년 ${new Date().getMonth() + 1}월`;

  const recurring = await getRecurringPayments(companyId);
  const active = recurring.filter((r: any) => r.is_active);

  if (active.length === 0) throw new Error('활성 반복결제가 없습니다');

  const totalAmount = active.reduce((s: number, r: any) => s + Number(r.amount || 0), 0);

  // Create batch
  const { data: batch, error: batchError } = await db
    .from('payment_batches')
    .insert({
      company_id: companyId,
      name: `${label} 고정비`,
      batch_type: 'fixed_cost',
      total_amount: totalAmount,
      item_count: active.length,
      status: 'draft',
    })
    .select()
    .single();

  if (batchError) throw batchError;

  // Create payment queue entries
  for (const r of active) {
    const entry = await createQueueEntry({
      companyId,
      amount: Number(r.amount || 0),
      description: `${r.name} (${r.category})`,
      costType: r.category,
    });

    if (entry) {
      await db.from('payment_queue').update({
        batch_id: batch.id,
        payment_type: 'fixed_cost',
        category: r.category,
        is_recurring: true,
        recurring_rule_id: r.id,
        recipient_name: r.recipient_name || null,
        recipient_account: r.recipient_account || null,
        recipient_bank: r.recipient_bank || null,
      }).eq('id', entry.id);
    }
  }

  // Update last_generated_at on recurring payments
  const ids = active.map((r: any) => r.id);
  await db.from('recurring_payments').update({
    last_generated_at: new Date().toISOString(),
  }).in('id', ids);

  return { batchId: batch.id, count: active.length, totalAmount };
}

// ── Approve a batch (CEO action) ──

export async function approveBatch(batchId: string, userId: string): Promise<void> {
  // Update batch status
  await db.from('payment_batches').update({
    status: 'approved',
    approved_by: userId,
    approved_at: new Date().toISOString(),
  }).eq('id', batchId);

  // Approve all linked payment queue entries
  await db.from('payment_queue').update({
    status: 'approved',
    approved_by: userId,
    approved_at: new Date().toISOString(),
  }).eq('batch_id', batchId).eq('status', 'pending');
}

// ── Trigger batch execution via n8n webhook ──

export async function triggerBatchExecution(batchId: string): Promise<{ triggered: boolean; executionId?: string }> {
  // Get batch details
  const { data: batch } = await db
    .from('payment_batches')
    .select('*')
    .eq('id', batchId)
    .single();

  if (!batch || batch.status !== 'approved') {
    return { triggered: false };
  }

  // Get linked payments
  const { data: payments } = await db
    .from('payment_queue')
    .select('id, amount, description, recipient_name, recipient_account, recipient_bank')
    .eq('batch_id', batchId)
    .eq('status', 'approved');

  if (!payments?.length) return { triggered: false };

  // Update batch to executing
  await db.from('payment_batches').update({ status: 'executing' }).eq('id', batchId);

  // n8n webhook URL (configurable via settings)
  const N8N_WEBHOOK_URL = process.env.NEXT_PUBLIC_N8N_PAYMENT_WEBHOOK || 'http://localhost:5678/webhook/payment-batch';

  try {
    const response = await fetch(N8N_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        batchId: batch.id,
        batchType: batch.batch_type,
        totalAmount: batch.total_amount,
        payments: payments.map((p: any) => ({
          id: p.id,
          amount: Number(p.amount),
          description: p.description,
          recipientName: p.recipient_name,
          recipientAccount: p.recipient_account,
          recipientBank: p.recipient_bank,
        })),
      }),
    });

    if (response.ok) {
      const result = await response.json();
      const executionId = result.executionId || `n8n-${Date.now()}`;

      await db.from('payment_batches').update({
        n8n_execution_id: executionId,
      }).eq('id', batchId);

      return { triggered: true, executionId };
    }
  } catch {
    // n8n not available — mark for manual execution
    await db.from('payment_batches').update({
      status: 'approved', // Revert to approved
    }).eq('id', batchId);
  }

  return { triggered: false };
}

// ── Get batch with items ──

export async function getBatchWithItems(batchId: string) {
  const { data: batch } = await db
    .from('payment_batches')
    .select('*, users:approved_by(name)')
    .eq('id', batchId)
    .single();

  const { data: items } = await db
    .from('payment_queue')
    .select('*')
    .eq('batch_id', batchId)
    .order('created_at');

  return { batch, items: items || [] };
}

// ── Get all batches for a company ──

export async function getCompanyBatches(companyId: string, status?: string): Promise<BatchSummary[]> {
  let query = db
    .from('payment_batches')
    .select('*, users:approved_by(name)')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });

  if (status) query = query.eq('status', status);

  const { data } = await query;

  return (data || []).map((b: any) => ({
    id: b.id,
    name: b.name,
    batchType: b.batch_type,
    totalAmount: Number(b.total_amount || 0),
    itemCount: b.item_count || 0,
    status: b.status,
    approvedBy: b.users?.name,
    approvedAt: b.approved_at,
    createdAt: b.created_at,
  }));
}
