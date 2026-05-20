// OwnerView /api/health — 실데이터 점검 (P0-9).
// 이전엔 무조건 healthy 거짓반환이었음. 이제 DB·Stripe·CODEF 실제 점검 결과를 합산.
// HTTP 200 = healthy / 200 + status="degraded" = 부분장애 / 503 = unhealthy(DB 다운).
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Check = { ok: boolean; ms?: number; note?: string };

async function timed<T>(fn: () => Promise<T>, timeoutMs = 3000): Promise<{ ms: number; result?: T; error?: string }> {
  const t0 = Date.now();
  try {
    const result = await Promise.race([
      fn(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
    ]);
    return { ms: Date.now() - t0, result };
  } catch (e: unknown) {
    return { ms: Date.now() - t0, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function GET() {
  const checks: Record<string, Check> = {};

  // ── DB: Supabase 라이트 read (RLS·연결·서비스 가용 종합) ──
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    checks.db = { ok: false, note: 'env missing (NEXT_PUBLIC_SUPABASE_URL/ANON_KEY)' };
  } else {
    const r = await timed(async () => {
      const sb = createClient(url, anon);
      const { error } = await sb.from('users').select('id', { count: 'exact', head: true }).limit(1);
      if (error) throw error;
      return true;
    }, 3000);
    checks.db = { ok: !r.error, ms: r.ms, note: r.error || undefined };
  }

  // ── Stripe: env + lightweight /v1/balance (가장 가벼운 인증 검증 호출) ──
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    checks.stripe = { ok: false, note: 'STRIPE_SECRET_KEY missing' };
  } else {
    const r = await timed(async () => {
      const res = await fetch('https://api.stripe.com/v1/balance', {
        headers: { Authorization: `Bearer ${stripeKey}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return true;
    }, 3000);
    checks.stripe = { ok: !r.error, ms: r.ms, note: r.error || undefined };
  }

  // ── CODEF: env + 최근 25h codef_bank_cron sync_log 존재 (sync alive 프록시) ──
  //   외부 CODEF 핑은 인증서/비용 부하 → 내부 sync_logs 기록으로 우회. P0-2 일일 점검이
  //   더 깊은 정합 검증을 담당.
  if (!url || !anon) {
    checks.codef = { ok: false, note: 'db env missing — cannot verify' };
  } else {
    const r = await timed(async () => {
      const sb = createClient(url, anon);
      const since = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
      const { count, error } = await sb
        .from('sync_logs')
        .select('id', { count: 'exact', head: true })
        .eq('sync_type', 'codef_bank_cron')
        .gte('created_at', since);
      if (error) throw error;
      return count ?? 0;
    }, 3000);
    const cnt = typeof r.result === 'number' ? r.result : 0;
    checks.codef = {
      ok: !r.error && cnt > 0,
      ms: r.ms,
      note: r.error
        ? r.error
        : cnt > 0
        ? `${cnt} sync runs in last 25h`
        : 'no codef_bank_cron sync run in last 25h',
    };
  }

  // ── 종합 status ──
  // db 실패 → unhealthy(503). 나머지 중 하나라도 실패 → degraded(200 + flag).
  const dbOk = checks.db.ok;
  const allOk = Object.values(checks).every(c => c.ok);
  const status: 'healthy' | 'degraded' | 'unhealthy' = !dbOk
    ? 'unhealthy'
    : allOk
    ? 'healthy'
    : 'degraded';

  return NextResponse.json(
    {
      status,
      timestamp: new Date().toISOString(),
      service: 'ownerview',
      checks,
    },
    { status: dbOk ? 200 : 503 },
  );
}
