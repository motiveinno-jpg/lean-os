import { logRead } from "@/lib/log-read";
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import * as Sentry from "@sentry/nextjs";

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2025-02-24.acacia',
  });
}

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get('stripe-signature');

  if (!signature) {
    return NextResponse.json(
      { error: { code: 'MISSING_SIGNATURE', message: 'Missing stripe-signature header' } },
      { status: 400 },
    );
  }

  let event: Stripe.Event;
  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Webhook signature verification failed';
    console.error('Webhook signature error:', message);
    return NextResponse.json(
      { error: { code: 'INVALID_SIGNATURE', message } },
      { status: 400 },
    );
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;
      case 'customer.subscription.trial_will_end':
        await handleTrialWillEnd(event.data.object as Stripe.Subscription);
        break;
      case 'invoice.paid':
        await handleInvoicePaid(event.data.object as Stripe.Invoice, event.id);
        break;
      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
        break;
      default:
        break;
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Webhook handler error';
    console.error(`Webhook handler error [${event.type}]:`, message);
    return NextResponse.json(
      { error: { code: 'HANDLER_ERROR', message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ received: true });
}

// Stripe 구독 상태 → 앱 상태 매핑(단일 진실원천은 Stripe).
const STATUS_MAP: Record<string, string> = {
  trialing: 'trialing', active: 'active', past_due: 'past_due', unpaid: 'past_due',
  canceled: 'canceled', paused: 'paused', incomplete: 'past_due', incomplete_expired: 'canceled',
};
const toISO = (unix?: number | null) => (unix ? new Date(unix * 1000).toISOString() : null);

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const db = getSupabaseAdmin() as any;
  const companyId = session.metadata?.companyId;
  const planSlug = session.metadata?.planSlug;
  const seatCount = Math.max(1, parseInt(session.metadata?.seatCount || '1', 10) || 1);

  if (!companyId || !planSlug) {
    console.warn('checkout.session.completed missing metadata', session.id);
    return;
  }

  const plan = logRead('webhook/route:plan', await db
    .from('subscription_plans').select('id').eq('slug', planSlug).eq('is_active', true).single());
  if (!plan) { console.error('Plan not found for slug:', planSlug); return; }

  const stripeSubscriptionId = session.subscription as string;
  const stripeCustomerId = session.customer as string;
  if (!stripeSubscriptionId) { console.warn('checkout.session.completed without subscription', session.id); return; }

  // ⚠️ 즉시 active 로 만들지 않는다 — Stripe 구독을 조회해 실제 상태(trialing)·trial_end·기간을 그대로 저장.
  const stripe = getStripe();
  const sub = await stripe.subscriptions.retrieve(stripeSubscriptionId) as any;
  const status = STATUS_MAP[sub.status] || 'trialing';
  const now = new Date().toISOString();

  const patch: Record<string, unknown> = {
    plan_id: plan.id,
    status,
    billing_cycle: 'monthly',
    seat_count: seatCount,
    stripe_subscription_id: stripeSubscriptionId,
    stripe_customer_id: stripeCustomerId,
    trial_ends_at: toISO(sub.trial_end),
    current_period_start: toISO(sub.current_period_start) || now,
    current_period_end: toISO(sub.current_period_end),
    cancel_at_period_end: !!sub.cancel_at_period_end,
    cancel_requested_at: null,
    cancel_reason: null,
    canceled_at: null,
    updated_at: now,
  };

  const existing = logRead('webhook/route:existing', await db
    .from('subscriptions')
    .select('id')
    .eq('company_id', companyId)
    .in('status', ['active', 'paused', 'past_due', 'trialing'])
    .limit(1)
    .maybeSingle());

  if (existing) {
    await db.from('subscriptions').update(patch).eq('id', existing.id);
  } else {
    await db.from('subscriptions').insert({ company_id: companyId, ...patch });
  }

  // 회사 캐시 플랜 — trialing 도 해당 플랜 권한 유지.
  await db.from('companies').update({ current_plan: planSlug }).eq('id', companyId);

  await db.from('billing_events').insert({
    company_id: companyId,
    event_type: 'checkout_completed',
    metadata: { planSlug, seatCount, stripeSessionId: session.id, stripeSubscriptionId, status },
    created_at: now,
  });
}

