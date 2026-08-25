import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

// 작업일지(release-log) 생성 — Vercel 이 package.json build 스크립트 대신 `next build` 를
//   직접 실행해 생성기가 배포에서 한 번도 안 돌던 문제(2026-07-30 사장님: 오늘 커밋이 작업일지에
//   없음). next.config 는 어떤 빌드 명령이든 로드되므로 여기서 실행 — 실패해도 빌드는 막지 않음.
try {
  execFileSync(process.execPath, [resolve(__dirname, "scripts/generate-release-log.mjs")], { stdio: "inherit" });
} catch { /* git 없음 등 — 기존 커밋된 JSON 으로 빌드 진행 */ }

// 로컬 Supabase(도커, http://127.0.0.1:54321)로 띄운 경우에만 CSP connect-src 에 로컬 주소 허용.
//   운영/프리뷰(*.supabase.co)에서는 빈 문자열 — 헤더가 기존과 바이트 단위로 동일하다.
const supaUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
const localSupaCsp = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(supaUrl)
  ? ` ${supaUrl} ${supaUrl.replace("http://", "ws://")}`
  : "";
const localSupaImgCsp = localSupaCsp ? ` ${supaUrl}` : "";

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // local.espider.co.kr = CodefCert 로컬 인증 엔진(127.0.0.1 로 해석). 버전확인이 JSONP(스크립트 태그)라 script-src 필요.
      // js.tosspayments.com — 토스 결제 SDK(카드 등록창). 2026-08-06 자동결제 1단계.
      // *.googletagmanager.com — GA4(components/analytics.tsx). 2026-08-21 전수 점검에서 발견:
      //   GA 를 붙여 두고 CSP 에 도메인을 안 넣어 프로덕션 콘솔에 계속 차단 로그가 찍히고 있었다
      //   ("Loading the script ... violates the Content Security Policy"). 즉 GA 통계가 안 쌓였다.
      //   우리 DB(marketing_events) 기록은 gtag 와 무관하게 계속 남고 있었으므로 유실 범위는 GA 쪽뿐.
      "script-src 'self' 'unsafe-inline' https://vercel.live https://*.vercel.app https://*.daumcdn.net https://local.espider.co.kr:24646 https://js.tosspayments.com https://*.googletagmanager.com",
      "style-src 'self' 'unsafe-inline' https://*.daumcdn.net https://fonts.googleapis.com https://cdn.jsdelivr.net",
      // *.pstatic.net — 네이버 광고 소재(쇼핑 상품) 이미지. 광고 대시보드의 소재 카드가 그린다
      //   (2026-08-06: 허용 전에는 카드가 깨진 이미지로 떴다). 이미지 표시만 허용, 스크립트는 여전히 차단.
      `img-src 'self' data: blob: https://*.supabase.co https://*.daumcdn.net https://*.pstatic.net https://*.google-analytics.com https://*.googletagmanager.com${localSupaImgCsp}`,
      "font-src 'self' data: https://fonts.gstatic.com https://cdn.jsdelivr.net",
      // wss://local.espider.co.kr:* — CodefCert 엔진 WebSocket(포트가 getPort 응답마다 동적).
      `connect-src 'self' https://*.supabase.co wss://*.supabase.co https://vercel.live https://*.vercel.app https://*.ingest.sentry.io https://fonts.gstatic.com https://*.daumcdn.net https://*.daum.net wss://local.espider.co.kr:* https://api.tosspayments.com https://*.tosspayments.com https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com${localSupaCsp}`,
      "frame-src 'self' blob: https://*.daumcdn.net https://*.daum.net https://*.kakao.com https://*.tosspayments.com",
      // 'self' — 자사 페이지가 자사 페이지를 iframe 으로 임베드(메뉴 팝업 기능) 허용. 외부 출처 임베드는 여전히 차단.
      "frame-ancestors 'self'",
      "base-uri 'self'",
      // 카드 등록은 토스 도메인으로 폼 전송된다 — 카드사 인증창은 토스가 다시 띄운다.
      "form-action 'self' https://*.tosspayments.com",
    ].join("; "),
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    // SAMEORIGIN — 메뉴 팝업(자사 iframe) 허용. 외부 사이트의 임베드는 차단(클릭재킹 방어 유지).
    key: "X-Frame-Options",
    value: "SAMEORIGIN",
  },
  {
    key: "X-XSS-Protection",
    value: "1; mode=block",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  // 빌드 산출물 폴더를 env 로 갈아끼울 수 있게 둔다 — dev 서버가 .next 를 잡고 있는 동안
  // 배포 전 빌드 검증을 돌리려면 별도 폴더가 필요하다(BUILD_DIR=.next-verify npx next build).
  distDir: process.env.BUILD_DIR || ".next",
  trailingSlash: true,
  // 2026-07-20 QA: 홈 디렉터리에 잡 package-lock.json 이 있으면 Next 가 워크스페이스 루트를
  //   홈 전체로 오인해 빌드/dev 가 수 분씩 느려짐 — 프로젝트 루트를 명시 고정.
  turbopack: { root: process.cwd() },
  // headless Chrome(서버 PDF 렌더)용 네이티브 패키지는 번들하지 않고 런타임 require
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
  // ⚠️ sparticuz 의 bin/*.br(chromium 본체 + al2023 공유 라이브러리 tar)은 fs.readdir 로
  //   읽혀 정적 트레이싱이 못 잡는다 — 빠지면 프로덕션에서 /tmp/chromium 이
  //   "libnss3.so: cannot open shared object file" 로 즉사한다(2026-08-25 채우기·출력 500 실사고,
  //   error_logs '[html-pdf]' 참조). PDF 렌더 라우트 함수 번들에 명시적으로 실어 준다.
  //   키는 App Router 내부 식별자("/api/…/route")와 매칭된다 — "/api/html-pdf" 단독 키는
  //   프로덕션에서 매칭되지 않아 libnss3 가 계속 빠졌다(2026-08-25 배포 실측). 변형을 함께 둔다.
  outputFileTracingIncludes: {
    "/api/html-pdf": ["./node_modules/@sparticuz/chromium/bin/**", "./node_modules/dompurify/dist/purify.min.js"],
    "/api/html-pdf/route": ["./node_modules/@sparticuz/chromium/bin/**", "./node_modules/dompurify/dist/purify.min.js"],
    "/api/contract-pdf": ["./node_modules/@sparticuz/chromium/bin/**"],
    "/api/contract-pdf/route": ["./node_modules/@sparticuz/chromium/bin/**"],
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "njbvdkuvtdtkxyylwngn.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

const sentryConfig = withSentryConfig(nextConfig, {
  // Suppress Sentry CLI logs during build
  silent: true,

  // Upload source maps only when auth token is available
  ...(process.env.SENTRY_AUTH_TOKEN
    ? {
        org: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
        authToken: process.env.SENTRY_AUTH_TOKEN,
      }
    : {
        sourcemaps: {
          disable: true,
        },
      }),

  // Tree-shake performance monitoring and debug logs to reduce bundle size
  webpack: {
    treeshake: {
      removeDebugLogging: true,
      removeTracing: true,
    },
    automaticVercelMonitors: false,
  },
});

export default sentryConfig;
