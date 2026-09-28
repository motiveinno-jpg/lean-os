import { logRead } from "@/lib/log-read";
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { assertSameOrigin } from '@/lib/api-authz';
import { SEAT_PRICE_MAP, billableSeats, type BillingCycle } from '@/lib/stripe-seat-prices';

// 결제 뒤 돌아올 주소는 우리 사이트 안으로만 — 임의 주소를 넣으면 checkout.stripe.com 을 거쳐 피싱 페이지로 보낼 수 있다
function safeReturnUrl(candidate: unknown, origin: string, fallback: string): string {
  const allowed = new Set([origin, 'https://www.owner-view.com', process.env.NEXT_PUBLIC_SITE_URL || ''].filter(Boolean));
  const c = typeof candidate === 'string' ? candidate.trim() : '';
  if (!c) return fallback;
  if (c.startsWith('/') && !c.startsWith('//')) return `${origin}${c}`;
  try { const u = new URL(c); if (allowed.has(u.origin)) return u.toString(); } catch { /* 형식 오류 */ }
  return fallback;
}

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2025-02-24.acacia',
  });
}

// 무료체험 폐지 ("무료는 무료요금제뿐, 오너뷰는 즉시 결제")
//   결제 완료 즉시 청구·이용 개시. 영업코드는 추적용으로만 기록(체험 연장 혜택 소멸).

export async function POST(request: NextRequest) {
  { const csrf = assertSameOrigin(request); if (csrf) return csrf; }
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
    const { planSlug, companyId, seatCount, successUrl, cancelUrl, salesCode, billingCycle } = body;
    const cycle: BillingCycle = billingCycle === 'annual' ? 'annual' : 'monthly';

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

    // 이미 살아 있는 구독이 있으면 새 Checkout 을 막는다 — 두 번 결제하면 Stripe 에 구독 두 개가 생기고 DB 는 하나만 가리켜
    //   먼저 것을 영영 해지할 수 없었다. 변경은 고객 포털(변경·해지)로.
    const { data: live } = await supabase
      .from('subscriptions')
      .select('id, status')
      .eq('company_id', companyId)
      .in('status', ['active', 'trialing', 'past_due', 'paused'])
      .limit(1)
      .maybeSingle();
    if (live) {
      return NextResponse.json(
        { error: { code: 'ALREADY_SUBSCRIBED', message: '이미 이용 중인 구독이 있습니다. 요금제 변경·해지는 결제 관리에서 해 주세요.' } },
        { status: 409 },
      );
    }

    const plan = SEAT_PRICE_MAP[planSlug];
    if (!plan) {
      return NextResponse.json(
        { error: { code: 'INVALID_PLAN', message: `유효하지 않은 플랜입니다: ${planSlug}` } },
        { status: 400 },
      );
    }
    const priceSet = plan[cycle];
    if (!priceSet?.base) {
      // Stripe 가격(env STRIPE_PRICE_*)이 등록되지 않은 상태. 사용자 잘못이 아니므로
      //   '유효하지 않은 플랜' 같은 오해 소지 있는 문구 대신 상황을 그대로 알린다.
      //   (종전엔 월간도 '유효하지 않은 플랜입니다: standard' 로 떠서 원인을 알 수 없었다)
      console.error(`[checkout] price env missing — plan=${planSlug} cycle=${cycle}`);
      return NextResponse.json(
        {
          error: {
            code: 'CYCLE_UNAVAILABLE',
            message: cycle === 'annual'
              ? '연간 결제는 아직 준비 중입니다. 월간으로 진행해 주세요.'
              : '결제 준비가 아직 끝나지 않았습니다. 잠시 후 다시 시도하시고, 계속 같은 화면이 나오면 고객센터로 알려 주세요.',
          },
        },
        { status: 400 },
      );
    }

    // 영업코드: 서버에서 검증(클라 값 신뢰 안 함) — 무료체험 폐지 후에는 영업 실적 추적용으로만
    //   메타데이터에 기록한다. sales_code_bonus_days 는 코드를 아는 경우에만 확인되는 RPC.
    let normalizedSalesCode: string | null = null;
    if (typeof salesCode === 'string' && salesCode.trim()) {
      normalizedSalesCode = salesCode.trim().toUpperCase();
      const { data: bonus, error: codeErr } = await supabase.rpc('sales_code_bonus_days', {
        p_code: normalizedSalesCode,
      });
      if (codeErr || bonus === null || bonus === undefined) {
        return NextResponse.json(
          { error: { code: 'INVALID_SALES_CODE', message: '유효하지 않은 영업코드입니다. 코드를 다시 확인해 주세요.' } },
          { status: 400 },
        );
      }
    }

    // 좌석 수는 서버에서 센다 — 재직 구성원(company_seat_count, 토스 월 청구와 같은 함수).
    //   전에는 주석과 달리 화면이 보낸 seatCount 를 그대로 써서, 인원을 적게 보내면 적게 청구됐다.
    const seatInfo = await billableSeats(supabase, companyId, plan.includedSeats);
    if (!seatInfo) {
      return NextResponse.json({ error: { code: 'SEAT_COUNT_FAILED', message: '구성원 수를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.' } }, { status: 500 });
    }
    const requestedSeats = seatInfo.seats;
    const extraSeats = seatInfo.extraSeats;
    void seatCount; // 화면 값은 표시용 — 청구에는 쓰지 않는다

    const lineItems: { price: string; quantity: number }[] = [{ price: priceSet.base, quantity: 1 }];
    if (extraSeats > 0 && priceSet.extraSeat) {
      lineItems.push({ price: priceSet.extraSeat, quantity: extraSeats });
    }

    const origin = request.headers.get('origin') || 'https://www.owner-view.com';
    const resolvedSuccessUrl = safeReturnUrl(successUrl, origin, `${origin}/billing?payment=success`);
    const resolvedCancelUrl = safeReturnUrl(cancelUrl, origin, `${origin}/billing?payment=cancel`);

    const stripe = getStripe();
    // 공통 메타데이터 — 웹훅이 구독행·영업코드 사용이력을 기록할 때 그대로 읽는다.
    const sharedMetadata: Record<string, string> = {
      companyId,
      planSlug,
      seatCount: String(requestedSeats),
      billingCycle: cycle,
      ...(normalizedSalesCode ? { salesCode: normalizedSalesCode } : {}),
    };

    // 무료체험 없이 즉시 청구 (2026-08-11) — 월간은 첫 달, 연간은 1년치가 결제 완료 즉시 청구된다.
    const subscriptionData = {
      metadata: sharedMetadata,
      // 부가세 10% 별도 청구 — 구독 전체에 기본 세율 적용(설정 시). 미설정이면 세금 없이 진행.
      ...(process.env.STRIPE_TAX_RATE_VAT ? { default_tax_rates: [process.env.STRIPE_TAX_RATE_VAT] } : {}),
    };

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      payment_method_collection: 'always',
      line_items: lineItems,
      success_url: resolvedSuccessUrl,
      cancel_url: resolvedCancelUrl,
      customer_email: user.email,
      metadata: { ...sharedMetadata, userId: user.id },
      subscription_data: subscriptionData,
    });

    return NextResponse.json({ data: { url: session.url } });
  } catch (err: unknown) {
    console.error('[stripe/checkout]', err instanceof Error ? err.message : err);
    const message = '결제 페이지를 열지 못했습니다. 잠시 후 다시 시도해 주세요.';
    console.error('Stripe checkout error:', message);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message } },
      { status: 500 },
    );
  }
}
