import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';
import { NAVER_STATE_COOKIE, NAVER_NEXT_COOKIE } from '../start/route';

// ── 네이버 로그인 2/2: 콜백 ──
//   code → 네이버 토큰 → 네이버 프로필(이메일) → Supabase 계정 매핑 → 세션 쿠키.
//   Supabase 엔 "임의 제공자의 세션을 직접 발급"하는 API 가 없어, 프로필 검증에 성공한 뒤에만
//   서버 안에서 매직링크 token_hash 를 만들어 그 자리에서 교환한다(메일 발송 없음, 토큰은 브라우저에 노출 안 됨).
//
//   ⚠️ 이 경로는 "이메일만 알면 세션이 나오는" 구조라 순서가 곧 보안이다.
//      state 검증 → 네이버 토큰 교환 성공 → 프로필 resultcode '00' → 그 다음에만 세션 발급.
//   계정 규칙(2026-07-31 사장님): 이메일이 같으면 기존 계정에 연결(같은 계정으로 로그인).

const NAVER_TOKEN_URL = 'https://nid.naver.com/oauth2.0/token';
const NAVER_PROFILE_URL = 'https://openapi.naver.com/v1/nid/me';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const fail = (reason: string) => NextResponse.redirect(`${origin}/auth?error=${reason}`);

  const cookieStore = await cookies();
  const expectedState = cookieStore.get(NAVER_STATE_COOKIE)?.value;
  const rawNext = cookieStore.get(NAVER_NEXT_COOKIE)?.value ?? '/auth/verify';
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/auth/verify';

  const code = searchParams.get('code');
  const state = searchParams.get('state');
  // 사용자가 네이버 동의 화면에서 취소한 경우도 여기로 온다(code 없이 error 만).
  if (!code || !state || !expectedState || state !== expectedState) {
    return fail('naver_state_mismatch');
  }

  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  if (!clientId || !clientSecret) return fail('naver_not_configured');

  // 1) code → access_token
  const tokenUrl = new URL(NAVER_TOKEN_URL);
  tokenUrl.searchParams.set('grant_type', 'authorization_code');
  tokenUrl.searchParams.set('client_id', clientId);
  tokenUrl.searchParams.set('client_secret', clientSecret);
  tokenUrl.searchParams.set('code', code);
  tokenUrl.searchParams.set('state', state);

  let accessToken = '';
  try {
    const tokenRes = await fetch(tokenUrl.toString(), { method: 'GET', cache: 'no-store' });
    const tokenJson = await tokenRes.json();
    accessToken = tokenJson?.access_token || '';
    if (!tokenRes.ok || !accessToken) return fail('naver_token_failed');
  } catch {
    return fail('naver_token_failed');
  }

  // 2) 프로필 조회 — 네이버는 성공해도 resultcode 로 실패를 알린다(HTTP 200 + '024' 등).
  let profile: { id?: string; email?: string; name?: string; nickname?: string } = {};
  try {
    const meRes = await fetch(NAVER_PROFILE_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });
    const meJson = await meRes.json();
    if (!meRes.ok || meJson?.resultcode !== '00') return fail('naver_profile_failed');
    profile = meJson.response || {};
  } catch {
    return fail('naver_profile_failed');
  }

  const email = (profile.email || '').trim().toLowerCase();
  // 이메일 제공에 동의하지 않으면 기존 계정과 연결할 방법이 없다 — 다시 동의하도록 안내.
  if (!email) return fail('naver_no_email');

  const displayName = profile.name || profile.nickname || '';
  const admin = createSupabaseAdminClient();

  // 3) 계정 매핑 — 없으면 생성, 있으면 그 계정을 그대로 쓴다(이메일 = 연결 키).
  const { error: createError } = await admin.auth.admin.createUser({
    email,
    email_confirm: true, // 네이버가 확인한 이메일이라 별도 확인메일 불필요
    user_metadata: { full_name: displayName, provider_naver: true, naver_id: profile.id || null },
  });
  if (createError) {
    const alreadyExists =
      (createError as { code?: string }).code === 'email_exists' ||
      /already.*(registered|exists)/i.test(createError.message || '');
    if (!alreadyExists) return fail('naver_user_failed');
  }

  // 4) 세션 발급 — 매직링크 token_hash 를 서버 안에서 즉시 교환(메일 발송 없음)
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  });
  const tokenHash = linkData?.properties?.hashed_token;
  if (linkError || !tokenHash) return fail('naver_session_failed');

  const response = NextResponse.redirect(`${origin}${next}`);
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!.trim(),
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim(),
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  const { data: verified, error: verifyError } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: 'email',
  });
  if (verifyError || !verified?.session) return fail('naver_session_failed');

  // 기존 계정에 처음 네이버로 들어온 경우 — 연결 사실을 남겨 문의 대응 때 확인할 수 있게 한다.
  const meta = verified.user?.user_metadata || {};
  if (verified.user?.id && !meta.provider_naver) {
    await admin.auth.admin.updateUserById(verified.user.id, {
      user_metadata: { ...meta, provider_naver: true, naver_id: profile.id || null },
    }).catch(() => { /* 연결 기록 실패가 로그인을 막지 않는다 */ });
  }

  // 1회용 state 정리
  response.cookies.delete(NAVER_STATE_COOKIE);
  response.cookies.delete(NAVER_NEXT_COOKIE);
  return response;
}
