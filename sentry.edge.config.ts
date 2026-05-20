import * as Sentry from "@sentry/nextjs";

const IS_PRODUCTION = process.env.NODE_ENV === "production";
const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (IS_PRODUCTION && DSN) {
  Sentry.init({
    dsn: DSN,

    // P0-1: 전 에러 100% + 성능 트레이스 10%. 엣지런타임용.
    //   알림 라우팅은 Sentry Dashboard > Alerts > Webhook → telegram-notify 엣지.
    tracesSampleRate: 0.1,

    // Capture all errors in production
    sampleRate: 1.0,

    // Do not send PII
    sendDefaultPii: false,

    beforeSend(event) {
      if (event.user) {
        delete event.user.ip_address;
        delete event.user.email;
        delete event.user.username;
      }
      return event;
    },
  });
}
