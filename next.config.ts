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

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://vercel.live https://*.vercel.app https://*.daumcdn.net",
      "style-src 'self' 'unsafe-inline' https://*.daumcdn.net https://fonts.googleapis.com https://cdn.jsdelivr.net",
      "img-src 'self' data: blob: https://*.supabase.co https://*.daumcdn.net",
      "font-src 'self' data: https://fonts.gstatic.com https://cdn.jsdelivr.net",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://vercel.live https://*.vercel.app https://*.ingest.sentry.io https://fonts.gstatic.com https://*.daumcdn.net https://*.daum.net",
      "frame-src 'self' blob: https://*.daumcdn.net https://*.daum.net https://*.kakao.com",
      // 'self' — 자사 페이지가 자사 페이지를 iframe 으로 임베드(메뉴 팝업 기능) 허용. 외부 출처 임베드는 여전히 차단.
      "frame-ancestors 'self'",
      "base-uri 'self'",
      "form-action 'self'",
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
  trailingSlash: true,
  // 2026-07-20 QA: 홈 디렉터리에 잡 package-lock.json 이 있으면 Next 가 워크스페이스 루트를
  //   홈 전체로 오인해 빌드/dev 가 수 분씩 느려짐 — 프로젝트 루트를 명시 고정.
  turbopack: { root: process.cwd() },
  // headless Chrome(서버 PDF 렌더)용 네이티브 패키지는 번들하지 않고 런타임 require
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
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
