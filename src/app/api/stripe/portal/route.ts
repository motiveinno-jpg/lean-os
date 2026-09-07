import { logRead } from "@/lib/log-read";
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { assertSameOrigin } from '@/lib/api-authz';

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
    const { companyId, returnUrl } = body;

    if (!companyId) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'companyId는 필수입니다' } },
        { status: 400 },
      );
    }

    // Verify user belongs to the company
    const userRow = logRead('portal/route:userRow', await supabase
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

    // Look up subscription to find the Stripe customer ID
    const subscription = logRead('portal/route:subscription', await supabase
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('company_id', companyId)
      // trialing 포함 — 체험(카드만 등록) 중에도 포털에서 해지/카드 관리가 가능해야 한다
      //   (2026-08-05 사장님 제보: 체험 계정이 '활성 구독 없음' 404 로 해지 포털을 못 열었음)
      .in('status', ['active', 'trialing', 'paused', 'past_due'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle());

    if (!subscription?.stripe_customer_id) {
      return NextResponse.json(
        { error: { code: 'NO_SUBSCRIPTION', message: '활성 구독이 없습니다' } },
        { status: 404 },
      );
    }

    const origin = request.headers.get('origin') || 'https://www.owner-view.com';
    const resolvedReturnUrl = safeReturnUrl(returnUrl, origin, `${origin}/billing`);

    const stripe = getStripe();
    const session = await stripe.billingPortal.sessions.create({
      customer: subscription.stripe_customer_id,
      return_url: resolvedReturnUrl,
    });

    return NextResponse.json({ data: { url: session.url } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Billing portal 생성 실패';
    console.error('Stripe portal error:', message);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message } },
      { status: 500 },
    );
  }
}
