import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

// ⚠️ 일회용 복구·검증 라우트 (2026-07-30) — reset 라우트의 아카이브 스윕이 같은 product 를
//   공유하는 연간 기본가까지 비활성화한 사고 복구: 기본가 2개 재활성화 + 최종 4개 가격 검증.
//   사용 직후 삭제.
const SETUP_TOKEN = '8dee3c82238c7186128f9b990a48d6ce251d244af6f1dfca';
const FINAL = {
  BASIC_ANNUAL: 'price_1TyltLBEJTGmEnmcCIA4yhdG',            // 858,600
  ULTRA_ANNUAL: 'price_1TyltNBEJTGmEnmclxu9AuCj',            // 1,188,000
  BASIC_EXTRA_SEAT_ANNUAL: 'price_1TylxCBEJTGmEnmc2hHq5C1R', // 120,000
  ULTRA_EXTRA_SEAT_ANNUAL: 'price_1TylxEBEJTGmEnmcubtdFh25', // 120,000
} as const;

export async function POST(req: NextRequest) {
  if (req.headers.get('x-setup-token') !== SETUP_TOKEN) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2025-02-24.acacia' });
  const out: Record<string, unknown> = {};
  for (const [name, id] of Object.entries(FINAL)) {
    let p = await stripe.prices.retrieve(id);
    if (!p.active) p = await stripe.prices.update(id, { active: true });
    out[name] = { id: p.id, amount: p.unit_amount, active: p.active, livemode: p.livemode, interval: p.recurring?.interval };
  }
  return NextResponse.json(out);
}
