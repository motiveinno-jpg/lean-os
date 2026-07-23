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
  basePrice: number;      // 할인 적용가(기본 좌석 포함, VAT 별도)
  perSeatPrice: number;   // 추가 좌석 1명당(기본 좌석 초과분)
  maxSeats: number | null;
  features: string[];
  listPrice: number | null; // 정상가(취소선 표시용)
  includedSeats: number;    // 기본 포함 좌석 수(이 수 초과분만 per_seat 과금)
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
  // 해지 예약(cancel_at_period_end=true) — active 유지, effectiveUntil 까지 기존 플랜, 이후 Free.
  cancelAtPeriodEnd: boolean;
  effectiveUntil: string | null;
  displayStatus: string;
  // entitlement 기반 실권한 — 기간 만료(유예 초과) 등에서 false. 기능 게이트는 이 값을 신뢰.
  entitled: boolean;
}

// ── entitlement: 구독 권한의 단일 진실원천 (get_company_entitlement RPC) ──
//   'cancelling' 상태 미사용 — active + cancel_at_period_end 로 해지예약 표현(Stripe 정합).
//   앱 전역(게이트/현재구독/발행한도/AI/대시보드)이 이 판정을 공유한다.
export interface Entitlement {
  effectivePlanSlug: PlanSlug;
  entitled: boolean;
  cancelAtPeriodEnd: boolean;
  effectiveUntil: string | null;
  displayStatus: string;
}

export async function getEntitlement(companyId: string): Promise<Entitlement> {
  // 신규 RPC 는 아직 database.ts 타입에 없어 any 캐스팅 (파일 상단 db 캐스팅 관례와 동일).
  const { data, error } = await (db as any).rpc('get_company_entitlement', { p_company_id: companyId });
  const row: any = Array.isArray(data) ? data[0] : data;
  // 조회 실패 시 오차단 회피(fail-open은 게이트에서 blocked 판단으로 처리) — free/비권한 반환.
  if (error || !row) {
    return { effectivePlanSlug: 'free', entitled: false, cancelAtPeriodEnd: false, effectiveUntil: null, displayStatus: 'none' };
  }
  return {
    effectivePlanSlug: (row.effective_plan_slug || 'free') as PlanSlug,
    entitled: !!row.entitled,
    cancelAtPeriodEnd: !!row.cancel_at_period_end,
    effectiveUntil: row.effective_until ?? null,
    displayStatus: row.display_status || 'none',
  };
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
    listPrice: row.list_price != null ? Number(row.list_price) : null,
    includedSeats: row.included_seats != null ? Number(row.included_seats) : 1,
  }));
}

// 월 청구액(공용 단일 공식) — 기본가 + 기본좌석 초과분만 좌석당 과금. VAT 별도.
//   base_price + max(0, seatCount - includedSeats) * perSeatPrice
export function computeMonthlyCharge(plan: Pick<PlanInfo, 'basePrice' | 'perSeatPrice' | 'includedSeats'>, seatCount: number): number {
  const extraSeats = Math.max(0, (seatCount || 1) - (plan.includedSeats || 0));
  return Math.round(plan.basePrice + extraSeats * plan.perSeatPrice);
}

// ── 1.5 출시 게이트: 구독 상태 요약 (app-shell 배너/페이월용, 2026-06-11) ──
//   getCurrentSubscription 은 trialing 을 제외하므로 게이트 판단엔 부적합 — 전용 경량 조회.
export interface SubscriptionGateInfo {
  state: 'active' | 'trialing' | 'trial_expired' | 'past_due' | 'canceled' | 'expired' | 'none';
  daysLeft: number | null; // trialing: 체험 종료까지 / canceled(기간잔존): 종료까지
  planName: string | null;
  blocked: boolean; // 하드 페이월 대상 (trial 만료 · 해지 후 기간 종료 · 결제 기간 만료)
}

// 실효 플랜(entitlement)의 발행 한도 컬럼 조회 — 만료/해지 완료 시 free 한도로 폴백.
//   기존 status 필터 방식은 구독행이 없으면(만료/해지) limit=null 로 잡혀 '무제한'이 되던 구멍이 있었음.
async function getEffectivePlanLimit(
  companyId: string,
  column: 'monthly_tax_invoice_limit' | 'monthly_cashbill_limit' | 'monthly_contract_limit',
): Promise<{ limit: number | null; planName: string | null }> {
  const ent = await getEntitlement(companyId);
  const slug = ent.effectivePlanSlug; // 비권한이면 RPC 가 이미 'free' 반환
  const { data } = await (db as any)
    .from('subscription_plans')
    .select(`name, ${column}`)
    .eq('slug', slug)
    .maybeSingle();
  return { limit: (data?.[column] ?? null) as number | null, planName: (data?.name ?? null) as string | null };
}

