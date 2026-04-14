import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createSupabaseServerClient } from '@/lib/supabase-server';

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2025-02-24.acacia',
  });
}

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
    const { companyId, returnUrl } = body;

    if (!companyId) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'companyId는 필수입니다' } },
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

    // Look up subscription to find the Stripe customer ID
    const { data: subscription } = await (supabase as any)
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('company_id', companyId)
      .in('status', ['active', 'paused', 'past_due'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!subscription?.stripe_customer_id) {
      return NextResponse.json(
        { error: { code: 'NO_SUBSCRIPTION', message: '활성 구독이 없습니다' } },
        { status: 404 },
      );
    }

    const origin = request.headers.get('origin') || 'https://www.owner-view.com';
    const resolvedReturnUrl = returnUrl || `${origin}/billing`;

    const stripe = getStripe();
    const session = await stripe.billingPortal.sessions.create({
      customer: subscription.stripe_customer_id,
      return_url: resolvedReturnUrl,
    });

    return NextResponse.json({ data: { url: session.url } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Billing portal 생성 실패';
    console.error('Stripe portal error:', message);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message } },
      { status: 500 },
    );
  }
}
