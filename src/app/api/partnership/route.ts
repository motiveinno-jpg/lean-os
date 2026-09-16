// 랜딩 제휴·도입 문의 접수 (2026-07-27)
//   랜딩 폼은 그동안 전송 코드가 없는 더미였다 — 리드가 전부 유실됐다.
//   partnership_inquiries 는 RLS 활성 + 정책 0개 → service_role 로만 적재 가능.
//   스팸 방지: 허니팟 + 이메일별/전역 시간당 한도 (IP 는 PII 라 저장하지 않음).
import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';
import * as Sentry from '@sentry/nextjs';
import { CONTACT } from '@/components/landing-v8/content';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const RATE_WINDOW_MS = 60 * 60 * 1000; // 1시간
const RATE_MAX_PER_EMAIL = 3;          // 동일 이메일 시간당
const RATE_MAX_GLOBAL = 30;            // 전역 시간당 (스팸 차단기)

const LIMITS = { company_name: 120, contact_name: 60, email: 160, phone: 40, message: 4000 };

const clean = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

//   접수 알림 (2026-09-16) — 종전에는 DB 에 쌓이기만 해 운영자 화면을 직접 열어야 문의가 온 걸 알았다.
//   ⚠️ 알림이 실패해도 접수는 성공이다. 문의를 잃는 것보다 알림을 놓치는 편이 낫다 — 그래서 await 하되 throw 하지 않는다.
//   인증은 service_role 키(엣지가 JWT 의 role 을 확인) — 공유 비밀값을 새로 두면 env 가 빠졌을 때 조용히 꺼진다.
async function notifyInquiry(p: {
  companyName: string; contactName: string; email: string; phone: string; message: string;
}) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return;

    const res = await fetch(`${url}/functions/v1/send-inquiry-notification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        company_name: p.companyName,
        contact_name: p.contactName,
        email: p.email,
        phone: p.phone,
        message: p.message,
        created_at: new Date().toISOString(),
      }),
    });
    if (!res.ok) console.error('[partnership] 접수 알림 실패:', res.status);
  } catch (e) {
    Sentry.captureException(e); // 접수는 이미 저장됐다 — 알림 실패만 남긴다
  }
}

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
    let message = clean(body.message, LIMITS.message);

    if (!companyName) return NextResponse.json({ error: '회사명을 입력해주세요.' }, { status: 400 });
    if (!contactName) return NextResponse.json({ error: '담당자명을 입력해주세요.' }, { status: 400 });
    if (!isEmail(email)) return NextResponse.json({ error: '올바른 이메일 주소를 입력해주세요.' }, { status: 400 });

    // /contact 상담 신청 (2026-09-14) — 표 칸을 늘리지 않고 고른 값을 내용 앞 줄로 붙인다.
    //   접수 0건인 표에 칸을 더하는 것보다, 운영자 문의함(줄바꿈 그대로 표시)에서 바로 읽히는 쪽을 골랐다.
    //   고른 값은 화면과 같은 목록(CONTACT)으로 걸러 아무 글자나 들어오지 않게 한다.
    if (body.source === 'contact') {
      if (body.agree !== true) return NextResponse.json({ error: '개인정보 수집·이용에 동의해주세요.' }, { status: 400 });
      const size = CONTACT.sizes.includes(String(body.size)) ? String(body.size) : '';
      const interests = Array.isArray(body.interests)
        ? CONTACT.interests.filter((v) => (body.interests as unknown[]).includes(v))
        : [];
      const head = [
        '[상담 신청 · /contact]',
        size && `인원: ${size}`,
        interests.length > 0 && `관심 업무: ${interests.join(', ')}`,
      ].filter(Boolean).join('\n');
      message = message ? `${head}\n\n${message}` : head;
    } else if (message.length < 5) {
      return NextResponse.json({ error: '문의 내용을 5자 이상 입력해주세요.' }, { status: 400 });
    }

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

    await notifyInquiry({ companyName, contactName, email, phone, message });

    return NextResponse.json({ ok: true });
  } catch (e) {
    Sentry.captureException(e);
    return NextResponse.json({ error: '접수 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.' }, { status: 500 });
  }
}