// 결제 기간 만료 유예(webhook 지연 흡수, 3일)는 이제 get_company_entitlement RPC 내부에 있음.

export async function getSubscriptionGate(companyId: string): Promise<SubscriptionGateInfo> {
  // 단일 진실원천(get_company_entitlement)에서 파생 — 게이트/발행한도/AI 판정 일원화.
  const ent = await getEntitlement(companyId);

  // 플랜명은 표시용(현재 최신 구독행 기준). 실패해도 게이트 판정엔 영향 없음.
  let planName: string | null = null;
  try {
    const { data } = await db
      .from('subscriptions')
      .select('subscription_plans(name)')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    planName = (data as { subscription_plans?: { name?: string } } | null)?.subscription_plans?.name ?? null;
  } catch { /* 표시용 — 무시 */ }

  const now = Date.now();
  const untilMs = ent.effectiveUntil ? new Date(ent.effectiveUntil).getTime() : null;
  const daysLeft = untilMs ? Math.max(0, Math.ceil((untilMs - now) / 86400000)) : null;

  // display_status → 게이트 state 매핑. 해지예약(cancel_scheduled)·past_due·paused 는 아직 이용 가능 → 'active'.
  const stateMap: Record<string, SubscriptionGateInfo['state']> = {
    none: 'none',
    trialing: 'trialing',
    trial_expired: 'trial_expired',
    active: 'active',
    cancel_scheduled: 'active',
    past_due: 'past_due',
    paused: 'active',
    expired: 'expired',
    canceled: 'canceled',
  };
  const state = stateMap[ent.displayStatus] ?? (ent.entitled ? 'active' : 'none');

  // 구독행 없음(레거시 회사) → 오차단 금지. 그 외 비권한(만료/해지 종료)만 하드 차단.
  const blocked = !ent.entitled && ent.displayStatus !== 'none';
  return { state, daysLeft, planName, blocked };
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

  // 해지예약/기간 정보는 entitlement 단일 소스에서 (cancel_at_period_end · effectiveUntil).
  const ent = await getEntitlement(companyId);

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
          listPrice: (plan as any).list_price != null ? Number((plan as any).list_price) : null,
          includedSeats: (plan as any).included_seats != null ? Number((plan as any).included_seats) : 1,
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
    cancelAtPeriodEnd: ent.cancelAtPeriodEnd,
    effectiveUntil: ent.effectiveUntil,
    displayStatus: ent.displayStatus,
    entitled: ent.entitled,
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
    cancelAtPeriodEnd: false,
    effectiveUntil: data.current_period_end ?? null,
    displayStatus: data.status as string,
    entitled: true,
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

  // 단일 공식: 기본가 + 기본좌석 초과분만 좌석당 과금 (VAT 별도)
  const monthlyBase = computeMonthlyCharge(plan, seatCount);

  // 연간 결제(현재 UI 비활성 — 정상가·할인가 확정 전까지). 코드는 유지.
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
  const { limit, planName } = await getEffectivePlanLimit(companyId, 'monthly_tax_invoice_limit');
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
  const { limit, planName } = await getEffectivePlanLimit(companyId, 'monthly_cashbill_limit');
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

// 전자계약(서명 요청) 월 발송 한도 — 프로 20건, 울트라/엔터 무제한(NULL). 서버 강제는 signature_requests
//   BEFORE INSERT 트리거(enforce_contract_monthly_limit). 이 함수는 UI 카운터·버튼 가드용.
export async function getContractIssuanceStatus(companyId: string): Promise<IssuanceLimitStatus> {
  const { limit, planName } = await getEffectivePlanLimit(companyId, 'monthly_contract_limit');
  if (limit === null) return { limit: null, used: 0, remaining: null, planName };

  // KST 기준 이달 1일 0시 (트리거와 동일 경계)
  const monthStart = `${todayKst().slice(0, 7)}-01T00:00:00+09:00`;
  const { count } = await db
    .from('signature_requests')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .gte('created_at', monthStart);
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
