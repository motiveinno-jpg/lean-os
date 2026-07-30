import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

// ⚠️ 일회용 결제 경로 테스트 라우트 (2026-07-30) — 실제 연간 체크아웃 세션을 생성해
//   품목·금액·VAT 를 검증하고 즉시 만료(expire)시켜 결제가 불가능하게 만든다. 청구 없음.
//   시나리오: ① 20석(쿠폰 없음 → 추가 15석) ② 20석(쿠폰 12석 사용 → 추가 3석). 사용 직후 삭제.
const TEST_TOKEN = '3d689d5ce351493a89cef2acc78c08694a2b78d8038edf39';

export async function POST(req: NextRequest) {
  if (req.headers.get('x-test-token') !== TEST_TOKEN) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2025-02-24.acacia' });
  const base = process.env.STRIPE_PRICE_ULTRA_ANNUAL!;
  const seat = process.env.STRIPE_PRICE_ULTRA_EXTRA_SEAT_ANNUAL!;
  const INCLUDED = 5, SEATS = 20, COUPON_FREE = 12;
  const scenarios = [
    { name: 'no_coupon', extra: Math.max(0, SEATS - INCLUDED) },
    { name: 'coupon_12', extra: Math.max(0, SEATS - INCLUDED - COUPON_FREE) },
  ];
  const out: Record<string, unknown> = {};
  for (const sc of scenarios) {
    const lineItems: { price: string; quantity: number }[] = [{ price: base, quantity: 1 }];
    if (sc.extra > 0) lineItems.push({ price: seat, quantity: sc.extra });
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      payment_method_collection: 'always',
      line_items: lineItems,
      success_url: 'https://www.owner-view.com/billing?payment=success',
      cancel_url: 'https://www.owner-view.com/billing?payment=cancel',
      metadata: { test: 'annual-verify', scenario: sc.name },
      subscription_data: {
        trial_period_days: 14,
        trial_settings: { end_behavior: { missing_payment_method: 'cancel' as const } },
        ...(process.env.STRIPE_TAX_RATE_VAT ? { default_tax_rates: [process.env.STRIPE_TAX_RATE_VAT] } : {}),
      },
    });
    const full = await stripe.checkout.sessions.retrieve(session.id, { expand: ['line_items'] });
    await stripe.checkout.sessions.expire(session.id); // 결제 불가 처리
    out[sc.name] = {
      livemode: full.livemode,
      extraSeatQty: sc.extra,
      items: (full.line_items?.data || []).map((li) => ({ desc: li.description, qty: li.quantity, amount: li.amount_total })),
      subtotal: full.amount_subtotal,
      tax: (full.total_details as any)?.amount_tax,
      total: full.amount_total,
      expired: true,
    };
  }
  return NextResponse.json(out);
}
