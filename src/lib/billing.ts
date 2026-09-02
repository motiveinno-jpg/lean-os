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
  storagePackCount: number; // 스토리지 팩 수(각 +10GB, 좌석과 동일 단가)
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
// 연간 결제 할인율 — 10% (2026-08-07 사장님 확정).
//   화면(요금제 토글·환불규정)은 이미 10% 로 안내하고 있었는데 계산만 20% 였다.
//   ⚠️ 실제 청구액은 Stripe 에 등록된 연간 price 다. 그 값도 10% 로 맞춰야 표시와 청구가 일치한다.
//      (요금제 개편 예정이라 표시부터 먼저 맞춘 상태 — Stripe price 확정 시 함께 점검할 것)
const ANNUAL_DISCOUNT_RATE = 0.1;

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

// 월 청구액(공용 단일 공식) — 기본가 + (기본좌석 초과분 + 스토리지 팩)만 단가 과금. VAT 별도.
//   base_price + (max(0, seatCount - includedSeats) + storagePacks) * perSeatPrice
//   스토리지 팩은 좌석과 동일 단가(perSeatPrice)로 청구 — 용량만 늘리고 로그인은 안 늘리는 애드온.
export function computeMonthlyCharge(
  plan: Pick<PlanInfo, 'basePrice' | 'perSeatPrice' | 'includedSeats'>,
  seatCount: number,
  storagePacks = 0,
): number {
  const extraSeats = Math.max(0, (seatCount || 1) - (plan.includedSeats || 0));
  return Math.round(plan.basePrice + (extraSeats + Math.max(0, storagePacks)) * plan.perSeatPrice);
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
  column: 'monthly_tax_invoice_limit' | 'monthly_cashbill_limit' | 'monthly_contract_limit'
        | 'monthly_issue_limit' | 'monthly_ai_call_limit',
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
    storagePackCount: (data as any).storage_pack_count ?? 0,
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

// ── 10. 인보이스 번호 생성 (INV-YYYYMM-XXXX) ──
//   2026-08-28: 회사 필터 필수 — 없으면 운영자 계정에선 전 고객사 번호에서 채번한다(현재 호출자 0인 dead code지만 부활 대비)
export async function generateInvoiceNumber(companyId: string): Promise<string> {
  const now = new Date();
  const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const prefix = `INV-${yearMonth}`;

  // 해당 월의 마지막 인보이스 번호 조회
  const data = logRead('lib/billing:data', await db
    .from('invoices')
    .select('invoice_number')
    .eq('company_id', companyId)
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

// ── 14.5 세금계산서 / 현금영수증 국세청 발행 월간 한도 조회 (요금제별 차등, NULL=무제한) ──
export interface IssuanceLimitStatus {
  limit: number | null; // null = 무제한
  used: number;
  remaining: number | null;
  planName: string | null;
}

/** 발행 한도 — 2026-08-11 요금제 개편: 합산 한 주머니 → 세금계산서·현금영수증 **각각**
 *  (오너뷰 기준 각 월 100건, 무료 각 5건). 사용량은 get_monthly_issue_usage RPC 단일 소스,
 *  서버 강제는 issue_allowance(p_kind) — 클라이언트·엣지가 같은 값을 본다. */
export async function getIssuanceStatus(companyId: string): Promise<{
  planName: string | null;
  taxLimit: number | null; taxUsed: number; taxRemaining: number | null;
  cashLimit: number | null; cashUsed: number; cashRemaining: number | null;
}> {
  const [tax, cash, usage] = await Promise.all([
    getEffectivePlanLimit(companyId, 'monthly_tax_invoice_limit'),
    getEffectivePlanLimit(companyId, 'monthly_cashbill_limit'),
    (db as any).rpc('get_monthly_issue_usage', { p_company_id: companyId }),
  ]);
  const row = Array.isArray(usage.data) ? usage.data[0] : usage.data;
  const taxUsed = Number(row?.tax_count ?? 0);
  const cashUsed = Number(row?.cash_count ?? 0);
  return {
    planName: tax.planName,
    taxLimit: tax.limit,
    taxUsed,
    taxRemaining: tax.limit === null ? null : Math.max(0, tax.limit - taxUsed),
    cashLimit: cash.limit,
    cashUsed,
    cashRemaining: cash.limit === null ? null : Math.max(0, cash.limit - cashUsed),
  };
}

export async function getTaxInvoiceIssuanceStatus(companyId: string): Promise<IssuanceLimitStatus> {
  const s = await getIssuanceStatus(companyId);
  return { limit: s.taxLimit, used: s.taxUsed, remaining: s.taxRemaining, planName: s.planName };
}

export async function getCashReceiptIssuanceStatus(companyId: string): Promise<IssuanceLimitStatus> {
  const s = await getIssuanceStatus(companyId);
  return { limit: s.cashLimit, used: s.cashUsed, remaining: s.cashRemaining, planName: s.planName };
}

// 전자계약(서명 요청) 월 발송 한도 — 프로 20건, 울트라/엔터 무제한(NULL). 서버 강제는 signature_requests
//   BEFORE INSERT 트리거(enforce_contract_monthly_limit). 이 함수는 UI 카운터·버튼 가드용.
/** 은행·카드 연동 허용 여부 (2026-08-06 개편) — 무료 플랜은 자동/수동 모두 차단.
 *  CODEF 는 계좌당 월 600원이 나가는 유일한 실변동비라, 무료에 열어두면 원가를 못 막는다.
 *  서버 강제는 codef-sync 엣지 — 이 함수는 UI 가드용. */
/** 은행·카드 연동 접근 권한.
 *  · allowed        — 연동 자체(자동 동기화 포함). 2026-08-07 부터 무료도 허용(하루 2회).
 *  · manualAllowed  — '즉시 동기화' 버튼. 누를 때마다 CODEF 비용이 나가므로 유료 구독자만.
 *    무료는 하루 2회 자동 동기화까지만 쓴다(사장님 결정 2026-08-07). */
export async function getBankSyncAccess(
  companyId: string,
): Promise<{ allowed: boolean; manualAllowed: boolean; planName: string | null }> {
  const ent = await getEntitlement(companyId);
  const { data } = await (db as any)
    .from('subscription_plans')
    .select('name, bank_sync_enabled')
    .eq('slug', ent.effectivePlanSlug)
    .maybeSingle();
  const isFree = !ent.entitled || ent.effectivePlanSlug === 'free';
  return {
    allowed: data?.bank_sync_enabled !== false,
    manualAllowed: data?.bank_sync_enabled !== false && !isFree,
    planName: data?.name ?? null,
  };
}

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
