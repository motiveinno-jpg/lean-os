// 랜딩 제휴·도입 문의 접수 (2026-07-27)
//   랜딩 폼은 그동안 전송 코드가 없는 더미였다 — 리드가 전부 유실됐다.
//   partnership_inquiries 는 RLS 활성 + 정책 0개 → service_role 로만 적재 가능.
//   스팸 방지: 허니팟 + 이메일별/전역 시간당 한도 (IP 는 PII 라 저장하지 않음).
import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';
import * as Sentry from '@sentry/nextjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const RATE_WINDOW_MS = 60 * 60 * 1000; // 1시간
const RATE_MAX_PER_EMAIL = 3;          // 동일 이메일 시간당
const RATE_MAX_GLOBAL = 30;            // 전역 시간당 (스팸 차단기)

const LIMITS = { company_name: 120, contact_name: 60, email: 160, phone: 40, message: 4000 };

const clean = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));

    // 허니팟 — 사람에겐 보이지 않는 필드. 채워져 있으면 봇이므로 조용히 성공 응답.
    if (String(body.website ?? '').trim()) {
      return NextResponse.json({ ok: true });
    }

    const companyName = clean(body.companyName, LIMITS.company_name);
    const contactName = clean(body.contactName, LIMITS.contact_name);
    const email = clean(body.email, LIMITS.email).toLowerCase();
    const phone = clean(body.phone, LIMITS.phone);
    const message = clean(body.message, LIMITS.message);

    if (!companyName) return NextResponse.json({ error: '회사명을 입력해주세요.' }, { status: 400 });
    if (!contactName) return NextResponse.json({ error: '담당자명을 입력해주세요.' }, { status: 400 });
    if (!isEmail(email)) return NextResponse.json({ error: '올바른 이메일 주소를 입력해주세요.' }, { status: 400 });
    if (message.length < 5) return NextResponse.json({ error: '문의 내용을 5자 이상 입력해주세요.' }, { status: 400 });

    const admin = createSupabaseAdminClient();
    const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();

    const { count: emailCount } = await admin
      .from('partnership_inquiries')
      .select('id', { count: 'exact', head: true })
      .eq('email', email)
      .gte('created_at', since);
    if ((emailCount ?? 0) >= RATE_MAX_PER_EMAIL) {
      return NextResponse.json({ error: '문의가 이미 접수되었습니다. 잠시 후 다시 시도해주세요.' }, { status: 429 });
    }

    const { count: globalCount } = await admin
      .from('partnership_inquiries')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', since);
    if ((globalCount ?? 0) >= RATE_MAX_GLOBAL) {
      return NextResponse.json({ error: '일시적으로 접수가 지연되고 있습니다. 잠시 후 다시 시도해주세요.' }, { status: 429 });
    }

    const { error } = await admin.from('partnership_inquiries').insert({
      company_name: companyName,
      contact_name: contactName,
      email,
      phone: phone || null,
      message,
      status: 'new',
    });
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (e) {
    Sentry.captureException(e);
    return NextResponse.json({ error: '접수 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.' }, { status: 500 });
  }
}
