import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// ── Simple Rate Limiter (Edge-compatible) ──
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_AUTH = 20; // /auth endpoints: 20 req/min
const RATE_LIMIT_CLEANUP_THRESHOLD = 500;
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(key: string, maxRequests: number): boolean {
  const now = Date.now();

  // C2 Fix: 인라인 정리 — Map 크기가 임계값 초과 시 만료 항목 제거
  if (rateLimitMap.size > RATE_LIMIT_CLEANUP_THRESHOLD) {
    for (const [k, v] of rateLimitMap) {
      if (now > v.resetAt) rateLimitMap.delete(k);
    }
  }

  const entry = rateLimitMap.get(key);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > maxRequests;
}

const PUBLIC_ROUTES = [
  '/',
  '/auth',
  '/auth/verify',
  '/auth/reset',
  '/auth/find-email',
  '/api/auth/callback',
  '/terms',
  '/privacy',
  '/refund',
  '/invite',
  '/sign',
  '/share',
  '/guide',
  '/platform',
  '/demo',
];

function isPublicRoute(pathname: string): boolean {
  // API 라우트는 자체 인증 처리
  if (pathname.startsWith('/api/')) return true;
  return PUBLIC_ROUTES.some(
    (route) => pathname === route || pathname === `${route}/`,
  );
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Rate limit auth endpoints (brute force protection)
  if (pathname.startsWith('/auth') || pathname.startsWith('/api/auth')) {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    if (isRateLimited(`auth:${ip}`, RATE_LIMIT_MAX_AUTH)) {
      return new NextResponse('Too Many Requests', { status: 429, headers: { 'Retry-After': '60' } });
    }
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 인증된 유저가 /auth 접근 → /dashboard로 리다이렉트
  if (user && (pathname === '/auth' || pathname === '/auth/')) {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    return NextResponse.redirect(url);
  }

  // 비인증 유저가 보호 라우트 접근 → /auth로 리다이렉트
  if (!user && !isPublicRoute(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = '/auth';
    url.searchParams.set('redirectTo', pathname);
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|html)$).*)',
  ],
};
