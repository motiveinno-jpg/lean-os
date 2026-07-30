import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

// ⚠️ 일회용 점검 라우트 (2026-07-30) — 운영 키가 라이브 모드인지 확인만 하고 즉시 삭제.
const CHECK_TOKEN = '5c80ba5af0182f1d8e16f2ffed1a4f13db5e1fb8bf99e359';

export async function POST(req: NextRequest) {
  if (req.headers.get('x-check-token') !== CHECK_TOKEN) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const key = process.env.STRIPE_SECRET_KEY || '';
  const stripe = new Stripe(key, { apiVersion: '2025-02-24.acacia' });
  const basic = await stripe.prices.retrieve(process.env.STRIPE_PRICE_BASIC_MONTHLY!);
  const seatAnnual = await stripe.prices.retrieve(process.env.STRIPE_PRICE_BASIC_EXTRA_SEAT_ANNUAL!);
  return NextResponse.json({
    keyPrefix: key.slice(0, 8),          // sk_live_/rk_live_/sk_test_ 판별용 — 키 본문은 반환 안 함
    basicMonthly: { livemode: basic.livemode, amount: basic.unit_amount, currency: basic.currency },
    basicSeatAnnual: { livemode: seatAnnual.livemode, amount: seatAnnual.unit_amount },
  });
}
