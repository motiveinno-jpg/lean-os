// 광고 메일 수신거부 접수 (2026-09-16)
//   정보통신망법 제50조가 요구하는 「수신거부 방법」의 실제 처리 경로다.
//   email_optouts 는 RLS 활성 + 정책 0개 → service_role 로만 적재 가능 (/api/partnership 과 같은 구조).
//
//   ▸ 확인 메일을 보내지 않는 이유: 남의 주소를 넣어 메일을 쏘게 만드는 통로가 되기 때문이다.
//     제50조 제7항의 처리 결과 통지는 신청 즉시 화면에 결과를 띄우는 것으로 갈음한다.
//   ▸ 응답은 항상 같다 — 이미 등록된 주소인지 알려 주면 특정 주소의 등록 여부를 캐낼 수 있다.
//   ▸ IP 는 저장하지 않는다(/api/partnership 과 같은 방침). 남용 차단은 in-memory 레이트리밋으로만.
import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';
import * as Sentry from '@sentry/nextjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// 요청 IP — 레이트리밋 키로만 쓰고 저장하지 않는다. x-forwarded-for 첫 값은 조작 가능해 확정 헤더를 먼저 본다.
function clientIp(req: NextRequest): string {
  const real = req.headers.get('x-real-ip') || req.headers.get('x-vercel-forwarded-for');
  if (real) return real.split(',')[0].trim();
  const xff = req.headers.get('x-forwarded-for') || '';
  const parts = xff.split(',').map((p) => p.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : 'unknown';
}

// 인스턴스별 in-memory (미들웨어·/api/track 과 같은 한계 — 완벽 보장은 아니다)
const WINDOW_MS = 60_000;
const MAX_PER_MIN = 10;
const hits = new Map<string, { count: number; resetAt: number }>();
function limited(ip: string): boolean {
  const now = Date.now();
  if (hits.size > 500) for (const [k, v] of hits) { if (now > v.resetAt) hits.delete(k); }
  const e = hits.get(ip);
  if (!e || now > e.resetAt) { hits.set(ip, { count: 1, resetAt: now + WINDOW_MS }); return false; }
  return ++e.count > MAX_PER_MIN;
}

const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));

    // 허니팟 — 사람에겐 보이지 않는 칸. 채워져 있으면 봇이므로 조용히 성공 응답.
    if (String(body.website ?? '').trim()) return NextResponse.json({ ok: true });

    if (limited(clientIp(req))) {
      return NextResponse.json({ error: '잠시 후 다시 시도해주세요.' }, { status: 429 });
    }

    const email = String(body.email ?? '').trim().slice(0, 160).toLowerCase();
    if (!isEmail(email)) {
      return NextResponse.json({ error: '올바른 이메일 주소를 입력해주세요.' }, { status: 400 });
    }

    const admin = createSupabaseAdminClient();
    const { error } = await admin
      .from('email_optouts')
      .upsert({ email, source: 'self' }, { onConflict: 'email', ignoreDuplicates: true });
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (e) {
    Sentry.captureException(e);
    return NextResponse.json({ error: '처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.' }, { status: 500 });
  }
}
