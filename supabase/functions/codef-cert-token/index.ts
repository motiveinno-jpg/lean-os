// 설정 화면 인증서 자동 인식(CodefCert)용 CODEF OAuth 토큰 발급.
//   Vercel env 의 CODEF_CLIENT_ID/SECRET 가 깨져 Next API 라우트 발급이 502 (2026-08-04 실증).
//   엣지 시크릿의 CODEF 키는 codef-sync cron 이 매일 검증하는 값이라 이쪽에서 발급한다.
//   Next /api/codef/cert-token 이 이 함수로 프록시.
import { withSentry } from "../_shared/sentry.ts";
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// CodefCert 2.1.0 전용 OAuth 우선, 미프로비저닝 대비 구 엔드포인트 폴백 (Next 라우트와 동일 로직).
const CERT_TOKEN_URL = "https://oauth.codef.io/oauth/token/cert";
const LEGACY_TOKEN_URL = "https://oauth.codef.io/oauth/token";

function safeDecode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}
// CODEF 토큰 응답은 URL 인코딩되어 올 수 있음 — 디코드 후보까지 순서대로 파싱.
function parseAccessToken(raw: string): string | null {
  for (const candidate of [raw, safeDecode(raw)]) {
    try {
      const token = JSON.parse(candidate)?.access_token;
      if (typeof token === "string" && token.length > 0) return token;
    } catch { /* 다음 후보 시도 */ }
  }
  return null;
}

async function fetchToken(url: string, basicAuth: string): Promise<string | null> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basicAuth}`,
    },
    body: "grant_type=client_credentials&scope=read",
  });
  if (!res.ok) return null;
  return parseAccessToken(await res.text());
}

serve(withSentry("codef-cert-token", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authHeader = req.headers.get("authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "Unauthorized" }, 401);

  // getUser 는 반드시 토큰 명시 전달 — 고정버전 supabase-js 무인자 호출 함정 회피.
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
  );
  const { data: { user } } = await supabase.auth.getUser(jwt);
  if (!user) return json({ error: "Unauthorized" }, 401);

  const clientId = (Deno.env.get("CODEF_CLIENT_ID") || "").trim();
  const clientSecret = (Deno.env.get("CODEF_CLIENT_SECRET") || "").trim();
  if (!clientId || !clientSecret) return json({ error: "CODEF credentials not configured" }, 500);

  const basicAuth = btoa(`${clientId}:${clientSecret}`);
  let access = await fetchToken(CERT_TOKEN_URL, basicAuth);
  if (!access) {
    console.warn("[codef-cert-token] /oauth/token/cert 실패 → 구 /oauth/token 폴백");
    access = await fetchToken(LEGACY_TOKEN_URL, basicAuth);
  }
  if (!access) return json({ error: "CODEF token request failed" }, 502);

  return json({ token: access });
}));
