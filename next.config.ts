import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

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
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "X-Frame-Options",
    value: "DENY",
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
