import * as Sentry from "@sentry/nextjs";

const IS_PRODUCTION = process.env.NODE_ENV === "production";
const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (IS_PRODUCTION && DSN) {
  Sentry.init({
    dsn: DSN,

    // P0-1: 전 에러 100% + 성능 트레이스 10% + 에러 시점 세션 replay 100%.
    //   세션 단위 replay 는 비용 큼 → 평시 0, 에러 시점만 캡처(replaysOnErrorSampleRate).
    //   Sentry → Telegram/Slack 알림 라우팅은 Sentry Dashboard > Alerts >
    //   Webhook integration 으로 기존 telegram-notify 엣지 URL 연결.
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,

    // Capture all errors in production
    sampleRate: 1.0,

    // Do not send PII
    sendDefaultPii: false,

    // Filter out non-error events
    beforeSend(event) {
      // Strip PII from user context if accidentally set
      if (event.user) {
        delete event.user.ip_address;
        delete event.user.email;
        delete event.user.username;
      }
      return event;
    },

    // Minimal integrations for small bundle
    defaultIntegrations: false,
    integrations: [
      Sentry.globalHandlersIntegration(),
      Sentry.dedupeIntegration(),
      Sentry.linkedErrorsIntegration(),
      Sentry.httpContextIntegration(),
    ],
  });
}
