import { logRead } from "@/lib/log-read";
import { todayKst } from "@/lib/kst";
/**
 * OwnerView Billing Engine
 * Stripe 결제 연동 + 구독 관리 + 인보이스
 */

import { supabase } from './supabase';

// 신규 테이블 타입이 아직 database.ts에 없으므로 any 캐스팅
const db = supabase;

// ── 플랜 타입 정의 ──
export type PlanSlug = 'free' | 'starter' | 'basic' | 'business' | 'ultra' | 'pro' | 'enterprise';

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

// ── 1.5 출시 게이트: 구독 상태 요약 (app-shell 배너/페이월용, 2026-06-11) ──
//   getCurrentSubscription 은 trialing 을 제외하므로 게이트 판단엔 부적합 — 전용 경량 조회.
export interface SubscriptionGateInfo {
  state: 'active' | 'trialing' | 'trial_expired' | 'past_due' | 'canceled' | 'expired' | 'none';
  daysLeft: number | null; // trialing: 체험 종료까지 / canceled(기간잔존): 종료까지
  planName: string | null;
  blocked: boolean; // 하드 페이월 대상 (trial 만료 · 해지 후 기간 종료 · 결제 기간 만료)
}

// active 상태의 결제 기간 만료 유예 — 정상 갱신은 Stripe webhook(customer.subscription.updated)이
// current_period_end 를 연장해 주므로, 이 유예는 webhook 지연·일시 장애 흡수용.
const PERIOD_EXPIRY_GRACE_MS = 3 * 86400000;

export async function getSubscriptionGate(companyId: string): Promise<SubscriptionGateInfo> {
  const { data, error } = await db
    .from('subscriptions')
    .select('status, trial_ends_at, current_period_end, subscription_plans(name)')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  // 조회 실패 / 구독 행 없음(레거시 회사) → 잠그지 않음 (오차단이 최악의 실패 모드)
  if (error || !data) return { state: 'none', daysLeft: null, planName: null, blocked: false };

  const planName = data.subscription_plans?.name ?? null;
  const status = String(data.status || '');
  const now = Date.now();

  if (status === 'trialing') {
    const ends = data.trial_ends_at ? new Date(data.trial_ends_at).getTime() : null;
    if (ends && ends < now) return { state: 'trial_expired', daysLeft: 0, planName, blocked: true };
    const daysLeft = ends ? Math.max(0, Math.ceil((ends - now) / 86400000)) : null;
    return { state: 'trialing', daysLeft, planName, blocked: false };
  }
  if (status === 'past_due') {
    // 결제 실패 — dunning 은 Stripe 가 진행. 앱은 경고 배너만 (즉시 차단 X)
    return { state: 'past_due', daysLeft: null, planName, blocked: false };
  }
  if (status === 'canceled') {
    const end = data.current_period_end ? new Date(data.current_period_end).getTime() : null;
    if (end && end > now) {
      // 해지했지만 결제 기간 잔존 → 기간 끝까지 사용 허용
      return { state: 'active', daysLeft: Math.ceil((end - now) / 86400000), planName, blocked: false };
    }
    return { state: 'canceled', daysLeft: null, planName, blocked: true };
  }
  // active / paused 등 — 기간 만료 검사 (2026-07-20 P0: status 만 보고 통과시키면
  // 수동으로 active 처리된 행이 영구 무료가 됨). 기간 정보가 없는 행은 잠그지 않음.
  const periodEnd = data.current_period_end ? new Date(data.current_period_end).getTime() : null;
  if (periodEnd && now > periodEnd + PERIOD_EXPIRY_GRACE_MS) {
    return { state: 'expired', daysLeft: null, planName, blocked: true };
  }
  return { state: 'active', daysLeft: null, planName, blocked: false };
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
    currentPeriodStart: data.current_period_start ?? '',
    currentPeriodEnd: data.current_period_end ?? '',
    cancelledAt: data.canceled_at || null,
    cancelReason: data.cancel_reason || null,
    billingKey: data.stripe_customer_id || null,
    createdAt: data.created_at ?? '',
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
    currentPeriodStart: data.current_period_start ?? '',
    currentPeriodEnd: data.current_period_end ?? '',
    cancelledAt: null,
    cancelReason: null,
    billingKey: null,
    createdAt: data.created_at ?? '',
  };
}

// ── 3-B. 신규 가입용 Trialing 구독 생성 (14일 무료) ──
// 런칭 블로커: 4,000개사 정부사업 배포 시 모든 신규 가입자는 starter 플랜으로 14일 체험 시작.
// 실패해도 가입 플로우는 계속 진행 (best-effort).
export async function createTrialingSubscription(
  companyId: string,
  planSlug: PlanSlug = 'starter',
  trialDays: number = 14,
): Promise<void> {
  const { data: plan, error: planErr } = await db
    .from('subscription_plans')
    .select('id, slug')
    .eq('slug', planSlug)
    .maybeSingle();

  if (planErr || !plan) {
    console.warn('Trialing 플랜 조회 실패:', planErr?.message);
    return;
  }

  const now = new Date();
  const trialEnd = new Date(now);
  trialEnd.setDate(trialEnd.getDate() + trialDays);

  const { error } = await db.from('subscriptions').insert({
    company_id: companyId,
    plan_id: plan.id,
    plan_slug: plan.slug,
    status: 'trialing',
    seat_count: 1,
    billing_cycle: 'monthly',
    current_period_start: now.toISOString(),
    current_period_end: trialEnd.toISOString(),
    trial_ends_at: trialEnd.toISOString(),
  });

  if (error) {
    console.warn('Trialing 구독 생성 실패:', error.message);
    return;
  }

  await logBillingEvent(companyId, 'trial_started', {
    planSlug: plan.slug,
    trialDays,
    trialEndsAt: trialEnd.toISOString(),
  });
}