async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  const db = getSupabaseAdmin() as any;
  const companyId = subscription.metadata?.companyId;
  if (!companyId) return;

  const statusMap: Record<string, string> = {
    active: 'active',
    past_due: 'past_due',
    canceled: 'canceled',
    unpaid: 'past_due',
    trialing: 'trialing',
    paused: 'paused',
  };

  const mappedStatus = statusMap[subscription.status] || 'active';
  const cancelAtPeriodEnd = !!subscription.cancel_at_period_end;

  // Stripe 를 진실원천으로 cancel_at_period_end 동기화. 예약 취소(false)면 cancel 메타 초기화(복원).
  const patch: Record<string, unknown> = {
    status: mappedStatus,
    cancel_at_period_end: cancelAtPeriodEnd,
    trial_ends_at: toISO((subscription as any).trial_end),
    current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
    current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (!cancelAtPeriodEnd) {
    patch.cancel_requested_at = null;
    patch.cancel_reason = null;
  }

  await db.from('subscriptions').update(patch).eq('stripe_subscription_id', subscription.id);

  await db.from('billing_events').insert({
    company_id: companyId,
    event_type: 'subscription_updated',
    metadata: {
      stripeSubscriptionId: subscription.id,
      status: subscription.status,
      cancelAtPeriodEnd,
    },
    created_at: new Date().toISOString(),
  });
}

// 트라이얼 종료 3일 전(Stripe 발송) — 회사 owner/admin 에게 결제 예정 알림.
async function handleTrialWillEnd(subscription: Stripe.Subscription) {
  const db = getSupabaseAdmin() as any;
  const row = logRead('webhook/route:trialSub', await db
    .from('subscriptions').select('company_id, trial_ends_at').eq('stripe_subscription_id', subscription.id).maybeSingle());
  const companyId = subscription.metadata?.companyId || row?.company_id;
  if (!companyId) return;

  const trialEnd = toISO((subscription as any).trial_end) || row?.trial_ends_at;
  const dateStr = trialEnd ? new Date(trialEnd).toISOString().slice(0, 10) : '곧';

  const admins = logRead('webhook/route:trialAdmins', await db
    .from('users').select('id').eq('company_id', companyId).in('role', ['owner', 'admin']));
  if (admins?.length) {
    await db.from('notifications').insert(admins.map((a: any) => ({
      company_id: companyId, user_id: a.id, type: 'payment_due',
      title: '무료체험 종료 3일 전 — 곧 첫 결제가 진행됩니다',
      message: `${dateStr}에 등록하신 결제수단으로 첫 결제가 자동 청구됩니다. 계속 이용하시려면 별도 조치가 필요 없습니다.`,
      entity_type: 'billing', is_read: false,
    })));
  }

  await db.from('billing_events').insert({
    company_id: companyId, event_type: 'trial_will_end',
    metadata: { stripeSubscriptionId: subscription.id, trialEnd }, created_at: new Date().toISOString(),
  });
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const db = getSupabaseAdmin() as any;
  const now = new Date().toISOString();

  // 기간 종료로 실제 해지 확정 → canceled + 예약 플래그 정리. 이 시점에만 Free 전환.
  const { data: rows } = await db.from('subscriptions')
    .update({
      status: 'canceled',
      cancel_at_period_end: false,
      canceled_at: now,
      updated_at: now,
    })
    .eq('stripe_subscription_id', subscription.id)
    .select('company_id');

  // company_id: Stripe 메타 우선, 없으면 방금 갱신된 구독행에서 파생.
  const companyId = subscription.metadata?.companyId || rows?.[0]?.company_id || null;

  if (companyId) {
    // 종료 시점에만 회사 캐시 플랜을 Free 로 — 기간 종료 전(cancel 예약)에는 절대 내리지 않음.
    await db.from('companies').update({ current_plan: 'free' }).eq('id', companyId);

    await db.from('billing_events').insert({
      company_id: companyId,
      event_type: 'subscription_deleted',
      metadata: { stripeSubscriptionId: subscription.id },
      created_at: now,
    });
  }
}

