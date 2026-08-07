import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createSupabaseServerClient } from '@/lib/supabase-server';

// 충전(크레딧) 결제 — 구독과 달리 '지금 바로 결제'하는 일회성 결제 (2026-08-07 사장님 결정).
//   구독 체크아웃(/api/stripe/checkout)과 달리 Stripe 대시보드에 price 를 미리 만들지 않는다.
//   충전은 수량이 자유라 price_data 로 금액을 그때그때 만든다 — env 등록 없이 바로 열린다.
//
//   흐름: 이 라우트가 credit_purchases(pending) 를 먼저 만들고 그 id 를 metadata 에 실어
//   Checkout 을 연다 → 결제 성공 웹훅이 apply_credit_purchase(id) 로 잔액에 적립한다.
//   실제 적립은 오직 웹훅에서만 — 성공 URL 로 돌아온 것만으로는 적립하지 않는다(위조 방지).

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2025-02-24.acacia' });
}

// 단가 (VAT 별도) — 사장님 결정 2026-08-07
export const CREDIT_PRICING = {
  issue:     { unitKrw: 300,   step: 10,        label: '세금계산서·현금영수증 발행', unitLabel: '건' },
  ai_tokens: { unitKrw: 10000, step: 1_000_000, label: 'AI 참모 토큰',              unitLabel: '토큰' },
} as const;

type CreditKind = keyof typeof CREDIT_PRICING;

export async function POST(request: NextRequest) {
  try {
    const { kind, packs, successUrl, cancelUrl } = await request.json();

    if (kind !== 'issue' && kind !== 'ai_tokens') {
      return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: '충전 종류가 올바르지 않습니다' } }, { status: 400 });
    }
    const packCount = Number(packs);
    if (!Number.isInteger(packCount) || packCount < 1 || packCount > 100) {
      return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: '충전 수량은 1~100 사이여야 합니다' } }, { status: 400 });
    }

    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: '로그인이 필요합니다' } }, { status: 401 });
    }
    const { data: me } = await supabase.from('users').select('company_id').eq('auth_id', user.id).maybeSingle();
    const companyId = me?.company_id;
    if (!companyId) {
      return NextResponse.json({ error: { code: 'NO_COMPANY', message: '회사 정보를 찾을 수 없습니다' } }, { status: 400 });
    }

    // 구독자만 충전 가능 — 무료는 기본 제공량까지만(사장님 결정).
    const { data: ent } = await (supabase as unknown as {
      rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown }>;
    }).rpc('get_company_entitlement', { p_company_id: companyId });
    const row = (Array.isArray(ent) ? ent[0] : ent) as { effective_plan_slug?: string; entitled?: boolean } | null;
    if (!row?.entitled || (row.effective_plan_slug || 'free') === 'free') {
      return NextResponse.json(
        { error: { code: 'PLAN_REQUIRED', message: '충전은 유료 요금제에서 이용할 수 있습니다. 요금제를 먼저 시작해 주세요.' } },
        { status: 403 },
      );
    }

    const price = CREDIT_PRICING[kind as CreditKind];
    const quantity = price.step * packCount;   // 실제 적립될 건수/토큰 수
    const amountKrw = price.unitKrw * packCount;

    // 결제 전에 pending 으로 먼저 남긴다 — 웹훅이 이 id 로 적립한다.
    const { data: purchase, error: insErr } = await supabase
      .from('credit_purchases')
      // 신규 테이블이라 생성 타입에 아직 없음 — 구독 라우트의 캐스팅 관례와 동일
      .insert({ company_id: companyId, kind, quantity, amount_krw: amountKrw, status: 'pending' } as never)
      .select('id')
      .single();
    if (insErr || !purchase) {
      return NextResponse.json({ error: { code: 'DB_ERROR', message: '충전 요청을 만들지 못했습니다' } }, { status: 500 });
    }

    const origin = request.headers.get('origin') || 'https://www.owner-view.com';
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'krw',
          unit_amount: amountKrw,                       // KRW 는 최소단위가 원이라 그대로
          product_data: {
            name: `${price.label} 충전`,
            description: `${quantity.toLocaleString('ko-KR')}${price.unitLabel}`,
          },
        },
      }],
      customer_email: user.email,
      success_url: successUrl || `${origin}/billing?credit=success`,
      cancel_url: cancelUrl || `${origin}/billing?credit=cancel`,
      metadata: {
        purpose: 'credit_topup',
        creditPurchaseId: (purchase as { id: string }).id,
        companyId,
        kind,
        quantity: String(quantity),
      },
      // 부가세 10% 별도 — 구독과 동일 세율 설정을 쓴다(미설정이면 세금 없이 진행).
      ...(process.env.STRIPE_TAX_RATE_VAT
        ? { line_items_tax_rates: undefined, automatic_tax: undefined }
        : {}),
    });

    // 어떤 세션에서 온 결제인지 되짚을 수 있게 세션 id 를 남긴다(중복 적립 방어는 웹훅의 status 가드).
    await supabase.from('credit_purchases')
      .update({ provider_ref: session.id } as never)
      .eq('id', (purchase as { id: string }).id);

    return NextResponse.json({ data: { url: session.url, amountKrw, quantity } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '충전 결제를 시작하지 못했습니다';
    console.error('Stripe credit checkout error:', message);
    return NextResponse.json({ error: { code: 'STRIPE_ERROR', message } }, { status: 500 });
  }
}
