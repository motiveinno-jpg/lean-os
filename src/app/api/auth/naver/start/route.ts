import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { logServerError } from '@/lib/server-error-log';

// ── 네이버 로그인 1/2: 인증 요청 ──
//   네이버는 Supabase 내장 소셜 제공자가 아니라(카카오·구글과 달리 signInWithOAuth 로 못 씀)
//   OAuth 2.0 을 직접 구현한다. 여기서 state 를 심어 보내고, 콜백에서 그 state 를 검증한다.
//   레이트리밋은 middleware 의 /api/auth 규칙(IP당 분당 20회)이 그대로 적용된다.

export const NAVER_STATE_COOKIE = 'nv_oauth_state';
export const NAVER_NEXT_COOKIE = 'nv_oauth_next';

export async function GET(request: NextRequest) {
  try {
    const { searchParams, origin } = new URL(request.url);

    const clientId = process.env.NAVER_CLIENT_ID;
    if (!clientId) {
      // 검수 전이라 환경변수가 없을 수 있다 — 흰 화면 대신 로그인 화면에서 안내.
      return NextResponse.redirect(`${origin}/auth?error=naver_not_configured`);
    }

    // open redirect 방지 — 내부 경로만 허용 (기존 /api/auth/callback 과 동일 규칙)
    const rawNext = searchParams.get('next') ?? '/auth/verify';
    const next = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/auth/verify';

    const state = crypto.randomUUID();
    const redirectUri = process.env.NAVER_REDIRECT_URI || `${origin}/api/auth/naver/callback`;

    const authorizeUrl = new URL('https://nid.naver.com/oauth2.0/authorize');
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('client_id', clientId);
    authorizeUrl.searchParams.set('redirect_uri', redirectUri);
    authorizeUrl.searchParams.set('state', state);

    const response = NextResponse.redirect(authorizeUrl.toString());
    const secure = origin.startsWith('https://');
    // httpOnly — state 는 CSRF 방어용이라 스크립트에서 읽을 이유가 없다. 10분이면 로그인엔 충분.
    response.cookies.set(NAVER_STATE_COOKIE, state, {
      httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: 600,
    });
    response.cookies.set(NAVER_NEXT_COOKIE, next, {
      httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: 600,
    });
    return response;
  } catch (e) {
    // 예외처리 (2026-09-03): 실패를 오류 기록장에 남기고 흰 화면 대신 로그인 화면으로 돌려보낸다.
    await logServerError({ where: 'naver-start', message: e instanceof Error ? e.message : String(e) });
    const origin = new URL(request.url).origin;
    return NextResponse.redirect(`${origin}/auth?error=naver_start_failed`);
  }
}
