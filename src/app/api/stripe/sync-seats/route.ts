// 해외카드(Stripe) 구독의 추가 좌석을 실제 인원에 맞춘다 — Vercel Cron 매일 03:30 KST (vercel.json).
//
//   전에는 결제할 때의 좌석 수가 굳어, 이후 직원을 늘려도 39,000원 그대로였다(토스는 월 청구 때마다 다시 센다).
//   매일 재직 인원(company_seat_count)으로 추가좌석 수량을 맞추고, 늘거나 준 만큼은 Stripe 가 일할로
//   다음 청구서에 더하거나 뺀다(proration_behavior: create_prorations) — 토스의 중도 합류·퇴사 일할과 같은 결과.
//
//   인증: Vercel Cron 이 보내는 Authorization: Bearer ${CRON_SECRET}. 그 밖의 호출은 401.
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import * as Sentry from '@sentry/nextjs';
import { SEAT_PRICE_MAP, billableSeats, type BillingCycle } from '@/lib/stripe-seat-prices';

export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2025-02-24.acacia' });

  const { data: subs, error } = await db.from('subscriptions')
    .select('id, company_id, plan_slug, billing_cycle, seat_count, stripe_subscription_id, status')
    .not('stripe_subscription_id', 'is', null)
    .in('status', ['active', 'past_due']);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const results: Record<string, unknown>[] = [];
  for (const s of subs || []) {
    try {
      const plan = SEAT_PRICE_MAP[s.plan_slug || ''];
      const cycle: BillingCycle = s.billing_cycle === 'annual' || s.billing_cycle === 'yearly' ? 'annual' : 'monthly';
      const extraPrice = plan?.[cycle]?.extraSeat;
      if (!plan || !extraPrice) { results.push({ company: s.company_id, skipped: 'no_price_map' }); continue; }

      const seatInfo = await billableSeats(db, s.company_id, plan.includedSeats);
      if (!seatInfo) { results.push({ company: s.company_id, skipped: 'seat_count_failed' }); continue; }

      const live = await stripe.subscriptions.retrieve(s.stripe_subscription_id!);
      if (!['active', 'past_due', 'trialing'].includes(live.status)) { results.push({ company: s.company_id, skipped: `stripe_${live.status}` }); continue; }
      const item = live.items.data.find((i) => i.price?.id === extraPrice);
      const current = item?.quantity ?? 0;
      const want = seatInfo.extraSeats;

      if (current !== want) {
        const change = item
          ? (want === 0 ? { id: item.id, deleted: true } : { id: item.id, quantity: want })
          : { price: extraPrice, quantity: want };
        await stripe.subscriptions.update(live.id, { items: [change], proration_behavior: 'create_prorations' });
        await db.from('billing_events').insert({
          company_id: s.company_id, event_type: 'seat_changed',
          metadata: { provider: 'stripe', subscription: live.id, extraSeatsFrom: current, extraSeatsTo: want, seats: seatInfo.seats },
        });
      }
      if (s.seat_count !== seatInfo.seats) await db.from('subscriptions').update({ seat_count: seatInfo.seats, updated_at: new Date().toISOString() }).eq('id', s.id);
      results.push({ company: s.company_id, extraSeatsFrom: current, extraSeatsTo: want });
    } catch (e) {
      Sentry.captureException(e instanceof Error ? e : new Error('stripe seat sync failed'), { tags: { scope: 'stripe-sync-seats' }, extra: { company: s.company_id } });
      results.push({ company: s.company_id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return NextResponse.json({ ok: true, checked: (subs || []).length, results });
}
