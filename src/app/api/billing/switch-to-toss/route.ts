import { logRead } from "@/lib/log-read";
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2025-02-24.acacia',
  });
}

/**
 * 해외카드(Stripe) 구독 → 국내카드(토스) 전환 (2026-08-14).
 * 청구 주체는 항상 하나여야 한다 — Stripe 기간말 해지를 먼저 걸어 갱신을 끄고,
 * 같은 요청 안에서 payment_provider 를 toss 로 바꾼다. 남은 유료 기간은 그대로 쓰고
 * 만기일에 toss-charge cron 이 국내카드로 첫 갱신 결제를 한다.
 * (Stripe 취소는 여기 서버 라우트에서만 가능 — 엣지에는 Stripe 키가 없다)
 */
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

    const admin = createSupabaseAdminClient() as any;
    const userRow = logRead('switch-to-toss:userRow', await admin
      .from('users')
      .select('company_id, is_master')
      .eq('auth_id', user.id)
      .maybeSingle());
    if (!userRow?.company_id) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: '회사 정보를 찾을 수 없습니다' } },
        { status: 403 },
      );
    }
    if (!userRow.is_master) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: '결제수단 전환은 마스터만 할 수 있습니다' } },
        { status: 403 },
      );
    }
    const companyId: string = userRow.company_id;

    // 국내카드(빌링키)가 등록돼 있어야 전환할 수 있다 — 없으면 만기 때 청구가 붕 뜬다.
    const keyRow = logRead('switch-to-toss:keyRow', await admin
      .from('toss_billing_keys')
      .select('billing_key_enc')
      .eq('company_id', companyId)
      .maybeSingle());
    if (!keyRow?.billing_key_enc) {
      return NextResponse.json(
        { error: { code: 'NO_CARD', message: '국내카드를 먼저 등록해 주세요' } },
        { status: 400 },
      );
    }

    // 회사의 현재 구독을 서버에서 조회 — body 를 신뢰하지 않음
    const sub = logRead('switch-to-toss:sub', await admin
      .from('subscriptions')
      .select('id, status, payment_provider, stripe_subscription_id, plan_slug, current_period_start, current_period_end, cancel_at_period_end')
      .eq('company_id', companyId)
      .in('status', ['active', 'past_due'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle());
    if (!sub) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: '전환할 유료 구독이 없습니다. 요금제에서 국내카드로 바로 시작할 수 있습니다.' } },
        { status: 404 },
      );
    }
    if (sub.payment_provider === 'toss') {
      return NextResponse.json(
        { error: { code: 'ALREADY_TOSS', message: '이미 국내카드로 결제 중입니다' } },
        { status: 409 },
      );
    }
    // 해지 예약 중이면 전환하지 않는다 — 전환이 예약을 몰래 풀면 동의 없는 재과금이 된다
    // (2026-08-14 보안 리뷰 R-2). 만기 후 국내카드로 새로 시작하는 경로가 이미 있다.
    if (sub.cancel_at_period_end) {
      return NextResponse.json(
        { error: { code: 'CANCEL_SCHEDULED', message: '해지 예약 중인 구독입니다. 이용 기간이 끝난 뒤 국내카드로 새로 시작하거나, 구독 관리에서 해지 예약을 취소한 뒤 전환해 주세요.' } },
        { status: 409 },
      );
    }

    // Stripe 갱신을 끈다(기간말 해지). 이걸 먼저 성공시켜야 이중 청구가 생기지 않는다.
    const stripe = sub.stripe_subscription_id ? getStripe() : null;
    if (stripe && sub.stripe_subscription_id) {
      await stripe.subscriptions.update(sub.stripe_subscription_id, {
        cancel_at_period_end: true,
      });
    }

    const now = new Date().toISOString();
    // 우리 DB 의 cancel_at_period_end 는 "서비스 해지 예정" 신호라 여기서는 켜지 않는다 —
    // 서비스는 계속되고 청구 주체만 바뀐다. stripe_subscription_id 를 지워 만기 삭제
    // 웹훅이 이 행을 Free 로 끌어내리지 못하게 한다.
    const { error: dbErr } = await admin
      .from('subscriptions')
      .update({
        payment_provider: 'toss',
        stripe_subscription_id: null,
        cancel_at_period_end: false,
        cancel_requested_at: null,
        cancel_reason: null,
        updated_at: now,
      })
      .eq('id', sub.id);
    if (dbErr) {
      // Stripe 기간말 해지는 이미 걸렸다 — 이대로 두면 만기에 웹훅이 Free 로 강등한다.
      // 해지를 되돌려 전환 전 상태로 복귀시킨다 (2026-08-14 보안 리뷰 H-3).
      if (stripe && sub.stripe_subscription_id) {
        try {
          // 전환 전 값으로 되돌린다 — false 하드코딩은 사용자가 걸어 둔 해지 예약을 풀어버린다 (R-2).
          await stripe.subscriptions.update(sub.stripe_subscription_id, { cancel_at_period_end: !!sub.cancel_at_period_end });
        } catch (revertErr) {
          console.error('[switch-to-toss] CRITICAL: Stripe revert also failed — manual fix needed:',
            sub.stripe_subscription_id, revertErr instanceof Error ? revertErr.message : revertErr);
        }
      }
      console.error('[switch-to-toss] DB update failed after Stripe cancel:', dbErr.message);
      return NextResponse.json(
        { error: { code: 'INTERNAL_ERROR', message: '전환 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' } },
        { status: 500 },
      );
    }

    await admin.from('billing_events').insert({
      company_id: companyId,
      event_type: 'subscription_updated',
      metadata: {
        action: 'switch_to_toss',
        subscription_id: sub.id,
        stripe_subscription_id: sub.stripe_subscription_id,
        plan: sub.plan_slug,
        next_charge_at: sub.current_period_end,
      },
    });

    return NextResponse.json({
      data: { success: true, nextChargeAt: sub.current_period_end },
    });
  } catch (err: unknown) {
    // 원문(Stripe 리소스 id·스택)은 서버 로그에만 — 클라이언트에는 일반 문구 (M-5).
    console.error('[switch-to-toss] error:', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '결제수단 전환 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' } },
      { status: 500 },
    );
  }
}
