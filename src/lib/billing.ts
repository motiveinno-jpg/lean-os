/**
 * Reflect Billing Engine
 * 토스페이먼츠 결제 연동 + 구독 관리 + 인보이스
 */

import { supabase } from './supabase';

// 신규 테이블 타입이 아직 database.ts에 없으므로 any 캐스팅
const db = supabase as any;

// ── 토스페이먼츠 설정 ──
// 시크릿키는 서버사이드(Edge Function)에서만 사용 — 클라이언트 노출 금지
const TOSS_CLIENT_KEY = process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY || '';
const TOSS_API_URL = process.env.NEXT_PUBLIC_TOSS_API_URL || 'https://api.tosspayments.com/v1';

// ── 플랜 타입 정의 ──
export type PlanSlug = 'free' | 'starter' | 'business' | 'enterprise';

export interface PlanInfo {
  id: string;
  name: string;
  slug: PlanSlug;
  basePrice: number;
  perSeatPrice: number;
  maxSeats: number | null;
  features: string[];
}

export interface SubscriptionInfo {
  id: string;
  companyId: string;
  planSlug: PlanSlug;
  plan: PlanInfo | null;
  seatCount: number;
  billingCycle: 'monthly' | 'yearly';
  status: 'active' | 'paused' | 'canceled' | 'past_due' | 'trialing';
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelledAt: string | null;
  cancelReason: string | null;
  billingKey: string | null;
  createdAt: string;
}

export interface InvoiceRecord {
  id: string;
  companyId: string;
  subscriptionId: string | null;
  invoiceNumber: string;
  amount: number;
  status: 'draft' | 'issued' | 'paid' | 'overdue' | 'cancelled';
  description: string | null;
  issuedAt: string;
  paidAt: string | null;
}

// ── 연간 결제 할인율 ──
const ANNUAL_DISCOUNT_RATE = 0.2; // 20% 할인

// ── 1. 전체 플랜 목록 조회 ──
export async function getPlans(): Promise<PlanInfo[]> {
  const { data, error } = await db
    .from('subscription_plans')
    .select('*')
    .eq('is_active', true)
    .order('base_price', { ascending: true });

  if (error) throw error;

  return (data || []).map((row: any) => ({
    id: row.id,
    name: row.name,
    slug: row.slug as PlanSlug,
    basePrice: Number(row.base_price),
    perSeatPrice: Number(row.per_seat_price),
    maxSeats: row.max_seats ? Number(row.max_seats) : null,
    features: (row.features as string[]) || [],
  }));
}