// KRW·JPY 등 zero-decimal 통화는 최소단위=원 자체(×100 아님). 그 외는 /100.
const ZERO_DECIMAL = new Set(['krw', 'jpy', 'vnd', 'clp', 'bif', 'djf', 'gnf', 'kmf', 'mga', 'pyg', 'rwf', 'ugx', 'vuv', 'xaf', 'xof', 'xpf']);
function stripeAmountToWon(amount: number, currency: string): number {
  return ZERO_DECIMAL.has((currency || 'krw').toLowerCase()) ? (amount || 0) : (amount || 0) / 100;
}

async function handleInvoicePaid(invoice: Stripe.Invoice, eventId?: string) {
  const db = getSupabaseAdmin() as any;
  const stripeSubscriptionId = invoice.subscription as string | null;
  if (!stripeSubscriptionId) return;

  const sub = logRead('webhook/route:sub', await db
    .from('subscriptions')
    .select('company_id, id, seat_count, current_period_end, trial_ends_at, subscription_plans(name)')
    .eq('stripe_subscription_id', stripeSubscriptionId)
    .limit(1)
    .maybeSingle());

  if (!sub) return;

  const amountWon = stripeAmountToWon(invoice.amount_paid || 0, invoice.currency);

  // 멱등성 — Stripe 재시도 시 같은 인보이스 중복 insert 방지
  const dup = logRead('webhook/route:dup', await db
    .from('invoices')
    .select('id')
    .eq('stripe_invoice_id', invoice.id)
    .limit(1)
    .maybeSingle());
  if (dup) {
    // 인보이스는 이미 기록됨. 결제 알림 메일은 자체 멱등(billing_email_deliveries)이라 재시도 안전.
    await notifyBillingPaid(invoice, sub, amountWon, eventId);
    return;
  }

  const now = new Date();
  const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;

  const lastInv = logRead('webhook/route:lastInv', await db
    .from('invoices')
    .select('invoice_number')
    .like('invoice_number', `INV-${yearMonth}-%`)
    .order('invoice_number', { ascending: false })
    .limit(1)
    .maybeSingle());

  let seq = 1;
  if (lastInv?.invoice_number) {
    const lastSeq = parseInt(lastInv.invoice_number.split('-').pop() || '0', 10);
    seq = lastSeq + 1;
  }
  const invoiceNumber = `INV-${yearMonth}-${String(seq).padStart(4, '0')}`;

  await db.from('invoices').insert({
    company_id: sub.company_id,
    subscription_id: sub.id,
    invoice_number: invoiceNumber,
    amount: amountWon,
    total_amount: amountWon,
    status: 'paid',
    description: invoice.lines?.data?.[0]?.description || '구독 결제',
    stripe_invoice_id: invoice.id,
    paid_at: now.toISOString(),
  });

  await db.from('billing_events').insert({
    company_id: sub.company_id,
    event_type: 'invoice_paid',
    metadata: {
      invoiceNumber,
      stripeInvoiceId: invoice.id,
      amount: amountWon,
    },
    created_at: now.toISOString(),
  });

  // 결제 성공 내부 알림 메일 (실결제만). 인보이스 기록 후 트리거 — 메일 실패는 웹훅에 영향 없음.
  await notifyBillingPaid(invoice, sub, amountWon, eventId);
}

