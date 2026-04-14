/**
 * OwnerView Payment Batch Engine
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
  nonTaxableAmount: number;
  taxableIncome: number;
  nationalPension: number;
  healthInsurance: number;
  employmentInsurance: number;
  incomeTax: number;
  localIncomeTax: number;
  deductionsTotal: number;
  netPay: number;
  employerCosts: {
    nationalPension: number;
    healthInsurance: number;
    employmentInsurance: number;
    industrialAccident: number;
    total: number;
  };
}

// ── Korean Social Insurance Rates (2026) ──

const RATES = {
  nationalPension: 0.045,       // 국민연금 4.5% (직원분)
  healthInsurance: 0.03545,     // 건강보험 3.545% (직원분)
  longTermCare: 0.1295,         // 장기요양 건강보험의 12.95%
  employmentInsurance: 0.009,   // 고용보험 0.9% (직원분)
  industrialAccident: 0.007,    // 산재보험 0.7% (사업주 부담)
};

// 국민연금 상한/하한 (2026 기준)
const NATIONAL_PENSION_CEILING = 5_900_000;
const NATIONAL_PENSION_FLOOR = 390_000;

// 건강보험 상한/하한 (2026 기준)
const HEALTH_INSURANCE_CEILING = 119_625_307;
const HEALTH_INSURANCE_FLOOR = 279_266;

// 간이세액표 기반 소득세 근사 (국세청 2025 간이세액표, 1인 기준)
// dependents: 부양가족 수 (본인 포함, 기본 1)
interface TaxBracket {
  threshold: number;
  tax: number;
}

const SIMPLIFIED_TAX_TABLE: TaxBracket[] = [
  { threshold: 1_060_000, tax: 0 },
  { threshold: 1_500_000, tax: 19_000 },
  { threshold: 2_000_000, tax: 26_000 },
  { threshold: 2_500_000, tax: 32_000 },
  { threshold: 3_000_000, tax: 39_000 },
  { threshold: 3_500_000, tax: 58_000 },
  { threshold: 4_000_000, tax: 83_000 },
  { threshold: 5_000_000, tax: 138_000 },
  { threshold: 6_000_000, tax: 205_000 },
  { threshold: 7_000_000, tax: 286_000 },
  { threshold: 8_000_000, tax: 377_000 },
  { threshold: 10_000_000, tax: 581_000 },
];

// 부양가족 수에 따른 세액 감면 근사 (1인당 약 12,500원/월 감면)
const DEPENDENTS_DEDUCTION_PER_PERSON = 12_500;

function estimateIncomeTax(
  monthlySalary: number,
  dependents = 1,
): number {
  if (monthlySalary <= SIMPLIFIED_TAX_TABLE[0].threshold) return 0;

  // Find the bracket via interpolation between table entries
  let tax = 0;
  const lastEntry = SIMPLIFIED_TAX_TABLE[SIMPLIFIED_TAX_TABLE.length - 1];

  if (monthlySalary > lastEntry.threshold) {
    // Above the table: use the last known tax + marginal rate ~38% on excess
    const MARGINAL_RATE_ABOVE_TABLE = 0.38;
    const excess = monthlySalary - lastEntry.threshold;
    tax = lastEntry.tax + Math.round(excess * MARGINAL_RATE_ABOVE_TABLE);
  } else {
    // Interpolate between brackets for accuracy
    for (let i = 1; i < SIMPLIFIED_TAX_TABLE.length; i++) {
      const prev = SIMPLIFIED_TAX_TABLE[i - 1];
      const curr = SIMPLIFIED_TAX_TABLE[i];
      if (monthlySalary <= curr.threshold) {
        const ratio =
          (monthlySalary - prev.threshold) /
          (curr.threshold - prev.threshold);
        tax = Math.round(prev.tax + ratio * (curr.tax - prev.tax));
        break;
      }
    }
  }

  // Apply dependents deduction (본인=1이므로 추가 부양가족분만 감면)
  const additionalDependents = Math.max(0, dependents - 1);
  const dependentsDeduction =
    additionalDependents * DEPENDENTS_DEDUCTION_PER_PERSON;
  tax = Math.max(0, tax - dependentsDeduction);

  return tax;
}

// ── Calculate payroll for a single employee ──

export interface PayrollOptions {
  nonTaxableAmount?: number; // 비과세 금액 (식대 200,000 등)
  dependents?: number;       // 부양가족 수 (본인 포함, 기본 1)
  industrialAccidentRate?: number; // 산재보험율 (기본 0.7%)
}

export function calculatePayroll(
  baseSalary: number,
  name: string,
  employeeId: string,
  options: PayrollOptions = {},
): PayrollItem {
  const {
    nonTaxableAmount = 0,
    dependents = 1,
    industrialAccidentRate = RATES.industrialAccident,
  } = options;

  // 비과세 차감 → 과세소득 산출
  const taxableIncome = Math.max(0, baseSalary - nonTaxableAmount);

  // 국민연금: 상한/하한 적용
  const pensionBase = Math.min(
    NATIONAL_PENSION_CEILING,
    Math.max(NATIONAL_PENSION_FLOOR, taxableIncome),
  );
  const np = Math.round(pensionBase * RATES.nationalPension);

  // 건강보험: 상한/하한 적용
  const healthBase = Math.min(
    HEALTH_INSURANCE_CEILING,
    Math.max(HEALTH_INSURANCE_FLOOR, taxableIncome),
  );
  const hi = Math.round(healthBase * RATES.healthInsurance);
  const ltc = Math.round(hi * RATES.longTermCare);

  // 고용보험
  const ei = Math.round(taxableIncome * RATES.employmentInsurance);

  // 소득세 (간이세액표 기반)
  const it = estimateIncomeTax(taxableIncome, dependents);

  // 지방소득세 = 소득세의 10%
  const lit = Math.round(it * 0.1);

  const deductions = np + hi + ltc + ei + it + lit;

  // 사업주 부담분 (직원 급여에서 차감하지 않음)
  const employerNp = np; // 국민연금 사업주 부담 = 직원분과 동일
  const employerHi = hi + ltc; // 건강보험 사업주 부담 = 직원분과 동일
  const employerEi = Math.round(taxableIncome * 0.0135); // 고용보험 사업주 1.35%
  const employerIa = Math.round(taxableIncome * industrialAccidentRate);
  const employerTotal = employerNp + employerHi + employerEi + employerIa;

  return {
    employeeId,
    employeeName: name,
    baseSalary,
    nonTaxableAmount,
    taxableIncome,
    nationalPension: np,
    healthInsurance: hi + ltc,
    employmentInsurance: ei,
    incomeTax: it,
    localIncomeTax: lit,
    deductionsTotal: deductions,
    netPay: baseSalary - deductions,
    employerCosts: {
      nationalPension: employerNp,
      healthInsurance: employerHi,
      employmentInsurance: employerEi,
      industrialAccident: employerIa,
      total: employerTotal,
    },
  };
}

// ── Calculate retirement pay (Korean Labor Standards Act) ──

/**
 * 퇴직금 계산 (근로기준법 기준)
 * 퇴직금 = (1일 평균임금 × 30일) × (총 재직일수 / 365)
 * 평균임금 = 퇴직 전 3개월 총 급여 / 퇴직 전 3개월 총 일수
 */
