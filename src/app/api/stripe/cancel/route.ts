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
 * 구독 해지 — 반드시 서버에서 Stripe 취소까지 수행.
 * (기존: 클라이언트가 DB만 canceled 로 바꿔 Stripe 는 계속 청구 → 과금 분쟁)
 * 회사 스코프는 호출자 소속에서 파생. subscriptions 쓰기는 service_role 로만.
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
    const userRow = logRead('cancel/route:userRow', await admin
      .from('users')
      .select('company_id, role')
      .eq('auth_id', user.id)
      .maybeSingle());
    if (!userRow?.company_id) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: '회사 정보를 찾을 수 없습니다' } },
        { status: 403 },
      );
    }
    if (!['owner', 'admin'].includes(userRow.role || '')) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: '구독 해지는 대표/관리자만 가능합니다' } },
        { status: 403 },
      );
    }
    const companyId: string = userRow.company_id;

    const body = await request.json().catch(() => ({}));
    const reason: string | null = body?.reason || null;
    // immediate=true 요청은 체험(trialing)에서만 실제 즉시 종료. 유료 구독은 항상 기간말 해지(요금 낸 기간 보존).
    const immediateReq: boolean = body?.immediate === true;

    // 회사의 현재 구독을 서버에서 조회 — body 의 subscription_id 를 신뢰하지 않음
    const sub = logRead('cancel/route:sub', await admin
      .from('subscriptions')
      .select('id, company_id, stripe_subscription_id, plan_slug, status, current_period_end, trial_ends_at, cancel_at_period_end')
      .eq('company_id', companyId)
      .in('status', ['active', 'trialing', 'paused', 'past_due'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle());

    if (!sub) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: '해지할 구독이 없습니다' } },
        { status: 404 },
      );
    }

    // 즉시 종료는 체험만 허용. 유료(active/paused/past_due)는 immediate 요청이어도 기간말 해지로 처리.
    const isTrial = sub.status === 'trialing';
    const doImmediate = immediateReq && isTrial;

    // Stripe 구독이면: 기간말 해지는 cancel_at_period_end=true, 체험 즉시 종료는 실제 cancel.
    if (sub.stripe_subscription_id) {
      const stripe = getStripe();
      if (doImmediate) {
        await stripe.subscriptions.cancel(sub.stripe_subscription_id);
      } else {
        await stripe.subscriptions.update(sub.stripe_subscription_id, {
          cancel_at_period_end: true,
        });
      }
    }

    const now = new Date().toISOString();
    // 기간말 해지: status 유지(active 등) + cancel_at_period_end=true — 종료 시점(webhook)에만 Free 전환.
    // 체험 즉시 종료: canceled 로 바로 전환.
    const patch = doImmediate
      ? { status: 'canceled', cancel_at_period_end: false, cancel_reason: reason, canceled_at: now, cancel_requested_at: now, updated_at: now }
      : { cancel_at_period_end: true, cancel_reason: reason, cancel_requested_at: now, updated_at: now };

    const { error: dbErr } = await admin
      .from('subscriptions')
      .update(patch)
      .eq('id', sub.id);
    if (dbErr) {
      console.error('[stripe/cancel] DB update failed after Stripe success:', dbErr.message);
      return NextResponse.json(
        { error: { code: 'INTERNAL_ERROR', message: '해지 처리 중 오류가 발생했습니다' } },
        { status: 500 },
      );
    }

    // 해지 후 이용 가능 종료 시점: 기간말 해지=현재 기간 종료(체험이면 체험 종료), 즉시=지금.
    const effectiveUntil = doImmediate
      ? now
      : (sub.current_period_end ?? sub.trial_ends_at ?? null);

    await admin.from('billing_events').insert({
      company_id: companyId,
      event_type: doImmediate ? 'subscription_canceled' : 'subscription_cancel_requested',
      metadata: {
        subscription_id: sub.id,
        stripe_subscription_id: sub.stripe_subscription_id,
        plan: sub.plan_slug,
        reason,
        immediate: doImmediate,
        effective_until: effectiveUntil,
      },
    });

    return NextResponse.json({
      data: {
        success: true,
        immediate: doImmediate,
        cancel_at_period_end: !doImmediate,
        effective_until: effectiveUntil,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '구독 해지 처리 중 오류가 발생했습니다';
    console.error('[stripe/cancel] error:', message);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message } },
      { status: 500 },
    );
  }
}