// creative@mo-tive.com 결제 알림 발송(엣지 위임). amount>0(실결제)만, 0원 트라이얼 invoice 제외.
//   중복방지는 엣지의 billing_email_deliveries 가 담당. Resend 실패해도 여기서 삼켜 웹훅은 200 유지.
async function notifyBillingPaid(invoice: Stripe.Invoice, sub: any, amountWon: number, eventId?: string) {
  try {
    if (!(amountWon > 0)) return; // 0원 트라이얼 등 미발송
    const db = getSupabaseAdmin() as any;

    // 알림 유형: 이전 성공 invoice 없으면 신규, 있으면 갱신. billing_reason 이 update/manual 이면 플랜변경/수동.
    const reason = (invoice as any).billing_reason as string | undefined;
    let notificationType: 'new' | 'renewal' | 'change';
    if (reason === 'subscription_update' || reason === 'manual') notificationType = 'change';
    else {
      const priorCount = logRead('webhook/route:priorInv', await db
        .from('invoices').select('id', { count: 'exact', head: true })
        .eq('subscription_id', sub.id).eq('status', 'paid'));
      notificationType = (priorCount ?? 0) > 1 ? 'renewal' : 'new'; // 방금 넣은 1건 포함이면 첫 결제
    }

    const company = logRead('webhook/route:company', await db
      .from('companies').select('name, representative').eq('id', sub.company_id).maybeSingle());
    const owner = logRead('webhook/route:owner', await db
      .from('users').select('email').eq('company_id', sub.company_id).eq('role', 'owner').limit(1).maybeSingle());

    const hookSecret = process.env.BILLING_HOOK_SECRET;
    const fnUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/send-billing-notification`;
    if (!hookSecret) { console.warn('[billing-notify] BILLING_HOOK_SECRET missing'); return; }

    const payload = {
      stripe_event_id: eventId || null,
      stripe_invoice_id: invoice.id,
      stripe_subscription_id: invoice.subscription,
      company_id: sub.company_id,
      notification_type: notificationType,
      company_name: company?.name || '회사',
      payer: company?.representative || owner?.email || '-',
      plan_name: sub.subscription_plans?.name || '-',
      seat_count: sub.seat_count ?? '-',
      amount_krw: amountWon,
      paid_at: new Date().toISOString(),
      next_billing_at: sub.current_period_end || null,
      trial_end: notificationType === 'new' ? (sub.trial_ends_at || null) : null,
    };

    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
    const res = await fetch(fnUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': hookSecret, apikey: anon, Authorization: `Bearer ${anon}` },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      // 결제 알림 실패는 결제 자체엔 영향 없음. Sentry 로만 추적.
      Sentry.captureException(new Error(`billing notify failed HTTP ${res.status}`), { tags: { scope: 'billing-notify' }, extra: { invoiceId: invoice.id } });
    }
  } catch (e) {
    Sentry.captureException(e instanceof Error ? e : new Error('billing notify error'), { tags: { scope: 'billing-notify' } });
  }
}

// 결제 실패(dunning) — 재시도·독촉은 Stripe 가 진행, 앱은 past_due 반영 + 기록
async function handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
  const db = getSupabaseAdmin() as any;
  const stripeSubscriptionId = invoice.subscription as string | null;
  if (!stripeSubscriptionId) return;

  const sub = logRead('webhook/route:sub', await db
    .from('subscriptions')
    .select('company_id, id')
    .eq('stripe_subscription_id', stripeSubscriptionId)
    .limit(1)
    .maybeSingle());
  if (!sub) return;

  await db.from('subscriptions')
    .update({ status: 'past_due', updated_at: new Date().toISOString() })
    .eq('id', sub.id);

  await db.from('billing_events').insert({
    company_id: sub.company_id,
    event_type: 'payment_failed',
    metadata: {
      stripeInvoiceId: invoice.id,
      attemptCount: (invoice as any).attempt_count ?? null,
      amountDue: (invoice.amount_due || 0) / 100,
    },
    created_at: new Date().toISOString(),
  });
}
