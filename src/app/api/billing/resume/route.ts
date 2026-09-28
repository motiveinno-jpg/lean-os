import { logRead } from "@/lib/log-read";
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';
import { assertSameOrigin } from '@/lib/api-authz';

/**
 * 해지 취소(구독 계속) — 환불규정 제5조 4항 "해지 신청 이후 이용기간 만료 전에는 해지를 취소하여
 * 구독을 계속 유지할 수 있습니다"를 실제로 되게 한다(전에는 약속만 있고 기능이 없었다, 2026-09-28).
 *   · 해지 예약(cancel_at_period_end)이고 이용기간이 아직 남은 구독만.
 *   · Stripe 구독이면 Stripe 쪽 예약부터 푼다 — DB 만 풀면 기간말에 Stripe 가 끝내 버린다.
 *   · 토스는 toss-charge 가 cancel_at_period_end 를 보고 청구를 건너뛰므로 DB 만 풀면 다음 결제일에 이어서 청구된다.
 *   · 마스터만. 구독 쓰기는 service_role 로만(브라우저 쓰기는 DB 가드가 막는다).
 */
export async function POST(request: NextRequest) {
  { const csrf = assertSameOrigin(request); if (csrf) return csrf; }
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: '인증이 필요합니다' } }, { status: 401 });

    const admin = createSupabaseAdminClient() as any;
    const userRow = logRead('resume/route:userRow', await admin.from('users').select('company_id, is_master').eq('auth_id', user.id).maybeSingle());
    if (!userRow?.company_id) return NextResponse.json({ error: { code: 'FORBIDDEN', message: '회사 정보를 찾을 수 없습니다' } }, { status: 403 });
    if (!userRow.is_master) return NextResponse.json({ error: { code: 'FORBIDDEN', message: '해지 취소는 마스터만 가능합니다' } }, { status: 403 });

    const sub = logRead('resume/route:sub', await admin.from('subscriptions')
      .select('id, stripe_subscription_id, payment_provider, status, current_period_end, cancel_at_period_end, plan_slug')
      .eq('company_id', userRow.company_id)
      .order('created_at', { ascending: false }).limit(1).maybeSingle());
    const periodLeft = !!sub?.current_period_end && new Date(sub.current_period_end).getTime() > Date.now();
    if (!sub || !sub.cancel_at_period_end || !['active', 'past_due', 'paused'].includes(sub.status) || !periodLeft) {
      return NextResponse.json({ error: { code: 'NOT_RESUMABLE', message: '해지 예약 중인 구독이 없거나 이용기간이 이미 끝났습니다. 요금제 화면에서 새로 시작해 주세요.' } }, { status: 409 });
    }

    if (sub.stripe_subscription_id) {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2025-02-24.acacia' });
      await stripe.subscriptions.update(sub.stripe_subscription_id, { cancel_at_period_end: false });
    }

    const now = new Date().toISOString();
    const { error: dbErr } = await admin.from('subscriptions')
      .update({ cancel_at_period_end: false, cancel_requested_at: null, cancel_reason: null, updated_at: now })
      .eq('id', sub.id);
    if (dbErr) return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: '해지 취소 처리 중 오류가 발생했습니다' } }, { status: 500 });

    await admin.from('billing_events').insert({
      company_id: userRow.company_id, event_type: 'subscription_resumed',
      metadata: { subscription_id: sub.id, stripe_subscription_id: sub.stripe_subscription_id, provider: sub.payment_provider || (sub.stripe_subscription_id ? 'stripe' : null), plan: sub.plan_slug },
    });
    return NextResponse.json({ data: { resumed: true, nextBillingAt: sub.current_period_end } });
  } catch (err) {
    console.error('[billing/resume]', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: '해지 취소를 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' } }, { status: 500 });
  }
}