// ── 2. 현재 구독 정보 조회 ──
export async function getCurrentSubscription(
  companyId: string
): Promise<SubscriptionInfo | null> {
  const { data, error } = await db
    .from('subscriptions')
    .select('*, subscription_plans(*)')
    .eq('company_id', companyId)
    .in('status', ['active', 'paused', 'past_due'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const plan = data.subscription_plans;
  const planSlug = plan?.slug || 'free';

  return {
    id: data.id,
    companyId: data.company_id,
    planSlug: planSlug as PlanSlug,
    plan: plan
      ? {
          id: plan.id,
          name: plan.name,
          slug: plan.slug as PlanSlug,
          basePrice: Number(plan.base_price),
          perSeatPrice: Number(plan.per_seat_price),
          maxSeats: plan.max_seats ? Number(plan.max_seats) : null,
          features: (plan.features as string[]) || [],
        }
      : null,
    seatCount: data.seat_count,
    billingCycle: data.billing_cycle as 'monthly' | 'yearly',
    status: data.status as SubscriptionInfo['status'],
    currentPeriodStart: data.current_period_start,
    currentPeriodEnd: data.current_period_end,
    cancelledAt: data.canceled_at || null,
    cancelReason: data.cancel_reason || null,
    billingKey: data.toss_billing_key || null,
    createdAt: data.created_at,
  };
}

// ── 3. 구독 생성 ──
export async function createSubscription(
  companyId: string,
  planSlug: PlanSlug,
  seatCount: number,
  billingCycle: 'monthly' | 'yearly'
): Promise<SubscriptionInfo> {
  // 플랜 정보 조회
  const plans = await getPlans();
  const plan = plans.find((p) => p.slug === planSlug);
  if (!plan) throw new Error(`플랜을 찾을 수 없습니다: ${planSlug}`);

  // 좌석 수 제한 검증
  if (plan.maxSeats && seatCount > plan.maxSeats) {
    throw new Error(`최대 좌석 수(${plan.maxSeats})를 초과했습니다`);
  }

  // 기간 계산
  const now = new Date();
  const periodEnd = new Date(now);
  if (billingCycle === 'yearly') {
    periodEnd.setFullYear(periodEnd.getFullYear() + 1);
  } else {
    periodEnd.setMonth(periodEnd.getMonth() + 1);
  }

  const { data, error } = await db
    .from('subscriptions')
    .insert({
      company_id: companyId,
      plan_id: plan.id,
      seat_count: seatCount,
      billing_cycle: billingCycle,
      status: 'active',
      current_period_start: now.toISOString(),
      current_period_end: periodEnd.toISOString(),
    })
    .select()
    .single();

  if (error) throw error;

  // 빌링 이벤트 기록
  await logBillingEvent(companyId, 'subscription_created', {
    planSlug,
    seatCount,
    billingCycle,
    subscriptionId: data.id,
  });

  return {
    id: data.id,
    companyId: data.company_id,
    planSlug: plan.slug,
    plan,
    seatCount: data.seat_count,
    billingCycle: data.billing_cycle as 'monthly' | 'yearly',
    status: data.status as SubscriptionInfo['status'],
    currentPeriodStart: data.current_period_start,
    currentPeriodEnd: data.current_period_end,
    cancelledAt: null,
    cancelReason: null,
    billingKey: null,
    createdAt: data.created_at,
  };
}

// ── IDOR 방어: 현재 사용자의 company_id 검증 ──
async function verifySubscriptionOwnership(subscriptionId: string): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('인증이 필요합니다');

  const { data: currentUser } = await supabase
    .from('users')
    .select('company_id')
    .eq('auth_id', user.id)
    .single();
  if (!currentUser || !currentUser.company_id) throw new Error('사용자 정보를 찾을 수 없습니다');

  const companyId: string = currentUser.company_id;

  const { data: sub } = await db
    .from('subscriptions')
    .select('company_id')
    .eq('id', subscriptionId)
    .single();
  if (!sub) throw new Error('구독을 찾을 수 없습니다');

  if (sub.company_id !== companyId) {
    throw new Error('권한이 없습니다');
  }

  return companyId;
}

// ── 4. 구독 변경 (플랜/좌석/주기) ──
export async function updateSubscription(
  subscriptionId: string,
  changes: {
    planSlug?: PlanSlug;
    seatCount?: number;
    billingCycle?: 'monthly' | 'yearly';
  }
): Promise<void> {
  // IDOR 방어: 본인 회사 구독인지 검증
  await verifySubscriptionOwnership(subscriptionId);

  // 현재 구독 확인
  const { data: current, error: fetchError } = await db
    .from('subscriptions')
    .select('*')
    .eq('id', subscriptionId)
    .single();

  if (fetchError) throw fetchError;
  if (!current) throw new Error('구독을 찾을 수 없습니다');

  const updatePayload: Record<string, unknown> = {};

  // 플랜 변경 시 plan_id 업데이트
  if (changes.planSlug) {
    const plans = await getPlans();
    const newPlan = plans.find((p) => p.slug === changes.planSlug);
    if (!newPlan) throw new Error(`플랜을 찾을 수 없습니다: ${changes.planSlug}`);

    // 좌석 수 제한 검증
    const newSeatCount = changes.seatCount || current.seat_count;
    if (newPlan.maxSeats && newSeatCount > newPlan.maxSeats) {
      throw new Error(`최대 좌석 수(${newPlan.maxSeats})를 초과했습니다`);
    }

    updatePayload.plan_id = newPlan.id;
  }

  if (changes.seatCount !== undefined) {
    updatePayload.seat_count = changes.seatCount;
  }

  if (changes.billingCycle) {
    updatePayload.billing_cycle = changes.billingCycle;
  }

  updatePayload.updated_at = new Date().toISOString();

  const { error } = await db
    .from('subscriptions')
    .update(updatePayload)
    .eq('id', subscriptionId);

  if (error) throw error;

  // 빌링 이벤트 기록
  await logBillingEvent(current.company_id, 'subscription_updated', {
    subscriptionId,
    changes,
    previousPlanId: current.plan_id,
    previousSeats: current.seat_count,
  });
}

// ── 5. 구독 취소 ──
export async function cancelSubscription(
  subscriptionId: string,
  reason: string
): Promise<void> {
  // IDOR 방어
  await verifySubscriptionOwnership(subscriptionId);

  const { data: current, error: fetchError } = await db
    .from('subscriptions')
    .select('company_id')
    .eq('id', subscriptionId)
    .single();

  if (fetchError) throw fetchError;

  const { error } = await db
    .from('subscriptions')
    .update({
      status: 'canceled',
      canceled_at: new Date().toISOString(),
      cancel_reason: reason,
    })
    .eq('id', subscriptionId);

  if (error) throw error;

  await logBillingEvent(current.company_id, 'subscription_cancelled', {
    subscriptionId,
    reason,
  });
}

// ── 6. 구독 일시정지 ──
export async function pauseSubscription(subscriptionId: string): Promise<void> {
  // IDOR 방어
  await verifySubscriptionOwnership(subscriptionId);

  const { data: current, error: fetchError } = await db
    .from('subscriptions')
    .select('company_id')
    .eq('id', subscriptionId)
    .single();

  if (fetchError) throw fetchError;

  const { error } = await db
    .from('subscriptions')
    .update({
      status: 'paused',
      updated_at: new Date().toISOString(),
    })
    .eq('id', subscriptionId);

  if (error) throw error;

  await logBillingEvent(current.company_id, 'subscription_paused', {
    subscriptionId,
  });
}

// ── 7. 구독 재개 ──
export async function resumeSubscription(subscriptionId: string): Promise<void> {
  // IDOR 방어
  await verifySubscriptionOwnership(subscriptionId);

  const { data: current, error: fetchError } = await db
    .from('subscriptions')
    .select('company_id')
    .eq('id', subscriptionId)
    .single();

  if (fetchError) throw fetchError;

  const { error } = await db
    .from('subscriptions')
    .update({
      status: 'active',
      updated_at: new Date().toISOString(),
    })
    .eq('id', subscriptionId);

  if (error) throw error;

  await logBillingEvent(current.company_id, 'subscription_resumed', {
    subscriptionId,
  });
}

// ── 8. 인보이스 생성 ──
export async function createInvoice(
  companyId: string,
  subscriptionId: string | null,
  amount: number,
  description: string
): Promise<InvoiceRecord> {
  const invoiceNumber = await generateInvoiceNumber();

  const { data, error } = await db
    .from('invoices')
    .insert({
      company_id: companyId,
      subscription_id: subscriptionId,
      invoice_number: invoiceNumber,
      amount,
      description,
      status: 'pending',
    })
    .select()
    .single();

  if (error) throw error;

  await logBillingEvent(companyId, 'invoice_created', {
    invoiceId: data.id,
    invoiceNumber,
    amount,
  });

  return {
    id: data.id,
    companyId: data.company_id,
    subscriptionId: data.subscription_id || null,
    invoiceNumber: data.invoice_number,
    amount: Number(data.amount),
    status: data.status as InvoiceRecord['status'],
    description: data.description || null,
    issuedAt: data.created_at,
    paidAt: data.paid_at || null,
  };
}

// ── 9. 인보이스 목록 조회 ──
export async function getInvoices(companyId: string): Promise<InvoiceRecord[]> {
  const { data, error } = await db
    .from('invoices')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });

  if (error) throw error;

  return (data || []).map((row: any) => ({
    id: row.id,
    companyId: row.company_id,
    subscriptionId: row.subscription_id || null,
    invoiceNumber: row.invoice_number,
    amount: Number(row.amount),
    status: row.status as InvoiceRecord['status'],
    description: row.description || null,
    issuedAt: row.created_at,
    paidAt: row.paid_at || null,
  }));
}

