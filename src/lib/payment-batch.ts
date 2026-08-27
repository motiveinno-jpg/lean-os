import { logRead } from "@/lib/log-read";
/**
 * OwnerView Payment Batch Engine
 * 급여/고정비 일괄 배치 → 대표 승인 → n8n 트리거 자동이체
 */

import { supabase } from './supabase';
import { createQueueEntry } from './payment-queue';
import { getRecurringPayments } from './approval-center';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase;

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

// v4 H1: 임의 수당/공제 항목 — payroll_items.extras jsonb 에 저장.
//   auto: 근태 집계(allowance_entries)에서 자동으로 얹힌 줄 — 화면에 '근태 집계' 출처를 적는다 (2026-08-27 인사 H1)
export type PayrollExtra = {
  type: 'allowance' | 'deduction';
  name: string;       // '식대' / '직책수당' / '사내대출' 등
  amount: number;     // 양수
  auto?: boolean;
};

export interface PayrollItem {
  employeeId: string;
  employeeName: string;
  baseSalary: number;
  nonTaxableAmount: number;
  taxableIncome: number;
  nationalPension: number;
  healthInsurance: number;
  longTermCareInsurance?: number; // 장기요양보험 (건강보험과 별도 표시)
  employmentInsurance: number;
  incomeTax: number;
  localIncomeTax: number;
  deductionsTotal: number;
  netPay: number;
  // v4 H1: 임의 수당/공제 (선택)
  extras?: PayrollExtra[];
  employerCosts: {
    nationalPension: number;
    healthInsurance: number;
    longTermCareInsurance?: number; // 장기요양보험 사업주 부담분
    employmentInsurance: number;
    industrialAccident: number;
    total: number;
  };
}

// v4 H1: extras 합산 헬퍼 (UI/PDF 공통 사용)
export function sumExtras(extras?: PayrollExtra[]): { allowance: number; deduction: number; net: number } {
  if (!extras || extras.length === 0) return { allowance: 0, deduction: 0, net: 0 };
  let allowance = 0, deduction = 0;
  for (const e of extras) {
    const amt = Math.max(0, Number(e.amount) || 0);
    if (e.type === 'allowance') allowance += amt;
    else deduction += amt;
  }
  return { allowance, deduction, net: allowance - deduction };
}

// ── Korean Social Insurance Rates (2026) ──

const RATES = {
  nationalPension: 0.045,       // 국민연금 4.5% (직원분)
  healthInsurance: 0.03545,     // 건강보험 3.545% (직원분)
  longTermCare: 0.1295,         // 장기요양 건강보험의 12.95%
  employmentInsurance: 0.009,   // 고용보험 0.9% (직원분)
  industrialAccident: 0.007,    // 산재보험 0.7% (사업주 부담)
};

