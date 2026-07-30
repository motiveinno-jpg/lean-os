import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

// ⚠️ 일회용 설정 라우트 (2026-07-30, 사장님 결정: 기본가만 10% 할인, 추가좌석은 무할인) — 사용 직후 삭제.
//   연간 기본가(858,600/1,188,000)·연간 추가좌석(120,000=10,000×12)을 생성하고,
//   대상 금액과 다른 기존 연간 price 는 전부 아카이브한다(중간에 잘못 만든 금액 포함).
const SETUP_TOKEN = 'cc51721093a4978040ca5a12af98eafa82b7f6eac55e16f3';
const TARGET = {
  BASIC: { base: 858600, seat: 120000 },   // 79,500×12×0.9 / 좌석 10,000×12 (무할인)
  ULTRA: { base: 1188000, seat: 120000 },  // 110,000×12×0.9
} as const;

export async function POST(req: NextRequest) {
  if (req.headers.get('x-setup-token') !== SETUP_TOKEN) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2025-02-24.acacia' });
  const out: Record<string, unknown> = {};
  for (const plan of ['BASIC', 'ULTRA'] as const) {
    const res: Record<string, unknown> = {};
    for (const kind of ['base', 'seat'] as const) {
      const monthlyEnv = kind === 'base' ? `STRIPE_PRICE_${plan}_MONTHLY` : `STRIPE_PRICE_${plan}_EXTRA_SEAT_MONTHLY`;
      const oldAnnualEnv = kind === 'base' ? `STRIPE_PRICE_${plan}_ANNUAL` : `STRIPE_PRICE_${plan}_EXTRA_SEAT_ANNUAL`;
      const monthly = await stripe.prices.retrieve(process.env[monthlyEnv]!);
      const amount = TARGET[plan][kind];
      // 멱등 — 같은 product 에 같은 금액의 연간 price 있으면 재사용
      const list = await stripe.prices.list({ product: monthly.product as string, active: true, limit: 100 });
      let price = list.data.find((p) => p.recurring?.interval === 'year' && p.unit_amount === amount);
      if (!price) {
        price = await stripe.prices.create({
          product: monthly.product as string,
          currency: monthly.currency,
          unit_amount: amount,
          recurring: { interval: 'year' },
          nickname: `${plan.toLowerCase()} ${kind} annual 10off`,
        });
      }
      // 대상 금액이 아닌 활성 연간 price 는 전부 아카이브 (env 참조분 + 중간 생성분 포함)
      const archived: string[] = [];
      for (const p of list.data) {
        if (p.recurring?.interval === 'year' && p.id !== price.id) {
          try { await stripe.prices.update(p.id, { active: false }); archived.push(p.id); } catch { /* 이미 비활성 등 */ }
        }
      }
      const oldId = process.env[oldAnnualEnv];
      if (oldId && oldId !== price.id && !archived.includes(oldId)) {
        try { await stripe.prices.update(oldId, { active: false }); archived.push(oldId); } catch { /* 이미 비활성 등 */ }
      }
      if (archived.length) res[`${kind}_archived`] = archived;
      res[kind] = { id: price.id, amount: price.unit_amount, livemode: price.livemode };
    }
    out[plan] = res;
  }
  return NextResponse.json(out);
}
