export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

// 서버 렌더 오류를 **우리 테이블에도** 남긴다 (2026-08-05).
//   배경: 프로덕션에서 프로젝트 상세·견적 승인 화면이 500 인데, 브라우저에는 digest 만 오고
//   실제 메시지는 Vercel 런타임 로그에만 남는다. 그 로그를 볼 수 없는 사람은 원인을 알 길이 없다.
//   → error_logs 에 남겨 두면 앱 안 '오류 로그' 화면에서 누구나 원인을 본다.
//   서비스 롤 키로 넣는다(RLS 우회). 실패해도 절대 요청을 깨지 않는다.
async function logToDb(err: unknown, request: unknown) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return;
    const e = err as { name?: string; message?: string; stack?: string; digest?: string } | undefined;
    const req = request as { path?: string; url?: string; method?: string } | undefined;
    await fetch(`${url}/rest/v1/error_logs`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        source: "ssr",
        error_type: e?.name || "Error",
        message: String(e?.message || err || "unknown").slice(0, 2000),
        stack: String(e?.stack || "").slice(0, 8000),
        url: (req?.path || req?.url || "").slice(0, 500) || null,
        context: { method: req?.method || null, digest: e?.digest || null },
      }),
    });
  } catch {
    /* 로깅 실패로 요청을 깨지 않는다 */
  }
}

export const onRequestError = async (...args: unknown[]) => {
  await logToDb(args[0], args[1]);
  const { captureRequestError } = await import("@sentry/nextjs");
  // @ts-expect-error -- Sentry types may not match Next.js signature exactly
  return captureRequestError(...args);
};