// 국민연금 상한/하한 (2025년 7월~2026년 6월 기준, 매년 7월 조정됨)
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
  // 2026-05-22 과세 대상 임의수당 합 — 소득세·4대보험 과세소득에 가산.
  //   (비과세 수당은 nonTaxableAmount 로 따로 처리)
  taxableAllowance?: number;
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
    taxableAllowance = 0,
  } = options;

  // 2026-05-22 (사장님 확정) 기본급 모델: baseSalary = 과세 기본급, nonTaxableAmount = 별도 비과세(식대).
  //   지급총액 = baseSalary + nonTaxableAmount (예: 기본급 230 + 식대 20 = 250).
  //   과세소득 = 과세 기본급 + 과세 수당 (비과세는 차감 대상이 아니라 애초에 과세에 미포함).
  const taxableIncome = Math.max(0, baseSalary + taxableAllowance);
  // 지급총액 (세전) = 과세 기본급 + 비과세
  const grossPay = baseSalary + nonTaxableAmount;

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
    healthInsurance: hi,
    longTermCareInsurance: ltc,
    employmentInsurance: ei,
    incomeTax: it,
    localIncomeTax: lit,
    deductionsTotal: deductions,
    netPay: grossPay - deductions, // 지급총액(기본급+비과세) - 공제
    employerCosts: {
      nationalPension: employerNp,
      healthInsurance: employerHi - ltc, // 건강보험 사업주 부담 (장기요양 제외)
      longTermCareInsurance: ltc, // 장기요양보험 사업주 부담
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
  // +1 — 재직일수는 입사일·퇴사일 양 끝 포함 (2026-08-19 감사: 만 1년(365일) 근무자가
  //   364일로 계산돼 퇴직금 0원으로 표시됐다. tools 퇴직금 계산기와도 어긋났음)
  const totalDays = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  const eligible = totalDays >= 365; // 1년 이상 근무
  // 직전 3개월 실제 일수 (89~92일) — 90 고정이면 5/31 퇴직(92일) 시 평균임금이 2.2% 과다.
  const calc3mDays = (() => {
    // "3개월 전 같은 날"을 월말로 클램프 후 +1일 — setMonth 오버플로(5/31→2/31→3/3) 방지.
    //   예: 퇴직 5/31 → 산정기간 3/1~5/31 = 92일, 퇴직 8/18 → 5/19~8/18 = 92일.
    const y = end.getUTCFullYear(), m = end.getUTCMonth(), d = end.getUTCDate();
    const lastDayOf3mAgo = new Date(Date.UTC(y, m - 2, 0)).getUTCDate();   // (m-3)월의 말일
    const from = new Date(Date.UTC(y, m - 3, Math.min(d, lastDayOf3mAgo)));
    from.setUTCDate(from.getUTCDate() + 1);
    const days = Math.round((end.getTime() - from.getTime()) / 86_400_000) + 1;
    return days > 0 ? days : 90;
  })();
  const last3MonthsDays = params.last3MonthsDays || calc3mDays;
  const dailyAvgWage = params.last3MonthsSalary / last3MonthsDays;
  const retirementPay = eligible ? Math.round((dailyAvgWage * 30) * (totalDays / 365)) : 0;
  return { retirementPay, totalDays, dailyAvgWage, eligible };
}

// ── Create fixed cost batch from recurring payments ──

