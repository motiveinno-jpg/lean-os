import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

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
];

function isPublicRoute(pathname: string): boolean {
  // API 라우트는 자체 인증 처리
  if (pathname.startsWith('/api/')) return true;
  return PUBLIC_ROUTES.some(
    (route) => pathname === route || pathname === `${route}/`,
  );
}

export async function middleware(request: NextRequest) {
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

  const { pathname } = request.nextUrl;

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
