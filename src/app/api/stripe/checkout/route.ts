import { logRead } from "@/lib/log-read";
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createSupabaseServerClient } from '@/lib/supabase-server';

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2025-02-24.acacia',
  });
}

const TRIAL_DAYS = 14;

// 플랜별 월 price + 추가좌석 price (2026-07-23 좌석 구조). 연간은 비활성(정상가·할인 확정 전까지).
//   기본 좌석(5명) 초과분만 추가좌석 price 로 별도 line item. VAT 10% 별도.
const SEAT_PRICE_MAP: Record<string, { base?: string; extraSeat?: string; includedSeats: number }> = {
  basic: {
    base: process.env.STRIPE_PRICE_BASIC_MONTHLY,
    extraSeat: process.env.STRIPE_PRICE_BASIC_EXTRA_SEAT_MONTHLY,
    includedSeats: 5,
  },
  ultra: {
    base: process.env.STRIPE_PRICE_ULTRA_MONTHLY,
    extraSeat: process.env.STRIPE_PRICE_ULTRA_EXTRA_SEAT_MONTHLY,
    includedSeats: 5,
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
    const { planSlug, companyId, seatCount, successUrl, cancelUrl } = body;

    if (!planSlug || !companyId) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'planSlug와 companyId는 필수입니다' } },
        { status: 400 },
      );
    }

    // Verify user belongs to the company
    const userRow = logRead('checkout/route:userRow', await supabase
      .from('users')
      .select('company_id')
      .eq('auth_id', user.id)
      .single());

    if (!userRow || userRow.company_id !== companyId) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: '권한이 없습니다' } },
        { status: 403 },
      );
    }

    const plan = SEAT_PRICE_MAP[planSlug];
    if (!plan?.base) {
      return NextResponse.json(
        { error: { code: 'INVALID_PLAN', message: `유효하지 않은 플랜입니다: ${planSlug}` } },
        { status: 400 },
      );
    }

    // 좌석 수는 서버에서 재계산 — 클라 값 그대로 신뢰하지 않음. 추가좌석 = max(0, 좌석 - 기본좌석).
    const requestedSeats = Math.max(1, Math.min(Number(seatCount) || 1, 500));
    const extraSeats = Math.max(0, requestedSeats - plan.includedSeats);

    const lineItems: { price: string; quantity: number }[] = [{ price: plan.base, quantity: 1 }];
    if (extraSeats > 0 && plan.extraSeat) {
      lineItems.push({ price: plan.extraSeat, quantity: extraSeats });
    }

    const origin = request.headers.get('origin') || 'https://www.owner-view.com';
    const resolvedSuccessUrl = successUrl || `${origin}/billing?payment=success`;
    const resolvedCancelUrl = cancelUrl || `${origin}/billing?payment=cancel`;

    const stripe = getStripe();
    // 카드 등록 즉시(0원 인증) + 14일 트라이얼 + 종료 후 자동 청구. 결제수단 없으면 트라이얼 종료 시 취소.
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      payment_method_collection: 'always',
      line_items: lineItems,
      success_url: resolvedSuccessUrl,
      cancel_url: resolvedCancelUrl,
      customer_email: user.email,
      metadata: { companyId, planSlug, seatCount: String(requestedSeats), userId: user.id },
      subscription_data: {
        trial_period_days: TRIAL_DAYS,
        trial_settings: { end_behavior: { missing_payment_method: 'cancel' } },
        metadata: { companyId, planSlug, seatCount: String(requestedSeats) },
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
