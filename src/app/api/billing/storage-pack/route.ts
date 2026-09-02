import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createSupabaseServerClient } from '@/lib/supabase-server';

// 스토리지 팩 애드온 구매/변경 — 좌석과 분리된 +10GB, 좌석과 동일 단가(per_seat_price).
//   설계: docs/20260902_PLAN_storage_pack.md
//   - 수량 갱신은 set_storage_packs RPC(owner 자체 검증)로 원자적 처리.
//   - 결제 반영: Stripe = 구독 item 수량 변경(자동 프로레이션·정기갱신) /
//                Toss = 정기결제 크론이 다음 주기부터 반영(즉시 일할청구 없음) /
//                결제수단 미등록 = 수량만 반영(청구 없음).
//   - 감소 시 현재 사용량 > 줄인 뒤 쿼터면 거부(데이터 접근 막힘 방지).

const MAX_PACKS = 10000;

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2025-02-24.acacia' });
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: '인증이 필요합니다' } }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const count = Number(body?.count);
    if (!Number.isInteger(count) || count < 0 || count > MAX_PACKS) {
      return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: '수량이 올바르지 않습니다' } }, { status: 400 });
    }

    // 내 회사
    const { data: userRow } = await supabase.from('users').select('company_id').eq('auth_id', user.id).single();
    const companyId = userRow?.company_id;
    if (!companyId) {
      return NextResponse.json({ error: { code: 'FORBIDDEN', message: '회사 정보를 찾을 수 없습니다' } }, { status: 403 });
    }

    // 현재 구독 + 플랜 파라미터
    const { data: sub } = await (supabase as any)
      .from('subscriptions')
      .select('id, storage_pack_count, seat_count, billing_cycle, payment_provider, stripe_subscription_id, subscription_plans(slug, included_seats, per_seat_price, included_storage_bytes, storage_per_unit_bytes)')
      .eq('company_id', companyId)
      .in('status', ['active', 'paused', 'past_due', 'trialing'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!sub) {
      return NextResponse.json({ error: { code: 'NO_SUBSCRIPTION', message: '유료 구독이 있어야 스토리지 팩을 이용할 수 있습니다' } }, { status: 400 });
    }
    const plan = sub.subscription_plans || {};
    const prevCount = Number(sub.storage_pack_count) || 0;
    const includedBytes = Number(plan.included_storage_bytes) || 524288000;
    const unitBytes = Number(plan.storage_per_unit_bytes) || 10737418240;
    const extraSeats = Math.max(0, (Number(sub.seat_count) || 1) - (Number(plan.included_seats) || 0));

    // 감소 시 사용량 가드 — 줄인 뒤 쿼터보다 현재 사용량이 크면 접근이 막히므로 거부.
    if (count < prevCount) {
      const { data: usageRows } = await (supabase as any).rpc('get_company_storage', { p_company: companyId });
      const usage = Array.isArray(usageRows) ? usageRows[0] : usageRows;
      const used = Number(usage?.used_bytes) || 0;
      const newQuota = includedBytes + (extraSeats + count) * unitBytes;
      if (used > newQuota) {
        return NextResponse.json({
          error: { code: 'STORAGE_IN_USE', message: '현재 사용 중인 용량이 줄인 뒤 한도를 넘습니다. 파일을 먼저 정리한 뒤 줄여 주세요.' },
        }, { status: 409 });
      }
    }

    if (count === prevCount) {
      return NextResponse.json({ data: { count, changed: false, charged: false } });
    }

    // 수량 갱신 (owner 검증은 RPC 내부)
    const { error: setErr } = await (supabase as any).rpc('set_storage_packs', { p_count: count });
    if (setErr) {
      const msg = String(setErr.message || '');
      const status = /not authorized/.test(msg) ? 403 : 400;
      return NextResponse.json({ error: { code: 'SET_FAILED', message: status === 403 ? '대표(소유자)만 변경할 수 있습니다' : '수량 변경에 실패했습니다' } }, { status });
    }

    // 결제 반영
    let charged = false;
    const provider = sub.payment_provider;
    try {
      if (provider === 'stripe' && sub.stripe_subscription_id) {
        const cycle = (sub.billing_cycle === 'annual' || sub.billing_cycle === 'yearly') ? 'annual' : 'monthly';
        const packPrice = cycle === 'annual'
          ? process.env.STRIPE_PRICE_STORAGE_PACK_ANNUAL
          : process.env.STRIPE_PRICE_STORAGE_PACK_MONTHLY;
        if (!packPrice) {
          // 가격 미등록 — 수량은 롤백해 청구/한도 불일치를 막는다.
          await (supabase as any).rpc('set_storage_packs', { p_count: prevCount });
          return NextResponse.json({ error: { code: 'PRICE_UNAVAILABLE', message: '스토리지 팩 결제 준비가 아직 끝나지 않았습니다. 잠시 후 다시 시도해 주세요.' } }, { status: 400 });
        }
        const stripe = getStripe();
        const stripeSub = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);
        const existing = stripeSub.items.data.find((it) => it.price?.id === packPrice);
        const items = existing
          ? [{ id: existing.id, quantity: count }]
          : [{ price: packPrice, quantity: count }];
        await stripe.subscriptions.update(sub.stripe_subscription_id, {
          items,
          proration_behavior: 'always_invoice', // 즉시 일할 청구 + 정기 반영 (Stripe 자동)
        });
        charged = true;
      }
      // provider === 'toss': 정기결제 크론(toss-charge)이 다음 주기부터 팩 포함 금액을 청구 → 여기선 수량만.
      // provider 없음: 결제수단 미등록(내부/무료 등) → 수량만 반영.
    } catch (payErr) {
      // 결제 실패 → 수량 롤백(수량-결제 정합).
      await (supabase as any).rpc('set_storage_packs', { p_count: prevCount });
      const message = payErr instanceof Error ? payErr.message : '결제 반영 실패';
      console.error('[storage-pack] payment error:', message);
      return NextResponse.json({ error: { code: 'PAYMENT_FAILED', message: '결제 반영에 실패했습니다. 결제 수단을 확인해 주세요.' } }, { status: 502 });
    }

    return NextResponse.json({ data: { count, changed: true, charged, provider: provider || null } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '요청 처리 실패';
    console.error('storage-pack error:', message);
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message } }, { status: 500 });
  }
}
