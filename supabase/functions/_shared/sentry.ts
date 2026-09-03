// 엣지 함수 공통 계측 (2026-07-16 Sentry / 2026-09-03 오류 기록장 적재 추가).
//   · Sentry: SENTRY_DSN 시크릿이 있을 때만 전송(없으면 no-op).
//   · error_logs: 핸들러가 던진 미처리 예외와 5xx 응답을 오너뷰 오류 기록장(운영자 › 시스템 상태)에 남긴다.
//     2026-09-03 사장님 "모든 기능에 예외처리 — 원인을 금방 찾게": 그동안 엣지 실패는 Sentry DSN 이
//     비어 있어 어디에도 안 남았다. 서비스 키로 직접 REST 적재하며, 어떤 경우에도 함수 동작을 바꾸지 않는다.
//   · 요청 본문은 companyId 한 값만 뽑고(원인 추적용) 나머지는 기록하지 않는다(민감정보).
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

async function peekCompanyId(req: Request): Promise<string | null> {
  try {
    if (req.method !== "POST") return null;
    const ct = req.headers.get("content-type") || "";
    if (!ct.includes("application/json")) return null;
    const text = await req.clone().text();
    if (text.length > 64 * 1024) return null;
    const j = JSON.parse(text);
    const id = j?.companyId || j?.company_id;
    return typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
  } catch { return null; }
}

// 오너뷰 오류 기록장 적재 — 실패해도 절대 던지지 않는다.
export async function logEdgeError(fnName: string, message: string, context: Record<string, unknown>, companyId: string | null = null): Promise<void> {
  try {
    const url = Deno.env.get("SUPABASE_URL") || "";
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!url || !key) return;
    await fetch(`${url}/rest/v1/error_logs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}`, Prefer: "return=minimal" },
      body: JSON.stringify({
        company_id: companyId,
        source: "manual",
        error_type: "edge",
        message: `[edge ${fnName}] ${String(message).slice(0, 1800)}`,
        url: `edge:${fnName}`,
        context: { function: fnName, ...context },
      }),
    });
  } catch { /* reporter must never throw */ }
}

// serve 핸들러 래퍼. ①미처리 예외 → Sentry + error_logs 후 그대로 재던짐(런타임 기본 500 유지)
// ②핸들러가 내부 catch 로 삼키고 500+ 응답을 돌려준 경우도 상태코드·본문 앞부분을 기록.
export function withSentry(fnName: string, handler: Handler): Handler {
  return async (req: Request): Promise<Response> => {
    const companyId = await peekCompanyId(req);
    try {
      const res = await handler(req);
      if (res.status >= 500) {
        let snippet = "";
        try { snippet = (await res.clone().text()).slice(0, 400); } catch { /* 본문 없음 */ }
        if (DSN) {
          try {
            Sentry.captureMessage(`${fnName}: HTTP ${res.status} ${req.method}`, { level: "error", tags: { edge_function: fnName } });
            await Sentry.flush(2000);
          } catch { /* reporter must never throw */ }
        }
        await logEdgeError(fnName, `HTTP ${res.status} ${req.method} — ${snippet || "(본문 없음)"}`, { status: res.status, method: req.method }, companyId);
      }
      return res;
    } catch (e) {
      if (DSN) {
        try {
          Sentry.captureException(e, { tags: { edge_function: fnName } });
          await Sentry.flush(2000);
        } catch { /* reporter must never throw */ }
      }
      const err = e as { message?: string; stack?: string };
      await logEdgeError(fnName, `미처리 예외: ${err?.message || String(e)}`, { method: req.method, stack: String(err?.stack || "").slice(0, 1500) }, companyId);
      throw e;
    }
  };
}
