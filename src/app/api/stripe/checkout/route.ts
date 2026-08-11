import { logRead } from "@/lib/log-read";
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createSupabaseServerClient } from '@/lib/supabase-server';

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2025-02-24.acacia',
  });
}

// 기본 무료체험 14일. 영업코드를 입력하면 코드에 설정된 보너스일(기본 30일)이 더해져 44일.
export const BASE_TRIAL_DAYS = 14;

type BillingCycle = 'monthly' | 'annual';

// 플랜별 price (2026-07-23 좌석 구조 + 2026-07-27 연간 추가).
//   기본 좌석(5명) 초과분만 추가좌석 price 로 별도 line item. VAT 10% 별도.
//   연간 env 가 없으면 연간 선택은 400 으로 막는다(가격 미생성 상태에서 잘못 결제되는 것 방지).
//   2026-08-07 구 요금제(프로·울트라·엔터프라이즈) 제거 — 판매 요금제는 '오너뷰' 하나뿐이다.
//     기존 구독자는 subscriptions 에 남은 plan_id 로 계속 유지되고 한도도 그대로 적용된다.
//     여기서 빠지면 '새로 결제'만 막힌다(알 수 없는 플랜은 아래에서 400).
const SEAT_PRICE_MAP: Record<string, Record<BillingCycle, { base?: string; extraSeat?: string }> & { includedSeats: number }> = {
  // 요금제 — 단일 유료 플랜(2026-08-11부터 월 39,000원 + 추가좌석 5,000원, VAT 별도).
  //   Stripe 대시보드에서 price 를 만든 뒤 Vercel env 에 아래 4개를 등록해야 결제가 열린다.
  //   env 가 비어 있으면 checkout 이 400 으로 막히므로 잘못 결제될 위험은 없다.
  standard: {
    monthly: {
      base: process.env.STRIPE_PRICE_STANDARD_MONTHLY,
      extraSeat: process.env.STRIPE_PRICE_STANDARD_EXTRA_SEAT_MONTHLY,
    },
    annual: {
      base: process.env.STRIPE_PRICE_STANDARD_ANNUAL,
      extraSeat: process.env.STRIPE_PRICE_STANDARD_EXTRA_SEAT_ANNUAL,
    },
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

    // 영업코드: 서버에서 검증(클라 값 신뢰 안 함). 유효하면 보너스 체험일을 더한다.
    //   sales_code_bonus_days 는 코드를 아는 경우에만 확인되는 SECURITY DEFINER RPC —
    //   목록 열람은 불가하므로 코드 수집에 쓰일 수 없다.
    let normalizedSalesCode: string | null = null;
    let bonusTrialDays = 0;
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
      bonusTrialDays = Math.max(0, Number(bonus) || 0);
    }
    const trialDays = BASE_TRIAL_DAYS + bonusTrialDays;

    // 좌석 수는 서버에서 재계산 — 클라 값 그대로 신뢰하지 않음. 추가좌석 = max(0, 좌석 - 기본좌석 - 무료쿠폰좌석).
    //   무료쿠폰좌석: 연간 결제 혜택 쿠폰(추가인원 12명 무료)을 사용(redeemed)한 회사는 그만큼 과금 제외
    //   (2026-07-30 사장님 — "쿠폰으로 등록된 인원은 추가인원 비용으로 빠져나가지 않게").
    const requestedSeats = Math.max(1, Math.min(Number(seatCount) || 1, 500));
    let freeCouponSeats = 0;
    try {
      const { data: coupons } = await (supabase as any)
        .from('billing_seat_coupons')
        .select('free_seats')
        .eq('company_id', companyId)
        .eq('status', 'redeemed');
      freeCouponSeats = (coupons || []).reduce((s: number, c: any) => s + Number(c.free_seats || 0), 0);
    } catch { /* 쿠폰 조회 실패 시 무료좌석 0 으로 진행(과소청구 방지) */ }
    const extraSeats = Math.max(0, requestedSeats - plan.includedSeats - freeCouponSeats);

    const lineItems: { price: string; quantity: number }[] = [{ price: priceSet.base, quantity: 1 }];
    if (extraSeats > 0 && priceSet.extraSeat) {
      lineItems.push({ price: priceSet.extraSeat, quantity: extraSeats });
    }

    const origin = request.headers.get('origin') || 'https://www.owner-view.com';
    const resolvedSuccessUrl = successUrl || `${origin}/billing?payment=success`;
    const resolvedCancelUrl = cancelUrl || `${origin}/billing?payment=cancel`;

    const stripe = getStripe();
    // 공통 메타데이터 — 웹훅이 구독행·영업코드 사용이력을 기록할 때 그대로 읽는다.
    const sharedMetadata: Record<string, string> = {
      companyId,
      planSlug,
      seatCount: String(requestedSeats),
      billingCycle: cycle,
      trialDays: String(trialDays),
      ...(normalizedSalesCode ? { salesCode: normalizedSalesCode } : {}),
    };

    // 카드 등록 즉시(0원 인증) + 트라이얼(기본 14일, 영업코드 시 44일) + 종료 후 자동 청구.
    //   연간도 동일하게 트라이얼을 주고, 종료 시 1년치를 한 번에 청구한다(사장님 결정 2026-07-27).
    //   결제수단 없으면 트라이얼 종료 시 구독 취소.
    const subscriptionData = {
      trial_period_days: trialDays,
      trial_settings: { end_behavior: { missing_payment_method: 'cancel' as const } },
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
    const message = err instanceof Error ? err.message : 'Checkout session 생성 실패';
    console.error('Stripe checkout error:', message);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message } },
      { status: 500 },
    );
  }
}