export async function createFixedCostBatch(companyId: string, monthLabel?: string): Promise<{ batchId: string; count: number; totalAmount: number }> {
  const label = monthLabel || `${new Date().getFullYear()}년 ${new Date().getMonth() + 1}월`;
  const batchName = `${label} 고정비`;

  const recurring = await getRecurringPayments(companyId);
  const active = recurring.filter((r: any) => r.is_active);

  if (active.length === 0) throw new Error('활성 반복결제가 없습니다');

  const totalAmount = active.reduce((s: number, r: any) => s + Number(r.amount || 0), 0);

  // 같은 월의 기존 draft/pending_approval 배치가 있으면 그것 + queue items 삭제 (1개로 통합).
  // 이미 approved/executing/completed 면 그대로 유지하고 새 batch 생성.
  const existing = logRead('lib/payment-batch:existing', await db
    .from('payment_batches')
    .select('id, status')
    .eq('company_id', companyId)
    .eq('batch_type', 'fixed_cost')
    .eq('name', batchName)
    .in('status', ['draft', 'pending_approval']));

  for (const old of (existing || [])) {
    await db.from('payment_queue').delete().eq('batch_id', old.id);
    await db.from('payment_batches').delete().eq('id', old.id);
  }

  // Create batch
  const { data: batch, error: batchError } = await db
    .from('payment_batches')
    .insert({
      company_id: companyId,
      name: batchName,
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
  const batch = logRead('lib/payment-batch:batch', await db
    .from('payment_batches')
    .select('batch_type, company_id, name')
    .eq('id', batchId)
    .single());

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
  options?: { employeeIds?: string[] },
): Promise<{ sent: number; failed: number; errors?: string[] }> {
  // Get company name + representative
  const company = logRead('lib/payment-batch:company', await db
    .from('companies')
    .select('name, representative, business_number, address, seal_url')
    .eq('id', companyId)
    .single());

  // batch 모드(batchId='preview')는 payment_queue skip — preview 모드도 발송 가능
  const previewMode = batchId === 'preview';
  if (!previewMode) {
    const payments = logRead('lib/payment-batch:payments', await db
      .from('payment_queue')
      .select('amount')
      .eq('batch_id', batchId)
      .eq('payment_type', 'payroll'));
    if (!payments?.length) return { sent: 0, failed: 0 };
  }

  // 직원 조회 — birth_date 포함 (PDF 비밀번호용)
  let q = db
    .from('employees')
    .select('id, name, email, salary, is_4_insurance, meal_allowance_included, birth_date, department, position, bank_account, bank_name')
    .eq('company_id', companyId)
    .in('status', ['active', 'joined', 'invited']);
  if (options?.employeeIds && options.employeeIds.length > 0) {
    q = q.in('id', options.employeeIds);
  }
  const { data: employees } = await q;

  if (!employees?.length) return { sent: 0, failed: 0 };

  // Extract month label from batch name (e.g. "2026년 3월 급여" → "2026년 3월")
  const monthLabel = batchName.replace(/\s*급여\s*$/, '') || batchName;

  // 월별 명세서 수정값(override) — "YYYY년 M월" → "YYYY-MM" 로 변환 후 조회
  const monthMatch = monthLabel.match(/(\d{4})\s*년\s*(\d{1,2})\s*월/);
  const monthKey = monthMatch
    ? `${monthMatch[1]}-${String(Number(monthMatch[2])).padStart(2, '0')}`
    : null;

  // Get auth session for EF call
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { sent: 0, failed: 0 };

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  let sent = 0;
  let failed = 0;
  const errors: string[] = [];

  // PDF 생성기 + 미리보기 엔진 동적 import — 번들 분리 + 순환참조 회피
  const { generatePayslipPDF, birthDateToPassword } = await import('./payslip-pdf');
  const { previewPayroll } = await import('./payroll');

  // 2026-05-22 메일 PDF = 화면 단일 진실.
  //   기존엔 calculatePayroll 을 재호출(extras 미반영) → 화면·다운로드 PDF 와 금액 불일치.
  //   이제 화면이 쓰는 previewPayroll(임의 수당/공제 extras 반영) item 을 그대로 발송.
  const preview = await previewPayroll(companyId, monthKey || undefined);
  let payItems = preview.items;
  if (options?.employeeIds && options.employeeIds.length > 0) {
    const set = new Set(options.employeeIds);
    payItems = payItems.filter((it) => set.has(it.employeeId));
  }

  // 직원 메타(email/생년월일/부서/직책) 맵 — PDF 비밀번호·헤더용
  const empMeta = new Map<string, any>();
  for (const e of employees as any[]) empMeta.set(e.id, e);

  for (const item of payItems) {
    const emp = empMeta.get(item.employeeId);
    if (!emp) { continue; }
    if (!emp.email) { failed++; errors.push(`${item.employeeName}: 이메일 없음`); continue; }

    // PDF 생성 — 비밀번호 = 생년월일 (YYYYMMDD)
    const password = birthDateToPassword(emp.birth_date);
    let pdfBase64: string | undefined;
    try {
      const doc = await generatePayslipPDF({
        item, // ← previewPayroll 산출 item (화면과 동일). extras 는 PDF 가 직접 분해.
        companyName: company?.name || '',
        representative: (company as any)?.representative || undefined,
        businessNumber: (company as any)?.business_number || undefined,
        companyAddress: (company as any)?.address || undefined,
        sealUrl: (company as any)?.seal_url || undefined,
        periodLabel: monthLabel,
        department: emp.department || undefined,
        position: emp.position || undefined,
        employeeCode: emp.id ? String(emp.id).slice(-4).toUpperCase() : undefined,
        birthDate: emp.birth_date || undefined,
        password,
      });
      // jsPDF 의 base64 output
      const dataUri = doc.output('datauristring');
      pdfBase64 = dataUri.split(',')[1]; // "data:application/pdf;base64,..." → base64 only
    } catch (e: any) {
      errors.push(`${item.employeeName}: PDF 생성 실패 ${e.message || ''}`);
      // PDF 없이 계속 진행하면 첨부 없는 빈 메일이 나가고 발급 기록까지 'issued'로 박제된다
      //   (2026-08-19 감사). 이 직원은 발송을 건너뛰고 실패로 남긴다 — 재시도 시 다시 시도됨.
      continue;
    }

    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/send-payslip-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          email: emp.email,
          employeeName: item.employeeName,
          companyName: company?.name || '',
          monthLabel,
          // 2026-05-22 본문에서 급여 금액 전부 제거 — PDF(비밀번호 보호) 첨부만 발송.
          //   금액 필드를 보내지 않으므로 메일 본문엔 수령자 안내 + 비밀번호 안내만 노출.
          pdfBase64,
          pdfFilename: `급여명세서_${item.employeeName}_${monthLabel.replace(/[^\w]/g, '')}.pdf`,
          hasPassword: !!password,
        }),
      });
      if (res.ok) {
        sent++;
        // 발급 기록 — 직원 마이페이지 '내 급여명세서'의 유일한 소스 (2026-08-06).
        //   메일만 보내고 아무 기록도 남기지 않아 직원 화면이 늘 비어 있던 문제.
        //   발송한 그 순간의 금액을 그대로 박제한다(이후 관리자가 명세를 고쳐도 발급본은 불변).
        //   실패해도 발송 자체는 성공이므로 메일 결과를 뒤집지 않는다.
        if (monthKey) {
          await db.from('payroll_items').upsert({
            company_id: companyId,
            employee_id: item.employeeId,
            period_month: monthKey,
            base_salary: item.baseSalary,
            non_taxable_amount: item.nonTaxableAmount,
            national_pension: item.nationalPension,
            health_insurance: item.healthInsurance,
            //   장기요양은 공제 합계에 들어가는 별도 항목 — 스냅샷에도 남겨야 명세서 항목합이 맞는다 (2026-08-21)
            long_term_care_insurance: item.longTermCareInsurance || 0,
            employment_insurance: item.employmentInsurance,
            income_tax: item.incomeTax,
            local_income_tax: item.localIncomeTax,
            deductions_total: item.deductionsTotal,
            net_pay: item.netPay,
            extras: item.extras || [],
            bank_account: emp.bank_account || null,
            bank_name: emp.bank_name || null,
            status: 'issued',
            issued_at: new Date().toISOString(),
          }, { onConflict: 'employee_id,period_month' })
            .then(({ error }) => { if (error) errors.push(`${item.employeeName}: 발급기록 저장 실패 ${error.message}`); });
        }
      }
      else {
        failed++;
        const errBody = await res.text().catch(() => '');
        errors.push(`${item.employeeName}: HTTP ${res.status} ${errBody.slice(0, 200)}`);
      }
    } catch (e: any) {
      failed++;
      errors.push(`${item.employeeName}: ${e.message || 'fetch 실패'}`);
    }
  }

  return { sent, failed, errors: errors.length > 0 ? errors : undefined };
}

// ── Trigger batch execution via n8n webhook ──

export async function triggerBatchExecution(batchId: string): Promise<{ triggered: boolean; executionId?: string }> {
  // Get batch details
  const batch = logRead('lib/payment-batch:batch', await db
    .from('payment_batches')
    .select('*')
    .eq('id', batchId)
    .single());

  if (!batch || batch.status !== 'approved') {
    return { triggered: false };
  }

  // Get linked payments
  const payments = logRead('lib/payment-batch:payments', await db
    .from('payment_queue')
    .select('id, amount, description, recipient_name, recipient_account, recipient_bank')
    .eq('batch_id', batchId)
    .eq('status', 'approved'));

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
  const batch = logRead('lib/payment-batch:batch', await db
    .from('payment_batches')
    .select('*, users:approved_by(name)')
    .eq('id', batchId)
    .single());

  const items = logRead('lib/payment-batch:items', await db
    .from('payment_queue')
    .select('*')
    .eq('batch_id', batchId)
    .order('created_at'));

  return { batch, items: items || [] };
}
