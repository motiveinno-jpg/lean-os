import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

// ⚠️ 일회용 설정 라우트 (2026-07-30) — 연간 추가좌석 price 2개를 서버 키로 생성한다.
//   기본 연간가가 월간 대비 갖는 할인율을 그대로 추가좌석에 적용. 사용 직후 이 파일은 삭제된다.
const SETUP_TOKEN = 'ca84bf76fd6aa62dd377070a864df8f3b15ce4bfdbf89d93';

export async function POST(req: NextRequest) {
  if (req.headers.get('x-setup-token') !== SETUP_TOKEN) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2025-02-24.acacia' });
  const out: Record<string, unknown> = {};
  for (const plan of ['BASIC', 'ULTRA'] as const) {
    const monthlyBaseId = process.env[`STRIPE_PRICE_${plan}_MONTHLY`]!;
    const annualBaseId = process.env[`STRIPE_PRICE_${plan}_ANNUAL`]!;
    const monthlySeatId = process.env[`STRIPE_PRICE_${plan}_EXTRA_SEAT_MONTHLY`]!;
    const [mb, ab, ms] = await Promise.all([
      stripe.prices.retrieve(monthlyBaseId),
      stripe.prices.retrieve(annualBaseId),
      stripe.prices.retrieve(monthlySeatId),
    ]);
    const ratio = (ab.unit_amount || 0) / (12 * (mb.unit_amount || 1));
    const seatAnnual = Math.round(((ms.unit_amount || 0) * 12 * ratio) / 100) * 100;
    // 멱등 — 같은 product 에 이미 연간 price 가 있으면 재사용
    const existing = await stripe.prices.list({ product: ms.product as string, active: true, limit: 100 });
    const found = existing.data.find((p) => p.recurring?.interval === 'year');
    if (found) {
      out[plan] = { reused: true, id: found.id, amount: found.unit_amount, ratio };
      continue;
    }
    const created = await stripe.prices.create({
      product: ms.product as string,
      currency: ms.currency,
      unit_amount: seatAnnual,
      recurring: { interval: 'year' },
      nickname: `${plan.toLowerCase()} extra seat annual`,
    });
    out[plan] = { created: true, id: created.id, amount: seatAnnual, monthlySeat: ms.unit_amount, ratio };
  }
  return NextResponse.json(out);
}
