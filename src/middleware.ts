import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// ── Simple Rate Limiter (Edge-compatible) ──
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_AUTH = 20; // /auth endpoints: 20 req/min
const RATE_LIMIT_MAX_PLATFORM = 30; // /api/platform 운영자 액션: 30 req/min (고위험 — 연타·자동화 방지)
const RATE_LIMIT_MAX_PDF = 10; // /api/*-pdf: 10 req/min (puppeteer 고비용 — 남용·DoS 방지)
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
  '/security',  // 보안 안내 — 비로그인 노출이 목적
  '/invite',
  '/sign',
  '/share',
  '/guide',
  '/advisor',  // 세무사 파트너 포털 랜딩(로그인/가입) — 하위 라우트는 세션 필요 (2026-08-11)
  '/tax-partners',  // 세무사 제휴 모집 랜딩 (2026-08-11)
  '/platform',
  '/demo',
  '/pricing',   // 랜딩에서 분리한 요금제 페이지 — 비로그인 노출이 목적 (2026-07-27)
  '/features',  // 랜딩에서 분리한 기능 둘러보기 페이지 — 동일 (2026-07-27)
  '/landing-v7', // 새 랜딩 시안 — 사장님 확정 전까지 별도 라우트, noindex (2026-09-04)
  '/ai',        // AI 자동화 페이지 — 동일 (2026-07-27)
  '/maintenance',
  '/status',
  '/tools', // 무료 계산기 허브(모음) — 검색 유입용 공개 인덱스 (2026-08-31)
  '/tools/leave-calculator', // 무료 연차 계산기 — 검색 유입용 공개 도구 (2026-08-13)
  '/tools/severance-calculator', // 무료 퇴직금 계산기 — 공개 도구 2탄 (2026-08-13)
  '/tools/insurance-calculator', // 무료 4대보험 계산기 — 공개 도구 3탄 (2026-08-13)
  '/tools/salary-calculator', // 무료 실수령액 계산기 — 공개 도구 4탄 (2026-08-13)
  '/tools/weekly-holiday-calculator', // 무료 주휴수당 계산기 — 공개 도구 5탄 (2026-08-25)
  '/tools/vat-calculator', // 무료 부가세 계산기 — 공개 도구 6탄 (2026-08-25)
];

// 토큰이 경로 조각으로 붙는 외부 공개 라우트 — 정확 일치로는 /quote/<token> 이 걸리지 않아
//   비로그인 거래처가 로그인으로 튕겼다(2026-08-31 QA 실측 — 견적 외부 승인 실사용 0건의 원인).
//   /sign·/share 는 토큰을 쿼리로 받아 정확 일치로 충분, 여기엔 경로형만 넣는다.
const PUBLIC_PREFIXES = ['/quote/', '/portal/'];

function isPublicRoute(pathname: string): boolean {
  // API 라우트는 자체 인증 처리
  if (pathname.startsWith('/api/')) return true;
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return true;
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

  // Rate limit 플랫폼 운영자 액션 (비밀번호 리셋·계정 잠금 등 고위험 — 연타·자동화 남용 방지)
  if (pathname.startsWith('/api/platform')) {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    if (isRateLimited(`platform:${ip}`, RATE_LIMIT_MAX_PLATFORM)) {
      return new NextResponse('Too Many Requests', { status: 429, headers: { 'Retry-After': '60' } });
    }
  }

  // Rate limit PDF 렌더 (puppeteer — CPU/메모리 고비용, 남용·DoS 방지). IP당 분당 10회.
  //   서버리스 인스턴스별 in-memory 라 완벽하진 않음 — 강한 보장은 Vercel WAF/Firewall 권장(운영 액션 항목).
  if (pathname === '/api/html-pdf' || pathname === '/api/contract-pdf') {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    if (isRateLimited(`pdf:${ip}`, RATE_LIMIT_MAX_PDF)) {
      return new NextResponse('Too Many Requests', { status: 429, headers: { 'Retry-After': '60' } });
    }
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!.trim(),
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim(),
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

  // 인증 확인 — DB/인증 미응답 시 hang → 504 방지를 위해 타임아웃.
  //   타임아웃/오류면 서버 점검 상태로 간주: 보호 라우트는 /maintenance 로 rewrite(504 대신 점검 화면).
  let user: { id: string } | null = null;
  let authDown = false;
  try {
    const res = (await Promise.race([
      supabase.auth.getUser(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('AUTH_TIMEOUT')), 5000)),
    ])) as { data?: { user: { id: string } | null }; error?: unknown };
    user = res?.data?.user ?? null;
  } catch {
    authDown = true; // getUser hang/timeout — DB/인증 미응답
  }

  // 서버(DB/인증) 미응답 + 보호 라우트 → 504 대신 점검 화면
  if (authDown && !isPublicRoute(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = '/maintenance';
    return NextResponse.rewrite(url);
  }

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
    // robots.txt·sitemap.xml 은 검색로봇용 공개 파일 — auth 미들웨어 제외 (네이버가 robots.txt 307 리다이렉트 받던 문제, 2026-07-02)
    // exe·pkg 는 public/downloads 의 CodefCert 인스톨러 — 로그인 없이 받게 정적 서빙(미들웨어 제외, 2026-07-23)
    // webm·mp4 는 랜딩 히어로 시연 영상 — 비로그인 방문자가 /auth 로 튕겨 영상이 안 나왔다 (2026-09-04 실측 307)
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|html|exe|pkg|webm|mp4)$).*)',
  ],
};
