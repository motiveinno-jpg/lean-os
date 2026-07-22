// OwnerView /api/health — 실데이터 점검 (P0-9, 2026-07-22 정합 수정).
// HTTP 200 = healthy / 200 + status="degraded" = 부분장애 / 503 = unhealthy(DB 다운).
// 공개 응답은 최소 상태(ok/ms + 거친 라벨)만 — 내부 오류 전문·민감정보 비노출.
// 내부 점검은 service role 로 수행(RLS 우회) — anon 은 RLS 로 행이 안 보여 codef/db 를 오탐(거짓 degraded)했음.
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

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // 서버 전용 점검 — service role 우선(RLS 우회로 실제 가용성 판정). 없으면 anon 폴백.
  const dbKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // ── DB: Supabase 라이트 read ──
  if (!url || !dbKey) {
    checks.db = { ok: false, note: 'config' };
  } else {
    const r = await timed(async () => {
      const sb = createClient(url, dbKey, { auth: { persistSession: false } });
      const { error } = await sb.from('users').select('id', { count: 'exact', head: true }).limit(1);
      if (error) throw error;
      return true;
    }, 3000);
    checks.db = { ok: !r.error, ms: r.ms }; // 공개 응답엔 오류 전문 미노출
  }

  // ── Stripe: checkout 이 실제 사용하는 권한(가격 조회)로 probe ──
  //   restricted key(rk_live_)는 balance 권한이 없어 /v1/balance 는 403 → 과거 거짓 degraded.
  //   Checkout 에 필요한 /v1/prices 로 검증(실제 결제 경로와 정합).
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    checks.stripe = { ok: false, note: 'config' };
  } else {
    const r = await timed(async () => {
      const res = await fetch('https://api.stripe.com/v1/prices?limit=1', {
        headers: { Authorization: `Bearer ${stripeKey}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return true;
    }, 3000);
    checks.stripe = { ok: !r.error, ms: r.ms };
  }

  // ── CODEF: 내부 sync_logs 기록으로 cron 생존 확인 ──
  //   bank/card 동기화 cron(net.http_post → codef-sync)이 남기는 codef_*_cron 기록.
  //   ⚠️ 반드시 service role — anon+RLS 는 행이 안 보여 0건 거짓 degraded (2026-07-22 진단).
  if (!url || !dbKey) {
    checks.codef = { ok: false, note: 'config' };
  } else {
    const r = await timed(async () => {
      const sb = createClient(url, dbKey, { auth: { persistSession: false } });
      const since = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
      const { count, error } = await sb
        .from('sync_logs')
        .select('id', { count: 'exact', head: true })
        .in('sync_type', ['codef_bank_cron', 'codef_card_cron'])
        .gte('created_at', since);
      if (error) throw error;
      return count ?? 0;
    }, 3000);
    const cnt = typeof r.result === 'number' ? r.result : 0;
    checks.codef = { ok: !r.error && cnt > 0, ms: r.ms, note: r.error ? undefined : cnt > 0 ? 'ok' : 'stale' };
  }

  // ── 종합 status ──
  const dbOk = checks.db.ok;
  const allOk = Object.values(checks).every((c) => c.ok);
  const status: 'healthy' | 'degraded' | 'unhealthy' = !dbOk ? 'unhealthy' : allOk ? 'healthy' : 'degraded';

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