export function calculateRetirementPay(params: {
  startDate: string; // 입사일 YYYY-MM-DD
  endDate: string;   // 퇴사일 YYYY-MM-DD
  last3MonthsSalary: number; // 퇴직 전 3개월 총 급여 (세전)
  last3MonthsDays?: number;  // 퇴직 전 3개월 총 일수 (기본 90일)
}): { retirementPay: number; totalDays: number; dailyAvgWage: number; eligible: boolean } {
  const start = new Date(params.startDate);
  const end = new Date(params.endDate);
  const totalDays = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  const eligible = totalDays >= 365; // 1년 이상 근무
  const last3MonthsDays = params.last3MonthsDays || 90;
  const dailyAvgWage = params.last3MonthsSalary / last3MonthsDays;
  const retirementPay = eligible ? Math.round((dailyAvgWage * 30) * (totalDays / 365)) : 0;
  return { retirementPay, totalDays, dailyAvgWage, eligible };
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

  // Auto-send payslip emails for payroll batches
  const { data: batch } = await db
    .from('payment_batches')
    .select('batch_type, company_id, name')
    .eq('id', batchId)
    .single();

  if (batch?.batch_type === 'payroll') {
    // Fire and forget — don't block approval on email sending
    sendPayslipEmails(batchId, batch.company_id, batch.name).catch((err) => {
      console.error('Payslip email send failed:', err);
    });
  }
}

// ── Send payslip emails to all employees in a payroll batch ──

export async function sendPayslipEmails(
  batchId: string,
  companyId: string,
  batchName: string,
): Promise<{ sent: number; failed: number }> {
  // Get company name
  const { data: company } = await db
    .from('companies')
    .select('name')
    .eq('id', companyId)
    .single();

  // Get payment queue items linked to this batch
  const { data: payments } = await db
    .from('payment_queue')
    .select('amount, description, recipient_name, category')
    .eq('batch_id', batchId)
    .eq('payment_type', 'payroll');

  if (!payments?.length) return { sent: 0, failed: 0 };

  // Get employees with emails
  const { data: employees } = await db
    .from('employees')
    .select('id, name, email, salary, is_4_insurance')
    .eq('company_id', companyId)
    .eq('status', 'active');

  if (!employees?.length) return { sent: 0, failed: 0 };

  // Extract month label from batch name (e.g. "2026년 3월 급여" → "2026년 3월")
  const monthLabel = batchName.replace(/\s*급여\s*$/, '') || batchName;

  // Get auth session for EF call
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { sent: 0, failed: 0 };

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  let sent = 0;
  let failed = 0;

  for (const emp of employees) {
    if (!emp.email) { failed++; continue; }

    const salary = Number(emp.salary || 0);
    if (salary <= 0) { failed++; continue; }

    const payroll = calculatePayroll(salary, emp.name, emp.id);

    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/send-payslip-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          email: emp.email,
          employeeName: emp.name,
          companyName: company?.name || '',
          monthLabel,
          baseSalary: payroll.baseSalary,
          nationalPension: payroll.nationalPension,
          healthInsurance: payroll.healthInsurance,
          employmentInsurance: payroll.employmentInsurance,
          incomeTax: payroll.incomeTax,
          localIncomeTax: payroll.localIncomeTax,
          deductionsTotal: payroll.deductionsTotal,
          netPay: payroll.netPay,
        }),
      });
      if (res.ok) { sent++; } else { failed++; }
    } catch {
      failed++;
    }
  }

  return { sent, failed };
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
  const N8N_WEBHOOK_URL = process.env.NEXT_PUBLIC_N8N_PAYMENT_WEBHOOK;
  if (!N8N_WEBHOOK_URL) {
    await db.from('payment_batches').update({ status: 'failed' }).eq('id', batchId);
    return { triggered: false };
  }

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
