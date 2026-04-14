import * as Sentry from "@sentry/nextjs";

const IS_PRODUCTION = process.env.NODE_ENV === "production";
const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (IS_PRODUCTION && DSN) {
  Sentry.init({
    dsn: DSN,

    // Error tracking only — no performance monitoring
    tracesSampleRate: 0,

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
