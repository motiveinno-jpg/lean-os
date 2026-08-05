import { logRead } from "@/lib/log-read";
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createSupabaseServerClient } from '@/lib/supabase-server';

// 등록 카드 조회·삭제 (2026-08-05 사장님: "등록된 카드 삭제도 가능하게")
//   GET  — 고객의 카드 목록(브랜드·끝4자리·만료·기본 여부)
//   POST { action: 'detach', paymentMethodId } — 카드 삭제(detach)
//   안전장치: 해지 예약이 없는 살아있는 구독의 마지막 카드는 삭제 차단
//   (체험 종료/결제일에 청구 실패 → past_due 루프를 막는다. 해지 예약 후에는 자유 삭제)

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2025-02-24.acacia',
  });
}

async function resolveContext() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: { code: 'UNAUTHORIZED', message: '인증이 필요합니다' } }, { status: 401 }) };

  const userRow = logRead('payment-methods:userRow', await supabase
    .from('users').select('company_id').eq('auth_id', user.id).single());
  if (!userRow?.company_id) {
    return { error: NextResponse.json({ error: { code: 'FORBIDDEN', message: '회사 정보를 찾을 수 없습니다' } }, { status: 403 }) };
  }

  // trialing 포함 — 체험(카드만 등록) 상태에서도 카드 관리 가능해야 한다
  const sub = logRead('payment-methods:sub', await supabase
    .from('subscriptions')
    .select('stripe_customer_id, status, cancel_at_period_end')
    .eq('company_id', userRow.company_id)
    .in('status', ['active', 'trialing', 'paused', 'past_due'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle());
  if (!sub?.stripe_customer_id) {
    return { error: NextResponse.json({ error: { code: 'NO_SUBSCRIPTION', message: '등록된 결제 수단이 없습니다' } }, { status: 404 }) };
  }
  return { sub, customerId: sub.stripe_customer_id as string };
}

export async function GET() {
  try {
    const ctx = await resolveContext();
    if ('error' in ctx) return ctx.error;
    const stripe = getStripe();
    const [pms, customer] = await Promise.all([
      stripe.paymentMethods.list({ customer: ctx.customerId, type: 'card' }),
      stripe.customers.retrieve(ctx.customerId),
    ]);
    const defaultPm = (customer as Stripe.Customer)?.invoice_settings?.default_payment_method;
    const cards = pms.data.map((pm) => ({
      id: pm.id,
      brand: pm.card?.brand || 'card',
      last4: pm.card?.last4 || '',
      expMonth: pm.card?.exp_month || null,
      expYear: pm.card?.exp_year || null,
      isDefault: pm.id === defaultPm,
    }));
    return NextResponse.json({ data: { cards, subscriptionStatus: ctx.sub.status, cancelScheduled: !!ctx.sub.cancel_at_period_end } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '카드 조회 실패';
    console.error('[stripe/payment-methods] list error:', message);
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message } }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await resolveContext();
    if ('error' in ctx) return ctx.error;
    const body = await request.json().catch(() => ({}));
    if (body.action !== 'detach' || !String(body.paymentMethodId || '').startsWith('pm_')) {
      return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: '요청이 올바르지 않습니다' } }, { status: 400 });
    }
    const stripe = getStripe();
    // 소유 검증 — 이 고객의 카드가 맞는지 확인 후에만 detach (남의 pm_id 삭제 방지)
    const pms = await stripe.paymentMethods.list({ customer: ctx.customerId, type: 'card' });
    const target = pms.data.find((pm) => pm.id === body.paymentMethodId);
    if (!target) {
      return NextResponse.json({ error: { code: 'NOT_FOUND', message: '해당 카드를 찾을 수 없습니다' } }, { status: 404 });
    }
    // 마지막 카드 보호 — 해지 예약이 없는 살아있는 구독이면 결제 실패를 막기 위해 차단
    if (pms.data.length === 1 && !ctx.sub.cancel_at_period_end) {
      return NextResponse.json({
        error: {
          code: 'LAST_CARD_PROTECTED',
          message: '구독이 유지되는 동안 마지막 카드는 삭제할 수 없습니다. 먼저 구독을 해지하거나 다른 카드를 등록해 주세요.',
        },
      }, { status: 409 });
    }
    await stripe.paymentMethods.detach(body.paymentMethodId);
    return NextResponse.json({ data: { ok: true } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '카드 삭제 실패';
    console.error('[stripe/payment-methods] detach error:', message);
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message } }, { status: 500 });
  }
}
