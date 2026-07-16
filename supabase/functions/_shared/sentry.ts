// 엣지 함수 공통 Sentry 계측 (2026-07-16 하드닝 백로그 — "엣지 41개 Sentry 미계측").
// SENTRY_DSN 시크릿이 없으면 전면 no-op — 어떤 경우에도 함수 동작을 바꾸지 않는다(fail-safe).
// 활성화: supabase secrets set SENTRY_DSN=<Next 앱과 동일 DSN> (재배포 불필요, 다음 콜드스타트부터 적용).
import * as Sentry from "npm:@sentry/deno@9";

const DSN = Deno.env.get("SENTRY_DSN") ?? "";

if (DSN) {
  Sentry.init({
    dsn: DSN,
    environment: "edge",
    sampleRate: 1.0,
    sendDefaultPii: false,
  });
}

type Handler = (req: Request) => Response | Promise<Response>;

// serve 핸들러 래퍼. ①핸들러가 던진 미처리 예외를 캡처 후 그대로 재던짐(런타임 기본 500 유지)
// ②핸들러가 내부 catch 로 삼키고 500+ 응답을 돌려준 경우도 상태코드만 신호로 수집(본문은 PII 우려로 안 읽음).
export function withSentry(fnName: string, handler: Handler): Handler {
  if (!DSN) return handler;
  return async (req: Request): Promise<Response> => {
    try {
      const res = await handler(req);
      if (res.status >= 500) {
        try {
          Sentry.captureMessage(`${fnName}: HTTP ${res.status} ${req.method}`, {
            level: "error",
            tags: { edge_function: fnName },
          });
          await Sentry.flush(2000);
        } catch { /* reporter must never throw */ }
      }
      return res;
    } catch (e) {
      try {
        Sentry.captureException(e, { tags: { edge_function: fnName } });
        await Sentry.flush(2000);
      } catch { /* reporter must never throw */ }
      throw e;
    }
  };
}
