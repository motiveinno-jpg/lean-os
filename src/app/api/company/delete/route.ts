import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';

// 회사 완전 삭제 (2026-08-10 사장님 요청) — 마스터 전용.
//   순서가 중요하다: ① Stripe 구독 해지 → ② master_delete_company RPC.
//   RPC 가 먼저 돌면 subscriptions 행이 사라져 구독 id 를 잃고, 회사는 없는데
//   결제만 계속 나가는 최악의 상태가 된다. 그래서 해지 실패 시 삭제를 중단한다.
//   RPC 는 호출자의 auth 컨텍스트로 실행(SECURITY DEFINER 안에서 마스터·회사명 재검증).

export async function POST(request: NextRequest) {
  try {
    const { confirmName } = await request.json();
    if (typeof confirmName !== 'string' || !confirmName.trim()) {
      return NextResponse.json({ error: '회사명을 입력해주세요.' }, { status: 400 });
    }

    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

    const admin = createSupabaseAdminClient();
    // 생성 타입에 is_master 가 아직 없음 — 다른 라우트와 동일한 캐스팅 관례
    const { data: me } = await admin
      .from('users').select('id, company_id, is_master')
      .eq('auth_id', user.id).maybeSingle() as unknown as
      { data: { id: string; company_id: string | null; is_master: boolean | null } | null };
    if (!me?.company_id) return NextResponse.json({ error: '회사 정보를 찾을 수 없습니다.' }, { status: 400 });
    if (!me.is_master) return NextResponse.json({ error: '마스터만 회사를 삭제할 수 있습니다.' }, { status: 403 });

    const { data: company } = await admin
      .from('companies').select('id, name').eq('id', me.company_id).maybeSingle();
    if (!company) return NextResponse.json({ error: '회사 정보를 찾을 수 없습니다.' }, { status: 400 });
    const expected = String(company.name || '').trim() || '회사 삭제';
    if (confirmName.trim() !== expected) {
      return NextResponse.json({ error: '회사명이 일치하지 않습니다. 정확히 입력해주세요.' }, { status: 400 });
    }

    // ── Stripe 구독 해지 (있을 때만) — 실패하면 삭제를 진행하지 않는다 ──
    const { data: sub } = await admin
      .from('subscriptions')
      .select('stripe_subscription_id, status, payment_provider')
      .eq('company_id', company.id)
      .maybeSingle() as unknown as
      { data: { stripe_subscription_id: string | null; status: string | null } | null };
    const stripeSubId = (sub as { stripe_subscription_id?: string | null } | null)?.stripe_subscription_id;
    if (stripeSubId && sub?.status !== 'canceled') {
      try {
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2025-02-24.acacia' });
        await stripe.subscriptions.cancel(stripeSubId);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        // 이미 해지된 구독(resource_missing 등)은 통과, 그 외 실패는 중단.
        if (!/No such subscription|canceled/i.test(msg)) {
          console.error('[company-delete] Stripe 해지 실패:', msg);
          return NextResponse.json(
            { error: '결제 구독 해지에 실패해 삭제를 중단했습니다. 요금제 화면에서 먼저 해지한 뒤 다시 시도해주세요.' },
            { status: 502 },
          );
        }
      }
    }

    // ── 삭제 본체 — 호출자 세션으로 RPC (함수가 마스터·회사명 다시 검증) ──
    const { data, error } = await (supabase as unknown as {
      rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
    }).rpc('master_delete_company', { p_confirm_name: confirmName.trim() });
    if (error) {
      console.error('[company-delete] RPC 실패:', error.message);
      const friendly = error.message.includes('confirm_name_mismatch')
        ? '회사명이 일치하지 않습니다.'
        : error.message.includes('master only')
          ? '마스터만 회사를 삭제할 수 있습니다.'
          : '회사 삭제에 실패했습니다. 잠시 후 다시 시도해주세요.';
      return NextResponse.json({ error: friendly }, { status: 400 });
    }

    return NextResponse.json({ data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '회사 삭제 중 오류가 발생했습니다.';
    console.error('[company-delete]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