// ── IDOR 방어: 현재 사용자의 company_id 검증 ──
async function verifySubscriptionOwnership(subscriptionId: string): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('인증이 필요합니다');

  const currentUser = logRead('lib/billing:currentUser', await supabase
    .from('users')
    .select('company_id')
    .eq('auth_id', user.id)
    .single());
  if (!currentUser || !currentUser.company_id) throw new Error('사용자 정보를 찾을 수 없습니다');

  const companyId: string = currentUser.company_id;

  const sub = logRead('lib/billing:sub', await db
    .from('subscriptions')
    .select('company_id')
    .eq('id', subscriptionId)
    .single());
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
    .update(updatePayload as never)
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
      total_amount: amount, // 2026-07-20: NOT NULL 컬럼 누락으로 insert 가 항상 400 이었음
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
    invoiceNumber: data.invoice_number ?? '',
    amount: Number(data.amount),
    status: data.status as InvoiceRecord['status'],
    description: data.description || null,
    issuedAt: data.created_at ?? '',
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
  const data = logRead('lib/billing:data', await db
    .from('invoices')
    .select('invoice_number')
    .like('invoice_number', `${prefix}-%`)
    .order('invoice_number', { ascending: false })
    .limit(1)
    .maybeSingle());

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
    metadata: metadata as never,
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
const PLAN_LIMITS: Partial<Record<PlanSlug, UsageLimits>> = {
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

  return PLAN_LIMITS[planSlug] || PLAN_LIMITS.free!;
}

// ── 14.5 세금계산서 / 현금영수증 국세청 발행 월간 한도 조회 (요금제별 차등, NULL=무제한) ──
export interface IssuanceLimitStatus {
  limit: number | null; // null = 무제한
  used: number;
  remaining: number | null;
  planName: string | null;
}

export async function getTaxInvoiceIssuanceStatus(companyId: string): Promise<IssuanceLimitStatus> {
  const subRow = logRead('lib/billing:subRow', await db
    .from('subscriptions')
    .select('subscription_plans(name, monthly_tax_invoice_limit)')
    .eq('company_id', companyId)
    .in('status', ['active', 'trialing', 'paused', 'past_due'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle());
  const limit = subRow?.subscription_plans?.monthly_tax_invoice_limit ?? null;
  const planName = subRow?.subscription_plans?.name ?? null;
  if (limit === null) return { limit: null, used: 0, remaining: null, planName };

  // KST 기준 이달 1일 0시 (nts_issued_at 은 timestamptz — 오프셋 붙인 ISO 로 비교).
  //   기존 UTC 월경계는 월초 9시간(00~09시 KST)이 전월로 잡혀 한도가 어긋나던 버그 — 현금영수증 카운트와 동일하게 KST 통일.
  const monthStart = `${todayKst().slice(0, 7)}-01T00:00:00+09:00`;
  const { count } = await db
    .from('tax_invoices')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .eq('nts_issue_status', 'issued')
    .gte('nts_issued_at', monthStart);
  const used = count || 0;
  return { limit, used, remaining: Math.max(0, limit - used), planName };
}

export async function getCashReceiptIssuanceStatus(companyId: string): Promise<IssuanceLimitStatus> {
  const subRow = logRead('lib/billing:subRow', await db
    .from('subscriptions')
    .select('subscription_plans(name, monthly_cashbill_limit)')
    .eq('company_id', companyId)
    .in('status', ['active', 'trialing', 'paused', 'past_due'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle());
  const limit = subRow?.subscription_plans?.monthly_cashbill_limit ?? null;
  const planName = subRow?.subscription_plans?.name ?? null;
  if (limit === null) return { limit: null, used: 0, remaining: null, planName };

  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const { count } = await db
    .from('cash_receipts')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .eq('source', 'codef')
    .neq('status', 'cancelled')
    .gte('issue_date', monthStart);
  const used = count || 0;
  return { limit, used, remaining: Math.max(0, limit - used), planName };
}

// ── 15. Stripe Checkout 세션 생성 요청 (클라이언트에서 API route 호출) ──
export async function createStripeCheckout(
  planSlug: string,
  companyId: string,
  billingCycle: 'monthly' | 'annual',
): Promise<string> {
  const response = await fetch('/api/stripe/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      planSlug,
      companyId,
      billingCycle,
      successUrl: `${window.location.origin}/billing?payment=success`,
      cancelUrl: `${window.location.origin}/billing?payment=cancel`,
    }),
  });

  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error?.message || '결제 세션 생성 실패');
  }

  return result.data.url;
}

// ── 16. Stripe Billing Portal 세션 생성 요청 ──
export async function openStripeBillingPortal(companyId: string): Promise<string> {
  const response = await fetch('/api/stripe/portal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      companyId,
      returnUrl: `${window.location.origin}/billing`,
    }),
  });

  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error?.message || 'Billing portal 생성 실패');
  }

  return result.data.url;
}
