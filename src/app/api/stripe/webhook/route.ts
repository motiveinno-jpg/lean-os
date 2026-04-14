import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

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
      case 'invoice.paid':
        await handleInvoicePaid(event.data.object as Stripe.Invoice);
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

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const db = getSupabaseAdmin() as any;
  const companyId = session.metadata?.companyId;
  const planSlug = session.metadata?.planSlug;
  const billingCycle = session.metadata?.billingCycle || 'monthly';

  if (!companyId || !planSlug) {
    console.warn('checkout.session.completed missing metadata', session.id);
    return;
  }

  const { data: plan } = await db
    .from('subscription_plans')
    .select('id')
    .eq('slug', planSlug)
    .eq('is_active', true)
    .single();

  if (!plan) {
    console.error('Plan not found for slug:', planSlug);
    return;
  }

  const stripeSubscriptionId = session.subscription as string;
  const stripeCustomerId = session.customer as string;

  const { data: existing } = await db
    .from('subscriptions')
    .select('id')
    .eq('company_id', companyId)
    .in('status', ['active', 'paused', 'past_due', 'trialing'])
    .limit(1)
    .maybeSingle();

  const now = new Date().toISOString();
  const periodEnd = new Date();
  if (billingCycle === 'annual') {
    periodEnd.setFullYear(periodEnd.getFullYear() + 1);
  } else {
    periodEnd.setMonth(periodEnd.getMonth() + 1);
  }

  if (existing) {
    await db.from('subscriptions').update({
      plan_id: plan.id,
      status: 'active',
      billing_cycle: billingCycle,
      stripe_subscription_id: stripeSubscriptionId,
      stripe_customer_id: stripeCustomerId,
      current_period_start: now,
      current_period_end: periodEnd.toISOString(),
      updated_at: now,
    }).eq('id', existing.id);
  } else {
    await db.from('subscriptions').insert({
      company_id: companyId,
      plan_id: plan.id,
      status: 'active',
      billing_cycle: billingCycle,
      seat_count: 1,
      stripe_subscription_id: stripeSubscriptionId,
      stripe_customer_id: stripeCustomerId,
      current_period_start: now,
      current_period_end: periodEnd.toISOString(),
    });
  }

  await db.from('billing_events').insert({
    company_id: companyId,
    event_type: 'checkout_completed',
    metadata: {
      planSlug,
      billingCycle,
      stripeSessionId: session.id,
      stripeSubscriptionId,
    },
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

  await db.from('subscriptions')
    .update({
      status: mappedStatus,
      current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
      current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('stripe_subscription_id', subscription.id);

  await db.from('billing_events').insert({
    company_id: companyId,
    event_type: 'subscription_updated',
    metadata: {
      stripeSubscriptionId: subscription.id,
      status: subscription.status,
    },
    created_at: new Date().toISOString(),
  });
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const db = getSupabaseAdmin() as any;
  const companyId = subscription.metadata?.companyId;

  await db.from('subscriptions')
    .update({
      status: 'canceled',
      canceled_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('stripe_subscription_id', subscription.id);

  if (companyId) {
    await db.from('billing_events').insert({
      company_id: companyId,
      event_type: 'subscription_deleted',
      metadata: { stripeSubscriptionId: subscription.id },
      created_at: new Date().toISOString(),
    });
  }
}

async function handleInvoicePaid(invoice: Stripe.Invoice) {
  const db = getSupabaseAdmin() as any;
  const stripeSubscriptionId = invoice.subscription as string | null;
  if (!stripeSubscriptionId) return;

  const { data: sub } = await db
    .from('subscriptions')
    .select('company_id, id')
    .eq('stripe_subscription_id', stripeSubscriptionId)
    .limit(1)
    .maybeSingle();

  if (!sub) return;

  const now = new Date();
  const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;

  const { data: lastInv } = await db
    .from('invoices')
    .select('invoice_number')
    .like('invoice_number', `INV-${yearMonth}-%`)
    .order('invoice_number', { ascending: false })
    .limit(1)
    .maybeSingle();

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
    amount: (invoice.amount_paid || 0) / 100,
    total_amount: (invoice.amount_paid || 0) / 100,
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
      amount: (invoice.amount_paid || 0) / 100,
    },
    created_at: now.toISOString(),
  });
}