// ── 10. 인보이스 번호 생성 (INV-YYYYMM-XXXX) ──
export async function generateInvoiceNumber(): Promise<string> {
  const now = new Date();
  const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const prefix = `INV-${yearMonth}`;

  // 해당 월의 마지막 인보이스 번호 조회
  const { data } = await db
    .from('invoices')
    .select('invoice_number')
    .like('invoice_number', `${prefix}-%`)
    .order('invoice_number', { ascending: false })
    .limit(1)
    .maybeSingle();

  let seq = 1;
  if (data?.invoice_number) {
    // INV-YYYYMM-XXXX에서 XXXX 추출
    const lastSeq = parseInt(data.invoice_number.split('-').pop() || '0', 10);
    seq = lastSeq + 1;
  }

  return `${prefix}-${String(seq).padStart(4, '0')}`;
}

// ── 11. 빌링 이벤트 로깅 ──
export async function logBillingEvent(
  companyId: string,
  eventType: string,
  metadata: Record<string, unknown>
): Promise<void> {
  const { error } = await db.from('billing_events').insert({
    company_id: companyId,
    event_type: eventType,
    metadata,
    created_at: new Date().toISOString(),
  });

  // 로깅 실패는 치명적이지 않으므로 콘솔 경고만
  if (error) {
    console.warn('빌링 이벤트 로깅 실패:', error.message);
  }
}

// ── 12. 월간 요금 계산 (연간 할인 적용) ──
export function calculateMonthlyTotal(
  planSlug: PlanSlug,
  seatCount: number,
  billingCycle: 'monthly' | 'yearly',
  plans: PlanInfo[]
): number {
  // free 플랜은 항상 0원
  if (planSlug === 'free') return 0;

  const plan = plans.find((p) => p.slug === planSlug);
  if (!plan) return 0;

  // 기본 요금 + (좌석 수 × 좌석당 가격)
  const monthlyBase = plan.basePrice + plan.perSeatPrice * seatCount;

  // 연간 결제 시 20% 할인
  if (billingCycle === 'yearly') {
    return Math.round(monthlyBase * (1 - ANNUAL_DISCOUNT_RATE));
  }

  return monthlyBase;
}

