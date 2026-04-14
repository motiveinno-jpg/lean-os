import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createSupabaseServerClient } from '@/lib/supabase-server';

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2025-02-24.acacia',
  });
}

/** Stripe price ID lookup by plan slug and billing cycle */
const PRICE_MAP: Record<string, Record<string, string | undefined>> = {
  starter: {
    monthly: process.env.STRIPE_PRICE_STARTER_MONTHLY,
    annual: process.env.STRIPE_PRICE_STARTER_ANNUAL,
  },
  business: {
    monthly: process.env.STRIPE_PRICE_BUSINESS_MONTHLY,
    annual: process.env.STRIPE_PRICE_BUSINESS_ANNUAL,
  },
  enterprise: {
    monthly: process.env.STRIPE_PRICE_ENTERPRISE_MONTHLY,
    annual: process.env.STRIPE_PRICE_ENTERPRISE_ANNUAL,
  },
};

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: '인증이 필요합니다' } },
        { status: 401 },
      );
    }

    const body = await request.json();
    const { planSlug, companyId, billingCycle, successUrl, cancelUrl } = body;

    if (!planSlug || !companyId) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'planSlug와 companyId는 필수입니다' } },
        { status: 400 },
      );
    }

    // Verify user belongs to the company
    const { data: userRow } = await supabase
      .from('users')
      .select('company_id')
      .eq('auth_id', user.id)
      .single();

    if (!userRow || userRow.company_id !== companyId) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: '권한이 없습니다' } },
        { status: 403 },
      );
    }

    const cycle = billingCycle || 'monthly';
    const priceId = PRICE_MAP[planSlug]?.[cycle];

    if (!priceId) {
      return NextResponse.json(
        { error: { code: 'INVALID_PLAN', message: `유효하지 않은 플랜입니다: ${planSlug} (${cycle})` } },
        { status: 400 },
      );
    }

    const origin = request.headers.get('origin') || 'https://www.owner-view.com';
    const resolvedSuccessUrl = successUrl || `${origin}/billing?payment=success`;
    const resolvedCancelUrl = cancelUrl || `${origin}/billing?payment=cancel`;

    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: resolvedSuccessUrl,
      cancel_url: resolvedCancelUrl,
      customer_email: user.email,
      metadata: {
        companyId,
        planSlug,
        billingCycle: cycle,
        userId: user.id,
      },
      subscription_data: {
        metadata: {
          companyId,
          planSlug,
          billingCycle: cycle,
        },
      },
    });

    return NextResponse.json({ data: { url: session.url } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Checkout session 생성 실패';
    console.error('Stripe checkout error:', message);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message } },
      { status: 500 },
    );
  }
}