// ── 13. 기능 접근 권한 확인 ──
export async function checkFeatureAccess(
  companyId: string,
  feature: string
): Promise<boolean> {
  const subscription = await getCurrentSubscription(companyId);

  // 구독 없으면 free 플랜 기능만 허용
  if (!subscription || !subscription.plan) {
    const plans = await getPlans();
    const freePlan = plans.find((p) => p.slug === 'free');
    return freePlan?.features.includes(feature) || false;
  }

  return subscription.plan.features.includes(feature);
}

// ── 14. 사용량 제한 조회 ──
export interface UsageLimits {
  maxSeats: number | null;
  maxProjects: number;
  maxSignatures: number;
  maxAiCalls: number;
  maxStorageMb: number;
}

// 플랜별 기본 제한 (DB에 없을 경우 폴백)
const PLAN_LIMITS: Record<PlanSlug, UsageLimits> = {
  free: {
    maxSeats: 3,
    maxProjects: 2,
    maxSignatures: 5,
    maxAiCalls: 50,
    maxStorageMb: 100,
  },
  starter: {
    maxSeats: 10,
    maxProjects: 10,
    maxSignatures: 50,
    maxAiCalls: 500,
    maxStorageMb: 1024,
  },
  business: {
    maxSeats: 50,
    maxProjects: 100,
    maxSignatures: 500,
    maxAiCalls: 5000,
    maxStorageMb: 10240,
  },
  enterprise: {
    maxSeats: null, // 무제한
    maxProjects: 9999,
    maxSignatures: 9999,
    maxAiCalls: 99999,
    maxStorageMb: 102400,
  },
};

export async function getUsageLimits(companyId: string): Promise<UsageLimits> {
  const subscription = await getCurrentSubscription(companyId);
  const planSlug = subscription?.planSlug || 'free';

  return PLAN_LIMITS[planSlug] || PLAN_LIMITS.free;
}

// ── 15. 토스페이먼츠 결제 초기화 (클라이언트 SDK용 파라미터 생성) ──
export interface TossPaymentParams {
  clientKey: string;
  orderId: string;
  amount: number;
  orderName: string;
  successUrl: string;
  failUrl: string;
}

export function initTossPayment(
  orderId: string,
  amount: number,
  orderName: string
): TossPaymentParams {
  if (!TOSS_CLIENT_KEY) {
    throw new Error('토스페이먼츠 클라이언트 키가 설정되지 않았습니다');
  }

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';

  return {
    clientKey: TOSS_CLIENT_KEY,
    orderId,
    amount,
    orderName,
    successUrl: `${baseUrl}/billing/success`,
    failUrl: `${baseUrl}/billing/fail`,
  };
}

// ── 16. 토스페이먼츠 결제 승인 (서버 사이드 / Edge Function용) ──
export interface TossPaymentConfirmation {
  paymentKey: string;
  orderId: string;
  amount: number;
  status: string;
  method: string;
  approvedAt: string;
  receipt: { url: string } | null;
}

/**
 * 토스 결제 승인 — 반드시 서버사이드(Edge Function)에서 호출
 * 클라이언트에서 직접 호출 금지 (시크릿키 노출 위험)
 */
export async function confirmTossPayment(
  paymentKey: string,
  orderId: string,
  amount: number
): Promise<TossPaymentConfirmation> {
  // Edge Function을 통해 결제 승인 (시크릿키는 서버에서만 사용)
  const { data, error } = await db.functions.invoke('confirm-toss-payment', {
    body: { paymentKey, orderId, amount },
  });

  if (error) {
    throw new Error(`토스 결제 승인 실패: ${error.message}`);
  }

  return data as TossPaymentConfirmation;
}

// ── 17. 토스 빌링키 저장 (자동결제용) ──
export async function saveBillingKey(
  subscriptionId: string,
  customerKey: string,
  billingKey: string
): Promise<void> {
  const { data: sub, error: fetchError } = await db
    .from('subscriptions')
    .select('company_id')
    .eq('id', subscriptionId)
    .single();

  if (fetchError) throw fetchError;

  const { error } = await db
    .from('subscriptions')
    .update({
      toss_billing_key: billingKey,
      toss_customer_key: customerKey,
      updated_at: new Date().toISOString(),
    })
    .eq('id', subscriptionId);

  if (error) throw error;

  await logBillingEvent(sub.company_id, 'billing_key_saved', {
    subscriptionId,
    customerKey,
  });
}
